/**
 * Bulk Outstanding Balance SMS.
 * One short balance message per valid mobile. Statement text is not included.
 * WinSMS acceptance is stored per recipient. Handset delivery is never claimed.
 * Historical statement-SMS files are not read for recipient lists and are not rewritten.
 */
import crypto from "crypto";
import { analyseSmsMessage, publicSmsProviderError, STATEMENT_SMS_MAX_SEGMENTS } from "./smsSegmentCalculator";
import {
  reminderCampaignStore,
  type ReminderCampaign,
  type ReminderProviderStatus,
  type StoredRecipient,
} from "./outstandingFeesReminderCampaignStore";
import {
  formatReminderAmount,
  hashReminderPhone,
} from "./outstandingFeesReminderSms";
import {
  buildStatementSmsDestinations,
  loadEligibleStatementSmsPairs,
  maskStatementSmsMobile,
  rankStatementSmsContacts,
  resolveStatementSmsAccount,
  selectStatementSmsPairs,
} from "./statementSmsService";
import { resolveAuthoritativeAccountBalance, roundStatementMoney } from "./statementAccounts";
import {
  classifyWinSmsDestinationOutcome,
  dedupeFamilyAccountIds,
  parseBulkRecipientStrategy,
  summariseWinSmsAcceptance,
} from "./statementBulkSmsService";
import { checkSchoolSmsCreditBalance, isSchoolSmsReady, sendSchoolSms } from "./schoolSmsService";
import { WinSmsApiError } from "./winSmsClient";
import { isOutboundSmsDisabled } from "../utils/outboundSafety";
import { BULK_SMS_IN_PROGRESS_STALE_MS, historicalStatementSmsHold, statementSmsBillingPeriod } from "./statementBulkSmsDuplicateGuard";

export const OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE = "outstanding_balance_sms" as const;
export const OUTSTANDING_BALANCE_SMS_TEMPLATE =
  "{{schoolName}}: Account {{accountNo}} has an outstanding balance of {{amount}}. Please arrange payment.";
export const OUTSTANDING_BALANCE_SMS_TEMPLATE_MAX_CHARS = 306;
export const OUTSTANDING_BALANCE_SMS_PLACEHOLDERS = ["schoolName", "accountNo", "amount"] as const;
export const NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT =
  "Start a new outstanding balance SMS. Do not retry accepted or unconfirmed messages.";
export const NEW_BALANCE_CAMPAIGN_AUTHORIZATION_CODE = "NEW_CAMPAIGN_AUTHORIZATION_REQUIRED";

export type BalanceContact = {
  mobileNumber: string;
  mobileMasked: string;
  displayName: string;
};

export type BalanceSnapshot = {
  familyAccountId: string;
  accountNo: string;
  schoolName: string;
  balance: number;
  contacts: BalanceContact[];
};

export type BalanceSkip = {
  familyAccountId: string;
  accountNo: string;
  balance: number | null;
  reason:
    | "ACCOUNT_NOT_FOUND"
    | "NOT_OUTSTANDING"
    | "NO_VALID_MOBILE"
    | "DUPLICATE_ACCOUNT"
    | "MESSAGE_TOO_LONG"
    | "ALREADY_ACCEPTED"
    | "ALREADY_UNCONFIRMED";
  detail: string;
  mobileMasked?: string;
};

type PlannedAccount = {
  familyAccountId: string;
  accountNo: string;
  balance: number;
  amount: string;
};

type PlannedMessage = {
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
  accounts: PlannedAccount[];
};

