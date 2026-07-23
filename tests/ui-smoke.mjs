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
  const columns = Array.from({ length: 36 }, (_, index) => ({
    index,
    key: `c_${String(index + 1).padStart(3, "0")}`,
    name: `字段 ${index + 1}`,
    normalizedName: `字段 ${index + 1}`,
    kind: "text"
  }));
  const record = {
    id: 81064,
    values: columns.map((column) => `${column.name}的较长详情内容，用于验证记录抽屉内部滚动。`),
    isMerged: true,
    occurrenceCount: 3,
    sourceFileCount: 2,
    hasConflict: false,
    versionCount: 1,
    firstImportedAt: new Date(0).toISOString(),
    lastImportedAt: new Date(0).toISOString()
  };
  ipcMain.handle("templates:list", () => [{
    id: "11111111-1111-4111-8111-111111111111",
    name: "示例模板",
    description: "",
    sheetName: "数据",
    headerRow: 1,
    schemaFingerprint: "0".repeat(64),
    dedupeColumnIndexes: [0],
    columns,
    dataFilePath: "/tmp/example.sqlite",
    dataFileExists: true,
    recordCount: 0,
    mergedCount: 0,
    conflictCount: 0,
    importCount: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  }]);
  ipcMain.handle("data:query", () => ({ rows: [record], total: 1, page: 1, pageSize: 50 }));
  ipcMain.handle("data:export", () => ({
    filePath: "/tmp/示例模板-导出.xlsx",
    exportedCount: 1
  }));
  ipcMain.handle("data:detail", () => ({
    record,
    versions: [{ id: 1, values: record.values, firstSeenAt: new Date(0).toISOString() }],
    occurrences: [],
    conflicts: []
  }));
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
    assert(state.text.includes("示例模板"), "template list is missing");

    const image = await window.webContents.capturePage();
    assert(!image.isEmpty(), "captured UI image is empty");
    writeFileSync(screenshotPath, image.toPNG());

    await window.webContents.executeJavaScript(`
      document.querySelector(".template-card")?.click()
    `);
    await new Promise((resolveReady) => setTimeout(resolveReady, 100));
    const keywordModes = await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll(".keyword-mode option")).map(
        (option) => ({ value: option.value, text: option.textContent })
      )
    `);
    assert(keywordModes.length === 2, "keyword mode selector is missing");
    assert(keywordModes[0]?.value === "or", "OR keyword mode is not the default option");
    assert(keywordModes[1]?.value === "and", "AND keyword mode is not available");
    const exportAction = await window.webContents.executeJavaScript(`
      (() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (item) => item.textContent?.includes("导出匹配记录")
        )
        button?.click()
        return Boolean(button) && !button.disabled
      })()
    `);
    assert(exportAction, "filtered result export action is missing or disabled");
    await new Promise((resolveReady) => setTimeout(resolveReady, 100));
    const exportStatus = await window.webContents.executeJavaScript(`
      document.querySelector(".export-status")?.textContent
    `);
    assert(exportStatus?.includes("已导出 1 条"), "export completion status is missing");

    const actionVisible = await window.webContents.executeJavaScript(`
      (() => {
        const action = document.querySelector('[title="修改模板名称"]')
        action?.click()
        return Boolean(action)
      })()
    `);
    assert(actionVisible, "rename template action is missing");
    await new Promise((resolveReady) => setTimeout(resolveReady, 100));
    const inputValue = await window.webContents.executeJavaScript(`
      document.querySelector(".template-name-editor input")?.value
    `);
    assert(inputValue === "示例模板", "rename editor did not open");

    await window.webContents.executeJavaScript(`
      document.querySelector('[title="取消修改"]')?.click()
      document.querySelector(".data-table tbody tr")?.click()
    `);
    await new Promise((resolveReady) => setTimeout(resolveReady, 100));
    const drawerScroll = await window.webContents.executeJavaScript(`
      (() => {
        const body = document.querySelector(".drawer-body")
        if (!body) return { exists: false }
        body.scrollTop = 160
        return {
          exists: true,
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          scrollTop: body.scrollTop,
          pageOverflow: document.body.style.overflow
        }
      })()
    `);
    assert(drawerScroll.exists, "record detail drawer did not open");
    assert(drawerScroll.scrollHeight > drawerScroll.clientHeight, "record detail body is not independently scrollable");
    assert(drawerScroll.scrollTop > 0, "record detail body did not scroll");
    assert(drawerScroll.pageOverflow === "hidden", "background page scroll was not locked");

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
