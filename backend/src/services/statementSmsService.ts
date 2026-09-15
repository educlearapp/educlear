/**
 * Statement SMS delivery — Phase A.
 * Server resolves FamilyAccount, eligible billing/SMS parents, balance wording,
 * and sends via WinSMS only (sendSchoolSms). Client phone numbers are never trusted.
 */
import { prisma } from "../prisma";
import {
  resolveLedgerJoinAccountRef,
  resolveVisibleAccountNo,
} from "./familyAccountNumber";
import { resolveAuthoritativeAccountBalance } from "./statementAccounts";
import { normalizeSaPhone } from "./parentPortalService";
import { isSchoolSmsReady, sendSchoolSms } from "./schoolSmsService";
import { WinSmsApiError } from "./winSmsClient";
import { isOutboundSmsDisabled } from "../utils/outboundSafety";

export const STATEMENT_SMS_MAX_CHARS = 480;
export const STATEMENT_SMS_SEGMENT_CHARS = 160;

export type StatementSmsBalanceClass = "outstanding" | "settled" | "credit";

export type StatementSmsParentPair = {
  parent: {
    id: string;
    schoolId: string;
    firstName: string;
    surname: string;
    cellNo: string;
    communicationBilling: boolean | null;
    communicationBySMS: boolean | null;
    billingStatement?: boolean | null;
  };
  link: {
    billingStatement: boolean | null;
    isPrimary: boolean;
    isPayingPerson: boolean;
    relation: string | null;
    communicationBilling?: boolean | null;
    communicationBySMS?: boolean | null;
  };
};

export type StatementSmsEligibleContact = {
  parentId: string;
  displayName: string;
  relationship: string;
  mobileMasked: string;
  mobileLast4: string;
  score: number;
  recommended: boolean;
};

export type StatementSmsDestination = {
  parentIds: string[];
  displayNames: string[];
  mobileNumber: string;
  mobileMasked: string;
  mobileLast4: string;
};

export type StatementSmsSendResultRow = {
  parentIds: string[];
  displayNames: string[];
  mobileMasked: string;
  status: "sent" | "failed";
  error: string | null;
};

function parentDisplayName(parent: StatementSmsParentPair["parent"]): string {
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent / Guardian";
}

export function isValidStatementSmsMobile(cellNo: string): boolean {
  const { plainInternational } = normalizeSaPhone(cellNo);
  return plainInternational.replace(/\D/g, "").length >= 10;
}

export function maskStatementSmsMobile(cellNo: string): { masked: string; last4: string } {
  const { plainInternational } = normalizeSaPhone(cellNo);
  const digits = plainInternational.replace(/\D/g, "");
  const last4 = digits.slice(-4) || "????";
  return { masked: `•••• ${last4}`, last4 };
}

/**
 * Billing + SMS consent for statement SMS.
 * Explicit false excludes; null/undefined legacy values are allowed (matches email statement rules).
 */
export function isStatementSmsBillingContact(pair: StatementSmsParentPair): boolean {
  const { parent, link } = pair;
  if (link.billingStatement === false) return false;
  if (parent.billingStatement === false) return false;
  if (parent.communicationBilling === false) return false;
  if (link.communicationBilling === false) return false;
  if (parent.communicationBySMS === false) return false;
  if (link.communicationBySMS === false) return false;
  return isValidStatementSmsMobile(parent.cellNo);
}

/** Same ranking weights as statement email billing contact. */
export function statementSmsContactScore(pair: StatementSmsParentPair): number {
  let score = 0;
  if (linkIsPrimary(pair)) score += 10;
  if (pair.link.isPayingPerson) score += 6;
  if (pair.parent.communicationBilling !== false && pair.link.communicationBilling !== false) {
    score += 2;
  }
  return score;
}

function linkIsPrimary(pair: StatementSmsParentPair): boolean {
  return Boolean(pair.link.isPrimary);
}

export function classifyStatementSmsBalance(balance: number): StatementSmsBalanceClass {
  if (balance > 0) return "outstanding";
  if (balance < 0) return "credit";
  return "settled";
}

