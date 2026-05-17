import type { BankImportRecord } from "../banking/bankingApi";
import {
  BILLING_UPDATED_EVENT,
  getBillingRows,
  normaliseBillingAmount,
  readSchoolLedger,
  type BillingAccountRow,
} from "../billing/billingLedger";
import { loadAssets } from "./accountingAssetStorage";
import {
  loadApprovedExpenses,
  loadExpenseCandidates,
  reviewQueueFromCandidates,
} from "./accountingExpenseStorage";
import {
  calculateCreditorTotals,
  loadCreditorPaymentPlans,
  loadCreditorSuppliers,
} from "./accountingCreditorsHelpers";
import {
  journalTotals,
  loadJournalStore,
  type AuditAction,
  type AuditEntry,
} from "./accountingJournalStorage";
import {
  getDefaultReportingBasis,
  loadAccountingSettings,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";
import {
  ACCOUNTING_AUDIT_COMPLIANCE_UPDATED_EVENT,
  appendAuditTrailEntry,
  loadAuditTrail,
  loadLockedPeriods,
  saveAuditTrail,
  type ComplianceAuditEntry,
} from "./accountingAuditComplianceStorage";

export type ComplianceMetrics = {
  openAuditItems: number;
  lockedPeriods: number;
  unreconciledBankItems: number;
  unpostedJournals: number;
  unbalancedJournals: number;
  overdueDebtors: number;
  overdueCreditors: number;
  expenseCandidates: number;
  supplierPaymentPlans: number;
  missingSupplierCategories: number;
  missingAssetCategories: number;
  negativeCashMovement: boolean;
};

export type ComplianceCheckRow = {
  id: string;
  issue: string;
  severity: "low" | "medium" | "high";
  recommendedAction: string;
  count?: number;
};

export function countUnreconciledBankLines(imports: BankImportRecord[]) {
  let count = 0;
  for (const imp of imports) {
    for (const txn of imp.transactions || []) {
      const status = txn.reviewStatus;
      if (status !== "accepted" && status !== "ignored" && status !== "posted") {
        count += 1;
      }
    }
  }
  return count;
}

export function countOverdueDebtors(statementRows: BillingAccountRow[]) {
  return statementRows.filter(
    (row) =>
      normaliseBillingAmount(row.balance) > 0 &&
      (row.status === "Recently Owing" || row.status === "Bad Debt")
  ).length;
}

function mapJournalAuditAction(action: AuditAction): string {
  if (action === "Created") return "Created journal";
  if (action === "Posted" || action === "AutoPosted") return "Posted journal";
  if (action === "Reversed") return "Reversed journal";
  if (action === "Edited") return "Edited journal";
  return String(action);
}

function journalAuditToCompliance(entry: AuditEntry): ComplianceAuditEntry {
  return {
    id: entry.id,
    timestamp: entry.at,
    user: entry.user || "Finance User",
    module: "Journals",
    action: mapJournalAuditAction(entry.action),
    reference: entry.journalNo,
    details: entry.details,
    sourceKey: `journal-audit:${entry.id}`,
  };
}

export function syncJournalAuditToTrail(schoolId: string) {
  if (!schoolId) return;
  const store = loadJournalStore(schoolId);
  const trail = loadAuditTrail(schoolId);
  const seen = new Set(
    trail.map((row) => row.sourceKey || `${row.module}|${row.reference}|${row.action}|${row.timestamp}`)
  );
  let changed = false;
  const additions: ComplianceAuditEntry[] = [];

  for (const entry of store.audit) {
    const mapped = journalAuditToCompliance(entry);
    const key = mapped.sourceKey || `${mapped.module}|${mapped.reference}|${mapped.action}|${mapped.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(mapped);
    changed = true;
  }

  if (changed) {
    saveAuditTrail(schoolId, [...additions, ...trail]);
  }
}

export function listMergedAuditTrail(schoolId: string): ComplianceAuditEntry[] {
  syncJournalAuditToTrail(schoolId);
  const stored = loadAuditTrail(schoolId);
  const byKey = new Map<string, ComplianceAuditEntry>();
  for (const row of stored) {
    const key = row.sourceKey || `${row.module}|${row.reference}|${row.action}|${row.timestamp}|${row.id}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return Array.from(byKey.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function buildComplianceMetrics(
  schoolId: string,
  statementRows: BillingAccountRow[],
  bankImports: BankImportRecord[]
): ComplianceMetrics {
  const sid = String(schoolId || "").trim();
  if (!sid) {
    return {
      openAuditItems: 0,
      lockedPeriods: 0,
      unreconciledBankItems: 0,
      unpostedJournals: 0,
      unbalancedJournals: 0,
      overdueDebtors: 0,
      overdueCreditors: 0,
      expenseCandidates: 0,
      supplierPaymentPlans: 0,
      missingSupplierCategories: 0,
      missingAssetCategories: 0,
      negativeCashMovement: false,
    };
  }

  const locked = loadLockedPeriods(sid).filter((p) => p.status === "locked");
  const journalStore = loadJournalStore(sid);
  const unposted = journalStore.journals.filter((j) => j.status === "Draft").length;
  const unbalanced = journalStore.journals.filter((j) => !journalTotals(j).balanced).length;
  const unreconciled = countUnreconciledBankLines(bankImports);
  const expenseCandidates = reviewQueueFromCandidates(loadExpenseCandidates(sid)).length;
  const creditorTotals = calculateCreditorTotals(sid, new Date().toISOString().slice(0, 10));
  const paymentPlans = loadCreditorPaymentPlans(sid).filter((p) => p.status === "Active").length;
  const suppliers = loadCreditorSuppliers(sid);
  const missingSupplierCategories = suppliers.filter((s) => !String(s.category || "").trim()).length;
  const assets = loadAssets(sid);
  const missingAssetCategories = assets.filter(
    (a) => a.status !== "Disposed" && !String(a.category || "").trim()
  ).length;

  const ledger = readSchoolLedger(sid);
  const now = new Date();
  const income = ledger
    .filter((e) => e.type === "payment" && e.date?.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`))
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const expenses = loadApprovedExpenses(sid)
    .filter((e) => {
      const d = String(e.date || "").slice(0, 7);
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return d === cur;
    })
    .reduce((s, e) => s + normaliseBillingAmount(e.amount), 0);
  const negativeCashMovement = expenses > income && (expenses > 0 || income > 0);

  const overdueDebtors = countOverdueDebtors(statementRows);
  const overdueCreditors = creditorTotals.overdueInvoiceCount;

  const checks = buildComplianceChecks({
    unpostedJournals: unposted,
    unbalancedJournals: unbalanced,
    unreconciledBankItems: unreconciled,
    expenseCandidates,
    missingSupplierCategories,
    missingAssetCategories,
    negativeCashMovement,
    overdueDebtors,
    overdueCreditors,
  });

  const openAuditItems =
    checks.filter((c) => c.severity === "high").length +
    unposted +
    unbalanced +
    (unreconciled > 0 ? 1 : 0);

  return {
    openAuditItems,
    lockedPeriods: locked.length,
    unreconciledBankItems: unreconciled,
    unpostedJournals: unposted,
    unbalancedJournals: unbalanced,
    overdueDebtors,
    overdueCreditors,
    expenseCandidates,
    supplierPaymentPlans: paymentPlans,
    missingSupplierCategories,
    missingAssetCategories,
    negativeCashMovement,
  };
}

export function buildComplianceChecks(input: {
  unpostedJournals: number;
  unbalancedJournals: number;
  unreconciledBankItems: number;
  expenseCandidates: number;
  missingSupplierCategories: number;
  missingAssetCategories: number;
  negativeCashMovement: boolean;
  overdueDebtors: number;
  overdueCreditors: number;
}): ComplianceCheckRow[] {
  const rows: ComplianceCheckRow[] = [
    {
      id: "unposted",
      issue: "Unposted journals",
      severity: input.unpostedJournals > 0 ? "high" : "low",
      recommendedAction: "Post or delete draft journals in Accounting → Journals.",
      count: input.unpostedJournals,
    },
    {
      id: "unbalanced",
      issue: "Unbalanced journals",
      severity: input.unbalancedJournals > 0 ? "high" : "low",
      recommendedAction: "Correct debit/credit lines before period close.",
      count: input.unbalancedJournals,
    },
    {
      id: "bank",
      issue: "Unreconciled banking items",
      severity: input.unreconciledBankItems > 5 ? "high" : input.unreconciledBankItems > 0 ? "medium" : "low",
      recommendedAction: "Complete bank reconciliation in Banking / Bank Statement Import.",
      count: input.unreconciledBankItems,
    },
    {
      id: "expenses",
      issue: "Expense candidates pending",
      severity: input.expenseCandidates > 0 ? "medium" : "low",
      recommendedAction: "Review and approve expense candidates from bank imports.",
      count: input.expenseCandidates,
    },
    {
      id: "supplier-cat",
      issue: "Missing supplier categories",
      severity: input.missingSupplierCategories > 0 ? "medium" : "low",
      recommendedAction: "Assign categories to all active suppliers.",
      count: input.missingSupplierCategories,
    },
    {
      id: "asset-cat",
      issue: "Missing asset categories",
      severity: input.missingAssetCategories > 0 ? "medium" : "low",
      recommendedAction: "Classify assets in Accounting → Assets.",
      count: input.missingAssetCategories,
    },
    {
      id: "cash",
      issue: "Negative cash movement (current month)",
      severity: input.negativeCashMovement ? "high" : "low",
      recommendedAction: "Review income vs approved expenses for the month.",
    },
    {
      id: "debtors",
      issue: "Overdue debtors",
      severity: input.overdueDebtors > 0 ? "high" : "low",
      recommendedAction: "Follow up fee collections and debtors ageing.",
      count: input.overdueDebtors,
    },
    {
      id: "creditors",
      issue: "Overdue creditors",
      severity: input.overdueCreditors > 0 ? "high" : "low",
      recommendedAction: "Schedule supplier payments or payment plans.",
      count: input.overdueCreditors,
    },
  ];
  return rows;
}

export function recordPeriodLockAudit(
  schoolId: string,
  action: "Locked period" | "Reopened period",
  reference: string,
  details: string,
  user = "Finance User"
) {
  appendAuditTrailEntry(schoolId, {
    user,
    module: "Period Locks",
    action,
    reference,
    details,
    sourceKey: `period:${reference}:${action}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export function resolveReportingBasisSummary(schoolId: string, basis: ReportingBasis, year: number, monthIndex: number) {
  const settings = loadAccountingSettings(schoolId);
  const period = resolveReportingPeriod(basis, year, monthIndex);
  return {
    settings,
    period,
    yearLabel: reportingBasisYearLabel(basis),
    defaultBasis: getDefaultReportingBasis(schoolId),
  };
}

export const COMPLIANCE_REFRESH_EVENTS = [
  BILLING_UPDATED_EVENT,
  "educlear-accounting-journals-updated",
  "educlear-accounting-expenses-updated",
  "educlear-creditors-updated",
  "educlear-accounting-assets-updated",
  ACCOUNTING_AUDIT_COMPLIANCE_UPDATED_EVENT,
] as const;
