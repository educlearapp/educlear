/**
 * Per-IP limit for unauthenticated parent lookup only.
 * Same response for every throttled caller — no cell, school, or existence hint.
 */
import type { NextFunction, Request, Response } from "express";

import {
  FixedWindowRateLimiter,
  getClientIpForRateLimit,
} from "./publicAdmissionsRateLimit";

/** Enough for a front desk, tight enough to slow cell-number scanning. */
export const PARENT_LOOKUP_LIMIT = 40;
export const PARENT_LOOKUP_WINDOW_MS = 5 * 60 * 1000;

export const parentPortalLookupLimiter = new FixedWindowRateLimiter(
  "parent-portal-lookup",
  PARENT_LOOKUP_LIMIT,
  PARENT_LOOKUP_WINDOW_MS
);

export function resetParentPortalLookupRateLimit(): void {
  parentPortalLookupLimiter.resetAll();
}

export function rateLimitParentPortalLookup(req: Request, res: Response, next: NextFunction): void {
  const result = parentPortalLookupLimiter.tryConsume(getClientIpForRateLimit(req));
  if (result.allowed) {
    next();
    return;
  }
  res.setHeader("Retry-After", String(Math.max(1, result.retryAfterSec)));
  res.setHeader("Cache-Control", "no-store");
  res.status(429).json({
    success: false,
    error: "Lookup failed",
    code: "RATE_LIMITED",
  });
}
