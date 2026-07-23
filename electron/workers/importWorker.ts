import type { ImportRequest, TemplateSummary } from "../../shared/types.js";
import { importWorkbooks } from "../../services/import/importer.js";
import {
  configureDebugLogging,
  debugError,
  debugLog
} from "../../services/core/debug.js";

interface StartMessage {
  type: "start";
  payload: {
    storageRoot: string;
    template: TemplateSummary;
    request: ImportRequest;
    jobId: string;
  };
}

let cancelled = false;
const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error("Import worker must run as an Electron utility process.");
}

parentPort.on("message", async (event) => {
  const message = event.data as StartMessage | { type: "cancel" };
  if (message.type === "cancel") {
    cancelled = true;
    debugLog("import-worker", "cancellation requested");
    return;
  }
  if (message.type !== "start") return;
  configureDebugLogging(message.payload.storageRoot);
  debugLog("import-worker", "job received", {
    jobId: message.payload.jobId,
    templateId: message.payload.template.id,
    fileCount: message.payload.request.filePaths.length
  });
  try {
    const result = await importWorkbooks({
      storageRoot: message.payload.storageRoot,
      template: message.payload.template,
      filePaths: message.payload.request.filePaths,
      jobId: message.payload.jobId,
      isCancelled: () => cancelled,
      onProgress: (progress) => parentPort.postMessage({ type: "progress", progress })
    });
    parentPort.postMessage({ type: "done", result });
  } catch (error) {
    debugError("import-worker", "job failed", error, {
      jobId: message.payload.jobId,
      templateId: message.payload.template.id
    });
    parentPort.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
