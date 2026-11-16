/**
 * Statement recipient email normalisation for Resend delivery.
 * Accepts `email@example.com` or `Name <email@example.com>`; rejects empty,
 * multi-address, and malformed values (e.g. stray `<` / `>`).
 */

export type StatementRecipientEmailResult =
  | { ok: true; email: string }
  | { ok: false; reason: string };

/** Strict single-address shape Resend accepts (no angle brackets, no whitespace). */
const SIMPLE_EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const NAMED_EMAIL_RE = /^([^<>]+)\s+<([^<>\s]+)>$/;
const ANGLE_ONLY_RE = /^<([^<>\s]+)>$/;

export function normalizeStatementRecipientEmail(raw: unknown): StatementRecipientEmailResult {
  const original = String(raw ?? "").trim();
  if (!original) {
    return { ok: false, reason: "Missing email" };
  }

  if (original.includes(",") || original.includes(";")) {
    return { ok: false, reason: "Multiple email addresses are not supported in one recipient" };
  }

  let candidate = original;
  const named = original.match(NAMED_EMAIL_RE);
  if (named) {
    candidate = String(named[2] || "").trim();
  } else {
    const angled = original.match(ANGLE_ONLY_RE);
    if (angled) {
      candidate = String(angled[1] || "").trim();
    }
  }

  candidate = candidate.trim().toLowerCase();

  if (!candidate) {
    return { ok: false, reason: "Missing email" };
  }
  if (candidate.includes("<") || candidate.includes(">")) {
    return { ok: false, reason: "Email contains invalid angle-bracket characters" };
  }
  if (/\s/.test(candidate)) {
    return { ok: false, reason: "Email contains whitespace" };
  }
  if ((candidate.match(/@/g) || []).length !== 1) {
    return { ok: false, reason: "Email must contain a single @ domain separator" };
  }
  if (!SIMPLE_EMAIL_RE.test(candidate)) {
    return { ok: false, reason: "Email format is invalid for delivery" };
  }

  return { ok: true, email: candidate };
}

export function isValidStatementRecipientEmail(raw: unknown): boolean {
  return normalizeStatementRecipientEmail(raw).ok;
}
