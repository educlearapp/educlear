/**
 * Expand one physical CSV/XLS/XLSX upload into one logical source per worksheet.
 */

import { randomUUID } from "crypto";
import { normalizeKidESysLearnerClassListSheet } from "../adapters/kideesysLearnerClassListNormalization";
import type { MigrationFile } from "../types/MigrationFile";
import { classifyMigrationSheet, type MigrationSheetKind, type MigrationSheetRole } from "./classifyMigrationSheet";
import { detectTabularHeaderRow, matrixToRecordsFromHeader } from "./detectTabularHeaderRow";
import { listWorkbookSheets } from "./workbookSheets";

export type ExpandedWorkbookSheet = {
  file: MigrationFile;
  headerRowIndex: number | null;
  columns: string[];
  rowCount: number;
  sheetKind: MigrationSheetKind;
  sheetRole: MigrationSheetRole;
  reasons: string[];
};

function usedRowCount(matrix: string[][]): number {
  return matrix.filter((row) => (row || []).some((c) => String(c ?? "").trim())).length;
}

export function expandWorkbookToLogicalFiles(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt?: Date;
  sourceSystem?: string;
}): ExpandedWorkbookSheet[] {
  const filename = String(input.filename || "").trim() || "upload";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return [];

  const sheets = listWorkbookSheets(input.buffer, filename);
  const out: ExpandedWorkbookSheet[] = [];

  for (const sheet of sheets) {
    if (usedRowCount(sheet.matrix) === 0) continue;
    let detected = detectTabularHeaderRow(sheet.matrix);
    let parsed = detected
      ? matrixToRecordsFromHeader(sheet.matrix, detected.headerRowIndex)
      : { headers: [], rows: [], sourceRowNumbers: [] };
    let classified = classifyMigrationSheet({
      sheetName: sheet.name,
      filename,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 12),
    });

    const kideesysClassList = normalizeKidESysLearnerClassListSheet(sheet.matrix, filename);
    if (
      kideesysClassList &&
      kideesysClassList.rows.length > 0 &&
      (classified.sheetRole !== "DATA" || classified.category === "unknown")
    ) {
      classified = {
        category: "learners",
        sheetRole: "DATA",
        sheetKind: "learners",
        reasons: ["Kid-e-Sys class-list layout"],
      };
      parsed = {
        headers: kideesysClassList.headers,
        rows: kideesysClassList.rows,
        sourceRowNumbers: [],
      };
    }

    const file: MigrationFile = {
      id: randomUUID(),
      filename,
      mimeType: input.mimeType,
      size: input.size,
      uploadedAt: input.uploadedAt || new Date(),
      category: classified.category,
      path: input.path,
      ...(lower.endsWith(".csv") ? {} : { worksheetName: sheet.name }),
      workbookFilename: filename,
      sheetRole: classified.sheetRole,
      sheetKind: classified.sheetKind,
      headerRowIndex: detected ? detected.headerRowIndex : null,
      ...(input.sourceSystem ? { sourceSystem: input.sourceSystem } : {}),
    };

    out.push({
      file,
      headerRowIndex: detected ? detected.headerRowIndex : null,
      columns: parsed.headers,
      rowCount: parsed.rows.length,
      sheetKind: classified.sheetKind,
      sheetRole: classified.sheetRole,
      reasons: classified.reasons,
    });
  }

  return out;
}
