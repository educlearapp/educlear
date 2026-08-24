import type { MigrationFile } from "../types/MigrationFile";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import {
  readMigrationFileRows,
  type ReadMigrationFileRowsOptions,
} from "./readMigrationFileRows";

const SAMPLE_ROW_LIMIT = 10;

/**
 * Read-only preview of a staged migration file (CSV, XLS, XLSX).
 * Does not modify the original file or touch the live database.
 */
export async function readMigrationFilePreview(
  file: MigrationFile,
  options?: ReadMigrationFileRowsOptions
): Promise<MigrationFilePreview> {
  const full = await readMigrationFileRows(file, options);
  const warnings = [...full.warnings];
  const role = String(full.sheetRole || file.sheetRole || "").toUpperCase();
  if (role === "SUMMARY") {
    warnings.unshift("Summary/cover sheet — not used as learner, parent, or billing data.");
  } else if (role === "SUPPORTING") {
    warnings.unshift("Supporting/reconciliation sheet — reviewed, not treated as a required dataset.");
  }
  if (full.worksheetName) {
    warnings.unshift(`Worksheet: ${full.worksheetName}`);
  }

  return {
    fileId: full.fileId,
    filename: full.filename,
    category: full.category,
    columns: full.columns,
    sampleRows: full.rows.slice(0, SAMPLE_ROW_LIMIT),
    rowCount: full.rowCount,
    warnings,
    worksheetName: full.worksheetName,
    workbookFilename: full.workbookFilename,
    sheetRole: full.sheetRole,
    sheetKind: full.sheetKind,
    headerRowIndex: full.headerRowIndex,
    path: file.path,
  };
}
