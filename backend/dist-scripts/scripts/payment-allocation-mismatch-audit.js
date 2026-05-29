"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Audit-only: payment allocation / cross-account patterns for
 * trueBalanceMismatch (84) + possibleDuplicateOrHistoricalCredit (27).
 * Usage: npx ts-node scripts/payment-allocation-mismatch-audit.ts [desktopRoot]
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaMergedFamily_1 = require("../src/services/daSilvaMigration/daSilvaMergedFamily");
const parsers_1 = require("../src/services/daSilvaMigration/parsers");
const kideesysSpreadsheet_1 = require("../src/utils/kideesysSpreadsheet");
function resolveFamilyAccountNo(txn, index) {
    const byName = index.learnerNameToAccount.get((0, kideesysSpreadsheet_1.normalizeMatchText)(txn.fullName));
    if (byName)
        return byName;
    return String(txn.accountNo || "").trim();
}
function sumSigned(txns) {
    return Math.round(txns.reduce((s, t) => s + t.signedAmount, 0) * 100) / 100;
}
function sumPayments(txns) {
    return Math.round(txns.filter((t) => t.kind === "payment").reduce((s, t) => s + t.signedAmount, 0) * 100) / 100;
}
function sumInvoices(txns) {
    return Math.round(txns.filter((t) => t.kind === "invoice").reduce((s, t) => s + t.signedAmount, 0) * 100) / 100;
}
function parentGroupKey(parents) {
    const cells = parents
        .map((p) => String(p.cellNo || "").replace(/\s/g, ""))
        .filter(Boolean)
        .sort();
    if (!cells.length)
        return "";
    const surnames = parents
        .map((p) => (0, kideesysSpreadsheet_1.normalizeMatchText)(p.surname || ""))
        .filter(Boolean);
    return `${cells.join("|")}|${surnames.join("|")}`;
}
function buildParentSiblingMap(contacts, accounts, index) {
    const accountToSiblings = new Map();
    const byParent = new Map();
    for (const contact of contacts) {
        const key = parentGroupKey(contact.parents);
        if (!key)
            continue;
        const accountNo = (0, daSilvaMergedFamily_1.findAccountForLearnerName)(contact.fullName, accounts, index);
        if (!accountNo)
            continue;
        const list = byParent.get(key) || [];
        if (!list.includes(accountNo))
            list.push(accountNo);
        byParent.set(key, list);
    }
    for (const accountNos of byParent.values()) {
        if (accountNos.length < 2)
            continue;
        for (const acct of accountNos) {
            const set = accountToSiblings.get(acct) || new Set();
            for (const other of accountNos) {
                if (other !== acct)
                    set.add(other);
            }
            accountToSiblings.set(acct, set);
        }
    }
    return accountToSiblings;
}
function near(a, b, tol = 50) {
    return Math.abs(a - b) <= tol;
}
function classifyAccount(row, account, txnsOnAccount, allTxns, index, siblingNos, reconciliationByAccount) {
    const patterns = [];
    const accountNo = row.accountNo;
    const rawLedger = sumSigned(txnsOnAccount);
    const invoiceSum = sumInvoices(txnsOnAccount);
    const paymentSum = sumPayments(txnsOnAccount);
    const paymentCount = txnsOnAccount.filter((t) => t.kind === "payment").length;
    const invoiceCount = txnsOnAccount.filter((t) => t.kind === "invoice").length;
    let crossAccountPaymentAmount = 0;
    let crossAccountInboundPaymentAmount = 0;
    let misPostedTxnCount = 0;
    for (const t of txnsOnAccount) {
        const family = resolveFamilyAccountNo(t, index);
        if (family && family !== accountNo) {
            misPostedTxnCount++;
            if (t.kind === "payment")
                crossAccountPaymentAmount += Math.abs(t.signedAmount);
        }
    }
    for (const t of allTxns) {
        if (t.accountNo === accountNo)
            continue;
        const family = resolveFamilyAccountNo(t, index);
        if (family !== accountNo)
            continue;
        if (t.kind === "payment") {
            crossAccountInboundPaymentAmount += Math.abs(t.signedAmount);
        }
    }
    const paymentToInvoiceRatio = invoiceSum > 0.01 ? Math.round((Math.abs(paymentSum) / invoiceSum) * 1000) / 1000 : 0;
    const receiptOnlyPaymentCount = txnsOnAccount.filter((t) => t.kind === "payment" &&
        /\b(receipt|eft|deposit|cash|paid|payment)\b/i.test(String(t.notes || "")) &&
        !/\binvoice\b/i.test(String(t.notes || ""))).length;
    const negativeLedgerPositiveAge = row.ledgerBalanceFromImport < -0.01 && row.ageAnalysisBalance > 0.01;
    if (negativeLedgerPositiveAge)
        patterns.push("negativeLedgerPositiveAge");
    const paymentsWithoutInvoiceCoverage = paymentCount > 0 &&
        (invoiceCount === 0 || Math.abs(paymentSum) > invoiceSum + 500) &&
        row.variance > 0.01;
    if (paymentsWithoutInvoiceCoverage)
        patterns.push("paymentsWithoutInvoiceCoverage");
    const unallocatedPaymentPattern = row.variance > 0.01 &&
        paymentCount > 0 &&
        (near(Math.abs(paymentSum), row.variance, Math.max(100, row.variance * 0.15)) ||
            near(crossAccountPaymentAmount, row.variance, Math.max(100, row.variance * 0.2)) ||
            near(crossAccountInboundPaymentAmount, row.variance, Math.max(100, row.variance * 0.2)) ||
            (paymentSum < -0.01 && row.ledgerBalanceFromImport < row.ageAnalysisBalance - 100));
    if (unallocatedPaymentPattern)
        patterns.push("unallocatedPaymentPattern");
    const siblingList = [...siblingNos];
    let siblingCombinedAge = row.ageAnalysisBalance;
    let siblingCombinedLedger = row.ledgerBalanceFromImport;
    for (const sib of siblingList) {
        const rec = reconciliationByAccount.get(sib);
        if (!rec)
            continue;
        siblingCombinedAge += rec.age;
        siblingCombinedLedger += rec.ledger;
    }
    const siblingCombinedVariance = Math.round((siblingCombinedAge - siblingCombinedLedger) * 100) / 100;
    const familyVarianceImprovement = Math.round((Math.abs(row.variance) - Math.abs(siblingCombinedVariance)) * 100) / 100;
    const crossAccountCreditOnLinked = siblingList.length > 0 &&
        siblingList.some((sib) => {
            const rec = reconciliationByAccount.get(sib);
            return rec && rec.ledger < -0.01 && row.ageAnalysisBalance > 0.01;
        });
    if (crossAccountCreditOnLinked)
        patterns.push("crossAccountCreditOnLinked");
    const familyLinkedCreditOffset = siblingList.length > 0 &&
        Math.abs(siblingCombinedVariance) < Math.abs(row.variance) - 100 &&
        (crossAccountInboundPaymentAmount > 200 || crossAccountPaymentAmount > 200);
    if (familyLinkedCreditOffset)
        patterns.push("familyLinkedCreditOffset");
    const historicalReceiptOrPaymentOnly = (paymentCount > 0 && invoiceCount === 0) ||
        (invoiceCount > 0 && paymentCount === 0 && row.variance > 0.01) ||
        (receiptOnlyPaymentCount >= Math.max(3, Math.floor(paymentCount * 0.5)) && row.variance > 500);
    if (historicalReceiptOrPaymentOnly)
        patterns.push("historicalReceiptOrPaymentOnly");
    let explainedByPaymentTheory = false;
    let explanationConfidence = "none";
    let explanationNote = "";
    let primaryExplanation = "unexplained";
    if (patterns.includes("familyLinkedCreditOffset")) {
        explainedByPaymentTheory = true;
        explanationConfidence = near(Math.abs(siblingCombinedVariance), 0, 100) ? "high" : "medium";
        primaryExplanation = "familyLinkedCreditOffset";
        explanationNote = `Sibling group (${siblingList.join(", ")}) combined variance R${siblingCombinedVariance} vs solo R${row.variance}; cross-account payments in/out R${crossAccountInboundPaymentAmount}/R${crossAccountPaymentAmount}.`;
    }
    else if (patterns.includes("crossAccountCreditOnLinked") && crossAccountInboundPaymentAmount > 100) {
        explainedByPaymentTheory = true;
        explanationConfidence = near(crossAccountInboundPaymentAmount, row.variance, Math.max(150, row.variance * 0.25))
            ? "high"
            : "medium";
        primaryExplanation = "crossAccountCreditOnLinked";
        explanationNote = `Credit on linked account(s); R${crossAccountInboundPaymentAmount} payments posted on sibling account(s) map to this family.`;
    }
    else if (patterns.includes("unallocatedPaymentPattern")) {
        explainedByPaymentTheory = true;
        explanationConfidence =
            near(Math.abs(paymentSum), row.variance, 150) || near(crossAccountPaymentAmount, row.variance, 150)
                ? "high"
                : "medium";
        primaryExplanation = "unallocatedPaymentPattern";
        explanationNote = `Age R${row.ageAnalysisBalance} > ledger R${row.ledgerBalanceFromImport}; payments R${Math.abs(paymentSum)} may be captured in export but not reflected in age allocation.`;
    }
    else if (patterns.includes("negativeLedgerPositiveAge")) {
        explainedByPaymentTheory = true;
        explanationConfidence = "medium";
        primaryExplanation = "negativeLedgerPositiveAge";
        explanationNote = `Ledger credit R${row.ledgerBalanceFromImport} vs age owing R${row.ageAnalysisBalance} — classic over-payment / unallocated credit pattern.`;
    }
    else if (patterns.includes("paymentsWithoutInvoiceCoverage")) {
        explainedByPaymentTheory = true;
        explanationConfidence = "low";
        primaryExplanation = "paymentsWithoutInvoiceCoverage";
        explanationNote = `Payments (R${Math.abs(paymentSum)}) exceed invoice coverage on export; age may still carry invoice debt.`;
    }
    else if (patterns.includes("historicalReceiptOrPaymentOnly")) {
        explainedByPaymentTheory = true;
        explanationConfidence = "low";
        primaryExplanation = "historicalReceiptOrPaymentOnly";
        explanationNote = `Skewed receipt/invoice history (${invoiceCount} inv / ${paymentCount} pay).`;
    }
    if (patterns.length > 1 && explainedByPaymentTheory) {
        primaryExplanation = "multiPattern";
    }
    return {
        accountNo,
        fullName: row.fullName,
        auditReason: row.auditReason,
        ageAnalysisBalance: row.ageAnalysisBalance,
        ledgerBalanceFromImport: row.ledgerBalanceFromImport,
        variance: row.variance,
        patterns,
        primaryExplanation,
        explainedByPaymentTheory,
        explanationConfidence,
        explanationNote,
        metrics: {
            rawLedgerOnAccountNo: rawLedger,
            familyMappedLedger: row.ledgerBalanceFromImport,
            invoiceSum,
            paymentSum,
            paymentCount,
            invoiceCount,
            crossAccountPaymentAmount: Math.round(crossAccountPaymentAmount * 100) / 100,
            crossAccountInboundPaymentAmount: Math.round(crossAccountInboundPaymentAmount * 100) / 100,
            misPostedTxnCount,
            siblingAccountNos: siblingList,
            siblingCombinedAge: Math.round(siblingCombinedAge * 100) / 100,
            siblingCombinedLedger: Math.round(siblingCombinedLedger * 100) / 100,
            siblingCombinedVariance,
            familyVarianceImprovement,
            paymentToInvoiceRatio,
            receiptOnlyPaymentCount,
            invoiceOnlyPeriod: invoiceCount > 0 && paymentCount === 0,
        },
    };
}
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const bundle = (0, daSilvaMigrationService_1.buildDaSilvaBundleFromDesktopLayout)("audit", "audit", desktopRoot);
const contacts = (0, parsers_1.parseContactListFile)(path_1.default.join(desktopRoot, "04_contact_list", "contact_list.xls"));
const mismatchPath = path_1.default.join(__dirname, "..", "active-age-mismatches.json");
const allRows = JSON.parse(fs_1.default.readFileSync(mismatchPath, "utf8"));
const targets = allRows.filter((r) => r.auditReason === "trueBalanceMismatch" ||
    r.auditReason === "possibleDuplicateOrHistoricalCredit");
