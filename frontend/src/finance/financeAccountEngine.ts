import {
  buildFinanceHubSummary,
  type AccountHealth,
  type FinanceHubSummary,
  type FinancePolicySettings,
  type FinanceTransaction,
} from "./financePolicy";
import {
  collectFamilyAccountEntries,
  getAccountLedger,
  readSchoolLedger,
  type BillingAccountRow,
  type BillingLedgerEntry,
} from "../billing/billingLedger";
import {
  isEduClearUndoCorrectionEntry,
  isKidesysBlockedBillingSource,
  isNonPostingImportedLedgerEntry,
  isUndoneLedgerEntry,
  shouldShowLedgerEntryOnStatement,
} from "../billing/billingDisplayRules";
import {
  getActiveArrangement,
  loadPaymentArrangements,
} from "../accounting/accountingDebtorsHelpers";
import type { ParentFinanceBilling } from "../parent/ParentFinanceHub";
import { normalizeKidESysAccountRef } from "../billing/billingAccountRef";

export type FinanceAccountSnapshot = {
  row: BillingAccountRow;
  billing: ParentFinanceBilling;
  accountRef: string;
  billingAccountRef: string;
  parentGuardianName: string;
  totalBalance: number;
  overpaidAmount: number;
  monthlyFeeTotal: number;
  dueNow: number;
  overdueAmount: number;
  monthsOutstanding: number;
  nextDueDate: string;
  learnerNames: string[];
  healthStatus: AccountHealth;
  childrenOnAccount: { id: string; firstName: string; lastName: string; grade?: string }[];
  learnerDetails: { id: string; name: string; grade: string }[];
  learnerName: string;
  learnerDisplayName: string;
  firstLearnerName: string;
  parentName: string;
  summary: FinanceHubSummary;
  collectionsHealth: AccountHealth;
  collectionsReason: string;
  collectionsMonthsOutstanding: number;
};

