/** Kid-e-Sys debtor account codes (e.g. SIL007, ALI002). Billing identity only. */
export const KIDEESYS_ACCOUNT_REF_RE = /^[A-Z]{2,5}\d{2,5}$/i;

export function isKidESysAccountRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref || ref.startsWith("KID-MISSING-")) return false;
  return KIDEESYS_ACCOUNT_REF_RE.test(ref);
}

/** SA-SAMS numeric admission-style refs must never be billing identity. */
export function isSasamsNumericBillingAccount(value: unknown): boolean {
  const v = String(value ?? "").trim();
  if (!v || isKidESysAccountRef(v)) return false;
  return /^\d{4,}$/.test(v);
}

export function normalizeKidESysAccountRef(value: unknown): string {
  const ref = String(value ?? "").trim();
  if (!isKidESysAccountRef(ref)) return "";
  return ref.toUpperCase();
}

export function resolveKidESysAccountRefFromLearner(learner: any): string {
  return normalizeKidESysAccountRef(learner?.familyAccount?.accountRef);
}

export function resolveKidESysAccountRefFromRow(row: any): string {
  return (
    normalizeKidESysAccountRef(row?.accountNo) ||
    normalizeKidESysAccountRef(row?.accountRef) ||
    normalizeKidESysAccountRef(row?.familyAccount?.accountRef)
  );
}

export function resolveStatementAccountRefFromLearner(learner: any): string {
  return (
    normalizeStatementAccountRef(learner?.familyAccount?.accountRef) ||
    normalizeStatementAccountRef(learner?.accountNo) ||
    normalizeStatementAccountRef(learner?.accountRef)
  );
}

export function resolveStatementAccountRefFromRow(row: any): string {
  return (
    normalizeStatementAccountRef(row?.accountNo) ||
    normalizeStatementAccountRef(row?.accountRef) ||
    normalizeStatementAccountRef(row?.familyAccount?.accountRef)
  );
}

export function filterKidESysBillingRows<T extends { accountNo?: unknown }>(rows: T[]): T[] {
  return rows.filter((row) => isKidESysAccountRef(row?.accountNo));
}

/**
 * Source-agnostic statement identity: any real accountRef except SA-SAMS admission numbers.
 * Kid-e-Sys codes, Express Invoice customer names, and other migrated refs all qualify.
 */
export function isStatementBillingAccountRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref || ref === "-" || ref.startsWith("KID-MISSING-")) return false;
  if (isSasamsNumericBillingAccount(ref)) return false;
  return true;
}

export function filterStatementBillingRows<T extends { accountNo?: unknown }>(rows: T[]): T[] {
  return rows.filter((row) => isStatementBillingAccountRef(row?.accountNo));
}

/** Preserve Kid-e-Sys codes (uppercased) and other real migrated refs (Express names, etc.). */
export function normalizeStatementAccountRef(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!isStatementBillingAccountRef(raw)) return "";
  return normalizeKidESysAccountRef(raw) || raw;
}

/** Dedicated EduClear number when present; otherwise Kid-e-Sys accountRef. */
export function resolveEduClearAccountNo(source: {
  eduClearAccountNo?: unknown;
  accountNo?: unknown;
  accountRef?: unknown;
  familyAccount?: { accountNo?: unknown; accountRef?: unknown } | null;
} | null | undefined): string {
  const dedicated =
    normalizeKidESysAccountRef(source?.eduClearAccountNo) ||
    normalizeKidESysAccountRef(source?.familyAccount?.accountNo);
  if (dedicated) return dedicated;
  return (
    normalizeKidESysAccountRef(source?.accountRef) ||
    normalizeKidESysAccountRef(source?.familyAccount?.accountRef) ||
    normalizeKidESysAccountRef(source?.accountNo)
  );
}

export function resolveSourceAccountRef(source: {
  sourceAccountRef?: unknown;
  accountRef?: unknown;
  accountNo?: unknown;
  familyAccount?: { accountRef?: unknown } | null;
} | null | undefined): string {
  return (
    normalizeStatementAccountRef(source?.sourceAccountRef) ||
    normalizeStatementAccountRef(source?.familyAccount?.accountRef) ||
    normalizeStatementAccountRef(source?.accountRef) ||
    normalizeStatementAccountRef(source?.accountNo)
  );
}

export function resolveVisibleAccountNo(source: {
  eduClearAccountNo?: unknown;
  accountNo?: unknown;
  accountRef?: unknown;
  sourceAccountRef?: unknown;
  familyAccount?: { accountNo?: unknown; accountRef?: unknown } | null;
} | null | undefined): string {
  return resolveEduClearAccountNo(source) || resolveSourceAccountRef(source);
}

export function formatAccountNoWithSource(source: {
  eduClearAccountNo?: unknown;
  accountNo?: unknown;
  accountRef?: unknown;
  sourceAccountRef?: unknown;
  familyName?: unknown;
  familyAccount?: { accountNo?: unknown; accountRef?: unknown } | null;
} | null | undefined): string {
  const edu = resolveEduClearAccountNo(source);
  const sourceRef = resolveSourceAccountRef(source);
  const familyName = String(source?.familyName || "").trim();
  const context = sourceRef && sourceRef.toUpperCase() !== edu ? sourceRef : familyName;
  if (edu && context && context.toUpperCase() !== edu) {
    return `${edu} — ${context}`;
  }
  return edu || sourceRef;
}
