import { fetchDeposits } from "../billingDeposits/api/depositsApi";
import type { DepositRecord } from "../billingDeposits/types/deposit";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import { resolveStatementBillingContact } from "./statementDocument";
import type { BillingReportConfig, BillingReportId } from "./billingReportDefinitions";
import { reportTitle } from "./billingReportDefinitions";
import {
  computeOpenInvoiceLines,
  formatMoney,
  getAccountLedger,
  normaliseBillingAmount,
  readSchoolLedger,
  type BillingAccountRow,
  type BillingLedgerEntry,
} from "./billingLedger";

export type PaymentReceiveListRow = {
  rowNum: number;
  accountNo: string;
  learnerName: string;
  balance: string;
};

export type PaymentReceiveListGroup = {
  heading: string;
  rows: PaymentReceiveListRow[];
};

export type GeneratedBillingReport = {
  reportId: BillingReportId;
  title: string;
  columns: string[];
  rows: string[][];
  generatedAt: string;
  summary: { label: string; value: string }[];
  /** Grouped layout for Payment Receive List print / export */
  groups?: PaymentReceiveListGroup[];
};

type EngineInput = {
  schoolId: string;
  reportId: BillingReportId;
  config: BillingReportConfig;
  statementRows: BillingAccountRow[];
  learners: any[];
  parents: any[];
};

function isInactiveLearner(learner: any): boolean {
  if (!learner) return false;
  if (learner.isActive === false || learner.active === false) return true;
  const status = String(learner.status || learner.enrollmentStatus || "").toLowerCase();
  return (
    status.includes("inactive") ||
    status.includes("withdrawn") ||
    status.includes("archived") ||
    status === "disabled"
  );
}

function learnerById(learners: any[]) {
  const map = new Map<string, any>();
  for (const l of learners || []) {
    const id = String(l?.id || l?.learnerId || "").trim();
    if (id) map.set(id, l);
  }
  return map;
}

function matchesShow(row: BillingAccountRow, show: string): boolean {
  const balance = normaliseBillingAmount(row.balance);
  const status = String(row.status || "");
  if (show === "All Accounts") return true;
  if (show === "With Balance") return balance > 0;
  if (show === "Up To Date") return status === "Up To Date";
  if (show === "Recently Owing") return status === "Recently Owing";
  if (show === "Bad Debt") return status === "Bad Debt";
  if (show === "Over Paid") return status === "Over Paid";
  return true;
}

function learnerClassroom(learner: any): string {
  return String(
    learner?.classroomName ||
      learner?.classroom ||
      learner?.className ||
      learner?.class ||
      ""
  ).trim();
}

function groupKeyForAccount(
  row: BillingAccountRow,
  learner: any,
  groupBy: string
): string {
  if (groupBy === "None") return "";
  if (groupBy === "Classroom" || groupBy === "Class") {
    return learnerClassroom(learner) || "—";
  }
  if (groupBy === "Grade") return String(learner?.grade || "—");
  if (groupBy === "Account Status") return String(row.status || "—");
  if (groupBy === "Family Account") {
    return String(row.familyAccountId || learner?.familyAccountId || "Individual");
  }
  return "";
}

function compareAccountRows(
  a: BillingAccountRow,
  b: BillingAccountRow,
  sortBy: string
): number {
  if (sortBy === "Surname") return String(a.surname).localeCompare(String(b.surname));
  if (sortBy === "Account No") return String(a.accountNo).localeCompare(String(b.accountNo));
  if (sortBy === "Balance") {
    return normaliseBillingAmount(b.balance) - normaliseBillingAmount(a.balance);
  }
  return `${a.name} ${a.surname}`.localeCompare(`${b.name} ${b.surname}`);
}

function filterAccountRows(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): BillingAccountRow[] {
  const byId = learnerById(learners);
  return rows.filter((row) => {
    const learner = byId.get(String(row.learnerId || row.id));
    if (!config.includeInactiveAccounts && isInactiveLearner(learner)) return false;
    return matchesShow(row, config.show);
  });
}

