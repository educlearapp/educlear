import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";
import type { StatementSmsContact } from "./statementSmsApi";
import { STATEMENT_SMS_MAX_CHARS, STATEMENT_SMS_SEGMENT_CHARS } from "./statementSmsApi";

export type BulkStatementSmsRecipientStrategy = "recommended" | "all_eligible";

export type BulkStatementSmsAccountOverride = {
  familyAccountId: string;
  selectionMode: "recommended" | "all" | "parentIds";
  parentIds?: string[];
};

/** Preview-safe recipient — never includes a full cellphone number. */
export type BulkStatementSmsPreviewRecipient = {
  displayName: string;
  mobileMasked: string;
  accountNo: string;
  parentIds?: string[];
};

export type BulkStatementSmsAccountPreview = {
  familyAccountId: string;
  accountRef: string;
  accountNo: string;
  balance: number;
  status: "eligible" | "skipped";
  skipReason: string | null;
  skipMessage: string | null;
  contacts: StatementSmsContact[];
  recommendedParentId: string | null;
  selectedParentIds: string[];
  /** Final destinations after consent + duplicate removal (masked only). */
  recipients?: BulkStatementSmsPreviewRecipient[];
  destinationCount: number;
  duplicateMobilesRemoved: number;
  sampleMessage: string | null;
  charCount: number;
  segments: number;
};

export type BulkStatementSmsPreview = {
  success: true;
  requestedAccountCount: number;
  eligibleAccountCount: number;
  skippedAccountCount: number;
  destinationCount: number;
  duplicateNumbersRemoved: number;
  totalOutstanding: number;
  estimatedSegments: number;
  recipientStrategy: BulkStatementSmsRecipientStrategy;
  messageTemplate: string;
  defaultMessageTemplate: string;
  maxChars: number;
  segmentChars: number;
  sampleMessages: string[];
  /** Flat final-preview recipient list (masked only). */
  recipients?: BulkStatementSmsPreviewRecipient[];
  accounts: BulkStatementSmsAccountPreview[];
  smsReady: boolean;
  outboundDisabled: boolean;
  canSend: boolean;
  concurrency: number;
};

export type BulkStatementSmsSendResponse = {
  success: boolean;
  ok?: boolean;
  status?: number;
  simulated?: boolean;
  summary?: string;
  error?: string;
  code?: string;
  message?: string;
  requestedAccountCount?: number;
  eligibleAccountCount?: number;
  skippedAccountCount?: number;
  attemptedDestinations?: number;
  successfulDestinations?: number;
  failedDestinations?: number;
  results?: Array<{
    familyAccountId: string;
    accountNo: string;
    parentIds: string[];
    displayNames: string[];
    mobileMasked: string;
    status: "sent" | "failed";
    error: string | null;
  }>;
  accountResults?: Array<{
    familyAccountId: string;
    accountNo: string;
    balance: number;
    sentCount: number;
    failedCount: number;
    status: "skipped" | "sent" | "partial" | "failed";
  }>;
  skippedAccounts?: BulkStatementSmsAccountPreview[];
};

export const BULK_STATEMENT_SMS_DEFAULT_TEMPLATE =
  "{{schoolName}}: Account {{accountNo}} has an outstanding balance of {{amount}}. Please view your statement for details. Thank you.";

export { STATEMENT_SMS_MAX_CHARS, STATEMENT_SMS_SEGMENT_CHARS };

export function estimateBulkTemplateSegments(template: string): number {
  const len = String(template || "").trim().length;
  if (len <= 0) return 0;
  return Math.max(1, Math.ceil(len / STATEMENT_SMS_SEGMENT_CHARS));
}

export function formatBulkSmsPreviewRecipientLine(
  recipient: BulkStatementSmsPreviewRecipient
): string {
  const name = String(recipient.displayName || "").trim() || "Parent / Guardian";
  const masked = String(recipient.mobileMasked || "").trim() || "•••• ????";
  const accountNo = String(recipient.accountNo || "").trim() || "Account";
  return `${name} — ${masked} — ${accountNo}`;
}

