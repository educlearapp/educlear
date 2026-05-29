"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Roll back an import batch, optionally restore from pre-import backup.
 *
 * Usage:
 *   npx tsc
 *   npx tsx scripts/migration-rollback.ts --schoolId <id> --projectId <id> --batchId <batchId>
 *   npx tsx scripts/migration-rollback.ts --schoolId <id> --projectId <id> --restoreFromBackup true
 */
const migrationRollback_1 = require("../src/services/migration/migrationRollback");
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
    const batchId = arg("batchId") || undefined;
    const restoreFromBackup = arg("restoreFromBackup") === "true";
    const backupFilename = arg("backupFilename") || undefined;
    if (!schoolId || !projectId) {
        console.error("Missing required args: --schoolId and --projectId");
        process.exit(1);
    }
    const result = await (0, migrationRollback_1.runMigrationRollback)({
        schoolId,
        projectId,
        batchId,
        restoreFromBackup,
        backupFilename,
    });
    console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