export type OutstandingBalanceSmsDeps = {
  now?: Date;
  outboundDisabled?: boolean;
  smsReady?: (schoolId: string) => Promise<boolean>;
  resolveAccount?: (
    schoolId: string,
    familyAccountId: string,
    strategy: "recommended" | "all_eligible"
  ) => Promise<BalanceSnapshot | null>;
  sendSms?: (
    schoolId: string,
    input: { message: string; mobileNumber: string; clientMessageId: string; maxSegments: number }
  ) => Promise<unknown>;
  readCreditBalance?: (schoolId: string) => Promise<{ ok: boolean; creditBalance?: number | null }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateOutstandingBalanceTemplate(raw: unknown):
  | { ok: true; template: string }
  | { ok: false; status: 400; code: string; error: string } {
  const template = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!template) {
    return { ok: false, status: 400, code: "TEMPLATE_REQUIRED", error: "Enter a message before sending." };
  }
  if (template.length > OUTSTANDING_BALANCE_SMS_TEMPLATE_MAX_CHARS) {
    return {
      ok: false,
      status: 400,
      code: "TEMPLATE_TOO_LONG",
      error: `Outstanding balance SMS wording is limited to ${OUTSTANDING_BALANCE_SMS_TEMPLATE_MAX_CHARS} characters.`,
    };
  }
  const found = new Set<string>();
  const token = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(template))) found.add(match[1]);
  const unknown = [...found].filter(
    (name) => !OUTSTANDING_BALANCE_SMS_PLACEHOLDERS.includes(name as (typeof OUTSTANDING_BALANCE_SMS_PLACEHOLDERS)[number])
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
  const missing = OUTSTANDING_BALANCE_SMS_PLACEHOLDERS.filter((name) => !found.has(name));
  if (missing.length) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_PLACEHOLDER",
      error: `The message must include {{${missing[0]}}}.`,
    };
  }
  return { ok: true, template };
}

export function resolveOutstandingBalanceTemplate(raw: unknown) {
  if (raw == null || String(raw).trim() === "") return { ok: true as const, template: OUTSTANDING_BALANCE_SMS_TEMPLATE };
  return validateOutstandingBalanceTemplate(raw);
}

export function renderOutstandingBalanceTemplate(
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

function validMobile(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : "";
}

export function planOutstandingBalanceSms(input: {
  familyAccountIds: string[];
  snapshots: Array<BalanceSnapshot | null>;
  template: string;
}): { messages: PlannedMessage[]; skipped: BalanceSkip[]; selectedAccountCount: number } {
  const ids = dedupeFamilyAccountIds(input.familyAccountIds);
  const skipped: BalanceSkip[] = [];
  const requested = Array.isArray(input.familyAccountIds)
    ? input.familyAccountIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const seenAccounts = new Set<string>();
  for (const id of requested) {
    if (seenAccounts.has(id)) {
      skipped.push({
        familyAccountId: id,
        accountNo: "",
        balance: null,
        reason: "DUPLICATE_ACCOUNT",
        detail: "This account was already selected.",
      });
    }
    seenAccounts.add(id);
  }

  type Candidate = PlannedAccount & {
    schoolName: string;
    mobileNumber: string;
    mobileMasked: string;
    displayName: string;
  };
  const candidates: Candidate[] = [];
  ids.forEach((familyAccountId, index) => {
    const snap = input.snapshots[index];
    if (!snap || snap.familyAccountId !== familyAccountId) {
      skipped.push({
        familyAccountId,
        accountNo: snap?.accountNo || "",
        balance: snap?.balance ?? null,
        reason: "ACCOUNT_NOT_FOUND",
        detail: "Account was not found for this school.",
      });
      return;
    }
    if (!(snap.balance > 0)) {
      skipped.push({
        familyAccountId,
        accountNo: snap.accountNo,
        balance: snap.balance,
        reason: "NOT_OUTSTANDING",
        detail:
          snap.balance < 0
            ? "Account is in credit and is excluded."
            : "Account has no outstanding balance and is excluded.",
      });
      return;
    }
    const contacts = (snap.contacts || [])
      .map((contact) => {
        const mobileNumber = validMobile(contact.mobileNumber);
        return mobileNumber
          ? {
              mobileNumber,
              mobileMasked: contact.mobileMasked || maskStatementSmsMobile(mobileNumber).masked,
              displayName: String(contact.displayName || "").trim() || "Parent / Guardian",
            }
          : null;
      })
      .filter((contact): contact is BalanceContact => Boolean(contact));
    if (!contacts.length) {
      skipped.push({
        familyAccountId,
        accountNo: snap.accountNo,
        balance: snap.balance,
        reason: "NO_VALID_MOBILE",
        detail: "No valid billing mobile number on this account.",
      });
      return;
    }
    const seenOnAccount = new Set<string>();
    for (const contact of contacts) {
      if (seenOnAccount.has(contact.mobileNumber)) continue;
      seenOnAccount.add(contact.mobileNumber);
      candidates.push({
        familyAccountId,
        accountNo: snap.accountNo,
        balance: snap.balance,
        amount: formatReminderAmount(snap.balance),
        schoolName: snap.schoolName,
        mobileNumber: contact.mobileNumber,
        mobileMasked: contact.mobileMasked,
        displayName: contact.displayName,
      });
    }
  });

  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.mobileNumber) || [];
    group.push(candidate);
    groups.set(candidate.mobileNumber, group);
  }

  const messages: PlannedMessage[] = [];
  for (const [mobileNumber, group] of groups) {
    const accounts: PlannedAccount[] = [];
    const seen = new Set<string>();
    for (const row of group) {
      if (seen.has(row.familyAccountId)) continue;
      seen.add(row.familyAccountId);
      accounts.push({
        familyAccountId: row.familyAccountId,
        accountNo: row.accountNo,
        balance: row.balance,
        amount: row.amount,
      });
    }
    const schoolName = group[0]?.schoolName || "School";
    const message = accounts
      .map((account) =>
        renderOutstandingBalanceTemplate(input.template, {
          schoolName,
          accountNo: account.accountNo,
          balance: account.balance,
        })
      )
      .join("\n");
    const counted = analyseSmsMessage(message);
    const names = [...new Set(group.map((row) => row.displayName).filter(Boolean))];
    if (counted.segments < 1 || counted.segments > STATEMENT_SMS_MAX_SEGMENTS) {
      for (const account of accounts) {
        skipped.push({
          familyAccountId: account.familyAccountId,
          accountNo: account.accountNo,
          balance: account.balance,
          reason: "MESSAGE_TOO_LONG",
          detail: `Shared number would be ${counted.segments} SMS segments. Every account on this number was held back: ${accounts
            .map((item) => `${item.accountNo} ${item.amount}`)
            .join(", ")}.`,
          mobileMasked: group[0]?.mobileMasked,
        });
      }
      continue;
    }
    const phoneHash = hashReminderPhone(mobileNumber);
    messages.push({
      recipientKey: phoneHash,
      familyAccountId: accounts.map((account) => account.familyAccountId).join(","),
      accountNo: accounts.map((account) => account.accountNo).join(", "),
      phoneHash,
      mobileNumber,
      mobileMasked: group[0]?.mobileMasked || maskStatementSmsMobile(mobileNumber).masked,
      displayName: names.join(" & ") || "Parent / Guardian",
      message,
      encoding: counted.encoding,
      units: counted.units,
      segments: counted.segments,
      credits: counted.credits,
      accounts,
    });
  }

  return { messages, skipped, selectedAccountCount: ids.length };
}

