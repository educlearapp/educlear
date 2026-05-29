"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLearnerEligibleForNewBilling = isLearnerEligibleForNewBilling;
exports.shouldTransactionBeHistoricalOnly = shouldTransactionBeHistoricalOnly;
exports.classifyTransactionReadiness = classifyTransactionReadiness;
const MigrationLearnerStatus_1 = require("../types/MigrationLearnerStatus");
function parseCutoverDate(cutoverDate) {
    const raw = String(cutoverDate || "").trim();
    if (!raw)
        return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()))
        return null;
    d.setHours(0, 0, 0, 0);
    return d;
}
function parseTransactionDate(value) {
    if (value == null)
        return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const d = new Date(value);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const s = String(value).trim();
    if (!s)
        return null;
    if (/^\d{4,5}(\.\d+)?$/.test(s)) {
        const serial = Number(s);
        if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
            const epoch = new Date(Date.UTC(1899, 11, 30));
            const d = new Date(epoch.getTime() + serial * 86400000);
            d.setHours(0, 0, 0, 0);
            return d;
        }
    }
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) {
        const d = new Date(parsed);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
        const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
        const month = Number(dmy[2]) - 1;
        const day = Number(dmy[1]);
        const d = new Date(year, month, day);
        if (!Number.isNaN(d.getTime())) {
            d.setHours(0, 0, 0, 0);
            return d;
        }
    }
    return null;
}
function hasActiveClassroomOrGrade(learner) {
    const grade = String(learner.grade || "").trim();
    const classroom = String(learner.classroom || "").trim();
    return grade.length > 0 || classroom.length > 0;
}
/**
 * True only when the learner may participate in new billing / active head count.
 */
function isLearnerEligibleForNewBilling(learner) {
    if (!(0, MigrationLearnerStatus_1.countsTowardActiveHeadCount)(learner.status))
        return false;
    if ((0, MigrationLearnerStatus_1.isHistoricalMigrationStatus)(learner.status))
        return false;
    if ((0, MigrationLearnerStatus_1.isUnenrolledMigrationStatus)(learner.status))
        return false;
    if ((0, MigrationLearnerStatus_1.isClosedOrInactiveAccountStatus)(learner.accountStatus))
        return false;
    return hasActiveClassroomOrGrade(learner);
}
/**
 * Historical-only transactions are preserved for ledger history but must not affect
 * active head count or new billing runs.
 */
function shouldTransactionBeHistoricalOnly(input) {
    const status = input.learnerStatus;
    if (status === "HISTORICAL" || status === "UNENROLLED")
        return true;
    if (input.accountClosed || (0, MigrationLearnerStatus_1.isClosedOrInactiveAccountStatus)(input.accountStatus)) {
        return true;
    }
    const cutover = parseCutoverDate(input.cutoverDate);
    const txDate = parseTransactionDate(input.transactionDate);
    if (cutover && txDate && txDate.getTime() < cutover.getTime()) {
        return true;
    }
    return false;
}
function classifyTransactionReadiness(input) {
    if (!input.hasLearnerOrAccountMatch)
        return "unmatched";
    if (!input.datePresent || !input.amountValid)
        return "blocked";
    if (shouldTransactionBeHistoricalOnly(input)) {
        return "historicalOnly";
    }
    const learner = {
        status: input.learnerStatus ?? "UNKNOWN",
        grade: input.grade,
        classroom: input.classroom,
        accountStatus: input.accountStatus,
    };
    if (isLearnerEligibleForNewBilling(learner)) {
        return "eligibleActive";
    }
    return "blocked";
}
