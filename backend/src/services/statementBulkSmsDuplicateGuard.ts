/**
 * Duplicate protection for statement bulk SMS.
 * A send is recorded before WinSMS is contacted. A later request for the same
 * school, billing period and recipient set returns the stored counts and does
 * not call the provider again. Uncertain results are never retried automatically.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const BULK_SMS_DUPLICATE_CODE = "DUPLICATE_BULK_SMS";
export const BULK_SMS_RESEND_REASON_CODE = "RESEND_REASON_REQUIRED";
export const HISTORICAL_STATEMENT_SMS_HOLD_CODE = "HISTORICAL_STATEMENT_SMS_HOLD";

/**
 * Da Silva statement bulk SMS for November 2026.
 * WinSMS accepted 60 messages at 2026-10-19 18:10 UTC. EduClear logged counts only,
 * so the recipient fingerprint cannot be rebuilt and no recipient ids are invented here.
 * Every statement bulk send for this school and period stays blocked, including an
 * intentional resend, until that batch is reconciled.
 */
export const DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD = {
  kind: "unreconciled-historical-batch" as const,
  schoolId: "cmpideqeq0000108xb6ouv9zi",
  billingPeriod: "2026-11",
  acceptedAt: "2026-10-19T18:10:34.000Z",
  acceptedDestinations: 60,
};
export const BULK_SMS_RESEND_REASON_MIN = 15;
/** In-flight sends stay closed to every caller, including an intentional resend. */
export const BULK_SMS_IN_PROGRESS_STALE_MS = 3 * 60 * 1000;

export type BulkSmsStoredOutcome = "accepted" | "partial" | "rejected" | "uncertain";

export type BulkSmsOperation = {
  operationId: string;
  schoolId: string;
  billingPeriod: string;
  fingerprint: string;
  recipientCount: number;
  state: "in_progress" | "completed";
  createdAt: string;
  completedAt?: string;
  outcome?: BulkSmsStoredOutcome;
  attemptedDestinations: number;
  successfulDestinations: number;
  failedDestinations: number;
  unconfirmedDestinations: number;
  httpStatus?: number;
  summary?: string;
  resendOf?: string;
  resendReason?: string;
  actorUserId?: string;
};

type StoreFile = { operations: BulkSmsOperation[] };

let testDataDir: string | null = null;

export function setStatementBulkSmsDuplicateGuardDataDirForTests(dataDir: string | null): void {
  testDataDir = dataDir ? path.resolve(dataDir) : null;
}

function dataDir(): string {
  return testDataDir ?? path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), "statement-bulk-sms-operations.json");
}

function lockPath(): string {
  return path.join(dataDir(), ".statement-bulk-sms-operations.lock");
}

export function statementSmsBillingPeriod(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  return `${year}-${month}`;
}

export function bulkSmsRecipientKey(familyAccountId: string, parentIds: string[]): string {
  const parents = parentIds.map((id) => String(id || "").trim()).filter(Boolean).sort();
  return `${String(familyAccountId || "").trim()}:${parents.join(",")}`;
}

export function bulkSmsSendFingerprint(input: {
  schoolId: string;
  billingPeriod: string;
  recipientStrategy: string;
  recipientKeys: string[];
}): string {
  const keys = [...new Set(input.recipientKeys.map((key) => String(key || "").trim()).filter(Boolean))].sort();
  const raw = [input.schoolId.trim(), input.billingPeriod.trim(), input.recipientStrategy.trim(), ...keys].join("\n");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function sleepMs(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* lock wait stays synchronous so two requests cannot both pass the check */
  }
}

function withLock<T>(fn: () => T): T {
  fs.mkdirSync(dataDir(), { recursive: true });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      fs.writeFileSync(lockPath(), String(process.pid), { flag: "wx" });
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockPath());
        } catch {
          /* ignore */
        }
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(lockPath());
        if (Date.now() - stat.mtimeMs > 30_000) fs.unlinkSync(lockPath());
      } catch {
        /* another process released it */
      }
      sleepMs(15);
    }
  }
  throw new Error("Bulk SMS send log is busy. Wait a moment and try again. Nothing was sent.");
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as StoreFile;
    return { operations: Array.isArray(parsed?.operations) ? parsed.operations : [] };
  } catch {
    return { operations: [] };
  }
}

