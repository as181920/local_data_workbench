import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import electronPath from "electron";

const compile = spawnSync("node_modules/.bin/tsc", ["-p", "tsconfig.electron.json"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const tests = readdirSync("tests")
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => join("tests", file));

for (const file of tests) {
  const result = spawnSync(electronPath, [
    ...process.argv.slice(2),
    file
  ], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
