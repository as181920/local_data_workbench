import test from "node:test";
import assert from "node:assert/strict";
import {
  buildColumns,
  cleanCell,
  dedupeHash,
  findHeaderRow,
  normalizeHeader,
  rowHash,
  schemaFingerprint
} from "../dist-electron/services/core/normalization.js";

test("normalizes headers and preserves safe cell text", () => {
  assert.equal(normalizeHeader("  主键\u3000id\r\n"), "主键 id");
  assert.equal(cleanCell("  001234  "), "001234");
  assert.equal(cleanCell("第一行\r\n第二行"), "第一行\n第二行");
});

test("finds the most likely header and builds stable columns", () => {
  const rows = [
    ["数据导出", "", ""],
    ["编号", "内容", "内容"],
    ["001", "老人服务", "完成"]
  ];
  assert.equal(findHeaderRow(rows), 2);
  const columns = buildColumns(rows[1], [rows[2]]);
  assert.deepEqual(columns.map((item) => item.name), ["编号", "内容", "内容 (2)"]);
  assert.deepEqual(columns.map((item) => item.key), ["c_001", "c_002", "c_003"]);
});

test("hashes normalized content deterministically", () => {
  assert.equal(schemaFingerprint(["编号", " 内容 "]), schemaFingerprint(["编号", "内容"]));
  assert.equal(rowHash(["a  b", "1"]), rowHash(["a b", "1"]));
  assert.equal(dedupeHash(["001", "old"], [0]), dedupeHash(["001", "new"], [0]));
  assert.notEqual(dedupeHash(["", "old"], [0]), dedupeHash(["", "new"], [0]));
});
