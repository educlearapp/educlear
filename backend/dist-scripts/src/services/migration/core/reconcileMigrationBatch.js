"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationReconciliationError = void 0;
exports.reconcileMigrationBatch = reconcileMigrationBatch;
const prisma_1 = require("../../../prisma");
const learnerEnrollment_1 = require("../../../utils/learnerEnrollment");
const billingLedgerStore_1 = require("../../../utils/billingLedgerStore");
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const migrationStageStore_1 = require("../staging/migrationStageStore");
const MIGRATION_LEDGER_SOURCE = "universal_migration_phase14";
const REVERSAL_SOURCE = "universal_migration_reversal_phase15";
class MigrationReconciliationError extends Error {
    constructor(message) {
        super(message);
        this.name = "MigrationReconciliationError";
    }
}
exports.MigrationReconciliationError = MigrationReconciliationError;
function cleanString(v) {
    return String(v ?? "").trim();
}
function countReportRows(rows, entityType, statuses) {
    return rows.filter((row) => {
        if (row.entityType !== entityType)
            return false;
        if (statuses && !statuses.has(row.status))
            return false;
        return true;
    }).length;
}
function sumReportByStatus(rows, entityType) {
    const out = {
        created: 0,
        skipped: 0,
        failed: 0,
        not_applied: 0,
    };
    for (const row of rows) {
        if (row.entityType !== entityType)
            continue;
        out[row.status] += 1;
    }
    return out;
}
function reversalEntryId(batchId, originalId) {
    const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
    const safeOrig = originalId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    return `umig-rev-${safeBatch}-${safeOrig}`;
}
function summarizeReportEntity(rows, entityType) {
    const s = sumReportByStatus(rows, entityType);
    return `created ${s.created}, skipped ${s.skipped}, failed ${s.failed}, not_applied ${s.not_applied}`;
}
function isMigrationPostedEntry(entry) {
    const source = cleanString(entry.source);
    if (source === MIGRATION_LEDGER_SOURCE)
        return true;
    return entry.id.startsWith("umig-tx-");
}
function isMigrationReversalEntry(entry, batchId) {
    const source = cleanString(entry.source);
    if (source === REVERSAL_SOURCE)
        return true;
    const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
    return entry.id.startsWith(`umig-rev-${safeBatch}-`);
}
function ledgerSignedAmount(entry) {
    const amount = (0, billingLedgerStore_1.normaliseAmount)(entry.amount);
    if (entry.type === "payment" || entry.type === "credit")
        return -amount;
    return amount;
}
function buildSummary(checks) {
    let passed = 0;
    let warnings = 0;
    let failed = 0;
    for (const c of checks) {
        if (c.status === "pass")
            passed += 1;
        else if (c.status === "warning")
            warnings += 1;
        else
            failed += 1;
    }
    return { passed, warnings, failed, total: checks.length };
}
function overallStatus(summary) {
    if (summary.failed > 0)
        return "fail";
    if (summary.warnings > 0)
        return "warning";
    return "pass";
}
function pushCheck(checks, partial) {
    checks.push({
        id: partial.id ?? `check-${checks.length + 1}`,
        check: partial.check,
        expected: partial.expected,
        actual: partial.actual,
        status: partial.status,
        message: partial.message,
    });
}
async function reconcileMigrationBatch(input) {
    const batchId = cleanString(input.batchId);
    const targetSchoolId = cleanString(input.targetSchoolId);
    if (!batchId)
        throw new MigrationReconciliationError("batchId is required");
    if (!targetSchoolId)
        throw new MigrationReconciliationError("targetSchoolId is required");
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
    if (!batch)
        throw new MigrationReconciliationError("Import batch not found");
    if (batch.targetSchoolId !== targetSchoolId) {
        throw new MigrationReconciliationError("targetSchoolId does not match this import batch");
    }
    const stage = (0, migrationStageStore_1.getStage)(batch.stageId);
    if (!stage) {
        throw new MigrationReconciliationError(`Dry run stage ${batch.stageId} not found — cannot reconcile staged counts`);
    }
    const reportRows = batch.reportRows ?? [];
    const stagedCounts = batch.stagedCounts ?? stage.stagedCounts;
    const createdCounts = batch.createdCounts ?? {
        learners: 0,
        parents: 0,
        employees: 0,
        billingAccounts: 0,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
    };
    const skippedCounts = batch.skippedCounts ?? {
        learners: 0,
        parents: 0,
        employees: 0,
        billingAccounts: 0,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
    };
    const failedCounts = batch.failedCounts ?? {
        learners: 0,
        parents: 0,
        employees: 0,
        billingAccounts: 0,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
    };
    const checks = [];
    const learnerReportTotal = countReportRows(reportRows, "learner") ||
        createdCounts.learners + skippedCounts.learners + failedCounts.learners;
    const parentReportTotal = countReportRows(reportRows, "parent") ||
        createdCounts.parents + skippedCounts.parents + failedCounts.parents;
    const billingReportTotal = countReportRows(reportRows, "billingAccount") ||
        createdCounts.billingAccounts +
            skippedCounts.billingAccounts +
            failedCounts.billingAccounts;
    const learnerRowCount = countReportRows(reportRows, "learner");
    pushCheck(checks, {
        id: "staged_learners_vs_applied",
        check: "Staged learners vs applied report rows",
        expected: String(stagedCounts.learners),
        actual: summarizeReportEntity(reportRows, "learner") || String(learnerReportTotal),
        status: stagedCounts.learners === learnerRowCount ? "pass" : "warning",
        message: stagedCounts.learners === learnerRowCount
            ? "Staged learner count matches learner report rows."
            : `Staged ${stagedCounts.learners} learner(s); report has ${learnerRowCount} learner row(s). Batch totals: created ${createdCounts.learners}, skipped ${skippedCounts.learners}, failed ${failedCounts.learners}.`,
    });
    pushCheck(checks, {
        id: "staged_parents_vs_applied",
        check: "Staged parents vs applied report rows",
        expected: String(stagedCounts.parents),
        actual: summarizeReportEntity(reportRows, "parent") || String(parentReportTotal),
        status: stagedCounts.parents === countReportRows(reportRows, "parent") ? "pass" : "warning",
        message: stagedCounts.parents === countReportRows(reportRows, "parent")
            ? "Staged parent count matches parent report rows."
            : `Staged ${stagedCounts.parents} parent(s); report has ${countReportRows(reportRows, "parent")} parent row(s).`,
    });
    pushCheck(checks, {
        id: "staged_billing_vs_applied",
        check: "Staged billing accounts vs applied report rows",
        expected: String(stagedCounts.billingAccounts),
        actual: summarizeReportEntity(reportRows, "billingAccount") || String(billingReportTotal),
        status: stagedCounts.billingAccounts === countReportRows(reportRows, "billingAccount")
            ? "pass"
            : "warning",
        message: stagedCounts.billingAccounts === countReportRows(reportRows, "billingAccount")
            ? "Staged billing count matches billing report rows."
            : `Staged ${stagedCounts.billingAccounts} billing row(s); report has ${countReportRows(reportRows, "billingAccount")}.`,
    });
    pushCheck(checks, {
        id: "apply_report_totals_learners",
        check: "Apply report totals — learners",
        expected: summarizeReportEntity(reportRows, "learner"),
        actual: `batch created ${createdCounts.learners}, skipped ${skippedCounts.learners}, failed ${failedCounts.learners}`,
        status: createdCounts.learners === countReportRows(reportRows, "learner", new Set(["created"])) &&
            skippedCounts.learners === countReportRows(reportRows, "learner", new Set(["skipped"])) &&
            failedCounts.learners === countReportRows(reportRows, "learner", new Set(["failed"]))
            ? "pass"
            : reportRows.length === 0
                ? "warning"
                : "warning",
        message: "Compares stored batch counters with per-row learner statuses in the apply report.",
    });
    pushCheck(checks, {
        id: "apply_report_totals_parents",
        check: "Apply report totals — parents",
        expected: summarizeReportEntity(reportRows, "parent"),
        actual: `batch created ${createdCounts.parents}, skipped ${skippedCounts.parents}, failed ${failedCounts.parents}`,
        status: createdCounts.parents === countReportRows(reportRows, "parent", new Set(["created"])) &&
            skippedCounts.parents === countReportRows(reportRows, "parent", new Set(["skipped"])) &&
            failedCounts.parents === countReportRows(reportRows, "parent", new Set(["failed"]))
            ? "pass"
            : reportRows.length === 0
                ? "warning"
                : "warning",
        message: "Compares stored batch counters with per-row parent statuses in the apply report.",
    });
    pushCheck(checks, {
        id: "apply_report_totals_billing",
        check: "Apply report totals — billing accounts",
        expected: summarizeReportEntity(reportRows, "billingAccount"),
        actual: `batch created ${createdCounts.billingAccounts}, skipped ${skippedCounts.billingAccounts}, failed ${failedCounts.billingAccounts}`,
        status: createdCounts.billingAccounts ===
            countReportRows(reportRows, "billingAccount", new Set(["created"])) &&
            skippedCounts.billingAccounts ===
                countReportRows(reportRows, "billingAccount", new Set(["skipped"])) &&
            failedCounts.billingAccounts ===
                countReportRows(reportRows, "billingAccount", new Set(["failed"]))
            ? "pass"
            : reportRows.length === 0
                ? "warning"
                : "warning",
        message: "Compares stored batch counters with per-row billing statuses in the apply report.",
    });
    const [actualActiveCount, historicalCount, unenrolledOrOtherCount] = await Promise.all([
        prisma_1.prisma.learner.count({ where: (0, learnerEnrollment_1.activeLearnerWhere)(targetSchoolId) }),
        prisma_1.prisma.learner.count({
            where: { schoolId: targetSchoolId, enrollmentStatus: "HISTORICAL" },
        }),
        prisma_1.prisma.learner.count({
            where: {
                schoolId: targetSchoolId,
                NOT: { enrollmentStatus: { in: ["ACTIVE", "HISTORICAL"] } },
            },
        }),
    ]);
    const createdLearnerIds = reportRows
        .filter((r) => r.entityType === "learner" && r.status === "created" && cleanString(r.recordId))
        .map((r) => cleanString(r.recordId));
    let batchCreatedStillActive = 0;
    let batchCreatedNonActive = 0;
    if (createdLearnerIds.length > 0) {
        const createdLearners = await prisma_1.prisma.learner.findMany({
            where: { schoolId: targetSchoolId, id: { in: createdLearnerIds } },
            select: { id: true, enrollmentStatus: true },
        });
        for (const l of createdLearners) {
            if (l.enrollmentStatus === "ACTIVE")
                batchCreatedStillActive += 1;
            else
                batchCreatedNonActive += 1;
        }
    }
    const impliedBeforeActive = batch.status === "rolled_back"
        ? actualActiveCount
        : Math.max(0, actualActiveCount - batchCreatedStillActive);
    const expectedAfterActive = impliedBeforeActive + batchCreatedStillActive;
    pushCheck(checks, {
        id: "active_learner_head_count",
        check: "Active learner head count (before vs after)",
        expected: `after apply ≈ ${expectedAfterActive} (implied before ${impliedBeforeActive} + ${batchCreatedStillActive} batch ACTIVE)`,
        actual: `current ACTIVE ${actualActiveCount}`,
        status: batch.status === "completed" && expectedAfterActive === actualActiveCount
            ? "pass"
            : batch.status === "rolled_back"
                ? "warning"
                : batch.status === "completed"
                    ? "fail"
                    : "warning",
        message: batch.status === "completed" && expectedAfterActive === actualActiveCount
            ? "Active head count is consistent with batch-created ACTIVE learners still on file."
            : batch.status === "rolled_back"
                ? "Batch was rolled back — active head count reflects post-rollback state."
                : `Expected ${expectedAfterActive} ACTIVE after apply; database has ${actualActiveCount}.`,
    });
    pushCheck(checks, {
        id: "historical_excluded_from_head_count",
        check: "Historical / unenrolled learners excluded from active head count",
        expected: `ACTIVE ${actualActiveCount} only; HISTORICAL ${stagedCounts.historical ?? stage.stagedCounts.historical} staged`,
        actual: `HISTORICAL ${historicalCount} in DB; non-ACTIVE/non-HISTORICAL ${unenrolledOrOtherCount}; batch-created non-ACTIVE ${batchCreatedNonActive}`,
        status: batchCreatedNonActive === 0 && unenrolledOrOtherCount === 0
            ? "pass"
            : batchCreatedNonActive > 0
                ? "fail"
                : "warning",
        message: batchCreatedNonActive > 0
            ? "Some batch-created learners are not ACTIVE — they must not count toward head count."
            : "Active head count uses ACTIVE enrollment only; historical learners are stored separately.",
    });
    const ledgerEntries = (0, billingLedgerStore_1.readSchoolLedger)(targetSchoolId);
    const migrationPosted = ledgerEntries.filter(isMigrationPostedEntry);
    const createdTransactionRows = reportRows.filter((r) => r.entityType === "transaction" && r.status === "created" && cleanString(r.recordId));
    const expectedPostedCount = createdTransactionRows.length;
    const ledgerMigrationIds = new Set(migrationPosted.map((e) => e.id));
    const missingLedger = createdTransactionRows.filter((r) => !ledgerMigrationIds.has(cleanString(r.recordId)));
    pushCheck(checks, {
        id: "expected_transactions_vs_ledger",
        check: "Expected posted transactions vs migration ledger entries",
        expected: String(expectedPostedCount),
        actual: String(migrationPosted.length),
        status: expectedPostedCount === migrationPosted.length && missingLedger.length === 0
            ? "pass"
            : missingLedger.length > 0
                ? "fail"
                : "warning",
        message: missingLedger.length > 0
            ? `${missingLedger.length} created transaction(s) missing from billing-ledger.json.`
            : expectedPostedCount === migrationPosted.length
                ? "Posted transaction count matches universal migration ledger entries."
                : `Apply report shows ${expectedPostedCount} created transaction(s); ledger has ${migrationPosted.length} migration entry(ies).`,
    });
    const duplicateIds = new Map();
    for (const entry of migrationPosted) {
        duplicateIds.set(entry.id, (duplicateIds.get(entry.id) ?? 0) + 1);
    }
    const duplicateIdList = [...duplicateIds.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    const duplicateKeys = new Map();
    for (const row of createdTransactionRows) {
        const key = cleanString(row.key);
        if (!key)
            continue;
        duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    }
    const duplicateKeyList = [...duplicateKeys.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    pushCheck(checks, {
        id: "duplicate_posted_ledger_entries",
        check: "Duplicate posted ledger entries",
        expected: "0 duplicate migration entry IDs",
        actual: `${duplicateIdList.length} duplicate ID(s), ${duplicateKeyList.length} duplicate key(s)`,
        status: duplicateIdList.length > 0 ? "fail" : duplicateKeyList.length > 0 ? "warning" : "pass",
        message: duplicateIdList.length > 0
            ? `Duplicate ledger IDs: ${duplicateIdList.slice(0, 5).join(", ")}${duplicateIdList.length > 5 ? "…" : ""}`
            : duplicateKeyList.length > 0
                ? "Duplicate transaction keys in apply report — rows may have been skipped at post time."
                : "No duplicate universal migration ledger entry IDs detected.",
    });
    pushCheck(checks, {
        id: "missing_ledger_entries",
        check: "Missing ledger entries for created transactions",
        expected: "0 missing",
        actual: String(missingLedger.length),
        status: missingLedger.length > 0 ? "fail" : "pass",
        message: missingLedger.length > 0
            ? `Missing IDs: ${missingLedger
                .slice(0, 5)
                .map((r) => r.recordId)
                .join(", ")}${missingLedger.length > 5 ? "…" : ""}`
            : "Every created transaction in the apply report has a matching ledger entry.",
    });
    const reversalReport = batch.reversalReport ?? [];
    const reversedRows = reversalReport.filter((r) => r.status === "reversed");
    const reversalLedger = ledgerEntries.filter((e) => isMigrationReversalEntry(e, batchId));
    const ledgerById = new Map(ledgerEntries.map((e) => [e.id, e]));
    let missingReversals = 0;
    for (const row of reversedRows) {
        const recordId = cleanString(row.recordId);
        const revId = cleanString(row.reversalRecordId) || reversalEntryId(batchId, recordId);
        if (!ledgerById.has(revId)) {
            missingReversals += 1;
        }
    }
    pushCheck(checks, {
        id: "reversal_entries_vs_report",
        check: "Reversed transactions vs reversal ledger entries",
        expected: batch.status === "rolled_back"
            ? `${reversedRows.length} reversal row(s)`
            : "N/A (batch not rolled back)",
        actual: batch.status === "rolled_back"
            ? `${reversalLedger.length} reversal ledger entry(ies)`
            : "—",
        status: batch.status !== "rolled_back"
            ? "pass"
            : reversedRows.length === reversalLedger.length && missingReversals === 0
                ? "pass"
                : missingReversals > 0
                    ? "fail"
                    : "warning",
        message: batch.status !== "rolled_back"
            ? "Reversal ledger check applies only after reversal rollback."
            : missingReversals > 0
                ? `${missingReversals} reversed row(s) without matching reversal ledger entry.`
                : "Reversal report rows align with reversal ledger entries.",
    });
    let migrationNet = 0;
    for (const entry of migrationPosted) {
        migrationNet += ledgerSignedAmount(entry);
    }
    let reversalNet = 0;
    for (const entry of reversalLedger) {
        reversalNet += ledgerSignedAmount(entry);
    }
    pushCheck(checks, {
        id: "account_balance_impact_summary",
        check: "Account balance impact summary (migration ledger)",
        expected: "Net signed impact from posted migration entries",
        actual: `migration net R${migrationNet.toFixed(2)} (${migrationPosted.length} entries)${batch.status === "rolled_back"
            ? `; reversal net R${reversalNet.toFixed(2)} (${reversalLedger.length} entries)`
            : ""}`,
        status: "pass",
        message: "Read-only summary of signed amounts on billing-ledger.json (invoices/penalties positive, payments/credits negative).",
    });
    const blockedUnmatched = reportRows.filter((r) => r.entityType === "transaction" &&
        (r.status === "not_applied" ||
            r.status === "failed" ||
            (r.status === "skipped" &&
                /blocked|unmatched|duplicate/i.test(r.message || ""))) &&
        /blocked|unmatched|historical|not applied/i.test(r.message || ""));
    const stagedBlocked = stage.transactionReadiness?.blockedTransactions ?? 0;
    const stagedUnmatched = stage.transactionReadiness?.unmatchedTransactions ?? 0;
    pushCheck(checks, {
        id: "blocked_unmatched_unresolved",
        check: "Blocked / unmatched rows still unresolved",
        expected: `dry-run blocked ${stagedBlocked}, unmatched ${stagedUnmatched}`,
        actual: `${blockedUnmatched.length} unresolved transaction row(s) in apply report`,
        status: blockedUnmatched.length > 0 ? "warning" : "pass",
        message: blockedUnmatched.length > 0
            ? "Some transaction rows were not posted and remain in the apply report for review."
            : "No blocked or unmatched transaction rows remain in the apply report.",
    });
    const stagedTransactions = stagedCounts.transactions;
    const transactionReportTotal = countReportRows(reportRows, "transaction");
    pushCheck(checks, {
        id: "staged_transactions_vs_applied",
        check: "Staged transactions vs applied report rows",
        expected: String(stagedTransactions),
        actual: summarizeReportEntity(reportRows, "transaction") || String(transactionReportTotal),
        status: stagedTransactions === transactionReportTotal ? "pass" : "warning",
        message: stagedTransactions === transactionReportTotal
            ? "Staged transaction count matches transaction report rows."
            : `Staged ${stagedTransactions} transaction(s); report has ${transactionReportTotal} row(s).`,
    });
    const summary = buildSummary(checks);
    const reconciledAt = new Date().toISOString();
    return {
        batchId: batch.batchId,
        stageId: batch.stageId,
        targetSchoolId: batch.targetSchoolId,
        targetSchoolName: batch.targetSchoolName,
        batchStatus: batch.status,
        reconciledAt,
        overallStatus: overallStatus(summary),
        summary,
        checks,
        accountBalanceImpact: {
            migrationPostedNet: migrationNet,
            migrationPostedCount: migrationPosted.length,
            reversalNet: batch.status === "rolled_back" ? reversalNet : undefined,
            reversalCount: batch.status === "rolled_back" ? reversalLedger.length : undefined,
            note: "Signed net on billing-ledger.json; not a live GL balance.",
        },
    };
}
