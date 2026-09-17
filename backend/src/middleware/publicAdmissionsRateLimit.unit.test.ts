/**
 * Public OA rate-limit unit tests (no DB).
 * Run: npx ts-node --transpile-only src/middleware/publicAdmissionsRateLimit.unit.test.ts
 */
import assert from "assert";
import type { Request, Response } from "express";

import {
  FixedWindowRateLimiter,
  applicantTokenFingerprint,
  getClientIpForRateLimit,
  isTrustedProxyEnvironment,
  oaDocUploadHourLimiter,
  oaDraftCreate15mLimiter,
  oaPaymentProofHourLimiter,
  oaSubmitHourLimiter,
  oaTokenWriteLimiter,
  rateLimitDocumentUpload,
  rateLimitDraftCreate,
  rateLimitPaymentProofUpload,
  rateLimitPublicConfig,
  rateLimitSubmit,
  rateLimitApplicantWrite,
  resetPublicAdmissionsRateLimiters,
} from "./publicAdmissionsRateLimit";

function mockReq(overrides: {
  ip?: string;
  slug?: string;
  token?: string;
  forwardedFor?: string;
}): Request {
  const remoteAddress = overrides.ip || "127.0.0.1";
  const headers: Record<string, string> = {};
  if (overrides.forwardedFor) headers["x-forwarded-for"] = overrides.forwardedFor;
  if (overrides.token) headers["x-admissions-access-token"] = overrides.token;
  return {
    params: { schoolSlug: overrides.slug || "oa-runtime-test" },
    headers,
    socket: { remoteAddress },
  } as unknown as Request;
}

function mockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = String(v);
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
}

function runMw(
  mw: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request
) {
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

resetPublicAdmissionsRateLimiters();

// --- IP / proxy ---
{
  assert.equal(isTrustedProxyEnvironment({} as NodeJS.ProcessEnv), false);
  assert.equal(isTrustedProxyEnvironment({ RENDER: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(isTrustedProxyEnvironment({ EDUCLEAR_TRUST_PROXY: "1" } as NodeJS.ProcessEnv), true);

  const localReq = mockReq({ ip: "10.0.0.5", forwardedFor: "203.0.113.9, 10.0.0.1" });
  assert.equal(
    getClientIpForRateLimit(localReq, {} as NodeJS.ProcessEnv),
    "10.0.0.5",
    "untrusted env ignores X-Forwarded-For"
  );
  assert.equal(
    getClientIpForRateLimit(localReq, { RENDER: "true" } as NodeJS.ProcessEnv),
    "203.0.113.9",
    "trusted env uses first forwarded hop"
  );
  console.log("✓ IP keying: local socket vs trusted first XFF hop");
}

// --- token fingerprint ---
{
  const fp = applicantTokenFingerprint("secret-token-value");
  assert.equal(fp.length, 16);
  assert.notEqual(fp, "secret-token-value");
  assert.equal(applicantTokenFingerprint("secret-token-value"), fp);
  assert.notEqual(applicantTokenFingerprint("other"), fp);
  console.log("✓ token fingerprint non-reversible + stable");
}

// --- fixed window prune ---
{
  const limiter = new FixedWindowRateLimiter("t", 2, 100);
  assert.equal(limiter.tryConsume("a").allowed, true);
  assert.equal(limiter.tryConsume("a").allowed, true);
  const blocked = limiter.tryConsume("a");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
  // expire window
  const after = limiter.tryConsume("a", Date.now() + 200);
  assert.equal(after.allowed, true);
  limiter.resetAll();
  assert.equal(limiter.size(), 0);
  console.log("✓ fixed window + reset/expiry");
}

resetPublicAdmissionsRateLimiters();

// --- draft create: allow below threshold, burst → 429 ---
{
  resetPublicAdmissionsRateLimiters();
  const req = mockReq({ ip: "198.51.100.10", slug: "school-a" });
  for (let i = 0; i < 5; i += 1) {
    const { nextCalled, res } = runMw(rateLimitDraftCreate, req);
    assert.equal(nextCalled, true, `draft create ${i + 1} should pass`);
    assert.notEqual(res.statusCode, 429);
  }
  const blocked = runMw(rateLimitDraftCreate, req);
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.deepEqual(blocked.res.body, {
    success: false,
    error: "Too many requests",
    code: "RATE_LIMITED",
  });
  assert.ok(Number(blocked.res.headers["retry-after"]) >= 1);
  console.log("✓ draft create: 5/15m then 429");
}

// --- config burst ---
{
  resetPublicAdmissionsRateLimiters();
  const req = mockReq({ ip: "198.51.100.11", slug: "school-a" });
  for (let i = 0; i < 60; i += 1) {
    assert.equal(runMw(rateLimitPublicConfig, req).nextCalled, true);
  }
  const blocked = runMw(rateLimitPublicConfig, req);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal((blocked.res.body as { code: string }).code, "RATE_LIMITED");
  console.log("✓ config: 60/min then 429");
}

// --- token write below threshold ---
{
  resetPublicAdmissionsRateLimiters();
  const req = mockReq({ ip: "198.51.100.12", token: "tok-patch-ok", slug: "school-a" });
  for (let i = 0; i < 30; i += 1) {
    assert.equal(runMw(rateLimitApplicantWrite, req).nextCalled, true);
  }
  assert.equal(runMw(rateLimitApplicantWrite, req).res.statusCode, 429);
  console.log("✓ applicant write: 30/min then 429");
}

// --- upload burst before handler (simulates no file write) ---
{
  resetPublicAdmissionsRateLimiters();
  const req = mockReq({ ip: "198.51.100.13", token: "tok-upload", slug: "school-a" });
  let passed = 0;
  for (let i = 0; i < 15; i += 1) {
    const { nextCalled, res } = runMw(rateLimitDocumentUpload, req);
    if (nextCalled) passed += 1;
    else {
      assert.equal(res.statusCode, 429);
      break;
    }
  }
  assert.equal(passed, 10, "hour limit should allow 10 uploads");
  // further calls blocked — no upload handler invoked
  assert.equal(runMw(rateLimitDocumentUpload, req).nextCalled, false);
  console.log("✓ document upload: 10/hour then 429 (before file write)");
}

// --- payment-proof burst ---
{
  resetPublicAdmissionsRateLimiters();
  const req = mockReq({ ip: "198.51.100.14", token: "tok-pop", slug: "school-a" });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(runMw(rateLimitPaymentProofUpload, req).nextCalled, true);
  }
  assert.equal(runMw(rateLimitPaymentProofUpload, req).res.statusCode, 429);
  console.log("✓ payment-proof: 5/hour then 429");
}

// --- submit limits ---
{
  resetPublicAdmissionsRateLimiters();
  const req = mockReq({ ip: "198.51.100.15", token: "tok-submit", slug: "school-a" });
  for (let i = 0; i < 10; i += 1) {
    assert.equal(runMw(rateLimitSubmit, req).nextCalled, true);
  }
  assert.equal(runMw(rateLimitSubmit, req).res.statusCode, 429);
  console.log("✓ submit: 10/hour then 429");
}

// Sanity: limiter instances used by routes are the shared ones
assert.ok(oaDraftCreate15mLimiter);
assert.ok(oaDocUploadHourLimiter);
assert.ok(oaPaymentProofHourLimiter);
assert.ok(oaSubmitHourLimiter);
assert.ok(oaTokenWriteLimiter);

resetPublicAdmissionsRateLimiters();
console.log("\nAll publicAdmissionsRateLimit unit tests passed.");
