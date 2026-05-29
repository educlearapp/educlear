"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Universal migration import (requires a passed dry run stage).
 *
 * Usage:
 *   npx tsc
 *   npx tsx scripts/migration-import.ts --schoolId <id> --projectId <id> --source <...> --stageId <stageId>
 */
const migrationImporter_1 = require("../src/services/migration/migrationImporter");
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
    const stageId = arg("stageId");
    const proceed = arg("proceedWithEligibleActiveOnly") === "true";
    if (!schoolId || !projectId || !stageId) {
        console.error("Missing required args: --schoolId, --projectId, --stageId");
        process.exit(1);
    }
    const result = await (0, migrationImporter_1.runMigrationImport)({
        schoolId,
        projectId,
        stageId,
        confirmDryRunPassed: true,
        proceedWithEligibleActiveOnly: proceed,
    });
    console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
