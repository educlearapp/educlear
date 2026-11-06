/**
 * Outstanding Fees reminder SMS.
 * A short payment reminder, separate from statement bulk SMS.
 * The October 2026 statement batch is not rewritten and its missing recipients are not invented.
 * WinSMS acceptance is recorded per recipient. Handset delivery is never claimed.
 */
import crypto from "crypto";
import { analyseSmsMessage, publicSmsProviderError } from "./smsSegmentCalculator";
import {
  readOutstandingFeesReminderCampaignsForTests,
  reminderCampaignStore,
  setOutstandingFeesReminderDataDirForTests,
  type ReminderCampaign,
  type ReminderProviderStatus,
  type StoredRecipient,
} from "./outstandingFeesReminderCampaignStore";

export { readOutstandingFeesReminderCampaignsForTests, setOutstandingFeesReminderDataDirForTests };
export type { ReminderProviderStatus };
import {
  buildStatementSmsDestinations,
  loadEligibleStatementSmsPairs,
  maskStatementSmsMobile,
  rankStatementSmsContacts,
  resolveStatementSmsAccount,
} from "./statementSmsService";
import { resolveAuthoritativeAccountBalance, roundStatementMoney } from "./statementAccounts";
import { isSchoolSmsReady, sendSchoolSms } from "./schoolSmsService";
import { WinSmsApiError } from "./winSmsClient";
import { isOutboundSmsDisabled } from "../utils/outboundSafety";
import {
  BULK_SMS_IN_PROGRESS_STALE_MS,
  historicalStatementSmsHold,
  statementSmsBillingPeriod,
} from "./statementBulkSmsDuplicateGuard";
import {
  classifyWinSmsDestinationOutcome,
  dedupeFamilyAccountIds,
  summariseWinSmsAcceptance,
} from "./statementBulkSmsService";

export const OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE = "outstanding_fees_reminder" as const;
export const OUTSTANDING_FEES_REMINDER_TEMPLATE =
  "{{schoolName}}: Acc {{accountNo}} owes {{amount}}. Please pay outstanding fees.";
export const OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS = 306;
export const OUTSTANDING_FEES_REMINDER_PLACEHOLDERS = ["schoolName", "accountNo", "amount"] as const;
export const OUTSTANDING_FEES_REMINDER_MAX_SEGMENTS = 2;
export const NEW_CAMPAIGN_AUTHORIZATION_TEXT =
  "Start a new outstanding fees reminder. Do not retry the October statement SMS.";
export const NEW_CAMPAIGN_AUTHORIZATION_CODE = "NEW_CAMPAIGN_AUTHORIZATION_REQUIRED";

export type ReminderPreviewMessage = {
  familyAccountId: string;
  accountNo: string;
  displayName: string;
  mobileMasked: string;
  message: string;
  encoding: "gsm" | "ucs2";
  units: number;
  segments: number;
  credits: number;
};

export type ReminderSkip = {
  familyAccountId: string;
  accountNo: string;
  reason:
    | "ACCOUNT_NOT_FOUND"
    | "NOT_OUTSTANDING"
    | "NO_VALID_MOBILE"
    | "DUPLICATE_ACCOUNT"
    | "DUPLICATE_PHONE"
    | "MESSAGE_TOO_LONG";
  detail: string;
  mobileMasked?: string;
};

type PlannedRecipient = {
  recipientKey: string;
  familyAccountId: string;
  accountNo: string;
  phoneHash: string;
  mobileNumber: string;
  mobileMasked: string;
  displayName: string;
  message: string;
  encoding: "gsm" | "ucs2";
  units: number;
  segments: number;
  credits: number;
};

export type ReminderAccountSnapshot = {
  familyAccountId: string;
  accountNo: string;
  schoolName: string;
  balance: number;
  displayName: string;
  /** Normalised digits. Empty when the account has no valid billing mobile. */
  mobileNumber: string;
  mobileMasked: string;
};

export type OutstandingFeesReminderDeps = {
  now?: Date;
  outboundDisabled?: boolean;
  smsReady?: (schoolId: string) => Promise<boolean>;
  resolveAccount?: (schoolId: string, familyAccountId: string) => Promise<ReminderAccountSnapshot | null>;
  sendSms?: (
    schoolId: string,
    input: { message: string; mobileNumber: string; clientMessageId: string; maxSegments: number }
  ) => Promise<unknown>;
};

