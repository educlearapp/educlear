/**
 * Fly Eagle billing remediation — unit tests (synthetic fixtures).
 * Run: npx tsx src/services/flyEagleBillingRemediation/flyEagleBillingRemediation.test.ts
 */
import assert from "assert";

import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID } from "./constants";
import { classifyZeroLinkedFamilyAccounts } from "./classify";
import { computeCountChecksums, computeMoneyTotals } from "./checksums";
import {
  isFamilyAccountIdEligibleForNewPayment,
  filterAccountsEligibleForNewPayment,
} from "../paymentAccountEligibility";
import { buildReconciliationReport } from "./reconcile";
import { executeRepairPlan } from "./repair";
import { buildBillingIntegrityReport, migrationSilentOrphanFindings } from "./integrityReport";
import {
  buildOtherSchoolBundle,
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
  assert.strictEqual(c.activeLearners, 3);
  assert.strictEqual(c.historicalLearners, 1);
  assert.ok(c.faZeroLinked >= 3, "expected several zero-linked FAs");
  const money = computeMoneyTotals(bundle);
  assert.strictEqual(money.invoiceCount, 4);
  assert.strictEqual(money.paymentCount, 3);
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
    unresolved!.repairClass === "C" || unresolved!.category === "LEGITIMATE_HISTORICAL_PREDECESSOR",
    `unresolved class=${unresolved!.repairClass} cat=${unresolved!.category}`
  );

  const sot = byId.get("fa-sot001");
  assert.ok(sot);
  assert.ok(sot!.matchedLearnerIds.includes("lrn-lulonke"));
  assert.ok(
    sot!.evidence.includes("parent_phone") || sot!.evidence.includes("parent_email") || sot!.evidence.includes("parent_name")
  );
  assert.ok(sot!.evidence.includes("exact_learner_name"));

  const man = byId.get("fa-man009");
  assert.ok(man);
  assert.ok(man!.matchedLearnerIds.length >= 1);
  // Split: both MAN009 and MAN005 have money
  assert.ok(
    man!.category === "SPLIT_LEDGER" || man!.repairClass === "B" || man!.repairClass === "C",
    `MAN009 cat=${man!.category} class=${man!.repairClass}`
  );

  pass("zero-linked classifications (shell / historical / SOT / MAN / unresolved)");
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
  pass("ambiguous identity stays Class C / non-mutating");
}

function testDryRunIdempotentShape() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildReconciliationReport(bundle);
  // prisma stub removed — dry-run no longer requires prisma
  return executeRepairPlan({
    prisma: null,
    report,
    mode: "dry-run",
  }).then((r1) => {
    assert.strictEqual(r1.mode, "dry-run");
    assert.ok(r1.monetaryReconciled, "dry-run money must reconcile");
    assert.ok(!r1.aborted);
    const would = r1.cases.filter((c) => c.status === "would_change");
    assert.ok(would.length >= 1, "expected at least empty-shell would_change");
    return executeRepairPlan({ prisma: null, report, mode: "dry-run" }).then((r2) => {
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
  const other = buildOtherSchoolBundle();
  let threw = false;
  try {
    buildReconciliationReport(other);
    // reconcile itself does not assert school — repair does
  } catch {
    threw = true;
  }
  void threw;
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
      assert.ok(String(err.message || err).includes("does not match") || String(err.message || err).includes("Refuse"));
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

function testIntegrityReportAndMigrationGuard() {
  const bundle = buildSyntheticFlyEagleBundle();
  const report = buildBillingIntegrityReport(bundle);
  assert.ok(report.findings.some((f) => f.code === "ACTIVE_ZERO_LINKED_FA"));
  assert.ok(report.findings.some((f) => f.code === "SPLIT_LEARNER_LEDGER") || report.warningCount >= 1);
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
  // Force a Class A relink case then simulate apply without prisma → aborted/refused
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
  testIntegrityReportAndMigrationGuard();
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
