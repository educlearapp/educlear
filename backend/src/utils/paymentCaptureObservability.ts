import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Structured diagnostics for Capture Payment requests.
 * Never log customer names, amounts, bank references, descriptions, emails or full idempotency keys.
 */
export type PaymentCaptureLogEvent =
  | "payment_capture_start"
  | "payment_capture_post_write"
  | "payment_capture_finish"
  | "payment_capture_client_closed"
  | "payment_attempt_status";

export type PaymentCaptureLogger = (event: PaymentCaptureLogEvent, fields: Record<string, unknown>) => void;

const defaultLogger: PaymentCaptureLogger = (event, fields) => {
  const line = JSON.stringify({ event, ...fields });
  if (event === "payment_capture_client_closed") console.warn(line);
  else console.log(line);
};

let activeLogger: PaymentCaptureLogger = defaultLogger;

/** @internal Test hook — capture structured events instead of writing to stdout. */
export function setPaymentCaptureLoggerForTests(logger: PaymentCaptureLogger | null): void {
  activeLogger = logger || defaultLogger;
}

export function logPaymentCaptureEvent(event: PaymentCaptureLogEvent, fields: Record<string, unknown>) {
  try {
    activeLogger(event, fields);
  } catch {
    /* diagnostics must never break a payment request */
  }
}

const REQUEST_ID_HEADERS = ["x-request-id", "rndr-id", "cf-ray"] as const;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolvePaymentRequestId(req: Pick<Request, "headers">): string {
  for (const header of REQUEST_ID_HEADERS) {
    const raw = req.headers?.[header];
    const value = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
    if (value && SAFE_REQUEST_ID.test(value)) return value;
  }
  return randomUUID();
}

export function idempotencyKeyPrefix(value: unknown): string {
  return String(value || "").trim().slice(0, 8);
}

export type PaymentCaptureRequestContext = {
  requestId: string;
  startedAt: number;
};

export function getPaymentCaptureContext(res: Response): PaymentCaptureRequestContext | null {
  const ctx = (res.locals as Record<string, unknown>)?.paymentCapture;
  return ctx && typeof ctx === "object" ? (ctx as PaymentCaptureRequestContext) : null;
}

/**
 * Attaches request id + finish/close listeners. "close" after a completed response is normal
 * in Node and is not reported; only close-before-finish is logged as a client disconnect.
 */
export function observePaymentCaptureRequest(req: Request, res: Response, next: NextFunction) {
  const requestId = resolvePaymentRequestId(req);
  const startedAt = Date.now();
  (res.locals as Record<string, unknown>).paymentCapture = { requestId, startedAt };
  try {
    res.setHeader("X-Request-Id", requestId);
  } catch {
    /* headers may already be sent by an upstream handler */
  }

  const authFields = () => {
    const auth = (req as Request & { capturePaymentAuth?: { authorizedSchoolId?: string; userId?: string } })
      .capturePaymentAuth;
    return {
      schoolId: auth?.authorizedSchoolId || null,
      userId: auth?.userId || null,
    };
  };

  let finished = false;
  res.once("finish", () => {
    finished = true;
    logPaymentCaptureEvent("payment_capture_finish", {
      requestId,
      ...authFields(),
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  res.once("close", () => {
    if (finished || res.writableFinished) return;
    logPaymentCaptureEvent("payment_capture_client_closed", {
      requestId,
      ...authFields(),
      headersSent: res.headersSent,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}
