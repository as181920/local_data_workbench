import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  FilePlus2,
  Filter,
  FolderInput,
  FolderOpen,
  History,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import type {
  CreateTemplateInput,
  DataFilter,
  DataRecord,
  FilterOperator,
  ImportHistory,
  ImportProgress,
  QueryRequest,
  QueryResult,
  RecordDetail,
  TemplateSummary,
  WorkbookPreview
} from "../shared/types";

const EMPTY_RESULT: QueryResult = { rows: [], total: 0, page: 1, pageSize: 50 };

export default function App() {
  if (!window.workbench) return <RuntimeUnavailable />;
  return <WorkbenchApp />;
}

function RuntimeUnavailable() {
  return (
    <div className="runtime-error">
      <div className="runtime-error-card">
        <span className="runtime-error-icon"><CircleAlert size={28} /></span>
        <div>
          <p className="eyebrow">应用组件未就绪</p>
          <h1>本地数据工作台无法连接桌面服务</h1>
          <p>请重新启动应用；如果问题仍然存在，请使用 Debug 日志启动并提供日志文件。</p>
          <code>LOCAL_DATA_WORKBENCH_DEBUG=1</code>
        </div>
      </div>
    </div>
  );
}

function WorkbenchApp() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<Record<string, ImportProgress>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const next = await window.workbench.templates.list();
      setTemplates(next);
    } catch (reason) {
      setError(getMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return window.workbench.imports.onProgress((item) => {
      setProgress((current) => ({ ...current, [item.jobId]: item }));
      if (item.phase === "completed" || item.phase === "failed" || item.phase === "cancelled") {
        void reload();
      }
    });
  }, [reload]);

  const selected = templates.find((item) => item.id === selectedId);
  const activeProgress = Object.values(progress).filter((item) =>
    !["completed", "failed", "cancelled"].includes(item.phase)
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => setSelectedId(undefined)}>
          <span className="brand-mark"><Layers3 size={21} /></span>
          <div>
            <strong>本地数据工作台</strong>
            <span>Local Data Workbench</span>
          </div>
        </div>
        <div className="topbar-status">
          {activeProgress.length > 0 && (
            <span className="status-chip"><LoaderCircle className="spin" size={15} /> {activeProgress.length} 个导入任务</span>
          )}
          <button className="storage-link" onClick={() => window.workbench.storage.openDirectory().catch((reason) => setError(getMessage(reason)))}>
            <FolderOpen size={15} /> 数据目录
          </button>
          <span className="privacy-chip"><ShieldCheck size={15} /> 数据仅存本机</span>
        </div>
      </header>

      {error && <Toast message={error} onClose={() => setError("")} />}

      <main className="main-content">
        {selected ? (
          <TemplateWorkspace
            template={selected}
            progress={Object.values(progress).find((item) => item.jobId.startsWith(`${selected.id}:`))}
            onBack={() => setSelectedId(undefined)}
            onChanged={reload}
            onError={setError}
          />
        ) : (
          <TemplateHome
            templates={templates}
            loading={loading}
            progress={progress}
            onSelect={setSelectedId}
            onCreate={() => setCreating(true)}
          />
        )}
      </main>

      {creating && (
        <CreateTemplateDialog
          onClose={() => setCreating(false)}
          onCreated={(template) => {
            setCreating(false);
            setSelectedId(template.id);
            void reload();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function TemplateHome({
  templates,
  loading,
  progress,
  onSelect,
  onCreate
}: {
  templates: TemplateSummary[];
  loading: boolean;
  progress: Record<string, ImportProgress>;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="home">
      <div className="page-heading">
        <div>
          <h1>数据模板</h1>
          <p>{templates.length ? `共 ${templates.length} 个独立业务空间` : "从一个 Excel 文件创建第一个业务空间"}</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <FilePlus2 size={19} /> 新建数据模板
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><LoaderCircle className="spin" /> 正在载入模板</div>
      ) : templates.length === 0 ? (
        <button className="empty-card" onClick={onCreate}>
          <span className="empty-icon"><Plus /></span>
          <strong>创建第一个数据模板</strong>
          <span>选择 Excel，自动识别工作表和字段结构</span>
        </button>
      ) : (
        <div className="template-grid">
          {templates.map((template) => {
            const task = Object.values(progress).find((item) => item.jobId.startsWith(`${template.id}:`));
            return (
              <button className="template-card" key={template.id} onClick={() => onSelect(template.id)}>
                <div className="card-head">
                  <span className="database-icon"><Database size={22} /></span>
                  <span className={template.dataFileExists ? "field-count" : "field-count missing"}>{template.dataFileExists ? `${template.columns.length} 个字段` : "数据文件已不存在"}</span>
                </div>
                <h3>{template.name}</h3>
                <p>{template.description || `工作表：${template.sheetName}`}</p>
                <div className="card-stats">
                  <span><strong>{formatNumber(template.recordCount)}</strong> 记录</span>
                  <span><strong>{formatNumber(template.mergedCount)}</strong> 合并</span>
                  <span className={template.conflictCount ? "warning-text" : ""}>
                    <strong>{formatNumber(template.conflictCount)}</strong> 冲突
                  </span>
                </div>
                {task && !["completed", "failed", "cancelled"].includes(task.phase) ? (
                  <ProgressBar progress={task} compact />
                ) : (
                  <div className="card-foot">
                    <span>{template.importCount} 次导入</span>
                    <span>更新于 {formatDate(template.updatedAt)}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateTemplateDialog({
  onClose,
  onCreated,
  onError
}: {
  onClose: () => void;
  onCreated: (template: TemplateSummary) => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<WorkbookPreview>();
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dedupe, setDedupe] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setBusy(true);
    try {
      const result = await window.workbench.templates.preview();
      if ("cancelled" in result) return;
      setPreview(result.preview);
      setFilePaths(result.filePaths);
      setName(result.preview.fileName.replace(/\.[^.]+$/, ""));
      const suggested = result.preview.columns
        .filter((column) => /(^|[^a-z])(id|编号|单号|主键)([^a-z]|$)/i.test(column.name))
        .slice(0, 1)
        .map((column) => column.index);
      setDedupe(suggested);
    } catch (reason) {
      onError(getMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const changeSheet = async (sheetName: string) => {
    if (!preview) return;
    setBusy(true);
    try {
      const next = await window.workbench.templates.previewSheet(preview.filePath, sheetName);
      setPreview(next);
      setDedupe([]);
    } catch (reason) {
      onError(getMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!preview || !filePaths.length || !name.trim()) return;
    setBusy(true);
    try {
      const input: CreateTemplateInput = {
        name: name.trim(),
        description: description.trim(),
        preview,
        dedupeColumnIndexes: dedupe
      };
      const template = await window.workbench.templates.create(input);
      await window.workbench.imports.start({ templateId: template.id, filePaths });
      onCreated(template);
    } catch (reason) {
      onError(getMessage(reason));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal create-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">新业务空间</span>
            <h2>创建数据模板</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>

        {!preview ? (
          <button className="file-drop" onClick={choose} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={34} /> : <FolderInput size={34} />}
            <strong>选择一个或多个 Excel 文件</strong>
            <span>第一份文件用于创建模板，其余文件会在字段校验通过后一起导入</span>
          </button>
        ) : (
          <>
            <div className="form-grid">
              <label>
                <span>模板名称</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus />
              </label>
              <label>
                <span>工作表</span>
                <select value={preview.sheetName} onChange={(event) => void changeSheet(event.target.value)}>
                  {preview.sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}
                </select>
              </label>
              <label className="full">
                <span>说明（可选）</span>
                <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="例如：12345 工单月度汇总" />
              </label>
            </div>

            <div className="dedupe-section">
              <div className="subheading">
                <div>
                  <h3>选择业务唯一键</h3>
                  <p>相同键值的行会合并为一条，并保留来源、次数和冲突版本。不选择时仅合并整行完全相同的数据。</p>
                </div>
                <span>{dedupe.length ? `已选 ${dedupe.length} 项` : "整行判重"}</span>
              </div>
              <div className="field-pills">
                {preview.columns.map((column) => (
                  <label className={`field-pill ${dedupe.includes(column.index) ? "selected" : ""}`} key={column.key}>
                    <input
                      type="checkbox"
                      checked={dedupe.includes(column.index)}
                      onChange={() => setDedupe((current) =>
                        current.includes(column.index)
                          ? current.filter((item) => item !== column.index)
                          : [...current, column.index]
                      )}
                    />
                    <span>{column.name}</span>
                    <small>{kindName(column.kind)}</small>
                  </label>
                ))}
              </div>
            </div>

            <div className="preview-box">
              <div className="subheading">
                <div>
                  <h3>数据预览</h3>
                  <p>
                    已选择 {filePaths.length} 个文件 · 以“{preview.fileName}”识别第 {preview.headerRow} 行表头，共 {preview.columns.length} 列
                  </p>
                </div>
                <button className="text-button" onClick={choose}>更换文件</button>
              </div>
              <div className="mini-table-wrap">
                <table className="mini-table">
                  <thead><tr>{preview.columns.map((column) => <th key={column.key}>{column.name}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((row, index) => (
                      <tr key={index}>{preview.columns.map((column) => <td key={column.key}>{row[column.index]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="button ghost" onClick={onClose}>取消</button>
          <button className="button primary" disabled={!preview || !filePaths.length || !name.trim() || busy} onClick={submit}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
            创建并导入{filePaths.length > 1 ? ` ${filePaths.length} 个文件` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateWorkspace({
  template,
  progress,
  onBack,
  onChanged,
  onError
}: {
  template: TemplateSummary;
  progress?: ImportProgress;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filters, setFilters] = useState<DataFilter[]>([]);
  const [mergedOnly, setMergedOnly] = useState(false);
  const [conflictOnly, setConflictOnly] = useState(false);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RecordDetail>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const request = useMemo<QueryRequest>(() => ({
    templateId: template.id,
    keyword,
    filters,
    mergedOnly,
    conflictOnly,
    page,
    pageSize: 50
  }), [template.id, keyword, filters, mergedOnly, conflictOnly, page]);

  const query = useCallback(async () => {
    if (!template.dataFileExists) {
      setResult(EMPTY_RESULT);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setResult(await window.workbench.data.query(request));
    } catch (reason) {
      onError(getMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [request, onError, template.dataFileExists]);

  useEffect(() => { void query(); }, [query, refreshKey]);
  useEffect(() => {
    if (progress && ["completed", "cancelled"].includes(progress.phase)) {
      void onChanged();
      setRefreshKey((value) => value + 1);
    }
  }, [progress?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const startImport = async () => {
    try {
      const filePaths = await window.workbench.templates.pickImportFiles();
      if (filePaths.length) await window.workbench.imports.start({ templateId: template.id, filePaths });
    } catch (reason) {
      onError(getMessage(reason));
    }
  };

  const remove = async () => {
    if (!window.confirm(`确定删除模板“${template.name}”及其全部数据吗？此操作无法恢复。`)) return;
    try {
      await window.workbench.templates.remove(template.id);
      await onChanged();
      onBack();
    } catch (reason) {
      onError(getMessage(reason));
    }
  };

  const exportData = async () => {
    try {
      await window.workbench.data.export({ ...request, page: 1 });
    } catch (reason) {
      onError(getMessage(reason));
    }
  };

  return (
    <div className="workspace">
      <div className="workspace-head">
        <div className="workspace-title">
          <button className="icon-button back" onClick={onBack}><ArrowLeft /></button>
          <span className="database-icon"><Database size={22} /></span>
          <div>
            <h1>{template.name}</h1>
            <p>{template.description || `${template.sheetName} · ${template.columns.length} 个字段`}</p>
            <div className="data-file-hint" title={template.dataFilePath}>数据文件：{template.dataFilePath}</div>
          </div>
        </div>
        <div className="toolbar">
          <button className="button ghost" onClick={() => setHistoryOpen(true)}><History size={17} /> 导入历史</button>
          <button className="button ghost" onClick={exportData}><Download size={17} /> 导出结果</button>
          <button className="button primary" onClick={startImport} disabled={Boolean(progress && !isFinished(progress))}>
            <FolderInput size={17} /> 导入 Excel
          </button>
          <button className="icon-button danger" title="删除模板" onClick={remove}><Trash2 size={18} /></button>
        </div>
      </div>

      {!template.dataFileExists ? (
        <section className="missing-data-panel">
          <Database size={34} />
          <h2>数据文件已不存在</h2>
          <p>此模板对应的 SQLite 文件可能已被手动移动或删除。</p>
          <code>{template.dataFilePath}</code>
          <button className="button ghost" onClick={remove}><Trash2 size={16} /> 删除此模板记录</button>
        </section>
      ) : (
      <>
      {progress && !isFinished(progress) && (
        <div className="import-banner">
          <ProgressBar progress={progress} />
          <button className="button ghost small" onClick={() => window.workbench.imports.cancel(progress.jobId)}>取消任务</button>
        </div>
      )}
      {progress?.phase === "failed" && (
        <div className="error-banner"><CircleAlert size={18} /> {progress.message || "导入失败"}</div>
      )}

      <section className="query-panel">
        <form className="search-row" onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setKeyword(keywordInput.trim());
        }}>
          <div className="search-box">
            <Search size={19} />
            <input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="输入多个关键词，用空格分隔；命中任意一个即可"
            />
            {keywordInput && <button type="button" onClick={() => { setKeywordInput(""); setKeyword(""); }}><X size={16} /></button>}
          </div>
          <button className="button dark" type="submit">搜索</button>
          <label className="check-toggle">
            <input type="checkbox" checked={mergedOnly} onChange={(event) => { setMergedOnly(event.target.checked); setPage(1); }} />
            <span>仅看合并记录</span>
          </label>
          <label className="check-toggle warning">
            <input type="checkbox" checked={conflictOnly} onChange={(event) => { setConflictOnly(event.target.checked); setPage(1); }} />
            <span>仅看冲突</span>
          </label>
        </form>
        <div className="search-hint">多个词按 OR 查询，例如“老人家 老人 大龄人口”会返回包含任意一个词的记录。</div>
        <FilterBuilder
          template={template}
          filters={filters}
          onChange={(next) => { setFilters(next); setPage(1); }}
        />
      </section>

      <section className="data-panel">
        <div className="data-summary">
          <div>
            <strong>{formatNumber(result.total)}</strong>
            <span> 条匹配记录</span>
            {keyword && <span className="query-tag">关键词：{keyword}</span>}
            {filters.length > 0 && <span className="query-tag">{filters.length} 个字段条件</span>}
          </div>
          <button className="icon-button" title="刷新" onClick={() => setRefreshKey((value) => value + 1)}>
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
        <DataTable
          template={template}
          rows={result.rows}
          loading={loading}
          onDetail={async (record) => {
            try {
              setDetail(await window.workbench.data.detail(template.id, record.id));
            } catch (reason) {
              onError(getMessage(reason));
            }
          }}
        />
        <div className="pagination">
          <span>第 {result.total ? page : 0} / {Math.ceil(result.total / result.pageSize) || 0} 页</span>
          <div>
            <button className="icon-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button>
            <button className="icon-button" disabled={page * result.pageSize >= result.total} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button>
          </div>
        </div>
      </section>

      {detail && <RecordDrawer template={template} detail={detail} onClose={() => setDetail(undefined)} />}
      {historyOpen && <HistoryDialog template={template} onClose={() => setHistoryOpen(false)} onError={onError} />}
      </>
      )}
    </div>
  );
}

function FilterBuilder({
  template,
  filters,
  onChange
}: {
  template: TemplateSummary;
  filters: DataFilter[];
  onChange: (filters: DataFilter[]) => void;
}) {
  const add = () => onChange([...filters, {
    columnIndex: template.columns[0].index,
    operator: "contains",
    value: ""
  }]);
  return (
    <div className="filter-builder">
      {filters.map((filter, index) => (
        <div className="filter-row" key={index}>
          <Filter size={15} />
          <select value={filter.columnIndex} onChange={(event) => {
            const next = [...filters];
            next[index] = { ...filter, columnIndex: Number(event.target.value) };
            onChange(next);
          }}>
            {template.columns.map((column) => <option key={column.key} value={column.index}>{column.name}</option>)}
          </select>
          <select value={filter.operator} onChange={(event) => {
            const next = [...filters];
            next[index] = { ...filter, operator: event.target.value as FilterOperator };
            onChange(next);
          }}>
            {operatorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {!["empty", "notEmpty"].includes(filter.operator) && (
            <input value={filter.value ?? ""} onChange={(event) => {
              const next = [...filters];
              next[index] = { ...filter, value: event.target.value };
              onChange(next);
            }} placeholder="筛选值" />
          )}
          <button className="icon-button small" onClick={() => onChange(filters.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
        </div>
      ))}
      <button className="text-button add-filter" onClick={add}><Plus size={15} /> 添加字段筛选</button>
    </div>
  );
}

function DataTable({
  template,
  rows,
  loading,
  onDetail
}: {
  template: TemplateSummary;
  rows: DataRecord[];
  loading: boolean;
  onDetail: (record: DataRecord) => void;
}) {
  if (loading && !rows.length) return <div className="empty-state"><LoaderCircle className="spin" /> 正在查询</div>;
  if (!rows.length) return <div className="empty-state"><Search /> 没有符合当前条件的数据</div>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th className="sticky status-column">状态</th>
            {template.columns.map((column) => <th key={column.key}>{column.name}</th>)}
            <th>来源</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => (
            <tr key={record.id} onClick={() => onDetail(record)}>
              <td className="sticky status-column">
                <div className="row-badges">
                  {record.isMerged ? <span className="badge merged">合并 ×{record.occurrenceCount}</span> : <span className="badge plain">单条</span>}
                  {record.hasConflict && <span className="badge conflict">有冲突</span>}
                </div>
              </td>
              {record.values.map((value, index) => <td key={template.columns[index].key} title={value}>{value || <span className="empty-value">—</span>}</td>)}
              <td>{record.sourceFileCount} 个文件</td>
              <td>{formatDate(record.lastImportedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordDrawer({
  template,
  detail,
  onClose
}: {
  template: TemplateSummary;
  detail: RecordDetail;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"data" | "sources" | "versions">("data");
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">记录 #{detail.record.id}</span>
            <h2>记录详情</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        <div className="record-summary">
          <span className={`badge ${detail.record.isMerged ? "merged" : "plain"}`}>
            {detail.record.isMerged ? `已合并 ${detail.record.occurrenceCount} 次` : "单条记录"}
          </span>
          {detail.record.hasConflict && <span className="badge conflict">{detail.conflicts.length} 个字段冲突</span>}
          <span>{detail.record.sourceFileCount} 个来源文件</span>
        </div>
        <div className="tabs">
          <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>当前数据</button>
          <button className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}>来源 {detail.occurrences.length}</button>
          <button className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>版本 {detail.versions.length}</button>
        </div>
        <div className="drawer-body">
          {tab === "data" && (
            <dl className="detail-list">
              {template.columns.map((column) => (
                <div key={column.key}>
                  <dt>{column.name}</dt>
                  <dd>{detail.record.values[column.index] || <span className="empty-value">空</span>}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === "sources" && detail.occurrences.map((item) => (
            <div className="source-item" key={item.id}>
              <FilePlus2 size={17} />
              <div><strong>{item.sourceFile}</strong><span>第 {item.rowNumber} 行 · {formatDate(item.importedAt, true)}</span></div>
              <span>版本 {item.versionId}</span>
            </div>
          ))}
          {tab === "versions" && (
            <>
              {detail.conflicts.length > 0 && (
                <div className="conflict-list">
                  {detail.conflicts.map((conflict, index) => (
                    <div className="conflict-item" key={index}>
                      <strong>{conflict.columnName}</strong>
                      <p><span>当前</span>{conflict.existingValue || "空"}</p>
                      <p><span>另一版本</span>{conflict.incomingValue || "空"}</p>
                    </div>
                  ))}
                </div>
              )}
              {detail.versions.map((version) => (
                <details className="version-item" key={version.id}>
                  <summary>版本 {version.id}<span>{formatDate(version.firstSeenAt, true)}</span></summary>
                  <dl className="detail-list compact">
                    {template.columns.map((column) => (
                      <div key={column.key}><dt>{column.name}</dt><dd>{version.values[column.index] || "空"}</dd></div>
                    ))}
                  </dl>
                </details>
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function HistoryDialog({
  template,
  onClose,
  onError
}: {
  template: TemplateSummary;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<ImportHistory[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    window.workbench.imports.history(template.id)
      .then(setItems)
      .catch((reason) => onError(getMessage(reason)))
      .finally(() => setLoading(false));
  }, [template.id, onError]);
  return (
    <div className="modal-backdrop">
      <div className="modal history-modal">
        <div className="modal-head">
          <div><span className="eyebrow">{template.name}</span><h2>导入历史</h2></div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        <div className="history-list">
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> 正在载入</div> :
            items.length === 0 ? <div className="empty-state">暂无导入记录</div> :
              items.map((item) => (
                <div className="history-item" key={item.id}>
                  <span className={`history-status ${item.status}`}>{statusName(item.status)}</span>
                  <div><strong>{item.sourceFile}</strong><span>{formatDate(item.startedAt, true)}</span></div>
                  <div className="history-counts">
                    <span>{formatNumber(item.totalRows)} 行</span>
                    <span>新增 {formatNumber(item.insertedRows)}</span>
                    <span>合并 {formatNumber(item.mergedRows)}</span>
                    <span className={item.conflictRows ? "warning-text" : ""}>冲突 {formatNumber(item.conflictRows)}</span>
                  </div>
                  {item.errorMessage && <p>{item.errorMessage}</p>}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ progress, compact = false }: { progress: ImportProgress; compact?: boolean }) {
  const filePercent = progress.fileCount ? Math.round((Math.max(0, progress.fileIndex - 1) / progress.fileCount) * 100) : 0;
  return (
    <div className={`progress-block ${compact ? "compact" : ""}`}>
      <div className="progress-label">
        <span><LoaderCircle className="spin" size={15} /> {progress.message || phaseName(progress.phase)}</span>
        <span>{progress.fileIndex}/{progress.fileCount} 文件 · {formatNumber(progress.processedRows)} 行</span>
      </div>
      <div className="progress-track"><span style={{ width: `${Math.max(4, filePercent)}%` }} /></div>
      {!compact && (
        <div className="progress-stats">
          <span>新增 {formatNumber(progress.insertedRows)}</span>
          <span>合并 {formatNumber(progress.mergedRows)}</span>
          <span>冲突 {formatNumber(progress.conflictRows)}</span>
          {progress.skippedFiles > 0 && <span>跳过文件 {progress.skippedFiles}</span>}
        </div>
      )}
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="toast">
      <CircleAlert size={19} />
      <span>{message}</span>
      <button onClick={onClose}><X size={16} /></button>
    </div>
  );
}

const operatorOptions: Array<[FilterOperator, string]> = [
  ["contains", "包含"],
  ["notContains", "不包含"],
  ["equals", "等于"],
  ["notEquals", "不等于"],
  ["startsWith", "开头是"],
  ["endsWith", "结尾是"],
  ["empty", "为空"],
  ["notEmpty", "不为空"],
  ["greaterThan", "大于"],
  ["greaterOrEqual", "大于等于"],
  ["lessThan", "小于"],
  ["lessOrEqual", "小于等于"]
];

function getMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDate(value: string, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function kindName(kind: string): string {
  return ({ text: "文本", number: "数字", date: "日期", boolean: "标记" } as Record<string, string>)[kind] || kind;
}

function isFinished(progress: ImportProgress): boolean {
  return ["completed", "failed", "cancelled"].includes(progress.phase);
}

function phaseName(phase: ImportProgress["phase"]): string {
  return ({
    validating: "正在校验模板",
    reading: "正在读取 Excel",
    writing: "正在写入数据库",
    finalizing: "正在整理索引",
    completed: "导入完成",
    failed: "导入失败",
    cancelled: "已取消"
  })[phase];
}

function statusName(status: string): string {
  return ({ completed: "成功", failed: "失败", cancelled: "已取消", running: "进行中" } as Record<string, string>)[status] || status;
}
