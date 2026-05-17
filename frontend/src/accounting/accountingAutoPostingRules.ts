import { normalizeExpenseCategory } from "./accountingExpenseStorage";

export type AutoPostingTransactionType =
  | "billing_payment"
  | "expense_approval"
  | "bank_charge"
  | "payroll"
  | "supplier_payment";

export type AutoPostingRule = {
  transactionType: AutoPostingTransactionType;
  debitAccountCode: string;
  creditAccountCode: string;
  descriptionTemplate: string;
  enabled: boolean;
};

/** Standard account codes (must exist in Chart of Accounts). */
export const COA_CODES = {
  bank: "1000",
  schoolFeesIncome: "4000",
  bankChargesExpense: "5700",
  electricity: "5100",
  fuel: "5120",
  stationery: "5300",
  otherExpense: "5900",
} as const;

export const DEFAULT_AUTO_POSTING_RULES: AutoPostingRule[] = [
  {
    transactionType: "billing_payment",
    debitAccountCode: COA_CODES.bank,
    creditAccountCode: COA_CODES.schoolFeesIncome,
    descriptionTemplate: "School fee payment received — {accountNo}",
    enabled: true,
  },
  {
    transactionType: "expense_approval",
    debitAccountCode: COA_CODES.otherExpense,
    creditAccountCode: COA_CODES.bank,
    descriptionTemplate: "Expense approved — {category}",
    enabled: true,
  },
  {
    transactionType: "bank_charge",
    debitAccountCode: COA_CODES.bankChargesExpense,
    creditAccountCode: COA_CODES.bank,
    descriptionTemplate: "Bank charge — {reference}",
    enabled: true,
  },
  {
    transactionType: "payroll",
    debitAccountCode: "5000",
    creditAccountCode: COA_CODES.bank,
    descriptionTemplate: "Payroll — {reference}",
    enabled: false,
  },
  {
    transactionType: "supplier_payment",
    debitAccountCode: "2000",
    creditAccountCode: COA_CODES.bank,
    descriptionTemplate: "Supplier payment — {reference}",
    enabled: false,
  },
];

const EXPENSE_CATEGORY_TO_ACCOUNT: Record<string, string> = {
  electricity: COA_CODES.electricity,
  water: "5110",
  fuel: COA_CODES.fuel,
  "repairs & maintenance": "5200",
  stationery: COA_CODES.stationery,
  "food / tuckshop": "5400",
  insurance: "5500",
  marketing: "5600",
  "bank charges": COA_CODES.bankChargesExpense,
  "sars / uif": "5800",
  salaries: "5000",
  "rent / bond": "5900",
  other: COA_CODES.otherExpense,
};

export function getRule(transactionType: AutoPostingTransactionType): AutoPostingRule | undefined {
  return DEFAULT_AUTO_POSTING_RULES.find((r) => r.transactionType === transactionType);
}

export function getExpenseDebitAccountCode(category: string): string {
  const key = normalizeExpenseCategory(category);
  if (key === "bank charges") return COA_CODES.bankChargesExpense;
  return EXPENSE_CATEGORY_TO_ACCOUNT[key] || COA_CODES.otherExpense;
}

export function isBankChargeCategory(category: string): boolean {
  return normalizeExpenseCategory(category) === "bank charges";
}

export function applyDescriptionTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? "").trim());
}
