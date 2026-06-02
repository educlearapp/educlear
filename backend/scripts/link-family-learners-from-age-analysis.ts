/**
 * Link learners to FamilyAccount rows using Kid-e-Sys age-analysis accountHolder names.
 * Updates learner.familyAccountId only (no ledger / balance changes).
 *
 * Usage:
 *   npx ts-node scripts/link-family-learners-from-age-analysis.ts [schoolId]
 *   CONFIRM_FAMILY_ACCOUNT_RELINK=true PRODUCTION_DATABASE_URL="postgresql://..." \
 *     npx ts-node scripts/link-family-learners-from-age-analysis.ts [schoolId] --apply
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  learnerFullName,
  matchLearnersToAccountHolder,
  splitAccountHolderNames,
} from "../src/services/familyAccountMembers";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_FAMILY_ACCOUNT_RELINK";
const apply = process.argv.includes("--apply");

function resolveDbHost(url: string): string {
  const m = String(url || "").match(/@([^/?]+)/);
  return m ? m[1] : "unknown";
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.includes("localhost") || h.includes("127.0.0.1");
}

function configureDatabaseUrl(): string {
  const localUrl = String(process.env.DATABASE_URL || "").trim();
  const productionUrl = String(
    process.env.PRODUCTION_DATABASE_URL || process.env.TARGET_DATABASE_URL || ""
  ).trim();
  const activeUrl = apply ? productionUrl || localUrl : productionUrl || localUrl;
  if (!activeUrl) throw new Error("DATABASE_URL is required");
  const host = resolveDbHost(activeUrl);
  if (apply && productionUrl && isLocalHost(host)) {
    throw new Error(`Refusing production --apply against local host (${host})`);
  }
  if (apply && productionUrl) {
    if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
      throw new Error(`Set ${CONFIRM_ENV}=true to apply against production`);
    }
  }
  process.env.DATABASE_URL = activeUrl;
  return activeUrl;
}

async function main() {
  const schoolId =
    (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2].trim() : "") ||
    DA_SILVA_SCHOOL_ID;

  const activeUrl = configureDatabaseUrl();
  const dbHost = resolveDbHost(activeUrl);

  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
    select: { id: true, accountRef: true, familyName: true },
  });
  const familyByRef = new Map(
    familyAccounts.map((fa) => [String(fa.accountRef).trim().toUpperCase(), fa])
  );

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: { id: true, firstName: true, lastName: true, familyAccountId: true },
  });

  const planned: Array<{
    accountRef: string;
    learnerId: string;
    learnerName: string;
    fromFamilyAccountId: string | null;
    toFamilyAccountId: string;
  }> = [];

  const unmatchedHolders: Array<{
    accountRef: string;
    accountHolder: string;
    unmatchedNames: string[];
  }> = [];

  const familyAccountsRepaired = new Set<string>();

  for (const snap of Object.values(snapshots)) {
    const accountRef = String(snap.accountRef || "").trim().toUpperCase();
    const accountHolder = String(snap.accountHolder || "").trim();
    if (!accountRef || !accountHolder) continue;
    const family = familyByRef.get(accountRef);
    if (!family) continue;

    const holderNames = splitAccountHolderNames(accountHolder);
    const matched = matchLearnersToAccountHolder(learners, accountHolder);
    const matchedNameKeys = new Set(
      matched.map((l) => learnerFullName(l).toLowerCase())
    );
    const unmatchedNames = holderNames.filter((name) => {
      const parts = name.split(/\s+/).filter(Boolean);
      if (!parts.length) return true;
      const first = parts[0].toLowerCase();
      const last = (parts[parts.length - 1] || "").toLowerCase();
      return !matched.some((l) => {
        const lFirst = String(l.firstName || "").trim().toLowerCase();
        const lLast = String(l.lastName || "").trim().toLowerCase();
        return lFirst === first && lLast === last;
      });
    });
    if (unmatchedNames.length) {
      unmatchedHolders.push({ accountRef, accountHolder, unmatchedNames });
    }

    for (const learner of matched) {
      const current = learners.find((row) => row.id === learner.id);
      if (!current || current.familyAccountId === family.id) continue;
      planned.push({
        accountRef,
        learnerId: learner.id,
        learnerName: learnerFullName(learner),
        fromFamilyAccountId: current.familyAccountId,
        toFamilyAccountId: family.id,
      });
      familyAccountsRepaired.add(accountRef);
    }
  }

  if (apply) {
    for (const row of planned) {
      await prisma.learner.update({
        where: { id: row.learnerId },
        data: { familyAccountId: row.toFamilyAccountId },
      });
      const current = learners.find((l) => l.id === row.learnerId);
      if (current) current.familyAccountId = row.toFamilyAccountId;
    }
  }

  const mot036 = planned.filter((p) => p.accountRef === "MOT036");
  const report = {
    schoolId,
    apply,
    dbHost,
    learnersRelinked: planned.length,
    familyAccountsRepaired: familyAccountsRepaired.size,
    unmatchedHolderAccounts: unmatchedHolders.length,
    unmatchedHolders: unmatchedHolders.slice(0, 50),
    mot036,
    sampleRelinks: planned.slice(0, 20),
  };

  const outDir = path.join(process.cwd(), "storage");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `link-family-relink-${schoolId}${apply ? "-applied" : "-dry"}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ ...report, outPath }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
