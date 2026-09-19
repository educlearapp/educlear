/**
 * Classify zero-linked FamilyAccounts using multi-signal evidence.
 * Never classifies from fuzzy name similarity alone.
 * Fail closed → UNRESOLVED_IDENTITY / Class C when ambiguous.
 */
import { ledgerStatsForAccountRef } from "./checksums";
import {
  emailKey,
  exactNameTokenMatch,
  isoOrNull,
  learnerDisplayName,
  moneyCents,
  nameTokens,
  normRef,
  phoneKey,
  round2,
} from "./normalize";
import type {
  EvidenceTag,
  FlyEagleSchoolBundle,
  OrphanCategory,
  RemediationFamilyAccount,
  RemediationLearner,
  RemediationParent,
  RepairClass,
  RepairPlanItem,
  ZeroLinkedFaRow,
} from "./types";

type MatchCandidate = {
  learner: RemediationLearner;
  currentFa: RemediationFamilyAccount | null;
  evidence: EvidenceTag[];
  reasons: string[];
};

function isActive(l: RemediationLearner): boolean {
  return String(l.enrollmentStatus || "ACTIVE").trim().toUpperCase() === "ACTIVE";
}

function isHistorical(l: RemediationLearner): boolean {
  return String(l.enrollmentStatus || "").trim().toUpperCase() === "HISTORICAL";
}

function parentSummary(p: RemediationParent): string {
  const name = `${String(p.firstName || "").trim()} ${String(p.surname || "").trim()}`.trim();
  const bits = [name || p.id];
  if (p.cellNo) bits.push(`tel:${phoneKey(p.cellNo) || p.cellNo}`);
  if (p.email) bits.push(`email:${emailKey(p.email)}`);
  if (p.idNumber) bits.push(`id:${String(p.idNumber).trim()}`);
  return bits.join(" | ");
}

function buildIndexes(bundle: FlyEagleSchoolBundle) {
  const faById = new Map(bundle.familyAccounts.map((fa) => [fa.id, fa]));
  const learnersByFa = new Map<string, RemediationLearner[]>();
  for (const l of bundle.learners) {
    const id = String(l.familyAccountId || "").trim();
    if (!id) continue;
    const list = learnersByFa.get(id) || [];
    list.push(l);
    learnersByFa.set(id, list);
  }

  const parentsByFa = new Map<string, RemediationParent[]>();
  for (const p of bundle.parents) {
    const id = String(p.familyAccountId || "").trim();
    if (!id) continue;
    const list = parentsByFa.get(id) || [];
    list.push(p);
    parentsByFa.set(id, list);
  }

  const linksByLearner = new Map<string, string[]>();
  const linksByParent = new Map<string, string[]>();
  for (const link of bundle.parentLearnerLinks) {
    const lids = linksByLearner.get(link.learnerId) || [];
    lids.push(link.parentId);
    linksByLearner.set(link.learnerId, lids);
    const pids = linksByParent.get(link.parentId) || [];
    pids.push(link.learnerId);
    linksByParent.set(link.parentId, pids);
  }

  const parentById = new Map(bundle.parents.map((p) => [p.id, p]));

  const mergeTargets = new Map<string, string>();
  /** orphanRef → targetRef for staff unmerge that created a successor FA */
  const unmergeTargets = new Map<string, string>();
  for (const entry of bundle.audit || []) {
    const action = String(entry.action || "");
    const src = normRef(entry.sourceAccountRef);
    const tgt = normRef(entry.targetAccountRef);
    if (!src || !tgt) continue;
    if (action === "merge") mergeTargets.set(src, tgt);
    if (action === "unmerge") unmergeTargets.set(src, tgt);
  }

  return {
    faById,
    learnersByFa,
    parentsByFa,
    linksByLearner,
    linksByParent,
    parentById,
    mergeTargets,
    unmergeTargets,
  };
}