function sortAccountRows(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): BillingAccountRow[] {
  const byId = learnerById(learners);
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const ga = groupKeyForAccount(a, byId.get(String(a.learnerId || a.id)), config.groupBy);
    const gb = groupKeyForAccount(b, byId.get(String(b.learnerId || b.id)), config.groupBy);
    if (config.groupBy !== "None" && ga !== gb) return ga.localeCompare(gb);
    return compareAccountRows(a, b, config.sortBy);
  });
  return sorted;
}

function daysSince(dateRaw: string): number {
  const raw = String(dateRaw || "").trim();
  if (!raw) return 0;
  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return 0;
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
}

function ageBucketsForAccount(
  schoolId: string,
  learnerId: string,
  accountNo: string
) {
  const ledger = getAccountLedger(schoolId, learnerId, accountNo);
  const open = computeOpenInvoiceLines(ledger, learnerId, accountNo);
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 };
  for (const line of open) {
    const entry = ledger.find((e) => e.id === line.id);
    const due = entry?.dueDate || entry?.date || line.date;
    const days = daysSince(due);
    const amt = normaliseBillingAmount(line.unpaid);
    if (days <= 30) buckets.current += amt;
    else if (days <= 60) buckets.d30 += amt;
    else if (days <= 90) buckets.d60 += amt;
    else if (days <= 120) buckets.d90 += amt;
    else buckets.d120 += amt;
  }
  return buckets;
}

function getBillingPlan(learner: any): any[] {
  try {
    const schoolId = localStorage.getItem("schoolId") || "";
    const saved = JSON.parse(localStorage.getItem("educlearBillingPlans") || "{}");
    const fromStore = saved?.[learner?.id] || saved?.[learner?.learnerId];
    if (Array.isArray(fromStore) && fromStore.length) return fromStore;
  } catch {
    /* ignore */
  }
  return Array.isArray(learner?.billingPlan) ? learner.billingPlan : [];
}

function feeLabel(fee: any): string {
  return String(fee?.description || fee?.name || fee?.title || "Fee").trim();
}

function feeAmount(fee: any): number {
  return normaliseBillingAmount(fee?.amount ?? fee?.price ?? fee?.value);
}

function buildAccountListStatus(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const filtered = sortAccountRows(filterAccountRows(rows, learners, config), learners, config);
  const byId = learnerById(learners);
  const dataRows = filtered.map((row) => {
    const learner = byId.get(String(row.learnerId || row.id));
    return [
      row.accountNo,
      `${row.name} ${row.surname}`.trim(),
      String(learner?.grade || "—"),
      String(learner?.className || learner?.class || "—"),
      formatMoney(row.balance),
      row.status,
      row.lastInvoice,
      row.lastPayment,
    ];
  });
  return {
    reportId: "account-list-status",
    title: reportTitle("account-list-status"),
    columns: [
      "Account No",
      "Learner",
      "Grade",
      "Class",
      "Balance",
      "Status",
      "Last Invoice",
      "Last Payment",
    ],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [
      { label: "Accounts", value: String(dataRows.length) },
      {
        label: "Total Balance",
        value: formatMoney(filtered.reduce((s, r) => s + normaliseBillingAmount(r.balance), 0)),
      },
    ],
  };
}

