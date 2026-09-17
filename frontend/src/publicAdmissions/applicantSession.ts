/**
 * Same-device applicant session for public admissions drafts (OA-06C).
 * Namespaced by publicSlug. Never stores staff JWT or schoolId authority.
 */
import type { PublicApplicantSession } from "./publicAdmissionsTypes";

const STORAGE_PREFIX = "educlear.publicAdmissions.applicantSession.";

function storageKey(publicSlug: string): string {
  return `${STORAGE_PREFIX}${String(publicSlug || "").trim().toLowerCase()}`;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function readApplicantSession(publicSlug: string): PublicApplicantSession | null {
  if (!canUseStorage()) return null;
  const slug = String(publicSlug || "").trim().toLowerCase();
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublicApplicantSession>;
    const storedSlug = String(parsed.publicSlug || "").trim().toLowerCase();
    const publicAccessId = String(parsed.publicAccessId || "").trim();
    const accessToken = String(parsed.accessToken || "").trim();
    if (!storedSlug || storedSlug !== slug || !publicAccessId || !accessToken) {
      return null;
    }
    const expiresAt = parsed.accessTokenExpiresAt
      ? String(parsed.accessTokenExpiresAt)
      : null;
    if (expiresAt) {
      const exp = new Date(expiresAt);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
        clearApplicantSession(slug);
        return null;
      }
    }
    return {
      publicSlug: slug,
      publicAccessId,
      accessToken,
      accessTokenExpiresAt: expiresAt,
    };
  } catch {
    return null;
  }
}

export function writeApplicantSession(session: PublicApplicantSession): void {
  if (!canUseStorage()) return;
  const slug = String(session.publicSlug || "").trim().toLowerCase();
  if (!slug || !session.publicAccessId || !session.accessToken) return;
  const payload: PublicApplicantSession = {
    publicSlug: slug,
    publicAccessId: String(session.publicAccessId).trim(),
    accessToken: String(session.accessToken).trim(),
    accessTokenExpiresAt: session.accessTokenExpiresAt
      ? String(session.accessTokenExpiresAt)
      : null,
  };
  localStorage.setItem(storageKey(slug), JSON.stringify(payload));
}

export function clearApplicantSession(publicSlug: string): void {
  if (!canUseStorage()) return;
  const slug = String(publicSlug || "").trim().toLowerCase();
  if (!slug) return;
  localStorage.removeItem(storageKey(slug));
}

/** Storage key helper for tests / guards — does not expose token values. */
export function applicantSessionStorageKey(publicSlug: string): string {
  return storageKey(publicSlug);
}
