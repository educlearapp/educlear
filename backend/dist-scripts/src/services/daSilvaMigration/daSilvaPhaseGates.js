"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDaSilvaPhase1Gate = evaluateDaSilvaPhase1Gate;
exports.evaluateDaSilvaPhase2Gate = evaluateDaSilvaPhase2Gate;
exports.evaluateDaSilvaPhase2bGate = evaluateDaSilvaPhase2bGate;
exports.evaluateDaSilvaPhase3Gate = evaluateDaSilvaPhase3Gate;
exports.evaluateDaSilvaPhase4Gate = evaluateDaSilvaPhase4Gate;
exports.evaluateDaSilvaPhase5Gate = evaluateDaSilvaPhase5Gate;
exports.evaluateAllDaSilvaPhaseGates = evaluateAllDaSilvaPhaseGates;
exports.assertDaSilvaMigrationGates = assertDaSilvaMigrationGates;
const daSilvaConstants_1 = require("./daSilvaConstants");
function gateResult(phase, label, expected, actual, blocker) {
    return { phase, label, passed: blocker === null, expected, actual, blocker };
}
function evaluateDaSilvaPhase1Gate(ctx) {
    const sasamsClassrooms = (0, daSilvaConstants_1.countDaSilvaSasamsClassrooms)(ctx.classroomNames);
    const supplementClassrooms = (0, daSilvaConstants_1.countDaSilvaSupplementClassrooms)(ctx.classroomNames);
    const totalClassrooms = ctx.classroomNames.length;
    const expected = {
        manifestReady: true,
        sasamsClassrooms: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
        totalClassroomsMin: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
        totalClassroomsMax: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT + 1,
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
    if (ctx.sasamsClassListFileCount !== undefined && ctx.sasamsClassListFileCount !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
        return gateResult("phase1", "Phase 1 — Classes", expected, actual, `Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT} SA-SAMS class list files, found ${ctx.sasamsClassListFileCount}`);
    }
    if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase1DbClassroomTotal)(totalClassrooms, supplementClassrooms)) {
        return gateResult("phase1", "Phase 1 — Classes", expected, actual, `Database has ${totalClassrooms} classroom(s) (${sasamsClassrooms} SA-SAMS, ${supplementClassrooms} supplement); expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT} SA-SAMS (Crèche supplement optional)`);
    }
    if (sasamsClassrooms !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
        return gateResult("phase1", "Phase 1 — Classes", expected, actual, `SA-SAMS classroom count ${sasamsClassrooms} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT})`);
    }
    return gateResult("phase1", "Phase 1 — Classes", expected, actual, null);
}
function evaluateDaSilvaPhase2Gate(ctx) {
    const sasamsClassrooms = (0, daSilvaConstants_1.countDaSilvaSasamsClassrooms)(ctx.classroomNames);
    const phase2Complete = ctx.phasesCompleted.includes("learners");
    const expected = {
        phase1Complete: true,
        sasamsClassrooms: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
        sasamsLearnersAfterImport: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
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
    if (sasamsClassrooms !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
        return gateResult("phase2", "Phase 2 — Learners", expected, actual, `Database has ${sasamsClassrooms} SA-SAMS classrooms (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT})`);
    }
    if (!phase2Complete) {
        if (ctx.learnerCount === 0) {
            return gateResult("phase2", "Phase 2 — Learners", expected, actual, null);
        }
        if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase2LearnerCount)(ctx.learnerCount)) {
            return gateResult("phase2", "Phase 2 — Learners", expected, actual, `Learner count ${ctx.learnerCount} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only; final ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} is after Crèche supplement)`);
        }
        return gateResult("phase2", "Phase 2 — Learners", expected, actual, null);
    }
    if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase2LearnerCount)(ctx.learnerCount)) {
        return gateResult("phase2", "Phase 2 — Learners", expected, actual, `Learner count ${ctx.learnerCount} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only; final ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} is after Crèche supplement)`);
    }
    return gateResult("phase2", "Phase 2 — Learners", expected, actual, null);
}
function evaluateDaSilvaPhase2bGate(ctx) {
    const expected = {
        sasamsLearners: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
        crecheSupplementLearners: daSilvaConstants_1.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
        finalLearners: daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
        optionalUntilBilling: true,
    };
    const actual = {
        phase2Complete: ctx.phasesCompleted.includes("learners"),
        learners: ctx.learnerCount,
        crecheLearners: ctx.crecheLearnerCount,
        supplementApplied: (0, daSilvaConstants_1.isAcceptableDaSilvaFinalLearnerCount)(ctx.learnerCount),
    };
    if (!ctx.phasesCompleted.includes("learners")) {
        return gateResult("phase2b", "Phase 2b — Crèche supplement", expected, actual, null);
    }
    if ((0, daSilvaConstants_1.isAcceptableDaSilvaFinalLearnerCount)(ctx.learnerCount)) {
        return gateResult("phase2b", "Phase 2b — Crèche supplement", expected, actual, null);
    }
    if ((0, daSilvaConstants_1.isAcceptableDaSilvaPhase2LearnerCount)(ctx.learnerCount)) {
        return gateResult("phase2b", "Phase 2b — Crèche supplement", expected, actual, `Crèche supplement pending: ${ctx.learnerCount} SA-SAMS learners (add ${daSilvaConstants_1.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT} Crèche → ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} before billing-dependent phases)`);
    }
    return gateResult("phase2b", "Phase 2b — Crèche supplement", expected, actual, `Learner count ${ctx.learnerCount} is neither SA-SAMS-only (${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT}) nor final (${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT})`);
}
function evaluateDaSilvaPhase3Gate(ctx) {
    const expected = {
        sasamsLearnerBase: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
        finalLearnersOptional: daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
        parentLinksMin: 1,
        parentLinksTarget: daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
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
    if (ctx.phasesCompleted.includes("parents") && !(0, daSilvaConstants_1.isAcceptableDaSilvaPhase3LearnerCount)(ctx.learnerCount)) {
        return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, `Learner count ${ctx.learnerCount} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`);
    }
    if (!ctx.phasesCompleted.includes("parents")) {
        if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase3LearnerCount)(ctx.learnerCount) && ctx.learnerCount > 0) {
            return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, `Learner count ${ctx.learnerCount} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`);
        }
        return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, null);
    }
    if (ctx.parentLinkCount < 1 && ctx.phasesCompleted.includes("parents")) {
        return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, "Parent links must not be 0");
    }
    if (ctx.phasesCompleted.includes("parents") && ctx.parentLinkCount !== daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT) {
        return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, `Parent links ${ctx.parentLinkCount} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT})`);
    }
    return gateResult("phase3", "Phase 3 — Parents/Links", expected, actual, null);
}
function evaluateDaSilvaPhase4Gate(ctx) {
    const unmatched = Math.max(0, ctx.billingTotal - ctx.billingMatched);
    const ratio = ctx.billingTotal > 0 ? ctx.billingMatched / ctx.billingTotal : 0;
    const expected = {
        phase3Complete: true,
        minMatched: daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT,
        billingTotal: daSilvaConstants_1.DA_SILVA_BILLING_ACCOUNT_TARGET,
        maxUnmatchedManualReview: daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
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
    if (ctx.billingTotal > 0 && ctx.billingMatched < daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT) {
        return gateResult("phase4", "Phase 4 — Billing Match", expected, actual, `Billing match ${ctx.billingMatched}/${ctx.billingTotal} (need ≥${daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT}; ${unmatched} manual review)`);
    }
    const belowRatioAndCap = ctx.billingTotal > 0 &&
        ratio < daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MIN_RATIO &&
        unmatched > daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED;
    if (belowRatioAndCap) {
        return gateResult("phase4", "Phase 4 — Billing Match", expected, actual, `Billing match ratio ${(ratio * 100).toFixed(1)}% with ${unmatched} unmatched (need ≥${(daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MIN_RATIO * 100).toFixed(0)}% or ≤${daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED} unmatched)`);
    }
    return gateResult("phase4", "Phase 4 — Billing Match", expected, actual, null);
}
function evaluateDaSilvaPhase5Gate(ctx) {
    const unmatched = Math.max(0, ctx.billingTotal - ctx.billingMatched);
    const expected = {
        phase4Complete: true,
        minBillingMatched: daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT,
        learnersSasamsOrFinal: `${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT}|${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT}`,
        manualReviewAccounts: `≤${daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED}`,
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
    if (ctx.billingMatched < daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT) {
        return gateResult("phase5", "Phase 5 — Billing/Balances", expected, actual, `Billing match incomplete: ${ctx.billingMatched}/${ctx.billingTotal} (need ≥${daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT})`);
    }
    if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase3LearnerCount)(ctx.learnerCount)) {
        return gateResult("phase5", "Phase 5 — Billing/Balances", expected, actual, `Learner count ${ctx.learnerCount} (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`);
    }
    return gateResult("phase5", "Phase 5 — Billing/Balances", expected, actual, null);
}
function evaluateAllDaSilvaPhaseGates(ctx) {
    return [
        evaluateDaSilvaPhase1Gate(ctx),
        evaluateDaSilvaPhase2Gate(ctx),
        evaluateDaSilvaPhase2bGate(ctx),
        evaluateDaSilvaPhase3Gate(ctx),
        evaluateDaSilvaPhase4Gate(ctx),
        evaluateDaSilvaPhase5Gate(ctx),
    ];
}
function assertDaSilvaMigrationGates(opts) {
    const errors = [...(opts.errors || [])];
    const snapshot = {
        classroomNames: opts.classroomNames || [],
        learnerCount: opts.learnerCount ?? 0,
        crecheLearnerCount: opts.crecheLearnerCount ?? 0,
        parentLinkCount: opts.parentLinkCount ?? 0,
        billingMatched: opts.billingMatched ?? 0,
        billingTotal: opts.billingTotal ?? 0,
        phasesCompleted: opts.phasesCompleted || [],
        manifestReady: opts.manifestReady ?? true,
    };
    const evaluators = {
        classrooms: evaluateDaSilvaPhase1Gate,
        learners: evaluateDaSilvaPhase2Gate,
        creche_supplement: evaluateDaSilvaPhase2bGate,
        parents: evaluateDaSilvaPhase3Gate,
        billing_match: evaluateDaSilvaPhase4Gate,
        billing: evaluateDaSilvaPhase5Gate,
    };
    const result = evaluators[opts.phase](snapshot);
    if (result.blocker)
        errors.push(result.blocker);
    if (errors.length) {
        throw new Error(`Migration stopped at ${opts.phase}: ${errors.join("; ")}`);
    }
}
