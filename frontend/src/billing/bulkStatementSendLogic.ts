/**
 * Bulk statement recipient selection, dedupe, and rate-limited concurrent live send.
 * Live delivery uses the proven sendStatementEmail → /api/emails/send-statement path.
 * At most 5 requests in flight, with dispatch spacing and a single 429 retry per recipient.
 * Does not write ledgers, invoices, payments, or FamilyAccounts.
 *
 * Recipient policy (Select All default): one canonical billing contact per FamilyAccount,
 * using the same consent/ranking rules as single-statement send.
 */
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import { normaliseBillingAmount } from "./billingLedger";
import { DEFAULT_STATEMENT_PERIOD, normalizeStatementPeriod } from "./statementPeriod";
import {
  collectParentPairsForLearner,
  contactScore,
  isSchoolOrInternalRecipientEmail,
  isStatementBillingContact,
  isValidStatementEmail,
  normalizeStatementEmail,
  parentDisplayName,
  type StatementParentPair,
} from "./statementBillingContact";

export const BULK_STATEMENT_PERIODS = ["All Time", "Last 3 Months", "Last 6 Months", "This Year"] as const;

/** Hard cap on simultaneous /api/emails/send-statement requests from one bulk run. */
export const BULK_STATEMENT_SEND_CONCURRENCY = 5;
/** ~4.5 new statement requests per second from this bulk sender. */
export const BULK_STATEMENT_DISPATCH_SPACING_MS = 220;
/** Conservative frontend backoff when Retry-After is not exposed. */
export const BULK_STATEMENT_429_BACKOFF_MS = 1500;
export const BULK_STATEMENT_MAX_429_RETRIES = 1;
export const BULK_STATEMENT_CONCURRENCY_LADDER = [5, 3, 2] as const;

export function clampBulkSendConcurrency(value?: number): number {
  if (value == null || !Number.isFinite(value)) return BULK_STATEMENT_SEND_CONCURRENCY;
  const n = Math.floor(Number(value));
  if (n < 1) return BULK_STATEMENT_SEND_CONCURRENCY;
  return Math.min(n, BULK_STATEMENT_SEND_CONCURRENCY);
}

export function clampBulkDispatchSpacingMs(value?: number): number {
  if (value == null || !Number.isFinite(value)) return BULK_STATEMENT_DISPATCH_SPACING_MS;
  const n = Math.floor(Number(value));
  if (n < 0) return BULK_STATEMENT_DISPATCH_SPACING_MS;
  return Math.min(n, 2000);
}

export function nextDispatchDue(lastDispatchAt: number | null, now: number, spacingMs: number): number {
  if (spacingMs <= 0) return now;
  if (lastDispatchAt == null) return now;
  return Math.max(now, lastDispatchAt + spacingMs);
}

export function nextReducedBulkSendConcurrency(current: number): number {
  if (current > 3) return 3;
  return 2;
}

export type BulkRecipientStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";

export type BulkBatchOutcome = "COMPLETE" | "PARTIAL" | "FAILED";

export type BulkRecipient = {
  id: string;
  accountNo: string;
  email: string;
  contactName: string;
  relationship: string;
  learnerId: string;
  learnerName: string;
  status: BulkRecipientStatus;
  selected: boolean;
  /** Default Select All only includes canonical billing contacts. */
  isCanonicalBillingRecipient?: boolean;
  /** Extra opted-in contacts available for explicit manual selection only. */
  isAdditionalBillingContact?: boolean;
  skipReason?: string;
  errorReason?: string;
};

export type BulkSendLock = {
  inFlight: boolean;
};

export type BulkSendMode = "pending" | "failed_only";

export type BulkSendOneResult = {
  ok: true;
} | {
  ok: false;
  error: string;
  httpStatus?: number;
  retryAfterMs?: number;
};

export type BulkSendRateLimitState = {
  effectiveConcurrency: number;
  dispatchSpacingMs: number;
};

export type BulkSendSummary = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  outcome: BulkBatchOutcome | null;
};

export function normalizeRecipientEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function recipientDedupKey(accountNo: string, email: string): string {
  return `${String(accountNo || "").trim().toUpperCase()}|${normalizeRecipientEmail(email)}`;
}

