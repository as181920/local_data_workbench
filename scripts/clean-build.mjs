import { rmSync } from "node:fs";

for (const directory of ["dist", "dist-electron"]) {
  rmSync(directory, { recursive: true, force: true });
}
