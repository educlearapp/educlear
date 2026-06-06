import type { BillingLedgerEntry } from "./billingLedgerStore";
import type { KidesysHistoryEntry } from "./kidesysTransactionHistoryStore";

export const KIDESYS_HISTORY_INVOICE_TYPE = "Invoice · Kid-e-Sys History · non-posting";
export const KIDESYS_HISTORY_PAYMENT_TYPE = "Payment · Kid-e-Sys History · non-posting";
export const KIDESYS_HISTORY_DESCRIPTION_FALLBACK = "Kid-e-Sys History · non-posting";

/** Permanent rule: EduClear live transactions from this date use normal labels only. */
export const EDUCLEAR_LIVE_BILLING_DISPLAY_FROM = "2026-05-24";

export const OPENING_BALANCE_MIGRATION_TYPE = "Opening Balance Migration";
export const MIGRATED_OPENING_BALANCE_OVERVIEW = "Migrated Opening Balance";

export type BillingDisplayEntry = Pick<
  BillingLedgerEntry,
  "id" | "createdAt" | "description" | "type" | "source" | "reference" | "date"
>;

export type BillingUndoableDisplayEntry = BillingDisplayEntry &
  Pick<
    BillingLedgerEntry,
    "bankTransactionId" | "bankImportId" | "statementHidden" | "undoneAt" | "undoneByCorrectionId" | "correctsEntryId"
  >;

export const EDUCLEAR_UNDO_CORRECTION_SOURCE = "educlear_undo_correction";
export const EDUCLEAR_CORRECTION_JOURNAL_TYPE = "Correction Journal";

export function isEduClearUndoCorrectionEntry(
  entry: Pick<BillingLedgerEntry, "source" | "correctsEntryId">
): boolean {
  if (String(entry.correctsEntryId || "").trim()) return true;
  return String(entry.source || "").trim() === EDUCLEAR_UNDO_CORRECTION_SOURCE;
}

export function isUndoneLedgerEntry(
  entry: Pick<BillingLedgerEntry, "undoneAt" | "undoneByCorrectionId">
): boolean {
  if (String(entry.undoneAt || "").trim()) return true;
  return Boolean(String(entry.undoneByCorrectionId || "").trim());
}

/** Normal/parent statement & PDF — omit undone rows and their correction journals unless audit mode. */
export function shouldShowLedgerEntryOnStatement(
  entry: Pick<BillingLedgerEntry, "statementHidden" | "source" | "correctsEntryId">,
  showCorrectionsAudit = false
): boolean {
  if (showCorrectionsAudit) return true;
  if (entry.statementHidden) return false;
  if (isEduClearUndoCorrectionEntry(entry)) return false;
  return true;
}

const MIGRATION_SOURCES = new Set([
  "kidesys_migration",
  "kidesys_migration_opening_balance",
  "kidesys_csv_migration",
  "kidesys_csv_opening_balance",
  "kidesys_display_history",
  "kideesys-dasilva",
]);

const LIVE_STRIP_REGEXES = [
  /^KIDESYS-/i,
  /^kidesys-opening-/i,
  /\bKid-e-Sys\b[^\w]*History[^\w]*non-posting\b/gi,
  /\bKid-e-Sys\b/gi,
  /\bOpening Balance Migration\b/gi,
  /\bMigrated Opening Balance\b/gi,
  /\bMigration History\b[^\w]*non-posting\b/gi,
  /\bnon-posting\b/gi,
  /\bMigration\b/gi,
];

export function isKidesysOpeningBalanceEntry(
  entry: Pick<BillingLedgerEntry, "source" | "reference" | "description">
): boolean {
  if (
    String(entry.source || "").trim() === "kidesys_migration_opening_balance" ||
    String(entry.source || "").trim() === "kidesys_csv_opening_balance"
  ) {
    return true;
  }
  const reference = String(entry.reference || "").trim();
  if (reference.startsWith("KIDESYS-OPENING")) return true;
  if (String(entry.description || "").includes("Kid-e-Sys opening balance")) return true;
  return false;
}

export function isMigrationBillingSource(source: string | undefined | null): boolean {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) return false;
  if (MIGRATION_SOURCES.has(normalized)) return true;
  return normalized.startsWith("kidesys_migration");
}

const KIDESYS_IMPORTED_LEDGER_SOURCES = new Set([
  "kideesys-transaction",
  "kideesys-journal",
  "kidesys_display_history",
]);

