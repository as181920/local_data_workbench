import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import type { ImportProgress, TemplateSummary } from "../../shared/types.js";
import {
  openTemplateDatabase,
  refreshTemplateStats
} from "../database/storage.js";
import {
  buildSearchText,
  cleanCell,
  dedupeHash,
  normalizeForComparison,
  rowHash
} from "../core/normalization.js";
import { debugError, debugLog } from "../core/debug.js";
import { previewWorkbook, readWorkbookRows } from "../excel/workbook.js";

export interface ImporterOptions {
  storageRoot: string;
  template: TemplateSummary;
  filePaths: string[];
  jobId: string;
  onProgress?: (progress: ImportProgress) => void;
  isCancelled?: () => boolean;
}

interface Totals {
  processedRows: number;
  insertedRows: number;
  mergedRows: number;
  conflictRows: number;
  skippedFiles: number;
}

export async function importWorkbooks(options: ImporterOptions): Promise<ImportProgress> {
  const startedAt = Date.now();
  debugLog("importer", "import started", {
    jobId: options.jobId,
    templateId: options.template.id,
    fileCount: options.filePaths.length,
    filePaths: options.filePaths
  });
  const totals: Totals = {
    processedRows: 0,
    insertedRows: 0,
    mergedRows: 0,
    conflictRows: 0,
    skippedFiles: 0
  };
  const progress = (phase: ImportProgress["phase"], fileIndex: number, fileName?: string, message?: string) => {
    const value: ImportProgress = {
      jobId: options.jobId,
      phase,
      fileName,
      fileIndex,
      fileCount: options.filePaths.length,
      ...totals,
      message
    };
    options.onProgress?.(value);
    return value;
  };
  progress("validating", 0, undefined, "正在校验文件结构");
  const files = options.filePaths.map((filePath) => {
    const preview = previewWorkbook(filePath, options.template.sheetName);
    debugLog("importer", "workbook validated", {
      jobId: options.jobId,
      filePath,
      sheetName: preview.sheetName,
      headerRow: preview.headerRow,
      columnCount: preview.headers.length
    });
    return { filePath, preview, mapping: buildColumnMapping(options.template, preview.headers) };
  });

  const db = openTemplateDatabase(options.storageRoot, options.template.id);
  try {
    for (let index = 0; index < files.length; index += 1) {
      if (options.isCancelled?.()) {
        refreshTemplateStats(options.storageRoot, options.template.id);
        return progress("cancelled", index, undefined, "导入已取消，已完成的文件予以保留");
      }
      const file = files[index];
      const sourceFile = basename(file.filePath);
      const fileHash = await hashFile(file.filePath);
      const alreadyImported = db.prepare(`
        SELECT 1 FROM imports WHERE file_hash = ? AND status = 'completed' LIMIT 1
      `).get(fileHash);
      if (alreadyImported) {
        debugLog("importer", "duplicate file skipped", {
          jobId: options.jobId,
          filePath: file.filePath,
          fileHash
        });
        totals.skippedFiles += 1;
        progress("reading", index + 1, sourceFile, "相同文件已成功导入，本次已跳过");
        continue;
      }
      const importId = createImport(db, sourceFile, fileHash);
      const before = { ...totals };
      try {
        const fileStartedAt = Date.now();
        debugLog("importer", "file import started", {
          jobId: options.jobId,
          filePath: file.filePath,
          fileHash,
          importId
        });
        progress("reading", index + 1, sourceFile, "正在流式读取");
        let pending: Array<{ rowNumber: number; values: string[] }> = [];
        for await (const row of readWorkbookRows(
          file.filePath,
          file.preview.sheetName,
          file.preview.headerRow,
          file.preview.headers.length
        )) {
          if (options.isCancelled?.()) {
            if (pending.length) writeBatch(db, options.template, importId, sourceFile, pending, file.mapping, totals);
            markImport(db, importId, "cancelled", totals, before, "用户取消");
            refreshTemplateStats(options.storageRoot, options.template.id);
            return progress("cancelled", index + 1, sourceFile, "导入已取消，已完成的数据予以保留");
          }
          pending.push(row);
          if (pending.length >= 1_000) {
            writeBatch(db, options.template, importId, sourceFile, pending, file.mapping, totals);
            pending = [];
            debugLog("importer", "batch committed", {
              jobId: options.jobId,
              filePath: file.filePath,
              processedRows: totals.processedRows,
              insertedRows: totals.insertedRows,
              mergedRows: totals.mergedRows,
              conflictRows: totals.conflictRows
            });
            progress("writing", index + 1, sourceFile);
          }
        }
        if (pending.length) {
          writeBatch(db, options.template, importId, sourceFile, pending, file.mapping, totals);
          progress("writing", index + 1, sourceFile);
        }
        markImport(db, importId, "completed", totals, before);
        debugLog("importer", "file import completed", {
          jobId: options.jobId,
          filePath: file.filePath,
          durationMs: Date.now() - fileStartedAt,
          processedRows: totals.processedRows - before.processedRows,
          insertedRows: totals.insertedRows - before.insertedRows,
          mergedRows: totals.mergedRows - before.mergedRows,
          conflictRows: totals.conflictRows - before.conflictRows
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugError("importer", "file import failed", error, {
          jobId: options.jobId,
          filePath: file.filePath,
          importId
        });
        markImport(db, importId, "failed", totals, before, message);
        throw new Error(`${sourceFile} 导入失败：${message}`);
      }
    }
  } catch (error) {
    progress("failed", 0, undefined, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    db.close();
  }
  refreshTemplateStats(options.storageRoot, options.template.id);
  debugLog("importer", "import completed", {
    jobId: options.jobId,
    durationMs: Date.now() - startedAt,
    ...totals
  });
  return progress("completed", files.length, undefined, "导入完成");
}

function buildColumnMapping(template: TemplateSummary, incomingHeaders: string[]): number[] {
  const incoming = incomingHeaders.map((header) => header.normalize("NFKC").replace(/\s+/g, " ").trim());
  const expected = template.columns.map((column) => column.normalizedName);
  if (JSON.stringify(incoming) === JSON.stringify(expected)) return expected.map((_, index) => index);
  if (incoming.length !== expected.length) {
    throw new Error(`字段数量不一致：模板 ${expected.length} 列，文件 ${incoming.length} 列。请新建模板。`);
  }
  if (new Set(incoming).size !== incoming.length || new Set(expected).size !== expected.length) {
    throw new Error("字段顺序发生变化且存在重复表头，无法安全映射。请恢复列顺序或新建模板。");
  }
  const mapping = expected.map((header) => incoming.indexOf(header));
  if (mapping.some((index) => index < 0)) {
    const missing = expected.filter((header) => !incoming.includes(header));
    const extra = incoming.filter((header) => !expected.includes(header));
    throw new Error(`字段不一致。缺少：${missing.join("、") || "无"}；新增：${extra.join("、") || "无"}。请新建模板。`);
  }
  return mapping;
}

function createImport(db: Database.Database, sourceFile: string, fileHash: string): number {
  return Number(db.prepare(`
    INSERT INTO imports(source_file, file_hash, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(sourceFile, fileHash, new Date().toISOString()).lastInsertRowid);
}

function markImport(
  db: Database.Database,
  importId: number,
  status: string,
  totals: Totals,
  before: Totals,
  errorMessage = ""
): void {
  db.prepare(`
    UPDATE imports SET
      status = ?, total_rows = ?, inserted_rows = ?, merged_rows = ?, conflict_rows = ?,
      error_message = ?, completed_at = ?
    WHERE id = ?
  `).run(
    status,
    totals.processedRows - before.processedRows,
    totals.insertedRows - before.insertedRows,
    totals.mergedRows - before.mergedRows,
    totals.conflictRows - before.conflictRows,
    errorMessage,
    new Date().toISOString(),
    importId
  );
}

function writeBatch(
  db: Database.Database,
  template: TemplateSummary,
  importId: number,
  sourceFile: string,
  rows: Array<{ rowNumber: number; values: string[] }>,
  mapping: number[],
  totals: Totals
): void {
  const keys = template.columns.map((column) => column.key);
  const placeholders = keys.map(() => "?").join(", ");
  const insertRecord = db.prepare(`
    INSERT INTO records(
      dedupe_key_hash, row_hash, search_text, first_imported_at, last_imported_at,
      ${keys.map(safeColumn).join(", ")}
    ) VALUES (?, ?, ?, ?, ?, ${placeholders})
  `);
  const findRecord = db.prepare(`SELECT * FROM records WHERE dedupe_key_hash = ?`);
  const findVersion = db.prepare("SELECT id FROM record_versions WHERE record_id = ? AND row_hash = ?");
  const insertVersion = db.prepare(`
    INSERT INTO record_versions(record_id, row_hash, values_json, first_import_id, first_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertOccurrence = db.prepare(`
    INSERT INTO record_occurrences(record_id, version_id, import_id, source_file, row_number, imported_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const sourceExists = db.prepare(`
    SELECT 1 FROM record_occurrences WHERE record_id = ? AND import_id = ? LIMIT 1
  `);
  const updateDuplicate = db.prepare(`
    UPDATE records SET
      is_merged = 1,
      occurrence_count = occurrence_count + 1,
      source_file_count = source_file_count + ?,
      has_conflict = MAX(has_conflict, ?),
      version_count = version_count + ?,
      search_text = ?,
      last_imported_at = ?
    WHERE id = ?
  `);
  const insertConflict = db.prepare(`
    INSERT OR IGNORE INTO record_conflicts(
      record_id, import_id, column_index, existing_value, incoming_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const values = mapping.map((incomingIndex) => cleanCell(row.values[incomingIndex]));
      if (!values.some(Boolean)) continue;
      totals.processedRows += 1;
      const now = new Date().toISOString();
      const contentHash = rowHash(values);
      const identityHash = dedupeHash(values, template.dedupeColumnIndexes);
      const record: any = findRecord.get(identityHash);
      if (!record) {
        const recordId = Number(insertRecord.run(
          identityHash,
          contentHash,
          buildSearchText(values),
          now,
          now,
          ...values
        ).lastInsertRowid);
        const versionId = Number(insertVersion.run(
          recordId,
          contentHash,
          JSON.stringify(values),
          importId,
          now
        ).lastInsertRowid);
        insertOccurrence.run(recordId, versionId, importId, sourceFile, row.rowNumber, now);
        totals.insertedRows += 1;
        continue;
      }

      const existingValues = template.columns.map((column) => String(record[column.key] ?? ""));
      const differentColumns = existingValues
        .map((value, index) => normalizeForComparison(value) === normalizeForComparison(values[index]) ? -1 : index)
        .filter((index) => index >= 0);
      const conflict = differentColumns.length > 0;
      let version: any = findVersion.get(record.id, contentHash);
      let newVersion = 0;
      if (!version) {
        const versionId = Number(insertVersion.run(
          record.id,
          contentHash,
          JSON.stringify(values),
          importId,
          now
        ).lastInsertRowid);
        version = { id: versionId };
        newVersion = 1;
      }
      const newSource = sourceExists.get(record.id, importId) ? 0 : 1;
      const additionalSearch = conflict
        ? `${record.search_text}\n${values.filter((value) => value && !record.search_text.includes(value)).join("\n")}`
        : record.search_text;
      updateDuplicate.run(newSource, conflict ? 1 : 0, newVersion, additionalSearch, now, record.id);
      insertOccurrence.run(record.id, version.id, importId, sourceFile, row.rowNumber, now);
      if (conflict) {
        for (const columnIndex of differentColumns) {
          insertConflict.run(
            record.id,
            importId,
            columnIndex,
            existingValues[columnIndex],
            values[columnIndex],
            now
          );
        }
        totals.conflictRows += 1;
      }
      totals.mergedRows += 1;
    }
  })();
}

function safeColumn(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error("Unsafe database identifier.");
  return `"${value}"`;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
