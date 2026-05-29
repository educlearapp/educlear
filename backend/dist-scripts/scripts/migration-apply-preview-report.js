"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Print apply expectations for a dry-run stage (read-only preview).
 *
 * Usage: npx tsc && node dist/scripts/migration-apply-preview-report.js <stageId> <targetSchoolId>
 */
const migrationStageStore_1 = require("../src/services/migration/staging/migrationStageStore");
const computeMigrationApplyPreview_1 = require("../src/services/migration/core/computeMigrationApplyPreview");
async function main() {
    const stageId = String(process.argv[2] || "").trim();
    const targetSchoolId = String(process.argv[3] || "").trim();
    if (!stageId || !targetSchoolId) {
        console.error("Usage: node dist/scripts/migration-apply-preview-report.js <stageId> <targetSchoolId>");
        process.exit(1);
    }
    const stage = (0, migrationStageStore_1.getStage)(stageId);
    if (!stage) {
        console.error(`Stage not found: ${stageId}`);
        process.exit(1);
    }
    const expectations = await (0, computeMigrationApplyPreview_1.computeMigrationApplyPreview)(stage, targetSchoolId);
    console.log(JSON.stringify(expectations, null, 2));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
