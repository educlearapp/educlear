"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaSilvaFinalImportBlockedError = exports.DA_SILVA_FINAL_IMPORT_EXPECTED = exports.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS = exports.DA_SILVA_FINAL_IMPORT_ENV = void 0;
exports.isKideesysPortalMigrationBundle = isKideesysPortalMigrationBundle;
exports.gateLearnerCountForSnapshot = gateLearnerCountForSnapshot;
exports.approvedOpeningBalanceAdjustments = approvedOpeningBalanceAdjustments;
exports.isDaSilvaFinalImportEnvConfirmed = isDaSilvaFinalImportEnvConfirmed;
exports.countMergedFamilyLedgerGaps = countMergedFamilyLedgerGaps;
exports.buildDaSilvaFinalImportSnapshot = buildDaSilvaFinalImportSnapshot;
exports.previewDaSilvaFinalImportGate = previewDaSilvaFinalImportGate;
exports.printDaSilvaFinalImportGatePreview = printDaSilvaFinalImportGatePreview;
exports.printDaSilvaFinalImportPreImportSummary = printDaSilvaFinalImportPreImportSummary;
exports.assertDaSilvaFinalImportAllowed = assertDaSilvaFinalImportAllowed;
/** Kid-e-Sys portal bundles include billing-only historical learners. */
function isKideesysPortalMigrationBundle(bundle) {
    return bundle.learners.some((l) => l.enrollmentTier === "HISTORICAL");
}
/** Gate compares active (class-list) learners; historical tiers do not count toward the 396 cap. */
function gateLearnerCountForSnapshot(bundle) {
    return bundle.learners.filter((l) => l.enrollmentTier !== "HISTORICAL").length;
}
const daSilvaConstants_1 = require("./daSilvaConstants");
const daSilvaOpeningBalance_1 = require("./daSilvaOpeningBalance");
const daSilvaVarianceClassification_1 = require("./daSilvaVarianceClassification");
exports.DA_SILVA_FINAL_IMPORT_ENV = "CONFIRM_DA_SILVA_FINAL_IMPORT";
var daSilvaConstants_2 = require("./daSilvaConstants");
Object.defineProperty(exports, "DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS; } });
const OPENING_BALANCE_EXCLUDED = new Set(daSilvaConstants_1.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS);
/** Approved Kid-e-Sys → EduClear snapshot (Da Silva Academy). */
exports.DA_SILVA_FINAL_IMPORT_EXPECTED = {
    schoolName: "Da Silva Academy",
    learners: daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
    parents: 330,
    classes: daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_CLASSROOM_COUNT,
    billingAccounts: 344,
    /** 112 base plan minus MAR005 manual exclusion. */
    openingBalanceAdjustments: 111,
    ageAnalysisRemainingVariance: 0,
    mergedFamilyLedgerGaps: 0,
};
function approvedOpeningBalanceAdjustments(bundle) {
    return bundle.openingBalance.adjustments.filter((a) => !OPENING_BALANCE_EXCLUDED.has(a.accountNo));
}
class DaSilvaFinalImportBlockedError extends Error {
    constructor(message, snapshot, mismatches, envConfirmed) {
        super(message);
        this.name = "DaSilvaFinalImportBlockedError";
        this.snapshot = snapshot;
        this.mismatches = mismatches;
        this.envConfirmed = envConfirmed;
    }
}
exports.DaSilvaFinalImportBlockedError = DaSilvaFinalImportBlockedError;
function isDaSilvaFinalImportEnvConfirmed() {
    return String(process.env[exports.DA_SILVA_FINAL_IMPORT_ENV] || "").trim().toLowerCase() === "true";
}
function countMergedFamilyLedgerGaps(bundle) {
    const varianceRows = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
    const learnerCountByAccount = (0, daSilvaVarianceClassification_1.learnersPerAccount)(bundle.learners);
    const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
    const mergedFamilyAccountNos = new Set(bundle.mergedFamilyAccountNos || []);
    let gaps = 0;
    for (const row of varianceRows) {
        const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
        const fullName = row.fullName || account?.fullName || "";
        const inAgeAnalysis = ageAnalysisAccountNos.has(row.accountNo);
        const mergedFamily = (0, daSilvaVarianceClassification_1.isMergedFamilyAccount)(row.accountNo, fullName, learnerCountByAccount, mergedFamilyAccountNos);
        const varianceGroup = (0, daSilvaVarianceClassification_1.classifyVarianceGroup)({ ...row, fullName }, inAgeAnalysis, bundle.transactions, mergedFamily);
        if (varianceGroup === "mergedFamilyLedgerGap")
            gaps++;
    }
    return gaps;
}
function buildDaSilvaFinalImportSnapshot(bundle, schoolName) {
    const freezeAdjustments = approvedOpeningBalanceAdjustments(bundle);
    const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
    return {
        schoolName: schoolName.trim(),
        learners: gateLearnerCountForSnapshot(bundle),
        parents: bundle.reconciliation.totals.totalParents,
        classes: bundle.reconciliation.totals.totalClasses,
        billingAccounts: bundle.countValidation.billingAccountsFromAgeAnalysis,
        openingBalanceAdjustments: freezeAdjustments.length,
        ageAnalysisRemainingVariance: (0, daSilvaOpeningBalance_1.countAgeAnalysisVarianceAfterAdjustments)(bundle.reconciliation.rows, freezeAdjustments, ageAnalysisAccountNos),
        mergedFamilyLedgerGaps: countMergedFamilyLedgerGaps(bundle),
    };
}
/** Preview-only: validates snapshot + import eligibility without env confirmation. */
function previewDaSilvaFinalImportGate(bundle, schoolName) {
    const snapshot = buildDaSilvaFinalImportSnapshot(bundle, schoolName);
    const mismatches = findSnapshotMismatches(snapshot);
    const importAllowed = bundle.canImport && mismatches.length === 0;
    return {
        snapshot,
        mismatches,
        importAllowed,
        gateStatus: importAllowed ? "PASS" : "FAIL",
    };
}
function printDaSilvaFinalImportGatePreview(preview) {
    const expected = exports.DA_SILVA_FINAL_IMPORT_EXPECTED.openingBalanceAdjustments;
    const actual = preview.snapshot.openingBalanceAdjustments;
    console.log("=== Da Silva final import gate — preview only (no import) ===");
    console.log(`Expected opening balance count: ${expected}`);
    console.log(`Actual opening balance count: ${actual}`);
    console.log(`Gate status: ${preview.gateStatus}`);
    if (preview.mismatches.length > 0) {
        for (const m of preview.mismatches) {
            console.log(`  ${m.field}: expected ${m.expected}, got ${m.actual}`);
        }
    }
}
function findSnapshotMismatches(snapshot) {
    const expected = exports.DA_SILVA_FINAL_IMPORT_EXPECTED;
    const mismatches = [];
    const checks = [
        { field: "schoolName", expected: expected.schoolName, actual: snapshot.schoolName },
        { field: "learners", expected: expected.learners, actual: snapshot.learners },
        { field: "parents", expected: expected.parents, actual: snapshot.parents },
        { field: "classes", expected: expected.classes, actual: snapshot.classes },
        { field: "billingAccounts", expected: expected.billingAccounts, actual: snapshot.billingAccounts },
        {
            field: "openingBalanceAdjustments",
            expected: expected.openingBalanceAdjustments,
            actual: snapshot.openingBalanceAdjustments,
        },
        {
            field: "ageAnalysisRemainingVariance",
            expected: expected.ageAnalysisRemainingVariance,
            actual: snapshot.ageAnalysisRemainingVariance,
        },
        {
            field: "mergedFamilyLedgerGaps",
            expected: expected.mergedFamilyLedgerGaps,
            actual: snapshot.mergedFamilyLedgerGaps,
        },
    ];
    for (const check of checks) {
        if (check.actual !== check.expected) {
            mismatches.push({
                field: check.field,
                expected: check.expected,
                actual: check.actual,
            });
        }
    }
    return mismatches;
}
function printDaSilvaFinalImportPreImportSummary(snapshot, mismatches, envConfirmed, bundle) {
    const expected = exports.DA_SILVA_FINAL_IMPORT_EXPECTED;
    const mismatchFields = new Set(mismatches.map((m) => m.field));
    const isKideesysPortal = bundle ? isKideesysPortalMigrationBundle(bundle) : false;
    const line = (label, field, actual) => {
        const exp = expected[field];
        const ok = !mismatchFields.has(field) && actual === exp;
        console.log(`  ${label}: ${actual} (required: ${exp}) ${ok ? "OK" : "MISMATCH"}`);
    };
    console.log("=== Da Silva final import — pre-import summary ===");
    line("School name", "schoolName", snapshot.schoolName);
    line(isKideesysPortal ? "Active learners (class lists)" : "Learners", "learners", snapshot.learners);
    if (isKideesysPortal && bundle) {
        const historical = bundle.learners.filter((l) => l.enrollmentTier === "HISTORICAL").length;
        console.log(`  Total staged learners: ${bundle.learners.length} (${snapshot.learners} active + ${historical} historical — historical allowed)`);
    }
    line("Parents", "parents", snapshot.parents);
    line("Classes", "classes", snapshot.classes);
    line("Billing accounts", "billingAccounts", snapshot.billingAccounts);
    line("Opening balance adjustments", "openingBalanceAdjustments", snapshot.openingBalanceAdjustments);
    line("Age-analysis remaining variance", "ageAnalysisRemainingVariance", snapshot.ageAnalysisRemainingVariance);
    line("Merged-family ledger gaps", "mergedFamilyLedgerGaps", snapshot.mergedFamilyLedgerGaps);
    console.log(`  ${exports.DA_SILVA_FINAL_IMPORT_ENV}: ${envConfirmed ? "true (confirmed)" : "not set — import blocked"}`);
    if (!envConfirmed) {
        console.log("BLOCKED: final import requires CONFIRM_DA_SILVA_FINAL_IMPORT=true on the server.");
    }
    else if (mismatches.length > 0) {
        console.log(`BLOCKED: ${mismatches.length} value(s) differ from the approved snapshot — re-run preview and fix data before import.`);
    }
    else {
        console.log("Pre-import summary matches approved snapshot (import may proceed when invoked).");
    }
}
/**
 * Hard gate for commitDaSilvaMigration. Prints summary, then throws if env or counts fail.
 */
function assertDaSilvaFinalImportAllowed(bundle, schoolName) {
    const snapshot = buildDaSilvaFinalImportSnapshot(bundle, schoolName);
    const envConfirmed = isDaSilvaFinalImportEnvConfirmed();
    const mismatches = findSnapshotMismatches(snapshot);
    printDaSilvaFinalImportPreImportSummary(snapshot, mismatches, envConfirmed, bundle);
    if (!envConfirmed) {
        throw new DaSilvaFinalImportBlockedError(`Final import blocked: set ${exports.DA_SILVA_FINAL_IMPORT_ENV}=true on the server before running import`, snapshot, mismatches, false);
    }
    if (mismatches.length > 0) {
        const detail = mismatches
            .map((m) => `${m.field}: expected ${m.expected}, got ${m.actual}`)
            .join("; ");
        throw new DaSilvaFinalImportBlockedError(`Final import blocked: pre-import summary does not match required snapshot (${detail})`, snapshot, mismatches, true);
    }
    return snapshot;
}
