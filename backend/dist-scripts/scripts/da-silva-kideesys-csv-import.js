"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Da Silva — canonical Kid-e-Sys CSV/ZIP import (official export).
 *
 * Does not replace SA-SAMS / spreadsheet migration routes; runs the CSV layer only.
 *
 * Usage:
 *   npx tsx scripts/da-silva-kideesys-csv-import.ts <zipOrDir> [schoolId] [projectId]
 *   npx tsx scripts/da-silva-kideesys-csv-import.ts <zipOrDir> --dry-run
 *
 * Environment:
 *   KIDESYS_CSV_SOURCE   — default path when first arg omitted
 *   KIDESYS_SCHOOL_ID    — school id when omitted
 */
require("dotenv/config");
const client_1 = require("@prisma/client");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const daSilvaKidESysCsvImporter_1 = require("../src/services/daSilvaMigration/daSilvaKidESysCsvImporter");
const prisma = new client_1.PrismaClient();
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const positional = argv.filter((a) => a !== "--dry-run");
async function resolveSchoolId(hint) {
    const id = String(hint || process.env.KIDESYS_SCHOOL_ID || "").trim();
    if (id) {
        const school = await prisma.school.findUnique({ where: { id }, select: { id: true, name: true } });
        if (school)
            return school.id;
    }
    const byName = await prisma.school.findFirst({
        where: { name: daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
        select: { id: true },
    });
    if (byName)
        return byName.id;
    throw new Error(`School not found (${hint || daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName}). Pass schoolId or set KIDESYS_SCHOOL_ID.`);
}
async function main() {
    const sourcePath = String(positional[0] || process.env.KIDESYS_CSV_SOURCE || "").trim();
    if (!sourcePath) {
        throw new Error("Provide path to Kid-e-Sys export ZIP or folder (arg 1 or KIDESYS_CSV_SOURCE)");
    }
    const schoolId = await resolveSchoolId(positional[1] || "");
    const projectId = positional[2] || undefined;
    console.log(`Kid-e-Sys CSV import — school ${schoolId}${dryRun ? " (dry-run)" : ""}`);
    console.log(`Source: ${sourcePath}`);
    const result = await (0, daSilvaKidESysCsvImporter_1.importDaSilvaKidESysCsv)({
        schoolId,
        sourcePath,
        projectId,
        dryRun,
    });
    console.log("\nImported:");
    for (const [key, value] of Object.entries(result.imported)) {
        console.log(`  ${key}: ${value}`);
    }
    console.log(`\nProject: ${result.projectId}`);
    if (!dryRun) {
        const audit = await (0, daSilvaKidESysCsvImporter_1.auditDaSilvaKidESysCsvImport)({
            schoolId,
            sourcePath,
            projectId: result.projectId,
        });
        console.log(`\nPost-import audit: ${audit.gatePassed ? "PASSED" : "FAILED"}`);
        if (audit.gateErrors.length) {
            for (const err of audit.gateErrors)
                console.log(`  - ${err}`);
        }
        if (!audit.gatePassed)
            process.exit(1);
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
