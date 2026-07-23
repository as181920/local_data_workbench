import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type {
  CreateTemplateInput,
  DataFilter,
  DataRecord,
  ImportHistory,
  QueryRequest,
  QueryResult,
  RecordDetail,
  TemplateColumn,
  TemplateSummary
} from "../../shared/types.js";

const CATALOG_FILE = "catalog.sqlite";

export function ensureStorage(storageRoot: string): void {
  mkdirSync(path.join(storageRoot, "templates"), { recursive: true });
  const db = openCatalog(storageRoot);
  db.close();
}

function configure(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
}

function openCatalog(storageRoot: string): Database.Database {
  mkdirSync(storageRoot, { recursive: true });
  const db = new Database(path.join(storageRoot, CATALOG_FILE));
  configure(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      db_file TEXT NOT NULL UNIQUE,
      sheet_name TEXT NOT NULL,
      header_row INTEGER NOT NULL,
      schema_fingerprint TEXT NOT NULL,
      columns_json TEXT NOT NULL,
      dedupe_columns_json TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      merged_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      import_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export function templateDbPath(storageRoot: string, templateId: string): string {
  assertTemplateId(templateId);
  return path.join(storageRoot, "templates", `${templateId}.sqlite`);
}

export function openTemplateDatabase(storageRoot: string, templateId: string, readonly = false): Database.Database {
  const file = templateDbPath(storageRoot, templateId);
  const db = new Database(file, readonly ? { readonly: true, fileMustExist: true } : undefined);
  configure(db);
  return db;
}

function assertTemplateId(value: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid template ID.");
}

function mapTemplate(row: any, storageRoot: string): TemplateSummary {
  const dataFilePath = templateDbPath(storageRoot, row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sheetName: row.sheet_name,
    headerRow: row.header_row,
    schemaFingerprint: row.schema_fingerprint,
    dedupeColumnIndexes: JSON.parse(row.dedupe_columns_json),
    columns: JSON.parse(row.columns_json),
    dataFilePath,
    dataFileExists: existsSync(dataFilePath),
    recordCount: row.record_count,
    mergedCount: row.merged_count,
    conflictCount: row.conflict_count,
    importCount: row.import_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listTemplates(storageRoot: string): TemplateSummary[] {
  const db = openCatalog(storageRoot);
  try {
    return db.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all().map((row) => mapTemplate(row, storageRoot));
  } finally {
    db.close();
  }
}

export function getTemplate(storageRoot: string, templateId: string): TemplateSummary {
  const db = openCatalog(storageRoot);
  try {
    const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(templateId);
    if (!row) throw new Error("模板不存在或已被删除。");
    return mapTemplate(row, storageRoot);
  } finally {
    db.close();
  }
}

export function renameTemplate(
  storageRoot: string,
  templateId: string,
  name: string
): TemplateSummary {
  assertTemplateId(templateId);
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 100) {
    throw new Error("模板名称长度应为 1–100 个字符。");
  }
  const catalog = openCatalog(storageRoot);
  try {
    const result = catalog.prepare(`
      UPDATE templates SET name = ?, updated_at = ? WHERE id = ?
    `).run(normalizedName, new Date().toISOString(), templateId);
    if (!result.changes) throw new Error("模板不存在或已被删除。");
  } finally {
    catalog.close();
  }
  return getTemplate(storageRoot, templateId);
}

export function createTemplate(storageRoot: string, input: CreateTemplateInput): TemplateSummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  const dbFile = `${id}.sqlite`;
  const catalog = openCatalog(storageRoot);
  try {
    initializeTemplateDatabase(templateDbPath(storageRoot, id), {
      ...input,
      id
    });
    catalog.prepare(`
      INSERT INTO templates (
        id, name, description, db_file, sheet_name, header_row, schema_fingerprint,
        columns_json, dedupe_columns_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name.trim(),
      input.description?.trim() ?? "",
      dbFile,
      input.preview.sheetName,
      input.preview.headerRow,
      input.preview.schemaFingerprint,
      JSON.stringify(input.preview.columns),
      JSON.stringify(input.dedupeColumnIndexes),
      now,
      now
    );
    return getTemplate(storageRoot, id);
  } catch (error) {
    removeDatabaseFiles(templateDbPath(storageRoot, id));
    throw error;
  } finally {
    catalog.close();
  }
}

function initializeTemplateDatabase(
  filePath: string,
  input: CreateTemplateInput & { id: string }
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  configure(db);
  const dynamicColumns = input.preview.columns
    .map((column) => `${safeColumn(column.key)} TEXT NOT NULL DEFAULT ''`)
    .join(",\n");
  try {
    db.exec(`
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE columns (
        column_index INTEGER PRIMARY KEY,
        column_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        kind TEXT NOT NULL
      );
      CREATE TABLE imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        total_rows INTEGER NOT NULL DEFAULT 0,
        inserted_rows INTEGER NOT NULL DEFAULT 0,
        merged_rows INTEGER NOT NULL DEFAULT 0,
        conflict_rows INTEGER NOT NULL DEFAULT 0,
        error_message TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX imports_file_hash_idx ON imports(file_hash, status);
      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key_hash TEXT NOT NULL UNIQUE,
        row_hash TEXT NOT NULL,
        search_text TEXT NOT NULL,
        is_merged INTEGER NOT NULL DEFAULT 0,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        source_file_count INTEGER NOT NULL DEFAULT 1,
        has_conflict INTEGER NOT NULL DEFAULT 0,
        version_count INTEGER NOT NULL DEFAULT 1,
        first_imported_at TEXT NOT NULL,
        last_imported_at TEXT NOT NULL,
        ${dynamicColumns}
      );
      CREATE INDEX records_merged_idx ON records(is_merged);
      CREATE INDEX records_conflict_idx ON records(has_conflict);
      CREATE INDEX records_last_imported_idx ON records(last_imported_at);
      CREATE TABLE record_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        row_hash TEXT NOT NULL,
        values_json TEXT NOT NULL,
        first_import_id INTEGER NOT NULL REFERENCES imports(id),
        first_seen_at TEXT NOT NULL,
        UNIQUE(record_id, row_hash)
      );
      CREATE TABLE record_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        version_id INTEGER NOT NULL REFERENCES record_versions(id),
        import_id INTEGER NOT NULL REFERENCES imports(id),
        source_file TEXT NOT NULL,
        row_number INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        UNIQUE(import_id, source_file, row_number)
      );
      CREATE INDEX occurrences_record_idx ON record_occurrences(record_id);
      CREATE TABLE record_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        import_id INTEGER NOT NULL REFERENCES imports(id),
        column_index INTEGER NOT NULL,
        existing_value TEXT NOT NULL,
        incoming_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(record_id, import_id, column_index, existing_value, incoming_value)
      );
      CREATE INDEX conflicts_record_idx ON record_conflicts(record_id);
      CREATE VIRTUAL TABLE records_fts USING fts5(
        search_text,
        content='records',
        content_rowid='id',
        tokenize='trigram'
      );
      CREATE TRIGGER records_ai AFTER INSERT ON records BEGIN
        INSERT INTO records_fts(rowid, search_text) VALUES (new.id, new.search_text);
      END;
      CREATE TRIGGER records_ad AFTER DELETE ON records BEGIN
        INSERT INTO records_fts(records_fts, rowid, search_text)
        VALUES('delete', old.id, old.search_text);
      END;
      CREATE TRIGGER records_au AFTER UPDATE OF search_text ON records BEGIN
        INSERT INTO records_fts(records_fts, rowid, search_text)
        VALUES('delete', old.id, old.search_text);
        INSERT INTO records_fts(rowid, search_text) VALUES (new.id, new.search_text);
      END;
    `);

    const insertMeta = db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)");
    const insertColumn = db.prepare(`
      INSERT INTO columns(column_index, column_key, display_name, normalized_name, kind)
      VALUES (?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      insertMeta.run("template_id", input.id);
      insertMeta.run("template_name", input.name);
      insertMeta.run("sheet_name", input.preview.sheetName);
      insertMeta.run("header_row", String(input.preview.headerRow));
      insertMeta.run("schema_fingerprint", input.preview.schemaFingerprint);
      insertMeta.run("dedupe_columns", JSON.stringify(input.dedupeColumnIndexes));
      for (const column of input.preview.columns) {
        insertColumn.run(column.index, column.key, column.name, column.normalizedName, column.kind);
      }
    })();

    for (const column of input.preview.columns) {
      if (input.dedupeColumnIndexes.includes(column.index) || column.kind !== "text") {
        db.exec(`CREATE INDEX ${safeColumn(`records_${column.key}_idx`)} ON records(${safeColumn(column.key)})`);
      }
    }
  } finally {
    db.close();
  }
}

