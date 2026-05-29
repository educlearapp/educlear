"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Post-fix transaction readiness investigation for a saved migration stage.
 * Usage: npx tsx scripts/tx-readiness-investigation.ts [stageId]
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readMigrationFileRows_1 = require("../src/services/migration/core/readMigrationFileRows");
const computeTransactionReadiness_1 = require("../src/services/migration/core/computeTransactionReadiness");
const buildMigrationStage_1 = require("../src/services/migration/staging/buildMigrationStage");
const stageId = process.argv[2] || "119e592c-75f1-4197-a74c-20703df28cce";
const stagePath = path_1.default.join(process.cwd(), "storage", "migration-stages", `${stageId}.json`);
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
async function main() {
    if (!fs_1.default.existsSync(stagePath)) {
        console.error(`Stage not found: ${stagePath}`);
        process.exit(1);
    }
    const stage = JSON.parse(fs_1.default.readFileSync(stagePath, "utf8"));
    const stageWarnings = stage.warnings ?? [];
    const previews = [];
    const rowsByFileId = new Map();
    for (const file of stage.files) {
        const warnings = warningsForFilename(file.filename, stageWarnings);
        previews.push({
            fileId: file.fileId,
            filename: file.filename,
            category: file.category,
            rowCount: file.rowCount,
            columns: [],
            sampleRows: [],
            warnings,
            path: file.path,
        });
        if (file.path && fs_1.default.existsSync(file.path)) {
            const parsed = await (0, readMigrationFileRows_1.readMigrationFileRows)({
                id: file.fileId,
                filename: file.filename,
                mimeType: "application/vnd.ms-excel",
                size: 0,
                uploadedAt: new Date(),
                category: file.category,
                path: file.path,
            }, { sourceSystem: stage.sourceSystem });
            rowsByFileId.set(file.fileId, parsed.rows);
        }
        else {
            console.warn(`Missing file path for ${file.filename}`);
            rowsByFileId.set(file.fileId, []);
        }
    }
    const mappings = (0, buildMigrationStage_1.enrichKidESysTransactionDateMappings)(previews, stage.mappings);
    const report = (0, computeTransactionReadiness_1.investigateTransactionReadiness)({
        previews,
        mappings,
        rowsByFileId,
        cutoverDate: stage.cutoverDate ?? null,
        sampleLimit: 5,
    });
    const { counts } = report;
    const summary = {
        learnerIndexTotal: report.learnerIndexTotal,
        learnerIndexActive: report.learnerIndexActive,
        learnerIndexUnknown: report.learnerIndexUnknown,
        eligibleActive: counts.eligibleActiveTransactions,
        blocked: counts.blockedTransactions,
        historicalOnly: counts.historicalOnlyTransactions,
        unmatched: counts.unmatchedTransactions,
        sampleEligibleRows: report.sampleEligibleRows,
    };
    console.log(JSON.stringify(summary, null, 2));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
