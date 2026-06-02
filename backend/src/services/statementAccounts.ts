import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import { isKidESysSourceAccountRef } from "./daSilvaMigration/ageAnalysisParser";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import {
  buildKidesysHistoryAccountIndex,
  type KidesysHistoryEntry,
  readSchoolKidesysHistory,
} from "../utils/kidesysTransactionHistoryStore";
import {
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  MIGRATED_OPENING_BALANCE_OVERVIEW,
  countsTowardPostImportBalanceDelta,
  isKidesysOpeningBalanceEntry,
} from "../utils/billingDisplayRules";
import { normalizeKidesysBillingSection } from "./billingSummary";
import {
  learnerFullName,
  matchLearnersToAccountHolder,
  resolveMemberNames,
  splitAccountHolderNames,
} from "./familyAccountMembers";

export type BillingStatementAccountRow = {
  accountNo: string;
  learnerId: string;
  schoolId: string;
  name: string;
  surname: string;
  balance: number;
  lastInvoice: number;
  lastInvoiceDate: string;
  lastInvoiceLabel: string | null;
  lastPayment: number;
  lastPaymentDate: string;
  status: string;
  kidesysSection: string;
  familyAccountId: string | null;
  familyName: string | null;
  memberLearnerIds: string[];
  memberNames: string[];
  accountHolder: string;
  ageAnalysis?: {
    accountHolder: string;
    buckets: FamilyAccountAgeAnalysisSnapshot["buckets"];
    importedAt: string;
    source: string;
  };
};

/** SA-SAMS numeric admission-style refs must never be billing identity. */
export function isSasamsNumericBillingAccount(value: string): boolean {
  const v = String(value || "").trim();
  if (!v || isKidESysSourceAccountRef(v)) return false;
  return /^\d{4,}$/.test(v);
}

function splitDisplayName(full: string): { name: string; surname: string } {
  const raw = String(full || "").trim();
  if (!raw) return { name: "-", surname: "-" };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return { name: "-", surname: "-" };
  if (parts.length === 1) return { name: parts[0], surname: "-" };
  return { name: parts[0], surname: parts.slice(1).join(" ") };
}

function statusFromBalance(balance: number) {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

function displayStatusFromKidesysSection(kidesysSection: string, balance: number) {
  const section = normalizeKidesysBillingSection(kidesysSection);
  if (section) return section;
  return statusFromBalance(balance);
}

type BillingIdentityMode = "legacy" | "kidesys_accountRef_only";

function resolveKidesysAccountRefOnly(learner: {
  familyAccount: { accountRef: string } | null;
}): string {
  const ref = String(learner.familyAccount?.accountRef || "").trim();
  return isKidESysSourceAccountRef(ref) ? ref : "";
}

function resolveBillingGroupKey(learner: {
  id: string;
  familyAccountId: string | null;
  familyAccount: { accountRef: string } | null;
}, mode: BillingIdentityMode): string {
  const familyAccountId = String(learner.familyAccountId || "").trim();
  if (familyAccountId) {
    if (mode === "kidesys_accountRef_only") {
      const ref = resolveKidesysAccountRefOnly(learner);
      if (ref) return `family:${familyAccountId}`;
      return `learner:${learner.id}`;
    }
    return `family:${familyAccountId}`;
  }
  if (mode !== "kidesys_accountRef_only") {
    const accountNo = resolveLearnerAccountNo(learner);
    if (accountNo && accountNo !== "-") return `account:${accountNo}`;
  }
  return `learner:${learner.id}`;
}

function lastRealInvoice(entries: BillingLedgerEntry[]) {
  return entries
    .filter((e) => e.type === "invoice" && !isKidesysOpeningBalanceEntry(e))
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0];
}

function resolveLastInvoiceFields(
  accountEntries: BillingLedgerEntry[],
  historySummary?: { lastInvoice: KidesysHistoryEntry | null }
) {
  const histInv = historySummary?.lastInvoice;
  const lastInvoice = lastRealInvoice(accountEntries);
  if (histInv) {
    const histDate = String(histInv.date || "").trim();
    const ledgerDate = String(lastInvoice?.date || "").trim();
    const ledgerIsNewer = Boolean(ledgerDate && (!histDate || ledgerDate > histDate));
    if (!ledgerIsNewer) {
      return {
        lastInvoice: histInv.amount ?? 0,
        lastInvoiceDate: histInv.date || "",
        lastInvoiceLabel: null as string | null,
      };
    }
  }
  if (lastInvoice) {
    return {
      lastInvoice: lastInvoice.amount ?? 0,
      lastInvoiceDate: lastInvoice.date || "",
      lastInvoiceLabel: null as string | null,
    };
  }
  const hasOpeningBalance = accountEntries.some(
    (e) => e.type === "invoice" && isKidesysOpeningBalanceEntry(e)
  );
  if (hasOpeningBalance) {
    return {
      lastInvoice: 0,
      lastInvoiceDate: "",
      lastInvoiceLabel: MIGRATED_OPENING_BALANCE_OVERVIEW,
    };
  }
  return {
    lastInvoice: 0,
    lastInvoiceDate: "",
    lastInvoiceLabel: null as string | null,
  };
}