export function formatReminderAmount(balance: number): string {
  const abs = Math.abs(Number.isFinite(balance) ? balance : 0);
  const [whole, frac] = abs.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === "00" ? `R${grouped}` : `R${grouped}.${frac}`;
}

export function validateOutstandingFeesReminderTemplate(raw: unknown):
  | { ok: true; template: string }
  | { ok: false; status: 400; code: string; error: string } {
  const template = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!template) {
    return { ok: false, status: 400, code: "TEMPLATE_REQUIRED", error: "Enter a reminder message before sending." };
  }
  if (template.length > OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS) {
    return {
      ok: false,
      status: 400,
      code: "TEMPLATE_TOO_LONG",
      error: `Reminder wording is limited to ${OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS} characters.`,
    };
  }
  const found = new Set<string>();
  const token = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(template))) found.add(match[1]);
  const unknown = [...found].filter(
    (name) => !OUTSTANDING_FEES_REMINDER_PLACEHOLDERS.includes(name as (typeof OUTSTANDING_FEES_REMINDER_PLACEHOLDERS)[number])
  );
  if (unknown.length) {
    return {
      ok: false,
      status: 400,
      code: "UNKNOWN_PLACEHOLDER",
      error: `Unknown placeholder {{${unknown[0]}}}. Use schoolName, accountNo and amount.`,
    };
  }
  if (template.includes("{{") && found.size === 0) {
    return {
      ok: false,
      status: 400,
      code: "UNKNOWN_PLACEHOLDER",
      error: "A placeholder could not be read. Use {{schoolName}}, {{accountNo}} and {{amount}}.",
    };
  }
  const missing = OUTSTANDING_FEES_REMINDER_PLACEHOLDERS.filter((name) => !found.has(name));
  if (missing.length) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_PLACEHOLDER",
      error: `The reminder must include {{${missing[0]}}}.`,
    };
  }
  return { ok: true, template };
}

export function resolveOutstandingFeesReminderTemplate(raw: unknown):
  | { ok: true; template: string }
  | { ok: false; status: 400; code: string; error: string } {
  if (raw == null) return { ok: true, template: OUTSTANDING_FEES_REMINDER_TEMPLATE };
  return validateOutstandingFeesReminderTemplate(raw);
}

export function renderOutstandingFeesReminderTemplate(
  template: string,
  input: { schoolName: string; accountNo: string; balance: number }
): string {
  const schoolName = String(input.schoolName || "School").replace(/\s+/g, " ").trim() || "School";
  const accountNo = String(input.accountNo || "Account").replace(/\s+/g, " ").trim() || "Account";
  const values: Record<string, string> = {
    schoolName,
    accountNo,
    amount: formatReminderAmount(input.balance),
  };
  return template.replace(/\{\{\s*(schoolName|accountNo|amount)\s*\}\}/g, (_match, key: string) => values[key] || "");
}

export function buildOutstandingFeesReminderMessage(input: {
  schoolName: string;
  accountNo: string;
  balance: number;
}): string {
  return renderOutstandingFeesReminderTemplate(OUTSTANDING_FEES_REMINDER_TEMPLATE, input);
}

export function hashReminderPhone(digits: string): string {
  return crypto.createHash("sha256").update(String(digits || "").replace(/\D/g, "")).digest("hex");
}

export function reminderContentHash(template: string = OUTSTANDING_FEES_REMINDER_TEMPLATE): string {
  return crypto.createHash("sha256").update(template).digest("hex");
}

