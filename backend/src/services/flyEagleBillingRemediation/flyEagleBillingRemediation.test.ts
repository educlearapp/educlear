/**
 * Fly Eagle billing remediation — unit tests (synthetic fixtures).
 * Run: npx tsx src/services/flyEagleBillingRemediation/flyEagleBillingRemediation.test.ts
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID } from "./constants";
import { classifyZeroLinkedFamilyAccounts } from "./classify";
import { computeCountChecksums, computeMoneyTotals } from "./checksums";
import {
  isFamilyAccountIdEligibleForNewPayment,
  filterAccountsEligibleForNewPayment,
} from "../paymentAccountEligibility";
import { buildReconciliationReport } from "./reconcile";
import { executeRepairPlan, assertOrphanLedgerEmptyForRetire } from "./repair";
import { buildBillingIntegrityReport, migrationSilentOrphanFindings } from "./integrityReport";
import { buildClassBConsolidationManifests } from "./ledgerConsolidate";
import type { ApprovedClassBSpec } from "./approvedClassBManifests";
import { executeApprovedClassBConsolidation } from "./classBApply";
import {
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import {
  buildSyntheticFlyEagleBundle,
} from "./fixtures/syntheticFlyEagleBundle";

function pass(name: string) {
  console.log(`✓ ${name}`);
}

function testSchoolScopeGuard() {
  assert.throws(() => assertFlyEagleSchoolId("cmpideqeq0000108xb6ouv9zi"), /Refuse non-Fly-Eagle/);
  assert.doesNotThrow(() => assertFlyEagleSchoolId(FLY_EAGLE_SCHOOL_ID));
  pass("school scope guard refuses other schools");
}

function testChecksumsAndMoney() {
  const bundle = buildSyntheticFlyEagleBundle();
  const c = computeCountChecksums(bundle);
  assert.strictEqual(c.activeLearners, 6);
  assert.strictEqual(c.historicalLearners, 1);
  assert.ok(c.faZeroLinked >= 3, "expected several zero-linked FAs");
  const money = computeMoneyTotals(bundle);
  assert.ok(money.invoiceCount >= 4, `invoiceCount=${money.invoiceCount}`);
  assert.ok(money.paymentCount >= 3, `paymentCount=${money.paymentCount}`);
  pass("checksums + money totals on synthetic bundle");
}

function testClassifications() {
  const bundle = buildSyntheticFlyEagleBundle();
  const rows = classifyZeroLinkedFamilyAccounts(bundle);
  const byId = new Map(rows.map((r) => [r.faId, r]));

  const empty = byId.get("fa-empty-shell");
  assert.ok(empty);
  assert.strictEqual(empty!.category, "DUPLICATE_SHELL");
  assert.strictEqual(empty!.repairClass, "A");
  assert.strictEqual(empty!.proposedAction, "retire_empty_shell");

  const add = byId.get("fa-add001");
  assert.ok(add);
  assert.ok(
    add!.category === "HISTORICAL_LEARNER_ACCOUNT" ||
      add!.category === "LEGITIMATE_HISTORICAL_PREDECESSOR",
    `ADD001 category=${add!.category}`
  );
  assert.strictEqual(add!.proposedAction, "none");

  const unresolved = byId.get("fa-unresolved");
  assert.ok(unresolved);
  assert.ok(
    unresolved!.repairClass === "C" ||
      unresolved!.category === "VALID_HISTORICAL_NO_REPAIR" ||
      unresolved!.category === "LEGITIMATE_HISTORICAL_PREDECESSOR",
    `unresolved class=${unresolved!.repairClass} cat=${unresolved!.category}`
  );

  const sot = byId.get("fa-sot001");
  assert.ok(sot);
  assert.ok(sot!.matchedLearnerIds.includes("lrn-lulonke"));
  assert.strictEqual(
    sot!.proposedAction,
    "relink_parents_to_current_retire_orphan",
    `SOT001 action=${sot!.proposedAction}`
  );
  assert.ok(
    sot!.evidence.includes("audit_unmerge_trail") ||
      sot!.evidence.includes("current_holds_continuing_ledger")
  );
  assert.ok(sot!.currentFaIds.includes("fa-sot002"));

  const led = byId.get("fa-led-orphan");
  assert.ok(led);
  assert.strictEqual(led!.repairClass, "B", `LEDIKWA class=${led!.repairClass}`);
  assert.strictEqual(led!.proposedAction, "ledger_consolidate_then_merge");

  const map = byId.get("fa-map-orphan");
  assert.ok(map);
  assert.strictEqual(map!.repairClass, "B", `MAPUTLA class=${map!.repairClass}`);

  const hir = byId.get("fa-hir002");
  assert.ok(hir);
  assert.ok(
    hir!.repairClass === "C" || hir!.proposedAction === "needs_school_confirmation",
    `HIR002 must stay Class C; got class=${hir!.repairClass} action=${hir!.proposedAction}`
  );

  const man = byId.get("fa-man009");
  assert.ok(man);
  assert.ok(
    man!.category === "SPLIT_LEDGER" || man!.repairClass === "B" || man!.repairClass === "C",
    `MAN009 cat=${man!.category} class=${man!.repairClass}`
  );

  pass("zero-linked classifications (shell / historical / SOT / LED / MAP / HIR / unresolved)");
}

function testPaymentPickerExcludesZeroLinked() {
  const bundle = buildSyntheticFlyEagleBundle();
  const linked = new Set(
    bundle.learners.map((l) => String(l.familyAccountId || "").trim()).filter(Boolean)
  );
  assert.ok(!isFamilyAccountIdEligibleForNewPayment("fa-add001", linked));
  assert.ok(!isFamilyAccountIdEligibleForNewPayment("fa-man009", linked));
  assert.ok(isFamilyAccountIdEligibleForNewPayment("fa-man005", linked));
  assert.ok(isFamilyAccountIdEligibleForNewPayment("fa-sot002", linked));

  const filtered = filterAccountsEligibleForNewPayment(
    [
      { familyAccountId: "fa-add001", accountNo: "GROOM ADEBO", eduClearAccountNo: "ADD001" },
      { familyAccountId: "fa-man005", accountNo: "MANXILA MIBONGO", eduClearAccountNo: "MAN005" },
      { familyAccountId: "fa-man009", accountNo: "MANXILA SIMBONGO", eduClearAccountNo: "MAN009" },
    ],
    linked
  );
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].familyAccountId, "fa-man005");
  pass("zero-linked historical FA excluded from new-payment picker; linked kept");
}

function testSiblingShareAllowed() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  const manLearners = report.activeLearners.filter((l) => l.accountNo === "MAN005");
  assert.strictEqual(manLearners.length, 2, "siblings may share one FA");
  pass("sibling learners share one FamilyAccount");
}

function testAmbiguousRejectedFromMutation() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  for (const item of report.repairPlan.classC) {
    assert.ok(
      item.action === "needs_school_confirmation" || item.action === "none",
      `Class C action=${item.action}`
    );
  }
  assert.ok(
    report.repairPlan.classC.some(
      (c) => c.orphanAccountNo === "HIR002" || c.orphanFaId === "fa-hir002"
    ),
    "HIR002 must appear in Class C"
  );
  pass("ambiguous identity stays Class C / non-mutating");
}

function testSotRetirementRefusesWhenLedgerPresent() {
  const item = {
    caseKey: "SOT001::fa-sot001",
    repairClass: "A" as const,
    orphanFaId: "fa-sot001",
    orphanAccountRef: "SOTSHANGANE LULONKE",
    orphanAccountNo: "SOT001",
    action: "relink_parents_to_current_retire_orphan" as const,
    learnerIds: ["lrn-lulonke"],
    currentFaIds: ["fa-sot002"],
    evidence: [] as any[],
    reasons: [] as string[],
    preconditions: [] as string[],
    monetary: { orphanBalance: 0, orphanInvoiceTotal: 0, orphanPaymentTotal: 0 },
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fe-sot-refuse-"));
  try {
    setBillingLedgerStoreDataDirForTests(tmp);
    writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, [
      {
        id: "bad-sot-inv",
        schoolId: FLY_EAGLE_SCHOOL_ID,
        learnerId: "",
        accountNo: "SOT001",
        type: "invoice",
        amount: 100,
        date: "2026-01-01",
        reference: "X",
        description: "should block retire",
        createdAt: new Date().toISOString(),
      },
    ]);
    const check = assertOrphanLedgerEmptyForRetire(FLY_EAGLE_SCHOOL_ID, item);
    assert.ok(!check.ok, "must refuse retire when ledger present");
    assert.ok(/refuse retire/i.test(check.reason));
    pass("refusing SOT001 retirement if any ledger/balance appears");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testSotRetirementAllowsEmptyLedger() {
  const item = {
    caseKey: "SOT001::fa-sot001",
    repairClass: "A" as const,
    orphanFaId: "fa-sot001",
    orphanAccountRef: "SOTSHANGANE LULONKE",
    orphanAccountNo: "SOT001",
    action: "relink_parents_to_current_retire_orphan" as const,
    learnerIds: ["lrn-lulonke"],
    currentFaIds: ["fa-sot002"],
    evidence: [] as any[],
    reasons: [] as string[],
    preconditions: [] as string[],
    monetary: { orphanBalance: 0, orphanInvoiceTotal: 0, orphanPaymentTotal: 0 },
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fe-sot-ok-"));
  try {
    setBillingLedgerStoreDataDirForTests(tmp);
    writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, [
      {
        id: "sot002-keep",
        schoolId: FLY_EAGLE_SCHOOL_ID,
        learnerId: "lrn-lulonke",
        accountNo: "SOT002",
        type: "invoice",
        amount: 1400,
        date: "2026-08-27",
        reference: "KEEP",
        description: "current ledger",
        createdAt: new Date().toISOString(),
      },
    ]);
    const check = assertOrphanLedgerEmptyForRetire(FLY_EAGLE_SCHOOL_ID, item);
    assert.ok(check.ok, check.reason);
    pass("SOT001 safe retirement allowed when orphan ledger empty (SOT002 untouched)");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function buildSyntheticApprovedSpecs(): ApprovedClassBSpec[] {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  const manifests = buildClassBConsolidationManifests(bundle, report.repairPlan.classB);
  return manifests
    .filter((m) => m.orphanFaId === "fa-led-orphan" || m.orphanFaId === "fa-map-orphan")
    .map((m) => ({
      label: m.orphanFaId === "fa-led-orphan" ? "LEDIKWA" : "MAPUTLA",
      orphanFaId: m.orphanFaId,
      orphanAccountRef: m.orphanAccountRef,
      currentFaId: m.currentFaId,
      currentAccountRef: m.currentAccountRef,
      currentAccountNo: m.currentAccountNo || "",
      learnerIds: m.learnerIds,
      moves: m.moves.map((mv) => ({
        id: mv.id,
        type: mv.type,
        date: mv.date,
        amount: mv.amount,
        reference: mv.reference,
        fromAccountNo: mv.fromAccountNo,
        toAccountNo: mv.toAccountNo,
      })),
      expectedCombined: {
        invoiceTotal: m.after.combinedInvoiceTotal,
        paymentTotal: m.after.combinedPaymentTotal,
        creditTotal: m.after.combinedCreditTotal,
        balance: m.after.combinedBalance,
      },
    }));
}

function seedLedgerFromBundle(): BillingLedgerEntry[] {
  const bundle = buildSyntheticFlyEagleBundle();
  return bundle.ledger.map((e, i) => ({
    id: String(e.id || `row-${i}`),
    schoolId: FLY_EAGLE_SCHOOL_ID,
    learnerId: String(e.learnerId || ""),
    accountNo: String(e.accountNo || ""),
    type: (e.type || "invoice") as BillingLedgerEntry["type"],
    amount: Number(e.amount || 0),
    date: String(e.date || "2026-01-01"),
    reference: String(e.reference || ""),
    description: String(e.description || ""),
    createdAt: new Date().toISOString(),
  }));
}

function makePrismaStub(opts: {
  orphanFaId: string;
  currentFaId: string;
  currentAccountRef: string;
  currentAccountNo: string;
}) {
  const state = { orphanRetired: false, parentsMoved: 0 };
  return {
    state,
    familyAccount: {
      findFirst: async ({ where }: any) => {
        if (where.id === opts.orphanFaId) {
          return {
            id: opts.orphanFaId,
            accountRef:
              opts.orphanFaId === "fa-led-orphan"
                ? "LEDIKWA RELESEGO"
                : "MAPUTLA MAROPENG LEANDRA",
            accountNo: null,
            retiredAt: state.orphanRetired ? new Date() : null,
            mergedIntoFamilyAccountId: state.orphanRetired ? opts.currentFaId : null,
          };
        }
        if (where.id === opts.currentFaId) {
          return {
            id: opts.currentFaId,
            accountRef: opts.currentAccountRef,
            accountNo: opts.currentAccountNo,
            retiredAt: null,
          };
        }
        return null;
      },
      updateMany: async ({ where, data }: any) => {
        if (where.id === opts.orphanFaId && data.retiredAt) {
          state.orphanRetired = true;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    learner: {
      count: async () => 0,
      findMany: async () => [],
    },
    parent: {
      updateMany: async () => {
        state.parentsMoved += 1;
        return { count: 2 };
      },
    },
    $transaction: async (fn: any) =>
      fn({
        familyAccount: {
          updateMany: async ({ where, data }: any) => {
            if (where.id === opts.orphanFaId && data.retiredAt) {
              state.orphanRetired = true;
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
        learner: { count: async () => 0 },
        parent: {
          updateMany: async () => {
            state.parentsMoved += 1;
            return { count: 2 };
          },
        },
      }),
  };
}

async function testClassBLedikwaAndMaputlaApply() {
  const specs = buildSyntheticApprovedSpecs();
  assert.strictEqual(specs.length, 2, `expected LED+MAP specs, got ${specs.length}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fe-classb-"));
  try {
    setBillingLedgerStoreDataDirForTests(tmp);
    writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, seedLedgerFromBundle());
    const beforeMoney = computeMoneyTotals(buildSyntheticFlyEagleBundle());
    const report = buildReconciliationReport(buildSyntheticFlyEagleBundle());

    for (const spec of specs) {
      const item = report.repairPlan.classB.find((c) => c.orphanFaId === spec.orphanFaId);
      assert.ok(item, `missing plan item for ${spec.label}`);
      const prisma = makePrismaStub({
        orphanFaId: spec.orphanFaId,
        currentFaId: spec.currentFaId,
        currentAccountRef: spec.currentAccountRef,
        currentAccountNo: spec.currentAccountNo,
      });
      const r1 = await executeApprovedClassBConsolidation({
        prisma: prisma as any,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        item: item!,
        spec,
        mode: "apply",
      });
      assert.strictEqual(r1.status, "applied", `${spec.label}: ${r1.reason}`);

      const ledger = readSchoolLedger(FLY_EAGLE_SCHOOL_ID);
      for (const mv of spec.moves) {
        const row = ledger.find((e) => e.id === mv.id);
        assert.ok(row, `missing ${mv.id}`);
        assert.strictEqual(String(row!.accountNo).toUpperCase(), mv.toAccountNo.toUpperCase());
        assert.strictEqual(row!.amount, mv.amount);
        assert.strictEqual(row!.date, mv.date);
        assert.strictEqual(String(row!.reference || ""), String(mv.reference || ""));
      }
      assert.strictEqual(
        ledger.filter((e) => e.accountNo.toUpperCase() === spec.orphanAccountRef.toUpperCase())
          .length,
        0,
        `${spec.label} source must be empty`
      );

      const r2 = await executeApprovedClassBConsolidation({
        prisma: prisma as any,
        schoolId: FLY_EAGLE_SCHOOL_ID,
        item: item!,
        spec,
        mode: "apply",
      });
      assert.strictEqual(r2.status, "applied", `idempotent ${spec.label}: ${r2.reason}`);
      assert.ok(/idempotent|already/i.test(r2.reason), r2.reason);
    }

    const after = readSchoolLedger(FLY_EAGLE_SCHOOL_ID);
    const ids = after.map((e) => e.id);
    assert.strictEqual(new Set(ids).size, ids.length, "no duplicate ledger ids");
    const inv = after.filter((e) => e.type === "invoice").reduce((s, e) => s + e.amount, 0);
    const pay = after.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    const cred = after.filter((e) => e.type === "credit").reduce((s, e) => s + e.amount, 0);
    assert.strictEqual(Math.round(inv * 100), Math.round(beforeMoney.invoiceTotal * 100));
    assert.strictEqual(Math.round(pay * 100), Math.round(beforeMoney.paymentTotal * 100));
    assert.strictEqual(Math.round(cred * 100), Math.round(beforeMoney.creditTotal * 100));

    pass("LEDIKWA + MAPUTLA manifest application preserves totals/ids/dates/refs + idempotent");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testClassBUnexpectedStateAborts() {
  const specs = buildSyntheticApprovedSpecs();
  const led = specs.find((s) => s.label === "LEDIKWA")!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fe-classb-abort-"));
  try {
    setBillingLedgerStoreDataDirForTests(tmp);
    const seeded = seedLedgerFromBundle();
    const bad = seeded.map((e) =>
      e.id === led.moves[0].id ? { ...e, amount: e.amount + 1 } : e
    );
    writeSchoolLedger(FLY_EAGLE_SCHOOL_ID, bad);
    const report = buildReconciliationReport(buildSyntheticFlyEagleBundle());
    const item = report.repairPlan.classB.find((c) => c.orphanFaId === led.orphanFaId)!;
    const prisma = makePrismaStub({
      orphanFaId: led.orphanFaId,
      currentFaId: led.currentFaId,
      currentAccountRef: led.currentAccountRef,
      currentAccountNo: led.currentAccountNo,
    });
    const r = await executeApprovedClassBConsolidation({
      prisma: prisma as any,
      schoolId: FLY_EAGLE_SCHOOL_ID,
      item,
      spec: led,
      mode: "apply",
    });
    assert.strictEqual(r.status, "aborted");
    assert.ok(/amount mismatch/i.test(r.reason), r.reason);
    pass("unexpected state abort on amount mismatch");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testClassBCrossSchoolRejected() {
  const specs = buildSyntheticApprovedSpecs();
  const led = specs[0];
  const report = buildReconciliationReport(buildSyntheticFlyEagleBundle());
  const item = report.repairPlan.classB.find((c) => c.orphanFaId === led.orphanFaId)!;
  await assert.rejects(async () => {
    await executeApprovedClassBConsolidation({
      prisma: {} as any,
      schoolId: "cmpideqeq0000108xb6ouv9zi",
      item,
      spec: led,
      mode: "dry-run",
    });
  }, /Refuse non-Fly-Eagle|cross-school/);
  pass("cross-school rejection");
}

async function testHir002SkippedInPlanExecution() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  const r = await executeRepairPlan({
    prisma: null,
    report,
    mode: "dry-run",
    includeClassBPlans: true,
    approvedClassBSpecs: buildSyntheticApprovedSpecs(),
  });
  const hir = r.cases.filter(
    (c) => c.caseKey.includes("HIR002") || c.caseKey.includes("fa-hir002")
  );
  assert.ok(hir.length >= 1);
  assert.ok(hir.every((c) => c.status === "unchanged"));
  assert.ok(hir.every((c) => c.repairClass === "C"));
  pass("HIR002 remains skipped");
}

async function testSotParentRelinkDryRun() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  const r = await executeRepairPlan({
    prisma: null,
    report,
    mode: "dry-run",
    includeClassBPlans: true,
    approvedClassBSpecs: buildSyntheticApprovedSpecs(),
  });
  const sot = r.cases.find((c) => c.action === "relink_parents_to_current_retire_orphan");
  assert.ok(sot);
  assert.strictEqual(sot!.status, "would_change");
  const classB = r.cases.filter(
    (c) => c.repairClass === "B" && c.action === "ledger_consolidate_then_merge"
  );
  assert.ok(classB.length >= 2);
  assert.ok(
    classB.filter((c) => /LED|MAP|fa-led|fa-map/i.test(c.caseKey)).every((c) => c.status === "would_change"),
    "approved LED/MAP Class B must would_change"
  );
  pass("SOT parent relink + Class B would_change in dry-run");
}

function testDryRunIdempotentShape() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  return executeRepairPlan({
    prisma: null,
    report,
    mode: "dry-run",
    includeClassBPlans: true,
    approvedClassBSpecs: buildSyntheticApprovedSpecs(),
  }).then((r1) => {
    assert.strictEqual(r1.mode, "dry-run");
    assert.ok(r1.monetaryReconciled, "dry-run money must reconcile");
    assert.ok(!r1.aborted);
    const would = r1.cases.filter((c) => c.status === "would_change");
    assert.ok(would.length >= 1, "expected at least empty-shell would_change");
    return executeRepairPlan({
      prisma: null,
      report,
      mode: "dry-run",
      includeClassBPlans: true,
      approvedClassBSpecs: buildSyntheticApprovedSpecs(),
    }).then((r2) => {
      assert.strictEqual(
        r2.cases.filter((c) => c.status === "would_change").length,
        would.length,
        "repeated dry-run is idempotent in shape"
      );
      pass("dry-run monetary reconcile + idempotent shape");
    });
  });
}

function testRefuseOtherSchoolReport() {
  const report = buildReconciliationReport(buildSyntheticFlyEagleBundle());
  const badReport = { ...report, schoolId: "cmpideqeq0000108xb6ouv9zi" };
  return executeRepairPlan({
    prisma: {} as any,
    report: badReport,
    mode: "dry-run",
  })
    .then(() => {
      throw new Error("expected refuse other school");
    })
    .catch((err) => {
      assert.ok(
        String(err.message || err).includes("does not match") ||
          String(err.message || err).includes("Refuse")
      );
      pass("repair refuses non-Fly-Eagle report schoolId");
    });
}

function testApplyGates() {
  delete process.env.CONFIRM_FLY_EAGLE_BILLING_REPAIR;
  delete process.env.CONFIRM_PRODUCTION_WRITE;
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  return executeRepairPlan({ prisma: {} as any, report, mode: "apply" })
    .then(() => {
      throw new Error("expected apply gate failure");
    })
    .catch((err) => {
      assert.ok(String(err.message || err).includes("CONFIRM_FLY_EAGLE_BILLING_REPAIR"));
      pass("apply mode fails closed without confirm env gates");
    });
}

function testClassBConsolidationManifestSafe() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  const manifests = buildClassBConsolidationManifests(bundle, report.repairPlan.classB);
  assert.ok(manifests.length >= 2, "expected LEDIKWA + MAPUTLA manifests");
  for (const m of manifests) {
    assert.ok(m.safe, `manifest ${m.caseKey} must be safe: ${JSON.stringify(m.invariants)}`);
    assert.strictEqual(m.before.combinedInvoiceTotal, m.after.combinedInvoiceTotal);
    assert.strictEqual(m.before.combinedPaymentTotal, m.after.combinedPaymentTotal);
    assert.strictEqual(m.before.combinedBalance, m.after.combinedBalance);
    assert.strictEqual(m.after.orphan.invoiceCount, 0);
  }
  pass("Class B ledger consolidation manifests preserve totals");
}

function testIntegrityValidHistoricalNotUnresolved() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildBillingIntegrityReport(bundle);
  const validHist = report.findings.filter(
    (f) => f.meta && (f.meta as { validHistorical?: boolean }).validHistorical
  );
  assert.ok(validHist.length >= 1);
  assert.ok(validHist.every((f) => f.severity === "INFO"));
  pass("VALID HISTORICAL findings are INFO — not unresolved failures");
}

function testIntegrityReportAndMigrationGuard() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildBillingIntegrityReport(bundle);
  assert.ok(report.findings.some((f) => f.code === "ACTIVE_ZERO_LINKED_FA"));
  assert.ok(
    report.findings.some((f) => f.code === "SPLIT_LEARNER_LEDGER") || report.warningCount >= 1
  );
  assert.ok(!report.findings.some((f) => f.schoolId !== FLY_EAGLE_SCHOOL_ID));

  const silent = migrationSilentOrphanFindings({
    schoolId: FLY_EAGLE_SCHOOL_ID,
    createdFamilyAccountIds: ["fa-empty-shell", "fa-man009"],
    bundle,
  });
  assert.ok(silent.some((f) => f.familyAccountId === "fa-empty-shell"));
  assert.ok(
    silent.some((f) => f.familyAccountId === "fa-man009" && f.severity === "BLOCKING"),
    "orphan shell with ledger must be BLOCKING in migration guard"
  );
  pass("integrity report + migration silent-orphan guard (Express orphan regression)");
}

function testUnexpectedStateSkipsRatherThanGuessing() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  return executeRepairPlan({ prisma: null, report, mode: "apply" })
    .then(() => {
      throw new Error("expected apply gate failure");
    })
    .catch((err) => {
      assert.ok(String(err.message || err).includes("CONFIRM"));
      pass("unexpected/unguarded apply aborts safely");
    });
}

async function main() {
  testSchoolScopeGuard();
  testChecksumsAndMoney();
  testClassifications();
  testPaymentPickerExcludesZeroLinked();
  testSiblingShareAllowed();
  testAmbiguousRejectedFromMutation();
  testSotRetirementRefusesWhenLedgerPresent();
  testSotRetirementAllowsEmptyLedger();
  testClassBConsolidationManifestSafe();
  testIntegrityValidHistoricalNotUnresolved();
  testIntegrityReportAndMigrationGuard();
  await testSotParentRelinkDryRun();
  await testClassBLedikwaAndMaputlaApply();
  await testClassBUnexpectedStateAborts();
  await testClassBCrossSchoolRejected();
  await testHir002SkippedInPlanExecution();
  await testDryRunIdempotentShape();
  await testRefuseOtherSchoolReport();
  await testApplyGates();
  await testUnexpectedStateSkipsRatherThanGuessing();
  console.log("\nflyEagleBillingRemediation.test.ts — PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
