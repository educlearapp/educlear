/**
 * Scoped in-memory rate limiting for public Online Admissions only.
 * Mount exclusively on /api/public/admissions/:schoolSlug/*
 *
 * Do not set Express trust proxy globally. Client IP uses:
 * - first X-Forwarded-For hop only when an explicit trusted-proxy env is set
 * - otherwise req.socket.remoteAddress
 */
import { createHash } from "crypto";
import type { NextFunction, Request, Response } from "express";

import { extractApplicantAccessToken } from "./extractApplicantAccessToken";

export type RateLimitWindowResult = {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
};

type WindowEntry = {
  count: number;
  /** Exclusive end of the fixed window (epoch ms). */
  resetAt: number;
};

const PRUNE_INTERVAL_MS = 60_000;

/** Fixed-window counter with automatic expiry / prune. */
export class FixedWindowRateLimiter {
  private readonly store = new Map<string, WindowEntry>();
  private lastPruneAt = Date.now();

  constructor(
    readonly name: string,
    readonly max: number,
    readonly windowMs: number
  ) {}

  size(): number {
    return this.store.size;
  }

  resetAll(): void {
    this.store.clear();
    this.lastPruneAt = Date.now();
  }

  tryConsume(key: string, now: number = Date.now()): RateLimitWindowResult {
    this.maybePrune(now);
    const safeKey = `${this.name}:${key}`;
    let entry = this.store.get(safeKey);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(safeKey, entry);
    }
    if (entry.count >= this.max) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    entry.count += 1;
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, this.max - entry.count),
    };
  }

  private maybePrune(now: number): void {
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    for (const [k, entry] of this.store) {
      if (now >= entry.resetAt) this.store.delete(k);
    }
  }
}

export function isTrustedProxyEnvironment(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.RENDER === "true" || env.EDUCLEAR_TRUST_PROXY === "1";
}

/**
 * Safe client IP for rate-limit keying. Never enables Express trust proxy.
 */
export function getClientIpForRateLimit(
  req: Pick<Request, "headers" | "socket">,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (isTrustedProxyEnvironment(env)) {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      ?.trim();
    if (forwarded) return forwarded;
  }
  return String(req.socket?.remoteAddress || "").trim() || "unknown";
}