function isKidesysImportedLedgerSource(source: string | undefined | null): boolean {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) return false;
  return KIDESYS_IMPORTED_LEDGER_SOURCES.has(normalized);
}

export function isKidesysHistoryIdOrReference(
  id?: string | null,
  reference?: string | null
): boolean {
  const idStr = String(id || "").trim();
  const ref = String(reference || "").trim();
  if (/^kidesys[-_/]/i.test(idStr) || /^kideesys[-_/]/i.test(idStr)) return true;
  if (/^kidesys[-_/]/i.test(ref) || /^kideesys[-_/]/i.test(ref)) return true;
  if (/^imported[-_/]/i.test(idStr) || /^imported[-_/]/i.test(ref)) return true;
  if (idStr.toUpperCase().startsWith("KIDESYS-") || ref.toUpperCase().startsWith("KIDESYS-")) {
    return true;
  }
  return false;
}

export function isKidesysBlockedBillingSource(source?: string | null): boolean {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized || normalized === "manual") return false;
  if (isMigrationBillingSource(source)) return true;
  if (isKidesysImportedLedgerSource(source)) return true;
  if (normalized === "history") return true;
  if (normalized.includes("migration")) return true;
  if (
    normalized.includes("kid-e-sys") ||
    normalized.includes("kidesys") ||
    normalized.includes("kideesys")
  ) {
    return true;
  }
  return false;
}

/** EduClear manual payment rows — includes legacy rows saved before source:"manual". */
export function isManualLedgerPayment(entry: BillingDisplayEntry): boolean {
  if (entry.type !== "payment") return false;
  if (isKidesysBlockedBillingSource(entry.source)) return false;
  if (isKidesysHistoryIdOrReference(entry.id, entry.reference)) return false;
  if (isNonPostingImportedLedgerEntry(entry)) return false;
  if (String(entry.source || "").trim().toLowerCase() === "manual") return true;
  if (String(entry.id || "").trim().startsWith("pay-")) return true;
  if (String(entry.reference || "").trim().toUpperCase() === "EFT") return true;
  return false;
}

/** Kid-e-Sys / migration rows only — not EduClear manual payments. */
export function isStatementKidesysUndoBlocked(
  entry: BillingDisplayEntry | null | undefined,
  typeLabel: string | undefined,
  isKidesysHistoryRow: boolean
): boolean {
  if (isKidesysHistoryRow) return true;
  if (/\bKid-e-Sys\b[^\w]*History\b/i.test(String(typeLabel || ""))) return true;
  if (!entry) return false;
  if (isManualLedgerPayment(entry)) return false;
  const source = String(entry.source || "").trim().toLowerCase();
  if (source && source !== "manual") {
    if (source === "migration" || source === "history") return true;
    if (isMigrationBillingSource(entry.source)) return true;
    if (isKidesysImportedLedgerSource(entry.source)) return true;
    if (
      source.includes("kidesys") ||
      source.includes("kid-e-sys") ||
      source.includes("kideesys")
    ) {
      return true;
    }
  }
  return isKidesysHistoryIdOrReference(entry.id, entry.reference);
}

/** Ledger rows that must not change Age Analysis balances (already in snapshot / display history). */
export function isNonPostingImportedLedgerEntry(entry: BillingDisplayEntry): boolean {
  if (isImportedBillingLedgerEntry(entry)) return true;
  if (isKidesysImportedLedgerSource(entry.source)) return true;
  return false;
}

/** Live payment sources that post against the age-analysis baseline (same as manual Create Payment). */
const LIVE_POSTING_PAYMENT_SOURCES = new Set(["manual", "bank_import", "kidesys_topup"]);

/** Post-import balance delta: EduClear-created invoice/payment/penalty/credit only. */
export function countsTowardPostImportBalanceDelta(entry: BillingDisplayEntry): boolean {
  const source = String(entry.source || "").trim().toLowerCase();
  if (entry.type === "payment" && LIVE_POSTING_PAYMENT_SOURCES.has(source)) {
    return true;
  }
  return !isNonPostingImportedLedgerEntry(entry);
}

export function isKidesysHistoryTypeLabel(typeLabel: string | undefined): boolean {
  return /\bKid-e-Sys\b[^\w]*History\b/i.test(String(typeLabel || ""));
}

/** Statement Manage — EduClear manual payment rows only. */
export function isStatementManualUndoableEntry(
  entry: BillingDisplayEntry,
  typeLabel?: string
): boolean {
  if (isKidesysHistoryTypeLabel(typeLabel)) return false;
  return isManualLedgerPayment(entry);
}

