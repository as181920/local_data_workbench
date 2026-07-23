import { createHash } from "node:crypto";
import type { ColumnKind, TemplateColumn } from "../../shared/types.js";

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanCell(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function normalizeForComparison(value: unknown): string {
  return cleanCell(value).replace(/\s+/g, " ").normalize("NFKC");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function schemaFingerprint(headers: string[]): string {
  return sha256(JSON.stringify(headers.map(normalizeHeader)));
}

export function rowHash(values: string[]): string {
  return sha256(JSON.stringify(values.map(normalizeForComparison)));
}

export function dedupeHash(values: string[], columnIndexes: number[]): string {
  const keyValues = columnIndexes.map((index) => normalizeForComparison(values[index]));
  const selected = columnIndexes.length && keyValues.some(Boolean)
    ? ["key", ...keyValues]
    : ["row", ...values.map(normalizeForComparison)];
  return sha256(JSON.stringify(selected));
}

export function buildSearchText(values: string[]): string {
  return values.map(cleanCell).filter(Boolean).join("\n");
}

export function inferColumnKind(values: string[]): ColumnKind {
  const present = values.map(cleanCell).filter(Boolean);
  if (!present.length) return "text";
  const sample = present.slice(0, 50);
  if (sample.every((value) => /^(?:0|1|true|false|是|否)$/i.test(value))) return "boolean";
  if (sample.every((value) => /^-?(?:\d+|\d*\.\d+)$/.test(value) && value.length < 16)) return "number";
  if (sample.every((value) => /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(value))) return "date";
  return "text";
}

export function buildColumns(headers: string[], previewRows: string[][]): TemplateColumn[] {
  const names = new Map<string, number>();
  return headers.map((header, index) => {
    const normalized = normalizeHeader(header);
    const baseName = normalized || `未命名列 ${index + 1}`;
    const count = (names.get(baseName) ?? 0) + 1;
    names.set(baseName, count);
    return {
      index,
      key: `c_${String(index + 1).padStart(3, "0")}`,
      name: count === 1 ? baseName : `${baseName} (${count})`,
      normalizedName: baseName,
      kind: inferColumnKind(previewRows.map((row) => row[index] ?? ""))
    };
  });
}

export function findHeaderRow(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 20).forEach((row, index) => {
    const nonEmpty = row.filter((cell) => normalizeHeader(cell)).length;
    const unique = new Set(row.map(normalizeHeader).filter(Boolean)).size;
    const score = nonEmpty + unique * 0.05 - index * 0.1;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex + 1;
}
