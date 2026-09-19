import { computeCountChecksums, computeMoneyTotals, ledgerStatsForAccountRef } from "./checksums";
import { buildRepairPlan, classifyZeroLinkedFamilyAccounts } from "./classify";
import {
  learnerDisplayName,
  normRef,
  round2,
} from "./normalize";
import type {
  CanonicalLearnerRow,
  FlyEagleSchoolBundle,
  ReconciliationReport,
} from "./types";

function isActive(status: unknown): boolean {
  return String(status || "ACTIVE").trim().toUpperCase() === "ACTIVE";
}

export function buildCanonicalLearnerRows(
  bundle: FlyEagleSchoolBundle,
  zeroLinkedFas?: ReturnType<typeof classifyZeroLinkedFamilyAccounts>
): CanonicalLearnerRow[] {
  const faById = new Map(bundle.familyAccounts.map((fa) => [fa.id, fa]));
  const parentById = new Map(bundle.parents.map((p) => [p.id, p]));
  const linksByLearner = new Map<string, string[]>();
  for (const link of bundle.parentLearnerLinks) {
    const list = linksByLearner.get(link.learnerId) || [];
    list.push(link.parentId);
    linksByLearner.set(link.learnerId, list);
  }

  const zeroRows = zeroLinkedFas || classifyZeroLinkedFamilyAccounts(bundle);
  const zeroLinkedIds = new Set(zeroRows.map((r) => r.faId));

  // Map orphan FA → matched learner ids for split detection
  const orphanByLearner = new Map<string, string[]>();
  for (const row of zeroRows) {
    for (const lid of row.matchedLearnerIds) {
      const list = orphanByLearner.get(lid) || [];
      list.push(row.faId);
      orphanByLearner.set(lid, list);
    }
  }

  const rows: CanonicalLearnerRow[] = [];
  for (const learner of bundle.learners) {
    if (!isActive(learner.enrollmentStatus)) continue;
    const fa = learner.familyAccountId ? faById.get(learner.familyAccountId) : null;
    const ref = fa ? String(fa.accountRef || "").trim() : "";
    const stats = ref
      ? ledgerStatsForAccountRef(bundle.ledger, ref)
      : { invoiceCount: 0, paymentCount: 0, creditCount: 0, invoiceTotal: 0, paymentTotal: 0, creditTotal: 0 };
    const balance = round2(bundle.ageAnalysisByRef?.[normRef(ref)]?.balance ?? 0);
    const parentIds = linksByLearner.get(learner.id) || [];
    const relatedOrphans = orphanByLearner.get(learner.id) || [];
    const splitLedger = relatedOrphans.some((oid) => zeroLinkedIds.has(oid));

    rows.push({
      learnerId: learner.id,
      name: learnerDisplayName(learner.firstName, learner.lastName),
      status: String(learner.enrollmentStatus || "ACTIVE"),
      className: String(learner.className || ""),
      grade: String(learner.grade || ""),
      familyAccountId: learner.familyAccountId,
      accountRef: fa?.accountRef ?? null,
      accountNo: fa?.accountNo ?? null,
      balance,
      parentIds,
      parentSummary: parentIds.map((pid) => {
        const p = parentById.get(pid);
        if (!p) return pid;
        return `${String(p.firstName || "").trim()} ${String(p.surname || "").trim()}`.trim() || pid;
      }),
      invoiceCount: stats.invoiceCount,
      paymentCount: stats.paymentCount,
      creditCount: stats.creditCount,
      splitLedger,
      relatedOrphanFaIds: relatedOrphans,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildReconciliationReport(bundle: FlyEagleSchoolBundle): ReconciliationReport {
  const checksums = computeCountChecksums(bundle);
  const money = computeMoneyTotals(bundle);
  const zeroLinkedFas = classifyZeroLinkedFamilyAccounts(bundle);
  const repairPlan = buildRepairPlan(zeroLinkedFas);
  const activeLearners = buildCanonicalLearnerRows(bundle, zeroLinkedFas);

  const notes: string[] = [];
  notes.push(
    `checksums: active=${checksums.activeLearners} historical=${checksums.historicalLearners} fa=${checksums.faTotal} zeroLinked=${checksums.faZeroLinked}`
  );
  notes.push(
    `money: invoices=${money.invoiceCount}/${money.invoiceTotal} payments=${money.paymentCount}/${money.paymentTotal} credits=${money.creditCount}/${money.creditTotal}`
  );
  notes.push(
    `repair plan: A=${repairPlan.classA.length} B=${repairPlan.classB.length} C=${repairPlan.classC.length}`
  );
  notes.push(
    `Class A actions that mutate: ${
      repairPlan.classA.filter((i) => i.action !== "none").length
    }; Class B require explicit accounting plan; Class C untouched`
  );

  return {
    schoolId: bundle.schoolId,
    capturedAt: bundle.capturedAt,
    checksums,
    money,
    activeLearners,
    zeroLinkedFas,
    repairPlan,
    notes,
  };
}
