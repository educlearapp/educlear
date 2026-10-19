/**
 * Duplicate protection for Communication Centre SMS.
 * The send is recorded before WinSMS is contacted. A later request with the same
 * school, message, text and recipients does not call the provider again.
 * Phone numbers are hashed into the fingerprint and are not stored.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const COMMUNICATION_SMS_DUPLICATE_CODE = "DUPLICATE_COMMUNICATION_SMS";
export const COMMUNICATION_SMS_RESEND_REASON_CODE = "RESEND_REASON_REQUIRED";
export const COMMUNICATION_SMS_RESEND_REASON_MIN = 15;
export const COMMUNICATION_SMS_IN_PROGRESS_STALE_MS = 3 * 60 * 1000;

export type CommunicationSmsStoredOutcome = "accepted" | "partial" | "rejected" | "uncertain";

export type CommunicationSmsOperation = {
  operationId: string;
  schoolId: string;
  messageId: string;
  fingerprint: string;
  recipientCount: number;
  state: "in_progress" | "completed";
  createdAt: string;
  completedAt?: string;
  outcome?: CommunicationSmsStoredOutcome;
  attemptedDestinations: number;
  successfulDestinations: number;
  failedDestinations: number;
  unconfirmedDestinations: number;
  resendOf?: string;
  resendReason?: string;
  actorUserId?: string;
};

type StoreFile = { operations: CommunicationSmsOperation[] };

let testDataDir: string | null = null;

export function setCommunicationSmsDuplicateGuardDataDirForTests(dataDir: string | null): void {
  testDataDir = dataDir ? path.resolve(dataDir) : null;
}

function dataDir(): string {
  return testDataDir ?? path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), "communication-sms-operations.json");
}

function lockPath(): string {
  return path.join(dataDir(), ".communication-sms-operations.lock");
}

export function communicationSmsRecipientKey(contactId: string, mobileNumber: string): string {
  const digits = String(mobileNumber || "").replace(/\D/g, "");
  const hash = crypto.createHash("sha256").update(digits).digest("hex");
  return `${String(contactId || "").trim()}:${hash}`;
}

export function communicationSmsFingerprint(input: {
  schoolId: string;
  messageId: string;
  message: string;
  recipientKeys: string[];
}): string {
  const keys = [...new Set(input.recipientKeys.map((key) => String(key || "").trim()).filter(Boolean))].sort();
  const raw = [input.schoolId.trim(), input.messageId.trim(), input.message.trim(), ...keys].join("\n");
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
  throw new Error("Communication SMS send log is busy. Wait a moment and try again. Nothing was sent.");
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

export type CommunicationSmsDuplicateResponse = {
  ok: false;
  status: 400 | 409;
  code: string;
  duplicateBlocked: true;
  error: string;
  summary: string;
  simulated: false;
  operationId: string;
  inProgress: boolean;
};

function blocksAutomaticRetry(op: CommunicationSmsOperation): boolean {
  if (op.state === "in_progress") return true;
  return op.outcome !== "rejected";
}

function isFreshInProgress(op: CommunicationSmsOperation, nowMs: number): boolean {
  return op.state === "in_progress" && nowMs - Date.parse(op.createdAt) < COMMUNICATION_SMS_IN_PROGRESS_STALE_MS;
}

export function claimCommunicationSmsSend(input: {
  schoolId: string;
  messageId: string;
  message: string;
  recipientKeys: string[];
  now?: Date;
  confirmResend?: boolean;
  resendReason?: string;
  actorUserId?: string;
}): { claimed: true; operationId: string } | { claimed: false; response: CommunicationSmsDuplicateResponse } {
  const now = input.now || new Date();
  const fingerprint = communicationSmsFingerprint(input);
  const keys = [...new Set(input.recipientKeys.map((key) => String(key || "").trim()).filter(Boolean))];

  return withLock(() => {
    const store = readStore();
    const matches = store.operations
      .filter((op) => op.schoolId === input.schoolId && op.fingerprint === fingerprint)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = matches[0];
    if (latest && blocksAutomaticRetry(latest)) {
      const fresh = isFreshInProgress(latest, now.getTime());
      const summary = fresh
        ? "This Communication Centre SMS is already being sent. EduClear did not contact WinSMS again."
        : latest.outcome === "uncertain" || latest.state === "in_progress"
          ? "A previous send of this message has no confirmed WinSMS result. EduClear did not send it again. Check sent history before using an intentional resend."
          : "This message was already submitted to these recipients. EduClear did not send it again. An intentional resend has to be recorded separately.";
      if (fresh || !input.confirmResend) {
        return {
          claimed: false as const,
          response: {
            ok: false,
            status: 409,
            code: COMMUNICATION_SMS_DUPLICATE_CODE,
            duplicateBlocked: true,
            error: summary,
            summary,
            simulated: false,
            operationId: latest.operationId,
            inProgress: fresh,
          },
        };
      }
      const reason = String(input.resendReason || "").trim();
      if (reason.length < COMMUNICATION_SMS_RESEND_REASON_MIN) {
        const short = `An intentional resend needs a written reason of at least ${COMMUNICATION_SMS_RESEND_REASON_MIN} characters. Nothing was sent.`;
        return {
          claimed: false as const,
          response: {
            ok: false,
            status: 400,
            code: COMMUNICATION_SMS_RESEND_REASON_CODE,
            duplicateBlocked: true,
            error: short,
            summary: short,
            simulated: false,
            operationId: latest.operationId,
            inProgress: false,
          },
        };
      }
    }

    const operation: CommunicationSmsOperation = {
      operationId: crypto.randomUUID(),
      schoolId: input.schoolId,
      messageId: input.messageId,
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

export function completeCommunicationSmsSend(
  operationId: string,
  result: {
    outcome: CommunicationSmsStoredOutcome;
    attemptedDestinations: number;
    successfulDestinations: number;
    failedDestinations: number;
    unconfirmedDestinations: number;
  }
): void {
  withLock(() => {
    const store = readStore();
    const operation = store.operations.find((op) => op.operationId === operationId);
    if (!operation || operation.state === "completed") return;
    operation.state = "completed";
    operation.completedAt = new Date().toISOString();
    operation.outcome = result.outcome;
    operation.attemptedDestinations = result.attemptedDestinations;
    operation.successfulDestinations = result.successfulDestinations;
    operation.failedDestinations = result.failedDestinations;
    operation.unconfirmedDestinations = result.unconfirmedDestinations;
    writeStore(store);
  });
}

export function communicationSmsStoredOutcome(counts: {
  accepted: number;
  delivered: number;
  rejected: number;
  failed: number;
  unknown: number;
  pending: number;
}): CommunicationSmsStoredOutcome {
  if (counts.unknown > 0 || counts.pending > 0) return "uncertain";
  const accepted = counts.accepted + counts.delivered;
  const failed = counts.rejected + counts.failed;
  if (accepted > 0 && failed > 0) return "partial";
  if (accepted > 0) return "accepted";
  if (failed > 0) return "rejected";
  return "uncertain";
}

export function readCommunicationSmsOperationsForTests(): CommunicationSmsOperation[] {
  return readStore().operations;
}
