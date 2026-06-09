/**
 * Rebuild Da Silva baseline from Payment Receive List PDF (balance authority).
 * transaction_list_kideesys.xlsx is payment history only — never used for balances.
 *
 *   npx ts-node --transpile-only scripts/rebuild-da-silva-payment-receive-baseline.ts
 *   npx ts-node --transpile-only scripts/rebuild-da-silva-payment-receive-baseline.ts --apply
 *
 * Env:
 *   PAYMENT_RECEIVE_PDF=/path/to/payment_receive_list.pdf
 *   KIDE_TRANSACTION_LIST=/path/to/transaction_list_kideesys.xlsx
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { isKidESysSourceAccountRef } from "../src/services/daSilvaMigration/ageAnalysisParser";
import { parseTransactionListFile } from "../src/services/daSilvaMigration/parsers";
import {
  buildPaymentReceiveListSnapshots,
  buildPaymentReceiveVerificationTable,
  calculatePaymentReceiveCardTotals,
  DA_SILVA_AGE_BASELINE_IMPORTED_AT,
} from "../src/services/migrationCentre/paymentReceiveListExactBaseline";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  resolveAuthoritativeAccountBalanceFromSnapshot,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../src/utils/familyAccountAgeAnalysisStore";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const SPOT_CHECK_ACCOUNTS = ["ALI002", "ADA004", "AFR002", "RAM021", "MAO002", "MDU001"];
const DEFAULT_PDF = "/Users/dasilvaacademy/Desktop/payment_receive_list.pdf";
const DEFAULT_XLSX = "/Users/dasilvaacademy/Desktop/transaction_list_kideesys.xlsx";

type ActiveIndex = {
  activeAccountRefs: Set<string>;
  familyAccountCount: number;
  activeLearnerCount: number;
  historicalAccountRefs: Set<string>;
  pdfAccountsNotActive: string[];
  activeAccountsMissingFromPdf: string[];
};

async function buildActiveFamilyAccountIndex(
  schoolId: string,
  pdfAccountRefs: Set<string>
): Promise<ActiveIndex> {
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      enrollmentStatus: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true } },
    },
  });

  const activeAccountRefs = new Set<string>();
  const historicalAccountRefs = new Set<string>();
  let activeLearnerCount = 0;

  for (const learner of learners) {
    const ref = String(learner.familyAccount?.accountRef || "")
      .trim()
      .toUpperCase();
    if (!ref || !isKidESysSourceAccountRef(ref)) continue;

    if (learner.enrollmentStatus === "ACTIVE") {
      activeLearnerCount += 1;
      activeAccountRefs.add(ref);
    } else if (learner.enrollmentStatus === "HISTORICAL") {
      historicalAccountRefs.add(ref);
    }
  }

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
    select: { accountRef: true },
  });
  const familyAccountCount = familyAccounts.filter((fa) =>
    isKidESysSourceAccountRef(String(fa.accountRef || "").trim())
  ).length;

  const pdfAccountsNotActive = Array.from(pdfAccountRefs)
    .filter((ref) => !activeAccountRefs.has(ref))
    .sort();
  const activeAccountsMissingFromPdf = Array.from(activeAccountRefs)
    .filter((ref) => !pdfAccountRefs.has(ref))
    .sort();

  return {
    activeAccountRefs,
    familyAccountCount,
    activeLearnerCount,
    historicalAccountRefs,
    pdfAccountsNotActive,
    activeAccountsMissingFromPdf,
  };
}

function loadJuneTransactionStats(
  xlsxPath: string,
  activeAccountRefs: Set<string>
): {
  juneTransactionsTotal: number;
  junePaymentsImported: number;
  junePaymentsIgnored: number;
  juneInvoicesTotal: number;
  ignoredInactiveAccountRefs: string[];
} {
  if (!fs.existsSync(xlsxPath)) {
    return {
      juneTransactionsTotal: 0,
      junePaymentsImported: 0,
      junePaymentsIgnored: 0,
      juneInvoicesTotal: 0,
      ignoredInactiveAccountRefs: [],
    };
  }

  const parsed = parseTransactionListFile(xlsxPath);
  const ignoredInactiveAccountRefs = new Set<string>();
  let junePaymentsImported = 0;
  let junePaymentsIgnored = 0;
  let juneInvoicesTotal = 0;

  for (const tx of parsed) {
    const acct = String(tx.accountNo || "").trim().toUpperCase();
    if (tx.kind === "invoice") {
      juneInvoicesTotal += 1;
      continue;
    }
    if (tx.kind !== "payment") continue;
    if (!acct || !activeAccountRefs.has(acct)) {
      junePaymentsIgnored += 1;
      if (acct) ignoredInactiveAccountRefs.add(acct);
      continue;
    }
    junePaymentsImported += 1;
  }

  return {
    juneTransactionsTotal: parsed.length,
    junePaymentsImported,
    junePaymentsIgnored,
    juneInvoicesTotal,
    ignoredInactiveAccountRefs: Array.from(ignoredInactiveAccountRefs).sort(),
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pdfPath = path.resolve(process.env.PAYMENT_RECEIVE_PDF || DEFAULT_PDF);
  const xlsxPath = path.resolve(process.env.KIDE_TRANSACTION_LIST || DEFAULT_XLSX);

  const { audit, uniqueByAccount } = await import(
    "../src/services/daSilvaMigration/paymentReceiveListParser"
  ).then((m) => m.parsePaymentReceiveListPdf(pdfPath));

  const pdfAccountRefs = new Set(Object.keys(uniqueByAccount));
  const activeIndex = await buildActiveFamilyAccountIndex(SCHOOL_ID, pdfAccountRefs);

  const beforeSnapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID);
  const ledger = readSchoolLedger(SCHOOL_ID);
  const beforeRows = await buildAccountsFromAgeAnalysisSnapshots(SCHOOL_ID, { ledger });

  const beforeByAccount: Record<string, number> = {};
  for (const row of beforeRows) {
    const acct = String(row.accountNo || "").trim().toUpperCase();
    if (!acct) continue;
    beforeByAccount[acct] = roundStatementMoney(row.balance);
  }

  const {
    snapshots,
    pdfBalanceByAccount: activePdfBalances,
    cardTotals: activeCardTotals,
  } = await buildPaymentReceiveListSnapshots({
    schoolId: SCHOOL_ID,
    pdfPath,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
    activeAccountRefs: activeIndex.activeAccountRefs,
  });

  const afterByAccount: Record<string, number> = {};
  for (const [acct, snap] of Object.entries(snapshots)) {
    const entries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === acct
    );
    afterByAccount[acct] = resolveAuthoritativeAccountBalanceFromSnapshot(snap, entries);
  }

  const beforeVerification = buildPaymentReceiveVerificationTable({
    pdfBalanceByAccount: activePdfBalances,
    eduClearBalanceByAccount: beforeByAccount,
  });

  const afterVerification = buildPaymentReceiveVerificationTable({
    pdfBalanceByAccount: activePdfBalances,
    eduClearBalanceByAccount: afterByAccount,
  });

  const allPdfCardTotals = calculatePaymentReceiveCardTotals(
    Object.entries(uniqueByAccount).map(([accountNo, row]) => ({
      accountNo,
      balance: row.balance,
    }))
  );

  const juneStats = loadJuneTransactionStats(xlsxPath, activeIndex.activeAccountRefs);

  const spotCheck: Record<
    string,
    { pdfBalance: number | null; eduClearBefore: number | null; eduClearAfter: number | null }
  > = {};
  for (const acct of SPOT_CHECK_ACCOUNTS) {
    spotCheck[acct] = {
      pdfBalance: activePdfBalances[acct] ?? uniqueByAccount[acct]?.balance ?? null,
      eduClearBefore: beforeByAccount[acct] ?? null,
      eduClearAfter: afterByAccount[acct] ?? null,
    };
  }

  const pdfScopeMatchPercent =
    Object.keys(activePdfBalances).length === 0
      ? 0
      : roundStatementMoney(
          (afterVerification.matchingExactly.length /
            Object.keys(activePdfBalances).length) *
            100
        );

  const deployBlocked =
    afterVerification.notMatching.length > 0 ||
    pdfScopeMatchPercent < 100 ||
    audit.balanceConflictCount > 0;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "plan",
    schoolId: SCHOOL_ID,
    sources: {
      balanceAuthority: pdfPath,
      paymentHistoryOnly: xlsxPath,
      importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
    },
    pdfParse: {
      rawRowCount: audit.rawRowCount,
      pdfAccountsTotal: audit.uniqueAccountCount,
      exportDate: audit.exportDate,
      duplicateRowCount: audit.duplicateRowCount,
      balanceConflictCount: audit.balanceConflictCount,
      balanceConflicts: audit.balanceConflicts,
    },
    activeFilter: {
      activeAccountsTotal: activeIndex.activeAccountRefs.size,
      activeLearnerCount: activeIndex.activeLearnerCount,
      familyAccountsCreated: activeIndex.familyAccountCount,
      historicalAccountsIgnored: activeIndex.historicalAccountRefs.size,
      pdfAccountsNotActive: activeIndex.pdfAccountsNotActive.length,
      pdfAccountsNotActiveList: activeIndex.pdfAccountsNotActive,
      activeAccountsMissingFromPdf: activeIndex.activeAccountsMissingFromPdf.length,
      activeAccountsMissingFromPdfList: activeIndex.activeAccountsMissingFromPdf,
    },
    juneTransactions: {
      ...juneStats,
      note: "June xlsx is payment history only — NOT used for balance reconstruction",
    },
    cardTotals: {
      fromActivePdfAccounts: activeCardTotals,
      fromAllPdfAccounts: allPdfCardTotals,
    },
    spotCheck,
    verification: {
      before: {
        accountsMatchingPdf: beforeVerification.matchingExactly.length,
        accountsNotMatchingPdf: beforeVerification.notMatching.length,
        matchPercent: roundStatementMoney(
          (beforeVerification.matchingExactly.length /
            Math.max(Object.keys(activePdfBalances).length, 1)) *
            100
        ),
        notMatching: beforeVerification.notMatching,
      },
      afterLocalPreview: {
        accountsMatchingPdf: afterVerification.matchingExactly.length,
        accountsNotMatchingPdf: afterVerification.notMatching.length,
        matchPercent: pdfScopeMatchPercent,
        activePdfAccountScope: Object.keys(activePdfBalances).length,
        notMatching: afterVerification.notMatching,
      },
    },
    deployBlocked,
    deployBlockReasons: [
      ...(afterVerification.notMatching.length > 0
        ? [`Active PDF accounts not matching: ${afterVerification.notMatching.length}`]
        : []),
      ...(pdfScopeMatchPercent < 100 ? [`PDF scope match ${pdfScopeMatchPercent}% (required 100%)`] : []),
      ...(audit.balanceConflictCount > 0
        ? [`PDF balance conflicts: ${audit.balanceConflictCount}`]
        : []),
    ],
    verificationTable: afterVerification.rows,
  };

  const outDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "payment-receive-baseline-recon-report.json");
  const txtPath = path.join(outDir, "payment-receive-baseline-recon-report.txt");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    "=== Da Silva Payment Receive List Baseline Reconciliation ===",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    "",
    "SOURCE OF TRUTH",
    `  PDF (balances):     ${pdfPath}`,
    `  XLSX (history only): ${xlsxPath}`,
    "",
    "PDF PARSE",
    `  PDF Accounts Total:        ${report.pdfParse.pdfAccountsTotal}`,
    `  Raw learner rows parsed:   ${report.pdfParse.rawRowCount}`,
    `  Duplicate sibling rows:    ${report.pdfParse.duplicateRowCount}`,
    `  Balance conflicts:         ${report.pdfParse.balanceConflictCount}`,
    "",
    "ACTIVE FILTER",
    `  Active Accounts Total:     ${report.activeFilter.activeAccountsTotal}`,
    `  Active learners:           ${report.activeFilter.activeLearnerCount}`,
    `  Family accounts in DB:     ${report.activeFilter.familyAccountsCreated}`,
    `  Historical accounts ignored: ${report.activeFilter.historicalAccountsIgnored}`,
    `  PDF accounts not active:   ${report.activeFilter.pdfAccountsNotActive}`,
    `  Active missing from PDF:   ${report.activeFilter.activeAccountsMissingFromPdf}`,
    "",
    "JUNE TRANSACTIONS (history only — NOT for balances)",
    `  Total transactions:        ${report.juneTransactions.juneTransactionsTotal}`,
    `  June payments importable:  ${report.juneTransactions.junePaymentsImported}`,
    `  June payments ignored:     ${report.juneTransactions.junePaymentsIgnored}`,
    "",
    "CARD TOTALS (from active PDF accounts)",
    `  A. Total Accounts:         ${report.cardTotals.fromActivePdfAccounts.totalAccounts}`,
    `  B. Total Outstanding:      R${report.cardTotals.fromActivePdfAccounts.totalOutstanding.toFixed(2)}`,
    `  C. Over Paid:              R${report.cardTotals.fromActivePdfAccounts.overPaid.toFixed(2)}`,
    `  D. Net Position:           R${report.cardTotals.fromActivePdfAccounts.netPosition.toFixed(2)}`,
    `  E. Recently Owing:         R${report.cardTotals.fromActivePdfAccounts.recentlyOwing.toFixed(2)}`,
    `  F. Bad Debt:               R${report.cardTotals.fromActivePdfAccounts.badDebt.toFixed(2)}`,
    "",
    "VERIFICATION",
    `  Before — matching PDF:     ${report.verification.before.accountsMatchingPdf}`,
    `  Before — not matching:     ${report.verification.before.accountsNotMatchingPdf}`,
    `  After preview — matching:  ${report.verification.afterLocalPreview.accountsMatchingPdf}`,
    `  After preview — not matching: ${report.verification.afterLocalPreview.accountsNotMatchingPdf}`,
    `  After preview match %:     ${report.verification.afterLocalPreview.matchPercent}%`,
    "",
    "SPOT CHECK (must match PDF exactly)",
  ];

  for (const acct of SPOT_CHECK_ACCOUNTS) {
    const s = spotCheck[acct];
    lines.push(
      `  ${acct}: PDF R${Number(s.pdfBalance ?? 0).toFixed(2)} | before R${Number(s.eduClearBefore ?? 0).toFixed(2)} | after R${Number(s.eduClearAfter ?? 0).toFixed(2)}`
    );
  }

  lines.push("");
  if (report.verification.afterLocalPreview.notMatching.length > 0) {
    lines.push("ACCOUNTS NOT MATCHING PDF (after preview):");
    lines.push("AccountNo | KidESysBalance | EduClearBalance | Difference");
    for (const row of report.verification.afterLocalPreview.notMatching.slice(0, 50)) {
      lines.push(
        `${row.accountNo.padEnd(8)} | ${String(row.kidESysBalance).padStart(14)} | ${String(row.eduClearBalance).padStart(15)} | ${String(row.difference).padStart(10)}`
      );
    }
    if (report.verification.afterLocalPreview.notMatching.length > 50) {
      lines.push(`... and ${report.verification.afterLocalPreview.notMatching.length - 50} more`);
    }
  }

  lines.push("");
  lines.push(`DEPLOY BLOCKED: ${deployBlocked ? "YES" : "NO"}`);
  if (deployBlocked) {
    lines.push(`Reasons: ${report.deployBlockReasons.join("; ")}`);
  }
  const csvPath = path.join(outDir, "payment-receive-baseline-verification.csv");
  const csvLines = [
    "AccountNo,KidESysBalance,EduClearBalance,Difference",
    ...afterVerification.rows.map(
      (r) =>
        `${r.accountNo},${r.kidESysBalance.toFixed(2)},${r.eduClearBalance.toFixed(2)},${r.difference.toFixed(2)}`
    ),
  ];
  fs.writeFileSync(csvPath, csvLines.join("\n"));

  lines.push("");
  lines.push(`Verification CSV: ${csvPath}`);
  lines.push(`Full JSON: ${jsonPath}`);

  fs.writeFileSync(txtPath, lines.join("\n"));
  console.log(lines.join("\n"));

  if (apply) {
    if (deployBlocked) {
      console.error("\nRefusing --apply: deploy blockers present. Fix mismatches first.");
      process.exit(1);
    }
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID, snapshots);
    console.log(`\nApplied ${Object.keys(snapshots).length} baseline snapshots locally.`);
  } else {
    console.log("\nPlan only. Re-run with --apply after 100% PDF match confirmed.");
  }

  await prisma.$disconnect();
  process.exit(deployBlocked && !apply ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
