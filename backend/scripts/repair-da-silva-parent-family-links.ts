/**
 * Repair Da Silva learner ↔ family account ↔ parent ↔ parent-learner links
 * without re-running phase 1/2 or touching billing ledger / plans / history.
 *
 * Usage:
 *   KIDESYS_ROOT=/path/to/kideesys-export npx tsc
 *   node dist/scripts/repair-da-silva-parent-family-links.js              # dry-run (default)
 *   node dist/scripts/repair-da-silva-parent-family-links.js --apply
 *   node dist/scripts/repair-da-silva-parent-family-links.js [schoolId] [--apply]
 *
 * Or with tsx:
 *   npx tsx scripts/repair-da-silva-parent-family-links.ts [--apply]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import {
  buildDaSilvaParentsStagedLearners,
  DA_SILVA_EXPECTED_LEARNER_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
  type DaSilvaKideesysParentsIngestPaths,
  type DaSilvaStagedLearner,
} from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { normalizeSaPhone } from "../src/services/parentPortalService";
import { readSchoolBillingPlans } from "../src/utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv
  .slice(2)
  .find((a) => a !== "--apply" && !a.startsWith("-") && !a.includes("/") && !a.includes(path.sep));

type SnapshotCounts = {
  learnersTotal: number;
  learnersWithFamilyAccountId: number;
  familyAccounts: number;
  parents: number;
  parentLearnerLinks: number;
  unmatchedLearners: number;
  unmatchedParents: number;
  ledgerEntries: number;
  billingPlans: number;
};

type UnmatchedLearner = {
  matchKey: string;
  fullName: string;
  className: string;
  canonicalClassName: string;
  accountNo: string;
};

type UnmatchedParentLink = {
  matchKey: string;
  learnerFullName: string;
  parentName: string;
  relation: string;
  reason: string;
};

function normName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normClass(value: string | null | undefined): string {
  return normName(String(value || "").trim());
}

function learnerMatchKey(firstName: string, lastName: string, className: string): string {
  return `${normName(firstName)}|${normName(lastName)}|${normClass(className)}`;
}

function parentStagingKey(matchKey: string, parentIndex: number): string {
  return `${matchKey}:${parentIndex}`;
}

function resolveKideesysRoot(): string {
  const fromEnv = String(process.env.KIDESYS_ROOT || "").trim();
  const fromArg = process.argv
    .slice(2)
    .find((a) => a !== "--apply" && !a.startsWith("-") && a.includes("/"));
  const root = fromEnv || fromArg || path.join(process.env.HOME || "", "Desktop");
  return path.resolve(root);
}

function buildIngestPaths(desktopRoot: string): DaSilvaKideesysParentsIngestPaths {
  return {
    classListDir: path.join(desktopRoot, "05_class_list"),
    contactList: path.join(desktopRoot, "04_contact_list", "contact_list.xls"),
    ageAnalysis: path.join(
      desktopRoot,
      "02_account_list_age_analysis",
      "account_list_(age_analysis).xls"
    ),
  };
}

function validateIngestPaths(paths: DaSilvaKideesysParentsIngestPaths): void {
  for (const [label, filePath] of Object.entries(paths)) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing Kid-e-Sys ${label}: ${filePath}`);
    }
  }
}

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
  const hint = String(schoolIdArg || getDaSilvaResolvedSchoolId() || "").trim();
  const school =
    (hint
      ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
      : null) ||
    (await prisma.school.findFirst({
      where: { email: DA_SILVA_OWNER_EMAIL },
      select: { id: true, name: true },
    })) ||
    (await prisma.school.findFirst({
      where: { name: DA_SILVA_SCHOOL_NAME },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("Da Silva Academy school not found");
  setDaSilvaResolvedSchoolId(school.id);
  return school;
}

async function snapshotCounts(
  schoolId: string,
  unmatchedLearners = 0,
  unmatchedParents = 0
): Promise<SnapshotCounts> {
  const [
    learnersTotal,
    learnersWithFamilyAccountId,
    familyAccounts,
    parents,
    parentLearnerLinks,
    ledgerEntries,
    billingPlans,
  ] = await Promise.all([
    prisma.learner.count({ where: { schoolId } }),
    prisma.learner.count({ where: { schoolId, familyAccountId: { not: null } } }),
    prisma.familyAccount.count({ where: { schoolId } }),
    prisma.parent.count({ where: { schoolId } }),
    prisma.parentLearnerLink.count({ where: { schoolId } }),
    Promise.resolve(readSchoolLedger(schoolId).length),
    Promise.resolve(Object.keys(readSchoolBillingPlans(schoolId)).length),
  ]);

  return {
    learnersTotal,
    learnersWithFamilyAccountId,
    familyAccounts,
    parents,
    parentLearnerLinks,
    unmatchedLearners,
    unmatchedParents,
    ledgerEntries,
    billingPlans,
  };
}

function assertBillingUntouched(
  label: string,
  before: SnapshotCounts,
  after: SnapshotCounts
): string[] {
  const errors: string[] = [];
  if (before.ledgerEntries !== 0 || after.ledgerEntries !== 0) {
    errors.push(
      `${label}: ledgerEntries must remain 0 (before=${before.ledgerEntries}, after=${after.ledgerEntries})`
    );
  }
  if (before.billingPlans !== 0 || after.billingPlans !== 0) {
    errors.push(
      `${label}: billingPlans must remain 0 (before=${before.billingPlans}, after=${after.billingPlans})`
    );
  }
  return errors;
}

type DbLearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  familyAccountId: string | null;
  createdAt: Date;
};

function buildDbLearnerIndex(rows: DbLearnerRow[]): Map<string, string> {
  const buckets = new Map<string, DbLearnerRow[]>();
  for (const row of rows) {
    const key = learnerMatchKey(row.firstName, row.lastName, row.className || "");
    const list = buckets.get(key) || [];
    list.push(row);
    buckets.set(key, list);
  }
  const index = new Map<string, string>();
  for (const [key, list] of buckets) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    index.set(key, list[0].id);
  }
  return index;
}

function resolveLearnerIdForStagedRow(
  row: DaSilvaStagedLearner,
  dbIndex: Map<string, string>
): string | null {
  const keys = [
    learnerMatchKey(row.firstName, row.lastName, row.canonicalClassName),
    learnerMatchKey(row.firstName, row.lastName, row.className),
  ];
  for (const key of keys) {
    const id = dbIndex.get(key);
    if (id) return id;
  }
  return null;
}

async function runRepair(opts: {
  schoolId: string;
  staged: DaSilvaStagedLearner[];
  apply: boolean;
}): Promise<{
  unmatchedLearners: UnmatchedLearner[];
  unmatchedParentLinks: UnmatchedParentLink[];
  planned: {
    familyAccountsEnsured: number;
    learnersFamilyUpdated: number;
    parentsCreated: number;
    parentsReused: number;
    linksUpserted: number;
  };
}> {
  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: opts.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      familyAccountId: true,
      createdAt: true,
    },
  });
  const dbIndex = buildDbLearnerIndex(dbLearners);

  const unmatchedLearners: UnmatchedLearner[] = [];
  const unmatchedParentLinks: UnmatchedParentLink[] = [];
  const matchKeyToLearnerId = new Map<string, string>();

  for (const row of opts.staged) {
    const learnerId = resolveLearnerIdForStagedRow(row, dbIndex);
    if (!learnerId) {
      unmatchedLearners.push({
        matchKey: row.matchKey,
        fullName: row.fullName,
        className: row.className,
        canonicalClassName: row.canonicalClassName,
        accountNo: String(row.accountNo || "").trim(),
      });
      continue;
    }
    matchKeyToLearnerId.set(row.matchKey, learnerId);
  }

  const accountFamilyNames = new Map<string, string>();
  for (const row of opts.staged) {
    const accountNo = String(row.accountNo || "").trim();
    if (!accountNo) continue;
    if (!accountFamilyNames.has(accountNo)) {
      accountFamilyNames.set(accountNo, row.lastName || row.fullName);
    }
  }

  let familyAccountsEnsured = 0;
  let learnersFamilyUpdated = 0;
  let parentsCreated = 0;
  let parentsReused = 0;
  let linksUpserted = 0;

  const accountToFamilyId = new Map<string, string>();

  const ensureFamilyAccounts = async (): Promise<void> => {
    for (const [accountNo, familyName] of accountFamilyNames) {
      if (opts.apply) {
        const fa = await prisma.familyAccount.upsert({
          where: { accountRef: accountNo },
          create: {
            schoolId: opts.schoolId,
            accountRef: accountNo,
            familyName,
          },
          update: {},
          select: { id: true },
        });
        accountToFamilyId.set(accountNo, fa.id);
      }
      familyAccountsEnsured += 1;
    }
  };

  if (opts.apply) {
    await ensureFamilyAccounts();
  } else {
    familyAccountsEnsured = accountFamilyNames.size;
  }

  for (const row of opts.staged) {
    const learnerId = matchKeyToLearnerId.get(row.matchKey);
    if (!learnerId) continue;
    const accountNo = String(row.accountNo || "").trim();
    if (!accountNo) continue;
    const targetFamilyAccountId = opts.apply ? accountToFamilyId.get(accountNo) || null : null;
    const current = dbLearners.find((l) => l.id === learnerId);
    if (opts.apply && targetFamilyAccountId) {
      if (current?.familyAccountId !== targetFamilyAccountId) {
        await prisma.learner.update({
          where: { id: learnerId },
          data: { familyAccountId: targetFamilyAccountId },
        });
        learnersFamilyUpdated += 1;
      }
    } else if (!opts.apply) {
      learnersFamilyUpdated += 1;
    }
  }

  const stagedParentIds = new Map<string, string>();

  for (const row of opts.staged) {
    const accountNo = String(row.accountNo || "").trim();
    const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;

    for (let pi = 0; pi < row.parents.length; pi++) {
      const parent = row.parents[pi];
      const stageKey = parentStagingKey(row.matchKey, pi);

      if (!opts.apply) {
        const learnerId = matchKeyToLearnerId.get(row.matchKey);
        if (!learnerId) {
          unmatchedParentLinks.push({
            matchKey: row.matchKey,
            learnerFullName: row.fullName,
            parentName: `${parent.firstName} ${parent.surname}`.trim(),
            relation: parent.relation,
            reason: "Learner not matched in database",
          });
          continue;
        }
        linksUpserted += 1;
        continue;
      }

      const phone = normalizeSaPhone(parent.cellNo || parent.homeNo || "");
      const cellNo = phone?.localCell || parent.cellNo || "";

      let parentId = stagedParentIds.get(stageKey);
      if (!parentId) {
        const existingParent = await prisma.parent.findFirst({
          where: {
            schoolId: opts.schoolId,
            firstName: parent.firstName,
            surname: parent.surname,
            cellNo,
            familyAccountId: familyAccountId ?? null,
          },
          select: { id: true },
        });

        if (existingParent?.id) {
          parentId = existingParent.id;
          parentsReused += 1;
        } else {
          const created = await prisma.parent.create({
            data: {
              schoolId: opts.schoolId,
              familyAccountId,
              firstName: parent.firstName,
              surname: parent.surname,
              cellNo,
              email: parent.email || null,
              relationship: parent.relation,
              workNo: parent.workNo || null,
              homeNo: parent.homeNo || null,
              outstandingAmount: 0,
            },
            select: { id: true },
          });
          parentId = created.id;
          parentsCreated += 1;
        }
        stagedParentIds.set(stageKey, parentId);
      }

      const learnerId = matchKeyToLearnerId.get(row.matchKey);
      if (!learnerId) {
        unmatchedParentLinks.push({
          matchKey: row.matchKey,
          learnerFullName: row.fullName,
          parentName: `${parent.firstName} ${parent.surname}`.trim(),
          relation: parent.relation,
          reason: "Learner not matched in database",
        });
        continue;
      }

      await prisma.parentLearnerLink.upsert({
        where: { parentId_learnerId: { parentId, learnerId } },
        create: {
          schoolId: opts.schoolId,
          parentId,
          learnerId,
          relation: parent.relation,
          isPrimary: row.parents[0] === parent,
        },
        update: {},
      });
      linksUpserted += 1;
    }
  }

  return {
    unmatchedLearners,
    unmatchedParentLinks,
    planned: {
      familyAccountsEnsured,
      learnersFamilyUpdated,
      parentsCreated,
      parentsReused,
      linksUpserted,
    },
  };
}

async function main(): Promise<void> {
  const kideesysRoot = resolveKideesysRoot();
  const paths = buildIngestPaths(kideesysRoot);
  validateIngestPaths(paths);

  const school = await resolveSchoolId();
  const schoolId = school.id;

  console.log("=== Da Silva parent / family linkage repair ===");
  console.log(`Mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log(`School: ${school.name} (${schoolId})`);
  console.log(`Kid-e-Sys root: ${kideesysRoot}`);

  const before = await snapshotCounts(schoolId);

  if (before.ledgerEntries > 0) {
    throw new Error(
      `BLOCKED: school has ${before.ledgerEntries} ledger entries — this script does not touch billing`
    );
  }
  if (before.billingPlans > 0) {
    throw new Error(
      `BLOCKED: school has ${before.billingPlans} billing plans — this script does not touch billing`
    );
  }

  console.log("\n--- Before ---");
  console.log(JSON.stringify(before, null, 2));

  console.log("\nRebuilding staged learners from Kid-e-Sys export…");
  const staged = buildDaSilvaParentsStagedLearners(paths);
  console.log(`Staged learners: ${staged.length} (expected ${DA_SILVA_EXPECTED_LEARNER_COUNT})`);
  if (staged.length !== DA_SILVA_EXPECTED_LEARNER_COUNT) {
    console.warn(
      `WARNING: staged learner count ${staged.length} ≠ expected ${DA_SILVA_EXPECTED_LEARNER_COUNT}`
    );
  }

  const repair = await runRepair({ schoolId, staged, apply });

  const after = await snapshotCounts(
    schoolId,
    repair.unmatchedLearners.length,
    repair.unmatchedParentLinks.length
  );

  const matchedWithAccount = staged.filter(
    (row) =>
      !repair.unmatchedLearners.some((u) => u.matchKey === row.matchKey) &&
      String(row.accountNo || "").trim()
  ).length;
  const stagedParentSlots = staged.reduce((n, row) => n + row.parents.length, 0);

  const report: Record<string, unknown> = {
    mode: apply ? "apply" : "dry-run",
    schoolId,
    schoolName: school.name,
    kideesysRoot,
    ingestPaths: paths,
    stagedLearnerCount: staged.length,
    stagedParentSlots,
    matchedLearnersWithAccount: matchedWithAccount,
    before,
    after,
    planned: repair.planned,
    unmatchedLearners: repair.unmatchedLearners,
    unmatchedParentLinks: repair.unmatchedParentLinks,
    assertions: [] as string[],
  };

  if (!apply) {
    report.afterEstimate = {
      learnersTotal: before.learnersTotal,
      learnersWithFamilyAccountId: matchedWithAccount,
      familyAccounts: Math.max(before.familyAccounts, repair.planned.familyAccountsEnsured),
      parents: before.parents + repair.planned.parentsCreated,
      parentLearnerLinks: repair.planned.linksUpserted,
      unmatchedLearners: repair.unmatchedLearners.length,
      unmatchedParents: repair.unmatchedParentLinks.length,
      ledgerEntries: 0,
      billingPlans: 0,
    };
  }

  console.log("\n--- After ---");
  console.log(JSON.stringify(after, null, 2));

  console.log("\n--- Planned / applied ---");
  console.log(JSON.stringify(repair.planned, null, 2));

  if (repair.unmatchedLearners.length) {
    console.log(`\nUnmatched learners (${repair.unmatchedLearners.length}):`);
    for (const row of repair.unmatchedLearners.slice(0, 30)) {
      console.log(
        `  ${row.fullName} | class=${row.canonicalClassName || row.className} | account=${row.accountNo || "(none)"}`
      );
    }
    if (repair.unmatchedLearners.length > 30) {
      console.log(`  … and ${repair.unmatchedLearners.length - 30} more`);
    }
  }

  if (repair.unmatchedParentLinks.length) {
    console.log(`\nUnmatched parent links (${repair.unmatchedParentLinks.length}):`);
    for (const row of repair.unmatchedParentLinks.slice(0, 20)) {
      console.log(`  ${row.learnerFullName} ↔ ${row.parentName}: ${row.reason}`);
    }
  }

  const assertionErrors: string[] = assertBillingUntouched("billing guard", before, after);

  if (apply) {
    if (after.learnersWithFamilyAccountId !== DA_SILVA_EXPECTED_LEARNER_COUNT) {
      assertionErrors.push(
        `learnersWithFamilyAccountId expected ${DA_SILVA_EXPECTED_LEARNER_COUNT}, got ${after.learnersWithFamilyAccountId}`
      );
      const stillMissing = await prisma.learner.findMany({
        where: { schoolId, familyAccountId: null },
        select: { id: true, firstName: true, lastName: true, className: true, admissionNo: true },
        take: 50,
      });
      if (stillMissing.length) {
        report.learnersStillWithoutFamilyAccount = stillMissing;
        console.log("\nLearners still without familyAccountId:");
        for (const l of stillMissing.slice(0, 30)) {
          console.log(
            `  ${l.firstName} ${l.lastName} | class=${l.className ?? ""} | admission=${l.admissionNo ?? ""}`
          );
        }
      }
    }

    if (after.parentLearnerLinks !== DA_SILVA_EXPECTED_PARENT_LINK_COUNT) {
      assertionErrors.push(
        `parentLearnerLinks expected ${DA_SILVA_EXPECTED_PARENT_LINK_COUNT}, got ${after.parentLearnerLinks}`
      );
      const stagedLinkSlots = staged.reduce((n, row) => n + row.parents.length, 0);
      const gap = DA_SILVA_EXPECTED_PARENT_LINK_COUNT - after.parentLearnerLinks;
      report.parentLinkGap = {
        expected: DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
        actual: after.parentLearnerLinks,
        stagedSlots: stagedLinkSlots,
        unmatchedLearnerSlots: repair.unmatchedLearners.reduce(
          (n, u) => n + (staged.find((s) => s.matchKey === u.matchKey)?.parents.length || 0),
          0
        ),
        unmatchedParentLinkRows: repair.unmatchedParentLinks.length,
        shortBy: gap,
      };
    }
  } else {
    console.log("\nDry run only. Re-run with --apply to persist repairs.");
    const wouldLinkAll =
      repair.unmatchedLearners.length === 0 &&
      repair.planned.linksUpserted ===
        staged.reduce((n, row) => n + row.parents.length, 0);
    console.log(
      `Would upsert ~${repair.planned.linksUpserted} parent-learner links (target ${DA_SILVA_EXPECTED_PARENT_LINK_COUNT}); all learners matched: ${repair.unmatchedLearners.length === 0 && wouldLinkAll}`
    );
  }

  report.assertions = assertionErrors;

  const jsonPath = path.join(process.cwd(), "repair-da-silva-parent-family-links.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${jsonPath}`);

  if (assertionErrors.length) {
    console.error("\nASSERTIONS FAILED:");
    for (const err of assertionErrors) console.error(`  - ${err}`);
    process.exit(1);
  }

  if (!apply) {
    process.exit(0);
  }

  console.log("\nRepair completed successfully.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