export function refreshTemplateStats(storageRoot: string, templateId: string): void {
  const templateDb = openTemplateDatabase(storageRoot, templateId, true);
  let stats: any;
  try {
    stats = templateDb.prepare(`
      SELECT
        COUNT(*) AS record_count,
        COALESCE(SUM(is_merged), 0) AS merged_count,
        COALESCE(SUM(has_conflict), 0) AS conflict_count,
        (SELECT COUNT(*) FROM imports WHERE status = 'completed') AS import_count
      FROM records
    `).get();
  } finally {
    templateDb.close();
  }
  const catalog = openCatalog(storageRoot);
  try {
    catalog.prepare(`
      UPDATE templates SET
        record_count = ?, merged_count = ?, conflict_count = ?, import_count = ?, updated_at = ?
      WHERE id = ?
    `).run(
      stats.record_count,
      stats.merged_count,
      stats.conflict_count,
      stats.import_count,
      new Date().toISOString(),
      templateId
    );
  } finally {
    catalog.close();
  }
}

export function removeTemplate(storageRoot: string, templateId: string): void {
  assertTemplateId(templateId);
  const catalog = openCatalog(storageRoot);
  try {
    const result = catalog.prepare("DELETE FROM templates WHERE id = ?").run(templateId);
    if (!result.changes) throw new Error("模板不存在或已被删除。");
  } finally {
    catalog.close();
  }
  removeDatabaseFiles(templateDbPath(storageRoot, templateId));
}

