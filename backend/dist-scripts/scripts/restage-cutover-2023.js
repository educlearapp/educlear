"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Rebuild a saved migration stage with a new cutover date (Da Silva Kid-e-Sys test).
 * Usage: npx tsx scripts/restage-cutover-2023.ts [sourceStageId] [cutoverDate]
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readMigrationFileRows_1 = require("../src/services/migration/core/readMigrationFileRows");
const buildMigrationStage_1 = require("../src/services/migration/staging/buildMigrationStage");
const migrationStageStore_1 = require("../src/services/migration/staging/migrationStageStore");
const sourceStageId = process.argv[2] || "841890ba-f9be-4563-9927-4781e335c1b7";
const cutoverDate = process.argv[3] || "2023-01-01";
function warningsForFilename(filename, stageWarnings) {
    const prefix = `${filename}:`;
    const out = [];
    for (const w of stageWarnings) {
        if (w.startsWith(prefix)) {
            out.push(w.slice(prefix.length).trim());
        }
    }
    return out;
}
async function loadRows(stage) {
    const previews = [];
    const rowsByFileId = new Map();
    const stageWarnings = stage.warnings ?? [];
    for (const file of stage.files) {
        previews.push({
            fileId: file.fileId,
            filename: file.filename,
            category: file.category,
            columns: [],
            sampleRows: [],
            rowCount: file.rowCount,
            warnings: warningsForFilename(file.filename, stageWarnings),
            path: file.path,
        });
        if (file.path && fs_1.default.existsSync(file.path)) {
            const mf = {
                id: file.fileId,
                filename: file.filename,
                mimeType: "application/vnd.ms-excel",
                size: 0,
                uploadedAt: new Date(),
                category: file.category,
                path: file.path,
            };
            const parsed = await (0, readMigrationFileRows_1.readMigrationFileRows)(mf, { sourceSystem: stage.sourceSystem });
            rowsByFileId.set(file.fileId, parsed.rows);
        }
        else {
            rowsByFileId.set(file.fileId, []);
        }
    }
    return { previews, rowsByFileId };
}
async function main() {
    const stagePath = path_1.default.join(process.cwd(), "storage", "migration-stages", `${sourceStageId}.json`);
    if (!fs_1.default.existsSync(stagePath)) {
        console.error(`Stage not found: ${stagePath}`);
        process.exit(1);
    }
    const old = JSON.parse(fs_1.default.readFileSync(stagePath, "utf8"));
    const { previews, rowsByFileId } = await loadRows(old);
    const mappings = (0, buildMigrationStage_1.enrichKidESysTransactionDateMappings)(previews, old.mappings);
    const stage = (0, buildMigrationStage_1.buildMigrationStage)({
        sourceSystem: old.sourceSystem,
        previews,
        mappings,
        validationSummary: old.validationSummary,
        cutoverDate,
        rowsByFileId,
    });
    (0, migrationStageStore_1.createStage)(stage);
    const txFile = old.files.find((f) => /transaction/i.test(f.filename));
    let txDateRange = null;
    if (txFile?.path && fs_1.default.existsSync(txFile.path)) {
        const rows = rowsByFileId.get(txFile.fileId) ?? [];
        let min = null;
        let max = null;
        for (const row of rows) {
            const d = row.Date ?? row.date ?? row["Transaction Date"];
            const s = String(d ?? "").trim();
            if (!s)
                continue;
            if (!min || s < min)
                min = s;
            if (!max || s > max)
                max = s;
        }
        txDateRange = { min, max, rowCount: rows.length };
    }
    console.log(JSON.stringify({
        sourceStageId,
        newStageId: stage.stageId,
        cutoverDate: stage.cutoverDate,
        previousTransactionReadiness: old.transactionReadiness,
        transactionReadiness: stage.transactionReadiness,
        txDateRange,
        canApply: stage.canApply,
    }, null, 2));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
