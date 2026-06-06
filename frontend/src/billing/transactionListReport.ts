import {
  exportPayloadCsv,
  payloadFromTable,
  resolveExportBranding,
} from "../accounting/accountingExportEngine";
import { fetchTransactionListExport, type TransactionListExportResponse } from "./billingApi";
import type { GeneratedBillingReport } from "./billingReportsEngine";
import { reportTitle } from "./billingReportDefinitions";

export type TransactionListTypeFilter =
  | "All"
  | "Payments"
  | "Invoices"
  | "Credits"
  | "Penalties";

export type TransactionListDateSelection =
  | "Today"
  | "This Month"
  | "Last Month"
  | "Custom Dates";

export type TransactionListConfig = {
  type: TransactionListTypeFilter;
  dateSelection: TransactionListDateSelection;
  customFrom: string;
  customTo: string;
  hideCorrections: boolean;
};

export const DEFAULT_TRANSACTION_LIST_CONFIG: TransactionListConfig = {
  type: "All",
  dateSelection: "This Month",
  customFrom: "",
  customTo: "",
  hideCorrections: false,
};

export const TRANSACTION_LIST_TYPE_OPTIONS: TransactionListTypeFilter[] = [
  "All",
  "Payments",
  "Invoices",
  "Credits",
  "Penalties",
];

export const TRANSACTION_LIST_DATE_OPTIONS: TransactionListDateSelection[] = [
  "Today",
  "This Month",
  "Last Month",
  "Custom Dates",
];

function formatExportMoney(amount: number): string {
  const n = Math.abs(Number(amount));
  if (!Number.isFinite(n)) return "R 0.00";
  return `R ${n.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function validateTransactionListConfig(config: TransactionListConfig): string | null {
  if (config.dateSelection !== "Custom Dates") return null;
  if (!String(config.customFrom || "").trim()) return "From Date is required for Custom Dates.";
  if (!String(config.customTo || "").trim()) return "To Date is required for Custom Dates.";
  if (config.customFrom > config.customTo) return "From Date must be on or before To Date.";
  return null;
}

export function transactionListPeriodLabel(config: TransactionListConfig): string {
  if (config.dateSelection === "Custom Dates") {
    return `${config.customFrom} – ${config.customTo}`;
  }
  return config.dateSelection;
}

export function mapTransactionListToReport(
  data: TransactionListExportResponse,
  config: TransactionListConfig
): GeneratedBillingReport {
  const columns = [
    "Date",
    "Type",
    "Account Number",
    "Account Holder",
    "Learner(s)",
    "Description",
    "Reference / Receipt Number",
    "Amount",
    "Source",
    "Created At",
  ];

  const rows = (data.rows || []).map((row) => [
    row.date,
    row.type,
    row.accountNo,
    row.accountHolder,
    row.learners,
    row.description,
    row.reference,
    formatExportMoney(row.amount),
    row.source,
    row.createdAt,
  ]);

  return {
    reportId: "transaction-list",
    title: reportTitle("transaction-list"),
    columns,
    rows,
    generatedAt: data.generatedAt || new Date().toISOString(),
    summary: [
      { label: "Type", value: config.type },
      { label: "Date Range", value: `${data.fromDate} – ${data.toDate}` },
      { label: "Transactions", value: String(data.count) },
      {
        label: "Total Amount",
        value: formatExportMoney(data.totalAmount),
      },
    ],
  };
}

export async function generateTransactionListReport(
  schoolId: string,
  config: TransactionListConfig
): Promise<GeneratedBillingReport> {
  const validationError = validateTransactionListConfig(config);
  if (validationError) throw new Error(validationError);

  const data = await fetchTransactionListExport(schoolId, config);
  return mapTransactionListToReport(data, config);
}

export function exportTransactionListCsv(
  report: GeneratedBillingReport,
  schoolName: string,
  periodLabel: string
) {
  exportPayloadCsv(
    payloadFromTable(
      resolveExportBranding(schoolName),
      report.title,
      periodLabel,
      new Date(report.generatedAt).toLocaleString("en-ZA"),
      { columns: report.columns, rows: report.rows },
      report.summary
    )
  );
}