/** Non-reversible short fingerprint — never log the raw token. */
export function applicantTokenFingerprint(token: string): string {
  const raw = String(token || "").trim();
  if (!raw) return "none";
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

export function paramSlug(req: Request): string {
  const value = (req.params as Record<string, string | undefined>).schoolSlug;
  return String(value || "")
    .trim()
    .toLowerCase() || "unknown";
}

function sendRateLimited(res: Response, retryAfterSec: number): void {
  res.setHeader("Retry-After", String(Math.max(1, retryAfterSec)));
  res.setHeader("Cache-Control", "no-store");
  res.status(429).json({
    success: false,
    error: "Too many requests",
    code: "RATE_LIMITED",
  });
}

export type RateLimitMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void;

function composeLimiters(
  buildKeys: (req: Request) => string[],
  limiters: FixedWindowRateLimiter[]
): RateLimitMiddleware {
  return (req, res, next) => {
    const keys = buildKeys(req);
    let worstRetry = 1;
    for (const limiter of limiters) {
      for (const key of keys) {
        const result = limiter.tryConsume(key);
        if (!result.allowed) {
          worstRetry = Math.max(worstRetry, result.retryAfterSec);
          return sendRateLimited(res, worstRetry);
        }
      }
    }
    return next();
  };
}

/** Shared limiter instances (module-scoped). */
export const oaConfigLimiter = new FixedWindowRateLimiter("oa-config", 60, 60_000);
export const oaDraftCreate15mLimiter = new FixedWindowRateLimiter(
  "oa-draft-15m",
  5,
  15 * 60_000
);
export const oaDraftCreateHourLimiter = new FixedWindowRateLimiter(
  "oa-draft-1h",
  20,
  60 * 60_000
);
export const oaDraftCreateHourSlugLimiter = new FixedWindowRateLimiter(
  "oa-draft-1h-slug",
  10,
  60 * 60_000
);
export const oaTokenReadLimiter = new FixedWindowRateLimiter("oa-token-read", 120, 60_000);
export const oaTokenWriteLimiter = new FixedWindowRateLimiter("oa-token-write", 30, 60_000);
export const oaDocUploadHourLimiter = new FixedWindowRateLimiter(
  "oa-doc-1h",
  10,
  60 * 60_000
);
export const oaDocUploadDayLimiter = new FixedWindowRateLimiter(
  "oa-doc-1d",
  20,
  24 * 60 * 60_000
);
export const oaPaymentProofHourLimiter = new FixedWindowRateLimiter(
  "oa-pop-1h",
  5,
  60 * 60_000
);
export const oaSubmitHourLimiter = new FixedWindowRateLimiter(
  "oa-submit-1h",
  10,
  60 * 60_000
);

const ALL_LIMITERS = [
  oaConfigLimiter,
  oaDraftCreate15mLimiter,
  oaDraftCreateHourLimiter,
  oaDraftCreateHourSlugLimiter,
  oaTokenReadLimiter,
  oaTokenWriteLimiter,
  oaDocUploadHourLimiter,
  oaDocUploadDayLimiter,
  oaPaymentProofHourLimiter,
  oaSubmitHourLimiter,
];

/** Test helper — clears all OA rate-limit counters. */
export function resetPublicAdmissionsRateLimiters(): void {
  for (const limiter of ALL_LIMITERS) limiter.resetAll();
}

function ipKey(req: Request): string {
  return `ip:${getClientIpForRateLimit(req)}`;
}

function ipSlugKey(req: Request): string {
  return `ip:${getClientIpForRateLimit(req)}|slug:${paramSlug(req)}`;
}

function ipTokenKey(req: Request): string {
  const token = extractApplicantAccessToken(req) || "";
  return `ip:${getClientIpForRateLimit(req)}|tok:${applicantTokenFingerprint(token)}`;
}

export const rateLimitPublicConfig: RateLimitMiddleware = composeLimiters(
  (req) => [ipSlugKey(req)],
  [oaConfigLimiter]
);

/** Draft create: IP 15m + IP hour + IP+slug hour. */
export function rateLimitDraftCreate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ip = ipKey(req);
  const ipSlug = ipSlugKey(req);
  const checks: Array<{ limiter: FixedWindowRateLimiter; key: string }> = [
    { limiter: oaDraftCreate15mLimiter, key: ip },
    { limiter: oaDraftCreateHourLimiter, key: ip },
    { limiter: oaDraftCreateHourSlugLimiter, key: ipSlug },
  ];
  let worstRetry = 1;
  for (const { limiter, key } of checks) {
    const result = limiter.tryConsume(key);
    if (!result.allowed) {
      worstRetry = Math.max(worstRetry, result.retryAfterSec);
      return sendRateLimited(res, worstRetry);
    }
  }
  return next();
}

export const rateLimitApplicantRead: RateLimitMiddleware = composeLimiters(
  (req) => [ipTokenKey(req)],
  [oaTokenReadLimiter]
);

export const rateLimitApplicantWrite: RateLimitMiddleware = composeLimiters(
  (req) => [ipTokenKey(req)],
  [oaTokenWriteLimiter]
);

export function rateLimitDocumentUpload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = ipTokenKey(req);
  const hour = oaDocUploadHourLimiter.tryConsume(key);
  if (!hour.allowed) return sendRateLimited(res, hour.retryAfterSec);
  const day = oaDocUploadDayLimiter.tryConsume(key);
  if (!day.allowed) return sendRateLimited(res, day.retryAfterSec);
  return next();
}

export const rateLimitPaymentProofUpload: RateLimitMiddleware = composeLimiters(
  (req) => [ipTokenKey(req)],
  [oaPaymentProofHourLimiter]
);

export const rateLimitSubmit: RateLimitMiddleware = composeLimiters(
  (req) => [ipTokenKey(req)],
  [oaSubmitHourLimiter]
);
