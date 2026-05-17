import { formatMoney, getBillingRows } from "../billing/billingLedger";
import { buildFinancialReport, buildPrintHtml, type StatementType } from "./AccountingFinancialStatements";
import {
  loadAssets,
  calculateDepreciationTotals,
  calculateBookValueTotals,
  computeAssetDepreciation,
} from "./accountingAssetStorage";
import {
  buildCreditorAgeingRows,
  calculateCreditorTotals,
  loadCreditorInvoices,
  loadCreditorPaymentPlans,
} from "./accountingCreditorsHelpers";
import {
  buildDebtorAgeingRows,
  loadLegalHandovers,
  loadPaymentArrangements,
} from "./accountingDebtorsHelpers";
import {
  filterApprovedExpensesForMonth,
  loadApprovedExpenses,
  sumApprovedExpensesByCategory,
  totalApprovedSpendForMonth,
} from "./accountingExpenseStorage";
import { loadPostedGeneralLedger, filterLedgerRows } from "./accountingLedgerHelpers";
import { loadActiveCoaAccounts, loadJournalStore } from "./accountingJournalStorage";
import {
  dateInReportingRange,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";
import {
  buildAuditPackPayload,
  buildReportHtml,
  formatExportMoney,
  payloadFromTable,
  resolveExportBranding,
  type AccountingExportPayload,
  type ExportReportType,
} from "./accountingExportEngine";

export type CollectExportInput = {
  schoolId: string;
  learners: any[];
  schoolName?: string;
  reportType: ExportReportType;
  reportingBasis: ReportingBasis;
  year: number;
  monthIndex: number;
};

function statementTypeForReport(reportType: ExportReportType): StatementType {
  if (reportType === "income-statement") return "income";
  if (reportType === "balance-sheet") return "balance-sheet";
  if (reportType === "cash-flow") return "cashflow";
  if (reportType === "trial-balance") return "trial-balance";
  return "income";
}

function reportTitleForType(reportType: ExportReportType): string {
  const map: Record<ExportReportType, string> = {
    "financial-statements": "Financial Statements",
    "income-statement": "Income Statement",
    "balance-sheet": "Balance Sheet",
    "cash-flow": "Cash Flow Statement",
    "trial-balance": "Trial Balance",
    "general-ledger": "General Ledger",
    journals: "Journals",
    "debtors-ageing": "Debtors Ageing",
    "creditors-ageing": "Creditors Ageing",
    "assets-register": "Assets Register",
    "depreciation-schedule": "Depreciation Schedule",
    "budget-vs-actual": "Budget vs Actual",
    "management-reports": "Management Reports",
    "audit-pack": "Audit Pack Checklist",
  };
  return map[reportType] || "Accounting Report";
}

export function collectAccountingExportPayload(input: CollectExportInput): AccountingExportPayload {
  const { schoolId, learners, reportType, reportingBasis, year, monthIndex } = input;
  const period = resolveReportingPeriod(reportingBasis, year, monthIndex);
  const periodLabel = period.label;
  const generatedAt = new Date().toLocaleString("en-ZA");
  const branding = resolveExportBranding(input.schoolName);
  const title = reportTitleForType(reportType);
  const sid = String(schoolId || "").trim();

  if (reportType === "audit-pack") {
    const statementRows = sid ? getBillingRows(learners, sid) : [];
    const outstanding = statementRows
      .filter((r) => Number(r.balance) > 0)
      .reduce((s, r) => s + Number(r.balance), 0);
    const journals = sid ? loadJournalStore(sid) : { journals: [], audit: [] };
    const assets = sid ? loadAssets(sid) : [];
    const activeAssets = assets.filter((a) => a.status !== "Disposed");
    const creditorTotals = sid ? calculateCreditorTotals(sid, period.endDate) : null;
    const details = [
      `Income Statement — billing and expenses data for ${periodLabel}`,
      `Balance Sheet — includes fixed assets from register`,
      `Trial Balance — available via Financial Statements`,
      `General Ledger — ${journals.journals.length} journal(s) on file`,
      `Journals — ${journals.journals.filter((j) => j.status === "Posted").length} posted`,
      `Debtors Ageing — ${formatMoney(outstanding)} outstanding`,
      creditorTotals
        ? `Creditors Ageing — ${formatMoney(creditorTotals.supplierPayables)} payables`
        : "Creditors Ageing — no creditor data",
        `Asset Register — ${activeAssets.length} active asset(s)`,
      `Depreciation Schedule — ${formatMoney(calculateDepreciationTotals(assets, period.depreciationYear).expenseForYear)} for ${period.depreciationYear}`,
      `Bank Reconciliation — use Banking module imports`,
      `Budget vs Actual — use Budget module`,
    ];
    return buildAuditPackPayload(branding, periodLabel, generatedAt, details);
  }

  if (
    reportType === "financial-statements" ||
    reportType === "income-statement" ||
    reportType === "balance-sheet" ||
    reportType === "cash-flow" ||
    reportType === "trial-balance"
  ) {
    const stmt = statementTypeForReport(reportType);
    const report = buildFinancialReport(sid, learners, period);
    const fullDocumentHtml = buildPrintHtml({
      schoolName: branding.schoolName,
      periodLabel,
      generatedAt,
      statementType: stmt,
      report,
    });
    return {
      reportTitle: title,
      reportType,
      periodLabel,
      generatedAt,
      branding,
      sections: [],
      fullDocumentHtml,
      notes: ["Use Print or Export PDF to save this statement."],
    };
  }

  if (reportType === "general-ledger") {
    const coa = sid ? loadActiveCoaAccounts(sid) : [];
    const rows = sid
      ? filterLedgerRows(loadPostedGeneralLedger(sid, coa), {
          schoolId: sid,
          startDate: period.startDate,
          endDate: period.endDate,
          accountCode: "",
          search: "",
          groupByType: false,
        })
      : [];
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      {
        columns: ["Date", "Account", "Description", "Reference", "Debit", "Credit", "Balance"],
        rows: rows.map((r) => [
          r.date,
          `${r.accountCode} ${r.accountName}`,
          r.description,
          r.reference || "",
          r.debit ? formatExportMoney(r.debit) : "",
          r.credit ? formatExportMoney(r.credit) : "",
          formatExportMoney(r.runningBalance),
        ]),
      },
      [{ label: "Lines", value: String(rows.length) }]
    );
  }

  if (reportType === "journals") {
    const store = sid ? loadJournalStore(sid) : { journals: [], audit: [] };
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      {
        columns: ["Journal No", "Date", "Description", "Status", "Debit", "Credit"],
        rows: store.journals.map((j) => {
          const totals = j.lines.reduce(
            (acc, line) => {
              acc.debit += Number(line.debit) || 0;
              acc.credit += Number(line.credit) || 0;
              return acc;
            },
            { debit: 0, credit: 0 }
          );
          return [
            j.journalNo,
            j.date,
            j.description,
            j.status,
            formatExportMoney(totals.debit),
            formatExportMoney(totals.credit),
          ];
        }),
      },
      [
        { label: "Total journals", value: String(store.journals.length) },
        { label: "Posted", value: String(store.journals.filter((j) => j.status === "Posted").length) },
      ]
    );
  }

  if (reportType === "debtors-ageing") {
    const statementRows = sid ? getBillingRows(learners, sid) : [];
    const rows = sid
      ? buildDebtorAgeingRows({
          schoolId: sid,
          learners,
          statementRows,
          legalHistory: [],
          arrangements: loadPaymentArrangements(sid),
          handovers: loadLegalHandovers(sid),
          asOfDate: period.endDate,
        })
      : [];
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      {
        columns: [
          "Account",
          "Learner",
          "Parent",
          "Balance",
          "Current",
          "30 Days",
          "60 Days",
          "90 Days",
          "120+",
          "Status",
        ],
        rows: rows.map((r) => [
          r.accountNo,
          r.learnerName,
          r.parentName,
          formatExportMoney(r.outstandingBalance),
          formatExportMoney(r.ageing.current),
          formatExportMoney(r.ageing.days30),
          formatExportMoney(r.ageing.days60),
          formatExportMoney(r.ageing.days90),
          formatExportMoney(r.ageing.days120Plus),
          r.displayStatus,
        ]),
      },
      [{ label: "Accounts", value: String(rows.length) }]
    );
  }

  if (reportType === "creditors-ageing") {
    const invoices = sid ? loadCreditorInvoices(sid) : [];
    const plans = sid ? loadCreditorPaymentPlans(sid) : [];
    const rows = buildCreditorAgeingRows({ invoices, plans, asOfDate: period.endDate });
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      {
        columns: ["Supplier", "Category", "Outstanding", "Open invoices", "Overdue", "Status", "Next due"],
        rows: rows.map((r) => [
          r.supplierName,
          r.category,
          formatExportMoney(r.outstandingBalance),
          String(r.openInvoiceCount),
          String(r.disputedCount),
          r.displayStatus,
          r.nextDueDate || "—",
        ]),
      },
      [{ label: "Suppliers", value: String(rows.length) }]
    );
  }

  if (reportType === "assets-register" || reportType === "depreciation-schedule") {
    const assets = sid ? loadAssets(sid) : [];
    const active = assets.filter((a) => a.status !== "Disposed");
    const dep = calculateDepreciationTotals(active, period.depreciationYear);
    const book = calculateBookValueTotals(active);
    if (reportType === "depreciation-schedule") {
      return payloadFromTable(
        branding,
        title,
        periodLabel,
        generatedAt,
        {
          columns: ["Asset", "Category", "Method", "Annual depreciation", "Accumulated", "Net book"],
          rows: active.map((a) => {
            const d = computeAssetDepreciation(
              a,
              new Date(`${period.depreciationYear}-12-31T12:00:00`)
            );
            return [
              a.name,
              a.category,
              a.depreciationMethod,
              formatExportMoney(d.annualDepreciation),
              formatExportMoney(d.accumulatedDepreciation),
              formatExportMoney(d.bookValue),
            ];
          }),
        },
        [
          { label: "Depreciation expense (year)", value: formatExportMoney(dep.expenseForYear) },
          { label: "Net book value", value: formatExportMoney(book.netBookValue) },
        ]
      );
    }
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      {
        columns: ["Asset", "Category", "Purchase date", "Cost", "Net book", "Location", "Status"],
        rows: active.map((a) => [
          a.name,
          a.category,
          a.purchaseDate || "—",
          formatExportMoney(a.purchaseCost),
          formatExportMoney(a.currentBookValue || 0),
          a.location || "—",
          a.status || "Active",
        ]),
      },
      [
        { label: "Active assets", value: String(active.length) },
        { label: "Total net book", value: formatExportMoney(book.netBookValue) },
      ]
    );
  }

  if (reportType === "budget-vs-actual") {
    const approved = sid ? loadApprovedExpenses(sid) : [];
    const spend =
      reportingBasis === "month"
        ? sumApprovedExpensesByCategory(approved, year, monthIndex)
        : sumApprovedExpensesByCategory(approved, year, monthIndex);
    const actualTotal =
      reportingBasis === "month"
        ? totalApprovedSpendForMonth(approved, year, monthIndex)
        : approved
            .filter((r) => dateInReportingRange(r.date, period.startDate, period.endDate))
            .reduce((s, r) => s + Number(r.amount), 0);
    const rows = Array.from(spend.totals.entries()).map(([key, amount]) => [
      spend.labels.get(key) || key,
      formatExportMoney(amount),
    ]);
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      { columns: ["Category", "Actual spend"], rows },
      [{ label: "Total actual", value: formatExportMoney(actualTotal) }]
    );
  }

  if (reportType === "management-reports") {
    const statementRows = sid ? getBillingRows(learners, sid) : [];
    const outstanding = statementRows
      .filter((r) => Number(r.balance) > 0)
      .reduce((s, r) => s + Number(r.balance), 0);
    const approved =
      reportingBasis === "month" && sid
        ? filterApprovedExpensesForMonth(loadApprovedExpenses(sid), year, monthIndex)
        : [];
    const expenses = approved.reduce((s, r) => s + Number(r.amount), 0);
    return payloadFromTable(
      branding,
      title,
      periodLabel,
      generatedAt,
      {
        columns: ["Metric", "Value"],
        rows: [
          ["Outstanding debtors", formatExportMoney(outstanding)],
          ["Approved expenses (period)", formatExportMoney(expenses)],
          ["Learner accounts", String(statementRows.length)],
        ],
      }
    );
  }

  return payloadFromTable(branding, title, periodLabel, generatedAt, {
    columns: ["Note"],
    rows: [["No data for this report type."]],
  });
}

export function previewHtmlForPayload(payload: AccountingExportPayload) {
  return buildReportHtml(payload);
}
