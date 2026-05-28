import { normaliseAmount } from "../../../utils/billingLedgerStore";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import {
  classifyTransactionReadiness,
  shouldTransactionBeHistoricalOnly,
} from "./transactionEligibility";
import type { LearnerIndexEntry } from "./computeTransactionReadiness";
import type {
  LedgerDuplicateKey,
  LedgerPostingDecision,
  LedgerPostingType,
} from "../types/MigrationLedgerPosting";
import type { MigrationLearnerStatus } from "../types/MigrationLearnerStatus";
import { isClosedOrInactiveAccountStatus } from "../types/MigrationLearnerStatus";

export type ClassifyLedgerTransactionInput = {
  mapped: Partial<Record<MigrationTargetField, string>>;
  cutoverDate?: string | null;
  learnerEntry: LearnerIndexEntry | null;
  hasLearnerOrAccountMatch: boolean;
  accountStatus?: string | null;
  accountClosed?: boolean;
};

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function parseCutoverDate(cutoverDate: string | null | undefined): Date | null {
  const raw = String(cutoverDate || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseTransactionDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + serial * 86400000);
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const month = Number(dmy[2]) - 1;
    const day = Number(dmy[1]);
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  return null;
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseAmountFromMapped(mapped: Partial<Record<MigrationTargetField, string>>): {
  valid: boolean;
  amount: number;
} {
  const debit = cleanString(mapped.debit);
  const credit = cleanString(mapped.credit);
  const amountRaw = cleanString(mapped.amount);

  const pick = (raw: string): number | null => {
    if (!raw) return null;
    const normalized = raw.replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? Math.abs(n) : null;
  };

  if (amountRaw) {
    const n = pick(amountRaw);
    if (n != null) return { valid: true, amount: n };
    return { valid: false, amount: 0 };
  }

  const d = pick(debit);
  const c = pick(credit);
  if (d != null && !c) return { valid: true, amount: d };
  if (c != null && !d) return { valid: true, amount: c };
  if (d != null && c != null) return { valid: true, amount: Math.max(d, c) };
  if (!amountRaw && !debit && !credit) return { valid: false, amount: 0 };
  return { valid: false, amount: 0 };
}

const INVOICE_TYPES = new Set([
  "invoice",
  "inv",
  "charge",
  "debit",
  "fee",
  "billing",
  "journal debit",
  "journal_debit",
  "jd",
]);

const PAYMENT_TYPES = new Set([
  "payment",
  "pay",
  "receipt",
  "rcpt",
  "credit",
  "cr",
  "journal credit",
  "journal_credit",
  "jc",
]);

export function resolveLedgerPostingType(
  rawType: string
): LedgerPostingType | "unknown" {
  const t = cleanString(rawType).toLowerCase().replace(/[_-]+/g, " ");
  if (!t) return "unknown";
  if (INVOICE_TYPES.has(t)) {
    if (t.includes("journal")) return "journal_debit";
    return "invoice";
  }
  if (PAYMENT_TYPES.has(t)) {
    if (t.includes("journal")) return "journal_credit";
    return "payment";
  }
  if (t === "dr" || t === "debit note") return "invoice";
  if (t === "cr" || t === "credit note") return "payment";
  return "unknown";
}

function ledgerDuplicateKey(parts: {
  accountRef: string;
  date: string;
  reference: string;
  amount: number;
  postingType: LedgerPostingType;
}): LedgerDuplicateKey | null {
  const accountRef = cleanString(parts.accountRef);
  const date = cleanString(parts.date);
  if (!accountRef || !date) return null;
  return {
    accountRef: accountRef.toLowerCase(),
    date,
    reference: cleanString(parts.reference).toLowerCase(),
    amount: normaliseAmount(parts.amount),
    postingType: parts.postingType,
  };
}

function duplicateKeyString(key: LedgerDuplicateKey): string {
  return `tx:${key.accountRef}|${key.date}|${key.reference}|${key.amount}|${key.postingType}`;
}

export function formatLedgerDuplicateKey(key: LedgerDuplicateKey): string {
  return duplicateKeyString(key);
}

export function classifyLedgerTransaction(
  input: ClassifyLedgerTransactionInput
): LedgerPostingDecision {
  const { mapped, cutoverDate, learnerEntry, hasLearnerOrAccountMatch } = input;
  const accountRef = cleanString(mapped.accountNumber);
  const reference = cleanString(mapped.reference);
  const description = cleanString(mapped.description);
  const typeRaw = cleanString(mapped.transactionType);

  const txDateRaw = mapped.transactionDate;
  const txDate = parseTransactionDate(txDateRaw);
  if (!txDate) {
    return {
      canPost: false,
      postingType: null,
      amount: 0,
      date: "",
      reference,
      reason: "Transaction date is missing or invalid",
      duplicateKey: null,
      historicalOnly: false,
      bucket: "blocked",
    };
  }

  const dateIso = formatIsoDate(txDate);
  const { valid: amountValid, amount } = parseAmountFromMapped(mapped);
  if (!amountValid || amount <= 0) {
    return {
      canPost: false,
      postingType: null,
      amount: 0,
      date: dateIso,
      reference,
      reason: "Transaction amount is missing or invalid",
      duplicateKey: null,
      historicalOnly: false,
      bucket: "blocked",
    };
  }

  const postingType = resolveLedgerPostingType(typeRaw);
  if (postingType === "unknown") {
    return {
      canPost: false,
      postingType: null,
      amount,
      date: dateIso,
      reference,
      reason: `Unknown transaction type "${typeRaw || "(empty)"}" — not posted`,
      duplicateKey: null,
      historicalOnly: false,
      bucket: "blocked",
    };
  }

  const learnerStatus: MigrationLearnerStatus | null = learnerEntry?.status ?? null;
  const accountStatus =
    cleanString(input.accountStatus) || learnerEntry?.accountStatus || "";
  const accountClosed =
    Boolean(input.accountClosed) || isClosedOrInactiveAccountStatus(accountStatus);

  const readinessBucket = classifyTransactionReadiness({
    learnerStatus,
    grade: learnerEntry?.grade,
    classroom: learnerEntry?.classroom,
    accountStatus,
    accountClosed,
    transactionDate: txDateRaw,
    cutoverDate,
    hasLearnerOrAccountMatch,
    amountValid: true,
    datePresent: true,
  });

  const historicalOnly = shouldTransactionBeHistoricalOnly({
    learnerStatus,
    accountStatus,
    accountClosed,
    transactionDate: txDateRaw,
    cutoverDate,
  });

  const duplicateKey = ledgerDuplicateKey({
    accountRef: accountRef || "unknown",
    date: dateIso,
    reference,
    amount,
    postingType,
  });

  if (readinessBucket === "unmatched") {
    return {
      canPost: false,
      postingType,
      amount,
      date: dateIso,
      reference,
      reason: "No matching active learner or billing account — transaction not posted",
      duplicateKey,
      historicalOnly: false,
      bucket: "unmatched",
    };
  }

  if (historicalOnly || readinessBucket === "historicalOnly") {
    return {
      canPost: false,
      postingType,
      amount,
      date: dateIso,
      reference,
      reason: "Historical-only transaction preserved; not posted to active ledger.",
      duplicateKey,
      historicalOnly: true,
      bucket: "historicalOnly",
    };
  }

  if (readinessBucket === "blocked") {
    const reason =
      learnerStatus && learnerStatus !== "ACTIVE"
        ? `Learner/account is not ACTIVE (${learnerStatus}) — transaction not posted`
        : accountClosed
          ? "Billing account is closed or inactive — transaction not posted"
          : "Transaction blocked by eligibility rules — not posted";
    return {
      canPost: false,
      postingType,
      amount,
      date: dateIso,
      reference,
      reason,
      duplicateKey,
      historicalOnly: false,
      bucket: "blocked",
    };
  }

  if (!accountRef) {
    return {
      canPost: false,
      postingType,
      amount,
      date: dateIso,
      reference,
      reason: "Missing account number for ledger posting",
      duplicateKey,
      historicalOnly: false,
      bucket: "blocked",
    };
  }

  const cutover = parseCutoverDate(cutoverDate);
  if (!cutover) {
    return {
      canPost: false,
      postingType,
      amount,
      date: dateIso,
      reference,
      reason: "Cutover date is required before posting transactions",
      duplicateKey,
      historicalOnly: false,
      bucket: "blocked",
    };
  }

  if (txDate.getTime() < cutover.getTime()) {
    return {
      canPost: false,
      postingType,
      amount,
      date: dateIso,
      reference,
      reason: "Historical-only transaction preserved; not posted to active ledger.",
      duplicateKey,
      historicalOnly: true,
      bucket: "historicalOnly",
    };
  }

  return {
    canPost: true,
    postingType,
    amount,
    date: dateIso,
    reference,
    reason: "Eligible active transaction — post to billing ledger",
    duplicateKey,
    historicalOnly: false,
    bucket: "eligibleActive",
  };
}
