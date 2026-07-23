import { appendFileSync, mkdirSync, statSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

export const DEBUG_ENV_NAME = "LOCAL_DATA_WORKBENCH_DEBUG";
const MAX_LOG_BYTES = 10 * 1024 * 1024;
let debugLogFile: string | null = null;

export function isDebugLoggingEnabled(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return environment[DEBUG_ENV_NAME] === "1";
}

export function configureDebugLogging(storageRoot: string): string | null {
  debugLogFile = null;
  if (!isDebugLoggingEnabled()) return null;

  try {
    const logDirectory = path.join(storageRoot, "logs");
    mkdirSync(logDirectory, { recursive: true });
    debugLogFile = path.join(logDirectory, "debug.log");
    rotateLogIfNeeded(debugLogFile);
    debugLog("logger", "debug logging enabled", {
      logFile: debugLogFile,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch
    });
  } catch (error) {
    debugLogFile = null;
    console.error("[Local Data Workbench Debug] Failed to initialize file logging:", error);
  }
  return debugLogFile;
}

export function debugLog(scope: string, message: string, data?: unknown): void {
  if (!isDebugLoggingEnabled()) return;
  const suffix = data === undefined ? "" : ` ${serialize(data)}`;
  const line = `${new Date().toISOString()} [pid:${process.pid}] [${scope}] ${message}${suffix}`;
  console.info(line);
  if (!debugLogFile) return;
  try {
    appendFileSync(debugLogFile, `${line}\n`, "utf8");
  } catch (error) {
    console.error("[Local Data Workbench Debug] Failed to write debug log:", error);
  }
}

export function debugError(scope: string, message: string, error: unknown, data?: unknown): void {
  debugLog(scope, message, {
    ...asObject(data),
    error: errorDetails(error)
  });
}

function rotateLogIfNeeded(filePath: string): void {
  try {
    if (statSync(filePath).size < MAX_LOG_BYTES) return;
    const previous = path.join(path.dirname(filePath), "debug.previous.log");
    rmSync(previous, { force: true });
    renameSync(filePath, previous);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (entry instanceof Error) return errorDetails(entry);
      if (typeof entry === "bigint") return entry.toString();
      return entry;
    });
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { context: value };
}
