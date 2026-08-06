/**
 * Resend HTTP client with per-attempt timeout and one transient-network retry.
 * Used only by the EduClear → Resend sending path.
 */

export const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";
export const RESEND_ATTEMPT_TIMEOUT_MS = 15_000;
/** Midpoint of the allowed 500–1000 ms retry delay. */
export const RESEND_RETRY_DELAY_MS = 750;
/** One initial attempt + one retry. */
export const RESEND_MAX_ATTEMPTS = 2;

export const RESEND_NETWORK_UNAVAILABLE_MESSAGE =
  "The email service could not be reached. Please try again shortly.";

/** Transient network / connect failures that may be retried once. */
export const RESEND_RETRYABLE_ERROR_CODES = [
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "ABORT_ERR",
  "TIMEOUT",
] as const;

export type ResendRetryableErrorCode = (typeof RESEND_RETRYABLE_ERROR_CODES)[number];

export class ResendNetworkUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code: string;
  readonly timedOut: boolean;
  readonly attempts: number;

  constructor(opts: { code: string; timedOut: boolean; attempts: number; cause?: unknown }) {
    super(RESEND_NETWORK_UNAVAILABLE_MESSAGE);
    this.name = "ResendNetworkUnavailableError";
    this.code = opts.code;
    this.timedOut = opts.timedOut;
    this.attempts = opts.attempts;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export function isResendNetworkUnavailableError(
  error: unknown
): error is ResendNetworkUnavailableError {
  return error instanceof ResendNetworkUnavailableError;
}

function collectErrorCodes(error: unknown, into: Set<string>, depth = 0): void {
  if (!error || depth > 6) return;
  if (typeof error === "object") {
    const err = error as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
      errno?: unknown;
    };
    if (typeof err.code === "string" && err.code) into.add(err.code);
    if (typeof err.errno === "string" && err.errno) into.add(err.errno);
    if (err.name === "AbortError" || err.name === "TimeoutError") into.add("ABORT_ERR");
    const msg = String(err.message || "");
    if (/aborted|abort(?:ed)?|timed?\s*out|timeout/i.test(msg)) {
      if (/abort/i.test(msg)) into.add("ABORT_ERR");
      if (/timed?\s*out|timeout/i.test(msg)) into.add("TIMEOUT");
    }
    if (err.cause) collectErrorCodes(err.cause, into, depth + 1);
    if (Array.isArray(err.errors)) {
      for (const nested of err.errors) collectErrorCodes(nested, into, depth + 1);
    }
  }
}

export function extractNetworkErrorCodes(error: unknown): string[] {
  const codes = new Set<string>();
  collectErrorCodes(error, codes);
  return [...codes];
}

export function isResendTransientNetworkError(error: unknown): boolean {
  if (isResendNetworkUnavailableError(error)) return true;
  const codes = extractNetworkErrorCodes(error);
  for (const code of RESEND_RETRYABLE_ERROR_CODES) {
    if (codes.includes(code)) return true;
  }
  // undici often surfaces only "fetch failed" with a nested AggregateError cause
  if (error instanceof TypeError && String((error as Error).message) === "fetch failed") {
    return (
      codes.length === 0 ||
      codes.some((c) => (RESEND_RETRYABLE_ERROR_CODES as readonly string[]).includes(c))
    );
  }
  return false;
}

export function isAbortTimeoutError(error: unknown): boolean {
  const codes = extractNetworkErrorCodes(error);
  return (
    codes.includes("ABORT_ERR") ||
    codes.includes("TIMEOUT") ||
    codes.includes("UND_ERR_CONNECT_TIMEOUT")
  );
}

export function primaryNetworkErrorCode(error: unknown): string {
  const codes = extractNetworkErrorCodes(error);
  for (const preferred of RESEND_RETRYABLE_ERROR_CODES) {
    if (codes.includes(preferred)) return preferred;
  }
  if (error instanceof TypeError && String((error as Error).message) === "fetch failed") {
    return "FETCH_FAILED";
  }
  if (error instanceof Error && error.name) return error.name;
  return "UNKNOWN";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResendSendPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    content_type?: string;
  }>;
};

export type ResendSendResult = { messageId: string };

export type ResendPostOptions = {
  apiKey: string;
  payload: ResendSendPayload;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
};

function logResend(event: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      provider: "resend",
      ...event,
    })
  );
}

async function fetchOnce(
  fetchImpl: typeof fetch,
  apiKey: string,
  payload: ResendSendPayload,
  attemptTimeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
  try {
    return await fetchImpl(RESEND_EMAIL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function formatResendHttpError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `Resend email send failed with HTTP ${status}`;
  try {
    const parsed = JSON.parse(trimmed) as { message?: string; name?: string; error?: string };
    return parsed.message || parsed.error || `${parsed.name || "Resend error"} (HTTP ${status})`;
  } catch {
    return `Resend email send failed with HTTP ${status}: ${trimmed.slice(0, 240)}`;
  }
}

/**
 * POST to Resend with a 15s AbortController timeout per attempt and at most one retry
 * for transient network failures. HTTP 4xx/5xx from Resend are not retried.
 */
export async function postResendEmail(opts: ResendPostOptions): Promise<ResendSendResult> {
  const fetchImpl = opts.fetchImpl || fetch;
  const sleepImpl = opts.sleepImpl || sleep;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? RESEND_ATTEMPT_TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? RESEND_RETRY_DELAY_MS;
  const maxAttempts = opts.maxAttempts ?? RESEND_MAX_ATTEMPTS;

  let lastNetworkError: unknown = null;
  let timedOut = false;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsUsed = attempt;
    try {
      const response = await fetchOnce(fetchImpl, opts.apiKey, opts.payload, attemptTimeoutMs);
      const body = await response.text();
      if (!response.ok) {
        logResend({
          attempt,
          retryCount: attempt - 1,
          errorCode: `HTTP_${response.status}`,
          timedOut: false,
          outcome: "http_error",
          httpStatus: response.status,
        });
        throw new Error(formatResendHttpError(response.status, body));
      }
      const parsed = body ? (JSON.parse(body) as { id?: string }) : {};
      logResend({
        attempt,
        retryCount: attempt - 1,
        errorCode: null,
        timedOut: false,
        outcome: "success",
        httpStatus: response.status,
      });
      return { messageId: parsed.id || "" };
    } catch (error) {
      if (!isResendTransientNetworkError(error)) {
        throw error;
      }

      const code = primaryNetworkErrorCode(error);
      const attemptTimedOut =
        isAbortTimeoutError(error) || code === "ETIMEDOUT" || code === "TIMEOUT";
      timedOut = timedOut || attemptTimedOut;
      lastNetworkError = error;

      const willRetry = attempt < maxAttempts;
      logResend({
        attempt,
        retryCount: attempt - 1,
        errorCode: code,
        timedOut: attemptTimedOut,
        outcome: willRetry ? "retrying" : "network_failure",
      });

      if (!willRetry) break;
      await sleepImpl(retryDelayMs);
    }
  }

  throw new ResendNetworkUnavailableError({
    code: primaryNetworkErrorCode(lastNetworkError),
    timedOut,
    attempts: attemptsUsed,
    cause: lastNetworkError,
  });
}
