"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_LEARNER_WHERE = void 0;
exports.activeLearnerWhere = activeLearnerWhere;
exports.isHistoricalEnrollmentStatus = isHistoricalEnrollmentStatus;
/** Learners on current class lists — counted in dashboard and classroom totals. */
exports.ACTIVE_LEARNER_WHERE = {
    enrollmentStatus: "ACTIVE",
};
function activeLearnerWhere(schoolId) {
    return { schoolId, ...exports.ACTIVE_LEARNER_WHERE };
}
function isHistoricalEnrollmentStatus(status) {
    return String(status || "").toUpperCase() === "HISTORICAL";
}
