"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Post-import audit builder (reads batch + DB counts).
 *
 * Usage:
 *   npx tsc
 *   npx tsx scripts/migration-post-import-audit.ts --schoolId <id> --projectId <id> --batchId <batchId>
 */
const migrationImportBatchStore_1 = require("../src/services/migration/core/migrationImportBatchStore");
const migrationAudit_1 = require("../src/services/migration/migrationAudit");
function arg(name) {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1)
        return null;
    const v = process.argv[idx + 1];
    return v ? String(v).trim() : null;
}
async function main() {
    const schoolId = arg("schoolId");
    const projectId = arg("projectId");
    const batchId = arg("batchId");
    if (!schoolId || !projectId || !batchId) {
        console.error("Missing required args: --schoolId, --projectId, --batchId");
        process.exit(1);
    }
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
    if (!batch?.result) {
        console.error(`Batch not found or missing result: ${batchId}`);
        process.exit(1);
    }
    const audit = await (0, migrationAudit_1.buildPostImportAudit)({
        schoolId,
        projectId,
        batchId,
        apply: batch.result,
    });
    console.log(JSON.stringify(audit, null, 2));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
