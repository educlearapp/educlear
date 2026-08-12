/**
 * Phase 1H statement-authority unit tests.
 * Run: npx tsx src/services/migration/finance/statementAuthority/statementAuthority.phase1h.unit.test.ts
 */

import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  setBillingLedgerStoreDataDirForTests,
  appendSchoolEntrySafe,
  readSchoolLedger,
} from "../../../../utils/billingLedgerStore";
import {
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../../../utils/familyAccountAgeAnalysisStore";
import { resolveAuthoritativeAccountBalanceFromSnapshot } from "../../../statementAccounts";
import { classifySnapshotRelativeToCutover } from "./classifySnapshotRelativeToCutover";
import { normalizeCutoverAt } from "./cutoverInstant";
import { randToCents, centsEqual } from "../moneyCents";
import { UMIG_OPENING_BALANCE_SOURCE } from "../FinanceClassification";
import {
  migrationOpeningBalanceEntryId,
  migrationOpeningBalanceReference,
} from "../postMigrationOpeningBalances";

const SCHOOL = "school_phase1h_auth";

function postOpening(accountRef: string, cents: number, cutover: string) {
  const type = cents >= 0 ? "invoice" : "credit";
  appendSchoolEntrySafe(SCHOOL, {
    id: migrationOpeningBalanceEntryId(accountRef),
    schoolId: SCHOOL,
    learnerId: "L1",
    accountNo: accountRef,
    type,
    amount: Math.abs(cents) / 100,
    date: cutover.slice(0, 10),
    reference: migrationOpeningBalanceReference(accountRef),
    description: "Migration opening balance",
    source: UMIG_OPENING_BALANCE_SOURCE,
    createdAt: new Date().toISOString(),
  });
}

async function run() {
  console.log("Phase 1H statement-authority tests…");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "umig-1h-"));
  setBillingLedgerStoreDataDirForTests(tmp);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(tmp);

  try {
    const cutoverAt = normalizeCutoverAt("2026-05-23");
    assert.ok(cutoverAt?.endsWith("Z"));
    console.log("  ✓ cutover date-only → end-of-day instant");

    // Case classification
    assert.strictEqual(
      classifySnapshotRelativeToCutover({ snap: undefined, cutoverAt: cutoverAt! }),
      "NO_SNAPSHOT"
    );
    assert.strictEqual(
      classifySnapshotRelativeToCutover({
        snap: {
          schoolId: SCHOOL,
          accountRef: "A1",
          accountHolder: "A",
          balance: 100,
          buckets: { current: 100, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "kideesys-age-analysis",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
        cutoverAt: cutoverAt!,
      }),
      "OLDER_THAN_CUTOVER"
    );
    assert.strictEqual(
      classifySnapshotRelativeToCutover({
        snap: {
          schoolId: SCHOOL,
          accountRef: "A1",
          accountHolder: "A",
          balance: 100,
          buckets: { current: 100, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "kideesys-age-analysis",
          importedAt: "2026-05-23T12:00:00.000Z",
        },
        cutoverAt: cutoverAt!,
      }),
      "SAME_DATE_AS_CUTOVER"
    );
    assert.strictEqual(
      classifySnapshotRelativeToCutover({
        snap: {
          schoolId: SCHOOL,
          accountRef: "A1",
          accountHolder: "A",
          balance: 100,
          buckets: { current: 100, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "kideesys-age-analysis",
          importedAt: "2026-06-01T00:00:00.000Z",
        },
        cutoverAt: cutoverAt!,
      }),
      "NEWER_THAN_CUTOVER"
    );
    console.log("  ✓ Cases A–D snapshot classification");

    // Case A: no snapshot — openings non-posting → statement 0 until baseline
    postOpening("DEB01", 425000, cutoverAt!);
    postOpening("CR01", -190000, cutoverAt!);
    postOpening("ZERO01", 0, cutoverAt!); // zero skipped by amount 0 — skip
    // zero: write nothing
    let snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL);
    let ledger = readSchoolLedger(SCHOOL);
    let stmtDeb = resolveAuthoritativeAccountBalanceFromSnapshot(
      undefined,
      ledger.filter((e) => e.accountNo === "DEB01")
    );
    assert.strictEqual(stmtDeb, 0, "without baseline, opening does not post to statement");
    console.log("  ✓ Case A — no snapshot: openings non-posting on statement path");

    // Simulate finalize: write migration baseline
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL, {
      DEB01: {
        schoolId: SCHOOL,
        accountRef: "DEB01",
        accountHolder: "Debit Family",
        balance: 4250,
        buckets: { current: 4250, d30: 0, d60: 0, d90: 0, d120: 0 },
        source: "universal-migration-baseline",
        importedAt: new Date().toISOString(),
      },
      CR01: {
        schoolId: SCHOOL,
        accountRef: "CR01",
        accountHolder: "Credit Family",
        balance: -1900,
        buckets: { current: -1900, d30: 0, d60: 0, d90: 0, d120: 0 },
        source: "universal-migration-baseline",
        importedAt: new Date().toISOString(),
      },
      ZERO01: {
        schoolId: SCHOOL,
        accountRef: "ZERO01",
        accountHolder: "Zero Family",
        balance: 0,
        buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
        source: "universal-migration-baseline",
        importedAt: new Date().toISOString(),
      },
    });
    snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL);
    ledger = readSchoolLedger(SCHOOL);
    const afterDeb = resolveAuthoritativeAccountBalanceFromSnapshot(
      snaps.DEB01,
      ledger.filter((e) => e.accountNo === "DEB01")
    );
    const afterCr = resolveAuthoritativeAccountBalanceFromSnapshot(
      snaps.CR01,
      ledger.filter((e) => e.accountNo === "CR01")
    );
    const afterZero = resolveAuthoritativeAccountBalanceFromSnapshot(
      snaps.ZERO01,
      ledger.filter((e) => e.accountNo === "ZERO01")
    );
    assert.ok(centsEqual(randToCents(afterDeb), 425000));
    assert.ok(centsEqual(randToCents(afterCr), -190000));
    assert.ok(centsEqual(randToCents(afterZero), 0));
    console.log("  ✓ Case E — debit / credit / zero statement authority after baseline");

    // Case B: older snapshot would have wrong balance without supersession
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL, {
      OLD01: {
        schoolId: SCHOOL,
        accountRef: "OLD01",
        accountHolder: "Old",
        balance: 9999,
        buckets: { current: 9999, d30: 0, d60: 0, d90: 0, d120: 0 },
        source: "kideesys-age-analysis",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    postOpening("OLD01", 100000, cutoverAt!);
    snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL);
    ledger = readSchoolLedger(SCHOOL);
    const wrong = resolveAuthoritativeAccountBalanceFromSnapshot(
      snaps.OLD01,
      ledger.filter((e) => e.accountNo === "OLD01")
    );
    assert.ok(centsEqual(randToCents(wrong), 999900), "old snapshot still authoritative before supersede");
    // supersede
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL, {
      OLD01: {
        schoolId: SCHOOL,
        accountRef: "OLD01",
        accountHolder: "Old",
        balance: 1000,
        buckets: { current: 1000, d30: 0, d60: 0, d90: 0, d120: 0 },
        source: "universal-migration-baseline",
        importedAt: new Date().toISOString(),
      },
    });
    snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL);
    const fixed = resolveAuthoritativeAccountBalanceFromSnapshot(
      snaps.OLD01,
      ledger.filter((e) => e.accountNo === "OLD01")
    );
    assert.ok(centsEqual(randToCents(fixed), 100000));
    console.log("  ✓ Case B — older snapshot superseded by migration baseline");

    // Case D messaging — newer snapshot not overwritten in classification
    assert.strictEqual(
      classifySnapshotRelativeToCutover({
        snap: {
          schoolId: SCHOOL,
          accountRef: "N1",
          accountHolder: "N",
          balance: 1,
          buckets: { current: 1, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "kideesys-age-analysis",
          importedAt: "2099-01-01T00:00:00.000Z",
        },
        cutoverAt: cutoverAt!,
      }),
      "NEWER_THAN_CUTOVER"
    );
    console.log("  ✓ Case D — newer snapshot classified as review-required");

    // Live concurrent after baseline: manual payment counts in delta
    const baselineAt = snaps.DEB01!.importedAt;
    appendSchoolEntrySafe(SCHOOL, {
      id: "pay-live-1",
      schoolId: SCHOOL,
      learnerId: "L1",
      accountNo: "DEB01",
      type: "payment",
      amount: 100,
      date: "2026-06-10",
      reference: "LIVE",
      description: "live",
      source: "manual",
      createdAt: new Date(Date.parse(baselineAt) + 60_000).toISOString(),
    });
    snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL);
    ledger = readSchoolLedger(SCHOOL);
    const withLive = resolveAuthoritativeAccountBalanceFromSnapshot(
      snaps.DEB01,
      ledger.filter((e) => e.accountNo === "DEB01")
    );
    assert.ok(centsEqual(randToCents(withLive), 415000), "live payment after baseline reduces balance");
    console.log("  ✓ Case F — live post-baseline payment not lost / not double-counted vs opening");

    console.log("Phase 1H statement-authority tests: ALL PASSED");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
