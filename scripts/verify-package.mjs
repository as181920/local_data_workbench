import { accessSync } from "node:fs";
import { join, resolve } from "node:path";
import { listPackage, statFile } from "@electron/asar";

const packageRoot = resolve(process.argv[2] || "release/linux-unpacked");
const asarPath = join(packageRoot, "resources", "app.asar");
accessSync(asarPath);

const entries = new Set(listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, "").replaceAll("\\", "/")));
const required = [
  "dist/index.html",
  "dist-electron/electron/main.js",
  "dist-electron/electron/preload.cjs",
  "dist-electron/electron/workers/importWorker.js",
  "dist-electron/services/core/debug.js",
  "dist-electron/services/database/storage.js",
  "dist-electron/services/import/importer.js",
  "dist-electron/shared/constants.js",
  "node_modules/better-sqlite3/lib/index.js",
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  "node_modules/xlsx/xlsx.mjs"
];

for (const entry of required) {
  if (!entries.has(entry)) throw new Error(`Packaged app is missing ${entry}`);
}

const nativeEntry = "node_modules/better-sqlite3/build/Release/better_sqlite3.node";
if (!statFile(asarPath, nativeEntry).unpacked) {
  throw new Error(`${nativeEntry} must be unpacked from ASAR.`);
}
accessSync(join(`${asarPath}.unpacked`, ...nativeEntry.split("/")));
console.log(`Verified packaged app at ${packageRoot}`);