export function reminderCampaignKey(input: {
  schoolId: string;
  billingPeriod: string;
  recipientKeys: string[];
  template?: string;
}): string {
  const keys = [...new Set(input.recipientKeys.map((key) => String(key || "").trim()).filter(Boolean))].sort();
  const raw = [
    OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE,
    input.schoolId.trim(),
    input.billingPeriod.trim(),
    reminderContentHash(input.template ?? OUTSTANDING_FEES_REMINDER_TEMPLATE),
    ...keys,
  ].join("\n");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function reminderRecipientKey(familyAccountId: string, phoneHash: string): string {
  return `${String(familyAccountId || "").trim()}:${String(phoneHash || "").trim()}`;
}

function authorizationMatches(raw: unknown): boolean {
  return String(raw || "").trim() === NEW_CAMPAIGN_AUTHORIZATION_TEXT;
}

function historicalHoldApplies(schoolId: string, billingPeriod: string): boolean {
  return historicalStatementSmsHold({ schoolId, billingPeriod }) !== null;
}

async function defaultResolveAccount(
  schoolId: string,
  familyAccountId: string
): Promise<ReminderAccountSnapshot | null> {
  const account = await resolveStatementSmsAccount(schoolId, { familyAccountId });
  if (!account || account.schoolId !== schoolId) return null;
  const balance = roundStatementMoney(
    await resolveAuthoritativeAccountBalance(account.schoolId, account.accountRef)
  );
  const pairs = await loadEligibleStatementSmsPairs(account.schoolId, account.familyAccountId);
  const contacts = rankStatementSmsContacts(pairs);
  const recommendedId = contacts[0]?.parentId || "";
  const recommended = pairs.find((pair) => pair.parent.id === recommendedId);
  const destinations = recommended ? buildStatementSmsDestinations([recommended]) : [];
  const dest = destinations[0];
  return {
    familyAccountId: account.familyAccountId,
    accountNo: account.displayAccountNo,
    schoolName: account.schoolName,
    balance,
    displayName: dest?.displayNames?.[0] || contacts[0]?.displayName || "Parent / Guardian",
    mobileNumber: dest?.mobileNumber || "",
    mobileMasked: dest?.mobileMasked || maskStatementSmsMobile("").masked,
  };
}

export function planReminderRecipients(
  schoolId: string,
  familyAccountIds: string[],
  snapshots: Array<ReminderAccountSnapshot | null>,
  template: string = OUTSTANDING_FEES_REMINDER_TEMPLATE
): { messages: PlannedRecipient[]; skipped: ReminderSkip[]; selectedAccountCount: number } {
  const ids = dedupeFamilyAccountIds(familyAccountIds);
  const skipped: ReminderSkip[] = [];
  const requested = Array.isArray(familyAccountIds) ? familyAccountIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  const seenAccounts = new Set<string>();
  for (const id of requested) {
    if (seenAccounts.has(id)) {
      skipped.push({
        familyAccountId: id,
        accountNo: "",
        reason: "DUPLICATE_ACCOUNT",
        detail: "This account was already selected.",
      });
    }
    seenAccounts.add(id);
  }

  const messages: PlannedRecipient[] = [];
  const seenPhones = new Set<string>();
  ids.forEach((familyAccountId, index) => {
    const snap = snapshots[index];
    if (!snap || snap.familyAccountId !== familyAccountId) {
      skipped.push({
        familyAccountId,
        accountNo: snap?.accountNo || "",
        reason: "ACCOUNT_NOT_FOUND",
        detail: "Account was not found for this school.",
      });
      return;
    }
    if (!(snap.balance > 0)) {
      skipped.push({
        familyAccountId,
        accountNo: snap.accountNo,
        reason: "NOT_OUTSTANDING",
        detail:
          snap.balance < 0
            ? "Account is in credit and is excluded."
            : "Account has no outstanding balance and is excluded.",
      });
      return;
    }
    const digits = String(snap.mobileNumber || "").replace(/\D/g, "");
    if (digits.length < 10) {
      skipped.push({
        familyAccountId,
        accountNo: snap.accountNo,
        reason: "NO_VALID_MOBILE",
        detail: "No valid billing mobile number on this account.",
      });
      return;
    }
    if (seenPhones.has(digits)) {
      skipped.push({
        familyAccountId,
        accountNo: snap.accountNo,
        reason: "DUPLICATE_PHONE",
        detail: "This mobile number is already used by another selected account.",
        mobileMasked: snap.mobileMasked,
      });
      return;
    }
    const message = renderOutstandingFeesReminderTemplate(template, {
      schoolName: snap.schoolName,
      accountNo: snap.accountNo,
      balance: snap.balance,
    });
    const counted = analyseSmsMessage(message);
    if (counted.segments > OUTSTANDING_FEES_REMINDER_MAX_SEGMENTS || counted.segments < 1) {
      skipped.push({
        familyAccountId,
        accountNo: snap.accountNo,
        reason: "MESSAGE_TOO_LONG",
        detail: `Reminder is ${counted.segments} segments. Outstanding fees reminders stay within ${OUTSTANDING_FEES_REMINDER_MAX_SEGMENTS}.`,
      });
      return;
    }
    seenPhones.add(digits);
    const phoneHash = hashReminderPhone(digits);
    messages.push({
      recipientKey: reminderRecipientKey(familyAccountId, phoneHash),
      familyAccountId,
      accountNo: snap.accountNo,
      phoneHash,
      mobileNumber: digits,
      mobileMasked: snap.mobileMasked || maskStatementSmsMobile(digits).masked,
      displayName: snap.displayName || "Parent / Guardian",
      message,
      encoding: counted.encoding,
      units: counted.units,
      segments: counted.segments,
      credits: counted.credits,
    });
  });
  return { messages, skipped, selectedAccountCount: ids.length };
}

function toPreviewMessage(row: PlannedRecipient): ReminderPreviewMessage {
  return {
    familyAccountId: row.familyAccountId,
    accountNo: row.accountNo,
    displayName: row.displayName,
    mobileMasked: row.mobileMasked,
    message: row.message,
    encoding: row.encoding,
    units: row.units,
    segments: row.segments,
    credits: row.credits,
  };
}

function publicRecipient(row: StoredRecipient | PlannedRecipient, status?: ReminderProviderStatus, detail?: string | null) {
  return {
    familyAccountId: row.familyAccountId,
    accountNo: row.accountNo,
    displayName: row.displayName,
    mobileMasked: row.mobileMasked,
    message: "message" in row ? row.message : undefined,
    encoding: row.encoding,
    units: row.units,
    segments: row.segments,
    credits: row.credits,
    providerStatus: status || ("status" in row ? row.status : undefined),
    providerDetail: detail ?? ("providerDetail" in row ? row.providerDetail : null),
    handsetDelivered: null as null,
    acceptanceIsNotDelivery: true,
  };
}

function totals(messages: Array<{ segments: number; credits: number }>) {
  return {
    uniquePhones: messages.length,
    totalSegments: messages.reduce((sum, row) => sum + row.segments, 0),
    totalCredits: messages.reduce((sum, row) => sum + row.credits, 0),
  };
}

async function loadSnapshots(
  schoolId: string,
  familyAccountIds: string[],
  deps: OutstandingFeesReminderDeps
): Promise<Array<ReminderAccountSnapshot | null>> {
  const resolve = deps.resolveAccount || defaultResolveAccount;
  const ids = dedupeFamilyAccountIds(familyAccountIds);
  const out: Array<ReminderAccountSnapshot | null> = [];
  for (const id of ids) {
    const snap = await resolve(schoolId, id);
    if (snap && snap.familyAccountId !== id) {
      out.push(null);
      continue;
    }
    out.push(snap);
  }
  return out;
}

export async function previewOutstandingFeesReminder(input: {
  schoolId: string;
  familyAccountIds: string[];
  messageTemplate?: unknown;
  now?: Date;
  deps?: OutstandingFeesReminderDeps;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const deps = input.deps || {};
  const now = input.now || deps.now || new Date();
  if (!schoolId) {
    return { ok: false as const, status: 400, code: "MISSING_SCHOOL", error: "Missing school authorization." };
  }
  const resolvedTemplate = resolveOutstandingFeesReminderTemplate(input.messageTemplate);
  if (!resolvedTemplate.ok) return resolvedTemplate;
  const ids = dedupeFamilyAccountIds(input.familyAccountIds);
  if (!ids.length) {
    return { ok: false as const, status: 400, code: "NO_ACCOUNTS_SELECTED", error: "Select at least one family account." };
  }
  const billingPeriod = statementSmsBillingPeriod(now);
  const snapshots = await loadSnapshots(schoolId, input.familyAccountIds, deps);
  const planned = planReminderRecipients(schoolId, input.familyAccountIds, snapshots, resolvedTemplate.template);
  const hold = historicalHoldApplies(schoolId, billingPeriod);
  const campaignKey = reminderCampaignKey({
    schoolId,
    billingPeriod,
    recipientKeys: planned.messages.map((row) => row.recipientKey),
    template: resolvedTemplate.template,
  });
  const prior = (await reminderCampaignStore.list(schoolId, billingPeriod)).length > 0;
  const counts = totals(planned.messages);
  return {
    ok: true as const,
    status: 200,
    success: true,
    messageType: OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE,
    schoolId,
    billingPeriod,
    campaignKey,
    contentHash: reminderContentHash(resolvedTemplate.template),
    template: resolvedTemplate.template,
    defaultTemplate: OUTSTANDING_FEES_REMINDER_TEMPLATE,
    templateMaxChars: OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS,
    selectedAccountCount: planned.selectedAccountCount,
    ...counts,
    messages: planned.messages.map(toPreviewMessage),
    skipped: planned.skipped,
    historicalStatementHold: hold,
    requiresNewCampaignAuthorization: hold || prior,
    authorizationText: hold || prior ? NEW_CAMPAIGN_AUTHORIZATION_TEXT : null,
    historicalStatementNote: hold
      ? "The 19 October 2026 statement SMS stays on hold. This reminder is a separate campaign and does not invent or replace that recipient list."
      : null,
    handsetDelivered: null,
    acceptanceIsNotDelivery: true,
    smsReady: deps.smsReady ? await deps.smsReady(schoolId) : await isSchoolSmsReady(schoolId),
    outboundDisabled: deps.outboundDisabled ?? isOutboundSmsDisabled(),
  };
}

type ClaimResult =
  | { ok: true; mode: "send" | "replay"; campaign: ReminderCampaign; toSend: StoredRecipient[] }
  | { ok: false; status: number; code: string; error: string; campaign?: ReminderCampaign };

function storeRecipientFromPlan(row: PlannedRecipient, status: ReminderProviderStatus, detail: string | null, providerCalled: boolean): StoredRecipient {
  return {
    recipientKey: row.recipientKey,
    familyAccountId: row.familyAccountId,
    accountNo: row.accountNo,
    phoneHash: row.phoneHash,
    mobileMasked: row.mobileMasked,
    displayName: row.displayName,
    message: row.message,
    encoding: row.encoding,
    units: row.units,
    segments: row.segments,
    credits: row.credits,
    status,
    providerDetail: detail,
    providerCalled,
  };
}

export async function claimOutstandingFeesReminderCampaign(input: {
  schoolId: string;
  billingPeriod: string;
  sendInstanceId: string;
  messageTemplate: string;
  actorUserId?: string;
  authorizationText?: string;
  messages: PlannedRecipient[];
  now?: Date;
}): Promise<ClaimResult> {
  const sendInstanceId = String(input.sendInstanceId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sendInstanceId)) {
    return { ok: false, status: 400, code: "SEND_INSTANCE_REQUIRED", error: "A reminder send needs one confirmation id. Nothing was sent." };
  }
  const now = input.now || new Date();
  const template = input.messageTemplate;
  const recipientKeys = input.messages.map((row) => row.recipientKey);
  const campaignKey = reminderCampaignKey({
    schoolId: input.schoolId,
    billingPeriod: input.billingPeriod,
    recipientKeys,
    template,
  });
  const contentHash = reminderContentHash(template);

  return reminderCampaignStore.transaction(input.schoolId, input.billingPeriod, (campaigns) => {
    const sameInstance = campaigns.find((campaign) => campaign.sendInstanceId === sendInstanceId);
    if (sameInstance) {
      if (
        sameInstance.campaignKey !== campaignKey ||
        sameInstance.contentHash !== contentHash ||
        sameInstance.messageType !== OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE
      ) {
        return {
          campaigns,
          result: {
            ok: false as const,
            status: 409,
            code: "SEND_INSTANCE_MISMATCH",
            error: "This confirmation was already used for a different reminder. Nothing further was sent.",
            campaign: sameInstance,
          },
        };
      }
      if (sameInstance.state === "in_progress") {
        const age = now.getTime() - Date.parse(sameInstance.createdAt);
        if (age < BULK_SMS_IN_PROGRESS_STALE_MS) {
          return {
            campaigns,
            result: {
              ok: false as const,
              status: 409,
              code: "REMINDER_IN_PROGRESS",
              error: "This reminder confirmation is already being sent. WinSMS was not contacted again.",
              campaign: sameInstance,
            },
          };
        }
        sameInstance.state = "completed";
        sameInstance.completedAt = now.toISOString();
      }
      return { campaigns, result: { ok: true as const, mode: "replay" as const, campaign: sameInstance, toSend: [] } };
    }

    const protectedPhones = new Map<string, ReminderProviderStatus>();
    for (const campaign of campaigns) {
      for (const recipient of campaign.recipients) {
        if (recipient.status === "accepted" || recipient.status === "pending") {
          protectedPhones.set(recipient.phoneHash, recipient.status);
        }
      }
    }
    const needsAuthorization = historicalHoldApplies(input.schoolId, input.billingPeriod) || campaigns.length > 0;
    if (needsAuthorization && !authorizationMatches(input.authorizationText)) {
      return {
        campaigns,
        result: {
          ok: false as const,
          status: 409,
          code: NEW_CAMPAIGN_AUTHORIZATION_CODE,
          error: historicalHoldApplies(input.schoolId, input.billingPeriod)
            ? "The October statement SMS cannot be told apart by recipient, so a new outstanding-fees reminder needs its own confirmation. Statement SMS stays blocked. Nothing was sent."
            : "This reminder was already submitted. Confirm a separate new reminder campaign before sending again. Accepted and unconfirmed numbers are not retried automatically.",
        },
      };
    }

    const recipients = input.messages.map((row) => {
      const priorStatus = protectedPhones.get(row.phoneHash);
      if (priorStatus === "accepted") {
        return storeRecipientFromPlan(
          row,
          "accepted",
          "WinSMS already accepted this number for this reminder. It was not sent again. Acceptance is not handset delivery.",
          false
        );
      }
      if (priorStatus === "pending") {
        return storeRecipientFromPlan(
          row,
          "pending",
          "An earlier submission for this number was not confirmed. It was not retried.",
          false
        );
      }
      return storeRecipientFromPlan(row, "pending", "Waiting for WinSMS acceptance.", true);
    });

    const campaign: ReminderCampaign = {
      campaignId: crypto.randomUUID(),
      messageType: OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE,
      schoolId: input.schoolId,
      billingPeriod: input.billingPeriod,
      campaignKey,
      sendInstanceId,
      contentHash,
      messageTemplate: template,
      state: "in_progress",
      createdAt: now.toISOString(),
      actorUserId: String(input.actorUserId || "").trim() || undefined,
      authorizationText: needsAuthorization ? NEW_CAMPAIGN_AUTHORIZATION_TEXT : undefined,
      recipients,
    };
    return {
      campaigns: [...campaigns, campaign],
      result: {
        ok: true as const,
        mode: "send" as const,
        campaign,
        toSend: recipients.filter((row) => row.providerCalled),
      },
    };
  });
}

function rememberOutcome(
  campaignId: string,
  schoolId: string,
  recipientKey: string,
  status: ReminderProviderStatus,
  providerDetail: string | null
) {
  return reminderCampaignStore.updateRecipient(campaignId, schoolId, recipientKey, status, providerDetail);
}

function finishCampaign(campaignId: string, schoolId: string, completedAt: string) {
  return reminderCampaignStore.complete(campaignId, schoolId, completedAt);
}

function classifySendError(error: unknown): { status: ReminderProviderStatus; detail: string } {
  if (error instanceof WinSmsApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) {
    return { status: "failed", detail: publicSmsProviderError(error.message) };
  }
  const message = error instanceof Error ? error.message : "WinSMS did not confirm acceptance.";
  return {
    status: "pending",
    detail: `WinSMS did not confirm acceptance (${publicSmsProviderError(message)}). This number was not retried. Acceptance is not handset delivery.`,
  };
}

export async function sendOutstandingFeesReminder(input: {
  schoolId: string;
  familyAccountIds: string[];
  sendInstanceId: string;
  messageTemplate?: unknown;
  authorizationText?: string;
  actorUserId?: string;
  now?: Date;
  deps?: OutstandingFeesReminderDeps;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const deps = input.deps || {};
  const now = input.now || deps.now || new Date();
  if (deps.outboundDisabled ?? isOutboundSmsDisabled()) {
    return {
      ok: false as const,
      status: 503,
      code: "OUTBOUND_SMS_DISABLED",
      error: "Outbound SMS is disabled. Nothing was sent.",
      handsetDelivered: null,
    };
  }
  if (!schoolId) {
    return { ok: false as const, status: 400, code: "MISSING_SCHOOL", error: "Missing school authorization.", handsetDelivered: null };
  }
  const ready = deps.smsReady ? await deps.smsReady(schoolId) : await isSchoolSmsReady(schoolId);
  if (!ready) {
    return {
      ok: false as const,
      status: 409,
      code: "SMS_NOT_READY",
      error: "WinSMS is not connected for this school. Nothing was sent.",
      handsetDelivered: null,
    };
  }
  const resolvedTemplate = resolveOutstandingFeesReminderTemplate(input.messageTemplate);
  if (!resolvedTemplate.ok) return { ...resolvedTemplate, handsetDelivered: null };
  const snapshots = await loadSnapshots(schoolId, input.familyAccountIds, deps);
  const planned = planReminderRecipients(schoolId, input.familyAccountIds, snapshots, resolvedTemplate.template);
  if (!planned.messages.length) {
    return {
      ok: false as const,
      status: 400,
      code: "NO_ELIGIBLE_DESTINATIONS",
      error: "No selected account has a positive balance and a unique valid mobile.",
      skipped: planned.skipped,
      handsetDelivered: null,
    };
  }
  const billingPeriod = statementSmsBillingPeriod(now);
  let claim: ClaimResult;
  try {
    claim = await claimOutstandingFeesReminderCampaign({
      schoolId,
      billingPeriod,
      sendInstanceId: input.sendInstanceId,
      messageTemplate: resolvedTemplate.template,
      actorUserId: input.actorUserId,
      authorizationText: input.authorizationText,
      messages: planned.messages,
      now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outstanding fees reminder log is busy. Nothing was sent.";
    return { ok: false as const, status: 503, code: "SMS_SEND_LOG_BUSY", error: message, handsetDelivered: null };
  }
  if (!claim.ok) {
    return { ...claim, skipped: planned.skipped, handsetDelivered: null, simulated: false };
  }

  const sendSms = deps.sendSms;
  const byKey = new Map(planned.messages.map((row) => [row.recipientKey, row]));
  if (claim.mode === "send") {
    for (const recipient of claim.toSend) {
      const plan = byKey.get(recipient.recipientKey);
      if (!plan) continue;
      try {
        const response = sendSms
            ? await sendSms(schoolId, {
              message: recipient.message,
              mobileNumber: plan.mobileNumber,
              clientMessageId: `ofee-${claim.campaign.campaignId.slice(0, 8)}-${recipient.phoneHash.slice(0, 8)}`,
              maxSegments: recipient.segments,
            })
          : await sendSchoolSms(schoolId, {
              message: recipient.message,
              recipients: [
                {
                  mobileNumber: plan.mobileNumber,
                  clientMessageId: `ofee-${claim.campaign.campaignId.slice(0, 8)}-${recipient.phoneHash.slice(0, 8)}`,
                },
              ],
              maxSegments: recipient.segments,
            });
        const outcome = classifyWinSmsDestinationOutcome(summariseWinSmsAcceptance(response));
        const status: ReminderProviderStatus =
          outcome.status === "sent" ? "accepted" : outcome.status === "failed" ? "failed" : "pending";
        await rememberOutcome(
          claim.campaign.campaignId,
          schoolId,
          recipient.recipientKey,
          status,
          status === "accepted"
            ? "WinSMS accepted this message. That is not handset delivery."
            : outcome.error
        );
      } catch (error) {
        const classified = classifySendError(error);
        await rememberOutcome(claim.campaign.campaignId, schoolId, recipient.recipientKey, classified.status, classified.detail);
      }
    }
    await finishCampaign(claim.campaign.campaignId, schoolId, now.toISOString());
  }

  const stored = await reminderCampaignStore.find(schoolId, claim.campaign.campaignId);
  const recipients = stored?.recipients || claim.campaign.recipients;
  const accepted = recipients.filter((row) => row.status === "accepted").length;
  const failed = recipients.filter((row) => row.status === "failed").length;
  const pending = recipients.filter((row) => row.status === "pending").length;
  return {
    ok: true as const,
    status: pending > 0 || failed > 0 ? 207 : 200,
    success: true,
    messageType: OUTSTANDING_FEES_REMINDER_MESSAGE_TYPE,
    campaignId: claim.campaign.campaignId,
    sendInstanceId: claim.campaign.sendInstanceId,
    billingPeriod,
    replayed: claim.mode === "replay",
    providerCalled: claim.mode === "send" && claim.toSend.length > 0,
    accepted,
    failed,
    pending,
    handsetDelivered: null,
    acceptanceIsNotDelivery: true,
    summary:
      claim.mode === "replay"
        ? `This reminder confirmation was already used. WinSMS was not contacted again. Stored result: ${accepted} accepted, ${failed} rejected, ${pending} not confirmed. Acceptance is not handset delivery.`
        : `WinSMS result for this reminder: ${accepted} accepted, ${failed} rejected, ${pending} not confirmed. Acceptance is not handset delivery.`,
    messages: recipients.map((row) => publicRecipient(row)),
    skipped: planned.skipped,
    simulated: false,
  };
}
