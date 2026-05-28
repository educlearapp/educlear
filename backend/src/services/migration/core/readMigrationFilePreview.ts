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
  return {
    fileId: full.fileId,
    filename: full.filename,
    category: full.category,
    columns: full.columns,
    sampleRows: full.rows.slice(0, SAMPLE_ROW_LIMIT),
    rowCount: full.rowCount,
    warnings: full.warnings,
  };
}
