/**
 * Backfill empty learnerId on billing ledger rows using learner admissionNo.
 *
 * Usage: npx tsx scripts/backfill-ledger-learner-ids.ts [schoolId]
 */
import { PrismaClient } from "@prisma/client";
import { backfillLedgerLearnerIds } from "../src/utils/billingLedgerStore";

const schoolId = process.argv[2] || "cmpideqeq0000108xb6ouv9zi";
const prisma = new PrismaClient();

async function main() {
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: { id: true, admissionNo: true, familyAccount: { select: { accountRef: true } } },
  });

  const accountToLearnerId: Record<string, string> = {};
  for (const l of learners) {
    const adm = String(l.admissionNo || "").trim();
    const ref = String(l.familyAccount?.accountRef || "").trim();
    if (adm) accountToLearnerId[adm] = l.id;
    if (ref && !accountToLearnerId[ref]) accountToLearnerId[ref] = l.id;
    if (adm) {
      const dash = adm.indexOf("-");
      if (dash > 0) {
        const base = adm.slice(0, dash);
        if (base && !accountToLearnerId[base]) accountToLearnerId[base] = l.id;
      }
    }
  }

  const updated = backfillLedgerLearnerIds(schoolId, accountToLearnerId);
  console.log(JSON.stringify({ schoolId, ledgerRowsUpdated: updated }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
