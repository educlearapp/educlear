/**
 * Final Fly Eagle data-repair phase tests:
 * LED/MAP idempotent Class B, HIR003→HIR002 consolidation, HIR001 isolation.
 * Run: npx tsx src/services/flyEagleBillingRemediation/finalRepairPhase.test.ts
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { FLY_EAGLE_SCHOOL_ID, assertFlyEagleSchoolId } from "./constants";
import { APPROVED_LEDIKWA, APPROVED_MAPUTLA } from "./approvedClassBManifests";
import { APPROVED_HIRBORO } from "./approvedHirConsolidation";
import { executeApprovedClassBConsolidation } from "./classBApply";
import { executeApprovedHirConsolidation } from "./hirConsolidateApply";
import {
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import {
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../utils/familyAccountAgeAnalysisStore";
import type { RepairPlanItem } from "./types";

function pass(name: string) {
  console.log(`✓ ${name}`);
}

function moneyTotals(entries: BillingLedgerEntry[]) {
  let inv = 0,
    pay = 0,
    cr = 0;
  for (const e of entries) {
    const a = Math.round((Number(e.amount) || 0) * 100) / 100;
    if (e.type === "invoice") inv += a;
    else if (e.type === "payment") pay += a;
    else if (e.type === "credit") cr += a;
  }
  return {
    invoiceTotal: Math.round(inv * 100) / 100,
    paymentTotal: Math.round(pay * 100) / 100,
    creditTotal: Math.round(cr * 100) / 100,
    balance: Math.round((inv - pay - cr) * 100) / 100,
  };
}

function planItem(spec: {
  orphanFaId: string;
  orphanAccountRef: string;
  currentFaId: string;
  learnerIds: string[];
}): RepairPlanItem {
  return {
    caseKey: `test:${spec.orphanFaId}`,
    repairClass: "B",
    orphanFaId: spec.orphanFaId,
    orphanAccountRef: spec.orphanAccountRef,
    orphanAccountNo: null,
    action: "ledger_consolidate_then_merge",
    learnerIds: spec.learnerIds,
    currentFaIds: [spec.currentFaId],
    evidence: [],
    reasons: [],
    preconditions: [],
    monetary: { orphanBalance: 0, orphanInvoiceTotal: 0, orphanPaymentTotal: 0 },
  };
}

function entry(
  partial: Partial<BillingLedgerEntry> & Pick<BillingLedgerEntry, "id" | "accountNo" | "type" | "amount" | "date" | "reference">
): BillingLedgerEntry {
  return {
    schoolId: FLY_EAGLE_SCHOOL_ID,
    learnerId: "",
    description: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function mockPrisma(state: {
  fas: Record<string, any>;
  learners: Record<string, any>;
  parents: Record<string, any>;
}) {
  const api = {
    familyAccount: {
      findFirst: async ({ where }: any) => {
        const fa = state.fas[where.id];
        if (!fa || fa.schoolId !== where.schoolId) return null;
        return { ...fa };
      },
      updateMany: async ({ where, data }: any) => {
        const fa = state.fas[where.id];
        if (!fa || fa.schoolId !== where.schoolId) return { count: 0 };
        if (where.retiredAt === null && fa.retiredAt) return { count: 0 };
        Object.assign(fa, data);
        return { count: 1 };
      },
    },
    learner: {
      findFirst: async ({ where }: any) => {
        const l = state.learners[where.id];
        if (!l || l.schoolId !== where.schoolId) return null;
        return { ...l };
      },
      count: async ({ where }: any) =>
        Object.values(state.learners).filter(
          (l: any) => l.schoolId === where.schoolId && l.familyAccountId === where.familyAccountId
        ).length,
      updateMany: async ({ where, data }: any) => {
        const l = state.learners[where.id];
        if (!l || l.schoolId !== where.schoolId) return { count: 0 };
        if (where.familyAccountId && l.familyAccountId !== where.familyAccountId) return { count: 0 };
        Object.assign(l, data);
        return { count: 1 };
      },
    },
    parent: {
      count: async ({ where }: any) =>
        Object.values(state.parents).filter(
          (p: any) => p.schoolId === where.schoolId && p.familyAccountId === where.familyAccountId
        ).length,
      updateMany: async ({ where, data }: any) => {
        const p = state.parents[where.id];
        if (!p || p.schoolId !== where.schoolId) return { count: 0 };
        if (where.familyAccountId && p.familyAccountId !== where.familyAccountId) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    $transaction: async (fn: any) => fn(api),
  };
  return api as any;
}

async function testHirExactRelocationAndTotals() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-hir-"));
  setBillingLedgerStoreDataDirForTests(dir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);

  const hir002History: BillingLedgerEntry[] = [
    entry({
      id: "fe-open-hir2",
      accountNo: "HIRBORO ANTEFAZA",
      type: "invoice",
      amount: 1500,
      date: "2018-01-01",
      reference: "FE-OPEN",
    }),
    entry({
      id: "fe-inv-hir2-a",
      accountNo: "HIRBORO ANTEFAZA",
      type: "invoice",
      amount: 14300,
      date: "2026-03-01",
      reference: "INV-A",
    }),
    entry({
      id: "fe-pay-hir2",
      accountNo: "HIRBORO ANTEFAZA",
      type: "payment",
      amount: 12900,
      date: "2026-02-01",
      reference: "PAY",
    }),
  ];
  // pad to match expected 17250/12900/4350 with the one HIR003 move of 1450
  // 1500+14300+1450 = 17250; pay 12900; bal 4350 ✓
  const hir003Inv = entry({
    id: APPROVED_HIRBORO.moves[0].id,
    accountNo: "HIR003",
    type: "invoice",
    amount: 1450,
    date: "2026-09-18",
    reference: "INV-1789741428761",
  });
  const hir001: BillingLedgerEntry[] = [
    entry({
      id: "fe-hir001-inv",
      accountNo: "HIRBORO BEREKET",
      type: "invoice",
      amount: 1400,
      date: "2026-01-01",
      reference: "HIR001-INV",
    }),
  ];

  writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, [...hir002History, hir003Inv, ...hir001]);
  upsertSchoolFamilyAccountAgeAnalysisSnapshots(FLY_EAGLE_SCHOOL_ID, {
    HIR003: {
      schoolId: FLY_EAGLE_SCHOOL_ID,
      accountRef: "HIR003",
      accountHolder: "HIR003",
      balance: 0,
      buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
      source: "educlear-registration",
      importedAt: "2026-09-17T00:00:00.000Z",
    },
  });

  const state = {
    fas: {
      [APPROVED_HIRBORO.sourceFaId]: {
        id: APPROVED_HIRBORO.sourceFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: "HIR003",
        accountNo: "HIR003",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
      },
      [APPROVED_HIRBORO.destFaId]: {
        id: APPROVED_HIRBORO.destFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: "HIRBORO ANTEFAZA",
        accountNo: "HIR002",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
      },
      [APPROVED_HIRBORO.protectedSiblingFaId]: {
        id: APPROVED_HIRBORO.protectedSiblingFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: "HIRBORO BEREKET",
        accountNo: "HIR001",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
      },
    },
    learners: {
      [APPROVED_HIRBORO.learnerId]: {
        id: APPROVED_HIRBORO.learnerId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        familyAccountId: APPROVED_HIRBORO.sourceFaId,
        firstName: "ANTEFAZEN",
        lastName: "HIRBORO",
      },
      "lrn-bereket": {
        id: "lrn-bereket",
        schoolId: FLY_EAGLE_SCHOOL_ID,
        familyAccountId: APPROVED_HIRBORO.protectedSiblingFaId,
        firstName: "Bereket",
        lastName: "HIRBORO",
      },
    },
    parents: {
      [APPROVED_HIRBORO.parentIds[0]]: {
        id: APPROVED_HIRBORO.parentIds[0],
        schoolId: FLY_EAGLE_SCHOOL_ID,
        familyAccountId: APPROVED_HIRBORO.sourceFaId,
      },
      [APPROVED_HIRBORO.parentIds[1]]: {
        id: APPROVED_HIRBORO.parentIds[1],
        schoolId: FLY_EAGLE_SCHOOL_ID,
        familyAccountId: APPROVED_HIRBORO.sourceFaId,
      },
    },
  };

  const prisma = mockPrisma(state);
  const schoolWideBefore = moneyTotals(readSchoolLedger(FLY_EAGLE_SCHOOL_ID));

  const dry = await executeApprovedHirConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    spec: APPROVED_HIRBORO,
    mode: "dry-run",
  });
  assert.strictEqual(dry.status, "would_change");
  pass("HIR dry-run would_change");

  const applied = await executeApprovedHirConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    spec: APPROVED_HIRBORO,
    mode: "apply",
  });
  assert.strictEqual(applied.status, "applied", applied.reason);
  pass("HIR apply relocates exact record");

  const ledger = readSchoolLedger(FLY_EAGLE_SCHOOL_ID);
  const moved = ledger.find((e) => e.id === APPROVED_HIRBORO.moves[0].id);
  assert.ok(moved);
  assert.strictEqual(String(moved!.accountNo).toUpperCase(), "HIRBORO ANTEFAZA");
  assert.strictEqual(moved!.amount, 1450);
  assert.strictEqual(moved!.reference, "INV-1789741428761");
  assert.strictEqual(moved!.id, APPROVED_HIRBORO.moves[0].id);
  pass("exact-record relocation preserves id/amount/reference");

  const schoolWideAfter = moneyTotals(ledger);
  assert.deepStrictEqual(schoolWideAfter, schoolWideBefore);
  pass("school-wide invoice/payment/credit totals preserved");

  assert.strictEqual(state.learners[APPROVED_HIRBORO.learnerId].familyAccountId, APPROVED_HIRBORO.destFaId);
  assert.ok(state.fas[APPROVED_HIRBORO.sourceFaId].retiredAt);
  assert.strictEqual(
    state.fas[APPROVED_HIRBORO.sourceFaId].mergedIntoFamilyAccountId,
    APPROVED_HIRBORO.destFaId
  );
  pass("learner relinked and HIR003 retired");

  // HIR001 isolation
  assert.strictEqual(state.fas[APPROVED_HIRBORO.protectedSiblingFaId].accountNo, "HIR001");
  assert.strictEqual(state.learners["lrn-bereket"].familyAccountId, APPROVED_HIRBORO.protectedSiblingFaId);
  const hir001After = moneyTotals(ledger.filter((e) => String(e.accountNo).toUpperCase() === "HIRBORO BEREKET"));
  assert.strictEqual(hir001After.invoiceTotal, 1400);
  pass("HIR001 isolation");

  // Idempotent second execution
  const second = await executeApprovedHirConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    spec: APPROVED_HIRBORO,
    mode: "apply",
  });
  assert.ok(second.status === "applied" || second.status === "unchanged", second.reason);
  assert.strictEqual(readSchoolLedger(FLY_EAGLE_SCHOOL_ID).length, ledger.length);
  pass("idempotent second execution");

  // Duplicate prevention / unexpected residual
  writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, [
    ...readSchoolLedger(FLY_EAGLE_SCHOOL_ID),
    entry({
      id: "extra-hir003-inv",
      accountNo: "HIR003",
      type: "invoice",
      amount: 10,
      date: "2026-09-19",
      reference: "EXTRA-INV",
    }),
    entry({
      id: "extra-hir003-pay",
      accountNo: "HIR003",
      type: "payment",
      amount: 10,
      date: "2026-09-19",
      reference: "EXTRA-PAY",
    }),
  ]);
  // Reset source unretired for residual test
  state.fas[APPROVED_HIRBORO.sourceFaId].retiredAt = null;
  state.fas[APPROVED_HIRBORO.sourceFaId].mergedIntoFamilyAccountId = null;
  state.learners[APPROVED_HIRBORO.learnerId].familyAccountId = APPROVED_HIRBORO.sourceFaId;
  // Put move back on source for residual check path
  const led2 = readSchoolLedger(FLY_EAGLE_SCHOOL_ID).map((e) =>
    e.id === APPROVED_HIRBORO.moves[0].id ? { ...e, accountNo: "HIR003" } : e
  );
  writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, led2);
  const residual = await executeApprovedHirConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    spec: APPROVED_HIRBORO,
    mode: "apply",
  });
  assert.strictEqual(residual.status, "aborted");
  assert.match(residual.reason, /unexpected residual/);
  pass("unexpected residual on source refused");

  // Cross-school rejection
  assert.throws(() => assertFlyEagleSchoolId("other-school"));
  const cross = await executeApprovedHirConsolidation({
    prisma,
    schoolId: "other-school",
    spec: APPROVED_HIRBORO,
    mode: "apply",
  }).catch((e) => ({ status: "aborted", reason: String(e.message || e), label: "HIRBORO" as const }));
  assert.ok(
    cross.status === "aborted" || (cross as any).reason?.includes("Refuse"),
    "cross-school rejected"
  );
  pass("cross-school rejection");

  setBillingLedgerStoreDataDirForTests(null);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
}

async function testClassBIdempotentAlreadyDone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-led-"));
  setBillingLedgerStoreDataDirForTests(dir);

  // Moves already on destination
  writeSchoolLedger(
    FLY_EAGLE_SCHOOL_ID,
    APPROVED_LEDIKWA.moves.map((m) =>
      entry({
        id: m.id,
        accountNo: m.toAccountNo,
        type: m.type as any,
        amount: m.amount,
        date: m.date,
        reference: m.reference || "",
      })
    )
  );

  const state = {
    fas: {
      [APPROVED_LEDIKWA.orphanFaId]: {
        id: APPROVED_LEDIKWA.orphanFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: APPROVED_LEDIKWA.orphanAccountRef,
        accountNo: null,
        retiredAt: new Date(),
        mergedIntoFamilyAccountId: APPROVED_LEDIKWA.currentFaId,
      },
      [APPROVED_LEDIKWA.currentFaId]: {
        id: APPROVED_LEDIKWA.currentFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: APPROVED_LEDIKWA.currentAccountRef,
        accountNo: APPROVED_LEDIKWA.currentAccountNo,
        retiredAt: null,
      },
    },
    learners: {},
    parents: {},
  };
  const prisma = mockPrisma(state);
  const result = await executeApprovedClassBConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    item: planItem(APPROVED_LEDIKWA),
    spec: APPROVED_LEDIKWA,
    mode: "apply",
  });
  assert.strictEqual(result.status, "applied");
  assert.match(result.reason, /idempotent/i);
  pass("LED Class B idempotent when already consolidated");

  // MAP same pattern
  writeSchoolLedger(
    FLY_EAGLE_SCHOOL_ID,
    APPROVED_MAPUTLA.moves.map((m) =>
      entry({
        id: m.id,
        accountNo: m.toAccountNo,
        type: m.type as any,
        amount: m.amount,
        date: m.date,
        reference: m.reference || "",
      })
    )
  );
  const stateMap = {
    fas: {
      [APPROVED_MAPUTLA.orphanFaId]: {
        id: APPROVED_MAPUTLA.orphanFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: APPROVED_MAPUTLA.orphanAccountRef,
        accountNo: null,
        retiredAt: new Date(),
        mergedIntoFamilyAccountId: APPROVED_MAPUTLA.currentFaId,
      },
      [APPROVED_MAPUTLA.currentFaId]: {
        id: APPROVED_MAPUTLA.currentFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: APPROVED_MAPUTLA.currentAccountRef,
        accountNo: APPROVED_MAPUTLA.currentAccountNo,
        retiredAt: null,
      },
    },
    learners: {},
    parents: {},
  };
  const mapResult = await executeApprovedClassBConsolidation({
    prisma: mockPrisma(stateMap),
    schoolId: FLY_EAGLE_SCHOOL_ID,
    item: planItem(APPROVED_MAPUTLA),
    spec: APPROVED_MAPUTLA,
    mode: "apply",
  });
  assert.strictEqual(mapResult.status, "applied");
  pass("MAP Class B idempotent when already consolidated");

  setBillingLedgerStoreDataDirForTests(null);
}

async function testSourceNotEmptyRefusal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-hir-ne-"));
  setBillingLedgerStoreDataDirForTests(dir);
  writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, [
    entry({
      id: APPROVED_HIRBORO.moves[0].id,
      accountNo: "HIR003",
      type: "invoice",
      amount: 1450,
      date: "2026-09-18",
      reference: "INV-1789741428761",
    }),
    // Under-totals so preflight fails expected combined
    entry({
      id: "only-partial",
      accountNo: "HIRBORO ANTEFAZA",
      type: "invoice",
      amount: 100,
      date: "2026-01-01",
      reference: "X",
    }),
  ]);
  const prisma = mockPrisma({
    fas: {
      [APPROVED_HIRBORO.sourceFaId]: {
        id: APPROVED_HIRBORO.sourceFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: "HIR003",
        accountNo: "HIR003",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
      },
      [APPROVED_HIRBORO.destFaId]: {
        id: APPROVED_HIRBORO.destFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: "HIRBORO ANTEFAZA",
        accountNo: "HIR002",
        retiredAt: null,
      },
      [APPROVED_HIRBORO.protectedSiblingFaId]: {
        id: APPROVED_HIRBORO.protectedSiblingFaId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        accountRef: "HIRBORO BEREKET",
        accountNo: "HIR001",
        retiredAt: null,
        mergedIntoFamilyAccountId: null,
      },
    },
    learners: {
      [APPROVED_HIRBORO.learnerId]: {
        id: APPROVED_HIRBORO.learnerId,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        familyAccountId: APPROVED_HIRBORO.sourceFaId,
      },
    },
    parents: {},
  });
  const r = await executeApprovedHirConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    spec: APPROVED_HIRBORO,
    mode: "apply",
  });
  assert.strictEqual(r.status, "aborted");
  assert.match(r.reason, /preflight|combined/i);
  pass("unexpected-state / combined mismatch refusal");
  setBillingLedgerStoreDataDirForTests(null);
}

async function main() {
  await testHirExactRelocationAndTotals();
  await testClassBIdempotentAlreadyDone();
  await testSourceNotEmptyRefusal();
  console.log("\nfinalRepairPhase.test.ts: ALL PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