function sharedParentEvidence(
  orphanParents: RemediationParent[],
  learnerParentIds: string[],
  parentById: Map<string, RemediationParent>
): { evidence: EvidenceTag[]; reasons: string[] } {
  const evidence: EvidenceTag[] = [];
  const reasons: string[] = [];
  const learnerParents = learnerParentIds
    .map((id) => parentById.get(id))
    .filter(Boolean) as RemediationParent[];

  for (const op of orphanParents) {
    for (const lp of learnerParents) {
      if (op.id === lp.id) {
        evidence.push("parent_name");
        reasons.push(`shared parent row id=${op.id}`);
        continue;
      }
      const oid = String(op.idNumber || "").trim();
      const lid = String(lp.idNumber || "").trim();
      if (oid && lid && oid === lid) {
        evidence.push("parent_name");
        reasons.push(`shared parent idNumber=${oid}`);
      }
      const ot = phoneKey(op.cellNo);
      const lt = phoneKey(lp.cellNo);
      if (ot && lt && ot === lt) {
        evidence.push("parent_phone");
        reasons.push(`shared parent phone …${ot}`);
      }
      const oe = emailKey(op.email);
      const le = emailKey(lp.email);
      if (oe && le && oe === le) {
        evidence.push("parent_email");
        reasons.push(`shared parent email ${oe}`);
      }
    }
  }
  return { evidence: [...new Set(evidence)], reasons };
}

function accountNoLineage(
  orphan: RemediationFamilyAccount,
  current: RemediationFamilyAccount | null
): { evidence: EvidenceTag[]; reasons: string[] } {
  const evidence: EvidenceTag[] = [];
  const reasons: string[] = [];
  const oNo = normRef(orphan.accountNo);
  const cNo = normRef(current?.accountNo);
  if (oNo && cNo && oNo.slice(0, 3) === cNo.slice(0, 3) && oNo !== cNo) {
    evidence.push("account_no_lineage");
    reasons.push(`accountNo prefix lineage ${oNo} ↔ ${cNo}`);
  }
  const oRef = normRef(orphan.accountRef);
  const cRef = normRef(current?.accountRef);
  const oTokens = new Set(nameTokens(oRef));
  const cTokens = nameTokens(cRef);
  const sharedSurname = cTokens.some((t) => oTokens.has(t) && t.length >= 4);
  if (sharedSurname && oNo && cNo) {
    evidence.push("account_ref_lineage");
    reasons.push(`shared surname token between refs ${oRef} / ${cRef}`);
  }
  return { evidence, reasons };
}

