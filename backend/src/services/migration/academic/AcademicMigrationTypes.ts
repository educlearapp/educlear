/**
 * Phase 1J — Academic Migration types (source-agnostic).
 * Persists to EduClear Classroom / Learner.grade+className / SchoolSubject / Group.
 * No parallel academic SoT models.
 */

export const ACADEMIC_MIGRATION_VERSION = "1J.1" as const;

export type AcademicConfidence = "HIGH" | "MEDIUM" | "LOW";

export type AcademicMatchState =
  | "AUTO_MATCH"
  | "REVIEW_REQUIRED"
  | "UNRESOLVED"
  | "MATCHED"
  | "UNPLACED"
  | "IGNORED"
  | "ACCEPTED";

export type AcademicSeverity = "CRITICAL" | "NON_CRITICAL" | "INFO";

export type SourceEvidence = {
  sourceFileId?: string;
  sourceFilename?: string;
  column?: string;
  sourceValue: string;
  rowCount: number;
  sampleRowNumbers?: number[];
};

export type AcademicGradeProposal = {
  proposalId: string;
  sourceValue: string;
  proposedLabel: string;
  normalizeKey: string;
  confidence: AcademicConfidence;
  matchState: AcademicMatchState;
  learnerCount: number;
  evidence: SourceEvidence[];
  warnings: string[];
  existingEduClearReuse: boolean;
};

export type AcademicClassProposal = {
  proposalId: string;
  sourceValue: string;
  proposedClassroomName: string;
  matchKey: string;
  gradeLabel: string | null;
  confidence: AcademicConfidence;
  matchState: AcademicMatchState;
  learnerCount: number;
  evidence: SourceEvidence[];
  warnings: string[];
  existingClassroomId: string | null;
  importYear: number | null;
  isHistoricalSuspect: boolean;
};

export type AcademicGroupProposal = {
  proposalId: string;
  sourceValue: string;
  proposedName: string;
  confidence: AcademicConfidence;
  matchState: AcademicMatchState;
  severity: AcademicSeverity;
  learnerCount: number;
  evidence: SourceEvidence[];
  warnings: string[];
  /** Only apply when clearly Group semantics, not classroom. */
  safeToApplyAsGroup: boolean;
};

export type AcademicSubjectProposal = {
  proposalId: string;
  sourceValue: string;
  proposedName: string;
  normalizeKey: string;
  subjectCode: string | null;
  confidence: AcademicConfidence;
  matchState: AcademicMatchState;
  learnerCount: number;
  evidence: SourceEvidence[];
  warnings: string[];
  existingSubjectId: string | null;
  possibleDuplicateOf: string | null;
};

export type AcademicLearnerPlacement = {
  placementId: string;
  learnerKey: string;
  learnerIdNumber: string | null;
  admissionNo: string | null;
  learnerName: string;
  sourceGrade: string | null;
  sourceClass: string | null;
  proposedClassroomName: string | null;
  proposedGrade: string | null;
  state: "MATCHED" | "REVIEW_REQUIRED" | "UNPLACED" | "ACCEPTED";
  severity: AcademicSeverity;
  confidence: AcademicConfidence;
  warnings: string[];
  evidence: SourceEvidence[];
  canonicalLearnerId: string | null;
  academicYear: string | null;
};

export type AcademicSubjectEnrollment = {
  enrollmentId: string;
  learnerKey: string;
  sourceSubject: string;
  proposedSubjectName: string;
  scope: "LEARNER_LEVEL" | "CLASS_LEVEL";
  /**
   * EduClear has no LearnerSubject model — LEARNER_LEVEL cannot be persisted as enrollment.
   * Applied as SchoolSubject catalog only; enrollment rows stay documented.
   */
  persistMode: "SCHOOL_SUBJECT_CATALOG" | "UNSUPPORTED_LEARNER_ENROLLMENT";
  confidence: AcademicConfidence;
  matchState: AcademicMatchState;
  severity: AcademicSeverity;
  warnings: string[];
};

export type AcademicTeacherAssignment = {
  assignmentId: string;
  sourceTeacherName: string;
  sourceTeacherEmail: string | null;
  proposedClassroomName: string | null;
  state: "MATCHED_EXISTING" | "PROPOSED_NEW_STAFF" | "REVIEW_REQUIRED" | "UNRESOLVED";
  severity: AcademicSeverity;
  confidence: AcademicConfidence;
  matchedUserId: string | null;
  warnings: string[];
  /** Phase 1J: do not auto-create staff; REVIEW / document for later phase. */
  applyAllowed: boolean;
};

export type AcademicStructureDiscovery = {
  discoveryId: string;
  version: typeof ACADEMIC_MIGRATION_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  detectedGrades: number;
  detectedClasses: number;
  detectedSubjects: number;
  detectedGroups: number;
  learnersWithClearPrimaryClass: number;
  learnersWithAmbiguousClass: number;
  learnersWithNoClass: number;
  subjectsConfident: number;
  possibleDuplicateSubjects: number;
  teacherLinksConfident: number;
  teacherLinksNeedingReview: number;
  plainLanguage: string[];
};

export type AcademicMigrationPlan = {
  planId: string;
  version: typeof ACADEMIC_MIGRATION_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  sourceAnalysisId: string | null;
  compiledPlanId: string | null;
  discoveryId: string;
  fingerprint: string;
  academicYearContext: string | null;
  grades: AcademicGradeProposal[];
  classes: AcademicClassProposal[];
  groups: AcademicGroupProposal[];
  subjects: AcademicSubjectProposal[];
  learnerPlacements: AcademicLearnerPlacement[];
  subjectEnrollments: AcademicSubjectEnrollment[];
  teacherAssignments: AcademicTeacherAssignment[];
  warnings: string[];
  reviewItems: Array<{
    kind: string;
    proposalId: string;
    message: string;
    severity: AcademicSeverity;
  }>;
  criticalUnresolvedCount: number;
  nonCriticalUnresolvedCount: number;
  stale: boolean;
};

export type AcademicStructureCheck = {
  checkId: string;
  version: typeof ACADEMIC_MIGRATION_VERSION;
  generatedAt: string;
  targetSchoolId: string;
  stageId: string | null;
  academicPlanId: string;
  gradesExpected: number;
  gradesMatched: number;
  classesExpected: number;
  classesMatched: number;
  placementsExpected: number;
  placementsMatched: number;
  placementsUnresolved: number;
  subjectsExpected: number;
  subjectsMatched: number;
  subjectEnrollmentsDetected: number;
  subjectEnrollmentsCatalogApplied: number;
  subjectEnrollmentsUnsupportedLearnerLevel: number;
  academicStructureMatch: boolean;
  academicReviewRequired: boolean;
  status: "ACADEMIC_STRUCTURE_MATCH" | "ACADEMIC_REVIEW_REQUIRED" | "ACADEMIC_STALE";
  blockedReasons: string[];
  stale: boolean;
  plainLanguage: string[];
};

export type AcademicApplyResult = {
  applyId: string;
  academicPlanId: string;
  targetSchoolId: string;
  appliedAt: string;
  classroomsCreated: number;
  classroomsReused: number;
  learnersPlaced: number;
  subjectsCreated: number;
  subjectsReused: number;
  groupsCreated: number;
  teacherAssignmentsApplied: number;
  skipped: Array<{ reason: string; detail?: string }>;
  idempotentReplay: boolean;
};
