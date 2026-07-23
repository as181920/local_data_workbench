import ExcelJS from "exceljs";
import type { QueryRequest, TemplateSummary } from "../../shared/types.js";
import { queryRecords } from "../database/storage.js";

export async function exportQueryToWorkbook(
  storageRoot: string,
  template: TemplateSummary,
  request: QueryRequest,
  outputPath: string
): Promise<number> {
  const headers = [
    ...template.columns.map((column) => column.name),
    "是否合并",
    "出现次数",
    "来源文件数",
    "是否冲突",
    "版本数"
  ];
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: outputPath,
    useStyles: true,
    useSharedStrings: false
  });
  const sheet = workbook.addWorksheet(safeSheetName(template.name), {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = headers.map((header, index) => ({
    key: `column_${index}`,
    width: Math.min(36, Math.max(12, [...header].length + 4))
  }));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FF344054" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F7" } };
  headerRow.commit();

  let page = 1;
  let exported = 0;
  while (true) {
    const result = queryRecords(storageRoot, {
      ...request,
      page,
      pageSize: 200
    });
    for (const record of result.rows) {
      sheet.addRow([
        ...record.values,
        record.isMerged ? "是" : "否",
        record.occurrenceCount,
        record.sourceFileCount,
        record.hasConflict ? "是" : "否",
        record.versionCount
      ]).commit();
      exported += 1;
    }
    if (page * result.pageSize >= result.total) break;
    page += 1;
  }
  sheet.commit();
  await workbook.commit();
  return exported;
}

function safeSheetName(value: string): string {
  return value.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "数据";
}
