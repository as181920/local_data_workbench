import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTemplate,
  ensureStorage,
  getRecordDetail,
  getTemplate,
  listImportHistory,
  listTemplates,
  queryRecords,
  removeTemplate
} from "../services/database/storage.js";
import { exportQueryToWorkbook } from "../services/excel/export.js";
import { previewWorkbook } from "../services/excel/workbook.js";
import {
  configureDebugLogging,
  debugError,
  debugLog
} from "../services/core/debug.js";
import {
  createTemplateSchema,
  importRequestSchema,
  queryRequestSchema,
  templateIdSchema
} from "../shared/schemas.js";
import type { ImportProgress } from "../shared/types.js";
import { APP_DATA_DIRECTORY } from "../shared/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const importJobs = new Map<string, Electron.UtilityProcess>();
let mainWindow: BrowserWindow | null = null;
let storageRoot = "";

app.setPath("userData", path.join(app.getPath("appData"), APP_DATA_DIRECTORY));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: "本地数据工作台",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    debugError("renderer", "preload failed", error, { preloadPath });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    debugLog("renderer", "render process gone", details);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    debugLog("renderer", "page failed to load", { code, description, url });
  });
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "warning" || details.level === "error") {
      debugLog("renderer-console", details.message, {
        level: details.level,
        line: details.lineNumber,
        sourceId: details.sourceId
      });
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev ? url.startsWith(process.env.VITE_DEV_SERVER_URL!) : url.startsWith("file:");
    if (!allowed) event.preventDefault();
  });
  if (isDev) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
}

app.whenReady().then(() => {
  storageRoot = path.join(app.getPath("userData"), "storage");
  const logFile = configureDebugLogging(storageRoot);
  debugLog("main", "application ready", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    storageRoot,
    logFile
  });
  ensureStorage(storageRoot);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  debugLog("main", "application quitting", { activeImportJobs: importJobs.size });
  for (const child of importJobs.values()) child.kill();
});

process.on("uncaughtExceptionMonitor", (error) => {
  debugError("main", "uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  debugError("main", "unhandled rejection", error);
  process.exit(1);
});

function registerIpc(): void {
  handle("app:version", () => app.getVersion());
  handle("storage:openDirectory", async () => {
    ensureStorage(storageRoot);
    const error = await shell.openPath(storageRoot);
    if (error) throw new Error(`无法打开数据目录：${error}`);
  });
  handle("templates:list", () => listTemplates(storageRoot));
  handle("templates:preview", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择一个或多个 Excel 文件",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "表格文件", extensions: ["xlsx", "xlsm", "xls", "xlsb", "ods", "csv"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    return {
      preview: previewWorkbook(result.filePaths[0]),
      filePaths: result.filePaths
    };
  });
  handle("templates:previewSheet", (_event, payload: unknown) => {
    const parsed = payload as { filePath: string; sheetName: string };
    return previewWorkbook(parsed.filePath, parsed.sheetName);
  });
  handle("templates:create", (_event, payload: unknown) => {
    const input = createTemplateSchema.parse(payload);
    return createTemplate(storageRoot, input);
  });
  handle("templates:remove", (_event, payload: unknown) => {
    const templateId = templateIdSchema.parse((payload as any)?.templateId);
    if ([...importJobs.keys()].some((key) => key.startsWith(`${templateId}:`))) {
      throw new Error("该模板正在导入，请先取消导入任务。");
    }
    removeTemplate(storageRoot, templateId);
  });
  handle("templates:pickImportFiles", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择要导入的 Excel 文件",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "表格文件", extensions: ["xlsx", "xlsm", "xls", "xlsb", "ods", "csv"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  handle("imports:start", (_event, payload: unknown) => {
    const request = importRequestSchema.parse(payload);
    const template = getTemplate(storageRoot, request.templateId);
    const jobId = `${template.id}:${randomUUID()}`;
    debugLog("import", "starting utility process", {
      jobId,
      templateId: template.id,
      templateName: template.name,
      fileCount: request.filePaths.length,
      filePaths: request.filePaths
    });
    const child = utilityProcess.fork(path.join(__dirname, "workers/importWorker.js"), [], {
      serviceName: `Excel import: ${template.name}`
    });
    importJobs.set(jobId, child);
    child.on("message", (message: any) => {
      if (message?.type === "progress") sendProgress(message.progress);
      if (message?.type === "done") {
        debugLog("import", "utility process completed", message.result);
        sendProgress(message.result);
        importJobs.delete(jobId);
      }
      if (message?.type === "error") {
        debugLog("import", "utility process reported failure", {
          jobId,
          message: message.message
        });
        const progress: ImportProgress = {
          jobId,
          phase: "failed",
          fileIndex: 0,
          fileCount: request.filePaths.length,
          processedRows: 0,
          insertedRows: 0,
          mergedRows: 0,
          conflictRows: 0,
          skippedFiles: 0,
          message: message.message
        };
        sendProgress(progress);
        importJobs.delete(jobId);
      }
    });
    child.on("exit", (code) => {
      debugLog("import", "utility process exited", { jobId, code });
      importJobs.delete(jobId);
    });
    child.postMessage({ type: "start", payload: { storageRoot, template, request, jobId } });
    return { jobId };
  });
  handle("imports:cancel", (_event, payload: unknown) => {
    const jobId = String((payload as any)?.jobId ?? "");
    const child = importJobs.get(jobId);
    if (child) child.postMessage({ type: "cancel" });
  });
  handle("imports:history", (_event, payload: unknown) => {
    const templateId = templateIdSchema.parse((payload as any)?.templateId);
    return listImportHistory(storageRoot, templateId);
  });
  handle("data:query", (_event, payload: unknown) => {
    const request = queryRequestSchema.parse(payload);
    return queryRecords(storageRoot, request);
  });
  handle("data:detail", (_event, payload: unknown) => {
    const templateId = templateIdSchema.parse((payload as any)?.templateId);
    const recordId = Number((payload as any)?.recordId);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) throw new Error("无效的记录 ID。");
    return getRecordDetail(storageRoot, templateId, recordId);
  });
  handle("data:export", async (_event, payload: unknown) => {
    const request = queryRequestSchema.parse(payload);
    const template = getTemplate(storageRoot, request.templateId);
    const result = await dialog.showSaveDialog({
      title: "导出查询结果",
      defaultPath: `${safeFileName(template.name)}-导出.xlsx`,
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await exportQueryToWorkbook(storageRoot, template, request, result.filePath);
    return { filePath: result.filePath };
  });
}

function handle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, payload: unknown) => unknown): void {
  ipcMain.handle(channel, async (event, payload) => {
    const startedAt = Date.now();
    debugLog("ipc", "request", { channel, payload: summarizePayload(payload) });
    try {
      const result = await handler(event, payload);
      debugLog("ipc", "completed", { channel, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugError("ipc", "failed", error, { channel, durationMs: Date.now() - startedAt });
      throw new Error(message);
    }
  });
}

function sendProgress(progress: ImportProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("imports:progress", progress);
}

function safeFileName(value: string): string {
  return [...value]
    .map((character) => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? "_" : character)
    .join("")
    .slice(0, 100) || "数据";
}

function summarizePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const value = payload as Record<string, unknown>;
  return {
    templateId: value.templateId,
    jobId: value.jobId,
    recordId: value.recordId,
    filePath: value.filePath,
    filePaths: Array.isArray(value.filePaths) ? value.filePaths : undefined,
    page: value.page,
    pageSize: value.pageSize,
    filterCount: Array.isArray(value.filters) ? value.filters.length : undefined
  };
}
