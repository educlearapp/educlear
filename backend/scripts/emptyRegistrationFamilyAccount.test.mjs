/**
 * Runtime boot-gate tests for zero-learner educlear-registration shells.
 * Uses disposable copies of the verified recovery baseline. Never writes the baseline.
 *
 * Run: node --test scripts/emptyRegistrationFamilyAccount.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyRegistrationFamilyAccountBoot,
  flattenPaymentAllocationRows,
  rowsForAccount,
} from "./lib/emptyRegistrationFamilyAccount.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const RECOVERY_ROOT = "/Users/dasilvaacademy/EduClear-finance-json-recovery/2026-08-24T14-59-32Z";
const RECOVERY_JSON = path.join(RECOVERY_ROOT, "disk-json");
const INVENTORY = path.join(RECOVERY_ROOT, "SOURCE_INVENTORY.tsv");
const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readInventory() {
  const lines = fs.readFileSync(INVENTORY, "utf8").trim().split("\n").slice(1);
  return lines.map((line) => {
    const [filename, , , , , sha256] = line.split("\t");
    return { filename, sha256 };
  });
}

function assertRecoveryUnchanged() {
  for (const row of readInventory()) {
    const filePath = path.join(RECOVERY_JSON, row.filename);
    assert.equal(sha256File(filePath), row.sha256, `recovery hash drifted: ${row.filename}`);
  }
}

function emptySnapshot(accountRef, extras = {}) {
  return {
    schoolId: SCHOOL_ID,
    accountRef,
    accountHolder: "Test Holder",
    balance: 0,
    buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    source: "educlear-registration",
    importedAt: "2026-08-21T00:00:00.000Z",
    ...extras,
  };
}

function loadSchoolJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(RECOVERY_JSON, filename), "utf8"));
}

describe("synthetic boot-gate cases", () => {
  it("1. zero learners + R5000 live unexplained invoice => FAIL", () => {
    const decision = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: emptySnapshot("TST001"),
      ledgerEntries: [
        { type: "invoice", amount: 5000, accountNo: "TST001", date: "2026-08-01" },
      ],
    });
    assert.equal(decision.action, "fail");
    assert.match(decision.reason, /live-ledger/);
  });

  it("2. zero learners + live payment/credit inconsistency => FAIL", () => {
    const decision = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: emptySnapshot("TST002"),
      ledgerEntries: [
        { type: "payment", amount: 2500, accountNo: "TST002" },
        { type: "credit", amount: 2500, accountNo: "TST002" },
      ],
    });
    assert.equal(decision.action, "fail");
    assert.match(decision.reason, /live-ledger/);
  });

  it("3. zero learners + R0 shell + no ledger activity => WARN / boot allowed", () => {
    const decision = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: emptySnapshot("TST003"),
      ledgerEntries: [],
      paymentAllocations: [],
      deposits: [],
    });
    assert.equal(decision.action, "warn");
    assert.equal(decision.reason, "zero-balance-empty-shell");
  });

  it("4. explicitly retired/merged snapshot => boot allowed", () => {
    const decision = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: emptySnapshot("TST004", { mergedIntoAccountRef: "CAN001" }),
      ledgerEntries: [],
    });
    assert.equal(decision.action, "warn");
    assert.equal(decision.reason, "retired-or-merged-empty-shell");
  });

  it("5. healthy active family => PASS", () => {
    const decision = classifyRegistrationFamilyAccountBoot({
      learnerCount: 2,
      snapshot: { ...emptySnapshot("LEK003"), balance: 8100 },
      ledgerEntries: [{ type: "invoice", amount: 8100, accountNo: "LEK003" }],
    });
    assert.equal(decision.action, "pass");
    assert.equal(decision.reason, "has-learners");
  });

  it("zero learners + remaining deposit => FAIL", () => {
    const decision = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: emptySnapshot("TST005"),
      deposits: [{ remainingBalance: 1200, status: "ACTIVE" }],
    });
    assert.equal(decision.action, "fail");
    assert.equal(decision.reason, "live-deposits");
  });
});

describe("verified recovery baseline (read-only copy)", () => {
  it("classifies MOT683-style shell as WARN and does not rewrite money accounts", () => {
    assertRecoveryUnchanged();
    const age = loadSchoolJson("family-account-age-analysis.json")[SCHOOL_ID];
    const ledger = loadSchoolJson("billing-ledger.json")[SCHOOL_ID];
    const alloc = flattenPaymentAllocationRows(
      loadSchoolJson("payment-allocations.json")[SCHOOL_ID]
    );

    const mot683 = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: age.MOT683,
      ledgerEntries: rowsForAccount(ledger, "MOT683"),
      paymentAllocations: rowsForAccount(alloc, "MOT683", ["accountRef", "accountNo"]),
    });
    assert.equal(mot683.action, "warn", JSON.stringify(mot683));
    assert.equal(age.MOT683.balance, 0);
    assert.equal(age.MOT683.source, "educlear-registration");

    const mot682 = classifyRegistrationFamilyAccountBoot({
      learnerCount: 1,
      snapshot: age.MOT682,
      ledgerEntries: rowsForAccount(ledger, "MOT682"),
    });
    assert.equal(mot682.action, "pass");
    assert.equal(age.MOT682.balance, 0);

    const mor013 = classifyRegistrationFamilyAccountBoot({
      learnerCount: 1,
      snapshot: age.MOR013,
      ledgerEntries: rowsForAccount(ledger, "MOR013"),
    });
    assert.equal(mor013.action, "pass");
    assert.equal(age.MOR013.balance, 9700);

    const lekIfZeroLearners = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: age.LEK003,
      ledgerEntries: rowsForAccount(ledger, "LEK003"),
    });
    assert.equal(lekIfZeroLearners.action, "fail");
    assert.ok(rowsForAccount(ledger, "LEK003").length > 0);

    const mot684IfZeroLearners = classifyRegistrationFamilyAccountBoot({
      learnerCount: 0,
      snapshot: age.MOT684,
      ledgerEntries: rowsForAccount(ledger, "MOT684"),
    });
    assert.equal(mot684IfZeroLearners.action, "fail");
    const mot684InvoiceSum = rowsForAccount(ledger, "MOT684")
      .filter((row) => row.type === "invoice")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    assert.equal(mot684InvoiceSum, 14600);

    assertRecoveryUnchanged();
  });

  it("runtime-assets JSON gate against a disposable copy does not mutate recovery", () => {
    assertRecoveryUnchanged();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-assets-boot-"));
    const dataDir = path.join(tmp, "data");
    const logoDir = path.join(tmp, "uploads", "school-logos");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(logoDir, { recursive: true });
    for (const name of fs.readdirSync(RECOVERY_JSON)) {
      fs.copyFileSync(path.join(RECOVERY_JSON, name), path.join(dataDir, name));
    }
    const logoSrc = path.join(BACKEND_ROOT, "uploads", "school-logos", "da-silva-academy-logo.png");
    fs.copyFileSync(logoSrc, path.join(logoDir, "da-silva-academy-logo.png"));

    const env = {
      ...process.env,
      RUNTIME_ASSETS_BACKEND_ROOT: tmp,
      RENDER: "",
      VERIFY_AGE_ANALYSIS_DB_LINKS: "",
      SKIP_AGE_ANALYSIS_DB_VERIFY: "true",
    };
    const result = spawnSync(
      process.execPath,
      [path.join(BACKEND_ROOT, "scripts", "verify-runtime-assets.mjs")],
      { env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /All runtime asset checks complete/);

    const copyAge = JSON.parse(
      fs.readFileSync(path.join(dataDir, "family-account-age-analysis.json"), "utf8")
    )[SCHOOL_ID];
    assert.equal(copyAge.MOT683.balance, 0);
    assert.equal(copyAge.MOT682.balance, 0);
    assert.equal(copyAge.MOR013.balance, 9700);
    assert.ok(copyAge.LEK003);
    assert.ok(copyAge.MOT684);
    assert.equal(copyAge.MOR013.accountRef, "MOR013");
    assert.equal(copyAge.LEK003.accountRef, "LEK003");

    assertRecoveryUnchanged();
  });
});
