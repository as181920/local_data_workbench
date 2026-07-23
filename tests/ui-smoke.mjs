import { app, BrowserWindow, ipcMain } from "electron";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

app.commandLine.appendSwitch("disable-gpu");

const screenshotPath = resolve(process.argv[2] || "/tmp/local-data-workbench-ui-smoke.png");
const timeout = setTimeout(() => {
  console.error("UI smoke test timed out.");
  app.exit(1);
}, 20_000);

app.whenReady().then(async () => {
  ipcMain.handle("templates:list", () => []);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: resolve("dist-electron/electron/preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  try {
    await window.loadFile(resolve("dist/index.html"));
    await new Promise((resolveReady) => setTimeout(resolveReady, 300));
    const state = await window.webContents.executeJavaScript(`
      ({
        bridgeReady: typeof window.workbench === "object",
        text: document.body.innerText,
        rootChildren: document.getElementById("root")?.children.length ?? 0
      })
    `);
    assert(state.bridgeReady, "preload bridge was not injected");
    assert(state.rootChildren > 0, "React root is empty");
    assert(state.text.includes("本地数据工作台"), "application heading is missing");
    assert(state.text.includes("新建数据模板"), "template creation action is missing");

    const image = await window.webContents.capturePage();
    assert(!image.isEmpty(), "captured UI image is empty");
    writeFileSync(screenshotPath, image.toPNG());
    console.log(`UI smoke test passed. Screenshot: ${screenshotPath}`);
    clearTimeout(timeout);
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    window.destroy();
    app.exit(1);
  }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