function buildAccountListContact(
  rows: BillingAccountRow[],
  learners: any[],
  parents: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const filtered = sortAccountRows(filterAccountRows(rows, learners, config), learners, config);
  const byId = learnerById(learners);
  const dataRows = filtered.map((row) => {
    const learnerId = String(row.learnerId || row.id);
    const learner = byId.get(learnerId);
    const familyId = String(row.familyAccountId || learner?.familyAccountId || "").trim();
    const memberIds = familyId
      ? (learners || [])
          .filter(
            (l) =>
              String(l?.familyAccountId || l?.familyAccount?.id || "") === familyId
          )
          .map((l) => String(l?.id || l?.learnerId || ""))
          .filter(Boolean)
      : [learnerId];
    const contact = resolveStatementBillingContact(learners, parents, memberIds);
    return [
      row.accountNo,
      `${row.name} ${row.surname}`.trim(),
      row.status,
      formatMoney(row.balance),
      contact?.name || "—",
      contact?.email || "—",
      contact?.relationship || "—",
    ];
  });
  return {
    reportId: "account-list-contact",
    title: reportTitle("account-list-contact"),
    columns: [
      "Account No",
      "Learner",
      "Status",
      "Balance",
      "Contact Name",
      "Contact Email",
      "Relationship",
    ],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Accounts", value: String(dataRows.length) }],
  };
}

function buildAgeAnalysis(
  schoolId: string,
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const filtered = sortAccountRows(filterAccountRows(rows, learners, config), learners, config);
  const dataRows = filtered.map((row) => {
    const buckets = ageBucketsForAccount(
      schoolId,
      String(row.learnerId || row.id),
      row.accountNo
    );
    const total =
      buckets.current + buckets.d30 + buckets.d60 + buckets.d90 + buckets.d120;
    return [
      row.accountNo,
      `${row.name} ${row.surname}`.trim(),
      formatMoney(buckets.current),
      formatMoney(buckets.d30),
      formatMoney(buckets.d60),
      formatMoney(buckets.d90),
      formatMoney(buckets.d120),
      formatMoney(total),
    ];
  });
  const totals = filtered.reduce(
    (acc, row) => {
      const buckets = ageBucketsForAccount(
        schoolId,
        String(row.learnerId || row.id),
        row.accountNo
      );
      acc[0] += buckets.current;
      acc[1] += buckets.d30;
      acc[2] += buckets.d60;
      acc[3] += buckets.d90;
      acc[4] += buckets.d120;
      return acc;
    },
    [0, 0, 0, 0, 0]
  );
  return {
    reportId: "account-list-age",
    title: reportTitle("account-list-age"),
    columns: [
      "Account No",
      "Learner",
      "Current",
      "30 Days",
      "60 Days",
      "90 Days",
      "120+ Days",
      "Total",
    ],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [
      { label: "Accounts", value: String(dataRows.length) },
      { label: "Current", value: formatMoney(totals[0]) },
      { label: "120+ Days", value: formatMoney(totals[4]) },
    ],
  };
}

function buildBillingPlanByChild(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const byId = learnerById(learners);
  const filtered = filterAccountRows(rows, learners, config);
  const dataRows: string[][] = [];

  for (const row of filtered) {
    const learner = byId.get(String(row.learnerId || row.id));
    if (!learner) continue;
    const plan = getBillingPlan(learner);
    if (!plan.length) {
      dataRows.push([
        row.accountNo,
        `${row.name} ${row.surname}`.trim(),
        String(learner?.grade || "—"),
        "—",
        "—",
        formatMoney(0),
      ]);
      continue;
    }
    for (const fee of plan) {
      dataRows.push([
        row.accountNo,
        `${row.name} ${row.surname}`.trim(),
        String(learner?.grade || "—"),
        feeLabel(fee),
        String(fee?.type || fee?.feeType || "Fee"),
        formatMoney(feeAmount(fee)),
      ]);
    }
  }

  dataRows.sort((a, b) => {
    if (config.groupBy === "Grade") {
      const g = a[2].localeCompare(b[2]);
      if (g) return g;
    }
    if (config.groupBy === "Class") {
      const g = a[2].localeCompare(b[2]);
      if (g) return g;
    }
    if (config.sortBy === "Plan Total") {
      return normaliseBillingAmount(b[5]) - normaliseBillingAmount(a[5]);
    }
    if (config.sortBy === "Account No") return a[0].localeCompare(b[0]);
    if (config.sortBy === "Surname") return a[1].localeCompare(b[1]);
    return a[1].localeCompare(b[1]);
  });

  return {
    reportId: "billing-plan-child",
    title: reportTitle("billing-plan-child"),
    columns: ["Account No", "Learner", "Grade", "Fee", "Type", "Amount"],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Plan lines", value: String(dataRows.length) }],
  };
}

