"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Da Silva migration — phase 4: match Kid-e-Sys billing accounts to SA-SAMS learners.
 *
 * Usage:
 *   npx ts-node scripts/da-silva-billing-match.ts [desktopRoot] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../src/prisma");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const daSilvaMigrationStrategy_1 = require("../src/services/daSilvaMigration/daSilvaMigrationStrategy");
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const projectIdArg = process.argv[3] || "";
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
        throw new Error("No manifest — run phases 1–3 first.");
    return manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
}
async function main() {
    const sasams = (0, daSilvaMigrationStrategy_1.resolveDaSilvaSasamsPaths)(desktopRoot);
    const kideesys = (0, daSilvaMigrationStrategy_1.resolveDaSilvaKideesysBillingPaths)(desktopRoot);
    const schoolId = await resolveSchoolId();
    const projectId = await resolveProjectId(schoolId);
    console.log("=== Da Silva migration — billing match (phase 4) ===");
    console.log(`SA-SAMS class lists: ${sasams.classListDir}`);
    console.log(`Kid-e-Sys age analysis: ${kideesys.ageAnalysis}`);
    const result = await (0, daSilvaMigrationService_1.commitDaSilvaBillingMatchOnly)({
        schoolId,
        projectId,
        paths: {
            classListDir: sasams.classListDir,
            ageAnalysis: kideesys.ageAnalysis,
        },
    });
    console.log(`Matched ${result.matched}/${result.totalAccounts} billing accounts`);
    console.log(`Expected ≈ ${daSilvaMigrationService_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT} family accounts after apply`);
    console.log(`Audit: ${result.auditPath}`);
    if (!result.success)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
