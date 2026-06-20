/**
 * Seed isolated billing fixture for EduClear Demo School only.
 * Does NOT read, copy, or modify Da Silva billing JSON.
 *
 * Dry-run (default):
 *   npx tsx scripts/seed-demo-school-billing-fixture.ts
 *
 * Apply (local disk or Render shell — must run where backend data/ lives):
 *   CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE=true \
 *     npx tsx scripts/seed-demo-school-billing-fixture.ts --apply
 *
 * Render production shell:
 *   cd backend
 *   CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE=true \
 *     npx tsx scripts/seed-demo-school-billing-fixture.ts --apply
 */
import "dotenv/config";

import fs from "fs";
import path from "path";
import { createHash } from "crypto";

import { prisma } from "../src/prisma";
import { DA_SILVA_BILLING_DATA_SCHOOL_ID } from "../src/services/daSilvaSchoolResolve";
import { refreshAgeAnalysisBaseline } from "../src/services/migrationCentre/ageAnalysisBaselineRefreshService";
import { writeSchoolLedger } from "../src/utils/billingLedgerStore";

const CONFIRM_ENV = "CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE";
const APPLY = process.argv.includes("--apply");
const FIXTURE_FILE = path.join(process.cwd(), "fixtures", "demo-school-billing-fixture.json");
const DA_SILVA = DA_SILVA_BILLING_DATA_SCHOOL_ID;

type FixtureLearner = {
  firstName: string;
  lastName: string;
  admissionNo: string;
  grade: string;
};

type FixtureAccount = {
  accountRef: string;
  accountHolder: string;
  balance: number;
  kidesysSection: string;
  buckets?: Record<string, number>;
  learner: FixtureLearner;
};

type FixtureFile = {
  schoolId: string;
  schoolName: string;
  importedAt: string;
  accounts: FixtureAccount[];
  ledger: unknown[];
};

function loadFixture(): FixtureFile {
  if (!fs.existsSync(FIXTURE_FILE)) {
    throw new Error(`Missing fixture file: ${FIXTURE_FILE}`);
  }
  const parsed = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")) as FixtureFile;
  if (!parsed.schoolId || !Array.isArray(parsed.accounts) || !parsed.accounts.length) {
    throw new Error("Invalid demo-school-billing-fixture.json");
  }
  return parsed;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function bucketFingerprint(data: Record<string, unknown>, schoolId: string): string {
  return createHash("sha256").update(JSON.stringify(data[schoolId] ?? null)).digest("hex");
}

function snapshotDaSilvaJson(): {
  ledgerFp: string;
  ageFp: string;
  ledgerCount: number;
  ageCount: number;
} {
  const dataDir = path.join(process.cwd(), "data");
  const ledgerAll = readJsonFile(path.join(dataDir, "billing-ledger.json"));
  const ageAll = readJsonFile(path.join(dataDir, "family-account-age-analysis.json"));
  const ledgerEntries = Array.isArray(ledgerAll[DA_SILVA]) ? ledgerAll[DA_SILVA] : [];
  const ageSchool =
    ageAll[DA_SILVA] && typeof ageAll[DA_SILVA] === "object"
      ? (ageAll[DA_SILVA] as Record<string, unknown>)
      : {};
  return {
    ledgerFp: bucketFingerprint(ledgerAll, DA_SILVA),
    ageFp: bucketFingerprint(ageAll, DA_SILVA),
    ledgerCount: ledgerEntries.length,
    ageCount: Object.keys(ageSchool).length,
  };
}

function assertDaSilvaUntouched(
  before: ReturnType<typeof snapshotDaSilvaJson>,
  label: string
): void {
  const after = snapshotDaSilvaJson();
  if (after.ledgerFp !== before.ledgerFp || after.ageFp !== before.ageFp) {
    throw new Error(
      `[FAIL] Da Silva JSON changed after ${label} (ledger ${before.ledgerCount}→${after.ledgerCount}, age ${before.ageCount}→${after.ageCount})`
    );
  }
  console.log(
    `[PASS] Da Silva JSON untouched (${after.ledgerCount} ledger rows, ${after.ageCount} age-analysis accounts)`
  );
}

async function upsertDemoLearners(
  schoolId: string,
  accounts: FixtureAccount[]
): Promise<number> {
  let upserted = 0;
  for (const account of accounts) {
    const accountRef = String(account.accountRef || "").trim().toUpperCase();
    const family = await prisma.familyAccount.findFirst({
      where: { schoolId, accountRef },
      select: { id: true, schoolId: true },
    });
    if (!family || family.schoolId !== schoolId) {
      throw new Error(`FamilyAccount missing for ${accountRef} on demo school`);
    }

    const admissionNo = String(account.learner.admissionNo || "").trim();
    const existing = admissionNo
      ? await prisma.learner.findFirst({
          where: { schoolId, admissionNo },
          select: { id: true },
        })
      : null;

    const learnerData = {
      schoolId,
      familyAccountId: family.id,
      firstName: String(account.learner.firstName || "TEST").trim(),
      lastName: String(account.learner.lastName || "").trim(),
      admissionNo,
      grade: String(account.learner.grade || "1").trim(),
      enrollmentStatus: "ACTIVE" as const,
    };

    if (existing) {
      await prisma.learner.update({
        where: { id: existing.id },
        data: learnerData,
      });
    } else {
      await prisma.learner.create({ data: learnerData });
    }
    upserted += 1;
  }
  return upserted;
}

async function main(): Promise<void> {
  const fixture = loadFixture();
  const schoolId = fixture.schoolId;

  if (schoolId === DA_SILVA) {
    throw new Error("Refusing to seed Da Silva canonical school id");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) {
    throw new Error(`School not found: ${schoolId}`);
  }

  console.log(`\n=== Demo school billing fixture (${APPLY ? "APPLY" : "dry-run"}) ===`);
  console.log(`School: ${school.name} (${school.id})`);
  console.log(`Fixture accounts: ${fixture.accounts.map((a) => a.accountRef).join(", ")}`);
  console.log(`Ledger entries: ${Array.isArray(fixture.ledger) ? fixture.ledger.length : 0}`);

  const before = snapshotDaSilvaJson();
  console.log(
    `[INFO] Da Silva before: ledger=${before.ledgerCount}, age-analysis=${before.ageCount}`
  );

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply and CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE=true");
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    throw new Error(`Refusing --apply without ${CONFIRM_ENV}=true`);
  }

  const baseline = await refreshAgeAnalysisBaseline({
    schoolId,
    importedAt: fixture.importedAt,
    snapshots: fixture.accounts.map((account) => ({
      accountRef: account.accountRef,
      accountHolder: account.accountHolder,
      kidesysSection: account.kidesysSection,
      balance: account.balance,
      buckets: account.buckets,
    })),
  });

  writeSchoolLedger(schoolId, []);
  const learnersUpserted = await upsertDemoLearners(schoolId, fixture.accounts);

  assertDaSilvaUntouched(before, "demo fixture seed");

  console.log("\n[OK] Demo school billing fixture applied.");
  console.log(`  age-analysis snapshots: ${baseline.snapshotCount}`);
  console.log(`  family accounts: ${baseline.familyAccountsUpserted}`);
  console.log(`  learners upserted: ${learnersUpserted}`);
  console.log(`  demo ledger entries: 0`);
  console.log("\nNext: npx tsx scripts/verify-demo-school-billing-fixture.ts --api\n");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
