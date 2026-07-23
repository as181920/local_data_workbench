export type ColumnKind = "text" | "number" | "date" | "boolean";

export interface TemplateColumn {
  index: number;
  key: string;
  name: string;
  normalizedName: string;
  kind: ColumnKind;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  sheetName: string;
  headerRow: number;
  schemaFingerprint: string;
  dedupeColumnIndexes: number[];
  columns: TemplateColumn[];
  dataFilePath: string;
  dataFileExists: boolean;
  recordCount: number;
  mergedCount: number;
  conflictCount: number;
  importCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbookPreview {
  filePath: string;
  fileName: string;
  sheets: string[];
  sheetName: string;
  headerRow: number;
  headers: string[];
  columns: TemplateColumn[];
  schemaFingerprint: string;
  rows: string[][];
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  preview: WorkbookPreview;
  dedupeColumnIndexes: number[];
}

export interface ImportRequest {
  templateId: string;
  filePaths: string[];
}

export type ImportPhase = "validating" | "reading" | "writing" | "finalizing" | "completed" | "failed" | "cancelled";

export interface ImportProgress {
  jobId: string;
  phase: ImportPhase;
  fileName?: string;
  fileIndex: number;
  fileCount: number;
  processedRows: number;
  insertedRows: number;
  mergedRows: number;
  conflictRows: number;
  skippedFiles: number;
  message?: string;
}

export type FilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty"
  | "greaterThan"
  | "greaterOrEqual"
  | "lessThan"
  | "lessOrEqual";

export interface DataFilter {
  columnIndex: number;
  operator: FilterOperator;
  value?: string;
}

export interface QueryRequest {
  templateId: string;
  keyword?: string;
  filters?: DataFilter[];
  mergedOnly?: boolean;
  conflictOnly?: boolean;
  page?: number;
  pageSize?: number;
  sortColumnIndex?: number;
  sortDirection?: "asc" | "desc";
}

export interface DataRecord {
  id: number;
  values: string[];
  isMerged: boolean;
  occurrenceCount: number;
  sourceFileCount: number;
  hasConflict: boolean;
  versionCount: number;
  firstImportedAt: string;
  lastImportedAt: string;
}

export interface QueryResult {
  rows: DataRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecordVersion {
  id: number;
  values: string[];
  firstSeenAt: string;
}

export interface RecordOccurrence {
  id: number;
  sourceFile: string;
  rowNumber: number;
  importedAt: string;
  versionId: number;
}

export interface RecordConflict {
  columnIndex: number;
  columnName: string;
  existingValue: string;
  incomingValue: string;
  createdAt: string;
}

export interface RecordDetail {
  record: DataRecord;
  versions: RecordVersion[];
  occurrences: RecordOccurrence[];
  conflicts: RecordConflict[];
}

export interface ImportHistory {
  id: number;
  sourceFile: string;
  fileHash: string;
  status: string;
  totalRows: number;
  insertedRows: number;
  mergedRows: number;
  conflictRows: number;
  errorMessage: string;
  startedAt: string;
  completedAt: string;
}

export interface WorkbenchApi {
  appVersion(): Promise<string>;
  storage: {
    openDirectory(): Promise<void>;
  };
  templates: {
    list(): Promise<TemplateSummary[]>;
    preview(): Promise<WorkbookPreview | { cancelled: true }>;
    previewSheet(filePath: string, sheetName: string): Promise<WorkbookPreview>;
    create(input: CreateTemplateInput): Promise<TemplateSummary>;
    remove(templateId: string): Promise<void>;
    pickImportFiles(): Promise<string[]>;
  };
  imports: {
    start(request: ImportRequest): Promise<{ jobId: string }>;
    cancel(jobId: string): Promise<void>;
    history(templateId: string): Promise<ImportHistory[]>;
    onProgress(callback: (progress: ImportProgress) => void): () => void;
  };
  data: {
    query(request: QueryRequest): Promise<QueryResult>;
    detail(templateId: string, recordId: number): Promise<RecordDetail>;
    export(request: QueryRequest): Promise<{ cancelled?: true; filePath?: string }>;
  };
}
