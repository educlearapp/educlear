import fs from "fs/promises";
import path from "path";
import {
  parseMigrationLearnerFileBuffer,
  readMigrationSpreadsheetMatrix,
} from "../../../utils/migrationLearnerFileParser";
import {
  extractKideesysReportTable,
  shouldUseKideesysReportExtraction,
} from "../adapters/kideesysReportTableExtraction";
import { getUniversalMigrationStagingDir } from "./migrationStagingPath";
import { resolveSafeMigrationReadPath } from "../migrationProjectPaths";

export function resolveSafeMigrationFilePath(filePath: string): string {
  try {
    return resolveSafeMigrationReadPath(filePath);
  } catch {
    const stagingRoot = path.resolve(getUniversalMigrationStagingDir());
    const resolved = path.resolve(String(filePath || ""));
    if (!resolved.startsWith(stagingRoot + path.sep) && resolved !== stagingRoot) {
      throw new Error("Stage file path is outside migration staging");
    }
    return resolved;
  }
}

/**
 * Parse a staged migration upload (CSV/XLS/XLSX) using the same Kid-e-Sys report
 * extraction as dry-run preview — required for contact_list and class lists.
 */
export async function parseStagedMigrationFile(
  filePath: string,
  filename: string,
  sourceSystem?: string
): Promise<Record<string, string>[]> {
  const absolutePath = resolveSafeMigrationFilePath(filePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Staged file "${filename}" is missing or empty`);
  }

  const buffer = await fs.readFile(absolutePath);
  let parsed: ReturnType<typeof parseMigrationLearnerFileBuffer> | null = null;

  if (shouldUseKideesysReportExtraction(filename, sourceSystem)) {
    const matrix = readMigrationSpreadsheetMatrix(buffer, filename);
    const extracted = extractKideesysReportTable(matrix, filename);
    if (extracted) {
      parsed = extracted;
    }
  }

  if (!parsed) {
    parsed = parseMigrationLearnerFileBuffer(buffer, filename);
  }

  return parsed.rows;
}
