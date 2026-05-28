import fs from "fs/promises";
import type { MigrationFile } from "../types/MigrationFile";
import {
  detectMigrationCategory,
  isLearnerClassExportFilename,
} from "./detectMigrationCategory";
import type { MigrationParseIssue } from "../../../utils/migrationLearnerFileParser";
import { parseStagedMigrationFile, resolveSafeMigrationFilePath } from "./parseStagedMigrationFile";

function rowRecordsToUnknown(rows: Record<string, string>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = value;
    }
    return out;
  });
}

function buildWarnings(columns: string[], rowCount: number): string[] {
  const warnings: string[] = [];
  if (columns.length === 0) {
    warnings.push("No column headers detected.");
  } else if (columns.every((h) => !h.trim())) {
    warnings.push("Header row is empty or unreadable.");
  }
  if (rowCount === 0) {
    warnings.push("File contains no data rows.");
  }
  return warnings;
}

export type MigrationFileRowsResult = {
  fileId: string;
  filename: string;
  category: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  warnings: string[];
  parseIssues: MigrationParseIssue[];
};

export type ReadMigrationFileRowsOptions = {
  /** When set to kideesys, enables report-style header detection for preview parsing. */
  sourceSystem?: string;
};

/**
 * Read-only full parse of a staged migration file (CSV, XLS, XLSX).
 * Does not modify the source file or touch the live database.
 */
export async function readMigrationFileRows(
  file: MigrationFile,
  options?: ReadMigrationFileRowsOptions
): Promise<MigrationFileRowsResult> {
  const fileId = String(file.id || "").trim();
  const filename = String(file.filename || "").trim() || "upload";
  const category = String(file.category || detectMigrationCategory(filename));
  const absolutePath = resolveSafeMigrationFilePath(file.path);

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return {
      fileId,
      filename,
      category,
      columns: [],
      rows: [],
      rowCount: 0,
      warnings: ["File not found on disk. Re-upload to refresh."],
      parseIssues: [],
    };
  }

  if (!stat.isFile() || stat.size === 0) {
    return {
      fileId,
      filename,
      category,
      columns: [],
      rows: [],
      rowCount: 0,
      warnings: ["File is empty."],
      parseIssues: [],
    };
  }

  let columns: string[] = [];
  let rowCount = 0;
  let rows: Record<string, unknown>[] = [];
  let parseIssues: MigrationParseIssue[] = [];

  try {
    const sourceSystem = String(options?.sourceSystem || "").trim();
    const parsedRows = await parseStagedMigrationFile(absolutePath, filename, sourceSystem);
    rowCount = parsedRows.length;
    rows = rowRecordsToUnknown(parsedRows);
    columns =
      parsedRows.length > 0
        ? Object.keys(parsedRows[0]).filter((k) => String(k).trim())
        : [];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to parse file";
    return {
      fileId,
      filename,
      category,
      columns: [],
      rows: [],
      rowCount: 0,
      warnings: [message],
      parseIssues: [],
    };
  }

  const warnings = buildWarnings(columns, rowCount);
  for (const pi of parseIssues) {
    warnings.push(pi.message);
  }

  const leaf = filename.split(/[/\\]/).pop() || filename;
  const basename = leaf.replace(/\.[^.]+$/i, "");
  const haystack = filename.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    category === "learners" &&
    columns.includes("fullName") &&
    rowCount > 0 &&
    isLearnerClassExportFilename(haystack, basename)
  ) {
    const classroom = columns.includes("classroom")
      ? String(rows[0]?.classroom ?? "").trim()
      : "";
    warnings.push(
      classroom
        ? `Kid-e-Sys class list (${classroom}, ${rowCount} learner(s)).`
        : `Kid-e-Sys class list (${rowCount} learner(s)).`
    );
  }

  if (
    category === "parents" &&
    rowCount > 0 &&
    columns.includes("Parent Name") &&
    columns.includes("Learner Name") &&
    haystack.includes("contactlist")
  ) {
    const classroom = columns.includes("Classroom")
      ? String(rows[0]?.Classroom ?? "").trim()
      : "";
    warnings.push(
      classroom
        ? `Kid-e-Sys contact list (${classroom}, ${rowCount} parent contact row(s)).`
        : `Kid-e-Sys contact list (${rowCount} parent contact row(s)).`
    );
  }

  return {
    fileId,
    filename,
    category,
    columns,
    rows,
    rowCount,
    warnings,
    parseIssues,
  };
}