function buildBillingPlanByFee(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const byId = learnerById(learners);
  const filtered = filterAccountRows(rows, learners, config);
  const feeMap = new Map<string, { count: number; total: number; type: string }>();

  for (const row of filtered) {
    const learner = byId.get(String(row.learnerId || row.id));
    if (!learner) continue;
    for (const fee of getBillingPlan(learner)) {
      const name = feeLabel(fee);
      const amt = feeAmount(fee);
      if (config.show === "With Amount" && amt <= 0) continue;
      if (config.show === "Zero Amount" && amt !== 0) continue;
      const type = String(fee?.type || fee?.feeType || "Fee");
      const key = `${name}::${type}`;
      const prev = feeMap.get(key) || { count: 0, total: 0, type };
      feeMap.set(key, { count: prev.count + 1, total: prev.total + amt, type });
    }
  }

  const dataRows = [...feeMap.entries()].map(([key, val]) => {
    const name = key.split("::")[0];
    return [name, val.type, String(val.count), formatMoney(val.total)];
  });

  dataRows.sort((a, b) => {
    if (config.sortBy === "Count") return Number(b[2]) - Number(a[2]);
    if (config.sortBy === "Total Amount") {
      return normaliseBillingAmount(b[3]) - normaliseBillingAmount(a[3]);
    }
    return a[0].localeCompare(b[0]);
  });

  return {
    reportId: "billing-plan-fee",
    title: reportTitle("billing-plan-fee"),
    columns: ["Fee", "Type", "Learners", "Total Amount"],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Fee types", value: String(dataRows.length) }],
  };
}

function filterDeposits(deposits: DepositRecord[], config: BillingReportConfig) {
  return deposits.filter((d) => {
    if (config.show === "Active") {
      return d.status === "ACTIVE" || d.status === "PARTIALLY_ALLOCATED";
    }
    if (config.show === "Allocated") return d.status === "FULLY_ALLOCATED";
    if (config.show === "With Balance") return normaliseBillingAmount(d.remainingBalance) > 0;
    return true;
  });
}

function sortDeposits(deposits: DepositRecord[], config: BillingReportConfig) {
  const rows = [...deposits];
  rows.sort((a, b) => {
    if (config.groupBy === "Status") {
      const s = a.status.localeCompare(b.status);
      if (s) return s;
    }
    if (config.groupBy === "Account") {
      const s = a.accountNo.localeCompare(b.accountNo);
      if (s) return s;
    }
    if (config.sortBy === "Account") return a.accountNo.localeCompare(b.accountNo);
    if (config.sortBy === "Amount") {
      return normaliseBillingAmount(b.amount) - normaliseBillingAmount(a.amount);
    }
    if (config.sortBy === "Deposit No") {
      return a.depositNumber.localeCompare(b.depositNumber);
    }
    return String(b.depositDate || b.date).localeCompare(String(a.depositDate || a.date));
  });
  return rows;
}

async function buildDepositList(
  schoolId: string,
  config: BillingReportConfig
): Promise<GeneratedBillingReport> {
  const deposits = sortDeposits(filterDeposits(await fetchDeposits(schoolId), config), config);
  const dataRows = deposits.map((d) => [
    d.depositNumber,
    d.accountNo || d.account,
    d.learnerName,
    d.depositDate || d.date,
    formatMoney(d.amount),
    formatMoney(d.remainingBalance),
    d.statusLabel || d.status,
    d.reference || "—",
  ]);
  return {
    reportId: "deposit-list",
    title: reportTitle("deposit-list"),
    columns: [
      "Deposit No",
      "Account",
      "Learner",
      "Date",
      "Amount",
      "Remaining",
      "Status",
      "Reference",
    ],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [
      { label: "Deposits", value: String(dataRows.length) },
      {
        label: "Total Amount",
        value: formatMoney(deposits.reduce((s, d) => s + normaliseBillingAmount(d.amount), 0)),
      },
    ],
  };
}

