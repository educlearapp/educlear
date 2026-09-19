/** Shared string / money helpers for Fly Eagle remediation (pure). */

export function normRef(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function compactName(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function round2(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function moneyCents(value: unknown): number {
  return Math.round(round2(value) * 100);
}

export function isoOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return s || null;
}

export function learnerDisplayName(firstName: unknown, lastName: unknown): string {
  return `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
}

/** Tokenize a FA accountRef / holder name into comparable tokens. */
export function nameTokens(value: unknown): string[] {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Exact token overlap: both first and last of learner appear in holder tokens
 * (order-independent). Not fuzzy edit-distance.
 */
export function exactNameTokenMatch(
  firstName: unknown,
  lastName: unknown,
  holderOrRef: unknown
): boolean {
  const first = String(firstName || "")
    .trim()
    .toUpperCase();
  const last = String(lastName || "")
    .trim()
    .toUpperCase();
  if (!first || !last) return false;
  const tokens = new Set(nameTokens(holderOrRef));
  return tokens.has(first) && tokens.has(last);
}

export function phoneKey(value: unknown): string {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length < 9) return "";
  return digits.slice(-9);
}

export function emailKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}
