"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Post-import audit for Kid-e-Sys CSV migration.
 *
 *   npx tsx scripts/kideesys-csv-post-import-audit.ts --schoolId "..."
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const kideesysCsvAudit_1 = require("../src/services/daSilvaMigration/kideesysCsv/kideesysCsvAudit");
const prisma = new client_1.PrismaClient();
function parseArgs(argv) {
    let schoolId = "";
    let source;
    let projectId;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--schoolId" && argv[i + 1])
            schoolId = argv[++i];
        else if (argv[i] === "--source" && argv[i + 1])
            source = argv[++i];
        else if (argv[i] === "--projectId" && argv[i + 1])
            projectId = argv[++i];
    }
    if (!schoolId)
        schoolId = String(process.env.KIDESYS_SCHOOL_ID || "").trim();
    return { schoolId, source, projectId };
}
function printAudit(audit) {
    console.log("\n=== Kid-e-Sys CSV post-import audit ===\n");
    console.log(`School: ${audit.schoolId}`);
    console.log(`Learners: ${audit.learnersTotal}`);
    console.log(`  name populated: ${audit.namePopulatedCount}`);
    console.log(`  surname populated: ${audit.surnamePopulatedCount}`);
    console.log(`  DOB populated: ${audit.learnersWithDob}`);
    console.log(`  gender populated: ${audit.learnersWithGender}`);
    console.log(`  ID populated: ${audit.idPopulatedCount}`);
    console.log(`  classroom populated: ${audit.classroomPopulatedCount}`);
    console.log(`Parent links: ${audit.parentLinksTotal}`);
    console.log(`Family accounts: ${audit.familyAccountsCount}`);
    console.log(`Ledger invoices: ${audit.ledgerInvoiceCount}`);
    console.log(`Ledger payments: ${audit.ledgerPaymentCount}`);
    console.log(`Duplicate ledger IDs: ${audit.duplicateLedgerIds}`);
    console.log(`Statements w/ last invoice: ${audit.accountsWithLastInvoice}`);
    console.log(`Statements w/ last payment: ${audit.accountsWithLastPayment}`);
    console.log(`Balance reconcile: ${audit.balanceReconcilePassed} passed, ${audit.balanceReconcileFailed} failed`);
    if (audit.gateErrors.length) {
        console.log("\nGate errors:");
        for (const err of audit.gateErrors)
            console.log(`  ✗ ${err}`);
    }
    console.log(`\nAudit: ${audit.gatePassed ? "PASSED" : "FAILED"}\n`);
}
async function main() {
    const { schoolId, source, projectId } = parseArgs(process.argv.slice(2));
    if (!schoolId)
        throw new Error("Provide --schoolId <id>");
    const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error(`School not found: ${schoolId}`);
    const audit = await (0, kideesysCsvAudit_1.auditKidESysCsvImport)({ schoolId, sourcePath: source, projectId });
    printAudit(audit);
    const outPath = path_1.default.join(process.cwd(), "kideesys-csv-post-import-audit.json");
    fs_1.default.writeFileSync(outPath, JSON.stringify(audit, null, 2));
    console.log(`Report written: ${outPath}`);
    if (!audit.gatePassed)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
