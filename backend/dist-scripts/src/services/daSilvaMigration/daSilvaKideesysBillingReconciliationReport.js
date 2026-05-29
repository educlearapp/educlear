"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatKideesysBillingReconciliationReportText = formatKideesysBillingReconciliationReportText;
function formatCandidates(row) {
    if (!row.matchedCandidates.length)
        return "(none)";
    return row.matchedCandidates
        .map((c) => `${c.fullName} [${c.strategy}/${c.confidence}]${c.className ? ` class=${c.className}` : ""}`)
        .join("; ");
}
function formatRowBlock(row, index) {
    const siblings = row.siblingFamilyNames.length > 0
        ? row.siblingFamilyNames.join(" | ")
        : "(single learner account)";
    return [
        `${index + 1}. ${row.accountNo}`,
        `   Learner name: ${row.learnerName}`,
        `   Sibling/family names: ${siblings}`,
        `   Balance: R${row.balance.toFixed(2)}`,
        `   Matched candidates: ${formatCandidates(row)}`,
        `   Reason not matched: ${row.reasonNotMatched}`,
        ...(row.secondPassLearnerId
            ? [
                `   Second pass: ${row.disposition} → ${row.secondPassStrategy} (${row.secondPassConfidence}) learnerId=${row.secondPassLearnerId}`,
            ]
            : []),
        "",
    ];
}
function formatKideesysBillingReconciliationReportText(report, schoolLabel) {
    const lines = [
        "=== Kid-e-Sys billing reconciliation report ===",
        `School: ${schoolLabel}`,
        `Generated: ${report.generatedAt}`,
        `Total accounts: ${report.totalAccounts}`,
        `First pass matched: ${report.firstPassMatched}`,
        `Second pass auto-matched: ${report.secondPassAutoMatched}`,
        `Total matched: ${report.totalMatched}/${report.totalAccounts}`,
        `Still unmatched: ${report.stillUnmatched}`,
        "",
        `--- Auto matched (${report.autoMatched.length}) ---`,
    ];
    if (!report.autoMatched.length) {
        lines.push("(none)", "");
    }
    else {
        report.autoMatched.forEach((row, i) => lines.push(...formatRowBlock(row, i)));
    }
    lines.push(`--- Manual review required (${report.manualReviewRequired.length}) ---`);
    if (!report.manualReviewRequired.length) {
        lines.push("(none)", "");
    }
    else {
        report.manualReviewRequired.forEach((row, i) => lines.push(...formatRowBlock(row, i)));
    }
    lines.push(`--- Still unmatched (${report.stillUnmatchedRows.length}) ---`);
    if (!report.stillUnmatchedRows.length) {
        lines.push("(none)", "");
    }
    else {
        report.stillUnmatchedRows.forEach((row, i) => lines.push(...formatRowBlock(row, i)));
    }
    lines.push("--- Full unmatched reconciliation (all first-pass misses) ---");
    report.reconciliationRows.forEach((row, i) => lines.push(...formatRowBlock(row, i)));
    return lines.join("\n");
}