export function matchesBulkAccountStatus(status: string, filter: string): boolean {
  if (filter === "All") return true;
  const s = String(status || "Up To Date").trim();
  if (filter === "Paid Up" || filter === "Up To Date") {
    return s === "Paid Up" || s === "Up To Date";
  }
  if (filter === "Inactive") return s === "Inactive";
  return s === filter;
}

/** Status filter only. Statement period must not exclude owing accounts. */
export function filterRowsForBulkStatementSend(
  rows: any[],
  opts: {
    accountStatus: string;
    hideCorrections?: boolean;
    includeInactiveWithBalances?: boolean;
  }
): any[] {
  const filter = String(opts.accountStatus || "All");
  return (rows || []).filter((row) => {
    const status = String(row?.status || "Up To Date");
    if (!matchesBulkAccountStatus(status, filter)) {
      if (
        !(
          opts.includeInactiveWithBalances &&
          status === "Inactive" &&
          normaliseBillingAmount(row?.balance) !== 0
        )
      ) {
        return false;
      }
    }
    if (opts.hideCorrections && String(row?.lastInvoice || "").toLowerCase().includes("correction")) {
      return false;
    }
    return true;
  });
}

export function sortBulkStatementRows(rows: any[], sortBy: string): any[] {
  const next = [...(rows || [])];
  next.sort((a, b) => {
    if (sortBy === "Surname") return String(a?.surname || "").localeCompare(String(b?.surname || ""));
    if (sortBy === "Account No") return String(a?.accountNo || "").localeCompare(String(b?.accountNo || ""));
    if (sortBy === "Balance") return normaliseBillingAmount(b?.balance) - normaliseBillingAmount(a?.balance);
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
  return next;
}

function contactNameFromParent(parent: any, fallback: string): string {
  return parentDisplayName(parent) || fallback;
}

function relationshipFromPair(pair: StatementParentPair): string {
  return String(
    pair.link?.relation ||
      pair.link?.relationship ||
      pair.parent?.relationship ||
      pair.parent?.relation ||
      "Parent"
  );
}

function accountLearnerIdsForRow(row: any): string[] {
  const ids = new Set<string>();
  const primary = String(row?.learnerId || row?.id || "").trim();
  if (primary) ids.add(primary);
  for (const id of row?.memberLearnerIds || []) {
    const clean = String(id || "").trim();
    if (clean) ids.add(clean);
  }
  return [...ids];
}

function pushSkipped(
  list: BulkRecipient[],
  seen: Set<string>,
  input: {
    accountNo: string;
    email?: string;
    contactName?: string;
    relationship?: string;
    learnerId: string;
    learnerName: string;
    skipReason: string;
    dedupeSalt?: string;
  }
): void {
  const email = String(input.email || "").trim();
  const key = recipientDedupKey(
    input.accountNo || "-",
    email || input.dedupeSalt || `skip:${input.skipReason}:${input.learnerId || input.learnerName}`
  );
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    id: key,
    accountNo: input.accountNo || "",
    email,
    contactName: input.contactName || "Parent Contact",
    relationship: input.relationship || "Parent",
    learnerId: input.learnerId,
    learnerName: input.learnerName,
    status: "SKIPPED",
    selected: false,
    isCanonicalBillingRecipient: false,
    isAdditionalBillingContact: false,
    skipReason: input.skipReason,
  });
}

/**
 * Build bulk recipients with one canonical billing contact per FamilyAccount by default.
 * Additional consented contacts remain listed for explicit manual selection only.
 */
