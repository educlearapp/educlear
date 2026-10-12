/**
 * Bulk Statement SMS — Phase 1 (outstanding accounts only).
 * Reuses Phase A statement SMS helpers. Server resolves phones, balances, and messages.
 */
import {
  buildDefaultStatementSmsMessage,
  buildStatementSmsDestinations,
  formatStatementSmsAmount,
  loadEligibleStatementSmsPairs,
  rankStatementSmsContacts,
  resolveStatementSmsAccount,
  sanitiseStatementSmsMessage,
  selectStatementSmsPairs,
  STATEMENT_SMS_MAX_CHARS,
  STATEMENT_SMS_SEGMENT_CHARS,
  type StatementSmsDestination,
  type StatementSmsEligibleContact,
  type StatementSmsParentPair,
  type StatementSmsSendResultRow,
} from "./statementSmsService";
import { resolveAuthoritativeAccountBalance, roundStatementMoney } from "./statementAccounts";
import { isSchoolSmsReady, sendSchoolSms } from "./schoolSmsService";
import { WinSmsApiError } from "./winSmsClient";
import { isOutboundSmsDisabled } from "../utils/outboundSafety";

/** Matches bulk statement email concurrency (frontend BULK_STATEMENT_SEND_CONCURRENCY). */
export const BULK_STATEMENT_SMS_CONCURRENCY = 5;

export const BULK_STATEMENT_SMS_DEFAULT_TEMPLATE =
  "{{schoolName}}: Account {{accountNo}} has an outstanding balance of {{amount}}. Please view your statement for details. Thank you.";

export type BulkStatementSmsRecipientStrategy = "recommended" | "all_eligible";

export type BulkStatementSmsAccountOverride = {
  familyAccountId: string;
  /** recommended | all | parentIds */
  selectionMode: "recommended" | "all" | "parentIds";
  parentIds?: string[];
};

export type BulkStatementSmsSkipReason =
  | "ACCOUNT_NOT_FOUND"
  | "NOT_OUTSTANDING"
  | "NO_ELIGIBLE_CONTACTS"
  | "NO_VALID_MOBILE"
  | "INVALID_PARENT_SELECTION"
  | "INVALID_MESSAGE"
  | "DUPLICATE_ACCOUNT";

/** Preview-safe destination — never includes a full cellphone number. */
export type BulkStatementSmsPreviewRecipient = {
  displayName: string;
  mobileMasked: string;
  accountNo: string;
  parentIds: string[];
};

export type BulkStatementSmsAccountPreview = {
  familyAccountId: string;
  accountRef: string;
  accountNo: string;
  balance: number;
  status: "eligible" | "skipped";
  skipReason: BulkStatementSmsSkipReason | null;
  skipMessage: string | null;
  contacts: StatementSmsEligibleContact[];
  recommendedParentId: string | null;
  selectedParentIds: string[];
  /** Final SMS destinations after consent + duplicate-number removal (masked only). */
  recipients: BulkStatementSmsPreviewRecipient[];
  destinationCount: number;
  duplicateMobilesRemoved: number;
  sampleMessage: string | null;
  charCount: number;
  segments: number;
};

/**
 * Map send destinations to preview recipients without exposing full mobile numbers.
 * Uses the same mask already produced by `maskStatementSmsMobile` on destinations.
 */
export function buildSafeBulkSmsPreviewRecipients(
  destinations: StatementSmsDestination[],
  accountNo: string
): BulkStatementSmsPreviewRecipient[] {
  const acct = String(accountNo || "").trim();
  return (destinations || []).map((dest) => ({
    displayName:
      (dest.displayNames || []).map((n) => String(n || "").trim()).filter(Boolean).join(" & ") ||
      "Parent / Guardian",
    mobileMasked: String(dest.mobileMasked || "").trim(),
    accountNo: acct,
    parentIds: [...(dest.parentIds || [])],
  }));
}

export function formatBulkSmsPreviewRecipientLine(
  recipient: BulkStatementSmsPreviewRecipient
): string {
  const name = String(recipient.displayName || "").trim() || "Parent / Guardian";
  const masked = String(recipient.mobileMasked || "").trim() || "•••• ????";
  const accountNo = String(recipient.accountNo || "").trim() || "Account";
  return `${name} — ${masked} — ${accountNo}`;
}

export type BulkStatementSmsDestinationResult = Omit<StatementSmsSendResultRow, "status"> & {
  familyAccountId: string;
  accountNo: string;
  status: "sent" | "failed" | "unconfirmed";
};

/**
 * Privacy-safe Bulk SMS diagnostics. Only counts, codes, timings and the school id —
 * never names, phone numbers, emails, message text, account numbers or credentials.
 */
export type BulkStatementSmsLogEvent =
  | "bulk_sms_preview_started"
  | "bulk_sms_preview_completed"
  | "bulk_sms_preview_failed"
  | "bulk_sms_send_started"
  | "bulk_sms_send_completed"
  | "bulk_sms_send_failed";

