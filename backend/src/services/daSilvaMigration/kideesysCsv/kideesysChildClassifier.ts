import { pickCsvField } from "./kideesysCsvParser";

/**
 * Official Kid-e-Sys `child.csv` column meanings (Da Silva export proof):
 *
 * | CSV column        | Role |
 * |-------------------|------|
 * | child_id          | Stable learner key → manifest childIdToLearnerId |
 * | account_no        | Billing family / admission base (e.g. RUW002) |
 * | child_active      | Enrolment flag: "Yes" = current, "No" = inactive/historical |
 * | child_name        | First name |
 * | child_surname     | Surname |
 * | child_id_no       | SA ID / ID number (optional) |
 * | classroom         | Class label (e.g. "Grade 8A", "Creche 2026") or "No Classroom" |
 * | enrollment_date   | Enrolment date (NOT date of birth) |
 * | monthly_fees      | Fee amount |
 *
 * Gender is NOT exported in official child.csv — enrich from SA-SAMS or SA ID inference.
 */

export type KidESysChildEnrollmentTier = "ACTIVE" | "HISTORICAL";

export type KidESysChildClassification = {
  enrollmentStatus: KidESysChildEnrollmentTier;
  childActive: string;
  classroomRaw: string;
  hasValidClassroom: boolean;
  reasons: string[];
};

const INACTIVE_ACTIVE_VALUES = new Set(["no", "0", "false", "inactive", "n"]);
const ACTIVE_YES_VALUES = new Set(["yes", "1", "true", "y", "active", "current", "enrolled"]);

function isNoClassroomLabel(classroom: string): boolean {
  const c = classroom.trim().toLowerCase();
  if (!c) return true;
  return (
    c === "no classroom" ||
    c === "no class" ||
    c === "none" ||
    c === "n/a" ||
    c === "na" ||
    c === "-" ||
    c === "unassigned"
  );
}

/**
 * Canonical Kid-e-Sys child row classifier (child.csv source of truth).
 * ACTIVE = child_active Yes AND valid classroom (includes "Creche 2026").
 * HISTORICAL = child_active No, No Classroom, withdrawn/archived indicators, or left date.
 */
export function classifyKidESysChildRow(row: Record<string, string>): KidESysChildClassification {
  const reasons: string[] = [];
  const childActive = pickCsvField(row, ["child_active", "active", "is_active"]);
  const classroomRaw = pickCsvField(row, [
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

  const status = pickCsvField(row, [
    "status",
    "enrollment_status",
    "learner_status",
    "child_status",
  ]).toLowerCase();
  if (/historical|inactive|left|withdrawn|archived|former/.test(status)) {
    reasons.push(`status=${status}`);
  }

  if (pickCsvField(row, ["left_date", "date_left", "withdrawal_date", "end_date"])) {
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

export function isKidESysChildRowActive(row: Record<string, string>): boolean {
  return classifyKidESysChildRow(row).enrollmentStatus === "ACTIVE";
}
