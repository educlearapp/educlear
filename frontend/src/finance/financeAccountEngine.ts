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
  return (input.statementRows || []).map((row) => {
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
    const parentName = resolveParentName(row, input.learners);
    const activeArrangement = getActiveArrangement(
      arrangements,
      String(row.learnerId || row.id || ""),
      String(row.accountNo || ""),
      input.today || new Date().toISOString().slice(0, 10)
    );
    const billing: ParentFinanceBilling = {
      balance: Number(row.balance) || 0,
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
    const summary = buildFinanceHubSummary({
      transactions,
      balance: billing.balance,
      policy: input.policy,
      today: input.today,
      activeArrangementExists: Boolean(activeArrangement),
    });
    const collectionsRisk = resolveCollectionsRisk(row, summary, input.policy, input.today);

    return {
      row,
      billing,
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
    groups[snapshot.summary.accountHealth].push(snapshot);
  }
  return groups;
}

export function groupCollectionsSnapshotsByHealth(snapshots: FinanceAccountSnapshot[]) {
  const groups: Record<AccountHealth, FinanceAccountSnapshot[]> = {
    Excellent: [],
    "Needs Attention": [],
    "Action Required": [],
    Critical: [],
  };
  for (const snapshot of snapshots) {
    groups[snapshot.collectionsHealth].push(snapshot);
  }
  return groups;
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

function resolveCollectionsRisk(
  row: BillingAccountRow,
  summary: FinanceHubSummary,
  policy: FinancePolicySettings,
  today?: string
): { health: AccountHealth; reason: string; monthsOutstanding: number } {
  const balance = Number(row.balance) || 0;
  const statementStatus = String(row.status || "").toLowerCase();
  const legacySection = String(row.kidesysSection || "").toLowerCase();
  const statusText = `${statementStatus} ${legacySection}`;
  const buckets = readAgeAnalysisBuckets(row);

  if (balance <= 0) {
    return { health: "Excellent", reason: "Over Paid / credit balance", monthsOutstanding: 0 };
  }

  if (statementStatus.includes("over paid") || statementStatus.includes("overpaid")) {
    return { health: "Excellent", reason: "Statement status is Over Paid", monthsOutstanding: 0 };
  }

  if (isCurrentInvoiceOnlyBeforeDue(balance, summary)) {
    return { health: "Excellent", reason: "Current invoice only and not yet due", monthsOutstanding: 0 };
  }

  const bucketMonths = monthsOutstandingFromBuckets(buckets);
  if (bucketMonths > 0) {
    return riskFromMonths(bucketMonths, "Age Analysis bucket");
  }

  if (statusText.includes("bad debt")) {
    return riskFromHistoricalBadDebt(balance, summary);
  }

  const overdueMonths = Math.ceil(Math.max(0, summary.oldestOutstandingDays) / 30);
  if (overdueMonths > 0) {
    return riskFromMonths(overdueMonths, "Live overdue age");
  }

  if (statusText.includes("recently owing")) {
    return { health: "Needs Attention", reason: "Recently Owing with no older age bucket", monthsOutstanding: 1 };
  }

  return { health: "Excellent", reason: "No collections risk", monthsOutstanding: 0 };
}

function readAgeAnalysisBuckets(row: BillingAccountRow) {
  const buckets = (row as any)?.ageAnalysis?.buckets;
  return buckets && typeof buckets === "object" ? buckets : {};
}

function monthsOutstandingFromBuckets(buckets: Record<string, unknown>) {
  const amount = (key: string) => Math.max(0, Number(buckets[key]) || 0);
  if (amount("d120") > 0) return 4;
  if (amount("d90") > 0) return 3;
  if (amount("d60") > 0) return 2;
  if (amount("d30") > 0) return 1;
  return 0;
}

function riskFromMonths(months: number, reason: string): { health: AccountHealth; reason: string; monthsOutstanding: number } {
  if (months > 3) return { health: "Critical", reason, monthsOutstanding: months };
  if (months === 3) return { health: "Action Required", reason, monthsOutstanding: months };
  return { health: "Needs Attention", reason, monthsOutstanding: months };
}

function riskFromHistoricalBadDebt(balance: number, summary: FinanceHubSummary) {
  const currentNotDue = summary.amountOverdue <= 0 ? Math.min(balance, Math.max(0, summary.currentMonthFees)) : 0;
  const olderOutstanding = Math.max(0, balance - currentNotDue);
  if (olderOutstanding <= 0.01) {
    return { health: "Excellent" as const, reason: "Historical Bad Debt cleared; current invoice only", monthsOutstanding: 0 };
  }
  if (summary.currentMonthFees > 0 && olderOutstanding < summary.currentMonthFees) {
    return { health: "Needs Attention" as const, reason: "Historical Bad Debt with small older residual", monthsOutstanding: 1 };
  }
  return { health: "Critical" as const, reason: "Historical Bad Debt with old outstanding balance", monthsOutstanding: 4 };
}

function isCurrentInvoiceOnlyBeforeDue(balance: number, summary: FinanceHubSummary) {
  if (balance <= 0 || summary.amountOverdue > 0) return false;
  return summary.currentMonthFees >= balance - 0.01;
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
