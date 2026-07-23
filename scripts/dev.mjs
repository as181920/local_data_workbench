import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import electronPath from "electron";
import { parseDevOptions } from "./dev-options.mjs";

let options;
try {
  options = parseDevOptions(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

rmSync("dist-electron", { recursive: true, force: true });
const compile = spawnSync("node_modules/.bin/tsc", ["-p", "tsconfig.electron.json"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const vite = spawn("node_modules/.bin/vite", options.viteArgs, {
  stdio: "inherit",
  shell: process.platform === "win32"
});
let electron = null;
let viteExited = false;

const stop = () => {
  if (!vite.killed) vite.kill("SIGTERM");
  if (electron && !electron.killed) electron.kill("SIGTERM");
};

vite.on("exit", (code) => {
  viteExited = true;
  if (electron && !electron.killed) electron.kill("SIGTERM");
  if (!electron) process.exit(code ?? 0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  await waitForVite(options.devServerUrl, () => viteExited);
  if (!viteExited) {
    console.log(`Starting Local Data Workbench at ${options.devServerUrl}`);
    electron = spawn(electronPath, ["."], {
      stdio: "inherit",
      env: { ...process.env, VITE_DEV_SERVER_URL: options.devServerUrl }
    });
    electron.on("exit", (code) => {
      stop();
      process.exit(code ?? 0);
    });
  }
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function waitForVite(url, hasExited) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (hasExited()) throw new Error("Vite exited before the development server became ready.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite at ${url}.`);
}
