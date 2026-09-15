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

export type BulkStatementSmsDestinationResult = StatementSmsSendResultRow & {
  familyAccountId: string;
  accountNo: string;
};

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

export async function previewBulkStatementSms(input: {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy?: BulkStatementSmsRecipientStrategy | string;
  accountOverrides?: BulkStatementSmsAccountOverride[];
  messageTemplate?: string | null;
}) {
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

export async function sendBulkStatementSms(input: {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy?: BulkStatementSmsRecipientStrategy | string;
  accountOverrides?: BulkStatementSmsAccountOverride[];
  messageTemplate?: string | null;
  /** Ignored — phones from client are never used. */
  mobileNumbers?: unknown;
  cellNo?: unknown;
  phone?: unknown;
}) {
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
  const resolved = await mapPool(familyAccountIds, BULK_STATEMENT_SMS_CONCURRENCY, async (familyAccountId) =>
    resolveOneBulkAccount({
      schoolId,
      familyAccountId,
      strategy,
      override: overrides.get(familyAccountId),
      messageTemplate: input.messageTemplate,
    })
  );

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

  const destinationResults = await mapPool(jobs, BULK_STATEMENT_SMS_CONCURRENCY, async (job) => {
    try {
      await sendSchoolSms(schoolId, {
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
      return {
        familyAccountId: job.familyAccountId,
        accountNo: job.accountNo,
        parentIds: job.dest.parentIds,
        displayNames: job.dest.displayNames,
        mobileMasked: job.dest.mobileMasked,
        status: "sent" as const,
        error: null,
      };
    } catch (error) {
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
      };
    }
  });

  let successfulDestinations = 0;
  let failedDestinations = 0;
  for (const row of destinationResults) {
    if (row.status === "sent") successfulDestinations += 1;
    else failedDestinations += 1;
  }

  const accountResults: Array<{
    familyAccountId: string;
    accountNo: string;
    balance: number;
    sentCount: number;
    failedCount: number;
    status: "skipped" | "sent" | "partial" | "failed";
  }> = eligibleAccounts.map((acct) => {
    const rows = destinationResults.filter((r) => r.familyAccountId === acct.familyAccountId);
    const sentCount = rows.filter((r) => r.status === "sent").length;
    const failedCount = rows.filter((r) => r.status === "failed").length;
    const status =
      failedCount === 0 && sentCount > 0
        ? ("sent" as const)
        : sentCount > 0 && failedCount > 0
          ? ("partial" as const)
          : ("failed" as const);
    return {
      familyAccountId: acct.familyAccountId,
      accountNo: acct.accountNo,
      balance: acct.balance,
      sentCount,
      failedCount,
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

  const allSent = failedDestinations === 0 && successfulDestinations > 0;
  const partial = successfulDestinations > 0 && failedDestinations > 0;
  const summary = allSent
    ? `Bulk SMS sent successfully to ${successfulDestinations} destination${
        successfulDestinations === 1 ? "" : "s"
      } across ${eligibleAccounts.length} account${eligibleAccounts.length === 1 ? "" : "s"}.`
    : partial
      ? `${successfulDestinations} SMS sent. ${failedDestinations} SMS failed. ${skippedAccounts.length} account${
          skippedAccounts.length === 1 ? "" : "s"
        } skipped.`
      : "Bulk SMS send failed.";

  return {
    ok: allSent || partial,
    status: allSent ? 200 : partial ? 207 : 502,
    simulated: false,
    summary,
    recipientStrategy: strategy,
    requestedAccountCount: familyAccountIds.length,
    eligibleAccountCount: eligibleAccounts.length,
    skippedAccountCount: skippedAccounts.length,
    attemptedDestinations: destinationResults.length,
    successfulDestinations,
    failedDestinations,
    concurrency: BULK_STATEMENT_SMS_CONCURRENCY,
    skippedAccounts,
    results: destinationResults,
    accountResults,
  };
}