function removeDatabaseFiles(filePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${filePath}${suffix}`, { force: true });
}

export function listImportHistory(storageRoot: string, templateId: string): ImportHistory[] {
  const db = openTemplateDatabase(storageRoot, templateId, true);
  try {
    return db.prepare("SELECT * FROM imports ORDER BY id DESC").all().map((row: any) => ({
      id: row.id,
      sourceFile: row.source_file,
      fileHash: row.file_hash,
      status: row.status,
      totalRows: row.total_rows,
      insertedRows: row.inserted_rows,
      mergedRows: row.merged_rows,
      conflictRows: row.conflict_rows,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at
    }));
  } finally {
    db.close();
  }
}

export function queryRecords(storageRoot: string, request: QueryRequest, includeAll = false): QueryResult {
  const template = getTemplate(storageRoot, request.templateId);
  const page = includeAll ? 1 : Math.max(1, request.page ?? 1);
  const pageSize = includeAll ? Number.MAX_SAFE_INTEGER : Math.min(200, Math.max(1, request.pageSize ?? 50));
  const { joins, where, params } = buildQueryParts(template.columns, request);
  const db = openTemplateDatabase(storageRoot, request.templateId, true);
  try {
    const countRow = db.prepare(`SELECT COUNT(*) AS count FROM records r ${joins} ${where}`).get(...params) as { count: number };
    const total = Number(countRow?.count ?? 0);
    const dynamicSelect = template.columns.map((column) => `r.${safeColumn(column.key)}`).join(", ");
    const sortColumn = request.sortColumnIndex === undefined
      ? "r.last_imported_at"
      : `r.${safeColumn(getColumn(template.columns, request.sortColumnIndex).key)}`;
    const direction = request.sortDirection === "asc" ? "ASC" : "DESC";
    const limitSql = includeAll ? "" : "LIMIT ? OFFSET ?";
    const queryParams = includeAll ? params : [...params, pageSize, (page - 1) * pageSize];
    const rows = db.prepare(`
      SELECT
        r.id, r.is_merged, r.occurrence_count, r.source_file_count, r.has_conflict,
        r.version_count, r.first_imported_at, r.last_imported_at,
        ${dynamicSelect}
      FROM records r
      ${joins}
      ${where}
      ORDER BY ${sortColumn} ${direction}, r.id DESC
      ${limitSql}
    `).all(...queryParams).map((row: any) => mapRecord(row, template.columns));
    return { rows, total, page, pageSize: includeAll ? total : pageSize };
  } finally {
    db.close();
  }
}

function buildQueryParts(columns: TemplateColumn[], request: QueryRequest): { joins: string; where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const joins = "";
  const keywords = [...new Set((request.keyword ?? "").trim().split(/\s+/).filter(Boolean))].slice(0, 20);
  if (keywords.length) {
    const keywordOperator = request.keywordMode === "and" ? " AND " : " OR ";
    const keywordClauses: string[] = [];
    for (const keyword of keywords) {
      if ([...keyword].length >= 3) {
        keywordClauses.push("r.id IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)");
        params.push(`"${keyword.replaceAll('"', '""')}"`);
      } else {
        keywordClauses.push("r.search_text LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(keyword)}%`);
      }
    }
    clauses.push(`(${keywordClauses.join(keywordOperator)})`);
  }
  if (request.mergedOnly) clauses.push("r.is_merged = 1");
  if (request.conflictOnly) clauses.push("r.has_conflict = 1");
  for (const filter of request.filters ?? []) {
    const column = getColumn(columns, filter.columnIndex);
    const expression = `r.${safeColumn(column.key)}`;
    const built = buildFilter(expression, column, filter);
    clauses.push(built.sql);
    params.push(...built.params);
  }
  return {
    joins,
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function buildFilter(expression: string, column: TemplateColumn, filter: DataFilter): { sql: string; params: unknown[] } {
  const value = filter.value ?? "";
  const comparable = column.kind === "number" ? `CAST(NULLIF(${expression}, '') AS REAL)` : expression;
  const numeric = column.kind === "number" ? Number(value) : value;
  switch (filter.operator) {
    case "contains": return { sql: `${expression} LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(value)}%`] };
    case "notContains": return { sql: `${expression} NOT LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(value)}%`] };
    case "equals": return { sql: `${expression} = ?`, params: [value] };
    case "notEquals": return { sql: `${expression} <> ?`, params: [value] };
    case "startsWith": return { sql: `${expression} LIKE ? ESCAPE '\\'`, params: [`${escapeLike(value)}%`] };
    case "endsWith": return { sql: `${expression} LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(value)}`] };
    case "empty": return { sql: `${expression} = ''`, params: [] };
    case "notEmpty": return { sql: `${expression} <> ''`, params: [] };
    case "greaterThan": return { sql: `${comparable} > ?`, params: [numeric] };
    case "greaterOrEqual": return { sql: `${comparable} >= ?`, params: [numeric] };
    case "lessThan": return { sql: `${comparable} < ?`, params: [numeric] };
    case "lessOrEqual": return { sql: `${comparable} <= ?`, params: [numeric] };
  }
}

