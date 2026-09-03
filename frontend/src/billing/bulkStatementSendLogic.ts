/**
 * Bulk statement recipient selection, dedupe, and sequential live send.
 * Live delivery uses the proven sendStatementEmail → /api/emails/send-statement path.
 * Does not write ledgers, invoices, payments, or FamilyAccounts.
 */
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import { normaliseBillingAmount } from "./billingLedger";
import { DEFAULT_STATEMENT_PERIOD, normalizeStatementPeriod } from "./statementPeriod";

export const BULK_STATEMENT_PERIODS = ["All Time", "Last 3 Months", "Last 6 Months", "This Year"] as const;

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

function parentCandidates(learner: any, row: any): Array<{ firstName?: string; name?: string; surname?: string; lastName?: string; relationship?: string; relation?: string; email?: string }> {
  const parents = Array.isArray(learner?.parents) ? learner.parents : [];
  if (parents.length) return parents;
  return [
    {
      firstName: row?.name,
      surname: row?.surname,
      relationship: "Parent",
      email: String(learner?.parentEmail || row?.parentEmail || "").trim(),
    },
  ];
}

function contactNameFromParent(parent: any, fallback: string): string {
  const name = `${parent?.firstName || parent?.name || ""} ${parent?.surname || parent?.lastName || ""}`.trim();
  return name || fallback;
}

export function buildBulkStatementRecipients(input: {
  rows: any[];
  learners?: any[];
}): BulkRecipient[] {
  const learnerById = new Map<string, any>();
  for (const learner of input.learners || []) {
    const id = String(learner?.id || "").trim();
    if (id) learnerById.set(id, learner);
  }

  const list: BulkRecipient[] = [];
  const seen = new Set<string>();

  for (const row of input.rows || []) {
    const learnerId = String(row?.learnerId || row?.id || "").trim();
    const learner = learnerById.get(learnerId) || row;
    const accountNo = getLearnerAccountNo(learner || row);
    const learnerName = `${row?.name || ""} ${row?.surname || ""}`.trim() || "Account";
    const parents = parentCandidates(learner, row);
    const emailsOnRow = parents
      .map((parent) => String(parent?.email || "").trim())
      .filter(Boolean);

    if (!accountNo || accountNo === "-") {
      const email = emailsOnRow[0] || "";
      const key = recipientDedupKey("-", email || `missing-account:${learnerId || learnerName}`);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: key,
        accountNo: accountNo || "",
        email,
        contactName: contactNameFromParent(parents[0], "Parent Contact"),
        relationship: String(parents[0]?.relationship || parents[0]?.relation || "Parent"),
        learnerId,
        learnerName,
        status: "SKIPPED",
        selected: false,
        skipReason: "Missing account number",
      });
      continue;
    }

    if (!emailsOnRow.length) {
      const key = recipientDedupKey(accountNo, `missing-email:${learnerId || accountNo}`);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: key,
        accountNo,
        email: "",
        contactName: "Parent Contact",
        relationship: "Parent",
        learnerId,
        learnerName,
        status: "SKIPPED",
        selected: false,
        skipReason: "Missing email",
      });
      continue;
    }

    for (const parent of parents) {
      const email = String(parent?.email || "").trim();
      if (!email) {
        const key = recipientDedupKey(accountNo, `missing-email:${learnerId}:${list.length}`);
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          id: key,
          accountNo,
          email: "",
          contactName: contactNameFromParent(parent, "Parent Contact"),
          relationship: String(parent?.relationship || parent?.relation || "Parent"),
          learnerId,
          learnerName,
          status: "SKIPPED",
          selected: false,
          skipReason: "Missing email",
        });
        continue;
      }
      const key = recipientDedupKey(accountNo, email);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: key,
        accountNo,
        email,
        contactName: contactNameFromParent(parent, "Parent Contact"),
        relationship: String(parent?.relationship || parent?.relation || "Parent"),
        learnerId,
        learnerName,
        status: "PENDING",
        selected: false,
      });
    }
  }

  return list;
}

export function isRecipientSelectable(recipient: BulkRecipient): boolean {
  return recipient.status === "PENDING" || recipient.status === "FAILED";
}

export function countEligibleRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.status !== "SKIPPED").length;
}

export function countSelectedRecipients(recipients: BulkRecipient[]): number {
  return recipients.filter((row) => row.selected && isRecipientSelectable(row)).length;
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

export function selectAllEligibleRecipients(recipients: BulkRecipient[], lock?: BulkSendLock): BulkRecipient[] {
  if (lock && isBulkSendLocked(lock)) return recipients;
  return recipients.map((row) => ({
    ...row,
    selected: isRecipientSelectable(row),
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
  sendOne: (recipient: BulkRecipient) => Promise<BulkSendOneResult>;
  onProgress?: (next: BulkRecipient[], current: number, total: number) => void;
}): Promise<BulkRecipient[]> {
  if (input.lock.inFlight) {
    return input.recipients;
  }

  const mode = input.mode || "pending";
  const targets = selectForSend(input.recipients, mode);
  if (!targets.length) return input.recipients;

  input.lock.inFlight = true;
  let next = input.recipients.map((row) => ({ ...row }));

  try {
    const total = targets.length;
    let current = 0;
    for (const target of targets) {
      current += 1;
      next = next.map((row) =>
        row.id === target.id ? { ...row, status: "SENDING" as const, errorReason: undefined } : row
      );
      input.onProgress?.(next, current, total);

      let result: BulkSendOneResult;
      try {
        result = await input.sendOne(next.find((row) => row.id === target.id) || target);
      } catch (error) {
        result = { ok: false, error: safeBulkSendError(error) };
      }

      const status = statusFromLiveSendResult(result);
      const errorReason = status === "FAILED" ? (result.ok === false ? safeBulkSendError(result.error) : "Failed to send statement email") : undefined;
      next = next.map((row) =>
        row.id === target.id
          ? {
              ...row,
              status,
              errorReason,
            }
          : row
      );
      input.onProgress?.(next, current, total);
    }
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
