/**
 * Safe dedupe for migration-created duplicate learners (same name + class).
 * Keeps the oldest row; reassigns links, billing plans, and ledger learnerIds.
 *
 * Usage:
 *   npx tsx scripts/dedupe-migration-learners.ts [schoolId]           # dry-run
 *   npx tsx scripts/dedupe-migration-learners.ts [schoolId] --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  backfillLedgerLearnerIds,
  readSchoolLedger,
  writeSchoolLedger,
} from "../src/utils/billingLedgerStore";
import {
  readSchoolBillingPlans,
  upsertLearnerBillingPlan,
  removeSchoolBillingPlans,
} from "../src/utils/learnerBillingPlanStore";

const schoolId = process.argv[2] || "cmpideqeq0000108xb6ouv9zi";
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreKeeper(learnerId: string, plans: Record<string, unknown>, ledgerCount: number): number {
  const hasPlan = Array.isArray(plans[learnerId]) && (plans[learnerId] as unknown[]).length > 0;
  return (hasPlan ? 1000 : 0) + ledgerCount * 10;
}

async function main() {
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const plans = readSchoolBillingPlans(schoolId);
  const ledger = readSchoolLedger(schoolId);
  const ledgerCountByLearner = new Map<string, number>();
  for (const entry of ledger) {
    const id = String(entry.learnerId || "").trim();
    if (!id) continue;
    ledgerCountByLearner.set(id, (ledgerCountByLearner.get(id) || 0) + 1);
  }

  const groups = new Map<string, typeof learners>();
  for (const l of learners) {
    const key = norm(`${l.firstName}|${l.lastName}|${l.className || ""}`);
    const arr = groups.get(key) || [];
    arr.push(l);
    groups.set(key, arr);
  }

  const duplicateGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  const actions: Array<{
    key: string;
    keepId: string;
    removeIds: string[];
  }> = [];

  for (const [key, arr] of duplicateGroups) {
    const sorted = [...arr].sort((a, b) => {
      const scoreA = scoreKeeper(a.id, plans, ledgerCountByLearner.get(a.id) || 0);
      const scoreB = scoreKeeper(b.id, plans, ledgerCountByLearner.get(b.id) || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keep = sorted[0];
    const remove = sorted.slice(1);
    actions.push({
      key,
      keepId: keep.id,
      removeIds: remove.map((r) => r.id),
    });
  }

  console.log(
    JSON.stringify(
      {
        schoolId,
        apply,
        totalLearners: learners.length,
        duplicateGroups: duplicateGroups.length,
        learnersToRemove: actions.reduce((s, a) => s + a.removeIds.length, 0),
        actions: actions.slice(0, 20),
      },
      null,
      2
    )
  );

  if (!apply || !actions.length) {
    if (!apply && actions.length) {
      console.log("\nDry-run only. Re-run with --apply to merge duplicates.");
    }
    return;
  }

  const accountToLearnerId: Record<string, string> = {};
  for (const l of learners) {
    const adm = String(l.admissionNo || "").trim();
    if (adm) accountToLearnerId[adm] = l.id;
  }

  for (const action of actions) {
    const keep = learners.find((l) => l.id === action.keepId)!;
    const keepAdm = String(keep.admissionNo || "").trim();

    for (const removeId of action.removeIds) {
      const remove = learners.find((l) => l.id === removeId)!;
      const removeAdm = String(remove.admissionNo || "").trim();

      if (plans[removeId]?.length) {
        const merged = [...(plans[action.keepId] || []), ...plans[removeId]];
        upsertLearnerBillingPlan(schoolId, action.keepId, merged);
        removeSchoolBillingPlans(schoolId, [removeId]);
      }

      await prisma.parentLearnerLink.updateMany({
        where: { learnerId: removeId },
        data: { learnerId: action.keepId },
      });

      await prisma.parentTeacherThread.updateMany({
        where: { learnerId: removeId },
        data: { learnerId: action.keepId },
      });

      if (removeAdm && keepAdm) {
        accountToLearnerId[removeAdm] = action.keepId;
      }

      await prisma.learner.delete({ where: { id: removeId } });
      console.log(`Removed duplicate ${removeId} → kept ${action.keepId} (${action.key})`);
    }
  }

  const remappedLedger = readSchoolLedger(schoolId).map((entry) => {
    const removeAction = actions.find((a) => a.removeIds.includes(String(entry.learnerId || "")));
    if (!removeAction) return entry;
    return { ...entry, learnerId: removeAction.keepId };
  });
  writeSchoolLedger(schoolId, remappedLedger);

  const backfilled = backfillLedgerLearnerIds(schoolId, accountToLearnerId);
  console.log(`Ledger learnerId backfill: ${backfilled} row(s)`);
  console.log("Dedupe complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
