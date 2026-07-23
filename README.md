# 本地数据工作台

面向不同业务 Excel 的本地桌面数据工具。每个模板使用独立 SQLite 文件，支持多文件导入、清洗、业务键去重、来源与版本追溯、中文多关键词搜索、动态字段过滤和 Excel 导出。

## 主要能力

- 从 `.xlsx`、`.xlsm`、`.xls`、`.xlsb`、`.ods`、`.csv` 创建模板
- 新建模板时可一次选择多个文件，以第一份创建结构，整批字段校验通过后统一导入
- 自动识别工作表、表头行、字段名称和基础类型
- 后续文件严格校验字段；唯一字段可安全处理列顺序变化
- 每个模板拥有独立 SQLite，数据和业务互不混合
- 独立 utility process 导入，大文件处理不阻塞 Electron 主界面
- Excel 在独立进程中逐文件解析、逐行取值，1,000 行一批写入；不会阻塞主界面
- 业务唯一键去重；未配置唯一键时按标准化整行去重
- 合并标记、出现次数、来源文件、内容版本和字段冲突
- 中文 FTS5 trigram 搜索；多个空白分隔关键词使用 OR 语义
- 1–2 字短关键词自动回退到包含查询
- 动态字段包含、等于、空值、范围等过滤
- 查询结果流式导出为 `.xlsx`
- Windows portable/NSIS、Linux x64/arm64 AppImage 配置

## 本地开发

要求 Node.js 24。

```bash
npm install
npm run dev
```

开发服务器默认使用 `5173`。端口被占用或需要并行启动时，可以显式指定其他本地端口：

```bash
npm run dev -- --port 5174

# 同时开启 Debug 日志
LOCAL_DATA_WORKBENCH_DEBUG=1 npm run dev -- --port 5174
```

`--port` 仅用于开发模式。打包后的 AppImage 和 Windows EXE 直接通过 `file://` 加载包内页面，不会监听 `5173` 或其他 HTTP 端口，因此不需要指定端口，也不存在开发服务器端口冲突。

`postinstall` 会把 `better-sqlite3` 重建为 Electron ABI。测试通过 Electron 内置 Node 运行，避免原生模块 ABI 不一致。

## 质量检查

```bash
npm run lint
npm run typecheck
npm test
npm run build

# 一次执行全部检查
npm run check
```

测试覆盖模板生命周期、Excel 导入、字段重排、字段不匹配、业务键合并、冲突版本、重复文件跳过、多关键词 OR 搜索、短关键词和字段过滤。

在带桌面环境的 Linux 上还可执行 utility process 冒烟测试：

```bash
./node_modules/.bin/electron tests/utility-process-smoke.mjs
```

## 打包

```bash
# 当前平台默认产物
npm run dist

# Windows x64（必须在 Windows x64 环境执行）
npm run dist:win

# Linux x64 AppImage
npm run dist:linux

# Linux ARM64 AppImage（必须在 ARM64 Linux 环境执行）
npm run dist:linux:arm64
```

产物位于 `release/`。麒麟 Linux 应根据真实 CPU 架构分别使用 x64 或 arm64 包，并在目标系统做启动、导入、查询和导出验收。

桌面安装包必须在与目标一致的平台和 CPU 架构上原生构建。脚本会主动拦截跨平台或跨架构打包，避免将错误平台的 `better-sqlite3` 原生模块装入成品。仓库工作流会分别在 Windows x64 和 Linux x64 环境中执行质量检查、打包及包结构验证。

## 数据位置

应用固定使用 ASCII 用户数据目录，避免产品改名或中文目录造成路径变化：

- Windows：`%APPDATA%\local_data_workbench\storage\`
- Linux：`$XDG_CONFIG_HOME/local_data_workbench/storage/`，默认 `~/.config/local_data_workbench/storage/`

界面右上角“数据目录”可以直接打开该位置。
模板页标题下方会弱提示该模板 SQLite 的完整位置；如果文件被手动删除，界面显示“数据文件已不存在”，不会弹出数据库异常。

```text
storage/
├── catalog.sqlite
└── templates/
    └── <template-id>.sqlite
```

## Debug 日志

默认不生成详细日志。需要定位问题时，设置环境变量 `LOCAL_DATA_WORKBENCH_DEBUG=1` 后启动应用：

```bash
# Linux 开发环境
LOCAL_DATA_WORKBENCH_DEBUG=1 npm run dev

# Linux AppImage
LOCAL_DATA_WORKBENCH_DEBUG=1 ./local-data-workbench-0.1.0-linux-x86_64.AppImage
```

Windows PowerShell：

```powershell
$env:LOCAL_DATA_WORKBENCH_DEBUG = "1"
& ".\本地数据工作台.exe"
```

日志写入数据目录下的 `logs/debug.log`，达到 10 MB 后轮换为 `debug.previous.log`。主进程和独立导入进程会记录模板、文件路径、任务阶段、耗时、行数统计及完整错误栈，但不会逐行写入 Excel 内容。关闭应用并取消该环境变量即可恢复默认无详细日志模式。

删除模板时会关闭连接并删除对应 `.sqlite`、`-wal`、`-shm` 文件，其他模板不受影响。

## 当前边界

- 不支持密码保护或加密的 Excel
- 不提供数据库加密、登录、角色权限或字段脱敏
- 不默认跨模板查询
- 单模板最多 500 个字段
- trigram 全文索引对三个及以上字符最有效，短词使用普通包含查询

## 架构

```text
React renderer (sandbox)
        │ typed IPC
Electron main
        ├── catalog/template query connections
        └── utility process per import job
                ├── isolated Excel parser
                └── template SQLite writer (WAL)
```

渲染进程启用 `sandbox`、`contextIsolation`，关闭 Node integration，不加载远程页面。
