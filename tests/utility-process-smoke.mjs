import { app, utilityProcess } from "electron";
import * as XLSX from "xlsx";
import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTemplate, queryRecords } from "../dist-electron/services/database/storage.js";
import { previewWorkbook } from "../dist-electron/services/excel/workbook.js";

XLSX.set_fs(fs);

const timeout = setTimeout(() => {
  console.error("Utility process smoke test timed out.");
  app.exit(1);
}, 20_000);

app.whenReady().then(() => {
  const root = mkdtempSync(join(tmpdir(), "ldw-utility-"));
  const workbookPath = join(root, "utility.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["主键id", "内容"],
      ["1", "老人家服务"],
      ["1", "老人家服务"]
    ]),
    "数据"
  );
  XLSX.writeFile(workbook, workbookPath);
  const preview = previewWorkbook(workbookPath);
  const template = createTemplate(root, {
    name: "Utility smoke",
    preview,
    dedupeColumnIndexes: [0]
  });
  const child = utilityProcess.fork(
    resolve("dist-electron/electron/workers/importWorker.js"),
    [],
    { serviceName: "Utility process smoke" }
  );
  child.on("message", (message) => {
    if (message?.type === "error") {
      console.error(message.message);
      clearTimeout(timeout);
      rmSync(root, { recursive: true, force: true });
      app.exit(1);
    }
    if (message?.type !== "done") return;
    const result = queryRecords(root, { templateId: template.id });
    const valid = result.total === 1 && result.rows[0]?.occurrenceCount === 2;
    console.log(valid ? "Utility process smoke test passed." : "Unexpected import result.");
    clearTimeout(timeout);
    child.kill();
    rmSync(root, { recursive: true, force: true });
    app.exit(valid ? 0 : 1);
  });
  child.postMessage({
    type: "start",
    payload: {
      storageRoot: root,
      template,
      request: { templateId: template.id, filePaths: [workbookPath] },
      jobId: "utility-smoke"
    }
  });
});
