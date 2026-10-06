import { getBirthDateFromSouthAfricanId } from "./learnerIdentity";

type LearnerRecord = Record<string, unknown>;

function asRecord(value: unknown): LearnerRecord {
  return value && typeof value === "object" ? (value as LearnerRecord) : {};
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * The learner's assigned class (Learner.className) — never the grade.
 * API `classroom` / `classroomName` fall back to grade, so `className` wins whenever present.
 */
export function assignedClassName(learner: unknown): string {
  const l = asRecord(learner);
  if (Object.prototype.hasOwnProperty.call(l, "className")) {
    return text(l.className).trim();
  }
  return text(l.classroomName ?? l.classroom).trim();
}

/** Apply one or more Manage Learner field edits, keeping alias fields in sync. */
export function applyLearnerFieldPatch(learner: unknown, patch: LearnerRecord): LearnerRecord {
  const updated: LearnerRecord = { ...asRecord(learner) };
  for (const [key, value] of Object.entries(patch)) {
    updated[key] = value;

    if (key === "idNumber" || key === "idNo") {
      updated.idNumber = value;
      updated.idNo = value;
      const extractedBirthDate = getBirthDateFromSouthAfricanId(text(value));
      if (extractedBirthDate) {
        updated.birthDate = extractedBirthDate;
        updated.dateOfBirth = extractedBirthDate;
      }
    }

    if (key === "birthDate") {
      updated.birthDate = value;
      updated.dateOfBirth = value;
    }

    if (key === "classroom") {
      updated.className = value;
      updated.classroomName = value;
    }

    if (key === "className") {
      updated.classroom = value;
      updated.classroomName = value;
    }
  }
  return updated;
}

/**
 * PUT /api/learners/:id body for the Manage Learner Save button.
 * Optional profile fields are only sent when present on the loaded learner so a partially
 * loaded profile cannot blank them.
 */
export function buildManageLearnerSavePayload(learner: unknown): LearnerRecord {
  const l = asRecord(learner);
  const className = assignedClassName(l);
  const payload: LearnerRecord = {
    firstName: text(l.firstName),
    lastName: text(l.lastName || l.surname),
    gender: text(l.gender),
    birthDate: text(l.birthDate || l.dateOfBirth),
    religion: text(l.religion),
    enrolmentDate: text(l.enrolmentDate),
    idNumber: text(l.idNumber || l.idNo),
    className,
    classroom: className,
    classroomName: className,
  };
  if (l.homeLanguage !== undefined) payload.homeLanguage = text(l.homeLanguage);
  const nationality = l.nationality ?? l.citizenship;
  if (nationality !== undefined) payload.nationality = text(nationality);
  if (l.notes !== undefined) payload.notes = text(l.notes);
  return payload;
}
