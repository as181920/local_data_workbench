import ExcelJS from "exceljs";
import type { QueryRequest, TemplateSummary } from "../../shared/types.js";
import { queryRecords } from "../database/storage.js";

export async function exportQueryToWorkbook(
  storageRoot: string,
  template: TemplateSummary,
  request: QueryRequest,
  outputPath: string
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: outputPath,
    useStyles: false,
    useSharedStrings: false
  });
  const sheet = workbook.addWorksheet(safeSheetName(template.name));
  sheet.addRow([
    ...template.columns.map((column) => column.name),
    "是否合并",
    "出现次数",
    "来源文件数",
    "是否冲突",
    "版本数"
  ]).commit();

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
