"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Kid-e-Sys official CSV export — dry-run (zero database writes).
 *
 *   npx tsx scripts/kideesys-csv-dry-run.ts --source "/path/to/csv-folder-or.zip" --schoolId "..."
 */
require("dotenv/config");
const client_1 = require("@prisma/client");
const kideesysCsvAudit_1 = require("../src/services/daSilvaMigration/kideesysCsv/kideesysCsvAudit");
const prisma = new client_1.PrismaClient();
function parseArgs(argv) {
    let source = "";
    let schoolId = "";
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--source" && argv[i + 1])
            source = argv[++i];
        else if (argv[i] === "--schoolId" && argv[i + 1])
            schoolId = argv[++i];
    }
    if (!source)
        source = String(process.env.KIDESYS_CSV_SOURCE || "").trim();
    if (!schoolId)
        schoolId = String(process.env.KIDESYS_SCHOOL_ID || "").trim();
    return { source, schoolId };
}
async function main() {
    const { source, schoolId } = parseArgs(process.argv.slice(2));
    if (!source) {
        throw new Error("Provide --source <zipOrDir> (or KIDESYS_CSV_SOURCE)");
    }
    if (!schoolId) {
        throw new Error("Provide --schoolId <id> (or KIDESYS_SCHOOL_ID)");
    }
    const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error(`School not found: ${schoolId}`);
    console.log(`School: ${school.name} (${school.id})`);
    console.log(`Source: ${source}`);
    const result = (0, kideesysCsvAudit_1.runKidESysCsvDryRun)(source);
    (0, kideesysCsvAudit_1.printKidESysCsvDryRunReport)(result);
    if (!result.passed)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