async function buildDepositTransactionList(
  schoolId: string,
  config: BillingReportConfig
): Promise<GeneratedBillingReport> {
  const deposits = sortDeposits(filterDeposits(await fetchDeposits(schoolId), config), config);
  const dataRows: string[][] = [];
  for (const d of deposits) {
    const history = Array.isArray(d.history) ? d.history : [];
    const allocations = Array.isArray(d.allocations) ? d.allocations : [];
    if (!history.length && !allocations.length) {
      dataRows.push([
        d.depositNumber,
        d.accountNo,
        d.learnerName,
        "Deposit",
        d.depositDate || d.date,
        formatMoney(d.amount),
        d.statusLabel || d.status,
        "—",
      ]);
      continue;
    }
    for (const h of history) {
      dataRows.push([
        d.depositNumber,
        d.accountNo,
        d.learnerName,
        String(h.action || "History"),
        String(h.createdAt || "").slice(0, 10),
        h.amount != null ? formatMoney(h.amount) : "—",
        d.statusLabel || d.status,
        String(h.description || "—"),
      ]);
    }
    for (const a of allocations) {
      dataRows.push([
        d.depositNumber,
        d.accountNo,
        d.learnerName,
        "Allocation",
        a.invoiceDate || String(a.createdAt || "").slice(0, 10),
        formatMoney(a.amount),
        d.statusLabel || d.status,
        a.invoiceReference || "—",
      ]);
    }
  }
  return {
    reportId: "deposit-transaction-list",
    title: reportTitle("deposit-transaction-list"),
    columns: [
      "Deposit No",
      "Account",
      "Learner",
      "Type",
      "Date",
      "Amount",
      "Status",
      "Detail",
    ],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Lines", value: String(dataRows.length) }],
  };
}

