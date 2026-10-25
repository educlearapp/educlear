/**
 * Rate limit authenticated parent push subscription mutations (register / refresh / unsubscribe).
 */
import type { NextFunction, Request, Response } from "express";

import {
  FixedWindowRateLimiter,
  getClientIpForRateLimit,
} from "./publicAdmissionsRateLimit";

export const PARENT_PUSH_SUBSCRIBE_LIMIT = 30;
export const PARENT_PUSH_SUBSCRIBE_WINDOW_MS = 15 * 60 * 1000;

export const parentPushSubscribeLimiter = new FixedWindowRateLimiter(
  "parent-push-subscribe",
  PARENT_PUSH_SUBSCRIBE_LIMIT,
  PARENT_PUSH_SUBSCRIBE_WINDOW_MS
);

export function resetParentPushSubscribeRateLimit(): void {
  parentPushSubscribeLimiter.resetAll();
}

export function rateLimitParentPushSubscribe(req: Request, res: Response, next: NextFunction): void {
  const auth = (req as { parentAuth?: { parentId?: string } }).parentAuth;
  const parentKey = auth?.parentId ? `p:${auth.parentId}` : `ip:${getClientIpForRateLimit(req)}`;
  const result = parentPushSubscribeLimiter.tryConsume(parentKey);
  if (result.allowed) {
    next();
    return;
  }
  res.setHeader("Retry-After", String(Math.max(1, result.retryAfterSec)));
  res.setHeader("Cache-Control", "no-store");
  res.status(429).json({
    success: false,
    error: "Too many subscription requests. Try again later.",
    code: "RATE_LIMITED",
  });
}
