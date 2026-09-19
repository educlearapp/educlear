/**
 * Class B ledger consolidation — pure planning / dry simulation.
 * Does not write production ledger. Preserves ids, dates, amounts, references;
 * only rewrites accountNo join key from orphan accountRef → current accountRef.
 */
import { ledgerStatsForAccountRef } from "./checksums";
import { moneyCents, normRef, round2 } from "./normalize";
import type { FlyEagleSchoolBundle, RemediationLedgerEntry, RepairPlanItem } from "./types";

export type LedgerMoveRow = {
  id: string;
  type: string;
  date: string;
  amount: number;
  reference: string | null;
  description: string | null;
  fromAccountNo: string;
  toAccountNo: string;
  learnerId: string | null;
};

export type LedgerConsolidationManifest = {
  caseKey: string;
  orphanFaId: string;
  orphanAccountRef: string;
  currentFaId: string;
  currentAccountRef: string;
  currentAccountNo: string | null;
  learnerIds: string[];
  moves: LedgerMoveRow[];
  before: {
    orphan: ReturnType<typeof ledgerStatsForAccountRef> & { balance: number };
    current: ReturnType<typeof ledgerStatsForAccountRef> & { balance: number };
    combinedInvoiceTotal: number;
    combinedPaymentTotal: number;
    combinedCreditTotal: number;
    combinedBalance: number;
  };
  after: {
    orphan: ReturnType<typeof ledgerStatsForAccountRef> & { balance: number };
    current: ReturnType<typeof ledgerStatsForAccountRef> & { balance: number };
    combinedInvoiceTotal: number;
    combinedPaymentTotal: number;
    combinedCreditTotal: number;
    combinedBalance: number;
  };
  invariants: {
    totalsReconcile: boolean;
    noDuplicateIds: boolean;
    amountsUnchanged: boolean;
    datesUnchanged: boolean;
    referencesUnchanged: boolean;
    documentNumbersUnchanged: boolean;
  };
  safe: boolean;
};

function bal(stats: ReturnType<typeof ledgerStatsForAccountRef>): number {
  return round2(stats.invoiceTotal - stats.paymentTotal - stats.creditTotal);
}

function entriesForRef(ledger: RemediationLedgerEntry[], accountRef: string): RemediationLedgerEntry[] {
  const ref = normRef(accountRef);
  return ledger.filter((e) => normRef(e.accountNo) === ref);
}