export function buildFinanceAccountSnapshots(input: {
  schoolId: string;
  learners: unknown[];
  statementRows: BillingAccountRow[];
  policy: FinancePolicySettings;
  today?: string;
}): FinanceAccountSnapshot[] {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) return [];

  const ledger = readSchoolLedger(schoolId);
  const arrangements = loadPaymentArrangements(schoolId);
  return groupStatementRowsByBillingAccount(input.statementRows || []).map((accountRows) => {
    const row = mergeGroupedBillingRows(accountRows);
    const childrenOnAccount = resolveChildrenOnAccount(row, input.learners);
    const accountLedger = resolveAccountLedger(schoolId, row, ledger);
    const activeLedger = accountLedger.filter(isFinanceHubActiveLedgerEntry);
    const transactions = ledgerToFinanceTransactions(activeLedger, row);
    const learnerDetails = childrenOnAccount.map((child) => ({
      id: child.id,
      name: `${child.firstName || ""} ${child.lastName || ""}`.trim() || "Learner",
      grade: child.grade || "",
    }));
    const firstLearnerName =
      learnerDetails[0]?.name ||
      `${String(row.name || "").trim()} ${String(row.surname || "").trim()}`.trim() ||
      String(row.accountHolder || "Learner").trim();
    const learnerDisplayName =
      learnerDetails.length > 1
        ? learnerDetails.map((child) => child.name).filter(Boolean).join(", ")
        : firstLearnerName;
    const learnerName = learnerDisplayName;
    const learnerNames = learnerDetails.map((learner) => learner.name).filter(Boolean);
    const parentName = resolveParentName(row, input.learners);
    const activeArrangement = getActiveArrangement(
      arrangements,
      String(row.learnerId || row.id || ""),
      String(row.accountNo || ""),
      input.today || new Date().toISOString().slice(0, 10)
    );
    const totalBalance = resolveTotalBalance(row, accountRows);
    const billing: ParentFinanceBilling = {
      balance: totalBalance,
      accountRef: String(row.accountNo || ""),
      isFamilyAccount: Boolean(row.familyAccountId || (row.memberLearnerIds || []).length > 1),
      learners: childrenOnAccount.map((child) => ({
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        grade: child.grade || "",
      })),
      transactions,
    };
    const baseSummary = buildFinanceHubSummary({
      transactions,
      balance: billing.balance,
      policy: input.policy,
      today: input.today,
      activeArrangementExists: Boolean(activeArrangement),
    });
    const monthlyFeeTotal = resolveMonthlyFeeTotal(row, accountRows, childrenOnAccount, input.learners, baseSummary);
    const overdueAmount = resolveEffectiveDueNowAmount(totalBalance, baseSummary, transactions);
    const overpaidAmount = Math.max(0, roundMoney(-totalBalance));
    const collectionsRisk = resolveAccountHealthFromDueNow({
      totalBalance,
      overdueAmount,
      monthlyFeeTotal,
      overpaidAmount,
    });
    const accountRef = normalizeKidESysAccountRef(row.accountNo) || String(row.accountNo || "").trim();
    const summary = {
      ...baseSummary,
      amountYouOwe: totalBalance,
      amountOverdue: overdueAmount,
      oldestOutstandingDays: collectionsRisk.monthsOutstanding * 30,
      accountHealth: collectionsRisk.health,
      nextAction: nextActionForCollections(collectionsRisk.health, totalBalance, overdueAmount, baseSummary.showArrangementButton),
    };

    return {
      row,
      billing,
      accountRef,
      billingAccountRef: accountRef,
      parentGuardianName: parentName,
      totalBalance,
      overpaidAmount,
      monthlyFeeTotal,
      dueNow: overdueAmount,
      overdueAmount,
      monthsOutstanding: collectionsRisk.monthsOutstanding,
      nextDueDate: summary.nextSchoolFeeDueDate,
      learnerNames,
      healthStatus: collectionsRisk.health,
      childrenOnAccount,
      learnerDetails,
      learnerName,
      learnerDisplayName,
      firstLearnerName,
      parentName,
      summary,
      collectionsHealth: collectionsRisk.health,
      collectionsReason: collectionsRisk.reason,
      collectionsMonthsOutstanding: collectionsRisk.monthsOutstanding,
    };
  });
}

export function groupFinanceSnapshotsByHealth(snapshots: FinanceAccountSnapshot[]) {
  const groups: Record<AccountHealth, FinanceAccountSnapshot[]> = {
    Excellent: [],
    "Needs Attention": [],
    "Action Required": [],
    Critical: [],
  };
  for (const snapshot of snapshots) {
    groups[snapshot.healthStatus].push(snapshot);
  }
  return groups;
}

export function groupCollectionsSnapshotsByHealth(snapshots: FinanceAccountSnapshot[]) {
  return groupFinanceSnapshotsByHealth(snapshots);
}

function resolveAccountLedger(
  schoolId: string,
  row: BillingAccountRow,
  ledger: BillingLedgerEntry[]
) {
  const accountRef = normalizeKidESysAccountRef(row.accountNo);
  if (accountRef) {
    const accountEntries = ledger.filter(
      (entry) => normalizeKidESysAccountRef(entry.accountNo) === accountRef
    );
    if (accountEntries.length) return dedupeLedgerEntries(accountEntries);
  }

  const learnerIds = [
    ...(row.memberLearnerIds || []),
    String(row.learnerId || row.id || ""),
  ].filter(Boolean);
  if (row.familyAccountId || learnerIds.length > 1) {
    return collectFamilyAccountEntries(ledger, {
      accountRef: String(row.accountNo || ""),
      learnerIds,
    });
  }
  return getAccountLedger(schoolId, String(row.learnerId || row.id || ""), String(row.accountNo || ""));
}

