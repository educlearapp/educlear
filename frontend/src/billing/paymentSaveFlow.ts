import {
  isUncertainPaymentRequestError,
  PaymentRequestError,
  type PaymentAttemptStatus,
  type PaymentAttemptStatusPayment,
} from "./billingApi";
import {
  getOrCreatePendingPaymentAttempt,
  removePendingPaymentAttempt,
  type PaymentAttemptIdentity,
  type PaymentAttemptStoreOptions,
  type PendingPaymentAttempt,
} from "./paymentAttemptStore";

/** Mutable so tests can run without real waits. */
export const paymentReconcileTiming = {
  afterSaveDelaysMs: [1000, 3000, 6000] as number[],
  onOpenDelaysMs: [0, 2000] as number[],
};

export const PAYMENT_SAVE_MESSAGES = {
  interrupted:
    "Connection interrupted. This payment may already have been saved. Do not capture it again. Checking payment status…",
  unexpectedResponse:
    "EduClear returned an unexpected response. This payment may already have been saved. Do not capture it again. Checking payment status…",
  notSaved:
    "Payment not found yet. You can safely retry — EduClear will reuse the same payment attempt so it cannot be duplicated.",
  unknown:
    "EduClear can't confirm the payment right now. Do not capture this payment again. We'll check its status when you return to this account.",
  checking: "Checking the status of an earlier payment attempt…",
} as const;

export function paymentConfirmedMessage(reference: string | null | undefined): string {
  const ref = String(reference || "").trim();
  return ref ? `Payment confirmed — receipt ${ref}` : "Payment confirmed";
}

export type ReconcileOutcome =
  | { status: "found"; payment: PaymentAttemptStatusPayment; allocationSaved: boolean }
  | { status: "not_found" }
  | { status: "unknown" };

export type ReconcileDeps = {
  fetchStatus: (idempotencyKey: string) => Promise<PaymentAttemptStatus>;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: number[];
  isCancelled?: () => boolean;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Polls the read-only attempt status. Never POSTs.
 * "not_found" only when the final check positively answered not found — any failed
 * final check is "unknown" so the operator is never told to re-capture on a guess.
 */
export async function reconcilePaymentAttempt(
  idempotencyKey: string,
  deps: ReconcileDeps
): Promise<ReconcileOutcome> {
  const sleep = deps.sleep || defaultSleep;
  const delays = deps.delaysMs && deps.delaysMs.length ? deps.delaysMs : [0];
  let last: "not_found" | "unknown" = "unknown";
  for (const delay of delays) {
    if (deps.isCancelled?.()) return { status: "unknown" };
    if (delay > 0) await sleep(delay);
    if (deps.isCancelled?.()) return { status: "unknown" };
    try {
      const result = await deps.fetchStatus(idempotencyKey);
      if (result.found) {
        return { status: "found", payment: result.payment, allocationSaved: result.allocationSaved };
      }
      last = "not_found";
    } catch {
      last = "unknown";
    }
  }
  return { status: last };
}

export type PaymentSaveOutcome =
  | { kind: "saved"; attempt: PendingPaymentAttempt; result: Record<string, unknown> }
  | {
      kind: "confirmed_after_interruption";
      attempt: PendingPaymentAttempt;
      payment: PaymentAttemptStatusPayment;
      allocationSaved: boolean;
    }
  | { kind: "not_saved_after_interruption"; attempt: PendingPaymentAttempt }
  | { kind: "unconfirmed"; attempt: PendingPaymentAttempt }
  | { kind: "rejected"; attempt: PendingPaymentAttempt; error: unknown };

export type PaymentSaveDeps = {
  createPayment: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchStatus: (idempotencyKey: string) => Promise<PaymentAttemptStatus>;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  store?: PaymentAttemptStoreOptions;
  /** Fired once the POST outcome is uncertain, before polling starts. */
  onUncertain?: (error: PaymentRequestError) => void;
};

/**
 * Readable EduClear JSON 4xx (validation / auth / permission / retired account). Every such
 * response from POST /api/payments is produced before appendSchoolEntrySafe; unreadable 4xx
 * bodies are classified as "network" by createPayment and never reach this check.
 */
export function isDefinitivePreWriteRejection(error: unknown): boolean {
  if (!(error instanceof PaymentRequestError)) return false;
  if (error.kind !== "http" && error.kind !== "auth") return false;
  const status = error.status;
  if (status === null || status < 400 || status >= 500) return false;
  return status !== 408 && status !== 429;
}

export function readSavedPaymentId(result: Record<string, unknown> | null | undefined): string {
  const payment = (result?.payment as Record<string, unknown> | undefined) || undefined;
  return String(payment?.id || result?.paymentId || "").trim();
}

/**
 * Single POST per press. The idempotency key comes from the durable attempt store, so a
 * retry after refresh / reopen with the same identity reuses the key the server already knows.
 */
export async function executePaymentSave(
  identity: PaymentAttemptIdentity,
  buildPayload: (idempotencyKey: string) => Record<string, unknown>,
  deps: PaymentSaveDeps
): Promise<PaymentSaveOutcome> {
  const attempt = getOrCreatePendingPaymentAttempt(identity, deps.store);
  try {
    const result = await deps.createPayment(buildPayload(attempt.idempotencyKey));
    if (readSavedPaymentId(result)) {
      removePendingPaymentAttempt(attempt.idempotencyKey, deps.store);
    }
    return { kind: "saved", attempt, result };
  } catch (error) {
    if (!isUncertainPaymentRequestError(error)) {
      if (isDefinitivePreWriteRejection(error)) {
        removePendingPaymentAttempt(attempt.idempotencyKey, deps.store);
      }
      return { kind: "rejected", attempt, error };
    }
    deps.onUncertain?.(error);
    const outcome = await reconcilePaymentAttempt(attempt.idempotencyKey, {
      fetchStatus: deps.fetchStatus,
      sleep: deps.sleep,
      delaysMs: paymentReconcileTiming.afterSaveDelaysMs,
      isCancelled: deps.isCancelled,
    });
    if (outcome.status === "found") {
      removePendingPaymentAttempt(attempt.idempotencyKey, deps.store);
      return {
        kind: "confirmed_after_interruption",
        attempt,
        payment: outcome.payment,
        allocationSaved: outcome.allocationSaved,
      };
    }
    if (outcome.status === "not_found") {
      return { kind: "not_saved_after_interruption", attempt };
    }
    return { kind: "unconfirmed", attempt };
  }
}

export type PaymentAttemptGate = "idle" | "checking" | "unknown";

export function paymentCreateControlState(input: { saving: boolean; gate: PaymentAttemptGate }) {
  return {
    saveDisabled: input.saving || input.gate === "checking" || input.gate === "unknown",
    backDisabled: input.saving || input.gate === "checking",
  };
}