export function buildBulkStatementRecipients(input: {
  rows: any[];
  learners?: any[];
  globalParents?: any[];
  /** Authoritative school profile email — blocks school inbox as a parent recipient. */
  schoolEmail?: string | null;
}): BulkRecipient[] {
  const learnerById = new Map<string, any>();
  for (const learner of input.learners || []) {
    const id = String(learner?.id || learner?.learnerId || "").trim();
    if (id) learnerById.set(id, learner);
  }

  const list: BulkRecipient[] = [];
  const seen = new Set<string>();
  const schoolEmail = String(input.schoolEmail || "").trim();

  for (const row of input.rows || []) {
    const learnerIds = accountLearnerIdsForRow(row);
    const primaryLearnerId = learnerIds[0] || "";
    const primaryLearner = learnerById.get(primaryLearnerId) || row;
    const accountNo = String(row?.accountNo || "").trim() || getLearnerAccountNo(primaryLearner);
    const learnerName = `${row?.name || ""} ${row?.surname || ""}`.trim() || "Account";

    if (!accountNo || accountNo === "-") {
      pushSkipped(list, seen, {
        accountNo: accountNo || "",
        learnerId: primaryLearnerId,
        learnerName,
        skipReason: "Missing account number",
        dedupeSalt: `missing-account:${primaryLearnerId || learnerName}`,
      });
      continue;
    }

    const pairs: StatementParentPair[] = [];
    const pairSeen = new Set<string>();
    for (const learnerId of learnerIds) {
      const learner = learnerById.get(learnerId);
      if (!learner) continue;
      for (const pair of collectParentPairsForLearner(learner, input.globalParents || [])) {
        const parentId = String(pair.parent?.id || "").trim();
        const email = normalizeStatementEmail(pair.parent?.email || "");
        const key = parentId || `${parentDisplayName(pair.parent)}|${email}`;
        if (!key || pairSeen.has(key)) continue;
        pairSeen.add(key);
        pairs.push(pair);
      }
    }

    if (!pairs.length) {
      const fallbackEmail = String(
        primaryLearner?.parentEmail || row?.parentEmail || ""
      ).trim();
      if (fallbackEmail) {
        pairs.push({
          parent: {
            firstName: row?.name,
            surname: row?.surname,
            relationship: "Parent",
            email: fallbackEmail,
          },
          link: {},
        });
      }
    }

    if (!pairs.length) {
      pushSkipped(list, seen, {
        accountNo,
        learnerId: primaryLearnerId,
        learnerName,
        skipReason: "Missing email",
        dedupeSalt: `missing-email:${primaryLearnerId || accountNo}`,
      });
      continue;
    }

    type Ranked = {
      pair: StatementParentPair;
      email: string;
      kind: "canonical_candidate" | "skipped";
      skipReason?: string;
    };
    const ranked: Ranked[] = [];

    for (const pair of pairs) {
      const email = String(pair.parent?.email || "").trim();
      if (!email) {
        ranked.push({
          pair,
          email: "",
          kind: "skipped",
          skipReason: "Missing email",
        });
        continue;
      }
      if (!isValidStatementEmail(email)) {
        ranked.push({
          pair,
          email,
          kind: "skipped",
          skipReason: "Invalid email",
        });
        continue;
      }
      if (isSchoolOrInternalRecipientEmail(email, schoolEmail)) {
        ranked.push({
          pair,
          email,
          kind: "skipped",
          skipReason: "School or internal email",
        });
        continue;
      }
      if (!isStatementBillingContact(pair)) {
        ranked.push({
          pair,
          email,
          kind: "skipped",
          skipReason: "Billing/email preferences disabled",
        });
        continue;
      }
      ranked.push({ pair, email, kind: "canonical_candidate" });
    }

    const candidates = ranked
      .filter((row) => row.kind === "canonical_candidate")
      .sort((a, b) => contactScore(b.pair) - contactScore(a.pair));

    for (const skipped of ranked.filter((row) => row.kind === "skipped")) {
      pushSkipped(list, seen, {
        accountNo,
        email: skipped.email,
        contactName: contactNameFromParent(skipped.pair.parent, "Parent Contact"),
        relationship: relationshipFromPair(skipped.pair),
        learnerId: primaryLearnerId,
        learnerName,
        skipReason: skipped.skipReason || "Skipped",
        dedupeSalt: skipped.email
          ? undefined
          : `missing-email:${primaryLearnerId}:${list.length}`,
      });
    }

    if (!candidates.length) {
      if (!ranked.some((row) => row.kind === "skipped")) {
        pushSkipped(list, seen, {
          accountNo,
          learnerId: primaryLearnerId,
          learnerName,
          skipReason: "No eligible billing contact",
          dedupeSalt: `no-contact:${accountNo}`,
        });
      }
      continue;
    }

    const canonical = candidates[0];
    const canonicalKey = recipientDedupKey(accountNo, canonical.email);
    if (!seen.has(canonicalKey)) {
      seen.add(canonicalKey);
      list.push({
        id: canonicalKey,
        accountNo,
        email: canonical.email,
        contactName: contactNameFromParent(canonical.pair.parent, "Parent Contact"),
        relationship: relationshipFromPair(canonical.pair),
        learnerId: primaryLearnerId,
        learnerName,
        status: "PENDING",
        selected: false,
        isCanonicalBillingRecipient: true,
        isAdditionalBillingContact: false,
      });
    }

    for (const extra of candidates.slice(1)) {
      const key = recipientDedupKey(accountNo, extra.email);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: key,
        accountNo,
        email: extra.email,
        contactName: contactNameFromParent(extra.pair.parent, "Parent Contact"),
        relationship: relationshipFromPair(extra.pair),
        learnerId: primaryLearnerId,
        learnerName,
        status: "PENDING",
        selected: false,
        isCanonicalBillingRecipient: false,
        isAdditionalBillingContact: true,
      });
    }
  }

  return list;
}

