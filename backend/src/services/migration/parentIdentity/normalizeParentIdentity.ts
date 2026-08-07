/**
 * Normalization helpers for parent identity matching.
 * Preserve original display/source values separately at the call site.
 */

import { normalizeSaPhone } from "../../parentPortalService";
import { normalizeSaIdDigits } from "../../../utils/saIdValidation";

const PLACEHOLDER_CELLS = new Set(["", "0", "0000000000", "-", "n/a", "na", "none"]);

export function normalizeParentEmail(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw || !raw.includes("@")) return null;
  if (["n/a", "na", "none", "-", "."].includes(raw)) return null;
  return raw;
}

export function normalizeParentCellphone(value: unknown): string | null {
  const phone = normalizeSaPhone(String(value ?? ""));
  const local = String(phone.localCell || "").replace(/\D/g, "");
  if (!local || PLACEHOLDER_CELLS.has(local) || local.length < 9) return null;
  // Prefer SA local 0XXXXXXXXX when possible
  if (local.startsWith("27") && local.length >= 11) {
    return `0${local.slice(2)}`;
  }
  return local;
}

/**
 * Normalize identity numbers for matching.
 * SA IDs: 13 digits. Other/passport/foreign: keep digit runs of length >= 6.
 */
export function normalizeParentIdentityNumber(value: unknown): string | null {
  const digits = normalizeSaIdDigits(value);
  if (!digits) return null;
  if (digits.length >= 13) return digits.slice(0, 13);
  if (digits.length >= 6) return digits;
  return null;
}

export function normalizePersonNameToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function firstNameTokens(value: unknown): string[] {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/**
 * First-name compatibility for corroboration — NOT an identity key alone.
 * Exact token match, shared first token, or small edit distance on primary token.
 */
export function firstNamesCompatible(a: unknown, b: unknown): boolean {
  const at = firstNameTokens(a);
  const bt = firstNameTokens(b);
  if (!at.length || !bt.length) return false;
  if (at[0] === bt[0]) return true;
  if (at.some((t) => bt.includes(t))) return true;
  const a0 = at[0]!;
  const b0 = bt[0]!;
  if (a0[0] !== b0[0]) return false;
  if (Math.abs(a0.length - b0.length) > 2) return false;
  return levenshtein(a0, b0) <= 2;
}

export function maskIdentityNumber(value: unknown): string {
  const d = normalizeParentIdentityNumber(value);
  if (!d) return "—";
  if (d.length < 5) return "****";
  return `${d.slice(0, 4)}${"*".repeat(Math.max(0, d.length - 5))}${d.slice(-1)}`;
}

export function maskCellphone(value: unknown): string {
  const d = normalizeParentCellphone(value);
  if (!d) return "—";
  return `${d.slice(0, 3)}****${d.slice(-2)}`;
}

export function maskEmail(value: unknown): string {
  const e = normalizeParentEmail(value);
  if (!e) return "—";
  const [local, domain] = e.split("@");
  return `${(local || "*")[0] || "*"}***@${domain || ""}`;
}

export function sourceIdentityKey(
  sourceSystem: string,
  sourceParentId: string | null | undefined
): string | null {
  const sid = String(sourceParentId ?? "").trim();
  if (!sid) return null;
  return `${String(sourceSystem || "UNKNOWN").trim().toUpperCase()}::${sid}`;
}
