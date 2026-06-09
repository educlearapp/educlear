/**
 * Reallocate orphan post-import invoice ledger entries to official age-analysis account refs.
 * Usage: npx ts-node scripts/repair-da-silva-orphan-invoice-refs.ts [--dry-run]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { filterPostImportBalanceEntries } from "../src/services/statementAccounts";
import { readOfficialBillingAccountRefs } from "../src/services/officialBillingAccountRef";
import type { BillingLedgerEntry } from "../src/utils/billingLedgerStore";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

/** Orphan refs from invoice runs → official snapshot refs (evidence-based). */
const ORPHAN_TO_OFFICIAL: Record<string, string> = {
  SIL001: "SIL007",
  SIL002: "SIL007",
  SIL004: "SIL007",
  SIL005: "SIL007",
  LEB001: "LEB005",
  NDL001: "NDL008",
};

/** Stale ledger learner ids → current production learner ids. */
const STALE_LEARNER_TO_CURRENT: Record<string, string> = {
  cmov5l75c000613nsqb36rr7j: "cmpp2eyzh004dtxyzc9cljucn",
  cmokbh56b000391mp0q2q62r6: "cmpp2eyzh004dtxyzc9cljucn",
  cmojv1nlc0029xi55azpt25ew: "cmpp2eyz0003dtxyzersbqdg8",
  cmojut8bk0021xi558cyoya4j: "cmpp2ez4200hltxyzylkqsmg3",
};

const ORPHAN_REFS = new Set(Object.keys(ORPHAN_TO_OFFICIAL));

function monthFromDescription(description: string): string {
  const m = String(description || "").match(/Invoice Run For\s+(.+)$/i);
  return m?.[1]?.trim() || String(description || "").trim();
}

function resolveLedgerFilePath(): string {
  const flag = process.argv.find((a) => a.startsWith("--ledger-file="));
  if (flag) return path.resolve(flag.slice("--ledger-file=".length));
  return path.join(process.cwd(), "data", "billing-ledger.json");
}

function readLedgerFromFile(ledgerFile: string, schoolId: string): BillingLedgerEntry[] {
  const raw = fs.readFileSync(ledgerFile, "utf8");
  const parsed = JSON.parse(raw) as Record<string, BillingLedgerEntry[]>;
  return Array.isArray(parsed[schoolId]) ? parsed[schoolId] : [];
}