function resolveLastPaymentFields(
  accountEntries: BillingLedgerEntry[],
  historySummary?: { lastPayment: KidesysHistoryEntry | null }
) {
  const histPay = historySummary?.lastPayment;
  const lastPayment = accountEntries
    .filter((e) => e.type === "payment")
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0];
  if (histPay) {
    const histDate = String(histPay.date || "").trim();
    const ledgerDate = String(lastPayment?.date || "").trim();
    const ledgerIsNewer = Boolean(ledgerDate && (!histDate || ledgerDate > histDate));
    if (!ledgerIsNewer) {
      return {
        lastPayment: histPay.amount ?? 0,
        lastPaymentDate: histPay.date || "",
      };
    }
  }
  return {
    lastPayment: lastPayment?.amount ?? 0,
    lastPaymentDate: lastPayment?.date || "",
  };
}

/**
 * Authoritative billing account list: Kid-e-Sys Age Analysis snapshots (accountRef) +
 * ledger + display history. Never uses SA-SAMS admission numbers for accountNo.
 */
export async function buildAccountsFromAgeAnalysisSnapshots(
  schoolId: string,
  opts: {
    ledger?: BillingLedgerEntry[];
    history?: KidesysHistoryEntry[];
  } = {}
): Promise<BillingStatementAccountRow[]> {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];

  const snapshotsByRef = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
  const snapshots: FamilyAccountAgeAnalysisSnapshot[] = Object.values(snapshotsByRef || {});
  const accountRefs = snapshots
    .map((s) => String(s.accountRef || "").trim().toUpperCase())
    .filter(Boolean);

  if (!accountRefs.length) return [];

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId: sid, accountRef: { in: accountRefs } },
    select: { id: true, accountRef: true, familyName: true },
  });
  const familyByRef = new Map(
    familyAccounts.map((fa) => [String(fa.accountRef).trim().toUpperCase(), fa])
  );

  const schoolLearners = await prisma.learner.findMany({
    where: { schoolId: sid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true } },
    },
  });

  const learnersByRef = new Map<
    string,
    { id: string; firstName: string; lastName: string; fullName: string }[]
  >();
  for (const l of schoolLearners) {
    const ref = String(l.familyAccount?.accountRef || "").trim().toUpperCase();
    if (!ref || !accountRefs.includes(ref)) continue;
    const firstName = String(l.firstName || "").trim();
    const lastName = String(l.lastName || "").trim();
    const fullName = learnerFullName({ id: l.id, firstName, lastName }) || ref;
    const bucket = learnersByRef.get(ref) || [];
    if (!bucket.some((row) => row.id === l.id)) {
      bucket.push({ id: l.id, firstName, lastName, fullName });
      learnersByRef.set(ref, bucket);
    }
  }

  const ledger = opts.ledger ?? readSchoolLedger(sid);
  const history = opts.history ?? readSchoolKidesysHistory(sid);
  const historyIndex = buildKidesysHistoryAccountIndex(history);

  return snapshots.map((snap) => {
    const accountRef = String(snap.accountRef || "").trim().toUpperCase();
    const ageBalance = Number(snap.balance) || 0;
    const family = familyByRef.get(accountRef);
    const accountHolder = String(snap.accountHolder || family?.familyName || "").trim();
    const linkedLearners = learnersByRef.get(accountRef) || [];
    const matchedByHolder = matchLearnersToAccountHolder(schoolLearners, accountHolder);
    const memberLearnerMap = new Map<string, { id: string; firstName: string; lastName: string; fullName: string }>();
    for (const row of [...linkedLearners, ...matchedByHolder.map((l) => ({
      id: l.id,
      firstName: String(l.firstName || "").trim(),
      lastName: String(l.lastName || "").trim(),
      fullName: learnerFullName(l),
    }))]) {
      if (!row.id || memberLearnerMap.has(row.id)) continue;
      memberLearnerMap.set(row.id, row);
    }
    const memberLearners = Array.from(memberLearnerMap.values());
    const memberNames = resolveMemberNames(accountHolder, memberLearners);
    const anchor = memberLearners[0];
    const holderNames = splitAccountHolderNames(accountHolder);
    const label =
      memberNames.join(" · ") ||
      String(family?.familyName || "").trim() ||
      String(anchor?.fullName || "").trim() ||
      accountRef ||
      "-";
    const split = splitDisplayName(holderNames[0] || label);
    const name = String(anchor?.firstName || "").trim() || split.name;
    const surname = String(anchor?.lastName || "").trim() || split.surname;

    const accountEntries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === accountRef
    );
    const hist = historyIndex.get(accountRef) || { lastInvoice: null, lastPayment: null };
    const invoiceFields = resolveLastInvoiceFields(accountEntries, hist);
    const paymentFields = resolveLastPaymentFields(accountEntries, hist);

    const importedAt = String(snap.importedAt || "").trim();
    const postImportEntries = accountEntries.filter((e) => {
      if (!countsTowardPostImportBalanceDelta(e)) return false;
      if (!importedAt) return true;
      return String(e.createdAt || "") >= importedAt;
    });
    const deltaBalance = calculateBalanceFromEntries(postImportEntries);
    const balance = ageBalance + deltaBalance;
    const kidesysSection = normalizeKidesysBillingSection(snap.kidesysSection);
    const hasLiveLedgerDelta = postImportEntries.length > 0;
    const accountStatus = hasLiveLedgerDelta
      ? statusFromBalance(balance)
      : displayStatusFromKidesysSection(kidesysSection, balance);

    return {
      accountNo: accountRef || "-",
      learnerId: anchor?.id || "",
      schoolId: sid,
      name,
      surname,
      balance,
      lastInvoice: invoiceFields.lastInvoice,
      lastInvoiceDate: invoiceFields.lastInvoiceDate,
      lastInvoiceLabel: invoiceFields.lastInvoiceLabel,
      lastPayment: paymentFields.lastPayment,
      lastPaymentDate: paymentFields.lastPaymentDate,
      status: accountStatus,
      kidesysSection,
      familyAccountId: family?.id || null,
      familyName: family?.familyName ?? null,
      memberLearnerIds: memberLearners.map((l) => l.id),
      memberNames,
      accountHolder,
      ageAnalysis: {
        accountHolder: snap.accountHolder,
        buckets: snap.buckets,
        importedAt: snap.importedAt,
        source: snap.source,
      },
    };
  });
}

