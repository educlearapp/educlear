import {
  KIDEESYS_CSV_TYPES,
  KIDEESYS_CSV_FILE_SUFFIX,
  loadKidESysCsvBundle,
  validateRequiredColumns,
  type KidESysCsvBundle,
  type KidESysCsvType,
} from "./kideesysCsvParser";

export type KidESysCsvDryRunResult = {
  passed: boolean;
  errors: string[];
  detectedFiles: Record<KidESysCsvType, string>;
  headersByFile: Record<KidESysCsvType, string[]>;
  rowCounts: Record<KidESysCsvType, number>;
  missingColumnsByFile: Partial<Record<KidESysCsvType, string[]>>;
  learnerCount: number;
  parentLinkCount: number;
  accountCount: number;
  invoiceCount: number;
  paymentCount: number;
  journalCount: number;
  monthlyAccountCount: number;
  unmatchedLearners: string[];
  unmatchedAccounts: string[];
  balanceReconcilePreview: Array<{
    accountNo: string;
    csvBalance: number;
    ledgerPreview: number;
    variance: number;
  }>;
};

function reconcilePreview(bundle: KidESysCsvBundle): KidESysCsvDryRunResult["balanceReconcilePreview"] {
  const childAccountNos = new Set(
    bundle.children.map((c) => String(c.accountNo || "").trim()).filter(Boolean)
  );
  const accountNos = new Set(bundle.accounts.map((a) => String(a.accountNo || "").trim()).filter(Boolean));
  const preview: KidESysCsvDryRunResult["balanceReconcilePreview"] = [];

  for (const account of bundle.accounts) {
    const accountNo = String(account.accountNo || "").trim();
    if (!accountNo) continue;
    const invSum = bundle.invoices
      .filter((i) => i.accountNo === accountNo)
      .reduce((s, i) => s + i.amount, 0);
    const paySum = bundle.payments
      .filter((p) => p.accountNo === accountNo)
      .reduce((s, p) => s + p.amount, 0);
    const journalNet = bundle.journals
      .filter((j) => j.accountNo === accountNo)
      .reduce((s, j) => s + (j.kind === "payment" ? -j.amount : j.amount), 0);
    const ledgerPreview = Math.round((invSum - paySum + journalNet) * 100) / 100;
    const csvBalance = Math.round(account.balance * 100) / 100;
    preview.push({
      accountNo,
      csvBalance,
      ledgerPreview,
      variance: Math.round((csvBalance - ledgerPreview) * 100) / 100,
    });
  }

  const unmatchedAccounts = [...accountNos].filter((no) => !childAccountNos.has(no));
  if (unmatchedAccounts.length && preview.length < 20) {
    for (const accountNo of unmatchedAccounts.slice(0, 5)) {
      if (!preview.some((p) => p.accountNo === accountNo)) {
        const account = bundle.accounts.find((a) => a.accountNo === accountNo);
        preview.push({
          accountNo,
          csvBalance: account?.balance ?? 0,
          ledgerPreview: 0,
          variance: account?.balance ?? 0,
        });
      }
    }
  }

  return preview.slice(0, 25);
}

