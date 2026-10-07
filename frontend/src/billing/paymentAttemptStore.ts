/**
 * Durable Capture Payment attempts (same browser only).
 * Keeps the idempotency key for an uncertain save so refresh / Back / reopen retries
 * reuse it instead of creating a second payment. Stores no names, notes, tokens or payloads.
 */

export const PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY = "educlear:pendingPaymentAttempts:v1";
export const PENDING_PAYMENT_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING_ATTEMPTS = 50;

export type PaymentAttemptIdentityInput = {
  schoolId: unknown;
  familyAccountId: unknown;
  amount: unknown;
  date: unknown;
  method: unknown;
};

export type PaymentAttemptIdentity = {
  schoolId: string;
  familyAccountId: string;
  amountCents: number;
  date: string;
  method: string;
};

export type PendingPaymentAttempt = PaymentAttemptIdentity & {
  idempotencyKey: string;
  createdAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PaymentAttemptStoreOptions = {
  storage?: StorageLike;
  now?: number;
  generateKey?: () => string;
};

const memoryFallback = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (key) => (memoryFallback.has(key) ? memoryFallback.get(key)! : null),
  setItem: (key, value) => {
    memoryFallback.set(key, String(value));
  },
  removeItem: (key) => {
    memoryFallback.delete(key);
  },
};

function resolveStorage(opts?: PaymentAttemptStoreOptions): StorageLike {
  if (opts?.storage) return opts.storage;
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {
    /* storage blocked (privacy mode) */
  }
  return memoryStorage;
}

/** Integer cents — 1400, "1400", "1400.00" and "1,400.00" share one identity. */
export function normalizeAttemptAmountCents(value: unknown): number | null {
  const raw = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const cents = Math.round(raw * 100);
  return cents > 0 ? cents : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns null while any identity field is missing — never reconcile a partial identity. */
export function buildPaymentAttemptIdentity(
  input: PaymentAttemptIdentityInput
): PaymentAttemptIdentity | null {
  const schoolId = String(input.schoolId ?? "").trim();
  const familyAccountId = String(input.familyAccountId ?? "").trim();
  const date = String(input.date ?? "").trim().slice(0, 10);
  const method = String(input.method ?? "").trim();
  const amountCents = normalizeAttemptAmountCents(input.amount);
  if (!schoolId || !familyAccountId || !method || !ISO_DATE.test(date) || amountCents === null) {
    return null;
  }
  return { schoolId, familyAccountId, amountCents, date, method };
}

export function paymentAttemptIdentityKey(identity: PaymentAttemptIdentity): string {
  return [
    identity.schoolId,
    identity.familyAccountId,
    String(identity.amountCents),
    identity.date,
    identity.method,
  ].join("|");
}

export function generatePaymentIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPendingAttempt(value: unknown): value is PendingPaymentAttempt {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.idempotencyKey === "string" &&
    /^[A-Za-z0-9_-]{1,120}$/.test(row.idempotencyKey) &&
    typeof row.schoolId === "string" &&
    row.schoolId.length > 0 &&
    typeof row.familyAccountId === "string" &&
    row.familyAccountId.length > 0 &&
    typeof row.amountCents === "number" &&
    Number.isInteger(row.amountCents) &&
    row.amountCents > 0 &&
    typeof row.date === "string" &&
    ISO_DATE.test(row.date) &&
    typeof row.method === "string" &&
    row.method.length > 0 &&
    typeof row.createdAt === "number" &&
    Number.isFinite(row.createdAt)
  );
}

function toStoredAttempt(row: PendingPaymentAttempt): PendingPaymentAttempt {
  return {
    idempotencyKey: row.idempotencyKey,
    schoolId: row.schoolId,
    familyAccountId: row.familyAccountId,
    amountCents: row.amountCents,
    date: row.date,
    method: row.method,
    createdAt: row.createdAt,
  };
}

function readRaw(storage: StorageLike): unknown[] {
  try {
    const raw = storage.getItem(PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAttempts(storage: StorageLike, attempts: PendingPaymentAttempt[]) {
  try {
    if (!attempts.length) {
      storage.removeItem(PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY);
      return;
    }
    storage.setItem(
      PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY,
      JSON.stringify(attempts.map(toStoredAttempt))
    );
  } catch {
    /* quota / privacy mode — in-flight React state still holds the key */
  }
}

function isExpired(attempt: PendingPaymentAttempt, now: number): boolean {
  return now - attempt.createdAt > PENDING_PAYMENT_ATTEMPT_TTL_MS;
}

/** Valid, unexpired attempts. Expired or malformed rows are pruned from storage. */
export function listPendingPaymentAttempts(opts?: PaymentAttemptStoreOptions): PendingPaymentAttempt[] {
  const storage = resolveStorage(opts);
  const now = opts?.now ?? Date.now();
  const raw = readRaw(storage);
  const valid = raw.filter(isPendingAttempt).map(toStoredAttempt);
  const live = valid.filter((attempt) => !isExpired(attempt, now));
  if (live.length !== raw.length) writeAttempts(storage, live);
  return live;
}

export function listPendingPaymentAttemptsForAccount(
  schoolId: unknown,
  familyAccountId: unknown,
  opts?: PaymentAttemptStoreOptions
): PendingPaymentAttempt[] {
  const sid = String(schoolId ?? "").trim();
  const fid = String(familyAccountId ?? "").trim();
  if (!sid || !fid) return [];
  return listPendingPaymentAttempts(opts)
    .filter((attempt) => attempt.schoolId === sid && attempt.familyAccountId === fid)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function findPendingPaymentAttempt(
  identity: PaymentAttemptIdentity,
  opts?: PaymentAttemptStoreOptions
): PendingPaymentAttempt | null {
  const key = paymentAttemptIdentityKey(identity);
  return (
    listPendingPaymentAttempts(opts).find((attempt) => paymentAttemptIdentityKey(attempt) === key) ||
    null
  );
}

/** Same identity → same pending key; any identity change → a new attempt. */
export function getOrCreatePendingPaymentAttempt(
  identity: PaymentAttemptIdentity,
  opts?: PaymentAttemptStoreOptions
): PendingPaymentAttempt {
  const storage = resolveStorage(opts);
  const now = opts?.now ?? Date.now();
  const live = listPendingPaymentAttempts({ ...opts, storage, now });
  const identityKey = paymentAttemptIdentityKey(identity);
  const existing = live.find((attempt) => paymentAttemptIdentityKey(attempt) === identityKey);
  if (existing) return existing;

  const attempt: PendingPaymentAttempt = {
    ...identity,
    idempotencyKey: (opts?.generateKey || generatePaymentIdempotencyKey)(),
    createdAt: now,
  };
  const next = [...live, attempt]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_PENDING_ATTEMPTS);
  writeAttempts(storage, next);
  return attempt;
}

export function removePendingPaymentAttempt(
  idempotencyKey: string,
  opts?: PaymentAttemptStoreOptions
): void {
  const key = String(idempotencyKey || "").trim();
  if (!key) return;
  const storage = resolveStorage(opts);
  const raw = readRaw(storage);
  const remaining = raw
    .filter(isPendingAttempt)
    .map(toStoredAttempt)
    .filter((attempt) => attempt.idempotencyKey !== key);
  if (remaining.length !== raw.length) writeAttempts(storage, remaining);
}

export function formatPendingAttemptAmount(attempt: Pick<PendingPaymentAttempt, "amountCents">): number {
  return attempt.amountCents / 100;
}