function authorizationMatches(raw: unknown): boolean {
  return String(raw || "").trim() === NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT;
}

async function defaultResolveAccount(
  schoolId: string,
  familyAccountId: string,
  strategy: "recommended" | "all_eligible"
): Promise<BalanceSnapshot | null> {
  const account = await resolveStatementSmsAccount(schoolId, { familyAccountId });
  if (!account || account.schoolId !== schoolId) return null;
  const balance = roundStatementMoney(await resolveAuthoritativeAccountBalance(account.schoolId, account.accountRef));
  const pairs = await loadEligibleStatementSmsPairs(account.schoolId, account.familyAccountId);
  const selected =
    strategy === "all_eligible"
      ? selectStatementSmsPairs(pairs, { mode: "all" })
      : selectStatementSmsPairs(pairs, {
          mode: "parentIds",
          parentIds: [rankStatementSmsContacts(pairs)[0]?.parentId || ""].filter(Boolean),
        });
  const destinations = selected.ok ? buildStatementSmsDestinations(selected.pairs) : [];
  return {
    familyAccountId: account.familyAccountId,
    accountNo: account.displayAccountNo,
    schoolName: account.schoolName,
    balance,
    contacts: destinations.map((dest) => ({
      mobileNumber: dest.mobileNumber,
      mobileMasked: dest.mobileMasked,
      displayName: dest.displayNames.filter(Boolean).join(" & ") || "Parent / Guardian",
    })),
  };
}

async function loadSnapshots(
  schoolId: string,
  familyAccountIds: string[],
  strategy: "recommended" | "all_eligible",
  deps: OutstandingBalanceSmsDeps
): Promise<Array<BalanceSnapshot | null>> {
  const resolve = deps.resolveAccount || defaultResolveAccount;
  const ids = dedupeFamilyAccountIds(familyAccountIds);
  const out: Array<BalanceSnapshot | null> = [];
  for (const id of ids) {
    const snap = await resolve(schoolId, id, strategy);
    out.push(snap && snap.familyAccountId === id ? snap : null);
  }
  return out;
}