/** Parse and validate CSV export — writes zero database rows. */
export function runKidESysCsvDryRun(sourcePath: string): KidESysCsvDryRunResult {
  const errors: string[] = [];
  let bundle: KidESysCsvBundle;

  try {
    bundle = loadKidESysCsvBundle(sourcePath);
  } catch (e) {
    return {
      passed: false,
      errors: [(e as Error).message],
      detectedFiles: {} as Record<KidESysCsvType, string>,
      headersByFile: {} as Record<KidESysCsvType, string[]>,
      rowCounts: {} as Record<KidESysCsvType, number>,
      missingColumnsByFile: {},
      learnerCount: 0,
      parentLinkCount: 0,
      accountCount: 0,
      invoiceCount: 0,
      paymentCount: 0,
      journalCount: 0,
      monthlyAccountCount: 0,
      unmatchedLearners: [],
      unmatchedAccounts: [],
      balanceReconcilePreview: [],
    };
  }

  const missingColumnsByFile: Partial<Record<KidESysCsvType, string[]>> = {};
  for (const csvType of KIDEESYS_CSV_TYPES) {
    const missing = validateRequiredColumns(csvType, bundle.headersByFile[csvType]);
    if (missing.length) {
      missingColumnsByFile[csvType] = missing;
      errors.push(
        `${KIDEESYS_CSV_FILE_SUFFIX[csvType]} missing column(s): ${missing.join(", ")}`
      );
    }
  }

  const accountNos = new Set(bundle.accounts.map((a) => String(a.accountNo || "").trim()).filter(Boolean));
  const unmatchedLearners = bundle.children
    .filter((c) => c.accountNo && !accountNos.has(c.accountNo))
    .map((c) => `${c.childId}:${c.fullName}:${c.accountNo}`)
    .slice(0, 20);

  const unmatchedAccounts = bundle.accounts
    .filter((a) => {
      const linkedChild = bundle.children.some(
        (c) => c.accountNo === a.accountNo || c.childId === a.accountId
      );
      return !linkedChild;
    })
    .map((a) => a.accountNo)
    .slice(0, 20);

  const parentLinkCount = bundle.childParents.length;
  if (parentLinkCount === 0) {
    errors.push("child_parent.csv produced zero parent links — check parent_id column");
  }

  const balanceReconcilePreview = reconcilePreview(bundle);
  // Preview is informational — real import applies opening-balance ledger rows to match accounts.csv.

  const rowCounts = {
    accounts: bundle.accounts.length,
    child: bundle.children.length,
    child_parent: bundle.childParents.length,
    invoices: bundle.invoices.length,
    journals: bundle.journals.length,
    monthly_accounts: bundle.monthlyAccounts.length,
    payments: bundle.payments.length,
  } as Record<KidESysCsvType, number>;

  if (bundle.children.length === 0) errors.push("child.csv has zero learners");
  if (bundle.accounts.length === 0) errors.push("accounts.csv has zero accounts");

  return {
    passed: errors.length === 0,
    errors,
    detectedFiles: bundle.filesFound,
    headersByFile: bundle.headersByFile,
    rowCounts,
    missingColumnsByFile,
    learnerCount: bundle.children.length,
    parentLinkCount,
    accountCount: bundle.accounts.length,
    invoiceCount: bundle.invoices.length,
    paymentCount: bundle.payments.length,
    journalCount: bundle.journals.length,
    monthlyAccountCount: bundle.monthlyAccounts.length,
    unmatchedLearners,
    unmatchedAccounts,
    balanceReconcilePreview,
  };
}

export function printKidESysCsvDryRunReport(result: KidESysCsvDryRunResult): void {
  console.log("\n=== Kid-e-Sys CSV dry-run ===\n");
  if (result.errors.length) {
    console.log("Errors:");
    for (const err of result.errors) console.log(`  ✗ ${err}`);
  }

  console.log("\nDetected files:");
  for (const csvType of KIDEESYS_CSV_TYPES) {
    const file = result.detectedFiles[csvType];
    console.log(`  ${KIDEESYS_CSV_FILE_SUFFIX[csvType]}: ${file || "(missing)"}`);
  }

  console.log("\nRow counts:");
  for (const csvType of KIDEESYS_CSV_TYPES) {
    console.log(`  ${csvType}: ${result.rowCounts[csvType] ?? 0}`);
  }

  console.log("\nSummary:");
  console.log(`  learners: ${result.learnerCount}`);
  console.log(`  parent links: ${result.parentLinkCount}`);
  console.log(`  accounts: ${result.accountCount}`);
  console.log(`  invoices: ${result.invoiceCount}`);
  console.log(`  payments: ${result.paymentCount}`);
  console.log(`  journals: ${result.journalCount}`);
  console.log(`  monthly accounts: ${result.monthlyAccountCount}`);

  if (result.unmatchedLearners.length) {
    console.log(`\nUnmatched learners (sample): ${result.unmatchedLearners.join("; ")}`);
  }
  if (result.unmatchedAccounts.length) {
    console.log(`Unmatched accounts (sample): ${result.unmatchedAccounts.join(", ")}`);
  }

  if (result.balanceReconcilePreview.length) {
    console.log("\nBalance reconcile preview (first rows):");
    for (const row of result.balanceReconcilePreview.slice(0, 10)) {
      console.log(
        `  ${row.accountNo}: CSV ${row.csvBalance} vs ledger preview ${row.ledgerPreview} (var ${row.variance})`
      );
    }
  }

  console.log(`\nDry-run: ${result.passed ? "PASSED" : "FAILED"}\n`);
}

export { auditKidESysCsvImport, type KidESysCsvImportAudit } from "./kideesysCsvImporter";
