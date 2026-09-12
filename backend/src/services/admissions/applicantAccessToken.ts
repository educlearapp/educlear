/**
 * Applicant access token helpers (OA-03B).
 * Opaque token; store HASH ONLY. Never log plaintext tokens.
 */
import crypto from "crypto";

const TOKEN_BYTES = 32;
/** Default applicant session lifetime (30 days). */
export const APPLICANT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const ADMISSIONS_APPLICANT_COOKIE = "educlear_admissions_at";

export function generateApplicantAccessToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashApplicantAccessToken(token: string): string {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function verifyApplicantAccessToken(plaintext: string, storedHash: string | null | undefined): boolean {
  if (!plaintext || !storedHash) return false;
  const computed = hashApplicantAccessToken(plaintext);
  return timingSafeEqualHex(computed, storedHash);
}

export function applicantTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + APPLICANT_TOKEN_TTL_MS);
}
