import { z } from "zod";

export const templateIdSchema = z.string().uuid();

export const renameTemplateSchema = z.object({
  templateId: templateIdSchema,
  name: z.string().trim().min(1).max(100)
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  preview: z.object({
    filePath: z.string().min(1),
    fileName: z.string().min(1),
    sheets: z.array(z.string()),
    sheetName: z.string().min(1),
    headerRow: z.number().int().positive(),
    headers: z.array(z.string()).min(1).max(500),
    columns: z.array(z.object({
      index: z.number().int().nonnegative(),
      key: z.string(),
      name: z.string(),
      normalizedName: z.string(),
      kind: z.enum(["text", "number", "date", "boolean"])
    })),
    schemaFingerprint: z.string().length(64),
    rows: z.array(z.array(z.string()))
  }),
  dedupeColumnIndexes: z.array(z.number().int().nonnegative()).max(10)
});

export const importRequestSchema = z.object({
  templateId: templateIdSchema,
  filePaths: z.array(z.string().min(1)).min(1).max(200)
});

const filterSchema = z.object({
  columnIndex: z.number().int().nonnegative(),
  operator: z.enum([
    "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith",
    "empty", "notEmpty", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual"
  ]),
  value: z.string().max(10_000).optional()
});

export const queryRequestSchema = z.object({
  templateId: templateIdSchema,
  keyword: z.string().max(500).optional(),
  keywordMode: z.enum(["or", "and"]).optional(),
  filters: z.array(filterSchema).max(20).optional(),
  mergedOnly: z.boolean().optional(),
  conflictOnly: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  sortColumnIndex: z.number().int().nonnegative().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional()
});
