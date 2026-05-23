export type DaSilvaMigrationTotals = {
  totalLearners: number;
  totalParents: number;
  totalClasses: number;
  totalInvoices: number;
  totalPayments: number;
  totalInvoiceAmount: number;
  totalPaymentAmount: number;
  totalOutstandingBalance: number;
};

export type DaSilvaCountValidation = {
  learnersFromClassList: number;
  learnersFromContactList: number;
  learnersFromBillingPlan: number;
  billingAccountsFromAgeAnalysis: number;
  countsMatch: boolean;
  errors: string[];
};

export type DaSilvaReconciliationRow = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  variance: number;
};

export type DaSilvaMigrationPreview = {
  success: boolean;
  projectId: string;
  schoolId?: string;
  dryRun: boolean;
  canImport: boolean;
  confirmToken: string;
  countValidation: DaSilvaCountValidation;
  reconciliation: {
    rows: DaSilvaReconciliationRow[];
    totals: DaSilvaMigrationTotals;
  };
  summary: DaSilvaMigrationTotals;
};

export type DaSilvaFileSlots = {
  classListFiles: File[];
  contactList: File | null;
  employees: File | null;
  billingPlan: File | null;
  ageAnalysis: File | null;
  transactions: File | null;
};
