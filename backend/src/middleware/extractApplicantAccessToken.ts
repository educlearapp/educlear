/**
 * Extract applicant access token from Authorization Bearer or X-Admissions-Access-Token.
 * Never log the returned value.
 */
import type { Request } from "express";

import { ADMISSIONS_APPLICANT_COOKIE } from "../services/admissions/applicantAccessToken";

export function extractApplicantAccessToken(req: Request): string | null {
  const header = String(req.headers["x-admissions-access-token"] || "").trim();
  if (header) return header;

  const auth = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim() || null;
  }

  // Optional cookie if cookie-parser is present on the app in future.
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[ADMISSIONS_APPLICANT_COOKIE];
  if (fromCookie) return String(fromCookie).trim() || null;

  return null;
}
