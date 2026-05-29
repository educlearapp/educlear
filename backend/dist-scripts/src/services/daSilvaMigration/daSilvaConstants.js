"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS = exports.DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS = exports.DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL = exports.DA_SILVA_EXPECTED_PARENT_COUNT = exports.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT = exports.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT = exports.DA_SILVA_EXPECTED_PARENT_LINK_COUNT = exports.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT = exports.DA_SILVA_BILLING_MATCH_MIN_RATIO = exports.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED = exports.DA_SILVA_BILLING_ACCOUNT_TARGET = exports.DA_SILVA_MIN_BILLING_MATCH_COUNT = exports.DA_SILVA_EXPECTED_CLASSROOM_COUNT = exports.DA_SILVA_EXPECTED_FINAL_CLASSROOM_COUNT = exports.DA_SILVA_EXPECTED_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_CREche_SUPPLEMENT_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT = exports.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS = void 0;
exports.isAllowedDaSilvaSupplementClassroom = isAllowedDaSilvaSupplementClassroom;
exports.partitionDaSilvaClassroomNames = partitionDaSilvaClassroomNames;
exports.countDaSilvaSasamsClassrooms = countDaSilvaSasamsClassrooms;
exports.countDaSilvaSupplementClassrooms = countDaSilvaSupplementClassrooms;
exports.isAcceptableDaSilvaPhase2LearnerCount = isAcceptableDaSilvaPhase2LearnerCount;
exports.isAcceptableDaSilvaFinalLearnerCount = isAcceptableDaSilvaFinalLearnerCount;
exports.isAcceptableDaSilvaPhase3LearnerCount = isAcceptableDaSilvaPhase3LearnerCount;
exports.isAcceptableDaSilvaPhase1DbClassroomTotal = isAcceptableDaSilvaPhase1DbClassroomTotal;
/** Shared Da Silva migration constants (no service imports — avoids circular deps). */
exports.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS = ["MAR005"];
/** SA-SAMS class list `.xls` files and canonical classrooms (Crèche is not exported from SA-SAMS). */
exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT = 20;
/** @deprecated Alias — use {@link DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT}. */
exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT;
/** Learners parsed from SA-SAMS class lists only (no Crèche file). */
exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT = 388;
/** Crèche / Kid-e-Sys supplement — not in SA-SAMS class lists. */
exports.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT = 8;
/** @deprecated Typo alias — use {@link DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT}. */
exports.DA_SILVA_EXPECTED_CREche_SUPPLEMENT_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT;
/** Final active learners after SA-SAMS (388) + Crèche supplement (8). */
exports.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT = 396;
/** @deprecated Use {@link DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT}. */
exports.DA_SILVA_EXPECTED_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT;
/** Total classrooms after full import (20 SA-SAMS + optional Crèche supplement classroom). */
exports.DA_SILVA_EXPECTED_FINAL_CLASSROOM_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT + 1;
/**
 * @deprecated Phase gates must use {@link DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT} (20).
 * Final roster may reach {@link DA_SILVA_EXPECTED_FINAL_CLASSROOM_COUNT} after Crèche supplement.
 */
exports.DA_SILVA_EXPECTED_CLASSROOM_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT;
/** Minimum matched Kid-e-Sys billing accounts before phase 5 (344 total; ≤19 manual review). */
exports.DA_SILVA_MIN_BILLING_MATCH_COUNT = 325;
/** Distinct Kid-e-Sys billing accounts in age analysis. */
exports.DA_SILVA_BILLING_ACCOUNT_TARGET = 344;
/** Max unmatched billing accounts allowed when ratio gate is borderline. */
exports.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED = 19;
/** Minimum share of Kid-e-Sys billing accounts that must match before phase 5. */
exports.DA_SILVA_BILLING_MATCH_MIN_RATIO = 0.97;
/** Parent link rows expected from SA-SAMS parent_learner_links.xls. */
exports.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT = 653;
/** Legacy Kid-e-Sys contact-list parent slots (repair scripts only). */
exports.DA_SILVA_EXPECTED_PARENT_LINK_COUNT = 330;
/** Distinct parent people after Kid-e-Sys dedupe (repair scripts only). */
exports.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT = 290;
/** Distinct billing account refs in Kid-e-Sys age analysis. */
exports.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT = exports.DA_SILVA_BILLING_ACCOUNT_TARGET;
/** @deprecated Use {@link DA_SILVA_EXPECTED_PARENT_LINK_COUNT}. */
exports.DA_SILVA_EXPECTED_PARENT_COUNT = exports.DA_SILVA_EXPECTED_PARENT_LINK_COUNT;
/** Kid-e-Sys supplement classroom — not exported from SA-SAMS; may exist in DB without ghost failure. */
exports.DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL = "Creche";
/** Per-class counts including Crèche supplement (full school roster). */
exports.DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS = {
    Creche: 8,
    "Grade 1A": 19,
    "Grade 1B": 18,
    "Grade 1C": 16,
    "Grade 2A": 24,
    "Grade 2B": 21,
    "Grade 3A": 22,
    "Grade 3B": 20,
    "Grade 4A": 22,
    "Grade 4B": 23,
    "Grade 5A": 23,
    "Grade 5B": 19,
    "Grade 6A": 23,
    "Grade 6B": 10,
    "Grade 6C": 22,
    "Grade 7A": 19,
    "Grade 7B": 20,
    "Grade 8A": 17,
    "Grade 8B": 18,
    "Grade Ra": 16,
    "Grade Rb": 16,
};
/** SA-SAMS class list per-class counts (excludes Crèche — not on SA-SAMS). */
exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS = Object.fromEntries(Object.entries(exports.DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS).filter(([name]) => name !== "Creche"));
/** True when `name` is the allowed Crèche / Kid-e-Sys supplement (not SA-SAMS). */
function isAllowedDaSilvaSupplementClassroom(name) {
    const t = String(name || "").trim();
    if (!t)
        return false;
    if (/^(creche|cr[eè]che)$/i.test(t))
        return true;
    return t === exports.DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL;
}
function partitionDaSilvaClassroomNames(names) {
    const sasams = [];
    const supplements = [];
    for (const name of names) {
        if (isAllowedDaSilvaSupplementClassroom(name))
            supplements.push(name);
        else
            sasams.push(name);
    }
    return { sasams, supplements };
}
function countDaSilvaSasamsClassrooms(names) {
    return partitionDaSilvaClassroomNames(names).sasams.length;
}
function countDaSilvaSupplementClassrooms(names) {
    return partitionDaSilvaClassroomNames(names).supplements.length;
}
/** Phase 2 — SA-SAMS learners only (388). */
function isAcceptableDaSilvaPhase2LearnerCount(count) {
    return count === exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT;
}
/** Phase 2b — after Crèche supplement (396). */
function isAcceptableDaSilvaFinalLearnerCount(count) {
    return count === exports.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT;
}
/** Phase 3+ — SA-SAMS base complete; Crèche supplement optional until phase 2b. */
function isAcceptableDaSilvaPhase3LearnerCount(count) {
    return (count === exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT ||
        count === exports.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT);
}
/** Phase 1 DB classroom total: 20 SA-SAMS required; Crèche supplement optional (not required). */
function isAcceptableDaSilvaPhase1DbClassroomTotal(totalCount, supplementCount) {
    const sasamsCount = totalCount - supplementCount;
    if (sasamsCount !== exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT)
        return false;
    if (supplementCount > 1)
        return false;
    return totalCount === exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT || totalCount === exports.DA_SILVA_EXPECTED_FINAL_CLASSROOM_COUNT;
}
