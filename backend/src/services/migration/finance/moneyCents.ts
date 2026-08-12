/**
 * Exact money helpers for migration finance reconciliation.
 * Comparisons use integer cents — never floating-point epsilon.
 */

export function parseMoneyToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  if (!original) return null;

  const parenNeg = /^\(.*\)$/.test(original);
  const trailingNeg = /-$/.test(original) && !original.startsWith("-");
  let s = original
    .replace(/[R$\s]/gi, "")
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .replace(/-$/, "");

  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  let cents = Math.round(Math.abs(n) * 100);
  const negative = n < 0 || parenNeg || trailingNeg;
  return negative ? -cents : cents;
}

export function randToCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToRandNumber(cents: number): number {
  return cents / 100;
}

export function formatRandFromCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const withSep = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}R${withSep}.${frac}`;
}

export function centsEqual(a: number, b: number): boolean {
  return a === b;
}

export function centsDiff(a: number, b: number): number {
  return a - b;
}