function paymentInShowRange(dateRaw: string, show: string): boolean {
  const raw = String(dateRaw || "").trim();
  if (!raw || show === "All Payments") return true;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return true;
  const now = new Date();
  if (show === "This Month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (show === "This Year") return d.getFullYear() === now.getFullYear();
  if (show === "Last 30 Days") {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return d >= start && d <= now;
  }
  return true;
}

function learnerNameForEntry(learners: any[], entry: BillingLedgerEntry): string {
  const learner = (learners || []).find(
    (l) => String(l?.id || l?.learnerId) === String(entry.learnerId)
  );
  if (!learner) return "—";
  return `${learner.firstName || learner.name || ""} ${learner.lastName || learner.surname || ""}`.trim();
}

function matchesReceiveListShow(row: BillingAccountRow, show: string): boolean {
  const balance = normaliseBillingAmount(row.balance);
  if (show === "All Balances") return true;
  if (show === "Credits Only") return balance < 0;
  if (show === "Debits Only") return balance > 0;
  return true;
}

function filterReceiveListRows(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): BillingAccountRow[] {
  const byId = learnerById(learners);
  return rows.filter((row) => {
    const learner = byId.get(String(row.learnerId || row.id));
    const balance = normaliseBillingAmount(row.balance);
    if (isInactiveLearner(learner)) {
      if (!config.includeInactiveAccounts) return false;
      if (balance === 0) return false;
    }
    return matchesReceiveListShow(row, config.show);
  });
}

function buildPaymentReceiveList(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const filtered = sortAccountRows(
    filterReceiveListRows(rows, learners, config),
    learners,
    config
  );
  const byId = learnerById(learners);

  const groups: PaymentReceiveListGroup[] = [];
  let currentHeading: string | null = null;
  let currentRows: PaymentReceiveListRow[] = [];
  let rowNum = 0;

  for (const row of filtered) {
    const learner = byId.get(String(row.learnerId || row.id));
    const heading = groupKeyForAccount(row, learner, config.groupBy) || "—";
    if (currentHeading !== null && heading !== currentHeading) {
      groups.push({ heading: currentHeading, rows: currentRows });
      currentRows = [];
      rowNum = 0;
    }
    currentHeading = heading;
    rowNum += 1;
    currentRows.push({
      rowNum,
      accountNo: row.accountNo,
      learnerName: `${row.name} ${row.surname}`.trim(),
      balance: formatMoney(row.balance),
    });
  }
  if (currentRows.length > 0 && currentHeading !== null) {
    groups.push({ heading: currentHeading, rows: currentRows });
  }

  const flatRows = groups.flatMap((g) =>
    g.rows.map((r) => [
      String(r.rowNum),
      r.accountNo,
      r.learnerName,
      r.balance,
      "",
      "",
      "",
      "",
    ])
  );

  const totalBalance = filtered.reduce(
    (s, r) => s + normaliseBillingAmount(r.balance),
    0
  );

  return {
    reportId: "payment-receive-list",
    title: reportTitle("payment-receive-list"),
    columns: ["#", "Account", "Learner name", "Balance", "Amount", "Type", "Date", "Receipt No"],
    rows: flatRows,
    groups,
    generatedAt: new Date().toISOString(),
    summary: [
      { label: "Accounts", value: String(filtered.length) },
      { label: "Groups", value: String(groups.length) },
      { label: "Total Balance", value: formatMoney(totalBalance) },
    ],
  };
}

function buildPaymentsByType(
  schoolId: string,
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const ledger = readSchoolLedger(schoolId).filter(
    (e) => e.type === "payment" && paymentInShowRange(e.date || e.createdAt, config.show)
  );
  const byMethod = new Map<string, { count: number; total: number }>();
  for (const e of ledger) {
    const method = String(e.method || "Unspecified");
    const prev = byMethod.get(method) || { count: 0, total: 0 };
    byMethod.set(method, {
      count: prev.count + 1,
      total: prev.total + normaliseBillingAmount(e.amount),
    });
  }

  const dataRows = [...byMethod.entries()]
    .map(([method, val]) => [method, String(val.count), formatMoney(val.total)])
    .sort((a, b) => {
      if (config.sortBy === "Count") return Number(b[1]) - Number(a[1]);
      return normaliseBillingAmount(b[2]) - normaliseBillingAmount(a[2]);
    });

  void learners;

  return {
    reportId: "payments-by-type",
    title: reportTitle("payments-by-type"),
    columns: ["Payment Type", "Count", "Total Amount"],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Types", value: String(dataRows.length) }],
  };
}

function buildSiblingAccounts(
  rows: BillingAccountRow[],
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const byFamily = new Map<string, BillingAccountRow[]>();
  for (const row of filterAccountRows(rows, learners, config)) {
    const familyId = String(row.familyAccountId || "").trim();
    if (!familyId) continue;
    const list = byFamily.get(familyId) || [];
    list.push(row);
    byFamily.set(familyId, list);
  }

  const dataRows: string[][] = [];
  for (const [, members] of byFamily) {
    if (members.length < 2) continue;
    const accountNo = members[0]?.accountNo || "—";
    const names = members.map((m) => `${m.name} ${m.surname}`.trim()).join("; ");
    const balance = members[0]?.balance ?? 0;
    dataRows.push([
      accountNo,
      String(members.length),
      names,
      formatMoney(balance),
      members.map((m) => m.status).join(", "),
    ]);
  }

  dataRows.sort((a, b) => {
    if (config.sortBy === "Learner Count") return Number(b[1]) - Number(a[1]);
    if (config.sortBy === "Balance") {
      return normaliseBillingAmount(b[3]) - normaliseBillingAmount(a[3]);
    }
    return a[0].localeCompare(b[0]);
  });

  return {
    reportId: "sibling-accounts",
    title: reportTitle("sibling-accounts"),
    columns: ["Account No", "Learners", "Names", "Family Balance", "Statuses"],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Family accounts", value: String(dataRows.length) }],
  };
}

function entryMatchesShow(entry: BillingLedgerEntry, show: string): boolean {
  if (show === "All Transactions") return true;
  if (show === "Invoices") return entry.type === "invoice";
  if (show === "Payments") return entry.type === "payment";
  if (show === "Credits") return entry.type === "credit";
  if (show === "Penalties") return entry.type === "penalty";
  return true;
}

function buildTransactionList(
  schoolId: string,
  learners: any[],
  config: BillingReportConfig
): GeneratedBillingReport {
  const ledger = readSchoolLedger(schoolId).filter((e) => entryMatchesShow(e, config.show));
  const rows = ledger.map((e) => ({
    entry: e,
    date: e.date || String(e.createdAt || "").slice(0, 10),
    type: e.type,
    accountNo: e.accountNo,
    name: learnerNameForEntry(learners, e),
    amount: normaliseBillingAmount(e.amount),
    reference: e.reference || "—",
    description: e.description || "—",
  }));

  rows.sort((a, b) => {
    if (config.groupBy === "Type") {
      const t = a.type.localeCompare(b.type);
      if (t) return t;
    }
    if (config.groupBy === "Account") {
      const ac = a.accountNo.localeCompare(b.accountNo);
      if (ac) return ac;
    }
    if (config.sortBy === "Account") return a.accountNo.localeCompare(b.accountNo);
    if (config.sortBy === "Amount") return b.amount - a.amount;
    if (config.sortBy === "Reference") return a.reference.localeCompare(b.reference);
    return b.date.localeCompare(a.date);
  });

  const dataRows = rows.map((r) => [
    r.date,
    r.type,
    r.accountNo,
    r.name,
    formatMoney(r.amount),
    r.reference,
    r.description,
  ]);

  return {
    reportId: "transaction-list",
    title: reportTitle("transaction-list"),
    columns: ["Date", "Type", "Account", "Learner", "Amount", "Reference", "Description"],
    rows: dataRows,
    generatedAt: new Date().toISOString(),
    summary: [{ label: "Transactions", value: String(dataRows.length) }],
  };
}

export async function generateBillingReport(input: EngineInput): Promise<GeneratedBillingReport> {
  const { schoolId, reportId, config, statementRows, learners, parents } = input;

  switch (reportId) {
    case "account-list-status":
      return buildAccountListStatus(statementRows, learners, config);
    case "account-list-contact":
      return buildAccountListContact(statementRows, learners, parents, config);
    case "account-list-age":
      return buildAgeAnalysis(schoolId, statementRows, learners, config);
    case "billing-plan-child":
      return buildBillingPlanByChild(statementRows, learners, config);
    case "billing-plan-fee":
      return buildBillingPlanByFee(statementRows, learners, config);
    case "deposit-list":
      return buildDepositList(schoolId, config);
    case "deposit-transaction-list":
      return buildDepositTransactionList(schoolId, config);
    case "payment-receive-list":
      return buildPaymentReceiveList(statementRows, learners, config);
    case "payments-by-type":
      return buildPaymentsByType(schoolId, learners, config);
    case "sibling-accounts":
      return buildSiblingAccounts(statementRows, learners, config);
    case "transaction-list":
      return buildTransactionList(schoolId, learners, config);
    default:
      return buildAccountListStatus(statementRows, learners, config);
  }
}

export function accountNoForLearner(learner: any): string {
  return getLearnerAccountNo(learner);
}
