export const BILLING_REPORT_LIST = [
  { id: "account-list-status", name: "Account List (Account Status)" },
  { id: "account-list-contact", name: "Account List (Account Status) (Contact)" },
  { id: "account-list-age", name: "Account List (Age Analysis)" },
  { id: "billing-plan-child", name: "Billing Plan Summary By Child" },
  { id: "billing-plan-fee", name: "Billing Plan Summary By Fee" },
  { id: "deposit-list", name: "Deposit List" },
  { id: "deposit-transaction-list", name: "Deposit Transaction List" },
  { id: "payment-receive-list", name: "Payment Receive List" },
  { id: "payments-by-type", name: "Payments By Type" },
  { id: "sibling-accounts", name: "Sibling Accounts" },
  { id: "transaction-list", name: "Transaction List" },
] as const;

export type BillingReportId = (typeof BILLING_REPORT_LIST)[number]["id"];

export type BillingReportConfig = {
  groupBy: string;
  sortBy: string;
  show: string;
  includeInactiveAccounts: boolean;
};

export const DEFAULT_BILLING_REPORT_CONFIG: BillingReportConfig = {
  groupBy: "Grade",
  sortBy: "Name",
  show: "All Accounts",
  includeInactiveAccounts: false,
};

const COMMON_GROUP = ["None", "Grade", "Class", "Account Status", "Family Account"];
const COMMON_SORT = ["Name", "Surname", "Account No", "Balance"];
const COMMON_SHOW = [
  "All Accounts",
  "With Balance",
  "Up To Date",
  "Recently Owing",
  "Bad Debt",
  "Over Paid",
];

const DEPOSIT_GROUP = ["None", "Status", "Account", "Date"];
const DEPOSIT_SORT = ["Date", "Account", "Amount", "Deposit No"];
const DEPOSIT_SHOW = ["All Deposits", "Active", "Allocated", "With Balance"];

const TX_GROUP = ["None", "Type", "Account", "Month"];
const TX_SORT = ["Date", "Account", "Amount", "Reference"];
const TX_SHOW = ["All Transactions", "Invoices", "Payments", "Credits", "Penalties"];

const PAYMENT_GROUP = ["None", "Payment Type", "Account", "Month"];
const PAYMENT_SORT = ["Date", "Account", "Amount", "Reference"];
const PAYMENT_SHOW = ["All Payments", "This Month", "Last 30 Days", "This Year"];

const RECEIVE_LIST_GROUP = ["Classroom", "Grade", "Account Status"];
const RECEIVE_LIST_SORT = ["Name", "Account No", "Balance"];
const RECEIVE_LIST_SHOW = ["All Balances", "Credits Only", "Debits Only"];

export const DEFAULT_PAYMENT_RECEIVE_LIST_CONFIG: BillingReportConfig = {
  groupBy: "Classroom",
  sortBy: "Name",
  show: "All Balances",
  includeInactiveAccounts: false,
};

export type ReportFieldOptions = {
  groupBy: string[];
  sortBy: string[];
  show: string[];
};

export function getReportFieldOptions(reportId: BillingReportId): ReportFieldOptions {
  if (reportId === "deposit-list" || reportId === "deposit-transaction-list") {
    return { groupBy: DEPOSIT_GROUP, sortBy: DEPOSIT_SORT, show: DEPOSIT_SHOW };
  }
  if (reportId === "transaction-list") {
    return { groupBy: TX_GROUP, sortBy: TX_SORT, show: TX_SHOW };
  }
  if (reportId === "payment-receive-list") {
    return { groupBy: RECEIVE_LIST_GROUP, sortBy: RECEIVE_LIST_SORT, show: RECEIVE_LIST_SHOW };
  }
  if (reportId === "payments-by-type") {
    return { groupBy: PAYMENT_GROUP, sortBy: PAYMENT_SORT, show: PAYMENT_SHOW };
  }
  if (reportId === "billing-plan-fee") {
    return {
      groupBy: ["None", "Fee Type", "Fee Name"],
      sortBy: ["Fee Name", "Count", "Total Amount"],
      show: ["All Fees", "With Amount", "Zero Amount"],
    };
  }
  if (reportId === "billing-plan-child") {
    return {
      groupBy: ["None", "Grade", "Class"],
      sortBy: ["Name", "Surname", "Account No", "Plan Total"],
      show: COMMON_SHOW,
    };
  }
  if (reportId === "sibling-accounts") {
    return {
      groupBy: ["None", "Family Account"],
      sortBy: ["Account No", "Learner Count", "Balance"],
      show: COMMON_SHOW,
    };
  }
  return { groupBy: COMMON_GROUP, sortBy: COMMON_SORT, show: COMMON_SHOW };
}

export function reportTitle(reportId: BillingReportId): string {
  return BILLING_REPORT_LIST.find((r) => r.id === reportId)?.name || "Billing Report";
}