function protectedPhones(campaigns: ReminderCampaign[]): Map<string, ReminderProviderStatus> {
  const phones = new Map<string, ReminderProviderStatus>();
  for (const campaign of campaigns) {
    if (campaign.messageType !== OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE) continue;
    for (const recipient of campaign.recipients) {
      if (recipient.status === "accepted" || recipient.status === "pending") phones.set(recipient.phoneHash, recipient.status);
    }
  }
  return phones;
}

function applyPriorProtection(messages: PlannedMessage[], skipped: BalanceSkip[], prior: Map<string, ReminderProviderStatus>) {
  const sendable: PlannedMessage[] = [];
  for (const message of messages) {
    const status = prior.get(message.phoneHash);
    if (status !== "accepted" && status !== "pending") {
      sendable.push(message);
      continue;
    }
    const listed = message.accounts.map((account) => `${account.accountNo} ${account.amount}`).join(", ");
    for (const account of message.accounts) {
      skipped.push({
        familyAccountId: account.familyAccountId,
        accountNo: account.accountNo,
        balance: account.balance,
        reason: status === "accepted" ? "ALREADY_ACCEPTED" : "ALREADY_UNCONFIRMED",
        detail:
          status === "accepted"
            ? `This number was already accepted by WinSMS for ${listed}. None of those balances were sent again. Acceptance is not handset delivery.`
            : `An earlier submission for this number was not confirmed (${listed}). It was not retried.`,
        mobileMasked: message.mobileMasked,
      });
    }
  }
  return sendable;
}

function campaignKey(input: { schoolId: string; billingPeriod: string; recipientKeys: string[]; template: string }): string {
  const keys = [...new Set(input.recipientKeys)].sort();
  return crypto
    .createHash("sha256")
    .update([OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE, input.schoolId, input.billingPeriod, input.template, ...keys].join("\n"))
    .digest("hex");
}

function toStored(row: PlannedMessage, status: ReminderProviderStatus, detail: string | null, providerCalled: boolean): StoredRecipient {
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

function publicMessage(row: PlannedMessage | StoredRecipient, extra?: { providerStatus?: string; providerDetail?: string | null }) {
  const accounts = "accounts" in row ? row.accounts : [];
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
    includedAccounts: accounts,
    providerStatus: extra?.providerStatus || ("status" in row ? row.status : undefined),
    providerDetail: extra?.providerDetail ?? ("providerDetail" in row ? row.providerDetail : null),
    handsetDelivered: null as null,
    acceptanceIsNotDelivery: true,
  };
}

const CREDIT_NOT_CHECKED =
  "WinSMS credit balance was not checked. A saved snapshot is not this school's current balance.";

async function readCreditWarning(
  schoolId: string,
  requiredCredits: number,
  deps: OutstandingBalanceSmsDeps,
  outboundDisabled: boolean
): Promise<{ creditBalance: number | null; creditBalanceIsCurrent: boolean; creditWarning: string | null }> {
  if (outboundDisabled) {
    return {
      creditBalance: null,
      creditBalanceIsCurrent: false,
      creditWarning:
        "WinSMS credit balance was not checked because outbound SMS is disabled. A saved snapshot is not this school's current balance.",
    };
  }
  const injected = Boolean(deps.smsReady || deps.resolveAccount || deps.sendSms || deps.readCreditBalance);
  if (injected && !deps.readCreditBalance) {
    return { creditBalance: null, creditBalanceIsCurrent: false, creditWarning: CREDIT_NOT_CHECKED };
  }
  const reader = deps.readCreditBalance ?? ((id: string) => checkSchoolSmsCreditBalance(id));
  try {
    const checked = await reader(schoolId);
    if (!checked.ok || typeof checked.creditBalance !== "number" || !Number.isFinite(checked.creditBalance)) {
      return { creditBalance: null, creditBalanceIsCurrent: false, creditWarning: CREDIT_NOT_CHECKED };
    }
    let creditWarning: string | null = null;
    if (checked.creditBalance <= 0) {
      creditWarning =
        "This school's WinSMS credits are exhausted. The provider will reject new messages until credits are added.";
    } else if (requiredCredits > 0 && checked.creditBalance < requiredCredits) {
      creditWarning = `This school's live WinSMS balance (${checked.creditBalance}) is lower than the ${requiredCredits} credits this campaign needs.`;
    }
    return { creditBalance: checked.creditBalance, creditBalanceIsCurrent: true, creditWarning };
  } catch {
    return { creditBalance: null, creditBalanceIsCurrent: false, creditWarning: CREDIT_NOT_CHECKED };
  }
}