/** Statement Manage posting row — undo when not Kid-e-Sys history and ledger row is undoable. */
export function canUndoStatementPostingEntry(
  entry: BillingUndoableDisplayEntry,
  typeLabel?: string
): boolean {
  if (isStatementManualUndoableEntry(entry, typeLabel)) return true;
  if (isStatementKidesysUndoBlocked(entry, typeLabel, false)) return false;
  return isEduClearUndoableLedgerEntry(entry);
}

/** Undo allowed only for EduClear-created posting ledger rows. */
export function isEduClearUndoableLedgerEntry(entry: BillingUndoableDisplayEntry): boolean {
  if (isUndoneLedgerEntry(entry) || isEduClearUndoCorrectionEntry(entry)) return false;
  if (entry.type !== "invoice" && entry.type !== "payment" && entry.type !== "penalty") {
    return false;
  }
  if (entry.bankTransactionId || entry.bankImportId) return false;
  if (isKidesysBlockedBillingSource(entry.source)) return false;
  if (isKidesysHistoryIdOrReference(entry.id, entry.reference)) return false;
  if (isNonPostingImportedLedgerEntry(entry)) return false;
  if (isManualLedgerPayment(entry)) return true;
  if (entry.type === "payment") return false;
  return true;
}

export function isImportedBillingLedgerEntry(entry: BillingDisplayEntry): boolean {
  if (isKidesysOpeningBalanceEntry(entry)) return true;
  if (isMigrationBillingSource(entry.source)) return true;
  return false;
}

export function isMigratedOpeningBalanceOverviewLabel(label: string | null | undefined): boolean {
  const value = String(label || "").trim();
  return value === MIGRATED_OPENING_BALANCE_OVERVIEW || value === "Opening Balance";
}

export function sanitizeLiveBillingText(text: string | undefined | null): string {
  let value = String(text || "").trim();
  if (!value) return "";
  for (const re of LIVE_STRIP_REGEXES) {
    value = value.replace(re, " ");
  }
  value = value.replace(/\s+/g, " ").replace(/^[-–·|]\s*/, "").trim();
  return value;
}

export function formatLedgerTypeLabel(entry: BillingLedgerEntry): string {
  if (isEduClearUndoCorrectionEntry(entry)) return EDUCLEAR_CORRECTION_JOURNAL_TYPE;
  if (isKidesysOpeningBalanceEntry(entry)) return OPENING_BALANCE_MIGRATION_TYPE;
  switch (entry.type) {
    case "invoice":
      return "Invoice";
    case "penalty":
      return "Penalty";
    case "credit":
      return "Credit";
    default:
      return "Payment";
  }
}

export function formatLedgerReferenceDisplay(entry: BillingLedgerEntry): string {
  const raw = String(entry.reference || "").trim();
  if (!raw) return "";
  if (isImportedBillingLedgerEntry(entry)) return raw;
  return sanitizeLiveBillingText(raw) || "";
}

export function formatLedgerDescriptionDisplay(entry: BillingLedgerEntry): string {
  const raw = String(entry.description || "").trim();
  if (!raw) {
    if (isKidesysOpeningBalanceEntry(entry)) return MIGRATED_OPENING_BALANCE_OVERVIEW;
    return "";
  }
  if (isImportedBillingLedgerEntry(entry)) {
    if (isKidesysOpeningBalanceEntry(entry) && /Kid-e-Sys opening balance/i.test(raw)) {
      return MIGRATED_OPENING_BALANCE_OVERVIEW;
    }
    return raw;
  }
  return sanitizeLiveBillingText(raw) || "";
}

export function formatKidesysHistoryTypeLabel(type: "invoice" | "payment"): string {
  return type === "invoice" ? KIDESYS_HISTORY_INVOICE_TYPE : KIDESYS_HISTORY_PAYMENT_TYPE;
}

export function formatKidesysHistoryReferenceDisplay(entry: KidesysHistoryEntry): string {
  const raw =
    entry.kidesysReference ||
    entry.reference ||
    entry.transactionNo ||
    entry.invoiceNumber ||
    entry.paymentNumber ||
    "";
  return String(raw).trim() || "—";
}

export function formatKidesysHistoryDescriptionDisplay(entry: KidesysHistoryEntry): string {
  const raw = entry.description || entry.journalReference || entry.reference || "";
  const value = String(raw).trim();
  return value || KIDESYS_HISTORY_DESCRIPTION_FALLBACK;
}