function getColumn(columns: TemplateColumn[], index: number): TemplateColumn {
  const column = columns.find((item) => item.index === index);
  if (!column) throw new Error(`字段 ${index + 1} 不存在。`);
  return column;
}

function safeColumn(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error("Unsafe database identifier.");
  return `"${value}"`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function mapRecord(row: any, columns: TemplateColumn[]): DataRecord {
  return {
    id: row.id,
    values: columns.map((column) => String(row[column.key] ?? "")),
    isMerged: Boolean(row.is_merged),
    occurrenceCount: row.occurrence_count,
    sourceFileCount: row.source_file_count,
    hasConflict: Boolean(row.has_conflict),
    versionCount: row.version_count,
    firstImportedAt: row.first_imported_at,
    lastImportedAt: row.last_imported_at
  };
}

export function getRecordDetail(storageRoot: string, templateId: string, recordId: number): RecordDetail {
  const template = getTemplate(storageRoot, templateId);
  const db = openTemplateDatabase(storageRoot, templateId, true);
  try {
    const dynamicSelect = template.columns.map((column) => `r.${safeColumn(column.key)}`).join(", ");
    const row = db.prepare(`
      SELECT r.*, ${dynamicSelect} FROM records r WHERE r.id = ?
    `).get(recordId);
    if (!row) throw new Error("记录不存在或已被删除。");
    const versions = db.prepare(`
      SELECT id, values_json, first_seen_at FROM record_versions
      WHERE record_id = ? ORDER BY id DESC
    `).all(recordId).map((item: any) => ({
      id: item.id,
      values: JSON.parse(item.values_json),
      firstSeenAt: item.first_seen_at
    }));
    const occurrences = db.prepare(`
      SELECT id, source_file, row_number, imported_at, version_id
      FROM record_occurrences WHERE record_id = ? ORDER BY id DESC
    `).all(recordId).map((item: any) => ({
      id: item.id,
      sourceFile: item.source_file,
      rowNumber: item.row_number,
      importedAt: item.imported_at,
      versionId: item.version_id
    }));
    const conflicts = db.prepare(`
      SELECT c.column_index, cols.display_name, c.existing_value, c.incoming_value, c.created_at
      FROM record_conflicts c
      JOIN columns cols ON cols.column_index = c.column_index
      WHERE c.record_id = ? ORDER BY c.id DESC
    `).all(recordId).map((item: any) => ({
      columnIndex: item.column_index,
      columnName: item.display_name,
      existingValue: item.existing_value,
      incomingValue: item.incoming_value,
      createdAt: item.created_at
    }));
    return { record: mapRecord(row, template.columns), versions, occurrences, conflicts };
  } finally {
    db.close();
  }
}
