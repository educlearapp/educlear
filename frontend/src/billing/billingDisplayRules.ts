import type { BillingLedgerEntry } from "./billingLedger";
import type { KidesysHistoryEntry } from "./kidesysTransactionHistory";

/** Permanent rule: EduClear live transactions from this date use normal labels only. */
export const EDUCLEAR_LIVE_BILLING_DISPLAY_FROM = "2026-05-24";

export const OPENING_BALANCE_MIGRATION_TYPE = "Opening Balance Migration";
export const MIGRATED_OPENING_BALANCE_OVERVIEW = "Migrated Opening Balance";

export const KIDESYS_HISTORY_INVOICE_TYPE = "Invoice · Kid-e-Sys History · non-posting";
export const KIDESYS_HISTORY_PAYMENT_TYPE = "Payment · Kid-e-Sys History · non-posting";
export const KIDESYS_HISTORY_DESCRIPTION_FALLBACK = "Kid-e-Sys History · non-posting";

const MIGRATION_SOURCES = new Set([
  "kidesys_migration",
  "kidesys_migration_opening_balance",
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
  if (String(entry.source || "").trim() === "kidesys_migration_opening_balance") return true;
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

export function isNonPostingImportedLedgerEntry(
  entry: Pick<BillingLedgerEntry, "source" | "reference" | "description" | "type" | "date" | "createdAt">
): boolean {
  if (isImportedBillingLedgerEntry(entry)) return true;
  if (isKidesysImportedLedgerSource(entry.source)) return true;
  return false;
}

/** Undo allowed only for EduClear-created posting ledger rows. */
export function isEduClearUndoableLedgerEntry(
  entry: Pick<
    BillingLedgerEntry,
    | "source"
    | "reference"
    | "description"
    | "type"
    | "date"
    | "createdAt"
    | "bankTransactionId"
    | "bankImportId"
  >
): boolean {
  if (entry.type !== "invoice" && entry.type !== "payment" && entry.type !== "penalty") {
    return false;
  }
  const source = String(entry.source || "").trim().toLowerCase();
  if (source === "manual") return true;
  if (entry.bankTransactionId || entry.bankImportId) return false;
  if (isNonPostingImportedLedgerEntry(entry)) return false;
  if (isKidesysImportedLedgerSource(entry.source)) return false;
  if (isMigrationBillingSource(entry.source)) return false;
  if (
    source === "kideesys" ||
    source.startsWith("kideesys-") ||
    source.startsWith("kidesys")
  ) {
    return false;
  }
  return true;
}

/** Imported Kid-e-Sys / migration ledger row — show migration wording in the UI. */
export function isImportedBillingLedgerEntry(
  entry: Pick<BillingLedgerEntry, "source" | "reference" | "description" | "type" | "date" | "createdAt">
): boolean {
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
  if (!raw) return "—";
  if (isImportedBillingLedgerEntry(entry)) return raw;
  const sanitized = sanitizeLiveBillingText(raw);
  return sanitized || "—";
}

export function formatLedgerDescriptionDisplay(entry: BillingLedgerEntry): string {
  const raw = String(entry.description || "").trim();
  if (!raw) {
    if (isKidesysOpeningBalanceEntry(entry)) return MIGRATED_OPENING_BALANCE_OVERVIEW;
    return "—";
  }
  if (isImportedBillingLedgerEntry(entry)) {
    if (isKidesysOpeningBalanceEntry(entry) && /Kid-e-Sys opening balance/i.test(raw)) {
      return MIGRATED_OPENING_BALANCE_OVERVIEW;
    }
    return raw;
  }
  const sanitized = sanitizeLiveBillingText(raw);
  return sanitized || "—";
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
