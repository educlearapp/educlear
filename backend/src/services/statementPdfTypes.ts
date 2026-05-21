export type StatementPdfTransaction = {
  date: string;
  type: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number;
  learner?: string;
};

export type StatementPdfContact = {
  name: string;
  email: string;
  relationship: string;
};

export type StatementPdfSchoolBranding = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
};

export type StatementPdfInput = {
  school: StatementPdfSchoolBranding;
  accountNo: string;
  accountLabel: string;
  children: { name: string; grade: string }[];
  contact: StatementPdfContact | null;
  period: string;
  statementDate: string;
  balance: number;
  transactions: StatementPdfTransaction[];
  statementNote?: string;
  isFamilyAccount: boolean;
};

export type BuildStatementPdfOptions = {
  schoolId: string;
  learnerId: string;
  period?: string;
  statementNote?: string;
};
