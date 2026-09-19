import type {
  CountChecksums,
  FlyEagleSchoolBundle,
  MoneyTotals,
  RemediationLedgerEntry,
} from "./types";
import { moneyCents, round2 } from "./normalize";

function isActiveStatus(status: unknown): boolean {
  return String(status || "ACTIVE").trim().toUpperCase() === "ACTIVE";
}

function isHistoricalStatus(status: unknown): boolean {
  return String(status || "").trim().toUpperCase() === "HISTORICAL";
}

function ledgerAmount(entry: RemediationLedgerEntry): number {
  return round2(entry.amount);
}

export function computeCountChecksums(bundle: FlyEagleSchoolBundle): CountChecksums {
  const learners = bundle.learners;
  const fas = bundle.familyAccounts;

  const linkedCountByFa = new Map<string, number>();
  const activeLinkedByFa = new Map<string, number>();
  const inactiveLinkedByFa = new Map<string, number>();

  for (const l of learners) {
    const faId = String(l.familyAccountId || "").trim();
    if (!faId) continue;
    linkedCountByFa.set(faId, (linkedCountByFa.get(faId) || 0) + 1);
    if (isActiveStatus(l.enrollmentStatus)) {
      activeLinkedByFa.set(faId, (activeLinkedByFa.get(faId) || 0) + 1);
    } else {
      inactiveLinkedByFa.set(faId, (inactiveLinkedByFa.get(faId) || 0) + 1);
    }
  }

  let faZeroLinked = 0;
  let faLinked = 0;
  let faExactly1Linked = 0;
  let faTwoPlusLinked = 0;
  let faInactiveOnlyLinked = 0;
  let faActive = 0;
  let faRetiredOrMerged = 0;

  for (const fa of fas) {
    const retired = Boolean(fa.retiredAt) || Boolean(fa.mergedIntoFamilyAccountId);
    if (retired) faRetiredOrMerged += 1;
    else faActive += 1;

    const n = linkedCountByFa.get(fa.id) || 0;
    const activeN = activeLinkedByFa.get(fa.id) || 0;
    const inactiveN = inactiveLinkedByFa.get(fa.id) || 0;
    if (n === 0) faZeroLinked += 1;
    else {
      faLinked += 1;
      if (n === 1) faExactly1Linked += 1;
      else faTwoPlusLinked += 1;
      if (activeN === 0 && inactiveN > 0) faInactiveOnlyLinked += 1;
    }
  }

  return {
    learnerTotal: learners.length,
    activeLearners: learners.filter((l) => isActiveStatus(l.enrollmentStatus)).length,
    historicalLearners: learners.filter((l) => isHistoricalStatus(l.enrollmentStatus)).length,
    otherStatusLearners: learners.filter(
      (l) => !isActiveStatus(l.enrollmentStatus) && !isHistoricalStatus(l.enrollmentStatus)
    ).length,
    learnersWithNoFa: learners.filter((l) => !String(l.familyAccountId || "").trim()).length,
    faTotal: fas.length,
    faActive,
    faRetiredOrMerged,
    faZeroLinked,
    faLinked,
    faExactly1Linked,
    faTwoPlusLinked,
    faInactiveOnlyLinked,
    parentTotal: bundle.parents.length,
    parentLearnerLinkTotal: bundle.parentLearnerLinks.length,
  };
}

export function computeMoneyTotals(bundle: FlyEagleSchoolBundle): MoneyTotals {
  const ledger = bundle.ledger || [];
  let invoiceCount = 0;
  let invoiceCents = 0;
  let paymentCount = 0;
  let paymentCents = 0;
  let creditCount = 0;
  let creditCents = 0;

  for (const e of ledger) {
    const t = String(e.type || "").toLowerCase();
    const amt = moneyCents(e.amount);
    if (t === "invoice") {
      invoiceCount += 1;
      invoiceCents += amt;
    } else if (t === "payment") {
      paymentCount += 1;
      paymentCents += amt;
    } else if (t === "credit") {
      creditCount += 1;
      creditCents += amt;
    }
  }

  let balanceSumFromSnapshots = 0;
  for (const snap of Object.values(bundle.ageAnalysisByRef || {})) {
    if (!snap) continue;
    balanceSumFromSnapshots = round2(balanceSumFromSnapshots + round2(snap.balance));
  }

  const linkedFaIds = new Set(
    bundle.learners.map((l) => String(l.familyAccountId || "").trim()).filter(Boolean)
  );
  let balanceSumFromActiveFasWithSnapshot = 0;
  for (const fa of bundle.familyAccounts) {
    if (fa.retiredAt || fa.mergedIntoFamilyAccountId) continue;
    if (!linkedFaIds.has(fa.id)) continue;
    const ref = String(fa.accountRef || "").trim().toUpperCase();
    const snap = bundle.ageAnalysisByRef?.[ref];
    if (!snap) continue;
    balanceSumFromActiveFasWithSnapshot = round2(
      balanceSumFromActiveFasWithSnapshot + round2(snap.balance)
    );
  }

  return {
    invoiceCount,
    invoiceTotal: invoiceCents / 100,
    paymentCount,
    paymentTotal: paymentCents / 100,
    creditCount,
    creditTotal: creditCents / 100,
    balanceSumFromSnapshots,
    balanceSumFromActiveFasWithSnapshot,
  };
}

export function ledgerStatsForAccountRef(
  ledger: RemediationLedgerEntry[],
  accountRef: string
): { invoiceCount: number; invoiceTotal: number; paymentCount: number; paymentTotal: number; creditCount: number; creditTotal: number } {
  const ref = String(accountRef || "").trim().toUpperCase();
  let invoiceCount = 0;
  let invoiceCents = 0;
  let paymentCount = 0;
  let paymentCents = 0;
  let creditCount = 0;
  let creditCents = 0;
  for (const e of ledger) {
    if (String(e.accountNo || "").trim().toUpperCase() !== ref) continue;
    const t = String(e.type || "").toLowerCase();
    const amt = moneyCents(e.amount);
    if (t === "invoice") {
      invoiceCount += 1;
      invoiceCents += amt;
    } else if (t === "payment") {
      paymentCount += 1;
      paymentCents += amt;
    } else if (t === "credit") {
      creditCount += 1;
      creditCents += amt;
    }
  }
  return {
    invoiceCount,
    invoiceTotal: invoiceCents / 100,
    paymentCount,
    paymentTotal: paymentCents / 100,
    creditCount,
    creditTotal: creditCents / 100,
  };
}
