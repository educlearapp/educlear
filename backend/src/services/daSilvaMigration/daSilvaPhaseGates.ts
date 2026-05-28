import {
  countDaSilvaSasamsClassrooms,
  countDaSilvaSupplementClassrooms,
  DA_SILVA_BILLING_ACCOUNT_TARGET,
  DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
  DA_SILVA_BILLING_MATCH_MIN_RATIO,
  DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
  DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
  DA_SILVA_MIN_BILLING_MATCH_COUNT,
  isAcceptableDaSilvaFinalLearnerCount,
  isAcceptableDaSilvaPhase1DbClassroomTotal,
  isAcceptableDaSilvaPhase2LearnerCount,
  isAcceptableDaSilvaPhase3LearnerCount,
} from "./daSilvaConstants";

export type DaSilvaMigrationPhase =
  | "classrooms"
  | "learners"
  | "creche_supplement"
  | "parents"
  | "billing_match"
  | "billing";

export type DaSilvaPhaseGateSnapshot = {
  classroomNames: string[];
  learnerCount: number;
  crecheLearnerCount: number;
  parentLinkCount: number;
  billingMatched: number;
  billingTotal: number;
  phasesCompleted: string[];
  manifestReady: boolean;
  sasamsClassListFileCount?: number;
  sasamsClassListLearnerCount?: number;
  sasamsValidationPassed?: boolean;
};

export type DaSilvaPhaseGateResult = {
  phase: string;
  label: string;
  passed: boolean;
  expected: Record<string, string | number | boolean>;
  actual: Record<string, string | number | boolean>;
  blocker: string | null;
};

function gateResult(
  phase: string,
  label: string,
  expected: Record<string, string | number | boolean>,
  actual: Record<string, string | number | boolean>,
  blocker: string | null
): DaSilvaPhaseGateResult {
  return { phase, label, passed: blocker === null, expected, actual, blocker };
}

