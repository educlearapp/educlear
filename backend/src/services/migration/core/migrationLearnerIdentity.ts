/**
 * Migration learner identity — same conceptual safety as live Add Learner,
 * strictly within one school. Surname alone is never identity.
 *
 * Authority (strongest first):
 * 1. usable normalized ID number
 * 2. exact normalized first name + surname + date of birth
 * 3. source-specific stable learner id (admission / learner number)
 *
 * Does not reactivate HISTORICAL learners. Does not match across schools.
 */

import {
  birthDayKey,
  isUsableLearnerIdNumber,
  normaliseLearnerIdNumber,
} from "../../learnerIdentityGuard";

export type MigrationLearnerIdentityClass =
  | "CREATE_NEW"
  | "EXISTING_ACTIVE_LEARNER_REVIEW_LINK"
  | "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW"
  | "DUPLICATE_IN_BATCH"
  | "CROSS_SCHOOL_BLOCKED";

export type MigrationLearnerMatchReason = "idNumber" | "name+dob" | "sourceLearnerId";

export type MigrationLearnerIdentityRecord = {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  idNumber?: string | null;
  birthDate?: Date | string | null;
  admissionNo?: string | null;
  enrollmentStatus?: string | null;
  familyAccountId?: string | null;
};

export type IncomingMigrationLearnerIdentity = {
  schoolId: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  idNumber?: string | null;
  birthDate?: Date | string | null;
  sourceLearnerId?: string | null;
};

export type MigrationLearnerIdentityDecision = {
  classification: MigrationLearnerIdentityClass;
  matchReason?: MigrationLearnerMatchReason;
  existing?: MigrationLearnerIdentityRecord;
  batchKey: string;
  message: string;
};

