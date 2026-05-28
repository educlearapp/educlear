/** Ledger posting classification for Universal Migration Framework Phase 14. */
export type LedgerPostingType = "invoice" | "payment" | "journal_debit" | "journal_credit";

export type LedgerDuplicateKey = {
  accountRef: string;
  date: string;
  reference: string;
  amount: number;
  postingType: LedgerPostingType;
};

export type LedgerPostingDecision = {
  canPost: boolean;
  postingType: LedgerPostingType | null;
  amount: number;
  date: string;
  reference: string;
  reason: string;
  duplicateKey: LedgerDuplicateKey | null;
  /** When true, row is preserved as not_applied (historical-only), not failed. */
  historicalOnly: boolean;
  /** Readiness bucket for reporting. */
  bucket: "eligibleActive" | "historicalOnly" | "blocked" | "unmatched";
};

export type LedgerPostingResult = {
  status: "created" | "skipped" | "failed" | "not_applied";
  message: string;
  recordId?: string;
  key?: string;
};