function groupStatementRowsByBillingAccount(rows: BillingAccountRow[]) {
  const groups = new Map<string, BillingAccountRow[]>();
  for (const row of rows || []) {
    const key = billingAccountGroupKey(row);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  return Array.from(groups.values());
}

function billingAccountGroupKey(row: BillingAccountRow) {
  const accountRef = normalizeKidESysAccountRef(row.accountNo);
  if (accountRef) return `account:${accountRef}`;
  const familyId = String(row.familyAccountId || "").trim();
  if (familyId) return `family:${familyId}`;
  const learnerId = String(row.learnerId || row.id || "").trim();
  return learnerId ? `learner:${learnerId}` : `row:${String(row.accountNo || row.id || "unknown").trim()}`;
}

function mergeGroupedBillingRows(rows: BillingAccountRow[]) {
  const canonical =
    rows.find((row) => row.ageAnalysis?.buckets) ||
    rows.find((row) => normalizeKidESysAccountRef(row.accountNo)) ||
    rows[0];
  const memberLearnerIds = uniqueStrings(rows.flatMap((row) => [row.learnerId, row.id, ...(row.memberLearnerIds || [])]));
  const memberNames = uniqueStrings(rows.flatMap((row) => [
    ...(row.memberNames || []),
    `${row.name || ""} ${row.surname || ""}`.trim(),
  ]));
  return {
    ...canonical,
    id: canonical.familyAccountId || canonical.accountNo || canonical.id,
    memberLearnerIds,
    memberNames,
    accountHolder: canonical.accountHolder || rows.find((row) => row.accountHolder)?.accountHolder,
    balance: resolveTotalBalance(canonical, rows),
  };
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function isFinanceHubActiveLedgerEntry(entry: BillingLedgerEntry): boolean {
  if (isUndoneLedgerEntry(entry)) return false;
  if (isEduClearUndoCorrectionEntry(entry)) return false;
  if (!shouldShowLedgerEntryOnStatement(entry)) return false;
  if (isNonPostingImportedLedgerEntry(entry)) return false;
  if (isKidesysBlockedBillingSource(entry.source)) return false;
  return true;
}

function dedupeLedgerEntries(entries: BillingLedgerEntry[]) {
  const byId = new Map<string, BillingLedgerEntry>();
  for (const entry of entries) {
    const id = String(entry.id || "").trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, entry);
  }
  return Array.from(byId.values());
}

function resolveTotalBalance(row: BillingAccountRow, accountRows: BillingAccountRow[]) {
  const ageBalance = Number(row.ageAnalysis?.balance);
  if (Number.isFinite(ageBalance)) return roundMoney(ageBalance);
  const ageRowBalance = accountRows
    .map((candidate) => Number(candidate.ageAnalysis?.balance))
    .find((value) => Number.isFinite(value));
  if (Number.isFinite(ageRowBalance)) return roundMoney(ageRowBalance || 0);
  const balances = accountRows.map((candidate) => Number(candidate.balance)).filter(Number.isFinite);
  if (!balances.length) return 0;
  const positive = balances.filter((value) => value > 0);
  if (positive.length) return roundMoney(Math.max(...positive));
  return roundMoney(Math.min(...balances));
}

function resolveEffectiveDueNowAmount(
  totalBalance: number,
  summary: FinanceHubSummary,
  transactions: FinanceTransaction[]
) {
  const positiveBalance = roundMoney(Math.max(0, totalBalance));
  if (positiveBalance <= 0) return 0;
  if (hasReliableDueDateCoverage(positiveBalance, transactions)) {
    return roundMoney(Math.min(positiveBalance, Math.max(0, Number(summary.amountOverdue) || 0)));
  }
  return positiveBalance;
}

function hasReliableDueDateCoverage(positiveBalance: number, transactions: FinanceTransaction[]) {
  const chargeRows = (transactions || []).filter((row) => Number(row.amountOut) > 0);
  if (!chargeRows.length) return false;
  if (chargeRows.some((row) => !row.dueDate)) return false;
  const ledgerBalance = roundMoney(transactions[transactions.length - 1]?.balance || 0);
  return Math.abs(ledgerBalance - positiveBalance) <= 1;
}

function resolveMonthlyFeeTotal(
  row: BillingAccountRow,
  accountRows: BillingAccountRow[],
  childrenOnAccount: { id: string; firstName: string; lastName: string; grade?: string }[],
  learners: unknown[],
  summary: FinanceHubSummary
) {
  const learnerIds = uniqueStrings([
    ...childrenOnAccount.map((child) => child.id),
    ...accountRows.flatMap((accountRow) => [
      accountRow.learnerId,
      accountRow.id,
      ...(accountRow.memberLearnerIds || []),
    ]),
  ]);
  const learnerIndex = new Map(
    (learners || []).map((learner: any) => [String(learner?.id || learner?.learnerId || "").trim(), learner])
  );
  const savedPlans = readSavedBillingPlans();
  const planTotal = learnerIds.reduce((sum, learnerId) => {
    const learner = learnerIndex.get(learnerId);
    return sum + learnerMonthlyFeeTotal(learner, savedPlans[learnerId]);
  }, 0);
  if (planTotal > 0) return roundMoney(planTotal);

  const rowInvoiceTotals = accountRows
    .map((accountRow) => parseMoneyValue(accountRow.lastInvoice || accountRow.invoiceTotal || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (rowInvoiceTotals.length) return roundMoney(Math.max(...rowInvoiceTotals));

  const currentBucket = Number(row.ageAnalysis?.buckets?.current);
  if (Number.isFinite(currentBucket) && currentBucket > 0) return roundMoney(currentBucket);
  return roundMoney(Math.max(0, Number(summary.currentMonthFees) || 0));
}

function learnerMonthlyFeeTotal(learner: unknown, savedPlan: unknown) {
  const plan =
    Array.isArray((learner as any)?.billingPlan)
      ? (learner as any).billingPlan
      : Array.isArray(savedPlan)
        ? savedPlan
        : [];
  const planTotal = roundMoney(
    plan.reduce((sum: number, fee: any) => sum + Math.max(0, Number(fee?.amount ?? fee?.price ?? fee?.value ?? 0) || 0), 0)
  );
  if (planTotal > 0) return planTotal;

  const totalFee = parseMoneyValue((learner as any)?.totalFee);
  if (totalFee > 0) return roundMoney(totalFee);
  const tuitionFee = parseMoneyValue((learner as any)?.tuitionFee);
  const transportFee = parseMoneyValue((learner as any)?.transportFee);
  const otherFee = parseMoneyValue((learner as any)?.otherFee);
  return roundMoney(tuitionFee + transportFee + otherFee);
}

function parseMoneyValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || "").replace(/[^0-9.-]+/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readSavedBillingPlans(): Record<string, unknown> {
  try {
    if (typeof localStorage === "undefined") return {};
    const parsed = JSON.parse(localStorage.getItem("educlearBillingPlans") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolveAccountHealthFromDueNow(input: {
  totalBalance: number;
  overdueAmount: number;
  monthlyFeeTotal: number;
  overpaidAmount: number;
}): { health: AccountHealth; reason: string; monthsOutstanding: number } {
  if (input.totalBalance <= 0 || input.overpaidAmount > 0) {
    return { health: "Excellent", reason: "Balance is paid up or overpaid", monthsOutstanding: 0 };
  }
  if (input.overdueAmount <= 0) {
    return { health: "Excellent", reason: "Positive balance is from future invoices not yet due", monthsOutstanding: 0 };
  }
  const monthlyFeeTotal = Math.max(0, roundMoney(input.monthlyFeeTotal));
  const monthsOutstanding = monthlyFeeTotal > 0
    ? roundMoney(input.overdueAmount / monthlyFeeTotal)
    : 1;
  if (monthsOutstanding <= 1) {
    return { health: "Needs Attention", reason: "Positive balance is up to 1 month of fees", monthsOutstanding };
  }
  if (monthsOutstanding <= 3) {
    return { health: "Action Required", reason: "Positive balance is more than 1 and up to 3 months of fees", monthsOutstanding };
  }
  return { health: "Critical", reason: "Positive balance is more than 3 months of fees", monthsOutstanding };
}

function nextActionForCollections(
  accountHealth: AccountHealth,
  balance: number,
  overdue: number,
  showArrangementButton: boolean
) {
  if (balance <= 0) return "Your account is up to date. Keep your next school fee date in mind.";
  if (showArrangementButton && overdue > 0) return "Request a payment plan or make a payment and upload proof.";
  if (overdue > 0) return "Please make a payment or contact the school finance office.";
  if (accountHealth === "Excellent") return "Plan for the next school fee due date.";
  return "Please review your balance and recent payments.";
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function ledgerToFinanceTransactions(
  entries: BillingLedgerEntry[],
  row: BillingAccountRow
): FinanceTransaction[] {
  let balance = 0;
  return [...entries]
    .sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)))
    .map((entry) => {
      const amount = Math.max(0, Number(entry.amount) || 0);
      const amountIn = entry.type === "payment" || entry.type === "credit" ? amount : 0;
      const amountOut = entry.type === "invoice" || entry.type === "penalty" ? amount : 0;
      balance = Math.round((balance + amountOut - amountIn) * 100) / 100;
      return {
        id: entry.id,
        date: String(entry.date || entry.createdAt || "").slice(0, 10),
        dueDate: String(entry.dueDate || "").slice(0, 10) || undefined,
        type: entry.type,
        learner: `${row.name || ""} ${row.surname || ""}`.trim(),
        reference: entry.reference,
        description: entry.description,
        amountIn,
        amountOut,
        balance,
      };
    });
}

function resolveChildrenOnAccount(row: BillingAccountRow, learners: unknown[]) {
  const accountRef = normalizeKidESysAccountRef(row.accountNo);
  const familyAccountId = String(row.familyAccountId || "").trim();
  const memberIds = new Set(
    [
      ...(row.memberLearnerIds || []),
      String(row.learnerId || row.id || ""),
    ].filter(Boolean)
  );
  const matched = (learners || [])
    .filter((learner: any) => {
      const learnerId = String(learner?.id || learner?.learnerId || "");
      const learnerFamilyId = String(learner?.familyAccountId || learner?.familyAccount?.id || "").trim();
      const learnerAccountRef = normalizeKidESysAccountRef(
        learner?.accountNo || learner?.accountRef || learner?.familyAccount?.accountRef
      );
      return (
        memberIds.has(learnerId) ||
        Boolean(familyAccountId && learnerFamilyId === familyAccountId) ||
        Boolean(accountRef && learnerAccountRef === accountRef)
      );
    })
    .map((learner: any) => ({
      id: String(learner?.id || learner?.learnerId || ""),
      firstName: String(learner?.firstName || learner?.name || "").trim() || String(row.name || "Learner"),
      lastName: String(learner?.lastName || learner?.surname || "").trim() || String(row.surname || ""),
      grade: String(learner?.grade || ""),
    }));
  if (matched.length) return matched;
  return [
    {
      id: String(row.learnerId || row.id || row.accountNo || "account"),
      firstName: String(row.name || row.accountHolder || "Learner"),
      lastName: String(row.surname || ""),
      grade: "",
    },
  ];
}

function resolveParentName(row: BillingAccountRow, learners: unknown[]) {
  const learnerId = String(row.learnerId || row.id || "");
  const learner = (learners || []).find(
    (candidate: any) => String(candidate?.id || candidate?.learnerId || "") === learnerId
  ) as any;
  const parent = Array.isArray(learner?.parents)
    ? learner.parents.find((item: any) => item?.isPrimary) || learner.parents[0]
    : null;
  const parentName = `${String(parent?.firstName || "").trim()} ${String(parent?.surname || parent?.lastName || "").trim()}`.trim();
  return parentName || String(row.accountHolder || "Parent");
}