function compactName(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function splitPersonName(fullOrSingle: string): { firstName: string; lastName: string } {
  const trimmed = String(fullOrSingle || "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

export function learnerNamesFromIdentityInput(
  incoming: IncomingMigrationLearnerIdentity
): { firstName: string; lastName: string } {
  const first = String(incoming.firstName || "").trim();
  const last = String(incoming.lastName || "").trim();
  if (first || last) return { firstName: first, lastName: last };
  return splitPersonName(String(incoming.fullName || ""));
}

export function normalizeSourceLearnerId(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isHistoricalStatus(status: string | null | undefined): boolean {
  return String(status || "ACTIVE").trim().toUpperCase() === "HISTORICAL";
}

/**
 * Stable in-batch / preview keys. Never uses surname-only or name+class.
 * When no strong identity exists, the key is unique per row so we do not merge strangers.
 */
export function migrationLearnerIdentityKeys(
  incoming: IncomingMigrationLearnerIdentity,
  uniqueFallback?: string
): string[] {
  const keys: string[] = [];
  const idNumber = normaliseLearnerIdNumber(incoming.idNumber);
  if (isUsableLearnerIdNumber(idNumber)) keys.push(`id:${idNumber}`);

  const names = learnerNamesFromIdentityInput(incoming);
  const first = compactName(names.firstName);
  const last = compactName(names.lastName);
  const dob = birthDayKey(incoming.birthDate);
  if (first && last && dob) keys.push(`namedob:${first}|${last}|${dob}`);

  const sourceId = normalizeSourceLearnerId(incoming.sourceLearnerId);
  if (sourceId) keys.push(`src:${sourceId}`);

  if (keys.length === 0 && uniqueFallback) keys.push(`row:${uniqueFallback}`);
  return keys;
}

export function primaryMigrationLearnerBatchKey(
  incoming: IncomingMigrationLearnerIdentity,
  uniqueFallback: string
): string {
  const keys = migrationLearnerIdentityKeys(incoming, uniqueFallback);
  return keys[0] || `row:${uniqueFallback}`;
}

function classifyExisting(
  existing: MigrationLearnerIdentityRecord,
  matchReason: MigrationLearnerMatchReason
): MigrationLearnerIdentityDecision {
  const historical = isHistoricalStatus(existing.enrollmentStatus);
  if (historical) {
    return {
      classification: "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW",
      matchReason,
      existing,
      batchKey: existing.id,
      message:
        "EXISTING HISTORICAL LEARNER — REACTIVATION REVIEW. Do not create a duplicate and do not reactivate automatically.",
    };
  }
  return {
    classification: "EXISTING_ACTIVE_LEARNER_REVIEW_LINK",
    matchReason,
    existing,
    batchKey: existing.id,
    message:
      "EXISTING ACTIVE LEARNER — REVIEW / LINK. Do not create a duplicate learner or FamilyAccount.",
  };
}

/**
 * Match an incoming migration learner against same-school records only.
 * Candidates from any other school are ignored (never attached).
 */
export function resolveMigrationLearnerIdentity(input: {
  incoming: IncomingMigrationLearnerIdentity;
  existingInSchool: MigrationLearnerIdentityRecord[];
  seenBatchKeys?: Set<string>;
  uniqueFallback?: string;
}): MigrationLearnerIdentityDecision {
  const schoolId = String(input.incoming.schoolId || "").trim();
  if (!schoolId) {
    return {
      classification: "CROSS_SCHOOL_BLOCKED",
      batchKey: "missing-school",
      message: "Learner identity matching requires a target school — fail closed.",
    };
  }

  const foreign = input.existingInSchool.filter(
    (row) => String(row.schoolId || "").trim() && String(row.schoolId) !== schoolId
  );
  if (foreign.length && foreign.length === input.existingInSchool.length) {
    return {
      classification: "CROSS_SCHOOL_BLOCKED",
      batchKey: "cross-school",
      message: "Cross-school learner matching is blocked. Identity is same-school only.",
    };
  }

  const sameSchool = input.existingInSchool.filter(
    (row) => String(row.schoolId || "").trim() === schoolId
  );

  const incomingId = normaliseLearnerIdNumber(input.incoming.idNumber);
  if (isUsableLearnerIdNumber(incomingId)) {
    const hit = sameSchool.find(
      (row) => normaliseLearnerIdNumber(row.idNumber) === incomingId
    );
    if (hit) return classifyExisting(hit, "idNumber");
  }

  const names = learnerNamesFromIdentityInput(input.incoming);
  const first = compactName(names.firstName);
  const last = compactName(names.lastName);
  const dob = birthDayKey(input.incoming.birthDate);
  if (first && last && dob) {
    const hit = sameSchool.find(
      (row) =>
        compactName(row.firstName) === first &&
        compactName(row.lastName) === last &&
        birthDayKey(row.birthDate) === dob
    );
    if (hit) return classifyExisting(hit, "name+dob");
  }

  const sourceId = normalizeSourceLearnerId(input.incoming.sourceLearnerId);
  if (sourceId) {
    const hit = sameSchool.find(
      (row) => normalizeSourceLearnerId(row.admissionNo) === sourceId
    );
    if (hit) return classifyExisting(hit, "sourceLearnerId");
  }

  const batchKey = primaryMigrationLearnerBatchKey(
    input.incoming,
    input.uniqueFallback || `${first}|${last}|${dob}|${sourceId}`
  );
  if (input.seenBatchKeys?.has(batchKey) && !batchKey.startsWith("row:")) {
    return {
      classification: "DUPLICATE_IN_BATCH",
      batchKey,
      message: "Duplicate learner row in this import — keep one learner.",
    };
  }

  return {
    classification: "CREATE_NEW",
    batchKey,
    message: "No same-school strong identity match — create a new learner.",
  };
}

export function isStrongLearnerIdentity(incoming: IncomingMigrationLearnerIdentity): boolean {
  return migrationLearnerIdentityKeys(incoming).length > 0;
}

export type MigrationLearnerIdentityCandidate = MigrationLearnerIdentityRecord;

export type MigrationLearnerIdentityClassification =
  | "NEW"
  | "EXISTING_ACTIVE_LEARNER_REVIEW_LINK"
  | "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW"
  | "INSUFFICIENT_IDENTITY";

export type MigrationLearnerIdentityHit = {
  learnerId: string;
  schoolId: string;
  enrollmentStatus: string;
  familyAccountId: string | null;
  admissionNo: string | null;
  matchReason: MigrationLearnerMatchReason;
  classification: Exclude<MigrationLearnerIdentityClassification, "NEW" | "INSUFFICIENT_IDENTITY">;
};

function toIncoming(
  incoming: IncomingMigrationLearnerIdentity & { dateOfBirth?: Date | string | null }
): IncomingMigrationLearnerIdentity {
  return {
    ...incoming,
    birthDate: incoming.birthDate ?? incoming.dateOfBirth ?? null,
  };
}

export function migrationLearnerBatchKey(
  incoming: IncomingMigrationLearnerIdentity & { dateOfBirth?: Date | string | null }
): string | null {
  const schoolId = String(incoming.schoolId || "").trim();
  if (!schoolId) return null;
  const keys = migrationLearnerIdentityKeys(toIncoming(incoming));
  if (!keys.length) return null;
  return `school:${schoolId}|${keys[0]}`;
}

export function matchMigrationLearnerInSchool(input: {
  incoming: IncomingMigrationLearnerIdentity & { dateOfBirth?: Date | string | null };
  candidates: MigrationLearnerIdentityCandidate[];
}): MigrationLearnerIdentityHit | null {
  const decision = resolveMigrationLearnerIdentity({
    incoming: toIncoming(input.incoming),
    existingInSchool: input.candidates,
  });
  if (
    decision.classification !== "EXISTING_ACTIVE_LEARNER_REVIEW_LINK" &&
    decision.classification !== "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW"
  ) {
    return null;
  }
  const existing = decision.existing;
  if (!existing) return null;
  return {
    learnerId: existing.id,
    schoolId: existing.schoolId,
    enrollmentStatus: String(existing.enrollmentStatus || "ACTIVE"),
    familyAccountId: existing.familyAccountId || null,
    admissionNo: existing.admissionNo || null,
    matchReason: decision.matchReason || "idNumber",
    classification: decision.classification,
  };
}

export function classifyMigrationLearnerIdentity(input: {
  incoming: IncomingMigrationLearnerIdentity & { dateOfBirth?: Date | string | null };
  candidates: MigrationLearnerIdentityCandidate[];
}): {
  classification: MigrationLearnerIdentityClassification;
  hit: MigrationLearnerIdentityHit | null;
  operatorMessage: string;
} {
  const hit = matchMigrationLearnerInSchool(input);
  if (hit) {
    return {
      classification: hit.classification,
      hit,
      operatorMessage:
        hit.classification === "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW"
          ? "EXISTING HISTORICAL LEARNER — REACTIVATION REVIEW. This learner already exists as historical. Do not create a duplicate. Reactivation is not automatic."
          : "EXISTING ACTIVE LEARNER — REVIEW / LINK. This learner already exists at this school. Do not create a duplicate.",
    };
  }
  if (!migrationLearnerBatchKey(input.incoming)) {
    const names = learnerNamesFromIdentityInput(toIncoming(input.incoming));
    if (names.firstName || names.lastName) {
      return {
        classification: "INSUFFICIENT_IDENTITY",
        hit: null,
        operatorMessage:
          "REVIEW REQUIRED. Name alone is not enough to match or create a learner safely. Add ID number, date of birth, or a source learner number.",
      };
    }
  }
  return {
    classification: "NEW",
    hit: null,
    operatorMessage: "New learner for this school.",
  };
}

export function allocateMigrationAdmissionNo(input: {
  learnerNumber?: string | null;
  accountNumber?: string | null;
  takenAdmissionNos: Set<string>;
}): string | null {
  const learnerNumber = String(input.learnerNumber || "").trim();
  if (learnerNumber) return learnerNumber;
  const accountNumber = String(input.accountNumber || "").trim();
  if (accountNumber && !input.takenAdmissionNos.has(accountNumber.toUpperCase())) {
    return accountNumber;
  }
  return null;
}