export function evaluateDaSilvaPhase1Gate(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult {
  const sasamsClassrooms = countDaSilvaSasamsClassrooms(ctx.classroomNames);
  const supplementClassrooms = countDaSilvaSupplementClassrooms(ctx.classroomNames);
  const totalClassrooms = ctx.classroomNames.length;

  const expected = {
    manifestReady: true,
    sasamsClassrooms: DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
    totalClassroomsMin: DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
    totalClassroomsMax: DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT + 1,
    crecheSupplementAllowed: true,
  };
  const actual = {
    manifestReady: ctx.manifestReady,
    sasamsClassrooms,
    totalClassrooms,
    supplementClassrooms,
    sasamsClassListFiles: ctx.sasamsClassListFileCount ?? "—",
    sasamsClassListLearners: ctx.sasamsClassListLearnerCount ?? "—",
  };

  if (!ctx.manifestReady) {
    return gateResult("phase1", "Phase 1 — Classes", expected, actual, "Staging manifest validation not passed");
  }
  if (ctx.sasamsValidationPassed === false) {
    return gateResult("phase1", "Phase 1 — Classes", expected, actual, "SA-SAMS class list validation failed");
  }
  if (ctx.sasamsClassListFileCount !== undefined && ctx.sasamsClassListFileCount !== DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
    return gateResult(
      "phase1",
      "Phase 1 — Classes",
      expected,
      actual,
      `Expected ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT} SA-SAMS class list files, found ${ctx.sasamsClassListFileCount}`
    );
  }
  if (!isAcceptableDaSilvaPhase1DbClassroomTotal(totalClassrooms, supplementClassrooms)) {
    return gateResult(
      "phase1",
      "Phase 1 — Classes",
      expected,
      actual,
      `Database has ${totalClassrooms} classroom(s) (${sasamsClassrooms} SA-SAMS, ${supplementClassrooms} supplement); expected ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT} SA-SAMS (Crèche supplement optional)`
    );
  }
  if (sasamsClassrooms !== DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
    return gateResult(
      "phase1",
      "Phase 1 — Classes",
      expected,
      actual,
      `SA-SAMS classroom count ${sasamsClassrooms} (expected ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT})`
    );
  }

  return gateResult("phase1", "Phase 1 — Classes", expected, actual, null);
}

export function evaluateDaSilvaPhase2Gate(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult {
  const sasamsClassrooms = countDaSilvaSasamsClassrooms(ctx.classroomNames);
  const phase2Complete = ctx.phasesCompleted.includes("learners");
  const expected = {
    phase1Complete: true,
    sasamsClassrooms: DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
    sasamsLearnersAfterImport: DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
    finalLearnersNotRequiredYet: true,
    crecheNotRequiredYet: true,
  };
  const actual = {
    phase1Complete: ctx.phasesCompleted.includes("classrooms"),
    phase2Complete,
    sasamsClassrooms,
    totalClassrooms: ctx.classroomNames.length,
    learners: ctx.learnerCount,
    crecheLearners: ctx.crecheLearnerCount,
  };

  if (!ctx.phasesCompleted.includes("classrooms")) {
    return gateResult("phase2", "Phase 2 — Learners", expected, actual, "Phase 1 (classrooms) not complete in manifest");
  }
  if (sasamsClassrooms !== DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
    return gateResult(
      "phase2",
      "Phase 2 — Learners",
      expected,
      actual,
      `Database has ${sasamsClassrooms} SA-SAMS classrooms (expected ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT})`
    );
  }

  if (!phase2Complete) {
    if (ctx.learnerCount === 0) {
      return gateResult("phase2", "Phase 2 — Learners", expected, actual, null);
    }
    if (!isAcceptableDaSilvaPhase2LearnerCount(ctx.learnerCount)) {
      return gateResult(
        "phase2",
        "Phase 2 — Learners",
        expected,
        actual,
        `Learner count ${ctx.learnerCount} (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only; final ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} is after Crèche supplement)`
      );
    }
    return gateResult("phase2", "Phase 2 — Learners", expected, actual, null);
  }

  if (!isAcceptableDaSilvaPhase2LearnerCount(ctx.learnerCount)) {
    return gateResult(
      "phase2",
      "Phase 2 — Learners",
      expected,
      actual,
      `Learner count ${ctx.learnerCount} (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only; final ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} is after Crèche supplement)`
    );
  }

  return gateResult("phase2", "Phase 2 — Learners", expected, actual, null);
}

export function evaluateDaSilvaPhase2bGate(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult {
  const expected = {
    sasamsLearners: DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
    crecheSupplementLearners: DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
    finalLearners: DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
    optionalUntilBilling: true,
  };
  const actual = {
    phase2Complete: ctx.phasesCompleted.includes("learners"),
    learners: ctx.learnerCount,
    crecheLearners: ctx.crecheLearnerCount,
    supplementApplied: isAcceptableDaSilvaFinalLearnerCount(ctx.learnerCount),
  };

  if (!ctx.phasesCompleted.includes("learners")) {
    return gateResult(
      "phase2b",
      "Phase 2b — Crèche supplement",
      expected,
      actual,
      null
    );
  }

  if (isAcceptableDaSilvaFinalLearnerCount(ctx.learnerCount)) {
    return gateResult("phase2b", "Phase 2b — Crèche supplement", expected, actual, null);
  }

  if (isAcceptableDaSilvaPhase2LearnerCount(ctx.learnerCount)) {
    return gateResult(
      "phase2b",
      "Phase 2b — Crèche supplement",
      expected,
      actual,
      `Crèche supplement pending: ${ctx.learnerCount} SA-SAMS learners (add ${DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT} Crèche → ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} before billing-dependent phases)`
    );
  }

  return gateResult(
    "phase2b",
    "Phase 2b — Crèche supplement",
    expected,
    actual,
    `Learner count ${ctx.learnerCount} is neither SA-SAMS-only (${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT}) nor final (${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT})`
  );
}

export function evaluateDaSilvaPhase3Gate(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult {
  const expected = {
    sasamsLearnerBase: DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
    finalLearnersOptional: DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
    parentLinksMin: 1,
    parentLinksTarget: DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
  };
  const actual = {
    phase2Complete: ctx.phasesCompleted.includes("learners"),
    learners: ctx.learnerCount,
    crecheLearners: ctx.crecheLearnerCount,
    parentLinks: ctx.parentLinkCount,
  };

  if (!ctx.phasesCompleted.includes("learners")) {
    return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, "Phase 2 (learners) not complete");
  }
  if (ctx.phasesCompleted.includes("parents") && !isAcceptableDaSilvaPhase3LearnerCount(ctx.learnerCount)) {
    return gateResult(
      "phase3",
      "Phase 3 — Parents/Links",
      expected,
      actual,
      `Learner count ${ctx.learnerCount} (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`
    );
  }
  if (!ctx.phasesCompleted.includes("parents")) {
    if (!isAcceptableDaSilvaPhase3LearnerCount(ctx.learnerCount) && ctx.learnerCount > 0) {
      return gateResult(
        "phase3",
        "Phase 3 — Parents/Links",
        expected,
        actual,
        `Learner count ${ctx.learnerCount} (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`
      );
    }
    return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, null);
  }
  if (ctx.parentLinkCount < 1 && ctx.phasesCompleted.includes("parents")) {
    return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, "Parent links must not be 0");
  }
  if (ctx.phasesCompleted.includes("parents") && ctx.parentLinkCount !== DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT) {
    return gateResult(
      "phase3",
      "Phase 3 — Parents/Links",
      expected,
      actual,
      `Parent links ${ctx.parentLinkCount} (expected ${DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT})`
    );
  }

  return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, null);
}

