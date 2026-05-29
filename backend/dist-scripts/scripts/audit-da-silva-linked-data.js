"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Audit Da Silva Academy learner ↔ family account ↔ ledger linkage.
 *
 * Usage:
 *   npx tsc && node dist/scripts/audit-da-silva-linked-data.js
 *   node dist/scripts/audit-da-silva-linked-data.js [schoolId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const daSilvaSchemaSafe_1 = require("./lib/daSilvaSchemaSafe");
const prisma = new client_1.PrismaClient();
async function resolveSchoolId(cliSchoolId) {
    const hint = String(cliSchoolId || (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)() || "").trim();
    const school = (hint
        ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
        : null) ||
        (await prisma.school.findFirst({
            where: { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
            select: { id: true, name: true },
        })) ||
        (await prisma.school.findFirst({
            where: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
            select: { id: true, name: true },
        }));
    if (!school)
        throw new Error("Da Silva Academy school not found");
    (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(school.id);
    return school;
}
async function main() {
    const cliSchoolId = process.argv[2];
    const school = await resolveSchoolId(cliSchoolId);
    const schoolId = school.id;
    const schemaCaps = await (0, daSilvaSchemaSafe_1.getDaSilvaLearnerSchemaCaps)(prisma);
    const [learnersCount, parentsCount, familyAccountCount, learnersWithFamilyAccountId, learnersWithAdmissionNo, familyAccountsWithLearnersResult, parentLinksResult,] = await Promise.all([
        prisma.learner.count({ where: { schoolId } }),
        prisma.parent.count({ where: { schoolId } }),
        prisma.familyAccount.count({ where: { schoolId } }),
        prisma.learner.count({ where: { schoolId, familyAccountId: { not: null } } }),
        prisma.learner.count({ where: { schoolId, admissionNo: { not: null } } }),
        (0, daSilvaSchemaSafe_1.countFamilyAccountsWithLearnersSafe)(prisma, schoolId),
        (0, daSilvaSchemaSafe_1.countParentLearnerLinksSafe)(prisma, schoolId),
    ]);
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const ledgerBySource = {};
    let ledgerMissingLearnerId = 0;
    for (const entry of ledger) {
        const source = String(entry.source || "unknown");
        ledgerBySource[source] = (ledgerBySource[source] || 0) + 1;
        if (!String(entry.learnerId || "").trim())
            ledgerMissingLearnerId += 1;
    }
    const sampleLearners = await (0, daSilvaSchemaSafe_1.fetchSampleLearnersSafe)(prisma, schoolId, schemaCaps, 10);
    const sampleFamilyAccounts = await prisma.familyAccount.findMany({
        where: { schoolId },
        take: 10,
        orderBy: { accountRef: "asc" },
        select: {
            accountRef: true,
            familyName: true,
            learners: {
                take: 3,
                select: { id: true, firstName: true, lastName: true, admissionNo: true },
            },
        },
    });
    const familyBalances = new Map();
    for (const entry of ledger) {
        const acct = String(entry.accountNo || "").trim();
        if (!acct)
            continue;
        const sign = entry.type === "payment" || entry.type === "credit" ? -1 : 1;
        familyBalances.set(acct, (familyBalances.get(acct) || 0) + sign * Number(entry.amount || 0));
    }
    const sampleAccountsWithBalance = sampleFamilyAccounts.map((fa) => ({
        accountNumber: fa.accountRef,
        name: fa.familyName,
        balance: Math.round((familyBalances.get(fa.accountRef) || 0) * 100) / 100,
        linkedLearners: fa.learners.map((l) => ({
            id: l.id,
            name: `${l.firstName} ${l.lastName}`.trim(),
            admissionNo: l.admissionNo,
        })),
    }));
    const schemaNotes = [
        ...schemaCaps.notes,
        ...(familyAccountsWithLearnersResult.note ? [familyAccountsWithLearnersResult.note] : []),
        ...(parentLinksResult.note ? [parentLinksResult.note] : []),
    ];
    const report = {
        generatedAt: new Date().toISOString(),
        schoolId,
        schoolName: school.name,
        schemaNotes,
        learnersCount,
        parentsCount,
        familyAccountCount,
        learnersWithFamilyAccountId,
        learnersWithAdmissionNo,
        familyAccountsWithLearnerLinks: familyAccountsWithLearnersResult.count,
        parentLearnerLinks: parentLinksResult.count,
        ledgerEntriesCount: ledger.length,
        ledgerEntriesMissingLearnerId: ledgerMissingLearnerId,
        transactionEntriesBySource: ledgerBySource,
        sampleLearners: sampleLearners.map((l) => ({
            firstName: l.firstName,
            lastName: l.lastName,
            className: l.className,
            admissionNo: l.admissionNo,
            familyAccountId: l.familyAccountId,
            displayStatus: l.displayStatus,
            accountRef: l.accountRef,
            parentLinkCount: l.parentLinkCount,
            relationsNote: l.relationsNote,
        })),
        sampleFamilyAccounts: sampleAccountsWithBalance,
    };
    const jsonPath = path_1.default.join(process.cwd(), "audit-da-silva-linked-data.json");
    const txtPath = path_1.default.join(process.cwd(), "audit-da-silva-linked-data.txt");
    fs_1.default.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    const lines = [
        "Da Silva linked-data audit",
        `Generated: ${report.generatedAt}`,
        `School: ${report.schoolName} (${report.schoolId})`,
        ...(schemaNotes.length
            ? ["", "Schema notes:", ...schemaNotes.map((n) => `  ${n}`)]
            : []),
        "",
        `Learners: ${learnersCount}`,
        `Parents: ${parentsCount}`,
        `Family accounts: ${familyAccountCount}`,
        `Learners with familyAccountId: ${learnersWithFamilyAccountId}`,
        `Learners with admissionNo: ${learnersWithAdmissionNo}`,
        `Family accounts with ≥1 learner: ${familyAccountsWithLearnersResult.count}`,
        `Parent–learner links: ${parentLinksResult.count}`,
        "",
        `Ledger entries: ${ledger.length}`,
        `Ledger rows missing learnerId: ${ledgerMissingLearnerId}`,
        "Ledger by source:",
        ...Object.entries(ledgerBySource).map(([k, v]) => `  ${k}: ${v}`),
        "",
        "Sample learners:",
        ...report.sampleLearners.map((l) => {
            const parents = l.parentLinkCount === null
                ? l.relationsNote || "n/a"
                : String(l.parentLinkCount);
            return `  ${l.firstName} ${l.lastName} | status=${l.displayStatus} | class=${l.className || "-"} | adm=${l.admissionNo || "-"} | acct=${l.accountRef || "-"} | parents=${parents}`;
        }),
        "",
        "Sample family accounts:",
        ...report.sampleFamilyAccounts.map((a) => `  ${a.accountNumber} ${a.name} | balance=${a.balance} | learners=${a.linkedLearners.length}`),
    ];
    fs_1.default.writeFileSync(txtPath, lines.join("\n"));
    console.log(lines.join("\n"));
    console.log(`\nWrote ${jsonPath} and ${txtPath}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