/** Prefer top-level preview.recipients; fall back to per-account recipients. */
export function collectBulkSmsPreviewRecipients(
  preview: Pick<BulkStatementSmsPreview, "recipients" | "accounts"> | null | undefined
): BulkStatementSmsPreviewRecipient[] {
  if (!preview) return [];
  if (Array.isArray(preview.recipients) && preview.recipients.length) {
    return preview.recipients;
  }
  const out: BulkStatementSmsPreviewRecipient[] = [];
  for (const account of preview.accounts || []) {
    if (account.status !== "eligible") continue;
    for (const row of account.recipients || []) {
      out.push(row);
    }
  }
  return out;
}

/** True when a string appears to contain an unmasked SA cellphone (10+ digits). */
export function looksLikeFullCellphone(value: unknown): boolean {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10;
}

export async function fetchBulkStatementSmsPreview(input: {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy: BulkStatementSmsRecipientStrategy;
  accountOverrides?: BulkStatementSmsAccountOverride[];
  messageTemplate?: string;
}): Promise<BulkStatementSmsPreview> {
  const res = await fetch(`${API_URL}/api/statements/bulk-sms-preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeaders(),
    },
    body: JSON.stringify({
      schoolId: input.schoolId,
      familyAccountIds: input.familyAccountIds,
      recipientStrategy: input.recipientStrategy,
      accountOverrides: input.accountOverrides || [],
      messageTemplate: input.messageTemplate,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as
    | BulkStatementSmsPreview
    | { success?: false; error?: string; message?: string };
  if (!res.ok || json.success !== true) {
    const err = json as { error?: string; message?: string };
    throw new Error(err.error || err.message || "Could not preview bulk statement SMS.");
  }
  return json;
}

export async function sendBulkStatementSmsRequest(input: {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy: BulkStatementSmsRecipientStrategy;
  accountOverrides?: BulkStatementSmsAccountOverride[];
  messageTemplate?: string;
}): Promise<BulkStatementSmsSendResponse> {
  const res = await fetch(`${API_URL}/api/statements/bulk-send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeaders(),
    },
    body: JSON.stringify({
      schoolId: input.schoolId,
      familyAccountIds: input.familyAccountIds,
      recipientStrategy: input.recipientStrategy,
      accountOverrides: input.accountOverrides || [],
      messageTemplate: input.messageTemplate,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as BulkStatementSmsSendResponse;
  if (!res.ok && !json.success) {
    throw new Error(json.error || json.message || "Bulk SMS send failed.");
  }
  return json;
}

export function summarizeSelectedOutstanding(
  rows: Array<{ familyAccountId: string | null; accountRef?: string; outstandingBalance: number }>,
  selectedKeys: Record<string, boolean>,
  keyOf: (row: { familyAccountId: string | null; accountRef?: string }) => string
): { count: number; total: number; familyAccountIds: string[] } {
  let count = 0;
  let total = 0;
  const familyAccountIds: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!selectedKeys[key]) continue;
    count += 1;
    total += Number(row.outstandingBalance) || 0;
    const fa = String(row.familyAccountId || "").trim();
    if (fa && !seen.has(fa)) {
      seen.add(fa);
      familyAccountIds.push(fa);
    }
  }
  return { count, total, familyAccountIds };
}

export function outstandingSelectionKey(row: {
  familyAccountId: string | null;
  accountRef?: string;
}): string {
  const fa = String(row.familyAccountId || "").trim();
  if (fa) return `fa:${fa}`;
  return `ref:${String(row.accountRef || "").trim()}`;
}

export function formatBulkSmsFailureSummary(result: BulkStatementSmsSendResponse): string {
  const lines: string[] = [];
  lines.push(result.summary || "Bulk SMS result");
  lines.push(
    `Successful: ${result.successfulDestinations ?? 0} · Failed: ${
      result.failedDestinations ?? 0
    } · Skipped accounts: ${result.skippedAccountCount ?? 0}`
  );
  for (const row of result.results || []) {
    if (row.status !== "failed") continue;
    lines.push(
      `${row.accountNo} · ${row.displayNames.join(", ")} · ${row.mobileMasked} · ${
        row.error || "failed"
      }`
    );
  }
  for (const skipped of result.skippedAccounts || []) {
    lines.push(
      `${skipped.accountNo || skipped.familyAccountId} · skipped · ${
        skipped.skipMessage || skipped.skipReason || "skipped"
      }`
    );
  }
  return lines.join("\n");
}
