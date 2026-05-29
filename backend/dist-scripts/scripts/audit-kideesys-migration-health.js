"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Kid-e-Sys migration billing health audit (read-only).
 *
 * Usage:
 *   npx tsx scripts/audit-kideesys-migration-health.ts [schoolId]
 *   npx tsx scripts/audit-kideesys-migration-health.ts [schoolId] --json
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const kideesysBillingReconciliation_1 = require("../src/services/kideesysMigration/kideesysBillingReconciliation");
const prisma = new client_1.PrismaClient();
const jsonOut = process.argv.includes("--json");
const schoolIdArg = process.argv.slice(2).find((a) => a !== "--json");
async function resolveSchoolId() {
    const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
    if (hint) {
        const school = await prisma.school.findUnique({ where: { id: hint }, select: { id: true } });
        if (school)
            return school.id;
    }
    const recent = await prisma.learner.groupBy({
        by: ["schoolId"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 1,
    });
    if (!recent.length)
        throw new Error("No schoolId provided and no learners in database");
    return recent[0].schoolId;
}
function printHuman(audit) {
    console.log("Kid-e-Sys migration health audit");
    console.log("================================");
    console.log(`School: ${audit.schoolId}`);
    console.log(`At:     ${audit.auditedAt}`);
    console.log("");
    console.log(`Learners total:                    ${audit.learnersTotal}`);
    console.log(`Learners with admissionNo:         ${audit.learnersWithAdmissionNo}`);
    console.log(`Learners with resolvable accountNo: ${audit.learnersWithResolvableAccountNo}`);
    console.log(`Learners with familyAccountId:     ${audit.learnersWithFamilyAccountId}`);
    console.log(`Active learners missing account:   ${audit.activeLearnersMissingAccountWhenSourceHas}`);
    console.log("");
    console.log(`Family accounts total:             ${audit.familyAccountsTotal}`);
    console.log(`Family accounts linked:            ${audit.familyAccountsLinkedToLearners}`);
    console.log(`Family accounts orphaned:          ${audit.familyAccountsOrphaned}`);
    console.log("");
    console.log(`Ledger / history rows total:       ${audit.ledgerRowsTotal}`);
    console.log(`Ledger linked by accountNo:        ${audit.ledgerRowsLinkedByAccountNo}`);
    console.log(`Ledger linked by learnerId:        ${audit.ledgerRowsLinkedByLearnerId}`);
    console.log(`Ledger unresolvable:               ${audit.ledgerRowsUnresolvable}`);
    console.log(`Kid-e-Sys history rows:            ${audit.kidesysHistoryRowsTotal}`);
    console.log("");
    console.log(`Statement rows accountNo "-":      ${audit.statementRowsWithAccountDash}`);
    console.log(`Duplicate statement account keys:  ${audit.duplicateStatementAccountKeys}`);
    console.log(`Duplicate payment ledger ids:      ${audit.duplicatePaymentLedgerIds}`);
    console.log(`Accounts with non-zero balance:    ${audit.nonZeroBalanceAccountCount}`);
    console.log(`Source account numbers in bundle:  ${audit.sourceAccountNumbersInBundle}`);
    if (audit.ageAnalysisParseAudit) {
        const pa = audit.ageAnalysisParseAudit;
        console.log("");
        console.log("Age Analysis parser audit (from staging bundle):");
        console.log(`  Rows parsed:              ${pa.ageAnalysisRowsParsed}`);
        console.log(`  Account numbers parsed:   ${pa.accountNumbersParsed}`);
        console.log(`  Learners matched:         ${pa.learnersMatchedFromAgeAnalysis ?? "n/a"}`);
        console.log(`  Learners not matched:     ${pa.learnersNotMatchedFromAgeAnalysis ?? "n/a"}`);
        console.log(`  Multi-learner accounts:   ${pa.accountsWithMultipleLearners}`);
    }
    console.log("");
    console.log(`Completion gate: ${audit.gatePassed ? "PASSED" : "FAILED"}`);
    if (audit.gateErrors.length) {
        console.log("Gate errors:");
        for (const err of audit.gateErrors)
            console.log(`  - ${err}`);
    }
    if (audit.brokenSamples.length) {
        console.log("");
        console.log("Sample broken rows:");
        for (const sample of audit.brokenSamples) {
            console.log(`  [${sample.kind}] ${sample.reason}` +
                (sample.id ? ` (id=${sample.id})` : "") +
                (sample.accountNo ? ` accountNo=${sample.accountNo}` : ""));
        }
    }
}
async function main() {
    const schoolId = await resolveSchoolId();
    const audit = await (0, kideesysBillingReconciliation_1.auditKideesysMigrationHealth)(schoolId);
    const outPath = path_1.default.join(process.cwd(), "kideesys-migration-health-audit.json");
    fs_1.default.writeFileSync(outPath, JSON.stringify(audit, null, 2));
    if (jsonOut) {
        console.log(JSON.stringify(audit, null, 2));
    }
    else {
        printHuman(audit);
        console.log(`\nWrote ${outPath}`);
    }
    if (!audit.gatePassed)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