function findCandidates(
  orphan: RemediationFamilyAccount,
  bundle: FlyEagleSchoolBundle,
  idx: ReturnType<typeof buildIndexes>
): MatchCandidate[] {
  const orphanParents = idx.parentsByFa.get(orphan.id) || [];
  const candidates: MatchCandidate[] = [];

  for (const learner of bundle.learners) {
    if (!isActive(learner) && !isHistorical(learner)) continue;
    const evidence: EvidenceTag[] = [];
    const reasons: string[] = [];

    if (exactNameTokenMatch(learner.firstName, learner.lastName, orphan.accountRef)) {
      evidence.push("exact_learner_name");
      reasons.push(
        `exact first+last tokens in accountRef for ${learnerDisplayName(learner.firstName, learner.lastName)}`
      );
    }
    if (exactNameTokenMatch(learner.firstName, learner.lastName, orphan.familyName)) {
      if (!evidence.includes("exact_learner_name")) evidence.push("exact_learner_name");
      reasons.push(`exact first+last tokens in familyName`);
    }
    if (isHistorical(learner) && evidence.includes("exact_learner_name")) {
      evidence.push("historical_learner_record");
      reasons.push(`historical learner record ${learner.id}`);
    }

    const learnerParentIds = idx.linksByLearner.get(learner.id) || [];
    const shared = sharedParentEvidence(orphanParents, learnerParentIds, idx.parentById);
    evidence.push(...shared.evidence);
    reasons.push(...shared.reasons);

    // Parent FA link: orphan parents also appear on learner's current FA
    const currentFa = learner.familyAccountId ? idx.faById.get(learner.familyAccountId) || null : null;
    if (currentFa && currentFa.id !== orphan.id) {
      const lineage = accountNoLineage(orphan, currentFa);
      evidence.push(...lineage.evidence);
      reasons.push(...lineage.reasons);
    }

    // Sibling: another active learner on same current FA shares orphan parent evidence
    if (currentFa) {
      const siblings = (idx.learnersByFa.get(currentFa.id) || []).filter((l) => l.id !== learner.id);
      if (siblings.length && shared.evidence.length) {
        evidence.push("sibling_shared_current_fa");
        reasons.push(`sibling group on current FA ${normRef(currentFa.accountNo || currentFa.accountRef)}`);
      }
    }

    // Admission / compact name against orphan accountNo prefix — only with other evidence
    if (learner.admissionNo && orphan.accountNo) {
      const adm = normRef(learner.admissionNo);
      const ano = normRef(orphan.accountNo);
      if (adm && ano && (adm === ano || adm.startsWith(ano.slice(0, 3)))) {
        evidence.push("admission_no");
        reasons.push(`admissionNo ${adm} relates to accountNo ${ano}`);
      }
    }

    // Keep only candidates with at least one strong non-fuzzy signal
    const strong = evidence.filter((e) =>
      [
        "exact_learner_name",
        "historical_learner_record",
        "parent_name",
        "parent_phone",
        "parent_email",
        "admission_no",
      ].includes(e)
    );
    if (!strong.length) continue;

    candidates.push({
      learner,
      currentFa,
      evidence: [...new Set(evidence)],
      reasons,
    });
  }

  return candidates;
}

function hasMonetaryLedger(stats: ReturnType<typeof ledgerStatsForAccountRef>, balance: number): boolean {
  return (
    stats.invoiceCount > 0 ||
    stats.paymentCount > 0 ||
    stats.creditCount > 0 ||
    moneyCents(balance) !== 0
  );
}