export function isRecipientSelectable(recipient: BulkRecipient): boolean {
  return recipient.status === "PENDING" || recipient.status === "FAILED";
}

export function isCanonicalBulkRecipient(recipient: BulkRecipient): boolean {
  if (recipient.status === "SKIPPED") return false;
  if (recipient.isAdditionalBillingContact) return false;
  // Explicit false excludes; undefined (legacy) counts as canonical.
  if (recipient.isCanonicalBillingRecipient === false) return false;
  return true;
}

export function countEligibleRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.status !== "SKIPPED").length;
}

/** Default Select All / account-oriented eligible count. */
export function countCanonicalEligibleRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter(
    (row) => row.status === "PENDING" && isCanonicalBulkRecipient(row)
  ).length;
}

export function countAdditionalEligibleRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter(
    (row) => row.status === "PENDING" && row.isAdditionalBillingContact
  ).length;
}

export function countSelectedRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.selected && isRecipientSelectable(row)).length;
}

export function countSelectedAccountNos(recipients: BulkRecipient[]): number {
  const accounts = new Set<string>();
  for (const row of recipients) {
    if (!(row.selected && isRecipientSelectable(row))) continue;
    const accountNo = String(row.accountNo || "").trim().toUpperCase();
    if (accountNo) accounts.add(accountNo);
  }
  return accounts.size;
}

export function countSelectedPendingRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.selected && row.status === "PENDING").length;
}

export function countSelectedFailedRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.selected && row.status === "FAILED").length;
}

export function isBulkSendButtonEnabled(recipients: BulkRecipient[]): boolean {
  return countSelectedPendingRecipients(recipients) > 0;
}

export function applyRecipientSelected(
  recipients: BulkRecipient[],
  id: string,
  selected: boolean,
  lock?: BulkSendLock
): BulkRecipient[] {
  if (lock && isBulkSendLocked(lock)) return recipients;
  return recipients.map((row) => {
    if (row.id !== id) return row;
    if (!isRecipientSelectable(row)) return { ...row, selected: false };
    return { ...row, selected };
  });
}

/** Select All selects only canonical billing contacts (one per account by default). */
export function selectAllEligibleRecipients(recipients: BulkRecipient[], lock?: BulkSendLock): BulkRecipient[] {
  if (lock && isBulkSendLocked(lock)) return recipients;
  return recipients.map((row) => ({
    ...row,
    selected: row.status === "PENDING" && isCanonicalBulkRecipient(row),
  }));
}

export function deselectAllRecipients(recipients: BulkRecipient[], lock?: BulkSendLock): BulkRecipient[] {
  if (lock && isBulkSendLocked(lock)) return recipients;
  return recipients.map((row) => ({ ...row, selected: false }));
}

export function countSkippedRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.status === "SKIPPED").length;
}

export function countPendingRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.status === "PENDING").length;
}

export function countFailedRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.status === "FAILED").length;
}

export function confirmBulkSendMessage(selectedCount: number): string {
  return `Send statements to ${selectedCount} selected recipients?`;
}

export function confirmBulkSendDetails(input: {
  accounts: number;
  emailRecipients: number;
  skipped: number;
}): string {
  return `Accounts: ${input.accounts} · Email recipients: ${input.emailRecipients} · Skipped: ${input.skipped}`;
}

export function isBulkSendLocked(lock: BulkSendLock): boolean {
  return Boolean(lock?.inFlight);
}

export function statusFromLiveSendResult(result: BulkSendOneResult | null | undefined): BulkRecipientStatus {
  if (result && result.ok === true) return "SENT";
  return "FAILED";
}

