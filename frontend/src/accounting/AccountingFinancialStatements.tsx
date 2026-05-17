import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BILLING_UPDATED_EVENT,
  formatMoney,
  getBillingRows,
  normaliseBillingAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../billing/billingLedger";
import {
  ACCOUNTING_ASSETS_UPDATED_EVENT,
  calculateBookValueTotals,
  calculateDepreciationTotals,
  loadAssets,
} from "./accountingAssetStorage";
import {
  ACCOUNTING_EXPENSES_UPDATED_EVENT,
  filterApprovedExpensesForMonth,
  loadApprovedExpenses,
  migrateLegacyExpenseStores,
  normalizeExpenseCategory,
} from "./accountingExpenseStorage";
import {
  ACCOUNTING_SETTINGS_UPDATED_EVENT,
  dateInReportingRange,
  getDefaultReportingBasis,
  loadAccountingSettings,
  MONTH_NAMES,
  REPORTING_BASIS_OPTIONS,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
  type ResolvedReportingPeriod,
} from "./accountingSettingsStorage";
import {
  creditorTotalsForReportingPeriod,
  CREDITORS_UPDATED_EVENT,
  upcomingCreditorPaymentsForReportingPeriod,
} from "./accountingCreditorsHelpers";
import {
  ACCOUNTING_PAYROLL_UPDATED_EVENT,
  payrollLiabilitiesFromPostedRuns,
  payrollRunsCashPayments,
  payrollTotalsForReportingPeriod,
} from "./accountingPayrollIntegration";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";
import {
  exportPayloadCsv,
  formatExportMoney,
  openPrintWindow,
  payloadFromTable,
  resolveExportBranding,
} from "./accountingExportEngine";

type Props = {
  schoolId: string;
  schoolName?: string;
  learners?: any[];
};

export type StatementType = "income" | "cashflow" | "trial-balance" | "balance-sheet";

const STATEMENT_OPTIONS: { id: StatementType; label: string }[] = [
  { id: "income", label: "Income Statement" },
  { id: "cashflow", label: "Cash Flow Statement" },
  { id: "trial-balance", label: "Trial Balance" },
  { id: "balance-sheet", label: "Balance Sheet" },
];

const INCOME_LINES = [
  "School Fees",
  "Registration Fees",
  "Transport Fees",
  "Aftercare",
  "Other Income",
] as const;

const EXPENSE_LINES = [
  "Salaries",
  "Rent / Bond",
  "Electricity",
  "Water",
  "Fuel",
  "Repairs & Maintenance",
  "Stationery",
  "Food / Tuckshop",
  "Insurance",
  "Marketing",
  "Bank Charges",
  "SARS / UIF",
  "Other",
] as const;

const fieldStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
  minWidth: 140,
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
};

const outlineBtn: React.CSSProperties = {
  ...goldBtn,
  background: "#fff",
  border: `2px solid ${ACCOUNTING_GOLD}`,
};

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: ACCOUNTING_GOLD,
  background: ACCOUNTING_INK,
  borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  fontWeight: 600,
  color: ACCOUNTING_INK,
};

const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const statementsSummaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
  gap: 16,
  marginBottom: 24,
  alignItems: "stretch",
};

const statementsSummaryCard: React.CSSProperties = {
  ...accountingCard,
  boxSizing: "border-box",
  minHeight: 124,
  height: "100%",
  padding: "18px 20px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
};

const statementsSummaryLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  lineHeight: 1.25,
  marginBottom: 8,
};

const statementsSummaryValueWrap: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  maxWidth: "100%",
  minHeight: 0,
};

const statementsSummaryValue: React.CSSProperties = {
  fontSize: "clamp(1.35rem, 1.6vw, 2rem)",
  lineHeight: 1.1,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  fontVariantNumeric: "tabular-nums",
  color: ACCOUNTING_INK,
  maxWidth: "100%",
  overflowWrap: "anywhere",
  wordBreak: "normal",
  whiteSpace: "normal",
};

