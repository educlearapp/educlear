/**
 * Billing ledger in-process cache invalidation tests (isolated fixture dir).
 * Run: npx tsx src/utils/billingLedgerStore.cache.test.ts
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import {
  invalidateBillingLedgerFileCache,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "./billingLedgerStore";

const TEST_SCHOOL = "test-school-ledger-cache";
const PRODUCTION_LEDGER = path.join(process.cwd(), "data", "billing-ledger.json");
const PRODUCTION_ALLOCATIONS = path.join(process.cwd(), "data", "payment-allocations.json");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function entry(id: string): BillingLedgerEntry {
  return {
    id,
    schoolId: TEST_SCHOOL,
    learnerId: "learner-1",
    accountNo: "ACC001",
    type: "invoice",
    amount: 100,
    date: "2027-01-01",
    reference: id,
    description: "Test",
    createdAt: "2027-01-01T00:00:00.000Z",
  };
}

function withIsolatedLedgerFixture(fn: (ledgerFile: string) => void) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-ledger-cache-test-"));
  const ledgerFile = path.join(tempDir, "billing-ledger.json");
  setBillingLedgerStoreDataDirForTests(tempDir);
  invalidateBillingLedgerFileCache();
  try {
    fn(ledgerFile);
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    invalidateBillingLedgerFileCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readFixtureLedgerFile(ledgerFile: string): Record<string, BillingLedgerEntry[]> {
  if (!fs.existsSync(ledgerFile)) return {};
  return JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
}

function writeFixtureLedgerFile(
  ledgerFile: string,
  data: Record<string, BillingLedgerEntry[]>
) {
  const tmp = `${ledgerFile}.${process.pid}.cache-test.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, ledgerFile);
  const bumped = new Date(Date.now() + 1000);
  fs.utimesSync(ledgerFile, bumped, bumped);
}

function testWriteAllInvalidatesImmediately() {
  withIsolatedLedgerFixture(() => {
    writeSchoolLedger(TEST_SCHOOL, [entry("a1")]);
    const firstCount = readSchoolLedger(TEST_SCHOOL).length;
    writeSchoolLedger(TEST_SCHOOL, [entry("a1"), entry("a2")]);
    const secondCount = readSchoolLedger(TEST_SCHOOL).length;
    assert(firstCount === 1, "first write count");
    assert(secondCount === 2, "writeAll should invalidate and show new rows immediately");
  });
}

function testExternalReplacementDetectedByMtime() {
  withIsolatedLedgerFixture((ledgerFile) => {
    writeSchoolLedger(TEST_SCHOOL, [entry("a1")]);
    assert(readSchoolLedger(TEST_SCHOOL).length === 1, "seed one row");

    const current = readFixtureLedgerFile(ledgerFile);
    current[TEST_SCHOOL] = [entry("a1"), entry("external-1"), entry("external-2")];
    writeFixtureLedgerFile(ledgerFile, current);

    invalidateBillingLedgerFileCache();
    const rows = readSchoolLedger(TEST_SCHOOL);
    assert(rows.length === 3, "external atomic replacement should be visible after cache bust");
  });
}

function testExternalReplacementDetectedWithoutManualInvalidate() {
  withIsolatedLedgerFixture((ledgerFile) => {
    writeSchoolLedger(TEST_SCHOOL, [entry("a1")]);
    readSchoolLedger(TEST_SCHOOL);

    const current = readFixtureLedgerFile(ledgerFile);
    current[TEST_SCHOOL] = [entry("a1"), entry("external-no-invalidate")];
    writeFixtureLedgerFile(ledgerFile, current);

    const rows = readSchoolLedger(TEST_SCHOOL);
    assert(rows.length === 2, "mtime change alone should invalidate parsed cache");
  });
}

function testSameSizeWriteDetectedThroughMtime() {
  withIsolatedLedgerFixture((ledgerFile) => {
    writeSchoolLedger(TEST_SCHOOL, [entry("before")]);
    const beforeStat = fs.statSync(ledgerFile);

    const current = readFixtureLedgerFile(ledgerFile);
    current[TEST_SCHOOL] = [entry("after-same-size")];
    writeFixtureLedgerFile(ledgerFile, current);

    assert(
      fs.statSync(ledgerFile).mtimeMs > beforeStat.mtimeMs,
      "mtime should advance on replace"
    );
    invalidateBillingLedgerFileCache();
    const row = readSchoolLedger(TEST_SCHOOL)[0];
    assert(row?.id === "after-same-size", "same-size replacement should still be detected");
  });
}

function testMidTestFailureStillLeavesProductionUntouched(
  productionLedgerHashBefore: string,
  productionAllocationsHashBefore: string
) {
  try {
    withIsolatedLedgerFixture(() => {
      writeSchoolLedger(TEST_SCHOOL, [entry("throw-me")]);
      throw new Error("DELIBERATE_CACHE_TEST_FAILURE");
    });
  } catch (error) {
    assert(
      error instanceof Error && error.message === "DELIBERATE_CACHE_TEST_FAILURE",
      "expected deliberate failure"
    );
  }

  assert(
    sha256File(PRODUCTION_LEDGER) === productionLedgerHashBefore,
    "production ledger unchanged after deliberate mid-test failure"
  );
  assert(
    sha256File(PRODUCTION_ALLOCATIONS) === productionAllocationsHashBefore,
    "payment allocations unchanged after deliberate mid-test failure"
  );
}

function main() {
  const productionLedgerHashBefore = sha256File(PRODUCTION_LEDGER);
  const productionAllocationsHashBefore = sha256File(PRODUCTION_ALLOCATIONS);

  testWriteAllInvalidatesImmediately();
  testExternalReplacementDetectedByMtime();
  testExternalReplacementDetectedWithoutManualInvalidate();
  testSameSizeWriteDetectedThroughMtime();
  testMidTestFailureStillLeavesProductionUntouched(
    productionLedgerHashBefore,
    productionAllocationsHashBefore
  );

  assert(
    sha256File(PRODUCTION_LEDGER) === productionLedgerHashBefore,
    "production ledger hash must match pre-test baseline"
  );
  assert(
    sha256File(PRODUCTION_ALLOCATIONS) === productionAllocationsHashBefore,
    "payment allocations hash must match pre-test baseline"
  );

  console.log("billingLedgerStore.cache.test.ts — PASS");
  console.log("production ledger sha256 unchanged:", productionLedgerHashBefore.slice(0, 16));
}

main();
