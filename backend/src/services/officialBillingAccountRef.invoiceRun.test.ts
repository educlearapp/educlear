/**
 * Invoice-run posting refs — source-gated Kid-e-Sys official list.
 * Zero ledger / account-data impact (fixture I/O only).
 *
 * Run: npx tsx src/services/officialBillingAccountRef.invoiceRun.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
  invalidateFamilyAccountAgeAnalysisFileCache,
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
} from "../utils/familyAccountAgeAnalysisStore";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import { buildInvoiceRunPlanForTest } from "./invoiceRunExecuteService";
import {
  invalidateOfficialBillingAccountRefsCache,
  KIDEESYS_AGE_ANALYSIS_SOURCE,
  normaliseInvoiceRunPostingAccountRef,
  normaliseOfficialBillingAccountRef,
  readOfficialBillingAccountRefs,
  resolveOfficialBillingAccountRef,
} from "./officialBillingAccountRef";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MAGICAL = "cmq4xjckq00at60gqg4eb956h";

function snap(schoolId: string, accountRef: string, source: string, balance = 0) {
  return {
    schoolId,
    accountRef,
    accountHolder: accountRef,
    balance,
    buckets: { current: balance, d30: 0, d60: 0, d90: 0, d120: 0 },
    source,
    importedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function withFixtureStore(
  snapshotsBySchool: Record<string, Record<string, unknown>>,
  fn: () => void | Promise<void>
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-ref-src-"));
  try {
    fs.writeFileSync(
      path.join(dir, "family-account-age-analysis.json"),
      JSON.stringify(snapshotsBySchool, null, 2),
      "utf8"
    );
    setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache();
    await fn();
  } finally {
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runNormaliseTests() {
  const empty = new Set<string>();
  const daSilvaOfficial = new Set(["ALI002", "DUP001"]);
  assert(KIDEESYS_AGE_ANALYSIS_SOURCE === "kideesys-age-analysis", "source constant");
  assert(normaliseOfficialBillingAccountRef("ALI002") === "ALI002", "Kid-e-Sys kept");
  assert(normaliseOfficialBillingAccountRef("ABAYE TUMO ASHANAFY") === "", "Express not Kid-e-Sys");
  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", empty) === "ABAYE TUMO ASHANAFY",
    "Express allowed when gate empty"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", daSilvaOfficial) === "",
    "Express rejected when Kid-e-Sys gate active"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ALI002", daSilvaOfficial) === "ALI002",
    "Kid-e-Sys posts under gate"
  );
  console.log("✓ normalise helpers");
}

async function testFlyEagleExpressResolves() {
  await withFixtureStore(
    {
      [FLY_EAGLE]: {
        BEY001: snap(FLY_EAGLE, "BEY001", "universal-migration-baseline", 2200),
        "BEYAMO DEGAFECHY": snap(
          FLY_EAGLE,
          "BEYAMO DEGAFECHY",
          "universal-migration-baseline",
          2200
        ),
        REG001: snap(FLY_EAGLE, "REG001", "educlear-registration", 0),
      },
    },
    async () => {
      assert(readOfficialBillingAccountRefs(FLY_EAGLE).size === 0, "no kideesys source → no gate");
      const resolved = await resolveOfficialBillingAccountRef(FLY_EAGLE, {
        learner: { familyAccount: { accountRef: "BEYAMO DEGAFECHY" } },
      });
      assert(resolved === "BEYAMO DEGAFECHY", "Fly Eagle Express account resolves");
    }
  );
  console.log("✓ Fly Eagle Express account resolves");
}

async function testDaSilvaValidAndInvalidUnchanged() {
  await withFixtureStore(
    {
      [DA_SILVA]: {
        ALI002: snap(DA_SILVA, "ALI002", KIDEESYS_AGE_ANALYSIS_SOURCE, 4000),
        DUP001: snap(DA_SILVA, "DUP001", KIDEESYS_AGE_ANALYSIS_SOURCE, -12200),
        // Migration noise must not dilute / replace the genuine gate membership set
        XTRA99: snap(DA_SILVA, "XTRA99", "universal-migration-baseline", 1),
      },
    },
    async () => {
      const official = readOfficialBillingAccountRefs(DA_SILVA);
      assert(official.size === 2, "Da Silva gate = kideesys sources only (2)");
      assert(official.has("ALI002") && official.has("DUP001"), "Da Silva official members");
      assert(!official.has("XTRA99"), "migration baseline key excluded from gate");

      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, { accountNo: "ALI002" })) === "ALI002",
        "Da Silva valid Kid-e-Sys still resolves"
      );
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, { accountNo: "NOTONLIST" })) === "",
        "Da Silva invalid/non-official still rejects"
      );
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, {
          learner: { familyAccount: { accountRef: "ABAYE TUMO ASHANAFY" } },
        })) === "",
        "Da Silva Express name still rejects under gate"
      );
    }
  );
  console.log("✓ Da Silva valid/invalid Kid-e-Sys unchanged");
}

async function testMagicalResolverUnchanged() {
  // Magical with genuine Kid-e-Sys import — gate identical to historical behaviour
  await withFixtureStore(
    {
      [MAGICAL]: {
        MBB001: snap(MAGICAL, "MBB001", KIDEESYS_AGE_ANALYSIS_SOURCE, 100),
        MBB012: snap(MAGICAL, "MBB012", KIDEESYS_AGE_ANALYSIS_SOURCE, 50),
      },
    },
    async () => {
      const official = readOfficialBillingAccountRefs(MAGICAL);
      assert(official.size === 2, "Magical kideesys gate size unchanged");
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, { accountNo: "MBB001" })) === "MBB001",
        "Magical valid account still resolves"
      );
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, { accountNo: "MBB999" })) === "",
        "Magical non-official still rejects"
      );
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, {
          learner: { familyAccount: { accountRef: "SOME EXPRESS NAME" } },
        })) === "",
        "Magical Express name still rejects when kideesys gate active"
      );
    }
  );

  // Magical with empty snapshots — statement-safe path (historical when no official list)
  await withFixtureStore({ [MAGICAL]: {} }, async () => {
    assert(readOfficialBillingAccountRefs(MAGICAL).size === 0, "empty Magical → no gate");
    assert(
      (await resolveOfficialBillingAccountRef(MAGICAL, {
        learner: { familyAccount: { accountRef: "MBB001" } },
      })) === "MBB001",
      "Magical empty-gate statement-safe resolve unchanged"
    );
  });
  console.log("✓ Magical existing resolver behavior unchanged");
}

async function testCrossTenantUnchanged() {
  await withFixtureStore(
    {
      [DA_SILVA]: { ALI002: snap(DA_SILVA, "ALI002", KIDEESYS_AGE_ANALYSIS_SOURCE, 1) },
      [MAGICAL]: { MBB001: snap(MAGICAL, "MBB001", KIDEESYS_AGE_ANALYSIS_SOURCE, 1) },
      [FLY_EAGLE]: {
        BEY001: snap(FLY_EAGLE, "BEY001", "universal-migration-baseline", 1),
      },
    },
    async () => {
      assert(!readOfficialBillingAccountRefs(MAGICAL).has("ALI002"), "no Da Silva on Magical");
      assert(!readOfficialBillingAccountRefs(DA_SILVA).has("MBB001"), "no Magical on Da Silva");
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, { accountNo: "ALI002" })) === "",
        "cross-tenant Da Silva code on Magical rejected"
      );
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, { accountNo: "MBB001" })) === "",
        "cross-tenant Magical code on Da Silva rejected"
      );
    }
  );
  console.log("✓ cross-tenant protection unchanged");
}

function testDuplicateInvoiceUnchanged() {
  const linked = {
    id: "fe-dup",
    firstName: "Happy",
    lastName: "Wolde",
    enrollmentStatus: "ACTIVE",
    admissionNo: null as string | null,
    idNumber: null as string | null,
    familyAccountId: "fa-wolde",
    familyAccount: { accountRef: "WOLDE HAPPY BLESSING" },
  };
  const existing: BillingLedgerEntry[] = [
    {
      id: "fe-inv-july",
      schoolId: FLY_EAGLE,
      learnerId: "fe-dup",
      accountNo: "WOLDE HAPPY BLESSING",
      type: "invoice",
      amount: 1400,
      date: "2026-07-15",
      reference: "0220534",
      description: "Express invoice",
      createdAt: "2026-08-24T22:45:16.463Z",
      source: "universal_migration_phase14",
    },
  ];
  const july = buildInvoiceRunPlanForTest({
    allActiveLearners: [linked],
    processedLearners: [linked],
    plansByLearnerId: { "fe-dup": [{ feeDescription: "Fees", amount: 1400 }] },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-dup": "WOLDE HAPPY BLESSING" },
    existingLedger: existing,
    invoicePeriod: "2026-07",
  });
  assert(july.learnerRows[0]?.skipReason === "DUPLICATE_INVOICE", "duplicate still blocked");
  console.log("✓ duplicate-invoice protection unchanged");
}

async function main() {
  runNormaliseTests();
  await testFlyEagleExpressResolves();
  await testDaSilvaValidAndInvalidUnchanged();
  await testMagicalResolverUnchanged();
  await testCrossTenantUnchanged();
  testDuplicateInvoiceUnchanged();
  console.log("officialBillingAccountRef.invoiceRun.test.ts — PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
