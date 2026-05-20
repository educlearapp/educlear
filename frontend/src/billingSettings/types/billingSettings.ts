export type BillingSettingsTab = "general" | "statement" | "invoice" | "receipt" | "journal";

export type CheckboxMap = Record<string, boolean>;

export type DocumentDisplayFields = {
  schoolName: boolean;
  schoolLogo: boolean;
  payingAddress: boolean;
  childClassroom: boolean;
};

export type StatementDisplayFields = DocumentDisplayFields;

export type InvoiceDisplayFields = DocumentDisplayFields & {
  dueDate: boolean;
};

export type ReceiptDisplayFields = {
  schoolName: boolean;
  schoolLogo: boolean;
};

export type MessageFields = {
  standardMessage: string;
  standardEmailSubject: string;
  standardEmailMessage: string;
  standardSmsMessage: string;
};

export type BillingGeneralSettings = {
  accountStyle: string;
  showAmounts: string;
  quickPopups: CheckboxMap;
  accountsInfoBlocks: CheckboxMap;
  invoicesInfoBlocks: CheckboxMap;
  paymentsInfoBlocks: CheckboxMap;
  corrections: CheckboxMap;
};

export type BillingStatementSettings = {
  statementLayout: string;
  statementHistory: string;
  statementFeatures: CheckboxMap;
  showAmounts: string;
  displayOnStatement: StatementDisplayFields;
} & MessageFields;

export type BillingInvoiceSettings = {
  defaultInvoicePage: string;
  invoiceLayout: string;
  displayOnInvoice: InvoiceDisplayFields;
  dueDate: string;
  invoiceFeatures: CheckboxMap;
  invoicePrefix: string;
  /** School-configured late payment fine amount (0 = not set). */
  latePenaltyAmount: number;
  termsAndConditions: string;
} & MessageFields;

export type BillingReceiptSettings = {
  defaultPaymentPage: string;
  receiptLayout: string;
  displayOnReceipt: ReceiptDisplayFields;
  receiptFeatures: CheckboxMap;
  footerMessage: string;
} & MessageFields;

export type BillingSettingsState = {
  general: BillingGeneralSettings;
  statement: BillingStatementSettings;
  invoice: BillingInvoiceSettings;
  receipt: BillingReceiptSettings;
};
