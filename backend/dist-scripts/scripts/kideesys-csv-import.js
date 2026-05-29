"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Kid-e-Sys official CSV export — real import (idempotent).
 *
 *   npx tsx scripts/kideesys-csv-import.ts --source "/path" --schoolId "..."
 */
require("dotenv/config");
const client_1 = require("@prisma/client");
const kideesysCsvAudit_1 = require("../src/services/daSilvaMigration/kideesysCsv/kideesysCsvAudit");
const kideesysCsvImporter_1 = require("../src/services/daSilvaMigration/kideesysCsv/kideesysCsvImporter");
const prisma = new client_1.PrismaClient();
function parseArgs(argv) {
    let source = "";
    let schoolId = "";
    let projectId;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--source" && argv[i + 1])
            source = argv[++i];
        else if (argv[i] === "--schoolId" && argv[i + 1])
            schoolId = argv[++i];
        else if (argv[i] === "--projectId" && argv[i + 1])
            projectId = argv[++i];
    }
    if (!source)
        source = String(process.env.KIDESYS_CSV_SOURCE || "").trim();
    if (!schoolId)
        schoolId = String(process.env.KIDESYS_SCHOOL_ID || "").trim();
    return { source, schoolId, projectId };
}
async function main() {
    const { source, schoolId, projectId } = parseArgs(process.argv.slice(2));
    if (!source)
        throw new Error("Provide --source <zipOrDir>");
    if (!schoolId)
        throw new Error("Provide --schoolId <id>");
    const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error(`School not found: ${schoolId}`);
    console.log(`School: ${school.name} (${school.id})`);
    console.log(`Source: ${source}`);
    const dryRun = (0, kideesysCsvAudit_1.runKidESysCsvDryRun)(source);
    (0, kideesysCsvAudit_1.printKidESysCsvDryRunReport)(dryRun);
    if (!dryRun.passed) {
        console.error("Dry-run failed — import aborted.");
        process.exit(1);
    }
    const result = await (0, kideesysCsvImporter_1.importKidESysCsv)({
        schoolId,
        sourcePath: source,
        projectId,
        dryRun: false,
    });
    console.log("\nImported:");
    for (const [key, value] of Object.entries(result.imported)) {
        console.log(`  ${key}: ${value}`);
    }
    console.log(`Project: ${result.projectId}`);
    if (result.backupPath)
        console.log(`Backup: ${result.backupPath}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