function writeLedgerToFile(ledgerFile: string, schoolId: string, entries: BillingLedgerEntry[]) {
  let all: Record<string, BillingLedgerEntry[]> = {};
  if (fs.existsSync(ledgerFile)) {
    try {
      all = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
    } catch {
      all = {};
    }
  }
  all[schoolId] = entries;
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  const tmp = `${ledgerFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
  fs.renameSync(tmp, ledgerFile);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const schoolId = DA_SILVA_SCHOOL_ID;
  const ledgerFile = resolveLedgerFilePath();
  const official = readOfficialBillingAccountRefs(schoolId);
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const ledger = readLedgerFromFile(ledgerFile, schoolId);

  const importedAt = String(
    Object.values(snapshots)[0]?.importedAt || "2026-05-28T08:38:50.245Z"
  );

  const orphanEntries = ledger.filter((entry) => {
    const ref = String(entry.accountNo || "").trim().toUpperCase();
    if (!ORPHAN_REFS.has(ref)) return false;
    if (entry.type !== "invoice") return false;
    if (String(entry.source || "").trim()) return false;
    return String(entry.createdAt || "") >= importedAt;
  });

  const learnerNameById = new Map<string, string>();
  for (const id of new Set(orphanEntries.map((e) => e.learnerId).filter(Boolean))) {
    const learner = await prisma.learner.findFirst({
      where: { id: String(id) },
      select: { firstName: true, lastName: true },
    });
    const currentId = STALE_LEARNER_TO_CURRENT[String(id)] || String(id);
    const current = await prisma.learner.findFirst({
      where: { id: currentId },
      select: { firstName: true, lastName: true },
    });
    const name = current
      ? `${current.firstName} ${current.lastName}`.trim()
      : learner
        ? `${learner.firstName} ${learner.lastName}`.trim()
        : "(unknown)";
    learnerNameById.set(String(id), name);
  }

  console.log("=== Orphan post-import invoices (before repair) ===\n");
  for (const entry of orphanEntries) {
    const ref = String(entry.accountNo || "").trim().toUpperCase();
    console.log(
      JSON.stringify({
        invoiceId: entry.id,
        runMonth: monthFromDescription(entry.description),
        learnerName: learnerNameById.get(String(entry.learnerId)) || "(unknown)",
        accountRefUsed: ref,
        amount: entry.amount,
        createdAt: entry.createdAt,
        learnerId: entry.learnerId,
        targetAccountRef: ORPHAN_TO_OFFICIAL[ref],
        targetLearnerId: STALE_LEARNER_TO_CURRENT[String(entry.learnerId)] || entry.learnerId,
      })
    );
  }

  if (!orphanEntries.length) {
    console.log("\nNo orphan entries to repair.");
    await prisma.$disconnect();
    return;
  }

  const backupPath = path.join(
    process.cwd(),
    "storage",
    `billing-ledger-orphan-repair-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  if (!dryRun) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({ schoolId, ledger }, null, 2), "utf8");
    console.log(`\nBackup: ${backupPath}`);
  }

  let updated = 0;
  const changes: Array<{
    id: string;
    fromAccount: string;
    toAccount: string;
    fromLearnerId: string;
    toLearnerId: string;
  }> = [];

  const next: BillingLedgerEntry[] = ledger.map((entry) => {
    const ref = String(entry.accountNo || "").trim().toUpperCase();
    if (!ORPHAN_REFS.has(ref)) return entry;
    if (entry.type !== "invoice") return entry;
    if (String(entry.source || "").trim()) return entry;
    if (String(entry.createdAt || "") < importedAt) return entry;

    const toAccount = ORPHAN_TO_OFFICIAL[ref];
    if (!toAccount || !official.has(toAccount)) {
      throw new Error(`Target account ${toAccount} missing from official list`);
    }

    const fromLearnerId = String(entry.learnerId || "");
    const toLearnerId = STALE_LEARNER_TO_CURRENT[fromLearnerId] || fromLearnerId;

    changes.push({
      id: entry.id,
      fromAccount: ref,
      toAccount,
      fromLearnerId,
      toLearnerId,
    });
    updated += 1;
    return { ...entry, accountNo: toAccount, learnerId: toLearnerId };
  });

  if (!dryRun && updated > 0) {
    writeLedgerToFile(ledgerFile, schoolId, next);
  }

  const remainingOrphans = (dryRun ? next : readLedgerFromFile(ledgerFile, schoolId)).filter((entry) => {
    const ref = String(entry.accountNo || "").trim().toUpperCase();
    return (
      ORPHAN_REFS.has(ref) &&
      entry.type === "invoice" &&
      !String(entry.source || "").trim() &&
      String(entry.createdAt || "") >= importedAt
    );
  });

  const affectedRefs = [...new Set(changes.map((c) => c.toAccount))];
  const postImportByAccount: Record<string, number> = {};
  for (const ref of affectedRefs) {
    const snap = snapshots[ref];
    const accountEntries = (dryRun ? next : readLedgerFromFile(ledgerFile, schoolId)).filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === ref
    );
    const post = filterPostImportBalanceEntries(
      accountEntries,
      String(snap?.importedAt || importedAt)
    );
    postImportByAccount[ref] = post.filter((e) => e.type === "invoice").length;
  }

  const report = {
    schoolId,
    dryRun,
    updated,
    remainingOrphanCount: remainingOrphans.length,
    changes,
    postImportInvoiceCountByAccount: postImportByAccount,
    backupPath: dryRun ? null : backupPath,
  };

  const outPath = path.join(process.cwd(), "storage", "da-silva-orphan-invoice-repair.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Updated ${updated} ledger entries`);
  console.log(`Remaining orphans: ${remainingOrphans.length}`);
  console.log(`Post-import invoice counts:`, postImportByAccount);
  console.log(`Report: ${outPath}`);

  await prisma.$disconnect();
  if (remainingOrphans.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