export function formatStatementSmsAmount(balance: number): string {
  const abs = Math.abs(Number.isFinite(balance) ? balance : 0);
  const formatted = abs.toLocaleString("en-ZA", {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `R${formatted}`;
}

export function buildDefaultStatementSmsMessage(input: {
  schoolName: string;
  accountNo: string;
  balance: number;
}): { text: string; balanceClass: StatementSmsBalanceClass } {
  const schoolName = String(input.schoolName || "School").trim() || "School";
  const accountNo = String(input.accountNo || "").trim() || "Account";
  const balanceClass = classifyStatementSmsBalance(input.balance);

  if (balanceClass === "outstanding") {
    const amount = formatStatementSmsAmount(input.balance);
    return {
      balanceClass,
      text: `${schoolName}: Account ${accountNo} has an outstanding balance of ${amount}. Please view your statement for details. Thank you.`,
    };
  }

  return {
    balanceClass,
    text: `${schoolName}: Your latest account statement for Account ${accountNo} is available. Please view your statement for details. Thank you.`,
  };
}

export function sanitiseStatementSmsMessage(raw: string): {
  ok: true; message: string; charCount: number; segments: number
} | { ok: false; error: string } {
  const message = String(raw || "").trim();
  if (!message) {
    return { ok: false, error: "SMS message is required." };
  }
  if (message.length > STATEMENT_SMS_MAX_CHARS) {
    return {
      ok: false,
      error: `SMS message must be ${STATEMENT_SMS_MAX_CHARS} characters or fewer.`,
    };
  }
  const charCount = message.length;
  const segments = Math.max(1, Math.ceil(charCount / STATEMENT_SMS_SEGMENT_CHARS));
  return { ok: true, message, charCount, segments };
}

export function rankStatementSmsContacts(
  pairs: StatementSmsParentPair[]
): StatementSmsEligibleContact[] {
  const eligible = pairs.filter(isStatementSmsBillingContact);
  const byParent = new Map<string, { pair: StatementSmsParentPair; score: number }>();

  for (const pair of eligible) {
    const id = String(pair.parent.id || "").trim();
    if (!id) continue;
    const score = statementSmsContactScore(pair);
    const existing = byParent.get(id);
    if (!existing || score > existing.score) {
      byParent.set(id, { pair, score });
    }
  }

  const ranked = [...byParent.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return parentDisplayName(a.pair.parent).localeCompare(parentDisplayName(b.pair.parent));
  });

  return ranked.map((row, index) => {
    const mobile = maskStatementSmsMobile(row.pair.parent.cellNo);
    return {
      parentId: row.pair.parent.id,
      displayName: parentDisplayName(row.pair.parent),
      relationship:
        String(row.pair.link.relation || "").trim() || "Parent",
      mobileMasked: mobile.masked,
      mobileLast4: mobile.last4,
      score: row.score,
      recommended: index === 0,
    };
  });
}

/** Deduplicate destinations by normalised mobile; preserve parent IDs sharing a number. */
export function buildStatementSmsDestinations(
  pairs: StatementSmsParentPair[]
): StatementSmsDestination[] {
  const map = new Map<string, StatementSmsDestination>();
  for (const pair of pairs) {
    if (!isStatementSmsBillingContact(pair)) continue;
    const { plainInternational } = normalizeSaPhone(pair.parent.cellNo);
    const digits = plainInternational.replace(/\D/g, "");
    if (digits.length < 10) continue;
    const mask = maskStatementSmsMobile(pair.parent.cellNo);
    const existing = map.get(digits);
    if (existing) {
      if (!existing.parentIds.includes(pair.parent.id)) {
        existing.parentIds.push(pair.parent.id);
        existing.displayNames.push(parentDisplayName(pair.parent));
      }
      continue;
    }
    map.set(digits, {
      parentIds: [pair.parent.id],
      displayNames: [parentDisplayName(pair.parent)],
      mobileNumber: digits,
      mobileMasked: mask.masked,
      mobileLast4: mask.last4,
    });
  }
  return [...map.values()];
}

export function selectStatementSmsPairs(
  allEligible: StatementSmsParentPair[],
  selection: { mode: "all" } | { mode: "parentIds"; parentIds: string[] }
): { ok: true; pairs: StatementSmsParentPair[] } | { ok: false; error: string; code: string } {
  const eligibleById = new Map(
    allEligible
      .filter(isStatementSmsBillingContact)
      .map((p) => [p.parent.id, p] as const)
  );

  if (selection.mode === "all") {
    const pairs = [...eligibleById.values()];
    if (!pairs.length) {
      return {
        ok: false,
        error: "No eligible billing SMS contacts for this account.",
        code: "NO_ELIGIBLE_CONTACTS",
      };
    }
    return { ok: true, pairs };
  }

  const requested = [
    ...new Set(
      (selection.parentIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ];
  if (!requested.length) {
    return {
      ok: false,
      error: "Select at least one eligible contact.",
      code: "NO_PARENT_SELECTED",
    };
  }

  const pairs: StatementSmsParentPair[] = [];
  for (const id of requested) {
    const pair = eligibleById.get(id);
    if (!pair) {
      return {
        ok: false,
        error: "One or more selected contacts are not eligible for statement SMS on this account.",
        code: "INVALID_PARENT_SELECTION",
      };
    }
    pairs.push(pair);
  }
  return { ok: true, pairs };
}

type ResolvedAccount = {
  familyAccountId: string;
  accountRef: string;
  displayAccountNo: string;
  schoolId: string;
  schoolName: string;
};

async function resolveStatementSmsAccount(
  schoolId: string,
  input: {
    familyAccountId?: string;
    accountRef?: string;
    accountNo?: string;
    learnerId?: string;
  }
): Promise<ResolvedAccount | null> {
  const sid = String(schoolId || "").trim();
  if (!sid) return null;

  const familyAccountId = String(input.familyAccountId || "").trim();
  const accountRef = String(input.accountRef || "").trim().toUpperCase();
  const accountNo = String(input.accountNo || "").trim().toUpperCase();
  const learnerId = String(input.learnerId || "").trim();

  let family =
    familyAccountId
      ? await prisma.familyAccount.findFirst({
          where: { id: familyAccountId, schoolId: sid },
          select: {
            id: true,
            schoolId: true,
            accountRef: true,
            accountNo: true,
            school: { select: { name: true } },
          },
        })
      : null;

  if (!family && accountRef) {
    family = await prisma.familyAccount.findFirst({
      where: { schoolId: sid, accountRef },
      select: {
        id: true,
        schoolId: true,
        accountRef: true,
        accountNo: true,
        school: { select: { name: true } },
      },
    });
  }

  if (!family && accountNo) {
    family = await prisma.familyAccount.findFirst({
      where: {
        schoolId: sid,
        OR: [{ accountNo }, { accountRef: accountNo }],
      },
      select: {
        id: true,
        schoolId: true,
        accountRef: true,
        accountNo: true,
        school: { select: { name: true } },
      },
    });
  }

  if (!family && learnerId) {
    const learner = await prisma.learner.findFirst({
      where: { id: learnerId, schoolId: sid },
      select: {
        familyAccount: {
          select: {
            id: true,
            schoolId: true,
            accountRef: true,
            accountNo: true,
            school: { select: { name: true } },
          },
        },
      },
    });
    family = learner?.familyAccount || null;
  }

  if (!family) return null;

  const joinRef = resolveLedgerJoinAccountRef(family);
  return {
    familyAccountId: family.id,
    accountRef: joinRef,
    displayAccountNo: resolveVisibleAccountNo(family) || joinRef,
    schoolId: family.schoolId,
    schoolName: String(family.school?.name || "School").trim() || "School",
  };
}

async function loadEligibleStatementSmsPairs(
  schoolId: string,
  familyAccountId: string
): Promise<StatementSmsParentPair[]> {
  const learners = await prisma.learner.findMany({
    where: { schoolId, familyAccountId },
    select: { id: true },
  });
  const learnerIds = learners.map((l) => l.id);
  if (!learnerIds.length) return [];

  const links = await prisma.parentLearnerLink.findMany({
    where: {
      schoolId,
      learnerId: { in: learnerIds },
    },
    select: {
      billingStatement: true,
      isPrimary: true,
      isPayingPerson: true,
      relation: true,
      parent: {
        select: {
          id: true,
          schoolId: true,
          firstName: true,
          surname: true,
          cellNo: true,
          communicationBilling: true,
          communicationBySMS: true,
        },
      },
    },
  });

  const pairs: StatementSmsParentPair[] = [];

  for (const link of links) {
    const parent = link.parent;
    if (!parent) continue;
    if (String(parent.schoolId) !== String(schoolId)) continue;
    pairs.push({
      parent: {
        id: parent.id,
        schoolId: parent.schoolId,
        firstName: parent.firstName,
        surname: parent.surname,
        cellNo: parent.cellNo,
        communicationBilling: parent.communicationBilling,
        communicationBySMS: parent.communicationBySMS,
      },
      link: {
        billingStatement: link.billingStatement,
        isPrimary: link.isPrimary,
        isPayingPerson: link.isPayingPerson,
        relation: link.relation,
      },
    });
  }

  return pairs;
}

export async function previewStatementSms(input: {
  schoolId: string;
  familyAccountId?: string;
  accountRef?: string;
  accountNo?: string;
  learnerId?: string;
}) {
  const account = await resolveStatementSmsAccount(input.schoolId, input);
  if (!account) {
    return {
      ok: false as const,
      status: 404,
      error: "Family account not found for this school.",
      code: "ACCOUNT_NOT_FOUND",
    };
  }

  const pairs = await loadEligibleStatementSmsPairs(account.schoolId, account.familyAccountId);
  const contacts = rankStatementSmsContacts(pairs);
  const balance = await resolveAuthoritativeAccountBalance(
    account.schoolId,
    account.accountRef
  );
  const defaultMessage = buildDefaultStatementSmsMessage({
    schoolName: account.schoolName,
    accountNo: account.displayAccountNo,
    balance,
  });
  const smsReady = await isSchoolSmsReady(account.schoolId);
  const outboundDisabled = isOutboundSmsDisabled();

  return {
    ok: true as const,
    familyAccountId: account.familyAccountId,
    accountRef: account.accountRef,
    accountNo: account.displayAccountNo,
    description: `Statement ${account.displayAccountNo}`,
    schoolName: account.schoolName,
    balance,
    balanceClass: defaultMessage.balanceClass,
    defaultMessage: defaultMessage.text,
    contacts,
    recommendedParentId: contacts.find((c) => c.recommended)?.parentId || null,
    smsReady,
    outboundDisabled,
    canSend: smsReady && !outboundDisabled && contacts.length > 0,
  };
}

export async function sendStatementSms(input: {
  schoolId: string;
  familyAccountId?: string;
  accountRef?: string;
  accountNo?: string;
  learnerId?: string;
  selectionMode: "all" | "parentIds";
  parentIds?: string[];
  message: string;
  /** Ignored — phones from client are never used. */
  mobileNumbers?: unknown;
  cellNo?: unknown;
  phone?: unknown;
}) {
  // Explicitly ignore any client-supplied phone fields.
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
    };
  }

  const account = await resolveStatementSmsAccount(input.schoolId, input);
  if (!account) {
    return {
      ok: false as const,
      status: 404,
      error: "Family account not found for this school.",
      code: "ACCOUNT_NOT_FOUND",
      simulated: false,
    };
  }

  const ready = await isSchoolSmsReady(account.schoolId);
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

  const messageCheck = sanitiseStatementSmsMessage(input.message);
  if (!messageCheck.ok) {
    return {
      ok: false as const,
      status: 400,
      error: messageCheck.error,
      code: "INVALID_MESSAGE",
      simulated: false,
    };
  }

  // Reload eligibility at send time (never trust prior preview).
  const allPairs = await loadEligibleStatementSmsPairs(
    account.schoolId,
    account.familyAccountId
  );
  const selected = selectStatementSmsPairs(
    allPairs,
    input.selectionMode === "all"
      ? { mode: "all" }
      : { mode: "parentIds", parentIds: input.parentIds || [] }
  );
  if (!selected.ok) {
    return {
      ok: false as const,
      status: 400,
      error: selected.error,
      code: selected.code,
      simulated: false,
    };
  }

  const destinations = buildStatementSmsDestinations(selected.pairs);
  if (!destinations.length) {
    return {
      ok: false as const,
      status: 400,
      error: "No valid mobile numbers on the selected contacts.",
      code: "NO_VALID_MOBILE",
      simulated: false,
    };
  }

  const results: StatementSmsSendResultRow[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const dest of destinations) {
    try {
      await sendSchoolSms(account.schoolId, {
        message: messageCheck.message,
        recipients: [
          {
            mobileNumber: dest.mobileNumber,
            clientMessageId: `stmt-${account.familyAccountId.slice(0, 8)}-${dest.parentIds[0].slice(0, 8)}`,
          },
        ],
        maxSegments: messageCheck.segments,
        clientMessageIdPrefix: `stmt-${account.familyAccountId}`,
      });
      sentCount += 1;
      results.push({
        parentIds: dest.parentIds,
        displayNames: dest.displayNames,
        mobileMasked: dest.mobileMasked,
        status: "sent",
        error: null,
      });
    } catch (error) {
      failedCount += 1;
      const errMsg =
        error instanceof WinSmsApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "SMS send failed";
      results.push({
        parentIds: dest.parentIds,
        displayNames: dest.displayNames,
        mobileMasked: dest.mobileMasked,
        status: "failed",
        error: errMsg,
      });
    }
  }

  const allSent = failedCount === 0 && sentCount > 0;
  const partial = sentCount > 0 && failedCount > 0;
  const summary =
    allSent && destinations.length === 1 && destinations[0].parentIds.length > 1
      ? `SMS sent successfully (${destinations[0].parentIds.length} parents share the same mobile number — one message sent).`
      : allSent && destinations.length > 1
        ? `SMS sent successfully to ${sentCount} destination${sentCount === 1 ? "" : "s"}.`
        : allSent
          ? "SMS sent successfully."
          : partial
            ? `${sentCount} SMS sent. ${failedCount} SMS failed.`
            : "SMS send failed.";

  return {
    ok: allSent || partial,
    status: allSent ? 200 : partial ? 207 : 502,
    simulated: false,
    summary,
    sentCount,
    failedCount,
    destinationCount: destinations.length,
    deduplicated: destinations.some((d) => d.parentIds.length > 1),
    results,
    accountNo: account.displayAccountNo,
    familyAccountId: account.familyAccountId,
    charCount: messageCheck.charCount,
    segments: messageCheck.segments,
  };
}
