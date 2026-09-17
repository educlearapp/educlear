/**
 * Invoice-run posting refs — school-scoped Express exemption + Da Silva/Magical gate.
 * Zero ledger impact — fixture I/O only.
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
import {
  invalidateOfficialBillingAccountRefsCache,
  isExpressInvoiceBillingSchool,
  normaliseInvoiceRunPostingAccountRef,
  normaliseOfficialBillingAccountRef,
  readOfficialBillingAccountRefs,
  resolveOfficialBillingAccountRef,
} from "./officialBillingAccountRef";
import { buildInvoiceRunPlanForTest } from "./invoiceRunExecuteService";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MAGICAL = "cmq4xjckq00at60gqg4eb956h";
const OTHER = "school-other-tenant";

function snap(
  schoolId: string,
  accountRef: string,
  source: string,
  balance = 0
) {
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-ref-"));
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

  assert(normaliseOfficialBillingAccountRef("ALI002") === "ALI002", "Kid-e-Sys kept");
  assert(normaliseOfficialBillingAccountRef("ABAYE TUMO ASHANAFY") === "", "Express not Kid-e-Sys");
  assert(isExpressInvoiceBillingSchool(FLY_EAGLE), "Fly Eagle is Express school");
  assert(!isExpressInvoiceBillingSchool(DA_SILVA), "Da Silva is not Express school");
  assert(!isExpressInvoiceBillingSchool(MAGICAL), "Magical is not Express school");

  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", empty) === "ABAYE TUMO ASHANAFY",
    "Express name allowed when no official Kid-e-Sys list"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", daSilvaOfficial) === "",
    "Da Silva official list must not accept Express names"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ALI002", daSilvaOfficial) === "ALI002",
    "Da Silva Kid-e-Sys ref still posts"
  );
  console.log("✓ normalise + school classification");
}

async function testFlyEagleExpressEligibleDespiteMigrationCodes() {
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
        // Even if wrongly tagged kideesys, Express school must not gate
        WRONG001: snap(FLY_EAGLE, "WRONG001", "kideesys-age-analysis", 1),
      },
    },
    async () => {
      assert(readOfficialBillingAccountRefs(FLY_EAGLE).size === 0, "Fly Eagle official gate off");
      const resolved = await resolveOfficialBillingAccountRef(FLY_EAGLE, {
        learner: { familyAccount: { accountRef: "BEYAMO DEGAFECHY" } },
      });
      assert(resolved === "BEYAMO DEGAFECHY", "Fly Eagle Express account → resolves");
    }
  );
  console.log("✓ Fly Eagle Express account → eligible resolution");
}

async function testDaSilvaValidAndInvalidUnchanged() {
  await withFixtureStore(
    {
      [DA_SILVA]: {
        ALI002: snap(DA_SILVA, "ALI002", "kideesys-age-analysis", 4000),
        DUP001: snap(DA_SILVA, "DUP001", "kideesys-age-analysis", -12200),
      },
    },
    async () => {
      const official = readOfficialBillingAccountRefs(DA_SILVA);
      assert(official.size === 2, "Da Silva official size 2");
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, { accountNo: "ALI002" })) === "ALI002",
        "Da Silva valid Kid-e-Sys → same resolve"
      );
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, {
          learner: { familyAccount: { accountRef: "NOTONLIST99" } },
        })) === "",
        "Da Silva invalid/non-official → rejected"
      );
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, {
          learner: { familyAccount: { accountRef: "ABAYE TUMO ASHANAFY" } },
        })) === "",
        "Da Silva Express name → rejected"
      );
    }
  );
  console.log("✓ Da Silva valid/invalid Kid-e-Sys unchanged");
}

async function testMagicalValidAndInvalidUnchanged() {
  await withFixtureStore(
    {
      [MAGICAL]: {
        MBB001: snap(MAGICAL, "MBB001", "kideesys-age-analysis", 100),
        MBB012: snap(MAGICAL, "MBB012", "universal-migration-baseline", 50),
      },
    },
    async () => {
      // Pre-fix behaviour: ANY Kid-e-Sys-shaped key activates gate (source-agnostic).
      const official = readOfficialBillingAccountRefs(MAGICAL);
      assert(official.size === 2, "Magical gate includes both Kid-e-Sys-shaped keys");
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, { accountNo: "MBB001" })) === "MBB001",
        "Magical valid account → resolves"
      );
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, { accountNo: "MBB999" })) === "",
        "Magical invalid/non-official → rejected"
      );
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, {
          learner: { familyAccount: { accountRef: "SOME EXPRESS NAME" } },
        })) === "",
        "Magical Express name → rejected when gate active"
      );
    }
  );

  // Empty Magical snapshots → empty gate (pre-fix identical)
  await withFixtureStore({ [MAGICAL]: {} }, async () => {
    assert(readOfficialBillingAccountRefs(MAGICAL).size === 0, "empty Magical → no gate");
    assert(
      (await resolveOfficialBillingAccountRef(MAGICAL, {
        learner: { familyAccount: { accountRef: "MBB001" } },
      })) === "MBB001",
      "Magical without snapshots still accepts Kid-e-Sys-shaped family ref"
    );
  });
  console.log("✓ Magical valid/invalid unchanged vs pre-fix gate rules");
}

async function testCrossSchoolStillBlocked() {
  await withFixtureStore(
    {
      [DA_SILVA]: { ALI002: snap(DA_SILVA, "ALI002", "kideesys-age-analysis", 1) },
      [MAGICAL]: { MBB001: snap(MAGICAL, "MBB001", "kideesys-age-analysis", 1) },
      [FLY_EAGLE]: { BEY001: snap(FLY_EAGLE, "BEY001", "universal-migration-baseline", 1) },
      [OTHER]: {},
    },
    async () => {
      assert(!readOfficialBillingAccountRefs(MAGICAL).has("ALI002"), "Magical lacks Da Silva refs");
      assert(!readOfficialBillingAccountRefs(DA_SILVA).has("MBB001"), "Da Silva lacks Magical refs");
      assert(!readOfficialBillingAccountRefs(FLY_EAGLE).has("ALI002"), "Fly Eagle gate empty");
      assert(
        (await resolveOfficialBillingAccountRef(MAGICAL, { accountNo: "ALI002" })) === "",
        "cross-school Da Silva code on Magical rejected"
      );
      assert(
        (await resolveOfficialBillingAccountRef(DA_SILVA, { accountNo: "MBB001" })) === "",
        "cross-school Magical code on Da Silva rejected"
      );
    }
  );
  console.log("✓ cross-school account resolution still blocked");
}

function testDuplicateInvoiceStillBlocked() {
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
    plansByLearnerId: {
      "fe-dup": [{ feeDescription: "Fees", amount: 1400 }],
    },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { "fe-dup": "WOLDE HAPPY BLESSING" },
    existingLedger: existing,
    invoicePeriod: "2026-07",
  });
  assert(
    july.learnerRows[0]?.skipReason === "DUPLICATE_INVOICE",
    "Existing duplicate invoice → still blocked"
  );
  console.log("✓ duplicate invoice still blocked");
}

async function main() {
  runNormaliseTests();
  await testFlyEagleExpressEligibleDespiteMigrationCodes();
  await testDaSilvaValidAndInvalidUnchanged();
  await testMagicalValidAndInvalidUnchanged();
  await testCrossSchoolStillBlocked();
  testDuplicateInvoiceStillBlocked();
  console.log("officialBillingAccountRef.invoiceRun.test.ts — PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