export type BulkStatementSmsLogger = (event: BulkStatementSmsLogEvent, fields: Record<string, unknown>) => void;

const defaultBulkStatementSmsLogger: BulkStatementSmsLogger = (event, fields) => {
  const line = JSON.stringify({ event, ...fields });
  if (event.endsWith("_failed")) console.error(line);
  else console.info(line);
};

let bulkStatementSmsLogger: BulkStatementSmsLogger = defaultBulkStatementSmsLogger;

/** @internal Test hook — capture structured events instead of writing to stdout. */
export function setBulkStatementSmsLoggerForTests(logger: BulkStatementSmsLogger | null): void {
  bulkStatementSmsLogger = logger || defaultBulkStatementSmsLogger;
}

function logBulkStatementSms(event: BulkStatementSmsLogEvent, fields: Record<string, unknown>) {
  try {
    bulkStatementSmsLogger(event, fields);
  } catch {
    /* diagnostics must never break an SMS request */
  }
}

export function safeBulkSmsErrorCode(error: unknown): string {
  if (error instanceof WinSmsApiError) return `WINSMS_${error.statusCode}`;
  if (error instanceof Error) return String(error.name || "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "Error";
  return "UNKNOWN";
}

function safeProviderCode(raw: unknown): string {
  return String(raw || "").replace(/[^A-Za-z0-9_]/g, "").toUpperCase().slice(0, 32) || "UNSPECIFIED";
}

function incrementCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

/** Counts WinSMS per-recipient acceptance from a send response (recipients[].accepted / acceptError). */
export function summariseWinSmsAcceptance(response: unknown): {
  accepted: number;
  rejected: number;
  unknown: number;
  rejectCodes: Record<string, number>;
} {
  const out = { accepted: 0, rejected: 0, unknown: 0, rejectCodes: {} as Record<string, number> };
  const data = (response && typeof response === "object" ? response : {}) as Record<string, unknown>;
  const rows: unknown[] = [];
  if (Array.isArray(data.recipients)) rows.push(...data.recipients);
  if (Array.isArray(data.messages)) {
    for (const message of data.messages) {
      const recipients = (message as Record<string, unknown> | null)?.recipients;
      if (Array.isArray(recipients)) rows.push(...recipients);
    }
  }
  if (!rows.length) {
    out.unknown = 1;
    return out;
  }
  for (const row of rows) {
    const accepted = (row as Record<string, unknown> | null)?.accepted;
    if (accepted === true) out.accepted += 1;
    else if (accepted === false) {
      out.rejected += 1;
      incrementCount(out.rejectCodes, safeProviderCode((row as Record<string, unknown>).acceptError));
    } else out.unknown += 1;
  }
  return out;
}

export const BULK_SMS_UNCONFIRMED_MESSAGE =
  "WinSMS did not confirm acceptance. Check WinSMS sent history before resending.";

/**
 * WinSMS answers HTTP 200 even when it refuses the number (recipients[].accepted=false).
 * Only an explicit accepted=true is confirmed delivery. An unreadable or unrecognised response
 * is "unconfirmed": the message may have been sent, so it is neither counted as sent nor
 * reported as failed (which would invite a duplicate resend).
 */
export function classifyWinSmsDestinationOutcome(acceptance: ReturnType<typeof summariseWinSmsAcceptance>): {
  status: "sent" | "failed" | "unconfirmed";
  error: string | null;
} {
  if (acceptance.accepted > 0) return { status: "sent", error: null };
  if (acceptance.rejected > 0) {
    const codes = Object.keys(acceptance.rejectCodes).join(", ");
    return { status: "failed", error: `WinSMS rejected this number${codes ? ` (${codes})` : ""}` };
  }
  return { status: "unconfirmed", error: BULK_SMS_UNCONFIRMED_MESSAGE };
}

/**
 * Any unconfirmed destination keeps the response ok (207) so the client shows the summary
 * warning instead of a generic failure that would invite resending the whole batch.
 */
export function summariseBulkSmsDestinationOutcome(
  rows: Array<{ status: BulkStatementSmsDestinationResult["status"] }>,
  eligibleAccountCount: number,
  skippedAccountCount: number
): {
  successfulDestinations: number;
  failedDestinations: number;
  unconfirmedDestinations: number;
  ok: boolean;
  status: 200 | 207 | 502;
  summary: string;
} {
  let successfulDestinations = 0;
  let failedDestinations = 0;
  let unconfirmedDestinations = 0;
  for (const row of rows) {
    if (row.status === "sent") successfulDestinations += 1;
    else if (row.status === "unconfirmed") unconfirmedDestinations += 1;
    else failedDestinations += 1;
  }
  const counts = { successfulDestinations, failedDestinations, unconfirmedDestinations };
  const skippedText = `${skippedAccountCount} account${skippedAccountCount === 1 ? "" : "s"} skipped.`;

  if (failedDestinations === 0 && unconfirmedDestinations === 0 && successfulDestinations > 0) {
    return {
      ...counts,
      ok: true,
      status: 200,
      summary: `Bulk SMS sent successfully to ${successfulDestinations} destination${
        successfulDestinations === 1 ? "" : "s"
      } across ${eligibleAccountCount} account${eligibleAccountCount === 1 ? "" : "s"}.`,
    };
  }
  if (unconfirmedDestinations > 0) {
    return {
      ...counts,
      ok: true,
      status: 207,
      summary: `${successfulDestinations} SMS sent. ${failedDestinations} SMS failed. ${unconfirmedDestinations} SMS not confirmed by WinSMS — check WinSMS sent history before resending these. ${skippedText}`,
    };
  }
  if (successfulDestinations > 0 && failedDestinations > 0) {
    return {
      ...counts,
      ok: true,
      status: 207,
      summary: `${successfulDestinations} SMS sent. ${failedDestinations} SMS failed. ${skippedText}`,
    };
  }
  return { ...counts, ok: false, status: 502, summary: "Bulk SMS send failed." };
}

export type BulkStatementSmsSendDiagnostics = {
  stage: "validate" | "readiness" | "resolve" | "provider" | "summarise";
  resolveMs: number | null;
  providerMs: number | null;
  providerAccepted: number;
  providerRejected: number;
  providerAcceptanceUnknown: number;
  providerRejectCodes: Record<string, number>;
  errorCodes: Record<string, number>;
};

export function createBulkStatementSmsSendDiagnostics(): BulkStatementSmsSendDiagnostics {
  return {
    stage: "validate",
    resolveMs: null,
    providerMs: null,
    providerAccepted: 0,
    providerRejected: 0,
    providerAcceptanceUnknown: 0,
    providerRejectCodes: {},
    errorCodes: {},
  };
}

function countSkipReasons(rows: Array<{ skipReason?: string | null }> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows || []) {
    if (row?.skipReason) incrementCount(out, safeProviderCode(row.skipReason));
  }
  return out;
}

