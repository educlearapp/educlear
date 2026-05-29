"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Audit-only: deep-dive 79 possible unallocated payment opening-balance rows.
 * Usage: npx ts-node scripts/unallocated-payment-deep-dive.ts [desktopRoot]
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaMergedFamily_1 = require("../src/services/daSilvaMigration/daSilvaMergedFamily");
const parsers_1 = require("../src/services/daSilvaMigration/parsers");
const kideesysSpreadsheet_1 = require("../src/utils/kideesysSpreadsheet");
const HISTORICAL_MOVEMENT_NOTE = /\b(removed|refund|closed|not returning|relocat|write[\s-]?off|learner left|no longer|cancelled|canceled|credit note|discount|not doing|left school|historical|jamf|cutover|opening)\b/i;
const UNALLOCATED_PAYMENT_NOTE = /\b(unalloc|not alloc|advance|on account|suspense|bulk pay|unallocated|prepaid|credit on account|held|float)\b/i;
const RECEIPT_TYPE_NOTE = /\b(receipt|eft|deposit|cash|paid|payment|bank|card|snapscan|ozow)\b/i;
function roundMoney(n) {
    return Math.round(n * 100) / 100;
}
function near(a, b, tol) {
    return Math.abs(a - b) <= tol;
}
function sumPayments(txns) {
    return roundMoney(txns.filter((t) => t.kind === "payment").reduce((s, t) => s + t.signedAmount, 0));
}
function sumInvoices(txns) {
    return roundMoney(txns.filter((t) => t.kind === "invoice").reduce((s, t) => s + t.signedAmount, 0));
}
function resolveFamilyAccountNo(txn, index) {
    const byName = index.learnerNameToAccount.get((0, kideesysSpreadsheet_1.normalizeMatchText)(txn.fullName));
    if (byName)
        return byName;
    return String(txn.accountNo || "").trim();
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
function buildParentSiblingMap(contacts, index) {
    const accountToSiblings = new Map();
    const byParent = new Map();
    for (const contact of contacts) {
        const key = parentGroupKey(contact.parents);
        if (!key)
            continue;
        const accountNo = index.learnerNameToAccount.get((0, kideesysSpreadsheet_1.normalizeMatchText)(contact.fullName));
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
function paymentCoveragePercent(invoiceSum, paymentSum) {
    if (invoiceSum <= 0.01)
        return null;
    return roundMoney((Math.abs(paymentSum) / invoiceSum) * 100);
}
function detectUnallocatedSignals(txns) {
    const payments = txns.filter((t) => t.kind === "payment");
    let receiptStylePaymentCount = 0;
    let unallocatedNotePaymentCount = 0;
    for (const t of payments) {
        const note = String(t.notes || "");
        if (RECEIPT_TYPE_NOTE.test(note) && !/\binvoice\b/i.test(note))
            receiptStylePaymentCount++;
        if (UNALLOCATED_PAYMENT_NOTE.test(note))
            unallocatedNotePaymentCount++;
    }
    const parts = [];
    if (receiptStylePaymentCount > 0) {
        parts.push(`${receiptStylePaymentCount} receipt-style payment note(s)`);
    }
    if (unallocatedNotePaymentCount > 0) {
        parts.push(`${unallocatedNotePaymentCount} note(s) mention unallocated/advance/on-account`);
    }
    const blankNotePayments = payments.filter((p) => !String(p.notes || "").trim()).length;
    if (blankNotePayments > 0) {
        parts.push(`${blankNotePayments} payment(s) with blank notes (Kid-e-Sys receipt export)`);
    }
    const hasSignals = receiptStylePaymentCount > 0 ||
        unallocatedNotePaymentCount > 0 ||
        blankNotePayments > 0;
    return {
        hasSignals,
        detail: parts.length ? parts.join("; ") : "no receipt/unallocated note hints on payments",
        receiptStylePaymentCount,
        unallocatedNotePaymentCount,
    };
}
function classifyLikelyCause(opts) {
    const { row, invoiceCount, paymentCount, invoiceSum, paymentSum, lifetimeOverpayment, hasUnallocatedSignals, misPostedTxnCount, crossAccountInbound, crossAccountOutbound, duplicateNameCount, historicalOnlyLedger, historicalNoteTxnCount, section, computedLedger, } = opts;
    const variance = row.variance;
    const age = row.ageAnalysisBalance;
    const ledger = row.ledgerBalanceFromImport;
    if (misPostedTxnCount > 0 ||
        duplicateNameCount > 1 ||
        (crossAccountInbound > 300 && crossAccountOutbound > 300) ||
        (row.paymentPatterns.length > 2 && !row.paymentPatterns.includes("unallocatedPaymentPattern"))) {
        return {
            cause: "manualReview",
            confidence: misPostedTxnCount > 0 ? "high" : "medium",
            detail: `Cross-account or duplicate-name complexity (mis-posted ${misPostedTxnCount}, duplicate accounts ${duplicateNameCount}, inbound R${crossAccountInbound}, outbound R${crossAccountOutbound}).`,
        };
    }
    if (historicalOnlyLedger ||
        (paymentCount === 0 && invoiceCount === 0 && Math.abs(age) > 0.01) ||
        (section === "Bad Debt" && historicalNoteTxnCount > 0 && paymentCount === 0)) {
        return {
            cause: "historicalCutoverOpeningBalanceNeeded",
            confidence: historicalOnlyLedger || paymentCount + invoiceCount === 0 ? "high" : "medium",
            detail: historicalOnlyLedger
                ? "Ledger movements are historical/write-off only — opening balance aligner, not allocation fix."
                : paymentCount + invoiceCount === 0
                    ? "No invoice/payment rows on export — opening balance adjustment only."
                    : "Bad-debt section with historical-only movements — verify cutover opening balance in Kid-e-Sys.",
        };
    }
    if (paymentCount === 0 &&
        invoiceCount > 0 &&
        near(computedLedger, invoiceSum, 150) &&
        age > ledger + 500) {
        return {
            cause: "missingPaymentItem",
            confidence: "high",
            detail: `${invoiceCount} invoice(s) on export (R${invoiceSum}) but no payment rows — age R${age} vs ledger R${ledger}; payments may exist in Kid-e-Sys but not in export.`,
        };
    }
    if (invoiceCount === 0 &&
        paymentCount > 0 &&
        age > Math.abs(paymentSum) + 500) {
        return {
            cause: "missingInvoiceItem",
            confidence: "high",
            detail: `No invoice rows on export (${paymentCount} payment(s), R${Math.abs(paymentSum)}); age R${age} not explained by import ledger.`,
        };
    }
    const exportExplainsLedger = near(roundMoney(invoiceSum + paymentSum), ledger, 200);
    const ageNotExplainedByExport = age > roundMoney(invoiceSum + Math.abs(paymentSum)) + Math.max(300, variance * 0.2);
    if (ageNotExplainedByExport && exportExplainsLedger) {
        return {
            cause: "missingInvoiceItem",
            confidence: "medium",
            detail: `Export ledger (R${ledger}) tracks inv+pay; age R${age} exceeds export invoice coverage by R${roundMoney(age - invoiceSum - Math.abs(paymentSum))} — invoice lines likely missing from export.`,
        };
    }
    if (paymentCount > 0 &&
        invoiceCount > 0 &&
        Math.abs(paymentSum) < invoiceSum * 0.35 &&
        age > ledger + 500) {
        return {
            cause: "missingPaymentItem",
            confidence: "medium",
            detail: `Low payment coverage (${paymentCoveragePercent(invoiceSum, paymentSum) ?? 0}%) vs age debt; additional payment rows may be missing from export.`,
        };
    }
    if (paymentCount > 0 &&
        invoiceCount > 0 &&
        (hasUnallocatedSignals ||
            row.paymentPatterns.includes("unallocatedPaymentPattern") ||
            row.paymentMatchConfidence !== "none") &&
        age > ledger + 0.01) {
        const tightMatch = row.paymentMatchConfidence === "high" ||
            near(lifetimeOverpayment, variance, Math.max(100, variance * 0.15)) ||
            near(Math.abs(paymentSum), variance, Math.max(100, variance * 0.15));
        return {
            cause: "normalKidESysAllocationGap",
            confidence: tightMatch ? "high" : "medium",
            detail: tightMatch
                ? `Payments in export (R${Math.abs(paymentSum)}) align with variance R${variance}; age R${age} vs ledger R${ledger} — typical Kid-e-Sys payment captured on ledger but not allocated in age analysis.`
                : `Both invoices and payments present; age R${age} > ledger R${ledger} with payment/export skew (${row.paymentPatterns.join(", ") || "unallocatedPaymentPattern"}).`,
        };
    }
    return {
        cause: "manualReview",
        confidence: "low",
        detail: `Mixed signals: ${invoiceCount} inv / ${paymentCount} pay, coverage ${paymentCoveragePercent(invoiceSum, paymentSum) ?? "n/a"}%, patterns ${row.paymentPatterns.join(", ") || "none"}.`,
    };
}
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const reviewPath = path_1.default.join(__dirname, "..", "opening-balance-adjustment-review.json");
if (!fs_1.default.existsSync(reviewPath)) {
    console.error(`Missing ${reviewPath} — run opening-balance-adjustment-review.ts first.`);
    process.exit(1);
}
const review = JSON.parse(fs_1.default.readFileSync(reviewPath, "utf8"));
const targets = (review.accountsByReasonGroup?.possibleUnallocatedPayment || []).map((r) => ({
    accountNo: r.accountNo,
    fullName: r.fullName,
    ageAnalysisBalance: r.ageAnalysisBalance,
    ledgerBalanceFromImport: r.ledgerBalanceFromImport,
    adjustmentAmount: r.adjustmentAmount ?? r.variance,
    variance: r.variance,
    paymentPatterns: r.paymentPatterns || [],
    paymentMatchConfidence: r.paymentMatchConfidence || "none",
}));
if (targets.length !== 79) {
    console.warn(`Expected 79 unallocated-payment targets, got ${targets.length} (continuing).`);
}
const bundle = (0, daSilvaMigrationService_1.buildDaSilvaBundleFromDesktopLayout)("audit", "audit", desktopRoot);
let contacts = [];
const contactPath = path_1.default.join(desktopRoot, "04_contact_list", "contact_list.xls");
if (fs_1.default.existsSync(contactPath)) {
    contacts = (0, parsers_1.parseContactListFile)(contactPath);
}
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
const parentSiblings = buildParentSiblingMap(contacts, familyIndex);
const activeLearnersByAccount = (0, daSilvaMergedFamily_1.countActiveLearnersPerAccount)(classLearners, bundle.accounts, familyIndex);
const nameToAccounts = new Map();
for (const account of bundle.accounts) {
    const names = (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
    const list = names.length ? names : [account.fullName];
    for (const name of list) {
        const key = (0, kideesysSpreadsheet_1.normalizeMatchText)(name);
        if (!key)
            continue;
        const accts = nameToAccounts.get(key) || [];
        if (!accts.includes(account.accountNo))
            accts.push(account.accountNo);
        nameToAccounts.set(key, accts);
    }
}
const deepDives = [];
for (const row of targets) {
    const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
    const txns = bundle.transactions.filter((t) => t.accountNo === row.accountNo);
    const invoiceCount = txns.filter((t) => t.kind === "invoice").length;
    const paymentCount = txns.filter((t) => t.kind === "payment").length;
    const invoiceSum = sumInvoices(txns);
    const paymentSum = sumPayments(txns);
    const totalInvoices = invoiceSum;
    const totalPayments = roundMoney(Math.abs(paymentSum));
    const coverage = paymentCoveragePercent(invoiceSum, paymentSum);
    const lifetimeOverpayment = roundMoney(Math.abs(paymentSum) - invoiceSum);
    let misPostedTxnCount = 0;
    let crossAccountOutbound = 0;
    let crossAccountInbound = 0;
    for (const t of txns) {
        const family = resolveFamilyAccountNo(t, familyIndex);
        if (family && family !== row.accountNo) {
            misPostedTxnCount++;
            if (t.kind === "payment")
                crossAccountOutbound += Math.abs(t.signedAmount);
        }
    }
    for (const t of bundle.transactions) {
        if (t.accountNo === row.accountNo)
            continue;
        const family = resolveFamilyAccountNo(t, familyIndex);
        if (family === row.accountNo && t.kind === "payment") {
            crossAccountInbound += Math.abs(t.signedAmount);
        }
    }
    const duplicateNameAccountNos = [];
    for (const name of (0, daSilvaMergedFamily_1.splitMergedAccountNames)(row.fullName).length
        ? (0, daSilvaMergedFamily_1.splitMergedAccountNames)(row.fullName)
        : [row.fullName]) {
        const key = (0, kideesysSpreadsheet_1.normalizeMatchText)(name);
        for (const acct of nameToAccounts.get(key) || []) {
            if (!duplicateNameAccountNos.includes(acct))
                duplicateNameAccountNos.push(acct);
        }
    }
    const historicalOnlyLedger = txns.length > 0 &&
        txns.every((t) => {
            const note = String(t.notes || "").trim();
            return !note || HISTORICAL_MOVEMENT_NOTE.test(note);
        });
    const historicalNoteTxnCount = txns.filter((t) => HISTORICAL_MOVEMENT_NOTE.test(String(t.notes || ""))).length;
    let running = 0;
    for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date))) {
        running = roundMoney(running + t.signedAmount);
    }
    const computedLedger = running;
    const signal = detectUnallocatedSignals(txns);
    const { cause, confidence, detail } = classifyLikelyCause({
        row,
        txns,
        invoiceCount,
        paymentCount,
        invoiceSum,
        paymentSum,
        lifetimeOverpayment,
        hasUnallocatedSignals: signal.hasSignals,
        misPostedTxnCount,
        crossAccountInbound,
        crossAccountOutbound,
        duplicateNameCount: duplicateNameAccountNos.length,
        historicalOnlyLedger,
        historicalNoteTxnCount,
        section: account?.section || "",
        computedLedger,
    });
    deepDives.push({
        accountNo: row.accountNo,
        fullName: row.fullName,
        ageAnalysisBalance: row.ageAnalysisBalance,
        ledgerBalanceFromImport: row.ledgerBalanceFromImport,
        adjustmentAmount: row.adjustmentAmount,
        totalInvoices,
        totalPayments,
        invoiceCount,
        paymentCount,
        paymentCoveragePercent: coverage,
        hasUnallocatedPaymentSignals: signal.hasSignals,
        unallocatedSignalDetail: signal.detail,
        likelyCause: cause,
        causeConfidence: confidence,
        causeDetail: detail,
        section: account?.section || "",
        metrics: {
            invoiceSum,
            paymentSum,
            computedLedgerFromTxns: computedLedger,
            variance: row.variance,
            lifetimeOverpayment,
            crossAccountOutboundPaymentTotal: roundMoney(crossAccountOutbound),
            crossAccountInboundPaymentTotal: roundMoney(crossAccountInbound),
            misPostedTxnCount,
            receiptStylePaymentCount: signal.receiptStylePaymentCount,
            unallocatedNotePaymentCount: signal.unallocatedNotePaymentCount,
            historicalNoteTxnCount,
            duplicateNameAccountNos,
            siblingAccountNos: [...(parentSiblings.get(row.accountNo) || new Set())],
            activeLearnerCount: activeLearnersByAccount.get(row.accountNo) || 0,
            paymentPatterns: row.paymentPatterns,
            paymentMatchConfidence: row.paymentMatchConfidence,
        },
    });
}
deepDives.sort((a, b) => Math.abs(b.adjustmentAmount) - Math.abs(a.adjustmentAmount));
const causeCounts = {
    normalKidESysAllocationGap: 0,
    missingInvoiceItem: 0,
    missingPaymentItem: 0,
    historicalCutoverOpeningBalanceNeeded: 0,
    manualReview: 0,
};
for (const d of deepDives)
    causeCounts[d.likelyCause]++;
const report = {
    generatedAt: new Date().toISOString(),
    desktopRoot,
    auditOnly: true,
    sourceReview: "opening-balance-adjustment-review.json",
    reasonGroup: "possibleUnallocatedPayment",
    accountCount: deepDives.length,
    totalAbsAdjustment: roundMoney(deepDives.reduce((s, d) => s + Math.abs(d.adjustmentAmount), 0)),
    likelyCauseCounts: causeCounts,
    accountsWithUnallocatedSignals: deepDives.filter((d) => d.hasUnallocatedPaymentSignals).length,
    accounts: deepDives,
};
const outJson = path_1.default.join(__dirname, "..", "unallocated-payment-deep-dive.json");
const outTxt = path_1.default.join(__dirname, "..", "unallocated-payment-deep-dive.txt");
fs_1.default.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");
const causeLabels = {
    normalKidESysAllocationGap: "normal Kid-e-Sys allocation gap",
    missingInvoiceItem: "missing invoice item",
    missingPaymentItem: "missing payment item",
    historicalCutoverOpeningBalanceNeeded: "historical cutover/opening balance needed",
    manualReview: "manual review",
};
const lines = [
    "=== Unallocated payment deep dive (79 rows, audit only — no import) ===",
    `Generated: ${report.generatedAt}`,
    `Desktop: ${desktopRoot}`,
    `Accounts: ${report.accountCount} | Sum |adjustment|: R${report.totalAbsAdjustment.toFixed(2)}`,
    `Accounts with payment/receipt unallocated signals: ${report.accountsWithUnallocatedSignals}`,
    "",
    "Likely cause summary:",
    ...Object.entries(causeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `  ${causeLabels[k]}: ${n}`),
    "",
    "Top 15 by |adjustmentAmount|:",
    "accountNo | cause | conf | age | ledger | adj | invR | payR | cov% | signals | learner",
    "--------- | ----- | ---- | --- | ------ | --- | ---- | ---- | ---- | ------- | -------",
];
for (const d of deepDives.slice(0, 15)) {
    const name = String(d.fullName || "")
        .replace(/\n/g, " / ")
        .slice(0, 24);
    const cov = d.paymentCoveragePercent === null ? "n/a" : `${d.paymentCoveragePercent.toFixed(0)}`;
    const sig = d.hasUnallocatedPaymentSignals ? "yes" : "no";
    lines.push(`${d.accountNo.padEnd(9)} | ${causeLabels[d.likelyCause].padEnd(35)} | ${d.causeConfidence.padEnd(4)} | ${String(d.ageAnalysisBalance).padStart(5)} | ${String(d.ledgerBalanceFromImport).padStart(6)} | ${String(d.adjustmentAmount).padStart(5)} | ${String(d.totalInvoices).padStart(4)} | ${String(d.totalPayments).padStart(4)} | ${cov.padStart(4)} | ${sig.padEnd(7)} | ${name}`);
}
lines.push("", "Per-account detail (all 79):", "");
for (const d of deepDives) {
    lines.push(`--- ${d.accountNo} ${d.fullName} ---`);
    lines.push(`  age R${d.ageAnalysisBalance} | ledger R${d.ledgerBalanceFromImport} | adjustment R${d.adjustmentAmount} | section: ${d.section || "(none)"}`);
    lines.push(`  total invoices: R${d.totalInvoices} (${d.invoiceCount}) | total payments: R${d.totalPayments} (${d.paymentCount}) | coverage: ${d.paymentCoveragePercent === null ? "n/a" : `${d.paymentCoveragePercent}%`}`);
    lines.push(`  unallocated signals: ${d.hasUnallocatedPaymentSignals ? "yes" : "no"} — ${d.unallocatedSignalDetail}`);
    lines.push(`  likely cause: ${causeLabels[d.likelyCause]} (${d.causeConfidence}) — ${d.causeDetail}`);
    if (d.metrics.siblingAccountNos.length) {
        lines.push(`  siblings: ${d.metrics.siblingAccountNos.join(", ")}`);
    }
    if (d.metrics.duplicateNameAccountNos.length > 1) {
        lines.push(`  duplicate-name accounts: ${d.metrics.duplicateNameAccountNos.join(", ")}`);
    }
    lines.push("");
}
lines.push("Full JSON: unallocated-payment-deep-dive.json");
fs_1.default.writeFileSync(outTxt, lines.join("\n"), "utf8");
console.log([
    lines[0],
    lines[1],
    lines[2],
    lines[3],
    lines[4],
    "",
    lines[6],
    ...lines.slice(7, 7 + Object.keys(causeCounts).length),
    "",
    ...lines.slice(lines.indexOf("Top 15 by |adjustmentAmount|:"), lines.indexOf("Top 15 by |adjustmentAmount|:") + 18),
    "",
    `Wrote ${outJson}`,
    `Wrote ${outTxt}`,
].join("\n"));
