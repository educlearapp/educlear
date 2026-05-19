export type DepositStatus =
  | "ACTIVE"
  | "PARTIALLY_ALLOCATED"
  | "FULLY_ALLOCATED"
  | "REFUNDED"
  | "VOID";

export type DepositAllocation = {
  id: string;
  ledgerInvoiceId: string;
  invoiceReference: string;
  invoiceDate: string;
  amount: number;
  createdAt: string;
};

export type DepositHistoryEntry = {
  id: string;
  action: string;
  amount: number | null;
  description: string;
  metadata: unknown;
  createdAt: string;
};

export type DepositRecord = {
  id: string;
  depositNumber: string;
  schoolId: string;
  familyAccountId: string | null;
  learnerId: string;
  accountNo: string;
  account: string;
  learnerName: string;
  amount: number;
  remainingBalance: number;
  status: DepositStatus;
  statusLabel: string;
  reference: string;
  notes: string;
  date: string;
  depositDate: string;
  createdAt: string;
  updatedAt: string;
  allocations?: DepositAllocation[];
  history?: DepositHistoryEntry[];
};

export type OpenInvoice = {
  id: string;
  ledgerInvoiceId: string;
  invoiceReference: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  description: string;
};

export type DepositAccountOption = {
  familyAccountId: string;
  accountNo: string;
  label: string;
};

export type DepositLearnerOption = {
  id: string;
  familyAccountId: string | null;
  accountNo: string;
  label: string;
};
