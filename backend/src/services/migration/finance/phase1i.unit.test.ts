/**
 * Phase 1I unit tests — aging fidelity, fee-check gate, shared authority.
 * Run: npx tsx src/services/migration/finance/phase1i.unit.test.ts
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  extractAgingBucketsFromMappedRow,
  resolveAgingFidelity,
} from "./agingFidelity";
import { loadSourceAgingByAccount } from "./loadSourceAgingByAccount";
import { acceptMigration, MigrationAcceptanceError } from "./acceptMigration";
import {
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../../utils/familyAccountAgeAnalysisStore";
import {
  setBillingLedgerStoreDataDirForTests,
} from "../../../utils/billingLedgerStore";
import { resolveAuthoritativeFamilyAccountBalance } from "../../financeAuthority/resolveAuthoritativeFamilyAccountBalance";
import { saveFinanceReconciliation } from "./migrationFinanceReconciliationStore";
import { saveStatementAuthorityCheck } from "./statementAuthority/statementAuthorityStore";
import { saveFeeCheckAuthorityCheck } from "./feeCheckAuthority";
import type { MigrationFinanceReconciliation } from "./MigrationFinanceReconciliation";
import type { MigrationStatementAuthorityCheck } from "./statementAuthority/MigrationStatementAuthority";
import type { MigrationFeeCheckAuthorityCheck } from "./feeCheckAuthority";

function tmpDirs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "umig-1i-"));
  setBillingLedgerStoreDataDirForTests(dir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);
  return dir;
}

function testAgingFidelity() {
  const buckets = extractAgingBucketsFromMappedRow({
    Account: "ACC1",
    Current: "1000.00",
    "30 days": "500.00",
    "60 days": "250.00",
    "90 days": "100.00",
    "120+": "50.00",
  });
  assert(buckets, "buckets extracted");
  assert.strictEqual(buckets!.current, 100000);
  assert.strictEqual(buckets!.d30, 50000);
  assert.strictEqual(buckets!.d60, 25000);
  assert.strictEqual(buckets!.d90, 10000);
  assert.strictEqual(buckets!.d120, 5000);

  const ok = resolveAgingFidelity({
    acceptedBalanceCents: 190000,
    sourceBuckets: buckets,
  });
  assert.strictEqual(ok.mode, "SOURCE_BUCKETS");

  const balanceOnly = resolveAgingFidelity({
    acceptedBalanceCents: 425000,
    sourceBuckets: null,
  });
  assert.strictEqual(balanceOnly.mode, "BALANCE_ONLY");
  assert(
    balanceOnly.operatorMessage.includes("did not provide reliable aging"),
    "BALANCE_ONLY message"
  );

  const mismatchBuckets = resolveAgingFidelity({
    acceptedBalanceCents: 425000,
    sourceBuckets: buckets,
  });
  assert.strictEqual(mismatchBuckets.mode, "BALANCE_ONLY", "sum mismatch → BALANCE_ONLY");

  const byAcc = loadSourceAgingByAccount(
    new Map([
      [
        "f1",
        [
          {
            Account: "ACC1",
            Current: "1000.00",
            "30 days": "500.00",
            "60 days": "250.00",
            "90 days": "100.00",
            "120+": "50.00",
          },
        ],
      ],
    ])
  );
  assert(byAcc.get("ACC1"), "loaded by account");
  console.log("✓ aging fidelity + BALANCE_ONLY");
}

async function testSharedAuthority() {
  const dir = tmpDirs();
  try {
    const schoolId = "school_test_1i";
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(schoolId, {
      ACC01: {
        schoolId,
        accountRef: "ACC01",
        accountHolder: "Family",
        balance: 4250,
        buckets: { current: 4250, d30: 0, d60: 0, d90: 0, d120: 0 },
        source: "universal-migration-baseline",
        importedAt: "2026-05-23T12:00:00.000Z",
      },
    });
    const auth = await resolveAuthoritativeFamilyAccountBalance(schoolId, "ACC01");
    assert.strictEqual(auth.balanceCents, 425000);
    assert.strictEqual(auth.authoritySource, "AGE_ANALYSIS_BASELINE_PLUS_DELTA");
    console.log("✓ shared authoritative family-account balance");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function baseRecon(partial: Partial<MigrationFinanceReconciliation> = {}): MigrationFinanceReconciliation {
  return {
    reconciliationId: "recon_1i",
    reconciliationVersion: "1G.1",
    generatedAt: new Date().toISOString(),
    migrationRunId: "run",
    stageId: "stage_1i",
    targetSchoolId: "school_1i",
    sourceAnalysisId: null,
    compiledPlanId: null,
    sourceFingerprints: [],
    sourceTotals: {
      debitCents: 425000,
      creditCents: 0,
      netCents: 425000,
      accountCount: 1,
      transactionCount: 0,
      openingBalanceCount: 1,
    },
    migratedTotals: {
      debitCents: 425000,
      creditCents: 0,
      netCents: 425000,
      accountCount: 1,
      transactionCount: 0,
      openingBalanceCount: 1,
    },
    differenceCents: 0,
    perAccount: [
      {
        accountRef: "ACC01",
        sourceCents: 425000,
        educlearCents: 425000,
        diffCents: 0,
        ok: true,
      },
    ],
    mismatches: [],
    canAccept: true,
    blockedReasons: [],
    stale: false,
    skippedUnsupported: [],
    ...partial,
  };
}

function testAcceptRequiresFeeMatch() {
  const stageId = `stage_1i_${Date.now()}`;
  const recon = baseRecon({
    reconciliationId: `recon_1i_${Date.now()}`,
    stageId,
  });
  saveFinanceReconciliation(recon);

  const stmt: MigrationStatementAuthorityCheck = {
    checkId: `stmt_1i_${Date.now()}`,
    authorityVersion: "1H.1",
    generatedAt: new Date().toISOString(),
    migrationRunId: "run",
    stageId,
    targetSchoolId: "school_1i",
    sourceAnalysisId: null,
    compiledPlanId: null,
    reconciliationId: recon.reconciliationId,
    cutoverAt: "2026-05-23T23:59:59.999Z",
    accountsChecked: 1,
    matchCount: 1,
    mismatchCount: 0,
    perAccount: [],
    mismatches: [],
    liveConcurrency: [],
    statementAuthorityMatch: true,
    canFinalizeBaseline: true,
    blockedReasons: [],
    stale: false,
    staleReasons: [],
  };
  saveStatementAuthorityCheck(stmt);

  const feeBad: MigrationFeeCheckAuthorityCheck = {
    checkId: `feechk_bad_${Date.now()}`,
    version: "1I.1",
    generatedAt: new Date().toISOString(),
    migrationRunId: "run",
    stageId,
    targetSchoolId: "school_1i",
    reconciliationId: recon.reconciliationId,
    statementAuthorityCheckId: stmt.checkId,
    accountsChecked: 1,
    matchCount: 0,
    mismatchCount: 1,
    feeCheckAuthorityMatch: false,
    perAccount: [],
    mismatches: [],
    blockedReasons: ["mismatch"],
    stale: false,
  };
  saveFeeCheckAuthorityCheck(feeBad);

  let blocked = false;
  try {
    acceptMigration({
      stage: {
        stageId,
        targetSchoolId: "school_1i",
        migrationRunId: "run",
      } as any,
      reconciliationId: recon.reconciliationId,
      statementAuthorityCheckId: stmt.checkId,
      feeCheckAuthorityCheckId: feeBad.checkId,
      confirmation: true,
      parentReviewUnresolved: 0,
      summary: {
        learners: 0,
        parents: 0,
        links: 0,
        classrooms: 0,
        accounts: 1,
        openingBalances: 1,
        transactions: 0,
        billingPlans: 0,
        unsupportedSkipped: 0,
        differenceCents: 0,
      },
    });
  } catch (e) {
    blocked = e instanceof MigrationAcceptanceError && e.message.includes("FEE_CHECK_AUTHORITY_MATCH");
  }
  assert(blocked, "Accept blocked when Fee Check ≠ Statement");

  const feeOk: MigrationFeeCheckAuthorityCheck = {
    ...feeBad,
    checkId: `feechk_ok_${Date.now()}`,
    feeCheckAuthorityMatch: true,
    matchCount: 1,
    mismatchCount: 0,
    blockedReasons: [],
  };
  saveFeeCheckAuthorityCheck(feeOk);
  const accepted = acceptMigration({
    stage: {
      stageId,
      targetSchoolId: "school_1i",
      migrationRunId: "run",
    } as any,
    reconciliationId: recon.reconciliationId,
    statementAuthorityCheckId: stmt.checkId,
    feeCheckAuthorityCheckId: feeOk.checkId,
    confirmation: true,
    parentReviewUnresolved: 0,
    summary: {
      learners: 0,
      parents: 0,
      links: 0,
      classrooms: 0,
      accounts: 1,
      openingBalances: 1,
      transactions: 0,
      billingPlans: 0,
      unsupportedSkipped: 0,
      differenceCents: 0,
    },
  });
  assert.strictEqual(accepted.status, "ACCEPTED");
  assert.strictEqual(accepted.feeCheckAuthorityMatch, true);
  console.log("✓ Accept requires FEE_CHECK_AUTHORITY_MATCH");
}

async function main() {
  testAgingFidelity();
  await testSharedAuthority();
  testAcceptRequiresFeeMatch();
  console.log("Phase 1I unit tests: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
