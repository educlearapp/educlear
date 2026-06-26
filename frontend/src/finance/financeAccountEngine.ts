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
  getActiveArrangement,
  loadPaymentArrangements,
} from "../accounting/accountingDebtorsHelpers";
import type { ParentFinanceBilling } from "../parent/ParentFinanceHub";

export type FinanceAccountSnapshot = {
  row: BillingAccountRow;
  billing: ParentFinanceBilling;
  childrenOnAccount: { id: string; firstName: string; lastName: string; grade?: string }[];
  learnerName: string;
  parentName: string;
  summary: FinanceHubSummary;
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
    const transactions = ledgerToFinanceTransactions(accountLedger, row);
    const learnerName =
      childrenOnAccount[0]?.firstName ||
      String(row.name || row.accountHolder || "Learner").trim();
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
    return {
      row,
      billing,
      childrenOnAccount,
      learnerName,
      parentName,
      summary: buildFinanceHubSummary({
        transactions,
        balance: billing.balance,
        policy: input.policy,
        today: input.today,
        activeArrangementExists: Boolean(activeArrangement),
      }),
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

function resolveAccountLedger(
  schoolId: string,
  row: BillingAccountRow,
  ledger: BillingLedgerEntry[]
) {
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
  const memberIds = new Set(
    [
      ...(row.memberLearnerIds || []),
      String(row.learnerId || row.id || ""),
    ].filter(Boolean)
  );
  const matched = (learners || [])
    .filter((learner: any) => memberIds.has(String(learner?.id || learner?.learnerId || "")))
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