export function safeBulkSendError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Failed to send statement email");
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!trimmed) return "Failed to send statement email";
  if (/api[_-]?key|authorization:\s*bearer|sk_live|re_[A-Za-z0-9]/i.test(trimmed)) {
    return "The email service could not send this statement.";
  }
  return trimmed;
}

export function parseRetryAfterMs(text: string | undefined): number | undefined {
  const raw = String(text || "");
  const header = raw.match(/retry-after[:\s]+(\d+(?:\.\d+)?)/i);
  if (header) {
    const seconds = Number(header[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 15_000);
  }
  const ms = raw.match(/retry-after-ms[:\s]+(\d+)/i);
  if (ms) {
    const n = Number(ms[1]);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, 15_000);
  }
  return undefined;
}

export function parseBulkSendHttpStatus(error: string | undefined, httpStatus?: number): number | undefined {
  if (httpStatus && httpStatus >= 400 && httpStatus <= 599) return httpStatus;
  const text = String(error || "");
  const labeled =
    text.match(/\bHTTP[_\s-]?(\d{3})\b/i) || text.match(/\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b/i);
  if (labeled) return Number(labeled[1]);
  if (/\b429\b/.test(text) || /too many requests/i.test(text) || /rate[_ ]limit/i.test(text)) return 429;
  if (/\b422\b/.test(text)) return 422;
  return undefined;
}

export function isRetryableBulkRateLimit(result: BulkSendOneResult | null | undefined): boolean {
  if (!result || result.ok) return false;
  return parseBulkSendHttpStatus(result.error, result.httpStatus) === 429;
}

export function isPermanentBulkSendClientError(result: BulkSendOneResult | null | undefined): boolean {
  if (!result || result.ok) return false;
  const status = parseBulkSendHttpStatus(result.error, result.httpStatus);
  return status === 400 || status === 404 || status === 409 || status === 422;
}

export function resolveBulkRateLimitBackoffMs(
  result: BulkSendOneResult | null | undefined,
  fallbackMs = BULK_STATEMENT_429_BACKOFF_MS
): number {
  if (result && result.ok === false && result.retryAfterMs != null && Number.isFinite(result.retryAfterMs)) {
    return Math.max(200, Math.min(Math.floor(result.retryAfterMs), 15_000));
  }
  const parsed = result && result.ok === false ? parseRetryAfterMs(result.error) : undefined;
  if (parsed != null) return Math.max(200, parsed);
  return Math.max(200, fallbackMs);
}

export function toBulkSendFailure(error: unknown): Extract<BulkSendOneResult, { ok: false }> {
  const raw = error instanceof Error ? error.message : String(error || "Failed to send statement email");
  return {
    ok: false,
    error: safeBulkSendError(error),
    httpStatus: parseBulkSendHttpStatus(raw),
    retryAfterMs: parseRetryAfterMs(raw),
  };
}

export function summarizeBulkSend(recipients: BulkRecipient[]): BulkSendSummary {
  const skipped = recipients.filter((row) => row.status === "SKIPPED").length;
  const sent = recipients.filter((row) => row.status === "SENT").length;
  const failed = recipients.filter((row) => row.status === "FAILED").length;
  const inFlight = recipients.some((row) => row.status === "SENDING");
  const finishedAttempted = sent + failed;
  let outcome: BulkBatchOutcome | null = null;
  if (finishedAttempted > 0 && !inFlight) {
    if (failed === 0) outcome = "COMPLETE";
    else if (sent === 0) outcome = "FAILED";
    else outcome = "PARTIAL";
  }
  return {
    attempted: finishedAttempted,
    sent,
    failed,
    skipped,
    outcome,
  };
}

function selectForSend(recipients: BulkRecipient[], mode: BulkSendMode): BulkRecipient[] {
  if (mode === "failed_only") {
    return recipients.filter((row) => row.selected && row.status === "FAILED");
  }
  return recipients.filter((row) => row.selected && row.status === "PENDING");
}

