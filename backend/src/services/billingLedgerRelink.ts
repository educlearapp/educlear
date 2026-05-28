import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import { relinkLedgerLearnerIds } from "../utils/billingLedgerStore";

function admissionBase(admissionNo: string | null | undefined): string {
  const adm = String(admissionNo || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

function registerAccountKey(
  map: Record<string, string>,
  accountKey: string,
  learnerId: string
) {
  const key = String(accountKey || "").trim();
  if (!key || key === "-" || map[key]) return;
  map[key] = learnerId;
}

/** Map billing account refs (family ref, admission, base) → current learner id. */
export async function buildAccountToLearnerIdMap(
  schoolId: string
): Promise<Record<string, string>> {
  const sid = String(schoolId || "").trim();
  if (!sid) return {};

  const learners = await prisma.learner.findMany({
    where: { schoolId: sid },
    select: {
      id: true,
      admissionNo: true,
      familyAccount: { select: { accountRef: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const map: Record<string, string> = {};
  for (const learner of learners) {
    const accountRef = resolveLearnerAccountNo(learner);
    if (accountRef && accountRef !== "-") {
      registerAccountKey(map, accountRef, learner.id);
    }
    const adm = String(learner.admissionNo || "").trim();
    if (adm) {
      registerAccountKey(map, adm, learner.id);
      registerAccountKey(map, admissionBase(adm), learner.id);
    }
  }
  return map;
}

/**
 * Re-attach ledger rows to current learners by accountNo / admission (idempotent).
 * Safe to run on every statements/payments read.
 */
export async function relinkSchoolBillingLedger(schoolId: string): Promise<{
  ledgerRowsUpdated: number;
}> {
  const sid = String(schoolId || "").trim();
  if (!sid) return { ledgerRowsUpdated: 0 };

  const accountToLearnerId = await buildAccountToLearnerIdMap(sid);
  const ledgerRowsUpdated = relinkLedgerLearnerIds(sid, accountToLearnerId);
  return { ledgerRowsUpdated };
}
