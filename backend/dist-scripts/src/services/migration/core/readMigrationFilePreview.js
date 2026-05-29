"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMigrationFilePreview = readMigrationFilePreview;
const readMigrationFileRows_1 = require("./readMigrationFileRows");
const SAMPLE_ROW_LIMIT = 10;
/**
 * Read-only preview of a staged migration file (CSV, XLS, XLSX).
 * Does not modify the original file or touch the live database.
 */
async function readMigrationFilePreview(file, options) {
    const full = await (0, readMigrationFileRows_1.readMigrationFileRows)(file, options);
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