export function buildBulkSmsPreviewCompletedLog(
  schoolId: string,
  result: Record<string, any>,
  durationMs: number
): Record<string, unknown> {
  return {
    schoolId,
    ok: Boolean(result?.ok),
    httpStatus: result?.ok ? 200 : result?.status ?? null,
    code: result?.ok ? null : result?.code ?? null,
    requestedAccountCount: result?.requestedAccountCount ?? null,
    eligibleAccountCount: result?.eligibleAccountCount ?? null,
    skippedAccountCount: result?.skippedAccountCount ?? null,
    destinationCount: result?.destinationCount ?? null,
    skipReasons: countSkipReasons(
      Array.isArray(result?.accounts) ? result.accounts.filter((a: any) => a?.status === "skipped") : []
    ),
    smsReady: result?.smsReady ?? null,
    outboundDisabled: result?.outboundDisabled ?? null,
    canSend: result?.canSend ?? null,
    durationMs,
  };
}

export function buildBulkSmsSendCompletedLog(
  schoolId: string,
  result: Record<string, any>,
  diagnostics: BulkStatementSmsSendDiagnostics,
  durationMs: number
): Record<string, unknown> {
  return {
    schoolId,
    ok: Boolean(result?.ok),
    httpStatus: result?.status ?? null,
    code: result?.code ?? null,
    stage: diagnostics.stage,
    requestedAccountCount: result?.requestedAccountCount ?? null,
    eligibleAccountCount: result?.eligibleAccountCount ?? null,
    skippedAccountCount: result?.skippedAccountCount ?? null,
    skipReasons: countSkipReasons(result?.skippedAccounts),
    attemptedDestinations: result?.attemptedDestinations ?? 0,
    successfulDestinations: result?.successfulDestinations ?? 0,
    failedDestinations: result?.failedDestinations ?? 0,
    unconfirmedDestinations: result?.unconfirmedDestinations ?? 0,
    providerAccepted: diagnostics.providerAccepted,
    providerRejected: diagnostics.providerRejected,
    providerAcceptanceUnknown: diagnostics.providerAcceptanceUnknown,
    providerRejectCodes: diagnostics.providerRejectCodes,
    errorCodes: diagnostics.errorCodes,
    resolveMs: diagnostics.resolveMs,
    providerMs: diagnostics.providerMs,
    durationMs,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  if (!items.length) return [];
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

export function dedupeFamilyAccountIds(ids: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!Array.isArray(ids)) return out;
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseBulkRecipientStrategy(raw: unknown): BulkStatementSmsRecipientStrategy {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (value === "all" || value === "all_eligible" || value === "alleligible") {
    return "all_eligible";
  }
  return "recommended";
}

export function renderBulkStatementSmsTemplate(
  template: string,
  vars: { schoolName: string; accountNo: string; amount: string; balance: number }
): string {
  const schoolName = String(vars.schoolName || "School").trim() || "School";
  const accountNo = String(vars.accountNo || "").trim() || "Account";
  const amount = String(vars.amount || formatStatementSmsAmount(vars.balance)).trim();
  return String(template || "")
    .replace(/\{\{\s*schoolName\s*\}\}/gi, schoolName)
    .replace(/\{\{\s*accountNo\s*\}\}/gi, accountNo)
    .replace(/\{\{\s*amount\s*\}\}/gi, amount);
}

export function resolveBulkMessageForAccount(input: {
  schoolName: string;
  accountNo: string;
  balance: number;
  messageTemplate?: string | null;
}): { ok: true; message: string; charCount: number; segments: number } | { ok: false; error: string } {
  const template = String(input.messageTemplate || "").trim();
  const text = template
    ? renderBulkStatementSmsTemplate(template, {
        schoolName: input.schoolName,
        accountNo: input.accountNo,
        amount: formatStatementSmsAmount(input.balance),
        balance: input.balance,
      })
    : buildDefaultStatementSmsMessage({
        schoolName: input.schoolName,
        accountNo: input.accountNo,
        balance: input.balance,
      }).text;
  return sanitiseStatementSmsMessage(text);
}

function overrideMap(
  overrides: BulkStatementSmsAccountOverride[] | undefined
): Map<string, BulkStatementSmsAccountOverride> {
  const map = new Map<string, BulkStatementSmsAccountOverride>();
  for (const row of overrides || []) {
    const id = String(row?.familyAccountId || "").trim();
    if (!id) continue;
    map.set(id, row);
  }
  return map;
}

function resolvePairsForStrategy(
  pairs: StatementSmsParentPair[],
  strategy: BulkStatementSmsRecipientStrategy,
  override: BulkStatementSmsAccountOverride | undefined
): { ok: true; pairs: StatementSmsParentPair[]; selectedParentIds: string[] } | { ok: false; error: string; code: string } {
  const contacts = rankStatementSmsContacts(pairs);
  const recommendedId = contacts.find((c) => c.recommended)?.parentId || contacts[0]?.parentId || null;

  if (override) {
    if (override.selectionMode === "all") {
      const selected = selectStatementSmsPairs(pairs, { mode: "all" });
      if (!selected.ok) return selected;
      return {
        ok: true,
        pairs: selected.pairs,
        selectedParentIds: selected.pairs.map((p) => p.parent.id),
      };
    }
    if (override.selectionMode === "parentIds") {
      const selected = selectStatementSmsPairs(pairs, {
        mode: "parentIds",
        parentIds: override.parentIds || [],
      });
      if (!selected.ok) return selected;
      return {
        ok: true,
        pairs: selected.pairs,
        selectedParentIds: selected.pairs.map((p) => p.parent.id),
      };
    }
    // recommended override
    if (!recommendedId) {
      return {
        ok: false,
        error: "No eligible billing SMS contacts for this account.",
        code: "NO_ELIGIBLE_CONTACTS",
      };
    }
    const selected = selectStatementSmsPairs(pairs, {
      mode: "parentIds",
      parentIds: [recommendedId],
    });
    if (!selected.ok) return selected;
    return { ok: true, pairs: selected.pairs, selectedParentIds: [recommendedId] };
  }

  if (strategy === "all_eligible") {
    const selected = selectStatementSmsPairs(pairs, { mode: "all" });
    if (!selected.ok) return selected;
    return {
      ok: true,
      pairs: selected.pairs,
      selectedParentIds: selected.pairs.map((p) => p.parent.id),
    };
  }

  if (!recommendedId) {
    return {
      ok: false,
      error: "No eligible billing SMS contacts for this account.",
      code: "NO_ELIGIBLE_CONTACTS",
    };
  }
  const selected = selectStatementSmsPairs(pairs, {
    mode: "parentIds",
    parentIds: [recommendedId],
  });
  if (!selected.ok) return selected;
  return { ok: true, pairs: selected.pairs, selectedParentIds: [recommendedId] };
}

type ResolvedBulkAccount = {
  familyAccountId: string;
  accountRef: string;
  accountNo: string;
  schoolName: string;
  balance: number;
  pairs: StatementSmsParentPair[];
  contacts: StatementSmsEligibleContact[];
  selectedPairs: StatementSmsParentPair[];
  selectedParentIds: string[];
  destinations: ReturnType<typeof buildStatementSmsDestinations>;
  duplicateMobilesRemoved: number;
  message: string;
  charCount: number;
  segments: number;
};

type SkippedBulkAccount = {
  familyAccountId: string;
  accountRef: string;
  accountNo: string;
  balance: number;
  skipReason: BulkStatementSmsSkipReason;
  skipMessage: string;
  contacts: StatementSmsEligibleContact[];
  recommendedParentId: string | null;
};

async function resolveOneBulkAccount(input: {
  schoolId: string;
  familyAccountId: string;
  strategy: BulkStatementSmsRecipientStrategy;
  override?: BulkStatementSmsAccountOverride;
  messageTemplate?: string | null;
}): Promise<
  | { ok: true; account: ResolvedBulkAccount }
  | { ok: false; skipped: SkippedBulkAccount }
> {
  const familyAccountId = String(input.familyAccountId || "").trim();
  const account = await resolveStatementSmsAccount(input.schoolId, { familyAccountId });
  if (!account) {
    return {
      ok: false,
      skipped: {
        familyAccountId,
        accountRef: "",
        accountNo: "",
        balance: 0,
        skipReason: "ACCOUNT_NOT_FOUND",
        skipMessage: "Family account not found for this school.",
        contacts: [],
        recommendedParentId: null,
      },
    };
  }

  const balance = roundStatementMoney(
    await resolveAuthoritativeAccountBalance(account.schoolId, account.accountRef)
  );
  const pairs = await loadEligibleStatementSmsPairs(account.schoolId, account.familyAccountId);
  const contacts = rankStatementSmsContacts(pairs);
  const recommendedParentId = contacts.find((c) => c.recommended)?.parentId || null;

  if (!(balance > 0)) {
    return {
      ok: false,
      skipped: {
        familyAccountId: account.familyAccountId,
        accountRef: account.accountRef,
        accountNo: account.displayAccountNo,
        balance,
        skipReason: "NOT_OUTSTANDING",
        skipMessage:
          balance < 0
            ? "Account has a credit balance and is excluded from bulk outstanding SMS."
            : "Account has no outstanding balance and is excluded from bulk outstanding SMS.",
        contacts,
        recommendedParentId,
      },
    };
  }

  const selected = resolvePairsForStrategy(pairs, input.strategy, input.override);
  if (!selected.ok) {
    const code =
      selected.code === "INVALID_PARENT_SELECTION"
        ? "INVALID_PARENT_SELECTION"
        : selected.code === "NO_PARENT_SELECTED"
          ? "INVALID_PARENT_SELECTION"
          : "NO_ELIGIBLE_CONTACTS";
    return {
      ok: false,
      skipped: {
        familyAccountId: account.familyAccountId,
        accountRef: account.accountRef,
        accountNo: account.displayAccountNo,
        balance,
        skipReason: code,
        skipMessage: selected.error,
        contacts,
        recommendedParentId,
      },
    };
  }

  const destinations = buildStatementSmsDestinations(selected.pairs);
  if (!destinations.length) {
    return {
      ok: false,
      skipped: {
        familyAccountId: account.familyAccountId,
        accountRef: account.accountRef,
        accountNo: account.displayAccountNo,
        balance,
        skipReason: "NO_VALID_MOBILE",
        skipMessage: "No valid mobile numbers on the selected contacts.",
        contacts,
        recommendedParentId,
      },
    };
  }

  const messageCheck = resolveBulkMessageForAccount({
    schoolName: account.schoolName,
    accountNo: account.displayAccountNo,
    balance,
    messageTemplate: input.messageTemplate,
  });
  if (!messageCheck.ok) {
    return {
      ok: false,
      skipped: {
        familyAccountId: account.familyAccountId,
        accountRef: account.accountRef,
        accountNo: account.displayAccountNo,
        balance,
        skipReason: "INVALID_MESSAGE",
        skipMessage: messageCheck.error,
        contacts,
        recommendedParentId,
      },
    };
  }

  const eligibleParentCount = new Set(selected.pairs.map((p) => p.parent.id)).size;
  const duplicateMobilesRemoved = Math.max(0, eligibleParentCount - destinations.length);

  return {
    ok: true,
    account: {
      familyAccountId: account.familyAccountId,
      accountRef: account.accountRef,
      accountNo: account.displayAccountNo,
      schoolName: account.schoolName,
      balance,
      pairs,
      contacts,
      selectedPairs: selected.pairs,
      selectedParentIds: selected.selectedParentIds,
      destinations,
      duplicateMobilesRemoved,
      message: messageCheck.message,
      charCount: messageCheck.charCount,
      segments: messageCheck.segments,
    },
  };
}

type PreviewBulkStatementSmsInput = {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy?: BulkStatementSmsRecipientStrategy | string;
  accountOverrides?: BulkStatementSmsAccountOverride[];
  messageTemplate?: string | null;
};

export async function previewBulkStatementSms(input: PreviewBulkStatementSmsInput) {
  const startedAt = Date.now();
  const schoolId = String(input.schoolId || "").trim();
  logBulkStatementSms("bulk_sms_preview_started", {
    schoolId,
    requestedAccountCount: dedupeFamilyAccountIds(input.familyAccountIds).length,
    recipientStrategy: parseBulkRecipientStrategy(input.recipientStrategy),
  });
  try {
    const result = await previewBulkStatementSmsUnlogged(input);
    logBulkStatementSms(
      "bulk_sms_preview_completed",
      buildBulkSmsPreviewCompletedLog(schoolId, result as Record<string, any>, Date.now() - startedAt)
    );
    return result;
  } catch (error) {
    logBulkStatementSms("bulk_sms_preview_failed", {
      schoolId,
      stage: "resolve",
      errorCode: safeBulkSmsErrorCode(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function previewBulkStatementSmsUnlogged(input: PreviewBulkStatementSmsInput) {
  const schoolId = String(input.schoolId || "").trim();
  const familyAccountIds = dedupeFamilyAccountIds(input.familyAccountIds);
  const strategy = parseBulkRecipientStrategy(input.recipientStrategy);
  const overrides = overrideMap(input.accountOverrides);
  const messageTemplate = input.messageTemplate;

  if (!schoolId) {
    return {
      ok: false as const,
      status: 400,
      error: "Missing school authorization",
      code: "MISSING_SCHOOL",
    };
  }
  if (!familyAccountIds.length) {
    return {
      ok: false as const,
      status: 400,
      error: "Select at least one family account.",
      code: "NO_ACCOUNTS_SELECTED",
    };
  }

  const smsReady = await isSchoolSmsReady(schoolId);
  const outboundDisabled = isOutboundSmsDisabled();

  const resolved = await mapPool(familyAccountIds, BULK_STATEMENT_SMS_CONCURRENCY, async (familyAccountId) =>
    resolveOneBulkAccount({
      schoolId,
      familyAccountId,
      strategy,
      override: overrides.get(familyAccountId),
      messageTemplate,
    })
  );

  const accounts: BulkStatementSmsAccountPreview[] = [];
  const recipients: BulkStatementSmsPreviewRecipient[] = [];
  const sampleMessages: string[] = [];
  let eligibleAccountCount = 0;
  let skippedAccountCount = 0;
  let totalOutstanding = 0;
  let destinationCount = 0;
  let duplicateNumbersRemoved = 0;
  let estimatedSegments = 0;

  for (const row of resolved) {
    if (row.ok) {
      eligibleAccountCount += 1;
      totalOutstanding = roundStatementMoney(totalOutstanding + row.account.balance);
      destinationCount += row.account.destinations.length;
      duplicateNumbersRemoved += row.account.duplicateMobilesRemoved;
      estimatedSegments += row.account.segments * row.account.destinations.length;
      if (sampleMessages.length < 3) sampleMessages.push(row.account.message);
      const accountRecipients = buildSafeBulkSmsPreviewRecipients(
        row.account.destinations,
        row.account.accountNo
      );
      recipients.push(...accountRecipients);
      accounts.push({
        familyAccountId: row.account.familyAccountId,
        accountRef: row.account.accountRef,
        accountNo: row.account.accountNo,
        balance: row.account.balance,
        status: "eligible",
        skipReason: null,
        skipMessage: null,
        contacts: row.account.contacts,
        recommendedParentId:
          row.account.contacts.find((c) => c.recommended)?.parentId || null,
        selectedParentIds: row.account.selectedParentIds,
        recipients: accountRecipients,
        destinationCount: row.account.destinations.length,
        duplicateMobilesRemoved: row.account.duplicateMobilesRemoved,
        sampleMessage: row.account.message,
        charCount: row.account.charCount,
        segments: row.account.segments,
      });
    } else {
      skippedAccountCount += 1;
      accounts.push({
        familyAccountId: row.skipped.familyAccountId,
        accountRef: row.skipped.accountRef,
        accountNo: row.skipped.accountNo,
        balance: row.skipped.balance,
        status: "skipped",
        skipReason: row.skipped.skipReason,
        skipMessage: row.skipped.skipMessage,
        contacts: row.skipped.contacts,
        recommendedParentId: row.skipped.recommendedParentId,
        selectedParentIds: [],
        recipients: [],
        destinationCount: 0,
        duplicateMobilesRemoved: 0,
        sampleMessage: null,
        charCount: 0,
        segments: 0,
      });
    }
  }

  const canSend =
    smsReady &&
    !outboundDisabled &&
    eligibleAccountCount > 0 &&
    destinationCount > 0;

  return {
    ok: true as const,
    requestedAccountCount: familyAccountIds.length,
    eligibleAccountCount,
    skippedAccountCount,
    destinationCount,
    duplicateNumbersRemoved,
    totalOutstanding,
    estimatedSegments,
    recipientStrategy: strategy,
    messageTemplate:
      String(messageTemplate || "").trim() || BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
    defaultMessageTemplate: BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
    maxChars: STATEMENT_SMS_MAX_CHARS,
    segmentChars: STATEMENT_SMS_SEGMENT_CHARS,
    sampleMessages,
    /** Flat list of final destinations (masked only) for Step 4 final preview. */
    recipients,
    accounts,
    smsReady,
    outboundDisabled,
    canSend,
    concurrency: BULK_STATEMENT_SMS_CONCURRENCY,
  };
}

type SendBulkStatementSmsInput = {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy?: BulkStatementSmsRecipientStrategy | string;
  accountOverrides?: BulkStatementSmsAccountOverride[];
  messageTemplate?: string | null;
  /** Ignored — phones from client are never used. */
  mobileNumbers?: unknown;
  cellNo?: unknown;
  phone?: unknown;
};

export async function sendBulkStatementSms(input: SendBulkStatementSmsInput) {
  const startedAt = Date.now();
  const schoolId = String(input.schoolId || "").trim();
  const diagnostics = createBulkStatementSmsSendDiagnostics();
  logBulkStatementSms("bulk_sms_send_started", {
    schoolId,
    requestedAccountCount: dedupeFamilyAccountIds(input.familyAccountIds).length,
    recipientStrategy: parseBulkRecipientStrategy(input.recipientStrategy),
  });
  try {
    const result = await sendBulkStatementSmsUnlogged(input, diagnostics);
    diagnostics.stage = "summarise";
    logBulkStatementSms(
      "bulk_sms_send_completed",
      buildBulkSmsSendCompletedLog(schoolId, result as Record<string, any>, diagnostics, Date.now() - startedAt)
    );
    return result;
  } catch (error) {
    logBulkStatementSms("bulk_sms_send_failed", {
      schoolId,
      stage: diagnostics.stage,
      errorCode: safeBulkSmsErrorCode(error),
      providerAccepted: diagnostics.providerAccepted,
      providerRejected: diagnostics.providerRejected,
      errorCodes: diagnostics.errorCodes,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

async function sendBulkStatementSmsUnlogged(
  input: SendBulkStatementSmsInput,
  diagnostics: BulkStatementSmsSendDiagnostics
) {
  void input.mobileNumbers;
  void input.cellNo;
  void input.phone;

  if (isOutboundSmsDisabled()) {
    return {
      ok: false as const,
      status: 503,
      error: "Outbound SMS is disabled (DISABLE_OUTBOUND_SMS=true).",
      code: "OUTBOUND_SMS_DISABLED",
      simulated: false,
      canSend: false,
    };
  }

  const schoolId = String(input.schoolId || "").trim();
  const familyAccountIds = dedupeFamilyAccountIds(input.familyAccountIds);
  const strategy = parseBulkRecipientStrategy(input.recipientStrategy);
  const overrides = overrideMap(input.accountOverrides);

  if (!schoolId) {
    return {
      ok: false as const,
      status: 400,
      error: "Missing school authorization",
      code: "MISSING_SCHOOL",
      simulated: false,
    };
  }
  if (!familyAccountIds.length) {
    return {
      ok: false as const,
      status: 400,
      error: "Select at least one family account.",
      code: "NO_ACCOUNTS_SELECTED",
      simulated: false,
    };
  }

  diagnostics.stage = "readiness";
  const ready = await isSchoolSmsReady(schoolId);
  if (!ready) {
    return {
      ok: false as const,
      status: 409,
      error:
        "WinSMS is not configured or not connected. Open Communication → Settings → SMS, connect your account, and test the connection.",
      code: "SMS_NOT_READY",
      simulated: false,
    };
  }

  // Full revalidation at send time (never trust preview).
  diagnostics.stage = "resolve";
  const resolveStartedAt = Date.now();
  const resolved = await mapPool(familyAccountIds, BULK_STATEMENT_SMS_CONCURRENCY, async (familyAccountId) =>
    resolveOneBulkAccount({
      schoolId,
      familyAccountId,
      strategy,
      override: overrides.get(familyAccountId),
      messageTemplate: input.messageTemplate,
    })
  );
  diagnostics.resolveMs = Date.now() - resolveStartedAt;

  type SendJob = {
    familyAccountId: string;
    accountNo: string;
    message: string;
    segments: number;
    dest: ReturnType<typeof buildStatementSmsDestinations>[number];
  };

  const jobs: SendJob[] = [];
  const skippedAccounts: BulkStatementSmsAccountPreview[] = [];
  const eligibleAccounts: Array<{
    familyAccountId: string;
    accountNo: string;
    balance: number;
    destinationCount: number;
  }> = [];

  for (const row of resolved) {
    if (!row.ok) {
      skippedAccounts.push({
        familyAccountId: row.skipped.familyAccountId,
        accountRef: row.skipped.accountRef,
        accountNo: row.skipped.accountNo,
        balance: row.skipped.balance,
        status: "skipped",
        skipReason: row.skipped.skipReason,
        skipMessage: row.skipped.skipMessage,
        contacts: row.skipped.contacts,
        recommendedParentId: row.skipped.recommendedParentId,
        selectedParentIds: [],
        recipients: [],
        destinationCount: 0,
        duplicateMobilesRemoved: 0,
        sampleMessage: null,
        charCount: 0,
        segments: 0,
      });
      continue;
    }
    eligibleAccounts.push({
      familyAccountId: row.account.familyAccountId,
      accountNo: row.account.accountNo,
      balance: row.account.balance,
      destinationCount: row.account.destinations.length,
    });
    for (const dest of row.account.destinations) {
      jobs.push({
        familyAccountId: row.account.familyAccountId,
        accountNo: row.account.accountNo,
        message: row.account.message,
        segments: row.account.segments,
        dest,
      });
    }
  }

  if (!jobs.length) {
    return {
      ok: false as const,
      status: 400,
      error: "No eligible outstanding accounts with valid SMS destinations.",
      code: "NO_ELIGIBLE_DESTINATIONS",
      simulated: false,
      requestedAccountCount: familyAccountIds.length,
      eligibleAccountCount: 0,
      skippedAccountCount: skippedAccounts.length,
      attemptedDestinations: 0,
      successfulDestinations: 0,
      failedDestinations: 0,
      skippedAccounts,
      results: [] as BulkStatementSmsDestinationResult[],
      accountResults: [] as Array<{
        familyAccountId: string;
        accountNo: string;
        balance: number;
        sentCount: number;
        failedCount: number;
        status: "skipped" | "sent" | "partial" | "failed";
      }>,
    };
  }

  diagnostics.stage = "provider";
  const providerStartedAt = Date.now();
  const destinationResults = await mapPool(jobs, BULK_STATEMENT_SMS_CONCURRENCY, async (job) => {
    try {
      const providerResponse = await sendSchoolSms(schoolId, {
        message: job.message,
        recipients: [
          {
            mobileNumber: job.dest.mobileNumber,
            clientMessageId: `bstmt-${job.familyAccountId.slice(0, 8)}-${job.dest.parentIds[0].slice(0, 8)}`,
          },
        ],
        maxSegments: job.segments,
        clientMessageIdPrefix: `bstmt-${job.familyAccountId}`,
      });
      const acceptance = summariseWinSmsAcceptance(providerResponse);
      diagnostics.providerAccepted += acceptance.accepted;
      diagnostics.providerRejected += acceptance.rejected;
      diagnostics.providerAcceptanceUnknown += acceptance.unknown;
      for (const [code, n] of Object.entries(acceptance.rejectCodes)) {
        diagnostics.providerRejectCodes[code] = (diagnostics.providerRejectCodes[code] || 0) + n;
      }
      const outcome = classifyWinSmsDestinationOutcome(acceptance);
      return {
        familyAccountId: job.familyAccountId,
        accountNo: job.accountNo,
        parentIds: job.dest.parentIds,
        displayNames: job.dest.displayNames,
        mobileMasked: job.dest.mobileMasked,
        status: outcome.status,
        error: outcome.error,
      } satisfies BulkStatementSmsDestinationResult;
    } catch (error) {
      incrementCount(diagnostics.errorCodes, safeBulkSmsErrorCode(error));
      const errMsg =
        error instanceof WinSmsApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "SMS send failed";
      return {
        familyAccountId: job.familyAccountId,
        accountNo: job.accountNo,
        parentIds: job.dest.parentIds,
        displayNames: job.dest.displayNames,
        mobileMasked: job.dest.mobileMasked,
        status: "failed" as const,
        error: errMsg,
      } satisfies BulkStatementSmsDestinationResult;
    }
  });

  diagnostics.providerMs = Date.now() - providerStartedAt;

  const outcome = summariseBulkSmsDestinationOutcome(
    destinationResults,
    eligibleAccounts.length,
    skippedAccounts.length
  );
  const { successfulDestinations, failedDestinations, unconfirmedDestinations } = outcome;

  const accountResults: Array<{
    familyAccountId: string;
    accountNo: string;
    balance: number;
    sentCount: number;
    failedCount: number;
    unconfirmedCount?: number;
    status: "skipped" | "sent" | "partial" | "failed" | "unconfirmed";
  }> = eligibleAccounts.map((acct) => {
    const rows = destinationResults.filter((r) => r.familyAccountId === acct.familyAccountId);
    const sentCount = rows.filter((r) => r.status === "sent").length;
    const failedCount = rows.filter((r) => r.status === "failed").length;
    const unconfirmedCount = rows.filter((r) => r.status === "unconfirmed").length;
    const status =
      failedCount === 0 && unconfirmedCount === 0 && sentCount > 0
        ? ("sent" as const)
        : sentCount > 0
          ? ("partial" as const)
          : unconfirmedCount > 0
            ? ("unconfirmed" as const)
            : ("failed" as const);
    return {
      familyAccountId: acct.familyAccountId,
      accountNo: acct.accountNo,
      balance: acct.balance,
      sentCount,
      failedCount,
      unconfirmedCount,
      status,
    };
  });

  for (const skipped of skippedAccounts) {
    accountResults.push({
      familyAccountId: skipped.familyAccountId,
      accountNo: skipped.accountNo,
      balance: skipped.balance,
      sentCount: 0,
      failedCount: 0,
      status: "skipped",
    });
  }

  return {
    ok: outcome.ok,
    status: outcome.status,
    simulated: false,
    summary: outcome.summary,
    recipientStrategy: strategy,
    requestedAccountCount: familyAccountIds.length,
    eligibleAccountCount: eligibleAccounts.length,
    skippedAccountCount: skippedAccounts.length,
    attemptedDestinations: destinationResults.length,
    successfulDestinations,
    failedDestinations,
    unconfirmedDestinations,
    concurrency: BULK_STATEMENT_SMS_CONCURRENCY,
    skippedAccounts,
    results: destinationResults,
    accountResults,
  };
}