const classLearners = bundle.learners.map((l) => ({
    fullName: l.fullName,
    firstName: l.firstName,
    lastName: l.lastName,
    className: l.className,
    matchKey: `${l.fullName}|${l.className}`,
    sourceFile: "staged",
}));
const familyIndex = {
    learnerNameToAccount: new Map(),
    accountToLearnerNames: new Map(),
};
(0, daSilvaMergedFamily_1.indexHistoricalLearners)(bundle.accounts, [], classLearners, contacts, bundle.transactions, familyIndex);
const parentSiblings = buildParentSiblingMap(contacts, bundle.accounts, familyIndex);
const reconciliationByAccount = new Map(bundle.reconciliation.rows.map((r) => [
    r.accountNo,
    {
        age: r.ageAnalysisBalance,
        ledger: r.ledgerBalanceFromImport,
        variance: r.variance,
    },
]));
const audits = targets.map((row) => {
    const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
    const txnsOnAccount = bundle.transactions.filter((t) => t.accountNo === row.accountNo);
    const siblings = parentSiblings.get(row.accountNo) || new Set();
    return classifyAccount(row, account, txnsOnAccount, bundle.transactions, familyIndex, [...siblings], reconciliationByAccount);
});
function countPattern(flag) {
    return audits.filter((a) => a.patterns.includes(flag)).length;
}
const explainedHigh = audits.filter((a) => a.explainedByPaymentTheory && a.explanationConfidence === "high");
const explainedMedium = audits.filter((a) => a.explainedByPaymentTheory && a.explanationConfidence === "medium");
const explainedLow = audits.filter((a) => a.explainedByPaymentTheory && a.explanationConfidence === "low");
const explainedAny = audits.filter((a) => a.explainedByPaymentTheory);
const unexplained = audits.filter((a) => !a.explainedByPaymentTheory);
const byReason = {
    trueBalanceMismatch: audits.filter((a) => a.auditReason === "trueBalanceMismatch"),
    possibleDuplicateOrHistoricalCredit: audits.filter((a) => a.auditReason === "possibleDuplicateOrHistoricalCredit"),
};
const report = {
    generatedAt: new Date().toISOString(),
    desktopRoot,
    auditOnly: true,
    targetCount: targets.length,
    breakdown: {
        trueBalanceMismatch: byReason.trueBalanceMismatch.length,
        possibleDuplicateOrHistoricalCredit: byReason.possibleDuplicateOrHistoricalCredit.length,
    },
    patternCounts: {
        unallocatedPaymentPattern: countPattern("unallocatedPaymentPattern"),
        crossAccountCreditOnLinked: countPattern("crossAccountCreditOnLinked"),
        paymentsWithoutInvoiceCoverage: countPattern("paymentsWithoutInvoiceCoverage"),
        negativeLedgerPositiveAge: countPattern("negativeLedgerPositiveAge"),
        familyLinkedCreditOffset: countPattern("familyLinkedCreditOffset"),
        historicalReceiptOrPaymentOnly: countPattern("historicalReceiptOrPaymentOnly"),
    },
    explanationEstimates: {
        explainedHighConfidence: explainedHigh.length,
        explainedMediumConfidence: explainedMedium.length,
        explainedLowConfidence: explainedLow.length,
        explainedAnyConfidence: explainedAny.length,
        unexplained: unexplained.length,
        pctExplainedAny: Math.round((explainedAny.length / targets.length) * 1000) / 10,
        pctExplainedHighOrMedium: Math.round(((explainedHigh.length + explainedMedium.length) / targets.length) * 1000) / 10,
        trueBalanceMismatchExplained: byReason.trueBalanceMismatch.filter((a) => a.explainedByPaymentTheory)
            .length,
        creditRowExplained: byReason.possibleDuplicateOrHistoricalCredit.filter((a) => a.explainedByPaymentTheory).length,
    },
    crossAccountStats: {
        accountsWithMisPostedTxns: audits.filter((a) => a.metrics.misPostedTxnCount > 0).length,
        accountsWithSiblingLink: audits.filter((a) => a.metrics.siblingAccountNos.length > 0).length,
        accountsWithInboundCrossPayments: audits.filter((a) => a.metrics.crossAccountInboundPaymentAmount > 0).length,
        totalCrossAccountOutbound: Math.round(audits.reduce((s, a) => s + a.metrics.crossAccountPaymentAmount, 0) * 100) / 100,
        totalCrossAccountInbound: Math.round(audits.reduce((s, a) => s + a.metrics.crossAccountInboundPaymentAmount, 0) * 100) / 100,
    },
    audits: audits.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
};
const outJson = path_1.default.join(__dirname, "..", "payment-allocation-mismatch-audit.json");
const outTxt = path_1.default.join(__dirname, "..", "payment-allocation-mismatch-audit.txt");
fs_1.default.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");
const lines = [
    "=== Payment allocation / cross-account mismatch audit (read-only) ===",
    `Generated: ${report.generatedAt}`,
    `Targets: ${report.targetCount} (84 trueBalanceMismatch + 27 possibleDuplicateOrHistoricalCredit)`,
    "",
    "Pattern counts (accounts may match multiple):",
    ...Object.entries(report.patternCounts).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Explanation estimates (unallocated / cross-account payment theory):",
    `  High confidence: ${report.explanationEstimates.explainedHighConfidence}`,
    `  Medium confidence: ${report.explanationEstimates.explainedMediumConfidence}`,
    `  Low confidence: ${report.explanationEstimates.explainedLowConfidence}`,
    `  Any explained: ${report.explanationEstimates.explainedAnyConfidence} (${report.explanationEstimates.pctExplainedAny}%)`,
    `  High+medium: ${report.explanationEstimates.explainedHighConfidence + report.explanationEstimates.explainedMediumConfidence} (${report.explanationEstimates.pctExplainedHighOrMedium}%)`,
    `  Unexplained: ${report.explanationEstimates.unexplained}`,
    `  trueBalanceMismatch explained: ${report.explanationEstimates.trueBalanceMismatchExplained}/84`,
    `  possibleDuplicate explained: ${report.explanationEstimates.creditRowExplained}/27`,
    "",
    "Cross-account stats:",
    ...Object.entries(report.crossAccountStats).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Top 25 by |variance| — patterns:",
    "accountNo | reason | variance | patterns | explained",
    "--------- | ------ | -------- | -------- | ---------",
];
for (const a of report.audits.slice(0, 25)) {
    lines.push(`${a.accountNo.padEnd(9)} | ${a.auditReason.slice(0, 12).padEnd(12)} | ${String(a.variance).padStart(8)} | ${a.patterns.join(",") || "-"} | ${a.explainedByPaymentTheory ? a.explanationConfidence : "no"}`);
}
fs_1.default.writeFileSync(outTxt, lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log(`\nWrote ${outJson}`);
