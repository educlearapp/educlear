"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Repair Da Silva learner ↔ family account ↔ ledger links without re-importing.
 *
 * Usage:
 *   npx tsc && node dist/scripts/repair-da-silva-migration-links.js           # dry-run
 *   npx tsc && node dist/scripts/repair-da-silva-migration-links.js --apply
 *   node dist/scripts/repair-da-silva-migration-links.js [schoolId] [--apply]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const relinkDaSilvaLearnerBilling_1 = require("../src/services/daSilvaMigration/relinkDaSilvaLearnerBilling");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const daSilvaSchemaSafe_1 = require("./lib/daSilvaSchemaSafe");
const prisma = new client_1.PrismaClient();
const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv.slice(2).find((a) => a !== "--apply");
async function resolveSchoolId() {
    const hint = String(schoolIdArg || (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)() || "").trim();
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
async function snapshotCounts(schoolId) {
    const [learnersWithFamilyAccountId, learnersWithAdmissionNo, ledgerMissingLearnerId] = await Promise.all([
        prisma.learner.count({ where: { schoolId, familyAccountId: { not: null } } }),
        prisma.learner.count({ where: { schoolId, admissionNo: { not: null } } }),
        Promise.resolve((0, billingLedgerStore_1.readSchoolLedger)(schoolId).filter((e) => !String(e.learnerId || "").trim()).length),
    ]);
    return { learnersWithFamilyAccountId, learnersWithAdmissionNo, ledgerMissingLearnerId };
}
async function main() {
    const school = await resolveSchoolId();
    const schoolId = school.id;
    const schemaCaps = await (0, daSilvaSchemaSafe_1.getDaSilvaLearnerSchemaCaps)(prisma);
    const before = await snapshotCounts(schoolId);
    const latest = (0, relinkDaSilvaLearnerBilling_1.findLatestDaSilvaStagingBundle)(schoolId);
    const projectId = latest?.projectId || "";
    const bundle = latest?.bundle || (0, daSilvaMigrationService_1.loadDaSilvaStaging)(schoolId, projectId);
    const plan = {
        mode: apply ? "apply" : "dry-run",
        schoolId,
        schoolName: school.name,
        schemaNotes: schemaCaps.notes,
        omitEnrollmentStatus: !schemaCaps.enrollmentStatus,
        stagingProjectId: projectId || null,
        hasStagingBundle: Boolean(bundle),
        before,
        actions: [],
    };
    if (!schemaCaps.enrollmentStatus) {
        plan.actions.push("Learner.enrollmentStatus not available in schema — display status defaults to Enrolled; writes skipped");
    }
    if (!apply) {
        plan.actions.push(bundle
            ? "Would relink learners from latest Kid-e-Sys staging bundle"
            : "Would relink learners using database name/admission matching (no staging bundle)");
        plan.actions.push("Would backfill ledger learnerId from accountToLearnerId map");
        const afterEstimate = { ...before };
        if (bundle) {
            afterEstimate.learnersWithFamilyAccountId = bundle.learners.filter((r) => String(r.accountNo || "").trim()).length;
        }
        plan.afterEstimate = afterEstimate;
    }
    else if (bundle) {
        const matchKeyToLearnerId = new Map();
        const accountToLearnerId = new Map();
        const manifest = {
            projectId: bundle.projectId,
            schoolId: bundle.schoolId,
            importedAt: new Date().toISOString(),
            learnerIds: [],
            parentIds: [],
            linkIds: [],
            classroomIds: [],
            employeeIds: [],
            ledgerEntryIds: [],
            matchKeyToLearnerId: {},
            accountToLearnerId: {},
        };
        const result = await (0, relinkDaSilvaLearnerBilling_1.relinkDaSilvaLearnerBillingFromBundle)({
            schoolId,
            bundle,
            manifest,
            matchKeyToLearnerId,
            accountToLearnerId,
            omitEnrollmentStatus: !schemaCaps.enrollmentStatus,
        });
        plan.bundleRelink = result;
    }
    else {
        plan.dbRelink = await (0, relinkDaSilvaLearnerBilling_1.relinkSchoolLearnersToFamilyAccountsByDb)(schoolId);
    }
    const after = apply ? await snapshotCounts(schoolId) : before;
    plan.after = after;
    const jsonPath = path_1.default.join(process.cwd(), "repair-da-silva-migration-links.json");
    fs_1.default.writeFileSync(jsonPath, JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(plan, null, 2));
    console.log(`\nWrote ${jsonPath}`);
    if (!apply) {
        console.log("\nDry run only. Re-run with --apply to persist repairs.");
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
