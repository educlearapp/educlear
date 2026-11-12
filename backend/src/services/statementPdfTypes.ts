import type { BillingInvoiceChargeLine, BillingLedgerEntry } from "../utils/billingLedgerStore";
import type { KidesysHistoryEntry } from "../utils/kidesysTransactionHistoryStore";

export type StatementPdfTransactionSection = "historical" | "brought-forward" | "active";

export type StatementPdfTransaction = {
  date: string;
  type: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number | null;
  learner?: string;
  /** Present only when the ledger invoice stored an immutable charge-line snapshot. */
  chargeLines?: BillingInvoiceChargeLine[];
  /** Optional section marker for B1 Age Analysis assembly (historical / BBF / active). */
  statementSection?: StatementPdfTransactionSection;
  /** Chronological build sequence for stable same-day ordering (PDF ascending). */
  chronoSeq?: number;
};

export type StatementPdfContact = {
  name: string;
  email?: string;
  cellphone?: string;
  relationship: string;
  accountNo: string;
};

export type StatementPdfSchoolBranding = {
  name: string;
  email?: string;
  phone?: string;
  cellNo?: string;
  address?: string;
  postalAddress?: string;
  logoUrl?: string;
  /** Freeform school banking / payment instructions (footer). */
  bankingDetails?: string;
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
  /**
   * Existing period opening from computeStatementOpeningBalance (presentation passthrough).
   * Displayed as Balance Brought Forward when includeBroughtForward is true.
   */
  openingBalance?: number;
  /** When true, render a BBF display row for selected (non–All Time) periods. */
  includeBroughtForward?: boolean;
  /** Label for the brought-forward display row. */
  broughtForwardLabel?: string;
};

/**
 * Closing-balance source for the statement PDF header box.
 * - age-analysis: current Age Analysis snapshot (legacy individual Statement Manage / print).
 * - period-ledger: opening + in-period ledger net (period-end identity; required for bulk).
 */
export type StatementClosingBalanceSource = "age-analysis" | "period-ledger";

export type BuildStatementPdfOptions = {
  schoolId: string;
  /** Optional when accountNo (Kid-e-Sys accountRef) is supplied. */
  learnerId?: string;
  /** Kid-e-Sys billing identity (FamilyAccount.accountRef). Preferred over learnerId. */
  accountNo?: string;
  /**
   * Explicit FamilyAccount primary key. Preferred for family billing accounts
   * (including zero-learner migrated accounts). Never send this as learnerId.
   */
  familyAccountId?: string;
  /** Optional typed identity envelope (accountIdentity.type / .value). */
  accountIdentityType?: "familyAccountId" | "accountRef" | "accountNo" | "learnerId";
  accountIdentityValue?: string;
  period?: string;
  statementNote?: string;
  /**
   * Defaults to age-analysis so existing individual statement PDFs are unchanged.
   * Invoice-run bulk print must pass period-ledger.
   */
  closingBalanceSource?: StatementClosingBalanceSource;
  /**
   * Optional request-scoped reuse for bulk generation.
   * Individual statement callers omit these (existing behaviour).
   */
  sharedLedger?: BillingLedgerEntry[];
  sharedSchoolBranding?: StatementPdfSchoolBranding;
  sharedLogoBuffer?: Buffer | null;
  sharedKidesysHistory?: KidesysHistoryEntry[];
  /**
   * Optional pre-resolved statement inputs (bulk single-pass).
   * When set, buildAndGenerateStatementPdf / bulk builders skip per-account Prisma.
   */
  prebuiltInput?: StatementPdfInput;
};
