"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyKidESysChildRow = classifyKidESysChildRow;
exports.isKidESysChildRowActive = isKidESysChildRowActive;
const kideesysCsvParser_1 = require("./kideesysCsvParser");
const INACTIVE_ACTIVE_VALUES = new Set(["no", "0", "false", "inactive", "n"]);
const ACTIVE_YES_VALUES = new Set(["yes", "1", "true", "y", "active", "current", "enrolled"]);
function isNoClassroomLabel(classroom) {
    const c = classroom.trim().toLowerCase();
    if (!c)
        return true;
    return (c === "no classroom" ||
        c === "no class" ||
        c === "none" ||
        c === "n/a" ||
        c === "na" ||
        c === "-" ||
        c === "unassigned");
}
/**
 * Canonical Kid-e-Sys child row classifier (child.csv source of truth).
 * ACTIVE = child_active Yes AND valid classroom (includes "Creche 2026").
 * HISTORICAL = child_active No, No Classroom, withdrawn/archived indicators, or left date.
 */
function classifyKidESysChildRow(row) {
    const reasons = [];
    const childActive = (0, kideesysCsvParser_1.pickCsvField)(row, ["child_active", "active", "is_active"]);
    const classroomRaw = (0, kideesysCsvParser_1.pickCsvField)(row, [
        "classroom",
        "class_name",
        "class",
        "grade_class",
        "grade",
    ]);
    const activeNorm = childActive.trim().toLowerCase();
    const hasValidClassroom = !isNoClassroomLabel(classroomRaw);
    if (activeNorm && INACTIVE_ACTIVE_VALUES.has(activeNorm)) {
        reasons.push(`child_active=${childActive}`);
    }
    const status = (0, kideesysCsvParser_1.pickCsvField)(row, [
        "status",
        "enrollment_status",
        "learner_status",
        "child_status",
    ]).toLowerCase();
    if (/historical|inactive|left|withdrawn|archived|former/.test(status)) {
        reasons.push(`status=${status}`);
    }
    if ((0, kideesysCsvParser_1.pickCsvField)(row, ["left_date", "date_left", "withdrawal_date", "end_date"])) {
        reasons.push("left_date");
    }
    if (!hasValidClassroom) {
        reasons.push(classroomRaw ? `classroom=${classroomRaw}` : "classroom_empty");
    }
    const forceHistorical = reasons.length > 0;
    if (forceHistorical) {
        return {
            enrollmentStatus: "HISTORICAL",
            childActive,
            classroomRaw,
            hasValidClassroom,
            reasons,
        };
    }
    if (activeNorm && ACTIVE_YES_VALUES.has(activeNorm) && hasValidClassroom) {
        return {
            enrollmentStatus: "ACTIVE",
            childActive,
            classroomRaw,
            hasValidClassroom,
            reasons: ["child_active_yes", "valid_classroom"],
        };
    }
    if (!childActive.trim() && hasValidClassroom) {
        return {
            enrollmentStatus: "ACTIVE",
            childActive,
            classroomRaw,
            hasValidClassroom,
            reasons: ["valid_classroom_only"],
        };
    }
    return {
        enrollmentStatus: "HISTORICAL",
        childActive,
        classroomRaw,
        hasValidClassroom,
        reasons: [...reasons, childActive ? `child_active=${childActive}` : "child_active_missing"],
    };
}
function isKidESysChildRowActive(row) {
    return classifyKidESysChildRow(row).enrollmentStatus === "ACTIVE";
}