function parseYearMonth(dateRaw: string): { year: number; monthIndex: number } | null {
  const raw = String(dateRaw || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const monthIndex = Number(iso[2]) - 1;
    if (year >= 1970 && monthIndex >= 0 && monthIndex <= 11) return { year, monthIndex };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

function entryInPeriod(dateRaw: string, year: number, monthIndex: number) {
  const parsed = parseYearMonth(dateRaw);
  return parsed?.year === year && parsed?.monthIndex === monthIndex;
}

function paymentsForMonth(ledger: BillingLedgerEntry[], year: number, monthIndex: number) {
  return ledger.filter((e) => e.type === "payment" && entryInPeriod(e.date, year, monthIndex));
}

function paymentsInRange(ledger: BillingLedgerEntry[], startDate: string, endDate: string) {
  return ledger.filter(
    (e) => e.type === "payment" && dateInReportingRange(e.date, startDate, endDate)
  );
}

function approvedExpensesInRange(
  rows: ReturnType<typeof loadApprovedExpenses>,
  startDate: string,
  endDate: string
) {
  return rows.filter((row) => dateInReportingRange(row.date, startDate, endDate));
}

function classifyPaymentIncome(description: string, reference: string): (typeof INCOME_LINES)[number] {
  const text = `${description} ${reference}`.toLowerCase();
  if (text.includes("registration")) return "Registration Fees";
  if (text.includes("transport") || text.includes("bus")) return "Transport Fees";
  if (text.includes("aftercare") || text.includes("after care")) return "Aftercare";
  if (text.includes("tuckshop") || text.includes("fundraising") || text.includes("donation")) {
    return "Other Income";
  }
  return "School Fees";
}

function mapExpenseToLine(category: string): (typeof EXPENSE_LINES)[number] {
  const key = normalizeExpenseCategory(category);
  const map: Record<string, (typeof EXPENSE_LINES)[number]> = {
    salaries: "Salaries",
    "rent / bond": "Rent / Bond",
    rent: "Rent / Bond",
    bond: "Rent / Bond",
    electricity: "Electricity",
    utilities: "Electricity",
    water: "Water",
    fuel: "Fuel",
    transport: "Fuel",
    maintenance: "Repairs & Maintenance",
    "repairs & maintenance": "Repairs & Maintenance",
    stationery: "Stationery",
    "food / tuckshop": "Food / Tuckshop",
    food: "Food / Tuckshop",
    tuckshop: "Food / Tuckshop",
    insurance: "Insurance",
    marketing: "Marketing",
    "bank charges": "Bank Charges",
    "sars / uif": "SARS / UIF",
    sars: "SARS / UIF",
    uif: "SARS / UIF",
  };
  return map[key] || "Other";
}

function emptyLineMap<T extends string>(lines: readonly T[]): Record<T, number> {
  return lines.reduce(
    (acc, line) => {
      acc[line] = 0;
      return acc;
    },
    {} as Record<T, number>
  );
}

function openPrintHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups to print the statement.");
    return false;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type FinancialReport = {
  incomeByLine: Record<(typeof INCOME_LINES)[number], number>;
  expenseByLine: Record<(typeof EXPENSE_LINES)[number], number>;
  totalIncome: number;
  totalExpenses: number;
  netSurplus: number;
  cashReceived: number;
  cashPaidExpenses: number;
  payrollPayments: number;
  payrollSalariesExpense: number;
  payrollLiabilitiesTotal: number;
  payeLiabilities: number;
  netCashMovement: number;
  openingCashPlaceholder: number;
  closingCashPlaceholder: number;
  debtorsOutstanding: number;
  bankCashEstimate: number;
  fixedAssetsGross: number;
  accumulatedDepreciation: number;
  fixedAssetsNetBook: number;
  depreciationExpense: number;
  totalAssets: number;
  totalLiabilities: number;
  equitySurplus: number;
  supplierPayables: number;
  overdueSupplierPayables: number;
  paymentPlanCommitments: number;
  scheduledSupplierPayments: number;
  upcomingCreditorPaymentsEstimate: number;
  creditorSupplierCount: number;
  trialRows: { account: string; debit: number; credit: number; balance: number }[];
};

export function buildFinancialReport(
  schoolId: string,
  learners: any[],
  period: ResolvedReportingPeriod
): FinancialReport {
  const ledger = readSchoolLedger(schoolId);
  const approved = loadApprovedExpenses(schoolId);
  const monthApproved =
    period.basis === "month"
      ? filterApprovedExpensesForMonth(approved, period.year, period.monthIndex)
      : approvedExpensesInRange(approved, period.startDate, period.endDate);

  const paymentRows =
    period.basis === "month"
      ? paymentsForMonth(ledger, period.year, period.monthIndex)
      : paymentsInRange(ledger, period.startDate, period.endDate);

  const incomeByLine = emptyLineMap(INCOME_LINES);
  for (const pay of paymentRows) {
    const amount = normaliseBillingAmount(pay.amount);
    if (amount <= 0) continue;
    const line = classifyPaymentIncome(
      String(pay.description || ""),
      String(pay.reference || "")
    );
    incomeByLine[line] += amount;
  }

  const expenseByLine = emptyLineMap(EXPENSE_LINES);
  for (const row of monthApproved) {
    const amount = normaliseBillingAmount(row.amount);
    if (amount <= 0) continue;
    const line = mapExpenseToLine(String(row.category || "Other"));
    expenseByLine[line] += amount;
  }

  const assets = schoolId ? loadAssets(schoolId) : [];
  const bookTotals = calculateBookValueTotals(assets);
  const depTotals = calculateDepreciationTotals(assets, period.depreciationYear);
  const depreciationExpense = depTotals.expenseForYear;

  const payrollPosted =
    schoolId && period.startDate && period.endDate
      ? payrollTotalsForReportingPeriod(schoolId, period.startDate, period.endDate, "Posted")
      : {
          totalPayrollCost: 0,
          netPay: 0,
          paye: 0,
          runCount: 0,
        };

  const payrollSalariesExpense = payrollPosted.totalPayrollCost;
  if (payrollSalariesExpense > 0) {
    expenseByLine.Salaries += payrollSalariesExpense;
  }

  const totalIncome = INCOME_LINES.reduce((s, k) => s + incomeByLine[k], 0);
  const operatingExpenses = EXPENSE_LINES.reduce((s, k) => s + expenseByLine[k], 0);
  const totalExpenses = operatingExpenses + depreciationExpense;
  const netSurplus = totalIncome - totalExpenses;

  const payrollPayments = payrollPosted.runCount
    ? payrollRunsCashPayments(schoolId, period.startDate, period.endDate)
    : 0;

  const cashReceived = totalIncome;
  const cashPaidExpenses = totalExpenses;
  const openingCashPlaceholder = 0;
  const netCashMovement = cashReceived - cashPaidExpenses - payrollPayments;
  const closingCashPlaceholder = openingCashPlaceholder + netCashMovement;
  const bankCashEstimate = Math.max(closingCashPlaceholder, 0);

  const billingRows = getBillingRows(learners || [], schoolId);
  const debtorsOutstanding = billingRows.reduce((sum, row) => {
    const bal = normaliseBillingAmount(row.balance);
    return sum + (bal > 0 ? bal : 0);
  }, 0);

  const fixedAssetsGross = bookTotals.grossPurchaseCost;
  const accumulatedDepreciation = bookTotals.accumulatedDepreciation;
  const fixedAssetsNetBook = bookTotals.netBookValue;

  const creditorTotals = schoolId
    ? creditorTotalsForReportingPeriod(schoolId, period)
    : {
        supplierPayables: 0,
        overdueSupplierPayables: 0,
        paymentPlanCommitments: 0,
        supplierCount: 0,
      };
  const upcomingCreditors = schoolId
    ? upcomingCreditorPaymentsForReportingPeriod(schoolId, period)
    : {
        scheduledInvoicePayments: 0,
        paymentPlanInstallments: 0,
        totalUpcoming: 0,
      };

  const supplierPayables = creditorTotals.supplierPayables;
  const overdueSupplierPayables = creditorTotals.overdueSupplierPayables;
  const paymentPlanCommitments = creditorTotals.paymentPlanCommitments;
  const scheduledSupplierPayments = upcomingCreditors.scheduledInvoicePayments;
  const upcomingCreditorPaymentsEstimate = upcomingCreditors.totalUpcoming;

  const payrollLiab = schoolId
    ? payrollLiabilitiesFromPostedRuns(schoolId, period.endDate)
    : { total: 0, paye: 0 };
  const payrollLiabilitiesTotal = payrollLiab.total;
  const payeLiabilities = payrollLiab.paye;
  const openingEquityPlaceholder = 0;

  const totalAssets = bankCashEstimate + debtorsOutstanding + fixedAssetsNetBook;
  const totalLiabilities = supplierPayables + payrollLiabilitiesTotal + payeLiabilities;
  const equitySurplus = openingEquityPlaceholder + netSurplus;

  const trialRows: FinancialReport["trialRows"] = [];

  if (bankCashEstimate > 0) {
    trialRows.push({
      account: "Bank / Cash (estimated)",
      debit: bankCashEstimate,
      credit: 0,
      balance: bankCashEstimate,
    });
  }

  for (const line of EXPENSE_LINES) {
    const amount = expenseByLine[line];
    if (amount <= 0) continue;
    trialRows.push({
      account: line,
      debit: amount,
      credit: 0,
      balance: amount,
    });
  }

  if (depreciationExpense > 0) {
    trialRows.push({
      account: "Depreciation Expense",
      debit: depreciationExpense,
      credit: 0,
      balance: depreciationExpense,
    });
  }

  if (fixedAssetsGross > 0) {
    trialRows.push({
      account: "Fixed Assets",
      debit: fixedAssetsGross,
      credit: 0,
      balance: fixedAssetsGross,
    });
  }

  if (accumulatedDepreciation > 0) {
    trialRows.push({
      account: "Accumulated Depreciation",
      debit: 0,
      credit: accumulatedDepreciation,
      balance: -accumulatedDepreciation,
    });
  }

  const schoolFeeIncome = incomeByLine["School Fees"] + incomeByLine["Registration Fees"];
  const otherIncome =
    incomeByLine["Transport Fees"] +
    incomeByLine["Aftercare"] +
    incomeByLine["Other Income"];

  if (schoolFeeIncome > 0) {
    trialRows.push({
      account: "School Fee Income",
      debit: 0,
      credit: schoolFeeIncome,
      balance: -schoolFeeIncome,
    });
  }
  if (otherIncome > 0) {
    trialRows.push({
      account: "Other Income",
      debit: 0,
      credit: otherIncome,
      balance: -otherIncome,
    });
  }

  if (supplierPayables > 0) {
    trialRows.push({
      account: "Accounts Payable / Supplier Payables",
      debit: 0,
      credit: supplierPayables,
      balance: -supplierPayables,
    });
  }

  return {
    incomeByLine,
    expenseByLine,
    totalIncome,
    totalExpenses,
    netSurplus,
    cashReceived,
    cashPaidExpenses,
    payrollPayments,
    payrollSalariesExpense,
    payrollLiabilitiesTotal,
    payeLiabilities,
    netCashMovement,
    openingCashPlaceholder,
    closingCashPlaceholder,
    debtorsOutstanding,
    bankCashEstimate,
    fixedAssetsGross,
    accumulatedDepreciation,
    fixedAssetsNetBook,
    depreciationExpense,
    totalAssets,
    totalLiabilities,
    equitySurplus,
    supplierPayables,
    overdueSupplierPayables,
    paymentPlanCommitments,
    scheduledSupplierPayments,
    upcomingCreditorPaymentsEstimate,
    creditorSupplierCount: creditorTotals.supplierCount,
    trialRows,
  };
}

function statementTitle(type: StatementType) {
  return STATEMENT_OPTIONS.find((o) => o.id === type)?.label || "Financial Statement";
}

export function buildPrintHtml(opts: {
  schoolName: string;
  periodLabel: string;
  generatedAt: string;
  statementType: StatementType;
  report: FinancialReport;
}) {
  const { schoolName, periodLabel, generatedAt, statementType, report } = opts;
  const title = statementTitle(statementType);

  const lineRow = (label: string, amount: number, bold = false) =>
    `<tr><td style="padding:6px 0;${bold ? "font-weight:800;" : ""}">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;${bold ? "font-weight:800;" : ""}">${escapeHtml(formatMoney(amount))}</td></tr>`;

  let body = "";

  if (statementType === "income") {
    body += `<h2 style="font-size:16px;margin:18px 0 8px;color:#111827;">Income</h2><table style="width:100%;border-collapse:collapse;">`;
    for (const line of INCOME_LINES) {
      if (report.incomeByLine[line] > 0) body += lineRow(line, report.incomeByLine[line]);
    }
    body += `</table><h2 style="font-size:16px;margin:18px 0 8px;color:#111827;">Expenses</h2><table style="width:100%;border-collapse:collapse;">`;
    for (const line of EXPENSE_LINES) {
      if (report.expenseByLine[line] > 0) body += lineRow(line, report.expenseByLine[line]);
    }
    if (report.depreciationExpense > 0) {
      body += lineRow("Depreciation Expense", report.depreciationExpense);
    }
    body += `</table><table style="width:100%;margin-top:16px;border-top:2px solid #d4af37;padding-top:12px;">`;
    body += lineRow("Total Income", report.totalIncome, true);
    body += lineRow("Total Expenses", report.totalExpenses, true);
    body += lineRow("Net Surplus / Deficit", report.netSurplus, true);
    body += `</table>`;
  } else if (statementType === "cashflow") {
    body += `<table style="width:100%;border-collapse:collapse;">`;
    body += lineRow("Cash received from parents / billing", report.cashReceived);
    body += lineRow("Cash paid to suppliers / expenses", report.cashPaidExpenses);
    body += lineRow("Scheduled supplier payments (creditors due)", report.scheduledSupplierPayments);
    body += lineRow(
      "Upcoming creditor payments (estimate)",
      report.upcomingCreditorPaymentsEstimate
    );
    body += lineRow("Payroll / salary payments", report.payrollPayments);
    body += lineRow("Net cash movement", report.netCashMovement, true);
    body += lineRow("Opening balance (placeholder)", report.openingCashPlaceholder);
    body += lineRow("Closing balance (placeholder)", report.closingCashPlaceholder, true);
    body += `</table>`;
  } else if (statementType === "trial-balance") {
    body += `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#111827;color:#d4af37;"><th style="padding:8px;text-align:left;">Account</th><th style="padding:8px;text-align:right;">Debit</th><th style="padding:8px;text-align:right;">Credit</th><th style="padding:8px;text-align:right;">Balance</th></tr></thead><tbody>`;
    for (const row of report.trialRows) {
      body += `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row.account)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${row.debit ? escapeHtml(formatMoney(row.debit)) : "—"}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${row.credit ? escapeHtml(formatMoney(row.credit)) : "—"}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">${escapeHtml(formatMoney(row.balance))}</td></tr>`;
    }
    body += `</tbody></table>`;
  } else {
    body += `<h2 style="font-size:16px;margin:12px 0 6px;">Assets</h2><table style="width:100%;">`;
    body += lineRow("Bank / Cash (estimated)", report.bankCashEstimate);
    body += lineRow("Debtors (billing outstanding)", report.debtorsOutstanding);
    body += lineRow("Fixed assets at book value (gross)", report.fixedAssetsGross);
    body += lineRow("Accumulated depreciation", report.accumulatedDepreciation);
    body += lineRow("Net fixed asset value", report.fixedAssetsNetBook);
    body += lineRow("Total Assets", report.totalAssets, true);
    body += `</table><h2 style="font-size:16px;margin:18px 0 6px;">Liabilities</h2><table style="width:100%;">`;
    body += lineRow("Supplier payables", report.supplierPayables);
    body += lineRow("Overdue supplier payables", report.overdueSupplierPayables);
    body += lineRow("Payment plan commitments", report.paymentPlanCommitments);
    body += lineRow("Payroll liabilities", report.payrollLiabilitiesTotal);
    body += lineRow("PAYE liabilities", report.payeLiabilities);
    body += lineRow("Tax liabilities (placeholder)", 0);
    body += lineRow("Total Liabilities", report.totalLiabilities, true);
    body += `</table><h2 style="font-size:16px;margin:18px 0 6px;">Equity</h2><table style="width:100%;">`;
    body += lineRow("Opening balance (placeholder)", 0);
    body += lineRow("Current year surplus / deficit", report.equitySurplus, true);
    body += `</table>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)} — ${escapeHtml(periodLabel)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111827; margin: 36px; line-height: 1.5; }
  .header { border-bottom: 2px solid #d4af37; padding-bottom: 14px; margin-bottom: 20px; }
  .school { font-size: 20px; font-weight: 800; }
  .meta { color: #64748b; font-size: 13px; margin-top: 6px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .notes { margin-top: 24px; font-size: 12px; color: #64748b; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  .footer { margin-top: 20px; font-weight: 800; color: #b89329; }
</style></head><body>
  <div class="header">
    <div class="school">${escapeHtml(schoolName)}</div>
    <div class="meta">Period: ${escapeHtml(periodLabel)} · Generated: ${escapeHtml(generatedAt)}</div>
  </div>
  <h1>${escapeHtml(title)}</h1>
  ${body}
  <div class="notes">
    <p>Management statement based on approved expenses and billing receipts.</p>
    <p>Final audited financial statements must be reviewed by the school's accountant/auditor.</p>
  </div>
  <div class="footer">Prepared by EduClear Accounting</div>
</body></html>`;
}

export default function AccountingFinancialStatements({
  schoolId,
  schoolName: schoolNameProp,
  learners = [],
}: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [reportingBasis, setReportingBasis] = useState<ReportingBasis>(() =>
    schoolId ? getDefaultReportingBasis(schoolId) : "doe"
  );
  const [statementType, setStatementType] = useState<StatementType>("income");
  const [generatedAt, setGeneratedAt] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportBanner, setExportBanner] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);

  const schoolName =
    String(schoolNameProp || localStorage.getItem("schoolName") || "").trim() || "School";

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!schoolId) return;
    migrateLegacyExpenseStores(schoolId);
    setReportingBasis(loadAccountingSettings(schoolId).reports.defaultReportBasis);
  }, [schoolId, refreshKey]);

  useEffect(() => {
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) {
        setReportingBasis(getDefaultReportingBasis(schoolId));
      }
    };
    window.addEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, onSettings);
    return () => window.removeEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, onSettings);
  }, [schoolId]);

  useEffect(() => {
    const onExpenses = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    const onBilling = () => bumpRefresh();
    const onAssets = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    const onCreditors = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    const onPayroll = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    window.addEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onExpenses);
    window.addEventListener(BILLING_UPDATED_EVENT, onBilling);
    window.addEventListener(ACCOUNTING_ASSETS_UPDATED_EVENT, onAssets);
    window.addEventListener(CREDITORS_UPDATED_EVENT, onCreditors);
    window.addEventListener(ACCOUNTING_PAYROLL_UPDATED_EVENT, onPayroll);
    return () => {
      window.removeEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onExpenses);
      window.removeEventListener(BILLING_UPDATED_EVENT, onBilling);
      window.removeEventListener(ACCOUNTING_ASSETS_UPDATED_EVENT, onAssets);
      window.removeEventListener(CREDITORS_UPDATED_EVENT, onCreditors);
      window.removeEventListener(ACCOUNTING_PAYROLL_UPDATED_EVENT, onPayroll);
    };
  }, [schoolId, bumpRefresh]);

  const period = useMemo(
    () => resolveReportingPeriod(reportingBasis, year, monthIndex),
    [reportingBasis, year, monthIndex]
  );
  const periodLabel = period.label;

  const report = useMemo(() => {
    const sid = String(schoolId || "").trim();
    if (!sid) {
      return buildFinancialReport("", [], period);
    }
    return buildFinancialReport(sid, learners, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, learners, period, refreshKey]);

  const displayGeneratedAt = generatedAt || "Not generated yet — click Generate";

  const handleGenerate = () => {
    setGeneratedAt(new Date().toLocaleString("en-ZA"));
    bumpRefresh();
  };

  const handlePrint = () => {
    const at = generatedAt || new Date().toLocaleString("en-ZA");
    const html = buildPrintHtml({
      schoolName,
      periodLabel,
      generatedAt: at,
      statementType,
      report,
    });
    openPrintHtml(html);
  };

  const handleExportPdf = () => {
    const at = generatedAt || new Date().toLocaleString("en-ZA");
    const html = buildPrintHtml({
      schoolName,
      periodLabel,
      generatedAt: at,
      statementType,
      report,
    });
    if (!openPrintWindow(html)) {
      setExportBanner("Pop-up blocked. Allow pop-ups to export PDF.");
    } else {
      setExportBanner("");
    }
  };

  const handleExportExcel = () => {
    const at = generatedAt || new Date().toLocaleString("en-ZA");
    const title = statementTitle(statementType);
    const summary = [
      { label: "Total Income", value: formatExportMoney(report.totalIncome) },
      { label: "Total Expenses", value: formatExportMoney(report.totalExpenses) },
      { label: "Net Surplus / Deficit", value: formatExportMoney(report.netSurplus) },
    ];
    let columns: string[] = [];
    let rows: string[][] = [];
    if (statementType === "trial-balance") {
      columns = ["Account", "Debit", "Credit", "Balance"];
      rows = report.trialRows.map((r) => [
        r.account,
        r.debit ? formatExportMoney(r.debit) : "",
        r.credit ? formatExportMoney(r.credit) : "",
        formatExportMoney(r.balance),
      ]);
    } else if (statementType === "income") {
      columns = ["Line", "Amount"];
      rows = [
        ...INCOME_LINES.filter((l) => report.incomeByLine[l] > 0).map((l) => [
          l,
          formatExportMoney(report.incomeByLine[l]),
        ]),
        ...EXPENSE_LINES.filter((l) => report.expenseByLine[l] > 0).map((l) => [
          l,
          formatExportMoney(report.expenseByLine[l]),
        ]),
      ];
    } else {
      columns = ["Item", "Amount"];
      rows = [
        ["Cash received", formatExportMoney(report.cashReceived)],
        ["Cash paid (expenses)", formatExportMoney(report.cashPaidExpenses)],
        ["Net cash movement", formatExportMoney(report.netCashMovement)],
        ["Total assets", formatExportMoney(report.totalAssets)],
        ["Total liabilities", formatExportMoney(report.totalLiabilities)],
      ];
    }
    exportPayloadCsv(
      payloadFromTable(resolveExportBranding(schoolName), title, periodLabel, at, { columns, rows }, summary)
    );
    setExportBanner("");
  };

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => current - i);
  }, []);

  const renderIncomeStatement = () => (
    <>
      <h3 style={{ margin: "0 0 12px", fontWeight: 900, color: ACCOUNTING_INK }}>Income</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {INCOME_LINES.map((line) => (
            <tr key={line}>
              <td style={td}>{line}</td>
              <td style={tdRight}>{formatMoney(report.incomeByLine[line])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ margin: "0 0 12px", fontWeight: 900, color: ACCOUNTING_INK }}>Expenses</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {EXPENSE_LINES.map((line) => (
            <tr key={line}>
              <td style={td}>{line}</td>
              <td style={tdRight}>{formatMoney(report.expenseByLine[line])}</td>
            </tr>
          ))}
          {report.depreciationExpense > 0 ? (
            <tr>
              <td style={td}>Depreciation Expense</td>
              <td style={tdRight}>{formatMoney(report.depreciationExpense)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <table style={{ width: "100%", borderCollapse: "collapse", borderTop: `2px solid ${ACCOUNTING_GOLD}` }}>
        <tbody>
          <tr>
            <td style={{ ...td, fontWeight: 900 }}>Total Income</td>
            <td style={{ ...tdRight, fontWeight: 900 }}>{formatMoney(report.totalIncome)}</td>
          </tr>
          <tr>
            <td style={{ ...td, fontWeight: 900 }}>Total Expenses</td>
            <td style={{ ...tdRight, fontWeight: 900 }}>{formatMoney(report.totalExpenses)}</td>
          </tr>
          <tr>
            <td style={{ ...td, fontWeight: 900, color: report.netSurplus >= 0 ? "#166534" : "#b91c1c" }}>
              Net Surplus / Deficit
            </td>
            <td
              style={{
                ...tdRight,
                fontWeight: 900,
                color: report.netSurplus >= 0 ? "#166534" : "#b91c1c",
              }}
            >
              {formatMoney(report.netSurplus)}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );

  const renderCashFlow = () => (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {[
          ["Cash received from parents / billing", report.cashReceived],
          ["Cash paid to suppliers / expenses (approved)", report.cashPaidExpenses],
          ["Scheduled supplier payments (creditors due)", report.scheduledSupplierPayments],
          ["Upcoming creditor payments (estimate)", report.upcomingCreditorPaymentsEstimate],
          ["Payroll / salary payments", report.payrollPayments],
          ["Net cash movement", report.netCashMovement],
          ["Opening balance (placeholder)", report.openingCashPlaceholder],
          ["Closing balance (placeholder)", report.closingCashPlaceholder],
        ].map(([label, amount], idx) => (
          <tr key={String(label)}>
            <td style={{ ...td, fontWeight: idx === 5 || idx === 7 ? 900 : 600 }}>{label}</td>
            <td style={{ ...tdRight, fontWeight: idx === 5 || idx === 7 ? 900 : 600 }}>
              {formatMoney(amount as number)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderTrialBalance = () => (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
      <thead>
        <tr>
          {["Account", "Debit", "Credit", "Balance"].map((h) => (
            <th key={h} style={h === "Account" ? th : { ...th, textAlign: "right" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {report.trialRows.length === 0 ? (
          <tr>
            <td colSpan={4} style={{ ...td, textAlign: "center", color: "#64748b" }}>
              No trial balance lines for this period.
            </td>
          </tr>
        ) : (
          report.trialRows.map((row) => (
            <tr key={row.account}>
              <td style={td}>{row.account}</td>
              <td style={tdRight}>{row.debit > 0 ? formatMoney(row.debit) : "—"}</td>
              <td style={tdRight}>{row.credit > 0 ? formatMoney(row.credit) : "—"}</td>
              <td style={{ ...tdRight, fontWeight: 800 }}>{formatMoney(row.balance)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  const renderBalanceSheet = () => (
    <>
      <h3 style={{ margin: "0 0 12px", fontWeight: 900 }}>Assets</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {[
            ["Bank / Cash (estimated)", report.bankCashEstimate],
            ["Debtors (billing outstanding)", report.debtorsOutstanding],
            ["Fixed assets at book value (gross)", report.fixedAssetsGross],
            ["Accumulated depreciation", report.accumulatedDepreciation],
            ["Net fixed asset value", report.fixedAssetsNetBook],
            ["Total Assets", report.totalAssets],
          ].map(([label, amount], idx) => (
            <tr key={String(label)}>
              <td style={{ ...td, fontWeight: idx === 5 ? 900 : 600 }}>{label}</td>
              <td style={{ ...tdRight, fontWeight: idx === 5 ? 900 : 600 }}>
                {formatMoney(amount as number)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ margin: "0 0 12px", fontWeight: 900 }}>Liabilities</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {[
            ["Supplier payables", report.supplierPayables],
            ["Overdue supplier payables", report.overdueSupplierPayables],
            ["Payment plan commitments", report.paymentPlanCommitments],
            ["Payroll liabilities", report.payrollLiabilitiesTotal],
            ["PAYE liabilities", report.payeLiabilities],
            ["Tax liabilities (placeholder)", 0],
            ["Total Liabilities", report.totalLiabilities],
          ].map(([label, amount], idx) => (
            <tr key={String(label)}>
              <td style={{ ...td, fontWeight: idx === 5 ? 900 : 600 }}>{label}</td>
              <td style={{ ...tdRight, fontWeight: idx === 5 ? 900 : 600 }}>
                {formatMoney(amount as number)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ margin: "0 0 12px", fontWeight: 900 }}>Equity</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {[
            ["Opening balance (placeholder)", 0],
            ["Current year surplus / deficit", report.equitySurplus],
          ].map(([label, amount], idx) => (
            <tr key={String(label)}>
              <td style={{ ...td, fontWeight: idx === 1 ? 900 : 600 }}>{label}</td>
              <td style={{ ...tdRight, fontWeight: idx === 1 ? 900 : 600 }}>
                {formatMoney(amount as number)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const renderStatementBody = () => {
    if (statementType === "income") return renderIncomeStatement();
    if (statementType === "cashflow") return renderCashFlow();
    if (statementType === "trial-balance") return renderTrialBalance();
    return renderBalanceSheet();
  };

  return (
    <div style={accountingPageWrap}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={accountingTitle}>Financial Statements</h1>
        <p style={accountingSubtitle}>
          Generate school-ready management and audit statement reports.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Reporting basis
          <select
            style={{ ...fieldStyle, minWidth: 240 }}
            value={reportingBasis}
            onChange={(e) => setReportingBasis(e.target.value as ReportingBasis)}
          >
            {REPORTING_BASIS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          {reportingBasisYearLabel(reportingBasis)}
          <select style={fieldStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {reportingBasis === "sars" ? `Feb ${y}` : y}
              </option>
            ))}
          </select>
        </label>
        {reportingBasis === "month" ? (
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
            Month
            <select
              style={fieldStyle}
              value={monthIndex}
              onChange={(e) => setMonthIndex(Number(e.target.value))}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK, paddingBottom: 10 }}>
          Period: {periodLabel}
        </div>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Statement type
          <select
            style={{ ...fieldStyle, minWidth: 220 }}
            value={statementType}
            onChange={(e) => setStatementType(e.target.value as StatementType)}
          >
            {STATEMENT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={goldBtn} onClick={handleGenerate}>
          Generate
        </button>
        <button type="button" style={outlineBtn} onClick={handlePrint}>
          Print
        </button>
        <button type="button" style={outlineBtn} onClick={handleExportPdf}>
          Export PDF
        </button>
        <button type="button" style={outlineBtn} onClick={handleExportExcel}>
          Export Excel
        </button>
      </div>

      {exportBanner ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fffbeb",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            color: "#92400e",
            fontWeight: 700,
          }}
        >
          {exportBanner}
        </div>
      ) : null}

      <div style={statementsSummaryGrid}>
        {[
          ["Income", report.totalIncome],
          ["Expenses", report.totalExpenses],
          ["Net Surplus / Deficit", report.netSurplus],
          ["Cash Movement", report.netCashMovement],
          ["Fixed assets (net)", report.fixedAssetsNetBook],
          ["Depreciation expense", report.depreciationExpense],
          ["Assets", report.totalAssets],
          ["Liabilities", report.totalLiabilities],
        ].map(([label, value]) => (
          <div key={String(label)} style={statementsSummaryCard}>
            <div style={statementsSummaryLabel}>{label}</div>
            <div style={statementsSummaryValueWrap}>
              <div style={statementsSummaryValue}>{formatMoney(value as number)}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        ref={previewRef}
        id="financial-statement-preview"
        style={{
          ...accountingCard,
          padding: "28px 32px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
            paddingBottom: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: ACCOUNTING_INK }}>{schoolName}</div>
          <div style={{ fontSize: 14, color: "#64748b", marginTop: 6, fontWeight: 600 }}>
            {statementTitle(statementType)} · {periodLabel}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
            Generated: {displayGeneratedAt}
          </div>
        </div>

        {renderStatementBody()}

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #e5e7eb",
            fontSize: 12,
            color: "#64748b",
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            Management statement based on approved expenses, billing receipts, and asset depreciation from
            Accounting Assets.
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>
            Asset depreciation feeds Financial Statements automatically. Disposed assets remain available for
            audit history.
          </p>
          <p style={{ margin: 0 }}>
            Final audited financial statements must be reviewed by the school&apos;s accountant/auditor.
          </p>
        </div>
        <div
          style={{
            marginTop: 16,
            fontWeight: 900,
            color: ACCOUNTING_GOLD,
            fontSize: 13,
          }}
        >
          Prepared by EduClear Accounting
        </div>
      </div>
    </div>
  );
}
