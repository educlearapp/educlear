"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Debug Da Silva staging upload manifest — paths, readability, parser smoke checks.
 *
 * Usage:
 *   npx tsx scripts/debug-da-silva-manifest.ts [schoolId] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaUploadManifest_1 = require("../src/services/daSilvaMigration/daSilvaUploadManifest");
const daSilvaMigrationPreview_1 = require("../src/services/daSilvaMigration/daSilvaMigrationPreview");
const daSilvaParentLearnerMatching_1 = require("../src/services/daSilvaMigration/daSilvaParentLearnerMatching");
const sasamsParsers_1 = require("../src/services/daSilvaMigration/sasamsParsers");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function findLatestProjectId(schoolId) {
    const schoolDir = path_1.default.join(STAGING_ROOT, schoolId);
    if (!fs_1.default.existsSync(schoolDir))
        return null;
    const projectDirs = fs_1.default
        .readdirSync(schoolDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("dasilva-"))
        .map((d) => d.name)
        .sort()
        .reverse();
    for (const dir of projectDirs) {
        const manifest = path_1.default.join(schoolDir, dir, "uploads", "manifest.json");
        if (fs_1.default.existsSync(manifest))
            return dir;
    }
    return projectDirs[0] || null;
}
async function main() {
    const schoolId = (process.argv[2] || process.env.DA_SILVA_SCHOOL_ID || "").trim();
    let projectId = (process.argv[3] || "").trim();
    if (!schoolId) {
        console.error("Usage: npx tsx scripts/debug-da-silva-manifest.ts <schoolId> [projectId]");
        process.exit(1);
    }
    if (!projectId) {
        projectId = findLatestProjectId(schoolId) || "";
        if (!projectId) {
            console.error(`No Da Silva project found under ${STAGING_ROOT}/${schoolId}`);
            process.exit(1);
        }
        console.log(`Latest projectId: ${projectId}`);
    }
    const manifestPath = (0, daSilvaUploadManifest_1.stagingUploadManifestPath)(schoolId, projectId);
    console.log(`Manifest path: ${manifestPath}`);
    console.log(`Manifest exists: ${fs_1.default.existsSync(manifestPath)}`);
    const report = (0, daSilvaUploadManifest_1.buildDaSilvaManifestDebugReport)(schoolId, projectId);
    console.log("\n=== Manifest slots ===");
    for (const slot of report.slots) {
        console.log(`${slot.slot}: exists=${slot.exists} readable=${slot.readable} size=${slot.size} path=${slot.path || "—"}`);
    }
    console.log(`\nClass list count: ${report.classListsCount}`);
    console.log(`Class list filenames: ${report.classListFilenames.join(", ") || "(none)"}`);
    if (report.manifestErrors.length) {
        console.log("\nManifest errors:");
        for (const err of report.manifestErrors)
            console.log(`  • ${err}`);
    }
    if (!report.manifestReady) {
        console.error("\nManifest not ready — fix uploads before running parsers.");
        process.exit(1);
    }
    const manifest = (0, daSilvaUploadManifest_1.loadStagingUploadManifest)(schoolId, projectId);
    const paths = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(manifest);
    const { learners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(paths.classListDir);
    console.log(`\nSA-SAMS class parser learners: ${learners.length}`);
    const merged = (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)({
        classListDir: paths.classListDir,
        learnerRegister: paths.learnerRegister,
        parentRegister: paths.parentRegister,
    });
    console.log(`SA-SAMS merged learners (with register): ${merged.length}`);
    const parentLinks = (0, sasamsParsers_1.parseSasamsParentLearnerLinks)(paths.parentLearnerLinks);
    console.log(`Parent link rows parsed: ${parentLinks.length}`);
    const dbLearners = merged.map((r) => ({
        id: r.matchKey,
        firstName: r.firstName,
        lastName: r.lastName,
        className: r.canonicalClassName,
        admissionNo: r.admissionNo,
        idNumber: r.idNumber,
    }));
    const combined = (0, sasamsParsers_1.parseSasamsParentSources)(paths.parentRegister, paths.parentLearnerLinks);
    const audit = (0, daSilvaParentLearnerMatching_1.auditParentMatches)(combined, dbLearners);
    const matched = audit.rows.filter((r) => r.matched).length;
    console.log(`Parent link matches: ${matched}/${combined.length}`);
    const billingPreview = await (0, daSilvaMigrationPreview_1.previewDaSilvaKideesysBillingMatch)({ schoolId, projectId });
    console.log(`Billing match preview: ${billingPreview.matchedAccounts}/${billingPreview.totalAccounts} matched`);
    if (billingPreview.errors.length) {
        console.log("Billing preview errors:");
        for (const err of billingPreview.errors)
            console.log(`  • ${err}`);
    }
}
main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
