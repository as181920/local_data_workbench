import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  createTemplate,
  getRecordDetail,
  listImportHistory,
  listTemplates,
  queryRecords,
  renameTemplate,
  removeTemplate,
  templateDbPath
} from "../dist-electron/services/database/storage.js";
import { exportQueryToWorkbook } from "../dist-electron/services/excel/export.js";
import { previewWorkbook } from "../dist-electron/services/excel/workbook.js";
import { importWorkbooks } from "../dist-electron/services/import/importer.js";

XLSX.set_fs(fs);

function writeWorkbook(filePath, rows, headers = ["主键id", "事件内容", "类别"]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(workbook, sheet, "数据详情");
  XLSX.writeFile(workbook, filePath);
}

test("isolated template workflow imports, merges, searches with keyword OR, filters, and deletes", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-data-workbench-"));
  try {
    const firstFile = join(root, "first.xlsx");
    writeWorkbook(firstFile, [
      ["1000000000000000001", "老人家需要帮助", "民生"],
      ["1000000000000000002", "普通记录", "其他"],
      ["1000000000000000001", "老人家需要帮助", "民生"],
      ["1000000000000000003", "大龄人口服务", "民生"],
      ["1000000000000000001", "老人需要新的帮助", "民生"]
    ]);
    const preview = previewWorkbook(firstFile);
    const template = createTemplate(root, {
      name: "工单",
      description: "测试模板",
      preview,
      dedupeColumnIndexes: [0]
    });
    const renamed = renameTemplate(root, template.id, "工单归档");
    assert.equal(renamed.name, "工单归档");
    assert.equal(listTemplates(root)[0].name, "工单归档");

    const progress = [];
    const completed = await importWorkbooks({
      storageRoot: root,
      template,
      filePaths: [firstFile],
      jobId: "test-job",
      onProgress: (item) => progress.push(item)
    });
    assert.equal(completed.phase, "completed");
    assert.equal(completed.processedRows, 5);
    assert.equal(completed.insertedRows, 3);
    assert.equal(completed.mergedRows, 2);
    assert.equal(completed.conflictRows, 1);
    assert.ok(progress.some((item) => item.phase === "writing"));

    const all = queryRecords(root, { templateId: template.id, pageSize: 50 });
    assert.equal(all.total, 3);
    const merged = all.rows.find((row) => row.values[0] === "1000000000000000001");
    assert.ok(merged);
    assert.equal(merged.isMerged, true);
    assert.equal(merged.occurrenceCount, 3);
    assert.equal(merged.versionCount, 2);
    assert.equal(merged.hasConflict, true);

    const keywordOr = queryRecords(root, {
      templateId: template.id,
      keyword: "老人家　大龄人口",
      keywordMode: "or",
      pageSize: 50
    });
    assert.equal(keywordOr.total, 2);

    const keywordAnd = queryRecords(root, {
      templateId: template.id,
      keyword: "老人家　帮助",
      keywordMode: "and",
      pageSize: 50
    });
    assert.equal(keywordAnd.total, 1);

    const keywordAndNoMatch = queryRecords(root, {
      templateId: template.id,
      keyword: "老人家 大龄人口",
      keywordMode: "and",
      pageSize: 50
    });
    assert.equal(keywordAndNoMatch.total, 0);
    const shortKeyword = queryRecords(root, {
      templateId: template.id,
      keyword: "老人",
      pageSize: 50
    });
    assert.equal(shortKeyword.total, 1);
    const filtered = queryRecords(root, {
      templateId: template.id,
      filters: [{ columnIndex: 2, operator: "equals", value: "其他" }],
      pageSize: 50
    });
    assert.equal(filtered.total, 1);

    const exportedFile = join(root, "filtered-export.xlsx");
    const exportedCount = await exportQueryToWorkbook(root, template, {
      templateId: template.id,
      filters: [{ columnIndex: 2, operator: "equals", value: "其他" }],
      pageSize: 1
    }, exportedFile);
    assert.equal(exportedCount, 1);
    assert.equal(existsSync(exportedFile), true);
    const exportedWorkbook = XLSX.readFile(exportedFile);
    const exportedRows = XLSX.utils.sheet_to_json(
      exportedWorkbook.Sheets[exportedWorkbook.SheetNames[0]],
      { header: 1, raw: false }
    );
    assert.deepEqual(exportedRows[0], [
      "主键id", "事件内容", "类别", "是否合并", "出现次数", "来源文件数", "是否冲突", "版本数"
    ]);
    assert.deepEqual(exportedRows[1], [
      "1000000000000000002", "普通记录", "其他", "否", "1", "1", "否", "1"
    ]);

    const detail = getRecordDetail(root, template.id, merged.id);
    assert.equal(detail.versions.length, 2);
    assert.equal(detail.occurrences.length, 3);
    assert.equal(detail.conflicts.length, 1);
    assert.equal(detail.conflicts[0].columnName, "事件内容");

    const history = listImportHistory(root, template.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "completed");

    const skipped = await importWorkbooks({
      storageRoot: root,
      template: listTemplates(root)[0],
      filePaths: [firstFile],
      jobId: "skip-job"
    });
    assert.equal(skipped.skippedFiles, 1);
    assert.equal(queryRecords(root, { templateId: template.id }).total, 3);

    const dbFile = templateDbPath(root, template.id);
    assert.equal(existsSync(dbFile), true);
    removeTemplate(root, template.id);
    assert.equal(existsSync(dbFile), false);
    assert.equal(listTemplates(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts reordered unique headers and rejects changed schema", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-data-workbench-schema-"));
  try {
    const baseFile = join(root, "base.xlsx");
    const reorderedFile = join(root, "reordered.xlsx");
    const nextValidFile = join(root, "next-valid.xlsx");
    const changedFile = join(root, "changed.xlsx");
    writeWorkbook(baseFile, [["1", "内容一", "A"]]);
    writeWorkbook(reorderedFile, [["内容二", "2", "B"]], ["事件内容", "主键id", "类别"]);
    writeWorkbook(nextValidFile, [["4", "本批不应写入", "C"]]);
    writeWorkbook(changedFile, [["3", "内容三", "X"]], ["主键id", "事件内容", "新增字段"]);
    const preview = previewWorkbook(baseFile);
    const template = createTemplate(root, {
      name: "结构校验",
      preview,
      dedupeColumnIndexes: [0]
    });
    await importWorkbooks({
      storageRoot: root,
      template,
      filePaths: [baseFile, reorderedFile],
      jobId: "reorder-job"
    });
    const result = queryRecords(root, { templateId: template.id, pageSize: 50 });
    assert.equal(result.total, 2);
    assert.ok(result.rows.some((row) => row.values.join("|") === "2|内容二|B"));

    await assert.rejects(
      importWorkbooks({
        storageRoot: root,
        template,
        filePaths: [nextValidFile, changedFile],
        jobId: "changed-job"
      }),
      /字段不一致/
    );
    assert.equal(
      queryRecords(root, { templateId: template.id, pageSize: 50 }).total,
      2,
      "all files must pass schema validation before any row in the batch is written"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports a manually removed template database without throwing from the catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "local-data-workbench-missing-"));
  try {
    const filePath = join(root, "sample.xlsx");
    writeWorkbook(filePath, [["1", "内容", "A"]]);
    const preview = previewWorkbook(filePath);
    const template = createTemplate(root, {
      name: "丢失文件",
      preview,
      dedupeColumnIndexes: [0]
    });
    rmSync(template.dataFilePath, { force: true });
    const listed = listTemplates(root)[0];
    assert.equal(listed.dataFileExists, false);
    assert.equal(listed.dataFilePath, template.dataFilePath);
    assert.doesNotThrow(() => removeTemplate(root, template.id));
    assert.equal(listTemplates(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
