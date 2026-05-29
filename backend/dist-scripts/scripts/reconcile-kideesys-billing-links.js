"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Universal Kid-e-Sys billing link repair (dry-run by default).
 *
 * Usage:
 *   npx tsx scripts/reconcile-kideesys-billing-links.ts [schoolId]
 *   npx tsx scripts/reconcile-kideesys-billing-links.ts [schoolId] --apply
 *   npx tsx scripts/reconcile-kideesys-billing-links.ts [schoolId] --apply --skip-gate
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const kideesysBillingReconciliation_1 = require("../src/services/kideesysMigration/kideesysBillingReconciliation");
const prisma = new client_1.PrismaClient();
const apply = process.argv.includes("--apply");
const skipGate = process.argv.includes("--skip-gate");
const schoolIdArg = process.argv
    .slice(2)
    .find((a) => !a.startsWith("--"));
async function resolveSchoolId() {
    const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
    const school = (hint
        ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
        : null) ||
        (await prisma.school.findFirst({
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true },
        }));
    if (!school)
        throw new Error("School not found — pass schoolId");
    return school;
}
function printAudit(label, audit) {
    console.log(`${label}: gate ${audit.gatePassed ? "PASSED" : "FAILED"}`);
    if (audit.gateErrors.length) {
        for (const err of audit.gateErrors)
            console.log(`  - ${err}`);
    }
}
async function main() {
    const school = await resolveSchoolId();
    const result = await (0, kideesysBillingReconciliation_1.reconcileKideesysBillingLinks)({
        schoolId: school.id,
        apply,
        skipGate,
    });
    const outPath = path_1.default.join(process.cwd(), "reconcile-kideesys-billing-links.json");
    fs_1.default.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
        mode: result.mode,
        schoolId: result.schoolId,
        schoolName: school.name,
        stagingProjectId: result.stagingProjectId,
        repairs: {
            ...result.repairs,
            fallbackBillingIdentities: result.repairs.fallbackBillingIdentities ?? {
                learnersRepaired: 0,
                familyAccountsCreated: 0,
            },
        },
        before: {
            gatePassed: result.auditBefore.gatePassed,
            gateErrors: result.auditBefore.gateErrors,
            learnersWithResolvableAccountNo: result.auditBefore.learnersWithResolvableAccountNo,
            ledgerUnresolvable: result.auditBefore.ledgerRowsUnresolvable,
            statementRowsWithAccountDash: result.auditBefore.statementRowsWithAccountDash,
        },
        after: {
            gatePassed: result.auditAfter.gatePassed,
            gateErrors: result.auditAfter.gateErrors,
            learnersWithResolvableAccountNo: result.auditAfter.learnersWithResolvableAccountNo,
            ledgerUnresolvable: result.auditAfter.ledgerRowsUnresolvable,
            statementRowsWithAccountDash: result.auditAfter.statementRowsWithAccountDash,
            nonZeroBalanceAccountCount: result.auditAfter.nonZeroBalanceAccountCount,
        },
    }, null, 2));
    printAudit("Before", result.auditBefore);
    printAudit("After", result.auditAfter);
    console.log(`\nWrote ${outPath}`);
    if (!apply) {
        console.log("\nDry run only. Re-run with --apply to persist repairs.");
        return;
    }
    if (!result.auditAfter.gatePassed && !skipGate)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
