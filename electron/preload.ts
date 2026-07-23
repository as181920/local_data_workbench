import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateTemplateInput,
  ImportProgress,
  ImportRequest,
  QueryRequest,
  WorkbookPreview,
  WorkbenchApi
} from "../shared/types.js";

const invoke = <T>(channel: string, payload?: unknown): Promise<T> => ipcRenderer.invoke(channel, payload);

const api: WorkbenchApi = {
  appVersion: () => invoke("app:version"),
  storage: {
    openDirectory: () => invoke("storage:openDirectory")
  },
  templates: {
    list: () => invoke("templates:list"),
    preview: () => invoke("templates:preview"),
    previewSheet: (filePath: string, sheetName: string): Promise<WorkbookPreview> =>
      invoke("templates:previewSheet", { filePath, sheetName }),
    create: (input: CreateTemplateInput) => invoke("templates:create", input),
    remove: (templateId: string) => invoke("templates:remove", { templateId }),
    pickImportFiles: () => invoke("templates:pickImportFiles")
  },
  imports: {
    start: (request: ImportRequest) => invoke("imports:start", request),
    cancel: (jobId: string) => invoke("imports:cancel", { jobId }),
    history: (templateId: string) => invoke("imports:history", { templateId }),
    onProgress: (callback: (progress: ImportProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => callback(progress);
      ipcRenderer.on("imports:progress", listener);
      return () => ipcRenderer.removeListener("imports:progress", listener);
    }
  },
  data: {
    query: (request: QueryRequest) => invoke("data:query", request),
    detail: (templateId: string, recordId: number) => invoke("data:detail", { templateId, recordId }),
    export: (request: QueryRequest) => invoke("data:export", request)
  }
};

contextBridge.exposeInMainWorld("workbench", api);