export async function runBulkStatementSend(input: {
  lock: BulkSendLock;
  recipients: BulkRecipient[];
  mode?: BulkSendMode;
  concurrency?: number;
  dispatchSpacingMs?: number;
  sendOne: (recipient: BulkRecipient) => Promise<BulkSendOneResult>;
  onProgress?: (next: BulkRecipient[], current: number, total: number) => void;
  onRateLimit?: (state: BulkSendRateLimitState) => void;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
}): Promise<BulkRecipient[]> {
  if (input.lock.inFlight) {
    return input.recipients;
  }

  const mode = input.mode || "pending";
  const targets = selectForSend(input.recipients, mode);
  if (!targets.length) return input.recipients;

  const sleepImpl =
    input.sleepImpl || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowImpl = input.nowImpl || (() => Date.now());
  let effectiveConcurrency = clampBulkSendConcurrency(input.concurrency);
  let spacingMs = clampBulkDispatchSpacingMs(input.dispatchSpacingMs);
  let rateLimitHits = 0;
  input.lock.inFlight = true;
  let next = input.recipients.map((row) => ({ ...row }));
  const total = targets.length;
  let completed = 0;
  let cursor = 0;
  let lastDispatchAt: number | null = null;
  let dispatchTail = Promise.resolve();

  const reportProgress = () => {
    const sendingNow = next.filter((row) => row.status === "SENDING").length;
    input.onProgress?.(next, Math.min(completed + sendingNow, total), total);
  };

  const noteRateLimit = () => {
    rateLimitHits += 1;
    spacingMs = Math.min(1000, spacingMs + 180);
    if (rateLimitHits >= 2) {
      rateLimitHits = 0;
      effectiveConcurrency = nextReducedBulkSendConcurrency(effectiveConcurrency);
    }
    input.onRateLimit?.({ effectiveConcurrency, dispatchSpacingMs: spacingMs });
  };

  const acquireDispatch = () => {
    const previous = dispatchTail;
    let release: () => void = () => {};
    dispatchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      const now = nowImpl();
      const due = nextDispatchDue(lastDispatchAt, now, spacingMs);
      lastDispatchAt = due;
      const wait = Math.max(0, due - now);
      release();
      if (wait > 0) await sleepImpl(wait);
    });
  };

  const callSendOne = async (target: BulkRecipient): Promise<BulkSendOneResult> => {
    await acquireDispatch();
    try {
      return await input.sendOne(next.find((row) => row.id === target.id) || target);
    } catch (error) {
      return toBulkSendFailure(error);
    }
  };

  const runOne = async (target: BulkRecipient) => {
    next = next.map((row) =>
      row.id === target.id ? { ...row, status: "SENDING" as const, errorReason: undefined } : row
    );
    reportProgress();

    let result = await callSendOne(target);
    if (isRetryableBulkRateLimit(result) && !isPermanentBulkSendClientError(result)) {
      noteRateLimit();
      next = next.map((row) =>
        row.id === target.id ? { ...row, status: "SENDING" as const, errorReason: "Rate limited — retrying" } : row
      );
      reportProgress();
      await sleepImpl(resolveBulkRateLimitBackoffMs(result));
      result = await callSendOne(target);
      if (isRetryableBulkRateLimit(result)) noteRateLimit();
    }

    const status = statusFromLiveSendResult(result);
    const errorReason =
      status === "FAILED"
        ? result.ok === false
          ? safeBulkSendError(result.error)
          : "Failed to send statement email"
        : undefined;
    next = next.map((row) => (row.id === target.id ? { ...row, status, errorReason } : row));
    completed += 1;
    reportProgress();
  };

  try {
    const workerCount = Math.min(effectiveConcurrency, targets.length);
    const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
      while (true) {
        while (workerIndex >= effectiveConcurrency) {
          if (cursor >= targets.length) return;
          await sleepImpl(Math.min(50, Math.max(spacingMs, 10)));
        }
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        await runOne(targets[index]);
      }
    });
    await Promise.all(workers);
    return next;
  } finally {
    input.lock.inFlight = false;
  }
}

export function resolveBulkStatementPeriod(period: string): string {
  return normalizeStatementPeriod(period || DEFAULT_STATEMENT_PERIOD);
}

export function failedRecipientAccounts(recipients: BulkRecipient[]): Array<{ accountNo: string; email: string; errorReason: string }> {
  return recipients
    .filter((row) => row.status === "FAILED")
    .map((row) => ({
      accountNo: row.accountNo,
      email: row.email,
      errorReason: row.errorReason || "Failed to send statement email",
    }));
}
