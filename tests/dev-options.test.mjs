import test from "node:test";
import assert from "node:assert/strict";
import { parseDevOptions } from "../scripts/dev-options.mjs";

test("uses port 5173 by default", () => {
  const options = parseDevOptions([]);
  assert.equal(options.port, 5173);
  assert.equal(options.devServerUrl, "http://127.0.0.1:5173");
  assert.deepEqual(options.viteArgs.slice(-5), [
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort"
  ]);
});

test("accepts common custom port forms and forwards other Vite options", () => {
  assert.equal(parseDevOptions(["--port", "5174"]).port, 5174);
  assert.equal(parseDevOptions(["--port=5175"]).port, 5175);
  assert.equal(parseDevOptions(["-p", "5176"]).port, 5176);
  assert.equal(parseDevOptions(["-p=5177"]).port, 5177);
  assert.deepEqual(parseDevOptions(["--clearScreen", "false", "--port", "5178"]).viteArgs.slice(0, 2), [
    "--clearScreen",
    "false"
  ]);
});

test("rejects missing and invalid ports", () => {
  assert.throws(() => parseDevOptions(["--port"]), /requires a port number/);
  assert.throws(() => parseDevOptions(["--port", "abc"]), /Invalid development server port/);
  assert.throws(() => parseDevOptions(["--port", "70000"]), /between 1 and 65535/);
});