/** One row per family billing account (deduped siblings). */
export async function buildAccountsFromLearners(
  schoolId: string,
  ledger: BillingLedgerEntry[],
  historyOverride?: KidesysHistoryEntry[],
  opts: { billingIdentityMode?: BillingIdentityMode } = {}
) {
  const billingIdentityMode = opts.billingIdentityMode ?? "legacy";
  const history =
    historyOverride !== undefined ? historyOverride : readSchoolKidesysHistory(schoolId);
  const historyIndex = buildKidesysHistoryAccountIndex(history);
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      schoolId: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true, familyName: true } },
    },
  });

  const groups = new Map<string, { anchor: (typeof learners)[0]; memberIds: string[] }>();

  for (const learner of learners) {
    const key = resolveBillingGroupKey(learner, billingIdentityMode);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.memberIds.includes(learner.id)) {
        existing.memberIds.push(learner.id);
      }
      continue;
    }
    groups.set(key, { anchor: learner, memberIds: [learner.id] });
  }

  return Array.from(groups.values()).map(({ anchor, memberIds }) => {
    const accountNo =
      billingIdentityMode === "kidesys_accountRef_only"
        ? resolveKidesysAccountRefOnly(anchor) || "-"
        : resolveLearnerAccountNo(anchor);
    const accountEntries = collectFamilyAccountEntries(ledger, {
      accountRef: accountNo,
      learnerIds: memberIds,
    });
    const balance = calculateBalanceFromEntries(accountEntries);
    const historySummary = historyIndex.get(accountNo) || {
      lastInvoice: null,
      lastPayment: null,
    };
    const invoiceFields = resolveLastInvoiceFields(accountEntries, historySummary);
    const paymentFields = resolveLastPaymentFields(accountEntries, historySummary);
    const kidesysSection = "";

    return {
      accountNo,
      learnerId: anchor.id,
      schoolId: anchor.schoolId,
      name: anchor.firstName || "-",
      surname: anchor.lastName || "-",
      balance,
      lastInvoice: invoiceFields.lastInvoice,
      lastInvoiceDate: invoiceFields.lastInvoiceDate,
      lastInvoiceLabel: invoiceFields.lastInvoiceLabel,
      lastPayment: paymentFields.lastPayment,
      lastPaymentDate: paymentFields.lastPaymentDate,
      status: displayStatusFromKidesysSection(kidesysSection, balance),
      kidesysSection,
      familyAccountId: anchor.familyAccountId,
      familyName: anchor.familyAccount?.familyName ?? null,
      memberLearnerIds: memberIds,
    };
  });
}
