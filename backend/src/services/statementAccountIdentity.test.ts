/**
 * Run: npx ts-node --transpile-only src/services/statementAccountIdentity.test.ts
 *
 * Regression cases for FA-canonical billing identity (Fly Eagle dual-identity defect).
 */
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import type { FamilyAccountAgeAnalysisSnapshot } from "../utils/familyAccountAgeAnalysisStore";
import {
  collectLedgerEntriesForFamily,
  describeStatementIdentity,
  listFamilyAccountsMissingAgeAnalysisSnapshot,
  resolveSnapshotForFamily,
  selectStatementFamilyAccounts,
  shouldIncludeFamilyInStatements,
  type StatementFamilyAccount,
} from "./statementAccountIdentity";
import { filterAccountsEligibleForNewPayment } from "./paymentAccountEligibility";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function snap(
  accountRef: string,
  balance = 0
): FamilyAccountAgeAnalysisSnapshot {
  return {
    schoolId: "fly-eagle-test",
    accountRef,
    accountHolder: accountRef,
    balance,
    buckets: { current: balance, d30: 0, d60: 0, d90: 0, d120: 0 },
    source: "kideesys-age-analysis",
    importedAt: "2026-08-24T00:00:00.000Z",
  };
}

function ledgerRow(accountNo: string, amount = 100): BillingLedgerEntry {
  return {
    id: `e-${accountNo}-${amount}`,
    schoolId: "fly-eagle-test",
    learnerId: "",
    accountNo,
    type: "invoice",
    amount,
    date: "2026-09-01",
    reference: "INV",
    description: "Test",
    source: "manual",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

// --- Fixtures mirroring Fly Eagle dual-identity cases ---

/** SOT001 retired predecessor — Express legacy ref + dedicated code */
const sot001: StatementFamilyAccount = {
  id: "fa-sot001",
  accountNo: "SOT001",
  accountRef: "SOTSHANGANE LULONKE",
  familyName: "SOTSHANGANE LULONKE",
  retiredAt: "2026-09-19T15:26:59.844Z",
  mergedIntoFamilyAccountId: "fa-sot002",
};

/** SOT002 current FA — accountRef === accountNo, missing from age-analysis */
const sot002: StatementFamilyAccount = {
  id: "fa-sot002",
  accountNo: "SOT002",
  accountRef: "SOT002",
  familyName: "SOTSHANGANE",
};

/** HIR002 legacy history (zero-linked) + HIR003 current */
const hir002: StatementFamilyAccount = {
  id: "fa-hir002",
  accountNo: "HIR002",
  accountRef: "HIRBORO ANTEFAZA",
  familyName: "HIRBORO ANTEFAZA",
};
const hir003: StatementFamilyAccount = {
  id: "fa-hir003",
  accountNo: "HIR003",
  accountRef: "HIR003",
  familyName: "HIRBORO",
};

/** LED002 dual identity — Express name join + dedicated code */
const led002: StatementFamilyAccount = {
  id: "fa-led002",
  accountNo: "LED002",
  accountRef: "LEDIKWA RELESEGO",
  familyName: "LEDIKWA RELESEGO",
};

/** MAP003 dual identity */
const map003: StatementFamilyAccount = {
  id: "fa-map003",
  accountNo: "MAP003",
  accountRef: "MAPUTLA MAROPENG",
  familyName: "MAPUTLA MAROPENG",
};

/** MAN009 zero-linked legacy + MAN005 current with learners */
const man009: StatementFamilyAccount = {
  id: "fa-man009",
  accountNo: "MAN009",
  accountRef: "MANXILA SIMBONGO",
  familyName: "MANXILA SIMBONGO",
};
const man005: StatementFamilyAccount = {
  id: "fa-man005",
  accountNo: "MAN005",
  accountRef: "MANXILA MIBONGO",
  familyName: "MANXILA MIBONGO",
};

/** ABO001 / NAO001 / NAO002 */
const abo001: StatementFamilyAccount = {
  id: "fa-abo001",
  accountNo: "ABO001",
  accountRef: "NAORE GADON",
  familyName: "NAORE GADON",
};
const nao001: StatementFamilyAccount = {
  id: "fa-nao001",
  accountNo: "NAO001",
  accountRef: "NAORE JOSHUA",
  familyName: "NAORE JOSHUA",
};
const nao002: StatementFamilyAccount = {
  id: "fa-nao002",
  accountNo: "NAO002",
  accountRef: "NAO002",
  familyName: "NAORE",
};

const allFas = [
  sot001,
  sot002,
  hir002,
  hir003,
  led002,
  map003,
  man009,
  man005,
  abo001,
  nao001,
  nao002,
];

const snapshotsByRef: Record<string, FamilyAccountAgeAnalysisSnapshot | undefined> = {
  "SOTSHANGANE LULONKE": snap("SOTSHANGANE LULONKE", 0),
  "HIRBORO ANTEFAZA": snap("HIRBORO ANTEFAZA", 2900),
  HIR003: snap("HIR003", 1450),
  "LEDIKWA RELESEGO": snap("LEDIKWA RELESEGO", 5000),
  "MAPUTLA MAROPENG": snap("MAPUTLA MAROPENG", 3000),
  "MANXILA SIMBONGO": snap("MANXILA SIMBONGO", 0),
  "MANXILA MIBONGO": snap("MANXILA MIBONGO", 2000),
  "NAORE GADON": snap("NAORE GADON", 1350),
  "NAORE JOSHUA": snap("NAORE JOSHUA", 0),
  NAO002: snap("NAO002", 1450),
  // intentionally NO snap for SOT002
};

const ledger: BillingLedgerEntry[] = [
  ledgerRow("SOT002", 1450),
  ledgerRow("HIRBORO ANTEFAZA", 2900),
  ledgerRow("HIR003", 1450),
  ledgerRow("LEDIKWA RELESEGO", 5000),
  ledgerRow("MAPUTLA MAROPENG", 3000),
  ledgerRow("MANXILA MIBONGO", 2000),
  ledgerRow("MANXILA SIMBONGO", 100),
  ledgerRow("NAORE GADON", 1350),
  ledgerRow("NAO002", 1450),
];

const linked = new Set([
  "fa-sot002",
  "fa-hir003",
  "fa-led002",
  "fa-map003",
  "fa-man005",
  "fa-nao002",
]);

// --- Identity labels ---
{
  const s2 = describeStatementIdentity(sot002);
  assert(s2.currentAccountNo === "SOT002", "SOT002 CURRENT ACCOUNT NO");
  assert(s2.legacyRef === "SOT002", "SOT002 legacy join");
  assert(!s2.isHistoricalPredecessor, "SOT002 is current");

  const s1 = describeStatementIdentity(sot001);
  assert(s1.currentAccountNo === "SOT001", "SOT001 code");
  assert(s1.legacyRef === "SOTSHANGANE LULONKE", "SOT001 Express legacy");
  assert(s1.isHistoricalPredecessor, "SOT001 is historical predecessor");

  const led = describeStatementIdentity(led002);
  assert(led.currentAccountNo === "LED002", "LED002 dual: code");
  assert(led.legacyRef === "LEDIKWA RELESEGO", "LED002 dual: Express");
}

// --- Snapshot resolution ---
assert(
  !resolveSnapshotForFamily(sot002, snapshotsByRef),
  "SOT002 missing from age-analysis snapshot"
);
assert(
  Boolean(resolveSnapshotForFamily(sot001, snapshotsByRef)),
  "SOT001 resolves snap via Express legacy ref"
);
assert(
  Boolean(resolveSnapshotForFamily(led002, snapshotsByRef)),
  "LED002 resolves snap via Express legacy ref"
);
assert(
  Boolean(resolveSnapshotForFamily(map003, snapshotsByRef)),
  "MAP003 resolves snap via Express legacy ref"
);

// --- Ledger keyed by legacy ref; SOT002 also keyed by code ---
assert(
  collectLedgerEntriesForFamily(sot002, ledger).length === 1,
  "SOT002 ledger found by accountNo/join"
);
assert(
  collectLedgerEntriesForFamily(led002, ledger).length === 1,
  "LED002 ledger found by Express accountRef"
);
assert(
  collectLedgerEntriesForFamily(hir002, ledger).length === 1,
  "HIR002 ledger history still traceable via legacy ref"
);

// --- Visibility: SOT002 current despite missing snap ---
assert(
  shouldIncludeFamilyInStatements(sot002, {
    hasLinkedLearners: true,
    hasLedger: true,
    hasSnapshot: false,
  }),
  "SOT002 current FA visible without age-analysis key"
);

assert(
  !shouldIncludeFamilyInStatements(sot001, {
    hasLinkedLearners: false,
    hasLedger: false,
    hasSnapshot: true,
    includeRetired: false,
  }),
  "SOT001 omitted from default (active) Statements"
);

assert(
  shouldIncludeFamilyInStatements(sot001, {
    hasLinkedLearners: false,
    hasLedger: false,
    hasSnapshot: true,
    includeRetired: true,
  }),
  "SOT001 historically visible when includeRetired"
);

// --- selectStatementFamilyAccounts: active set ---
const active = selectStatementFamilyAccounts({
  familyAccounts: allFas,
  snapshotsByRef,
  ledger,
  linkedFamilyAccountIds: linked,
});
const activeCodes = new Set(
  active.map((fa) => describeStatementIdentity(fa).currentAccountNo || fa.accountRef)
);

assert(activeCodes.has("SOT002"), "active: SOT002 found by current accountNo");
assert(!activeCodes.has("SOT001"), "active: SOT001 not in default list");
assert(activeCodes.has("HIR002"), "active: HIR002 legacy/history still listed (has snap+ledger)");
assert(activeCodes.has("HIR003"), "active: HIR003 current");
assert(activeCodes.has("LED002"), "active: LED002 dual identity");
assert(activeCodes.has("MAP003"), "active: MAP003 dual identity");
assert(activeCodes.has("MAN009"), "active: MAN009 legacy");
assert(activeCodes.has("MAN005"), "active: MAN005 current");
assert(activeCodes.has("ABO001"), "active: ABO001");
assert(activeCodes.has("NAO001"), "active: NAO001");
assert(activeCodes.has("NAO002"), "active: NAO002");

const historical = selectStatementFamilyAccounts({
  familyAccounts: allFas,
  snapshotsByRef,
  ledger,
  linkedFamilyAccountIds: linked,
  includeRetired: true,
});
assert(
  historical.some((fa) => fa.id === "fa-sot001"),
  "historical: SOT001 retired predecessor visible"
);

// Find by current accountNo filter even when snap missing
const sot002Only = selectStatementFamilyAccounts({
  familyAccounts: allFas,
  snapshotsByRef,
  ledger,
  linkedFamilyAccountIds: linked,
  accountRefFilter: "SOT002",
});
assert(sot002Only.length === 1 && sot002Only[0].id === "fa-sot002", "filter by SOT002 accountNo");

// --- Create Payment: same canonical FA set, linked-learner rules ---
const statementShaped = active.map((fa) => {
  const id = describeStatementIdentity(fa);
  return {
    familyAccountId: fa.id,
    accountNo: id.legacyRef,
    eduClearAccountNo: id.currentAccountNo,
    memberLearnerIds: linked.has(fa.id) ? ["learner"] : [],
  };
});
const payable = filterAccountsEligibleForNewPayment(statementShaped, linked);
const payableCodes = new Set(payable.map((r) => r.eduClearAccountNo));

assert(payableCodes.has("SOT002"), "Create Payment finds SOT002 by current accountNo");
assert(payableCodes.has("HIR003"), "Create Payment finds HIR003");
assert(!payableCodes.has("HIR002"), "HIR002 not payable (zero-linked)");
assert(!payableCodes.has("MAN009"), "MAN009 not payable (zero-linked)");
assert(!payableCodes.has("ABO001"), "ABO001 not payable (zero-linked)");
assert(!payableCodes.has("SOT001"), "SOT001 not in active payment set");
assert(payableCodes.has("LED002"), "Create Payment finds LED002");
assert(payableCodes.has("MAP003"), "Create Payment finds MAP003");
assert(payableCodes.has("MAN005"), "Create Payment finds MAN005");
assert(payableCodes.has("NAO002"), "Create Payment finds NAO002");

// --- Backfill candidates: SOT002 missing snap ---
const missing = listFamilyAccountsMissingAgeAnalysisSnapshot({
  familyAccounts: allFas,
  snapshotsByRef,
  ledger,
  linkedFamilyAccountIds: linked,
});
assert(
  missing.some((m) => m.currentAccountNo === "SOT002"),
  "backfill dry-run flags SOT002 missing snapshot"
);
assert(
  !missing.some((m) => m.currentAccountNo === "SOT001"),
  "retired SOT001 is not a backfill candidate"
);

console.log("statementAccountIdentity.test.ts: ok");
console.log(
  JSON.stringify(
    {
      activeCount: active.length,
      historicalCount: historical.length,
      payableCount: payable.length,
      missingSnapshots: missing.map((m) => m.currentAccountNo || m.legacyRef),
    },
    null,
    2
  )
);
