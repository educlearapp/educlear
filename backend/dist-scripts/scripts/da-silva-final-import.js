"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Da Silva Academy — protected final import (no rollback).
 * Requires CONFIRM_DA_SILVA_FINAL_IMPORT=true.
 *
 * Usage:
 *   CONFIRM_DA_SILVA_FINAL_IMPORT=true npx ts-node scripts/da-silva-final-import.ts [desktopRoot]
 */
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../src/prisma");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const SCHOOL_NAME = daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
async function resolveSchoolId() {
    const existing = await prisma_1.prisma.school.findFirst({
        where: { name: SCHOOL_NAME },
        select: { id: true, name: true },
    });
    if (existing)
        return existing.id;
    const created = await prisma_1.prisma.school.create({
        data: { name: SCHOOL_NAME },
        select: { id: true, name: true },
    });
    console.log(`Created school record: ${created.name} (${created.id})`);
    return created.id;
}
async function main() {
    if (!(0, daSilvaFinalImportGate_1.isDaSilvaFinalImportEnvConfirmed)()) {
        console.error("BLOCKED: set CONFIRM_DA_SILVA_FINAL_IMPORT=true before running final import.");
        process.exit(1);
    }
    const startedAt = Date.now();
    const schoolId = await resolveSchoolId();
    const projectId = (0, daSilvaMigrationService_1.createDaSilvaProjectId)();
    console.log(`Building bundle from: ${desktopRoot}`);
    const bundle = (0, daSilvaMigrationService_1.buildDaSilvaBundleFromDesktopLayout)(schoolId, projectId, desktopRoot);
    await (0, daSilvaMigrationService_1.saveDaSilvaStaging)(bundle);
    const openingBalanceCount = (0, daSilvaFinalImportGate_1.approvedOpeningBalanceAdjustments)(bundle).length;
    const transactionCount = bundle.transactions.length;
    const result = await (0, daSilvaMigrationService_1.commitDaSilvaMigration)({
        schoolId,
        projectId,
        confirmToken: bundle.confirmToken,
    });
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
    });
    const dbLearners = await prisma_1.prisma.learner.count({ where: { schoolId } });
    const dbParents = await prisma_1.prisma.parent.count({ where: { schoolId } });
    const dbClassrooms = await prisma_1.prisma.classroom.count({ where: { schoolId } });
    const billingAccountsImported = new Set(bundle.learners.map((l) => String(l.accountNo || "").trim()).filter(Boolean)).size;
    const postSnapshot = (0, daSilvaFinalImportGate_1.buildDaSilvaFinalImportSnapshot)(bundle, school?.name || "");
    const dbChecks = [
        school?.name === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName,
        dbLearners === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.learners,
        dbParents === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.parents,
        dbClassrooms === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.classes,
        billingAccountsImported === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.billingAccounts,
        result.imported.learners === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.learners,
        result.imported.ledgerEntries === transactionCount + openingBalanceCount,
        postSnapshot.openingBalanceAdjustments ===
            daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.openingBalanceAdjustments,
        postSnapshot.ageAnalysisRemainingVariance === 0,
        postSnapshot.mergedFamilyLedgerGaps === 0,
    ];
    const finalDbStatus = dbChecks.every(Boolean) ? "PASS" : "FAIL";
    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log("");
    console.log("IMPORT COMPLETE SUMMARY");
    console.log(`- School: ${school?.name || SCHOOL_NAME}`);
    console.log(`- Learners imported: ${result.imported.learners}`);
    console.log(`- Parents imported: ${result.imported.parents}`);
    console.log(`- Classes imported: ${result.imported.classrooms}`);
    console.log(`- Billing accounts imported: ${billingAccountsImported}`);
    console.log(`- Transactions imported: ${transactionCount}`);
    console.log(`- Opening balances imported: ${openingBalanceCount}`);
    console.log(`- MAR005 excluded confirmation: ${daSilvaFinalImportGate_1.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS.join(", ")} excluded (${openingBalanceCount} opening balances, not 112)`);
    console.log(`- Import duration: ${durationSec}s`);
    console.log(`- Final DB status: ${finalDbStatus}`);
    if (finalDbStatus === "FAIL") {
        console.error("Post-import DB verification failed:");
        if (school?.name !== daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName) {
            console.error(`  school name: expected ${daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName}, got ${school?.name}`);
        }
        if (dbLearners !== daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.learners) {
            console.error(`  learners: expected ${daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.learners}, got ${dbLearners}`);
        }
        if (dbParents !== daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.parents) {
            console.error(`  parents: expected ${daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.parents}, got ${dbParents}`);
        }
        if (dbClassrooms !== daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.classes) {
            console.error(`  classrooms: expected ${daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.classes}, got ${dbClassrooms}`);
        }
        process.exit(1);
    }
}
main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
