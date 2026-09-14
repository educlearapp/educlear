/**
 * Staff auth for /api/banking — fee bank import/match/post is Core Billing.
 * Reuses payments.view (read) / payments.create (write), same as Capture Payment.
 * Client schoolId is never authority; JWT → DB school wins.
 */
import type { NextFunction, Response } from "express";

import {
  requireCapturePaymentAuth,
  requireCapturePaymentReadAuth,
  type CapturePaymentAuthRequest,
} from "./requireCapturePaymentAuth";

export type BankingAuthRequest = CapturePaymentAuthRequest;

/** GET → payments.view; POST/PATCH/DELETE → payments.create. OPTIONS left open for CORS. */
export async function requireBankingAuth(
  req: BankingAuthRequest,
  res: Response,
  next: NextFunction
) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") return next();
  if (method === "GET" || method === "HEAD") {
    return requireCapturePaymentReadAuth(req, res, next);
  }
  return requireCapturePaymentAuth(req, res, next);
}

/** Resolve schoolId only from authenticated staff context (ignore client spoof). */
export function authorizedBankingSchoolId(req: BankingAuthRequest): string {
  return String(req.capturePaymentAuth?.authorizedSchoolId || "").trim();
}
