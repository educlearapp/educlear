"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Da Silva migration — phase 3: SA-SAMS parents + parent-learner links.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-parents-only.ts [desktopRoot] [projectId]
 *
 * Requires phases 1–2. Does NOT import Kid-e-Sys billing or family accounts (phase 4).
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../src/prisma");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const daSilvaMigrationStrategy_1 = require("../src/services/daSilvaMigration/daSilvaMigrationStrategy");
const learnerBillingPlanStore_1 = require("../src/utils/learnerBillingPlanStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const projectIdArg = process.argv[3] || "";
const sasamsPaths = (0, daSilvaMigrationStrategy_1.resolveDaSilvaSasamsPaths)(desktopRoot);
const SCHOOL_NAME = daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;
async function resolveSchoolId() {
    const existing = await prisma_1.prisma.school.findFirst({
        where: { name: SCHOOL_NAME },
        select: { id: true },
    });
    if (!existing)
        throw new Error(`School not found: ${SCHOOL_NAME}`);
    return existing.id;
}
async function resolveProjectId(schoolId) {
    if (projectIdArg)
        return projectIdArg;
    const stagingRoot = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
    const manifests = fs_1.default
        .readdirSync(stagingRoot)
        .filter((f) => f.endsWith(".manifest.json"))
        .map((f) => ({ file: f, mtime: fs_1.default.statSync(path_1.default.join(stagingRoot, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    if (!manifests.length)
        throw new Error("No manifest — run phase 1 first.");
    return manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
}
async function main() {
    if (!fs_1.default.existsSync(sasamsPaths.parentRegister)) {
        console.error(`SA-SAMS parent register not found: ${sasamsPaths.parentRegister}`);
        process.exit(1);
    }
    const schoolId = await resolveSchoolId();
    const projectId = await resolveProjectId(schoolId);
    console.log("=== Da Silva migration — SA-SAMS parents (phase 3) ===");
    console.log(`Parent register: ${sasamsPaths.parentRegister}`);
    const result = await (0, daSilvaMigrationService_1.commitDaSilvaParentsOnly)({
        schoolId,
        projectId,
        paths: {
            parentRegister: sasamsPaths.parentRegister,
            parentLearnerLinks: sasamsPaths.parentRegister.replace(/parent_register\.xls$/i, "parent_learner_links.xls"),
        },
    });
    console.log(`Parents: ${result.imported.parents}, links: ${result.imported.links}`);
    console.log(`Unmatched parents (staging): ${result.stagingValidation.unmatchedParents}`);
    console.log(`Family accounts (must be 0): ${result.imported.familyAccounts}`);
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId).length;
    const plans = Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).length;
    if (ledger > 0 || plans > 0) {
        throw new Error("Phase 3 violation: billing data must not exist yet");
    }
    if (!result.success)
        process.exit(1);
    console.log("\nSTOPPED after parents — ready for phase 4 (billing match).");
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
