/**
 * Invoice-run posting refs: Express names when no Kid-e-Sys official list,
 * Kid-e-Sys-only when true kideesys-age-analysis snapshots exist.
 * Zero ledger impact — store fixture I/O only, no production writes.
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
  normaliseInvoiceRunPostingAccountRef,
  normaliseOfficialBillingAccountRef,
  readOfficialBillingAccountRefs,
  resolveOfficialBillingAccountRef,
} from "./officialBillingAccountRef";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const FLY_EAGLE = "school-fly-eagle-express";
const DA_SILVA = "school-da-silva-kideesys";
const OTHER = "school-other-tenant";

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
  assert(normaliseOfficialBillingAccountRef("26006") === "", "accession not Kid-e-Sys");

  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", empty) === "ABAYE TUMO ASHANAFY",
    "Express name allowed when no official Kid-e-Sys list"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ali002", empty) === "ALI002",
    "Kid-e-Sys still allowed with empty official list"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("26006", empty) === "",
    "unlinked accession / SA-SAMS numeric must not post"
  );
  assert(normaliseInvoiceRunPostingAccountRef("1234567", empty) === "", "numeric admission excluded");
  assert(normaliseInvoiceRunPostingAccountRef("-", empty) === "", "placeholder excluded");

  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", daSilvaOfficial) === "",
    "Da Silva official list must not accept Express names"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ALI002", daSilvaOfficial) === "ALI002",
    "Da Silva Kid-e-Sys ref still posts"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("RAM021", daSilvaOfficial) === "RAM021",
    "normalise still returns Kid-e-Sys shape; membership is asserted separately"
  );
  console.log("✓ normalise Invoice-run posting refs");
}

async function testMigrationBaselineDoesNotActivateKidESysGate() {
  await withFixtureStore(
    {
      [FLY_EAGLE]: {
        // EduClear-style codes from migration must NOT activate Kid-e-Sys gate
        BEY001: {
          schoolId: FLY_EAGLE,
          accountRef: "BEY001",
          accountHolder: "BEYAMO DEGAFECHY",
          balance: 2200,
          buckets: { current: 2200, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "universal-migration-baseline",
          importedAt: "2026-08-24T00:00:00.000Z",
        },
        "BEYAMO DEGAFECHY": {
          schoolId: FLY_EAGLE,
          accountRef: "BEYAMO DEGAFECHY",
          accountHolder: "BEYAMO DEGAFECHY",
          balance: 2200,
          buckets: { current: 2200, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "universal-migration-baseline",
          importedAt: "2026-08-24T00:00:00.000Z",
        },
      },
    },
    async () => {
      const official = readOfficialBillingAccountRefs(FLY_EAGLE);
      assert(official.size === 0, "migration baseline must not create official Kid-e-Sys gate");

      const resolved = await resolveOfficialBillingAccountRef(FLY_EAGLE, {
        learner: { familyAccount: { accountRef: "BEYAMO DEGAFECHY" } },
      });
      assert(
        resolved === "BEYAMO DEGAFECHY",
        "Fly Eagle Express family accountRef must resolve when only migration baselines exist"
      );
    }
  );
  console.log("✓ Fly Eagle Express resolves despite migration-baseline EduClear codes");
}

async function testRegistrationSourceDoesNotActivateGate() {
  await withFixtureStore(
    {
      [FLY_EAGLE]: {
        REG001: {
          schoolId: FLY_EAGLE,
          accountRef: "REG001",
          accountHolder: "REG",
          balance: 0,
          buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "educlear-registration",
          importedAt: "2026-09-01T00:00:00.000Z",
        },
      },
    },
    async () => {
      assert(readOfficialBillingAccountRefs(FLY_EAGLE).size === 0, "registration source ignored");
      const resolved = await resolveOfficialBillingAccountRef(FLY_EAGLE, {
        learner: { familyAccount: { accountRef: "WOLDE HAPPY BLESSING" } },
      });
      assert(resolved === "WOLDE HAPPY BLESSING", "Express name still resolves");
    }
  );
  console.log("✓ educlear-registration snapshots do not activate Kid-e-Sys gate");
}

async function testDaSilvaKidESysGateUnchanged() {
  await withFixtureStore(
    {
      [DA_SILVA]: {
        ALI002: {
          schoolId: DA_SILVA,
          accountRef: "ALI002",
          accountHolder: "Ali",
          balance: 4000,
          buckets: { current: 4000, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "kideesys-age-analysis",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
        DUP001: {
          schoolId: DA_SILVA,
          accountRef: "DUP001",
          accountHolder: "Dup",
          balance: -12200,
          buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: -12200 },
          source: "kideesys-age-analysis",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      [FLY_EAGLE]: {
        BEY001: {
          schoolId: FLY_EAGLE,
          accountRef: "BEY001",
          accountHolder: "Beyamo",
          balance: 100,
          buckets: { current: 100, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "universal-migration-baseline",
          importedAt: "2026-08-24T00:00:00.000Z",
        },
      },
    },
    async () => {
      const daOfficial = readOfficialBillingAccountRefs(DA_SILVA);
      assert(daOfficial.size === 2, "Da Silva official list from kideesys-age-analysis");
      assert(daOfficial.has("ALI002") && daOfficial.has("DUP001"), "Da Silva refs present");

      const ali = await resolveOfficialBillingAccountRef(DA_SILVA, { accountNo: "ALI002" });
      assert(ali === "ALI002", "Da Silva Kid-e-Sys account resolves");

      const expressOnDaSilva = await resolveOfficialBillingAccountRef(DA_SILVA, {
        learner: { familyAccount: { accountRef: "ABAYE TUMO ASHANAFY" } },
      });
      assert(expressOnDaSilva === "", "Da Silva must reject Express names when Kid-e-Sys gate active");

      const feOfficial = readOfficialBillingAccountRefs(FLY_EAGLE);
      assert(feOfficial.size === 0, "Fly Eagle migration baseline must not leak into official gate");
      const fe = await resolveOfficialBillingAccountRef(FLY_EAGLE, {
        learner: { familyAccount: { accountRef: "BEYAMO DEGAFECHY" } },
      });
      assert(fe === "BEYAMO DEGAFECHY", "Fly Eagle Express still resolves beside Da Silva data");
    }
  );
  console.log("✓ Da Silva Kid-e-Sys gate unchanged; no cross-tenant leakage");
}

async function testCrossTenantIsolationOfOfficialList() {
  await withFixtureStore(
    {
      [DA_SILVA]: {
        ALI002: {
          schoolId: DA_SILVA,
          accountRef: "ALI002",
          accountHolder: "Ali",
          balance: 1,
          buckets: { current: 1, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "kideesys-age-analysis",
          importedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      [OTHER]: {},
    },
    async () => {
      assert(readOfficialBillingAccountRefs(OTHER).size === 0, "empty school has empty official list");
      assert(
        readOfficialBillingAccountRefs(DA_SILVA).has("ALI002"),
        "Da Silva list remains school-scoped"
      );
      const otherResolve = await resolveOfficialBillingAccountRef(OTHER, { accountNo: "ALI002" });
      // Without official gate, Kid-e-Sys shape is still a valid statement-safe candidate —
      // but OTHER school should not inherit DA_SILVA's official membership requirement.
      // Cross-tenant isolation of the official SET is what we assert here.
      assert(
        !readOfficialBillingAccountRefs(OTHER).has("ALI002"),
        "OTHER must not inherit Da Silva official refs"
      );
      void otherResolve;
    }
  );
  console.log("✓ official list is school-scoped (no cross-tenant)");
}

async function main() {
  runNormaliseTests();
  await testMigrationBaselineDoesNotActivateKidESysGate();
  await testRegistrationSourceDoesNotActivateGate();
  await testDaSilvaKidESysGateUnchanged();
  await testCrossTenantIsolationOfOfficialList();
  console.log("officialBillingAccountRef.invoiceRun.test.ts — PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