export function evaluateDaSilvaPhase4Gate(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult {
  const unmatched = Math.max(0, ctx.billingTotal - ctx.billingMatched);
  const ratio = ctx.billingTotal > 0 ? ctx.billingMatched / ctx.billingTotal : 0;
  const expected = {
    phase3Complete: true,
    minMatched: DA_SILVA_MIN_BILLING_MATCH_COUNT,
    billingTotal: DA_SILVA_BILLING_ACCOUNT_TARGET,
    maxUnmatchedManualReview: DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
  };
  const actual = {
    phase3Complete: ctx.phasesCompleted.includes("parents"),
    matched: ctx.billingMatched,
    total: ctx.billingTotal,
    unmatched,
    matchRatio: `${(ratio * 100).toFixed(1)}%`,
  };

  if (!ctx.phasesCompleted.includes("parents")) {
    return gateResult("phase4", "Phase 4 — Billing Match", expected, actual, "Phase 3 (parents) not complete");
  }
  if (ctx.billingTotal > 0 && ctx.billingMatched < DA_SILVA_MIN_BILLING_MATCH_COUNT) {
    return gateResult(
      "phase4",
      "Phase 4 — Billing Match",
      expected,
      actual,
      `Billing match ${ctx.billingMatched}/${ctx.billingTotal} (need ≥${DA_SILVA_MIN_BILLING_MATCH_COUNT}; ${unmatched} manual review)`
    );
  }
  const belowRatioAndCap =
    ctx.billingTotal > 0 &&
    ratio < DA_SILVA_BILLING_MATCH_MIN_RATIO &&
    unmatched > DA_SILVA_BILLING_MATCH_MAX_UNMATCHED;
  if (belowRatioAndCap) {
    return gateResult(
      "phase4",
      "Phase 4 — Billing Match",
      expected,
      actual,
      `Billing match ratio ${(ratio * 100).toFixed(1)}% with ${unmatched} unmatched (need ≥${(DA_SILVA_BILLING_MATCH_MIN_RATIO * 100).toFixed(0)}% or ≤${DA_SILVA_BILLING_MATCH_MAX_UNMATCHED} unmatched)`
    );
  }

  return gateResult("phase4", "Phase 4 — Billing Match", expected, actual, null);
}

export function evaluateDaSilvaPhase5Gate(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult {
  const unmatched = Math.max(0, ctx.billingTotal - ctx.billingMatched);
  const expected = {
    phase4Complete: true,
    minBillingMatched: DA_SILVA_MIN_BILLING_MATCH_COUNT,
    learnersSasamsOrFinal: `${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT}|${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT}`,
    manualReviewAccounts: `≤${DA_SILVA_BILLING_MATCH_MAX_UNMATCHED}`,
  };
  const actual = {
    phase4Complete: ctx.phasesCompleted.includes("billing_match"),
    billingMatched: ctx.billingMatched,
    billingTotal: ctx.billingTotal,
    unmatchedManualReview: unmatched,
    learners: ctx.learnerCount,
  };

  if (!ctx.phasesCompleted.includes("billing_match")) {
    return gateResult("phase5", "Phase 5 — Billing/Balances", expected, actual, "Phase 4 (billing match) not complete");
  }
  if (ctx.billingMatched < DA_SILVA_MIN_BILLING_MATCH_COUNT) {
    return gateResult(
      "phase5",
      "Phase 5 — Billing/Balances",
      expected,
      actual,
      `Billing match incomplete: ${ctx.billingMatched}/${ctx.billingTotal} (need ≥${DA_SILVA_MIN_BILLING_MATCH_COUNT})`
    );
  }
  if (!isAcceptableDaSilvaPhase3LearnerCount(ctx.learnerCount)) {
    return gateResult(
      "phase5",
      "Phase 5 — Billing/Balances",
      expected,
      actual,
      `Learner count ${ctx.learnerCount} (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`
    );
  }

  return gateResult("phase5", "Phase 5 — Billing/Balances", expected, actual, null);
}

export function evaluateAllDaSilvaPhaseGates(ctx: DaSilvaPhaseGateSnapshot): DaSilvaPhaseGateResult[] {
  return [
    evaluateDaSilvaPhase1Gate(ctx),
    evaluateDaSilvaPhase2Gate(ctx),
    evaluateDaSilvaPhase2bGate(ctx),
    evaluateDaSilvaPhase3Gate(ctx),
    evaluateDaSilvaPhase4Gate(ctx),
    evaluateDaSilvaPhase5Gate(ctx),
  ];
}

export function assertDaSilvaMigrationGates(opts: {
  phase: DaSilvaMigrationPhase;
  classroomNames?: string[];
  learnerCount?: number;
  crecheLearnerCount?: number;
  parentLinkCount?: number;
  billingMatched?: number;
  billingTotal?: number;
  phasesCompleted?: string[];
  manifestReady?: boolean;
  errors?: string[];
}): void {
  const errors = [...(opts.errors || [])];
  const snapshot: DaSilvaPhaseGateSnapshot = {
    classroomNames: opts.classroomNames || [],
    learnerCount: opts.learnerCount ?? 0,
    crecheLearnerCount: opts.crecheLearnerCount ?? 0,
    parentLinkCount: opts.parentLinkCount ?? 0,
    billingMatched: opts.billingMatched ?? 0,
    billingTotal: opts.billingTotal ?? 0,
    phasesCompleted: opts.phasesCompleted || [],
    manifestReady: opts.manifestReady ?? true,
  };

  const evaluators: Record<DaSilvaMigrationPhase, (ctx: DaSilvaPhaseGateSnapshot) => DaSilvaPhaseGateResult> =
    {
      classrooms: evaluateDaSilvaPhase1Gate,
      learners: evaluateDaSilvaPhase2Gate,
      creche_supplement: evaluateDaSilvaPhase2bGate,
      parents: evaluateDaSilvaPhase3Gate,
      billing_match: evaluateDaSilvaPhase4Gate,
      billing: evaluateDaSilvaPhase5Gate,
    };

  const result = evaluators[opts.phase](snapshot);
  if (result.blocker) errors.push(result.blocker);

  if (errors.length) {
    throw new Error(`Migration stopped at ${opts.phase}: ${errors.join("; ")}`);
  }
}
