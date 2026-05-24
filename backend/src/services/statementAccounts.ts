import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
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
import { MIGRATED_OPENING_BALANCE_OVERVIEW, isKidesysOpeningBalanceEntry } from "../utils/billingDisplayRules";

function statusFromBalance(balance: number) {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

function resolveBillingGroupKey(learner: {
  id: string;
  familyAccountId: string | null;
  familyAccount: { accountRef: string } | null;
}): string {
  const familyAccountId = String(learner.familyAccountId || "").trim();
  if (familyAccountId) return `family:${familyAccountId}`;
  const accountNo = resolveLearnerAccountNo(learner);
  if (accountNo && accountNo !== "-") return `account:${accountNo}`;
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
  if (histInv) {
    return {
      lastInvoice: histInv.amount ?? 0,
      lastInvoiceDate: histInv.date || "",
      lastInvoiceLabel: null as string | null,
    };
  }
  const lastInvoice = lastRealInvoice(accountEntries);
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
  if (histPay) {
    return {
      lastPayment: histPay.amount ?? 0,
      lastPaymentDate: histPay.date || "",
    };
  }
  const lastPayment = accountEntries
    .filter((e) => e.type === "payment")
    .sort(
      (a, b) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )[0];
  return {
    lastPayment: lastPayment?.amount ?? 0,
    lastPaymentDate: lastPayment?.date || "",
  };
}

/** One row per family billing account (deduped siblings). */
export async function buildAccountsFromLearners(
  schoolId: string,
  ledger: BillingLedgerEntry[],
  historyOverride?: KidesysHistoryEntry[]
) {
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
      familyAccountId: true,
      familyAccount: { select: { accountRef: true, familyName: true } },
    },
  });

  const groups = new Map<string, { anchor: (typeof learners)[0]; memberIds: string[] }>();

  for (const learner of learners) {
    const key = resolveBillingGroupKey(learner);
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
    const accountNo = resolveLearnerAccountNo(anchor);
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
      status: statusFromBalance(balance),
      familyAccountId: anchor.familyAccountId,
      familyName: anchor.familyAccount?.familyName ?? null,
      memberLearnerIds: memberIds,
    };
  });
}