function classifyOne(
  orphan: RemediationFamilyAccount,
  bundle: FlyEagleSchoolBundle,
  idx: ReturnType<typeof buildIndexes>
): ZeroLinkedFaRow {
  const ref = String(orphan.accountRef || "").trim();
  const refKey = normRef(ref);
  const stats = ledgerStatsForAccountRef(bundle.ledger, ref);
  const snap = bundle.ageAnalysisByRef?.[refKey];
  const balance = round2(snap?.balance ?? 0);
  const ledgerBalance = round2(stats.invoiceTotal - stats.paymentTotal - stats.creditTotal);
  const orphanParents = idx.parentsByFa.get(orphan.id) || [];
  const monetary = hasMonetaryLedger(stats, balance) || hasMonetaryLedger(stats, ledgerBalance);

  const base: Omit<
    ZeroLinkedFaRow,
    "category" | "repairClass" | "evidence" | "matchedLearnerIds" | "matchedLearnerNames" | "currentFaIds" | "currentAccountNos" | "reasons" | "proposedAction"
  > = {
    faId: orphan.id,
    accountRef: ref,
    accountNo: orphan.accountNo,
    balance,
    ledgerBalance,
    invoiceCount: stats.invoiceCount,
    paymentCount: stats.paymentCount,
    creditCount: stats.creditCount,
    createdAt: isoOrNull(orphan.createdAt),
    parentIds: orphanParents.map((p) => p.id),
    parentSummary: orphanParents.map(parentSummary),
  };

  // Empty duplicate shell: no learners, no money, no parents
  if (!monetary && orphanParents.length === 0) {
    return {
      ...base,
      category: "DUPLICATE_SHELL",
      repairClass: "A",
      evidence: [],
      matchedLearnerIds: [],
      matchedLearnerNames: [],
      currentFaIds: [],
      currentAccountNos: [],
      reasons: ["zero-linked FA with no ledger, no balance, no parents — empty shell"],
      proposedAction: "retire_empty_shell",
    };
  }

  const candidates = findCandidates(orphan, bundle, idx);
  const activeCandidates = candidates.filter((c) => isActive(c.learner));
  const historicalCandidates = candidates.filter((c) => isHistorical(c.learner));

  const mergeInto = idx.mergeTargets.get(refKey);
  if (mergeInto) {
    return {
      ...base,
      category: "VALID_HISTORICAL_NO_REPAIR",
      repairClass: "A",
      evidence: ["audit_merge_trail"],
      matchedLearnerIds: [],
      matchedLearnerNames: [],
      currentFaIds: [],
      currentAccountNos: [mergeInto],
      reasons: [
        `audit merge trail → ${mergeInto}; VALID HISTORICAL — NO REPAIR REQUIRED (Phase 0 excludes from payment picker)`,
      ],
      proposedAction: "none",
    };
  }

  // Historical learner only, no active match
  if (!activeCandidates.length && historicalCandidates.length) {
    const uniqFa = new Set(
      historicalCandidates
        .map((c) => c.currentFa?.id)
        .filter(Boolean) as string[]
    );
    return {
      ...base,
      category: "HISTORICAL_LEARNER_ACCOUNT",
      repairClass: "A",
      evidence: [...new Set(historicalCandidates.flatMap((c) => c.evidence))],
      matchedLearnerIds: historicalCandidates.map((c) => c.learner.id),
      matchedLearnerNames: historicalCandidates.map((c) =>
        learnerDisplayName(c.learner.firstName, c.learner.lastName)
      ),
      currentFaIds: [...uniqFa],
      currentAccountNos: historicalCandidates
        .map((c) => normRef(c.currentFa?.accountNo || c.currentFa?.accountRef))
        .filter(Boolean),
      reasons: [
        "VALID HISTORICAL — matches historical learner record(s); retain for Statements; Phase 0 excludes from payment picker",
        ...historicalCandidates.flatMap((c) => c.reasons),
      ],
      proposedAction: "none",
    };
  }

  if (!activeCandidates.length) {
    return {
      ...base,
      category: monetary ? "VALID_HISTORICAL_NO_REPAIR" : "UNRESOLVED_IDENTITY",
      repairClass: monetary ? "A" : "C",
      evidence: [],
      matchedLearnerIds: [],
      matchedLearnerNames: [],
      currentFaIds: [],
      currentAccountNos: [],
      reasons: monetary
        ? [
            "VALID HISTORICAL — NO REPAIR REQUIRED: zero-linked with monetary ledger, no proven active learner; Statements/history retained; Phase 0 blocks new payment",
          ]
        : ["no proven identity link to any learner; needs school confirmation"],
      proposedAction: monetary ? "none" : "needs_school_confirmation",
    };
  }

  // Active matches
  const currentFaIds = [
    ...new Set(activeCandidates.map((c) => c.currentFa?.id).filter(Boolean) as string[]),
  ];
  const evidence: EvidenceTag[] = [...new Set(activeCandidates.flatMap((c) => c.evidence))];
  const reasons = activeCandidates.flatMap((c) => c.reasons);
  const matchedLearnerIds = activeCandidates.map((c) => c.learner.id);
  const matchedLearnerNames = activeCandidates.map((c) =>
    learnerDisplayName(c.learner.firstName, c.learner.lastName)
  );
  const currentAccountNos = activeCandidates
    .map((c) => normRef(c.currentFa?.accountNo || c.currentFa?.accountRef))
    .filter(Boolean);

  const hasParentProof = evidence.some((e) =>
    ["parent_name", "parent_phone", "parent_email"].includes(e)
  );
  const hasExactName = evidence.includes("exact_learner_name");
  const hasHistorical = evidence.includes("historical_learner_record");

  const siblingShare =
    currentFaIds.length === 1 &&
    activeCandidates.length >= 2 &&
    evidence.includes("sibling_shared_current_fa");

  let currentHasMonetary = false;
  let split = false;
  for (const faId of currentFaIds) {
    const fa = idx.faById.get(faId);
    if (!fa) continue;
    const curStats = ledgerStatsForAccountRef(bundle.ledger, fa.accountRef);
    const curBal = round2(bundle.ageAnalysisByRef?.[normRef(fa.accountRef)]?.balance ?? 0);
    const curLedgerBal = round2(curStats.invoiceTotal - curStats.paymentTotal - curStats.creditTotal);
    if (hasMonetaryLedger(curStats, curBal) || hasMonetaryLedger(curStats, curLedgerBal)) {
      currentHasMonetary = true;
    }
    if (monetary && currentHasMonetary) {
      split = true;
      evidence.push("ledger_on_orphan", "ledger_on_current");
      reasons.push(
        `split ledger: orphan ${normRef(orphan.accountNo || orphan.accountRef)} and current ${normRef(fa.accountNo || fa.accountRef)} both hold money`
      );
    }
  }
  if (monetary && !split) {
    evidence.push("ledger_on_orphan");
  }
  if (currentHasMonetary) {
    evidence.push("current_holds_continuing_ledger");
  }

  // Staff unmerge: learner+ledger intentionally moved from this orphan to a successor FA
  const unmergeTargetRef = idx.unmergeTargets.get(refKey);
  let unmergeTargetFaId: string | null = null;
  if (unmergeTargetRef) {
    const tgtFa = bundle.familyAccounts.find(
      (fa) => normRef(fa.accountRef) === unmergeTargetRef || normRef(fa.accountNo) === unmergeTargetRef
    );
    if (tgtFa) unmergeTargetFaId = tgtFa.id;
    evidence.push("audit_unmerge_trail");
    reasons.push(`audit unmerge trail ${refKey} → ${unmergeTargetRef} (staff created successor with ledger moved)`);
  }

  let category: OrphanCategory;
  let repairClass: RepairClass;
  let proposedAction: ZeroLinkedFaRow["proposedAction"];

  const deterministic =
    hasParentProof &&
    (hasExactName || hasHistorical) &&
    currentFaIds.length === 1 &&
    activeCandidates.every((c) => c.currentFa?.id === currentFaIds[0]);

  /**
   * Canonical-current rule (SOT pattern): when the orphan is empty of ledger but the
   * linked current FA holds the continuing ledger (often after staff unmerge), keep
   * the learner on the current FA; move parents; retire empty orphan.
   */
  const keepCurrentRetireOrphan =
    currentFaIds.length === 1 &&
    !monetary &&
    currentHasMonetary &&
    (Boolean(unmergeTargetFaId && unmergeTargetFaId === currentFaIds[0]) ||
      (deterministic && hasExactName));

  if (keepCurrentRetireOrphan) {
    category = "WRONG_FA_LINK";
    repairClass = "A";
    proposedAction = "relink_parents_to_current_retire_orphan";
    reasons.push(
      "canonical CURRENT is the FA that holds the continuing ledger + active learner; orphan is empty predecessor — move parents to current and retire orphan (do not move learner onto empty shell)"
    );
  } else if (siblingShare && !split && hasParentProof) {
    category = "SIBLING_FAMILY";
    repairClass = "A";
    proposedAction = "relink_learners_to_orphan_survivor";
  } else if (deterministic && !split && monetary && !currentHasMonetary) {
    // Orphan holds history; current is empty shell → relink learners onto orphan survivor
    category = "WRONG_FA_LINK";
    repairClass = "A";
    proposedAction = "relink_learners_to_orphan_survivor";
  } else if (deterministic && !split && !monetary && !currentHasMonetary) {
    category = "WRONG_FA_LINK";
    repairClass = "A";
    proposedAction = "relink_parents_to_current_retire_orphan";
    reasons.push("both sides non-monetary; keep learner on current FA; retire empty orphan after parent relink");
  } else if (deterministic && split) {
    category = "SPLIT_LEDGER";
    repairClass = "B";
    proposedAction = "ledger_consolidate_then_merge";
  } else if (split && currentFaIds.length === 1 && (hasExactName || hasParentProof)) {
    category = "SPLIT_LEDGER";
    repairClass = "B";
    proposedAction = "ledger_consolidate_then_merge";
  } else if (currentFaIds.length === 1 && hasExactName && hasParentProof && !monetary && currentHasMonetary) {
    category = "WRONG_FA_LINK";
    repairClass = "A";
    proposedAction = "relink_parents_to_current_retire_orphan";
  } else if (currentFaIds.length === 1 && hasExactName && hasParentProof && monetary && !currentHasMonetary) {
    category = "WRONG_FA_LINK";
    repairClass = "A";
    proposedAction = "relink_learners_to_orphan_survivor";
  } else if (currentFaIds.length >= 1 && (hasExactName || hasParentProof)) {
    category = currentFaIds.length > 1 ? "UNRESOLVED_IDENTITY" : "WRONG_FA_LINK";
    repairClass = "C";
    proposedAction = "needs_school_confirmation";
    reasons.push(
      currentFaIds.length > 1
        ? `ambiguous: active matches span ${currentFaIds.length} current FamilyAccounts`
        : "insufficient deterministic evidence (needs school confirmation)"
    );
  } else {
    category = "UNRESOLVED_IDENTITY";
    repairClass = "C";
    proposedAction = "needs_school_confirmation";
    reasons.push("active name/parent signals present but not deterministic");
  }

  return {
    ...base,
    category,
    repairClass,
    evidence: [...new Set(evidence)],
    matchedLearnerIds,
    matchedLearnerNames,
    currentFaIds,
    currentAccountNos: [...new Set(currentAccountNos)],
    reasons,
    proposedAction,
  };
}