function writeStore(store: StoreFile) {
  const tmp = `${storePath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, storePath());
}

export type BulkSmsDuplicateResponse = {
  ok: false;
  status: 400 | 409 | 503;
  code: string;
  duplicateBlocked: true;
  resent: false;
  inProgress: boolean;
  error: string;
  summary: string;
  simulated: false;
  operationId: string;
  billingPeriod: string;
  attemptedDestinations: number;
  successfulDestinations: number;
  failedDestinations: number;
  unconfirmedDestinations: number;
};

function countsOf(op: BulkSmsOperation | null) {
  return {
    attemptedDestinations: op?.attemptedDestinations || 0,
    successfulDestinations: op?.successfulDestinations || 0,
    failedDestinations: op?.failedDestinations || 0,
    unconfirmedDestinations: op?.unconfirmedDestinations || 0,
  };
}

function duplicateResponse(op: BulkSmsOperation, summary: string, inProgress: boolean): BulkSmsDuplicateResponse {
  return {
    ok: false,
    status: 409,
    code: BULK_SMS_DUPLICATE_CODE,
    duplicateBlocked: true,
    resent: false,
    inProgress,
    error: summary,
    summary,
    simulated: false,
    operationId: op.operationId,
    billingPeriod: op.billingPeriod,
    ...countsOf(op),
  };
}

function isFreshInProgress(op: BulkSmsOperation, nowMs: number): boolean {
  return op.state === "in_progress" && nowMs - Date.parse(op.createdAt) < BULK_SMS_IN_PROGRESS_STALE_MS;
}

function blocksAutomaticRetry(op: BulkSmsOperation): boolean {
  if (op.state === "in_progress") return true;
  return op.outcome !== "rejected";
}

export function historicalStatementSmsHold(input: {
  schoolId: string;
  billingPeriod: string;
}): BulkSmsDuplicateResponse | null {
  const schoolId = String(input.schoolId || "").trim();
  const billingPeriod = String(input.billingPeriod || "").trim();
  const hold = DA_SILVA_NOVEMBER_2026_STATEMENT_SMS_HOLD;
  if (schoolId !== hold.schoolId || billingPeriod !== hold.billingPeriod) return null;
  const summary =
    "Da Silva November 2026 statement SMS is on hold. WinSMS already accepted 60 messages on 19 October 2026 at 20:10, and EduClear did not keep the recipient list, so this send was not treated as a different selection. Nothing was sent. An ordinary Send click cannot bypass this hold.";
  return {
    ok: false,
    status: 409,
    code: HISTORICAL_STATEMENT_SMS_HOLD_CODE,
    duplicateBlocked: true,
    resent: false,
    inProgress: false,
    error: summary,
    summary,
    simulated: false,
    operationId: "historical-hold-da-silva-2026-11",
    billingPeriod: hold.billingPeriod,
    attemptedDestinations: 0,
    successfulDestinations: 0,
    failedDestinations: 0,
    unconfirmedDestinations: 0,
  };
}

export function claimStatementBulkSmsSend(input: {
  schoolId: string;
  billingPeriod: string;
  recipientStrategy: string;
  recipientKeys: string[];
  now?: Date;
  confirmResend?: boolean;
  resendReason?: string;
  actorUserId?: string;
}): { claimed: true; operationId: string } | { claimed: false; response: BulkSmsDuplicateResponse } {
  const held = historicalStatementSmsHold(input);
  if (held) return { claimed: false, response: held };
  const now = input.now || new Date();
  const fingerprint = bulkSmsSendFingerprint(input);
  const keys = [...new Set(input.recipientKeys.map((key) => String(key || "").trim()).filter(Boolean))];

  return withLock(() => {
    const store = readStore();
    const matches = store.operations
      .filter((op) => op.schoolId === input.schoolId && op.fingerprint === fingerprint)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = matches[0];
    if (latest && blocksAutomaticRetry(latest)) {
      const fresh = isFreshInProgress(latest, now.getTime());
      if (fresh) {
        return {
          claimed: false as const,
          response: duplicateResponse(
            latest,
            `A bulk SMS for these accounts in ${latest.billingPeriod} is already being sent. EduClear did not contact WinSMS again. Wait for that send to finish. If the page was refreshed, the first result is kept and uncertain messages are not retried automatically.`,
            true
          ),
        };
      }
      if (!input.confirmResend) {
        const uncertain = latest.state === "in_progress" || latest.outcome === "uncertain";
        const summary = uncertain
          ? `A previous send for these accounts in ${latest.billingPeriod} has no confirmed WinSMS result (${countsOf(latest).successfulDestinations} accepted, ${countsOf(latest).failedDestinations} rejected, ${countsOf(latest).unconfirmedDestinations} not confirmed). EduClear did not send again. Check WinSMS sent history, then use an intentional resend only if those messages are absent.`
          : `These accounts were already submitted for ${latest.billingPeriod}. EduClear did not send them again. The stored result is ${countsOf(latest).successfulDestinations} accepted, ${countsOf(latest).failedDestinations} rejected, and ${countsOf(latest).unconfirmedDestinations} not confirmed. An intentional resend has to be recorded separately.`;
        return { claimed: false as const, response: duplicateResponse(latest, summary, false) };
      }
      const reason = String(input.resendReason || "").trim();
      if (reason.length < BULK_SMS_RESEND_REASON_MIN) {
        return {
          claimed: false as const,
          response: {
            ...duplicateResponse(
              latest,
              `An intentional resend needs a written reason of at least ${BULK_SMS_RESEND_REASON_MIN} characters. Nothing was sent.`,
              false
            ),
            status: 400,
            code: BULK_SMS_RESEND_REASON_CODE,
          },
        };
      }
    }

    const operation: BulkSmsOperation = {
      operationId: crypto.randomUUID(),
      schoolId: input.schoolId,
      billingPeriod: input.billingPeriod,
      fingerprint,
      recipientCount: keys.length,
      state: "in_progress",
      createdAt: now.toISOString(),
      attemptedDestinations: 0,
      successfulDestinations: 0,
      failedDestinations: 0,
      unconfirmedDestinations: 0,
      ...(latest && input.confirmResend
        ? {
            resendOf: latest.operationId,
            resendReason: String(input.resendReason || "").trim(),
            actorUserId: String(input.actorUserId || "").trim() || undefined,
          }
        : {}),
    };
    store.operations.push(operation);
    writeStore(store);
    return { claimed: true as const, operationId: operation.operationId };
  });
}

export function completeStatementBulkSmsSend(
  operationId: string,
  result: {
    outcome: BulkSmsStoredOutcome;
    attemptedDestinations: number;
    successfulDestinations: number;
    failedDestinations: number;
    unconfirmedDestinations: number;
    httpStatus?: number;
    summary?: string;
    completedAt?: string;
  }
): void {
  withLock(() => {
    const store = readStore();
    const operation = store.operations.find((op) => op.operationId === operationId);
    if (!operation || operation.state === "completed") return;
    operation.state = "completed";
    operation.completedAt = result.completedAt || new Date().toISOString();
    operation.outcome = result.outcome;
    operation.attemptedDestinations = result.attemptedDestinations;
    operation.successfulDestinations = result.successfulDestinations;
    operation.failedDestinations = result.failedDestinations;
    operation.unconfirmedDestinations = result.unconfirmedDestinations;
    operation.httpStatus = result.httpStatus;
    operation.summary = result.summary;
    writeStore(store);
  });
}

export function readStatementBulkSmsOperationsForTests(): BulkSmsOperation[] {
  return readStore().operations;
}

export function classifyStoredBulkSmsOutcome(counts: {
  successfulDestinations: number;
  failedDestinations: number;
  unconfirmedDestinations: number;
}): BulkSmsStoredOutcome {
  if (counts.unconfirmedDestinations > 0) return "uncertain";
  if (counts.successfulDestinations > 0 && counts.failedDestinations > 0) return "partial";
  if (counts.successfulDestinations > 0) return "accepted";
  if (counts.failedDestinations > 0) return "rejected";
  return "uncertain";
}
