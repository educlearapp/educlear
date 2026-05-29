"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Dry-run all Da Silva migration phase gates (Phase 1–5) without writing data.
 *
 * Usage:
 *   npx tsx scripts/debug-da-silva-all-phase-gates.ts [schoolId] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../src/prisma");
const daSilvaConstants_1 = require("../src/services/daSilvaMigration/daSilvaConstants");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const daSilvaPhaseGates_1 = require("../src/services/daSilvaMigration/daSilvaPhaseGates");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaUploadManifest_1 = require("../src/services/daSilvaMigration/daSilvaUploadManifest");
const parsers_1 = require("../src/services/daSilvaMigration/parsers");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function findLatestProjectId(schoolId) {
    const schoolDir = path_1.default.join(STAGING_ROOT, schoolId);
    if (!fs_1.default.existsSync(schoolDir))
        return null;
    const manifestFiles = fs_1.default
        .readdirSync(schoolDir)
        .filter((f) => f.startsWith("dasilva-") && f.endsWith(".manifest.json"))
        .map((f) => ({
        file: f,
        mtime: fs_1.default.statSync(path_1.default.join(schoolDir, f)).mtimeMs,
    }))
        .sort((a, b) => b.mtime - a.mtime);
    if (manifestFiles.length) {
        return manifestFiles[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
    }
    const projectDirs = fs_1.default
        .readdirSync(schoolDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("dasilva-"))
        .map((d) => d.name)
        .sort()
        .reverse();
    return projectDirs[0] || null;
}
async function resolveSchoolId(arg) {
    if (arg)
        return arg;
    const school = await prisma_1.prisma.school.findFirst({
        where: { name: daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
        select: { id: true },
    });
    if (!school)
        throw new Error(`School not found: ${daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName}`);
    return school.id;
}
function printGate(result) {
    console.log(`\n=== ${result.label} ===`);
    console.log(`Status: ${result.passed ? "PASS" : "FAIL"}`);
    console.log("Expected:", JSON.stringify(result.expected, null, 2));
    console.log("Actual:", JSON.stringify(result.actual, null, 2));
    if (result.blocker) {
        console.log(`Blocker: ${result.blocker}`);
    }
}
async function main() {
    let schoolId = (process.argv[2] || "").trim();
    let projectId = (process.argv[3] || "").trim();
    schoolId = await resolveSchoolId(schoolId);
    if (!projectId) {
        projectId = findLatestProjectId(schoolId) || "";
    }
    console.log("=== Da Silva migration — all phase gates (dry run) ===");
    console.log(`School ID: ${schoolId}`);
    console.log(`Project ID: ${projectId || "(none)"}`);
    const importManifest = projectId ? (0, daSilvaMigrationService_1.loadDaSilvaManifest)(schoolId, projectId) : null;
    const phasesCompleted = importManifest?.phasesCompleted || [];
    let manifestReady = false;
    let sasamsClassListFileCount;
    let sasamsClassListLearnerCount;
    let sasamsValidationPassed;
    let billingTotal = 0;
    let billingMatched = 0;
    if (projectId) {
        try {
            const stagingManifest = (0, daSilvaUploadManifest_1.loadStagingUploadManifest)(schoolId, projectId);
            const gate = (0, daSilvaUploadManifest_1.assertDaSilvaMigrationManifestReady)(stagingManifest);
            manifestReady = gate.ready;
            const staged = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(stagingManifest);
            if (fs_1.default.existsSync(staged.classListDir)) {
                const validation = (0, daSilvaMigrationService_1.validateDaSilvaClassroomsFromKidESys)(staged.classListDir);
                sasamsValidationPassed = validation.passed;
                sasamsClassListFileCount = validation.sourceFileCount;
                sasamsClassListLearnerCount = validation.totalLearners;
            }
            if (fs_1.default.existsSync(staged.ageAnalysis)) {
                const accounts = (0, parsers_1.parseAgeAnalysisFile)(staged.ageAnalysis);
                billingTotal = accounts.length;
            }
        }
        catch (e) {
            console.log(`Staging manifest: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const classroomRows = await prisma_1.prisma.classroom.findMany({
        where: { schoolId },
        select: { name: true },
        orderBy: { name: "asc" },
    });
    const classroomNames = classroomRows.map((c) => c.name);
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId },
        select: { className: true },
    });
    const crecheLearnerCount = learners.filter((l) => (0, daSilvaConstants_1.isAllowedDaSilvaSupplementClassroom)(String(l.className || ""))).length;
    const parentLinkCount = await prisma_1.prisma.parentLearnerLink.count({ where: { schoolId } });
    const learnersWithFamilyAccount = await prisma_1.prisma.learner.count({
        where: { schoolId, familyAccountId: { not: null } },
    });
    if (importManifest?.accountToLearnerId) {
        billingMatched = Object.keys(importManifest.accountToLearnerId).length;
    }
    else if (learnersWithFamilyAccount > 0) {
        billingMatched = learnersWithFamilyAccount;
    }
    const snapshot = {
        classroomNames,
        learnerCount: learners.length,
        crecheLearnerCount,
        parentLinkCount,
        billingMatched,
        billingTotal,
        phasesCompleted,
        manifestReady,
        sasamsClassListFileCount,
        sasamsClassListLearnerCount,
        sasamsValidationPassed,
    };
    console.log("\nDatabase snapshot:");
    console.log(`  Classrooms: ${classroomNames.length} (${classroomNames.join(", ") || "—"})`);
    console.log(`  Learners: ${learners.length} (Crèche: ${crecheLearnerCount})`);
    console.log(`  Parent links: ${parentLinkCount}`);
    console.log(`  Billing matched: ${billingMatched}/${billingTotal || "?"}`);
    console.log(`  Phases completed: ${phasesCompleted.join(", ") || "(none)"}`);
    const results = (0, daSilvaPhaseGates_1.evaluateAllDaSilvaPhaseGates)(snapshot);
    for (const result of results) {
        printGate(result);
    }
    const failed = results.filter((r) => !r.passed);
    console.log(`\n=== Summary ===`);
    console.log(`Passed: ${results.length - failed.length}/${results.length}`);
    if (failed.length) {
        console.log("Failed phases:");
        for (const result of failed) {
            console.log(`  - ${result.label}: ${result.blocker}`);
        }
        process.exitCode = 1;
    }
    else {
        console.log("All phase gates passed.");
    }
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