export function classifyZeroLinkedFamilyAccounts(bundle: FlyEagleSchoolBundle): ZeroLinkedFaRow[] {
  const idx = buildIndexes(bundle);
  const linked = new Set(
    bundle.learners.map((l) => String(l.familyAccountId || "").trim()).filter(Boolean)
  );

  const zeroLinked = bundle.familyAccounts.filter((fa) => {
    if (fa.retiredAt || fa.mergedIntoFamilyAccountId) return false;
    return !linked.has(fa.id);
  });

  return zeroLinked
    .map((fa) => classifyOne(fa, bundle, idx))
    .sort((a, b) => normRef(a.accountNo || a.accountRef).localeCompare(normRef(b.accountNo || b.accountRef)));
}

export function buildRepairPlan(rows: ZeroLinkedFaRow[]): {
  classA: RepairPlanItem[];
  classB: RepairPlanItem[];
  classC: RepairPlanItem[];
} {
  const toItem = (row: ZeroLinkedFaRow): RepairPlanItem => ({
    caseKey: `${row.accountNo || "NOANO"}::${row.faId}`,
    repairClass: row.repairClass,
    orphanFaId: row.faId,
    orphanAccountRef: row.accountRef,
    orphanAccountNo: row.accountNo,
    action: row.proposedAction,
    learnerIds: row.matchedLearnerIds,
    currentFaIds: row.currentFaIds,
    evidence: row.evidence,
    reasons: row.reasons,
    preconditions: [
      `orphan FA ${row.faId} still zero-linked`,
      `schoolId must remain Fly Eagle`,
      row.repairClass === "A" || row.repairClass === "B"
        ? `action=${row.proposedAction} only if live state matches audited IDs`
        : `no mutation — Class C`,
    ],
    monetary: {
      orphanBalance: row.balance,
      orphanInvoiceTotal: 0, // filled by caller if needed
      orphanPaymentTotal: 0,
    },
  });

  const classA: RepairPlanItem[] = [];
  const classB: RepairPlanItem[] = [];
  const classC: RepairPlanItem[] = [];
  for (const row of rows) {
    const item = toItem(row);
    if (row.repairClass === "A") classA.push(item);
    else if (row.repairClass === "B") classB.push(item);
    else classC.push(item);
  }
  return { classA, classB, classC };
}