function counts(messages: Array<{ segments: number; credits: number }>) {
  return {
    uniquePhones: messages.length,
    totalSegments: messages.reduce((sum, row) => sum + row.segments, 0),
    totalCredits: messages.reduce((sum, row) => sum + row.credits, 0),
    maxMessageSegments: messages.reduce((max, row) => Math.max(max, row.segments), 0),
  };
}

export async function previewOutstandingBalanceSms(input: {
  schoolId: string;
  familyAccountIds: string[];
  recipientStrategy?: unknown;
  messageTemplate?: unknown;
  now?: Date;
  deps?: OutstandingBalanceSmsDeps;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const deps = input.deps || {};
  const now = input.now || deps.now || new Date();
  if (!schoolId) return { ok: false as const, status: 400, code: "MISSING_SCHOOL", error: "Missing school authorization." };
  const resolved = resolveOutstandingBalanceTemplate(input.messageTemplate);
  if (!resolved.ok) return resolved;
  const ids = dedupeFamilyAccountIds(input.familyAccountIds);
  if (!ids.length) {
    return { ok: false as const, status: 400, code: "NO_ACCOUNTS_SELECTED", error: "Select at least one family account." };
  }
  const strategy = parseBulkRecipientStrategy(input.recipientStrategy);
  const billingPeriod = statementSmsBillingPeriod(now);
  const snapshots = await loadSnapshots(schoolId, input.familyAccountIds, strategy, deps);
  const planned = planOutstandingBalanceSms({
    familyAccountIds: input.familyAccountIds,
    snapshots,
    template: resolved.template,
  });
  const priorCampaigns = await reminderCampaignStore.list(schoolId, billingPeriod, OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE);
  const sendable = applyPriorProtection(planned.messages, planned.skipped, protectedPhones(priorCampaigns));
  const hold = historicalStatementSmsHold({ schoolId, billingPeriod }) !== null;
  const prior = priorCampaigns.length > 0;
  const totals = counts(sendable);
  const outstanding = sendable.reduce(
    (sum, row) => sum + row.accounts.reduce((inner, account) => inner + account.balance, 0),
    0
  );
  const sharedAccounts = sendable.reduce((sum, row) => sum + Math.max(0, row.accounts.length - 1), 0);
  const smsReady = deps.smsReady ? await deps.smsReady(schoolId) : await isSchoolSmsReady(schoolId);
  const outboundDisabled = deps.outboundDisabled ?? isOutboundSmsDisabled();
  const credit = await readCreditWarning(schoolId, totals.totalCredits, deps, outboundDisabled);
  return {
    ok: true as const,
    status: 200,
    success: true as const,
    messageType: OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE,
    schoolId,
    billingPeriod,
    template: resolved.template,
    messageTemplate: resolved.template,
    defaultTemplate: OUTSTANDING_BALANCE_SMS_TEMPLATE,
    defaultMessageTemplate: OUTSTANDING_BALANCE_SMS_TEMPLATE,
    templateMaxChars: OUTSTANDING_BALANCE_SMS_TEMPLATE_MAX_CHARS,
    maxChars: OUTSTANDING_BALANCE_SMS_TEMPLATE_MAX_CHARS,
    recipientStrategy: strategy,
    requestedAccountCount: planned.selectedAccountCount,
    selectedAccountCount: planned.selectedAccountCount,
    eligibleAccountCount: new Set(sendable.flatMap((row) => row.accounts.map((account) => account.familyAccountId))).size,
    skippedAccountCount: planned.skipped.length,
    destinationCount: totals.uniquePhones,
    duplicateNumbersRemoved: sharedAccounts,
    sharedNumbersCombined: sharedAccounts,
    totalOutstanding: roundStatementMoney(outstanding),
    estimatedSegments: totals.totalSegments,
    estimatedCredits: totals.totalCredits,
    ...totals,
    messages: sendable.map((row) => publicMessage(row)),
    recipients: sendable.map((row) => ({
      displayName: row.displayName,
      mobileMasked: row.mobileMasked,
      accountNo: row.accountNo,
      message: row.message,
      encoding: row.encoding,
      segments: row.segments,
      credits: row.credits,
      includedAccounts: row.accounts,
    })),
    sampleMessages: sendable.map((row) => row.message).slice(0, 5),
    accounts: [
      ...sendable.flatMap((row) =>
        row.accounts.map((account) => ({
          familyAccountId: account.familyAccountId,
          accountNo: account.accountNo,
          balance: account.balance,
          status: "eligible" as const,
          skipReason: null,
          skipMessage: null,
          recipients: [
            {
              displayName: row.displayName,
              mobileMasked: row.mobileMasked,
              accountNo: row.accountNo,
            },
          ],
          sampleMessage: row.message,
          segments: row.segments,
        }))
      ),
      ...planned.skipped.map((row) => ({
        familyAccountId: row.familyAccountId,
        accountNo: row.accountNo,
        balance: row.balance,
        status: "skipped" as const,
        skipReason: row.reason,
        skipMessage: row.detail,
        recipients: [],
        sampleMessage: null,
        segments: 0,
      })),
    ],
    skipped: planned.skipped,
    requiresNewCampaignAuthorization: hold || prior,
    authorizationText: hold || prior ? NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT : null,
    historicalStatementHold: hold,
    historicalStatementNote: hold
      ? "The November 2026 statement SMS hold stays in place. This outstanding-balance campaign does not reuse or replace that missing recipient list."
      : null,
    handsetDelivered: null,
    acceptanceIsNotDelivery: true,
    smsReady,
    outboundDisabled,
    creditBalance: credit.creditBalance,
    creditBalanceIsCurrent: credit.creditBalanceIsCurrent,
    creditWarning: credit.creditWarning,
    canSend: totals.uniquePhones > 0 && smsReady && !outboundDisabled,
    concurrency: 1,
  };
}

type ClaimResult =
  | { ok: true; mode: "send" | "replay"; campaign: ReminderCampaign; toSend: StoredRecipient[] }
  | { ok: false; status: number; code: string; error: string; campaign?: ReminderCampaign };

async function claimCampaign(input: {
  schoolId: string;
  billingPeriod: string;
  sendInstanceId: string;
  messageTemplate: string;
  actorUserId?: string;
  authorizationText?: string;
  messages: PlannedMessage[];
  now: Date;
}): Promise<ClaimResult> {
  if (!UUID_RE.test(input.sendInstanceId)) {
    return { ok: false, status: 400, code: "SEND_INSTANCE_REQUIRED", error: "Each send needs one confirmation id. Nothing was sent." };
  }
  const key = campaignKey({
    schoolId: input.schoolId,
    billingPeriod: input.billingPeriod,
    recipientKeys: input.messages.map((row) => row.recipientKey),
    template: input.messageTemplate,
  });
  const contentHash = crypto.createHash("sha256").update(input.messageTemplate).digest("hex");
  return reminderCampaignStore.transaction(
    input.schoolId,
    input.billingPeriod,
    (campaigns): { campaigns: ReminderCampaign[]; result: ClaimResult } => {
      const sameInstance = campaigns.find((campaign) => campaign.sendInstanceId === input.sendInstanceId);
      if (sameInstance) {
        if (sameInstance.campaignKey !== key || sameInstance.contentHash !== contentHash) {
          return {
            campaigns,
            result: {
              ok: false,
              status: 409,
              code: "SEND_INSTANCE_MISMATCH",
              error: "This confirmation was already used for a different outstanding-balance SMS. Nothing further was sent.",
              campaign: sameInstance,
            },
          };
        }
        if (sameInstance.state === "in_progress") {
          const age = input.now.getTime() - Date.parse(sameInstance.createdAt);
          if (age < BULK_SMS_IN_PROGRESS_STALE_MS) {
            return {
              campaigns,
              result: {
                ok: false,
                status: 409,
                code: "BALANCE_SMS_IN_PROGRESS",
                error: "This confirmation is already being sent. WinSMS was not contacted again.",
                campaign: sameInstance,
              },
            };
          }
          sameInstance.state = "completed";
          sameInstance.completedAt = input.now.toISOString();
        }
        return { campaigns, result: { ok: true, mode: "replay", campaign: sameInstance, toSend: [] } };
      }
      const prior = protectedPhones(campaigns);
      const needsAuthorization =
        historicalStatementSmsHold({ schoolId: input.schoolId, billingPeriod: input.billingPeriod }) !== null ||
        campaigns.length > 0;
      if (needsAuthorization && !authorizationMatches(input.authorizationText)) {
        return {
          campaigns,
          result: {
            ok: false,
            status: 409,
            code: NEW_BALANCE_CAMPAIGN_AUTHORIZATION_CODE,
            error:
              "Confirm this as a new outstanding-balance campaign before sending. Accepted and unconfirmed numbers are not retried. Nothing was sent.",
          },
        };
      }
      const recipients = input.messages.map((row) => {
        const status = prior.get(row.phoneHash);
        if (status === "accepted") {
          return toStored(
            row,
            "accepted",
            "WinSMS already accepted this number for an outstanding-balance SMS. It was not sent again. Acceptance is not handset delivery.",
            false
          );
        }
        if (status === "pending") {
          return toStored(row, "pending", "An earlier submission for this number was not confirmed. It was not retried.", false);
        }
        return toStored(row, "pending", "Waiting for WinSMS acceptance.", true);
      });
      const campaign: ReminderCampaign = {
        campaignId: crypto.randomUUID(),
        messageType: OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE,
        schoolId: input.schoolId,
        billingPeriod: input.billingPeriod,
        campaignKey: key,
        sendInstanceId: input.sendInstanceId,
        contentHash,
        messageTemplate: input.messageTemplate,
        state: "in_progress",
        createdAt: input.now.toISOString(),
        actorUserId: String(input.actorUserId || "").trim() || undefined,
        authorizationText: needsAuthorization ? NEW_BALANCE_CAMPAIGN_AUTHORIZATION_TEXT : undefined,
        recipients,
      };
      return {
        campaigns: [...campaigns, campaign],
        result: { ok: true, mode: "send", campaign, toSend: recipients.filter((row) => row.providerCalled) },
      };
    },
    OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE
  );
}

function classifySendError(error: unknown): { status: ReminderProviderStatus; detail: string } {
  if (error instanceof WinSmsApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) {
    return { status: "failed", detail: publicSmsProviderError(error.message) };
  }
  const message = error instanceof Error ? error.message : "WinSMS did not confirm acceptance.";
  return {
    status: "pending",
    detail: `WinSMS did not confirm acceptance (${publicSmsProviderError(message)}). This number was not retried.`,
  };
}

export async function sendOutstandingBalanceSms(input: {
  schoolId: string;
  familyAccountIds: string[];
  sendInstanceId: string;
  recipientStrategy?: unknown;
  messageTemplate?: unknown;
  authorizationText?: string;
  actorUserId?: string;
  now?: Date;
  deps?: OutstandingBalanceSmsDeps;
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
      summary: "Outbound SMS is disabled. Nothing was sent.",
      handsetDelivered: null,
      simulated: false,
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
  const resolved = resolveOutstandingBalanceTemplate(input.messageTemplate);
  if (!resolved.ok) return { ...resolved, handsetDelivered: null };
  const strategy = parseBulkRecipientStrategy(input.recipientStrategy);
  const snapshots = await loadSnapshots(schoolId, input.familyAccountIds, strategy, deps);
  const planned = planOutstandingBalanceSms({
    familyAccountIds: input.familyAccountIds,
    snapshots,
    template: resolved.template,
  });
  const billingPeriod = statementSmsBillingPeriod(now);
  if (!planned.messages.length) {
    return {
      ok: false as const,
      status: 400,
      code: "NO_ELIGIBLE_DESTINATIONS",
      error: "No selected account has a positive balance and a valid mobile.",
      summary: "No selected account has a positive balance and a valid mobile.",
      skipped: planned.skipped,
      skippedAccountCount: planned.skipped.length,
      handsetDelivered: null,
    };
  }
  let claim: ClaimResult;
  try {
    claim = await claimCampaign({
      schoolId,
      billingPeriod,
      sendInstanceId: String(input.sendInstanceId || "").trim(),
      messageTemplate: resolved.template,
      actorUserId: input.actorUserId,
      authorizationText: input.authorizationText,
      messages: planned.messages,
      now,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    if (/Unique constraint/i.test(raw)) {
      return {
        ok: false as const,
        status: 409,
        code: "SEND_INSTANCE_MISMATCH",
        error: "This confirmation was already used. Nothing further was sent.",
        handsetDelivered: null,
      };
    }
    return {
      ok: false as const,
      status: 503,
      code: "SMS_SEND_LOG_BUSY",
      error: "Outstanding balance SMS log is busy. Nothing was sent.",
      handsetDelivered: null,
    };
  }
  if (!claim.ok) return { ...claim, skipped: planned.skipped, handsetDelivered: null, simulated: false };

  const byKey = new Map(planned.messages.map((row) => [row.recipientKey, row]));
  if (claim.mode === "send") {
    for (const recipient of claim.toSend) {
      const plan = byKey.get(recipient.recipientKey);
      if (!plan) continue;
      try {
        const response = deps.sendSms
          ? await deps.sendSms(schoolId, {
              message: recipient.message,
              mobileNumber: plan.mobileNumber,
              clientMessageId: `obal-${claim.campaign.campaignId.slice(0, 8)}-${recipient.phoneHash.slice(0, 8)}`,
              maxSegments: recipient.segments,
            })
          : await sendSchoolSms(schoolId, {
              message: recipient.message,
              recipients: [
                {
                  mobileNumber: plan.mobileNumber,
                  clientMessageId: `obal-${claim.campaign.campaignId.slice(0, 8)}-${recipient.phoneHash.slice(0, 8)}`,
                },
              ],
              maxSegments: recipient.segments,
            });
        const outcome = classifyWinSmsDestinationOutcome(summariseWinSmsAcceptance(response));
        const status: ReminderProviderStatus =
          outcome.status === "sent" ? "accepted" : outcome.status === "failed" ? "failed" : "pending";
        await reminderCampaignStore.updateRecipient(
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
        await reminderCampaignStore.updateRecipient(
          claim.campaign.campaignId,
          schoolId,
          recipient.recipientKey,
          classified.status,
          classified.detail
        );
      }
    }
    await reminderCampaignStore.complete(claim.campaign.campaignId, schoolId, now.toISOString());
  }

  const stored = await reminderCampaignStore.find(schoolId, claim.campaign.campaignId, OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE);
  const recipients = stored?.recipients || claim.campaign.recipients;
  const accepted = recipients.filter((row) => row.status === "accepted").length;
  const failed = recipients.filter((row) => row.status === "failed").length;
  const pending = recipients.filter((row) => row.status === "pending").length;
  const billed = recipients
    .filter((row) => row.providerCalled && (row.status === "accepted" || row.status === "pending"))
    .reduce((sum, row) => sum + row.segments, 0);
  const submitted = claim.mode === "send" && claim.toSend.length > 0;
  const summary = !submitted
    ? `WinSMS was not contacted again. Stored result: ${accepted} accepted, ${failed} rejected, ${pending} not confirmed. Accepted and unconfirmed numbers were not retried. Acceptance is not handset delivery.`
    : `WinSMS result for this outstanding-balance SMS: ${accepted} accepted, ${failed} rejected, ${pending} not confirmed. Acceptance is not handset delivery.`;
  return {
    ok: true as const,
    status: pending > 0 || failed > 0 ? 207 : 200,
    success: true as const,
    messageType: OUTSTANDING_BALANCE_SMS_MESSAGE_TYPE,
    campaignId: claim.campaign.campaignId,
    sendInstanceId: claim.campaign.sendInstanceId,
    operationId: claim.campaign.campaignId,
    billingPeriod,
    replayed: claim.mode === "replay",
    providerCalled: claim.mode === "send" && claim.toSend.length > 0,
    accepted,
    failed,
    pending,
    attemptedDestinations: recipients.length,
    successfulDestinations: accepted,
    failedDestinations: failed,
    unconfirmedDestinations: pending,
    skippedAccountCount: planned.skipped.length,
    billedSegments: billed,
    creditsUsed: billed,
    maxMessageSegments: recipients.reduce((max, row) => Math.max(max, row.segments), 0),
    handsetDelivered: null,
    acceptanceIsNotDelivery: true,
    summary,
    messages: recipients.map((row) => publicMessage(row)),
    results: recipients.map((row) => ({
      familyAccountId: row.familyAccountId,
      accountNo: row.accountNo,
      parentIds: [],
      displayNames: [row.displayName],
      mobileMasked: row.mobileMasked,
      status: row.status === "accepted" ? "accepted" : row.status === "failed" ? "failed" : "unconfirmed",
      error: row.status === "accepted" ? null : row.providerDetail,
    })),
    skipped: planned.skipped,
    simulated: false,
    duplicateBlocked: false,
    resent: false,
  };
}
