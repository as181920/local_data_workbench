import * as XLSX from "xlsx";
import * as fs from "node:fs";
import { basename, extname } from "node:path";
import { statSync } from "node:fs";
import type { WorkbookPreview } from "../../shared/types.js";
import {
  buildColumns,
  cleanCell,
  findHeaderRow,
  normalizeHeader,
  schemaFingerprint
} from "../core/normalization.js";

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xls", ".xlsb", ".ods", ".csv"]);

XLSX.set_fs(fs);

export function assertSupportedWorkbook(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`不支持 ${extension || "未知"} 文件，请选择 xlsx、xlsm、xls、xlsb、ods 或 csv。`);
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error("选择的路径不是文件。");
}

export function previewWorkbook(filePath: string, requestedSheet?: string): WorkbookPreview {
  assertSupportedWorkbook(filePath);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(filePath, {
      sheetRows: 60,
      raw: false,
      cellDates: false,
      dense: true
    });
  } catch (error) {
    throw friendlyWorkbookError(error);
  }
  if (!workbook.SheetNames.length) throw new Error("Excel 中没有可读取的工作表。");
  const sheetName = requestedSheet && workbook.Sheets[requestedSheet]
    ? requestedSheet
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true
  });
  const rows = rawRows.map((row) => row.map(cleanCell));
  const headerRow = findHeaderRow(rows);
  const rawHeaders = rows[headerRow - 1] ?? [];
  const lastHeader = findLastNonBlank(rawHeaders);
  const headers = rawHeaders.slice(0, lastHeader + 1).map(normalizeHeader);
  if (!headers.length || headers.every((header) => !header)) {
    throw new Error("无法识别表头，请确认工作表前 20 行内存在字段名称。");
  }
  if (headers.length > 500) throw new Error("当前版本最多支持 500 个字段。");
  const previewRows = rows
    .slice(headerRow)
    .map((row) => fitRow(row, headers.length))
    .filter((row) => row.some(Boolean))
    .slice(0, 30);
  const columns = buildColumns(headers, previewRows);
  return {
    filePath,
    fileName: basename(filePath),
    sheets: workbook.SheetNames,
    sheetName,
    headerRow,
    headers,
    columns,
    schemaFingerprint: schemaFingerprint(headers),
    rows: previewRows
  };
}

export async function* readWorkbookRows(
  filePath: string,
  sheetName: string,
  headerRow: number,
  columnCount: number
): AsyncGenerator<{ rowNumber: number; values: string[] }> {
  assertSupportedWorkbook(filePath);
  let workbook: XLSX.WorkBook;
  try {
    // Parsing happens in an isolated utility process. SheetJS is used for all
    // formats because ExcelJS's streaming reader may corrupt UTF-8 characters
    // split across XML chunks in some large Chinese workbooks.
    workbook = XLSX.readFile(filePath, { raw: false, cellDates: false, dense: false });
  } catch (error) {
    throw friendlyWorkbookError(error);
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`文件中不存在工作表“${sheetName}”。`);
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  for (let index = headerRow; index <= range.e.r; index += 1) {
    const values = Array.from({ length: columnCount }, (_, columnIndex) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: index, c: columnIndex })];
      if (!cell) return "";
      return cleanCell(cell.w ?? XLSX.utils.format_cell(cell) ?? cell.v);
    });
    if (values.some(Boolean)) yield { rowNumber: index + 1, values };
    if (index % 1_000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function fitRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => cleanCell(row[index]));
}

function findLastNonBlank(row: string[]): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (normalizeHeader(row[index])) return index;
  }
  return -1;
}

function friendlyWorkbookError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypt|protected/i.test(message)) {
    return new Error("当前版本不支持密码保护的 Excel，请解除密码后重新导入。");
  }
  return new Error(`Excel 读取失败：${message}`);
}
