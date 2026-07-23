import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("builds the sandbox preload as CommonJS and points Electron to it", () => {
  const preloadPath = "dist-electron/electron/preload.cjs";
  assert.equal(existsSync(preloadPath), true, "preload.cjs must be generated");
  const preload = readFileSync(preloadPath, "utf8");
  const main = readFileSync("dist-electron/electron/main.js", "utf8");
  assert.match(preload, /"use strict"/);
  assert.match(preload, /require\("electron"\)/);
  assert.match(main, /preload\.cjs/);
});