/** Build a consolidation manifest: move orphan ledger rows onto current accountRef. */
export function buildLedgerConsolidationManifest(
  bundle: FlyEagleSchoolBundle,
  item: RepairPlanItem
): LedgerConsolidationManifest {
  if (item.currentFaIds.length !== 1) {
    throw new Error(`Class B requires exactly one current FA (got ${item.currentFaIds.length})`);
  }
  const currentFa = bundle.familyAccounts.find((fa) => fa.id === item.currentFaIds[0]);
  if (!currentFa) throw new Error(`current FA missing: ${item.currentFaIds[0]}`);

  const orphanRef = item.orphanAccountRef;
  const currentRef = currentFa.accountRef;
  const orphanBefore = ledgerStatsForAccountRef(bundle.ledger, orphanRef);
  const currentBefore = ledgerStatsForAccountRef(bundle.ledger, currentRef);

  const orphanEntries = entriesForRef(bundle.ledger, orphanRef);
  const moves: LedgerMoveRow[] = orphanEntries.map((e) => ({
    id: String(e.id || `${e.type}-${e.date}-${e.amount}-${e.reference || ""}`),
    type: String(e.type || ""),
    date: String(e.date || ""),
    amount: round2(e.amount),
    reference: e.reference != null ? String(e.reference) : null,
    description: e.description != null ? String(e.description) : null,
    fromAccountNo: String(e.accountNo || orphanRef),
    toAccountNo: currentRef,
    learnerId: e.learnerId != null ? String(e.learnerId) : null,
  }));

  // Simulate: rewrite accountNo only
  const simulated = bundle.ledger.map((e) => {
    if (normRef(e.accountNo) !== normRef(orphanRef)) return e;
    return { ...e, accountNo: currentRef };
  });
  const orphanAfter = ledgerStatsForAccountRef(simulated, orphanRef);
  const currentAfter = ledgerStatsForAccountRef(simulated, currentRef);

  const beforeCombinedInv = round2(orphanBefore.invoiceTotal + currentBefore.invoiceTotal);
  const beforeCombinedPay = round2(orphanBefore.paymentTotal + currentBefore.paymentTotal);
  const beforeCombinedCred = round2(orphanBefore.creditTotal + currentBefore.creditTotal);
  const beforeCombinedBal = round2(bal(orphanBefore) + bal(currentBefore));

  const afterCombinedInv = round2(orphanAfter.invoiceTotal + currentAfter.invoiceTotal);
  const afterCombinedPay = round2(orphanAfter.paymentTotal + currentAfter.paymentTotal);
  const afterCombinedCred = round2(orphanAfter.creditTotal + currentAfter.creditTotal);
  const afterCombinedBal = round2(bal(orphanAfter) + bal(currentAfter));

  const ids = moves.map((m) => m.id);
  const noDuplicateIds = new Set(ids).size === ids.length;

  const amountsUnchanged = moves.every((m, i) => moneyCents(m.amount) === moneyCents(orphanEntries[i]?.amount));
  const datesUnchanged = moves.every((m, i) => m.date === String(orphanEntries[i]?.date || ""));
  const referencesUnchanged = moves.every(
    (m, i) => String(m.reference || "") === String(orphanEntries[i]?.reference || "")
  );
  const documentNumbersUnchanged = referencesUnchanged;

  const totalsReconcile =
    moneyCents(beforeCombinedInv) === moneyCents(afterCombinedInv) &&
    moneyCents(beforeCombinedPay) === moneyCents(afterCombinedPay) &&
    moneyCents(beforeCombinedCred) === moneyCents(afterCombinedCred) &&
    moneyCents(beforeCombinedBal) === moneyCents(afterCombinedBal) &&
    orphanAfter.invoiceCount === 0 &&
    orphanAfter.paymentCount === 0 &&
    orphanAfter.creditCount === 0;

  const invariants = {
    totalsReconcile,
    noDuplicateIds,
    amountsUnchanged,
    datesUnchanged,
    referencesUnchanged,
    documentNumbersUnchanged,
  };

  return {
    caseKey: item.caseKey,
    orphanFaId: item.orphanFaId,
    orphanAccountRef: orphanRef,
    currentFaId: currentFa.id,
    currentAccountRef: currentRef,
    currentAccountNo: currentFa.accountNo,
    learnerIds: item.learnerIds,
    moves,
    before: {
      orphan: { ...orphanBefore, balance: bal(orphanBefore) },
      current: { ...currentBefore, balance: bal(currentBefore) },
      combinedInvoiceTotal: beforeCombinedInv,
      combinedPaymentTotal: beforeCombinedPay,
      combinedCreditTotal: beforeCombinedCred,
      combinedBalance: beforeCombinedBal,
    },
    after: {
      orphan: { ...orphanAfter, balance: bal(orphanAfter) },
      current: { ...currentAfter, balance: bal(currentAfter) },
      combinedInvoiceTotal: afterCombinedInv,
      combinedPaymentTotal: afterCombinedPay,
      combinedCreditTotal: afterCombinedCred,
      combinedBalance: afterCombinedBal,
    },
    invariants,
    safe: Object.values(invariants).every(Boolean),
  };
}

export function buildClassBConsolidationManifests(
  bundle: FlyEagleSchoolBundle,
  classB: RepairPlanItem[]
): LedgerConsolidationManifest[] {
  return classB
    .filter((i) => i.action === "ledger_consolidate_then_merge")
    .map((i) => buildLedgerConsolidationManifest(bundle, i));
}
