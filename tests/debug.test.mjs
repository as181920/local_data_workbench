import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEBUG_ENV_NAME,
  configureDebugLogging,
  debugError,
  debugLog,
  isDebugLoggingEnabled
} from "../dist-electron/services/core/debug.js";
import { APP_DATA_DIRECTORY } from "../dist-electron/shared/constants.js";

test("uses the stable ASCII application data directory", () => {
  assert.equal(APP_DATA_DIRECTORY, "local_data_workbench");
});

test("debug logging is opt-in and persists diagnostics under storage/logs", () => {
  const root = mkdtempSync(join(tmpdir(), "ldw-debug-"));
  const previous = process.env[DEBUG_ENV_NAME];
  try {
    delete process.env[DEBUG_ENV_NAME];
    assert.equal(isDebugLoggingEnabled(), false);
    assert.equal(configureDebugLogging(root), null);

    process.env[DEBUG_ENV_NAME] = "1";
    assert.equal(isDebugLoggingEnabled(), true);
    const logFile = configureDebugLogging(root);
    assert.equal(logFile, join(root, "logs", "debug.log"));
    debugLog("test", "sample event", { rows: 12, id: 123n });
    debugError("test", "sample failure", new Error("expected diagnostic"));

    const contents = readFileSync(logFile, "utf8");
    assert.match(contents, /\[logger\] debug logging enabled/);
    assert.match(contents, /\[test\] sample event/);
    assert.match(contents, /"rows":12/);
    assert.match(contents, /expected diagnostic/);
  } finally {
    if (previous === undefined) delete process.env[DEBUG_ENV_NAME];
    else process.env[DEBUG_ENV_NAME] = previous;
    configureDebugLogging(root);
    rmSync(root, { recursive: true, force: true });
  }
});
