/**
 * OA-04B — ACCEPTED application → canonical enrolment (preflight + explicit convert).
 * Reuses registerLearner / allocateFamilyAccountRef / saveParentLinks / parent identity.
 * Status remains ACCEPTED; promotedLearnerId / promotedFamilyAccountId are the durable link.
 * NO schema change. NO billing plans / invoices / portal invites.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  checkApplicationParentIdentity,
  requiresExplicitCreateConfirmation,
  type ApplicationParentIdentityResult,
} from "../applicationParentIdentity";
import {
  findDuplicateLearnerInSchool,
  type DuplicateLearnerMatch,
} from "../learnerIdentityGuard";
import {
  CrossSchoolFamilyAccountError,
  LearnerIdentityConflictError,
  alignParentsToCanonicalFamily,
  registerLearner,
} from "../learnerRegistrationService";
import { registerFinanceAccountForLearner } from "../financeAccountBaseline";
import { saveParentLinks } from "../parentLinkService";
import { canMakeAdmissionDecision } from "./admissionsDecisionAuth";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export type ConversionActor = {
  userId: string;
  schoolId: string;
  appRole: string;
  hasAdmissionsManage: boolean;
  hasLearnersCreate: boolean;
};

export function assertConversionAuthorized(actor: ConversionActor): void {
  if (!actor.hasAdmissionsManage) {
    throw new StaffAdmissionsError(
      "Admissions manage permission required for conversion",
      403,
      "ADMISSIONS_FORBIDDEN"
    );
  }
  if (!actor.hasLearnersCreate) {
    throw new StaffAdmissionsError(
      "Learners create permission required for conversion",
      403,
      "LEARNERS_CREATE_FORBIDDEN"
    );
  }
  if (!canMakeAdmissionDecision(actor.appRole)) {
    throw new StaffAdmissionsError(
      "Only Owner/Admin may convert accepted applications",
      403,
      "ADMISSIONS_DECISION_FORBIDDEN"
    );
  }
}

const CONVERSION_FORBIDDEN_DTO_KEYS = new Set([
  "schoolId",
  "promotedLearnerId",
  "promotedFamilyAccountId",
  "status",
  "statusReason",
  "billing",
  "billingPlan",
  "invoice",
  "invoices",
  "portal",
  "invite",
  "onboarding",
  "email",
  "sms",
  "learnerId",
  "familyAccountId",
]);

export type FamilyDecisionMode = "CREATE_NEW" | "USE_EXISTING";
export type GuardianDecisionMode = "CREATE_NEW" | "LINK_EXISTING";

export type ConversionDecisionDto = {
  family: {
    mode: FamilyDecisionMode;
    existingFamilyAccountId?: string;
    /** Required when CREATE_NEW and application declared sibling/existing family. */
    acknowledgeCreateNewFamilyDespiteSiblingDeclaration?: boolean;
  };
  guardians: Array<{
    admissionGuardianId: string;
    mode: GuardianDecisionMode;
    existingParentId?: string;
    /** Owner/Admin confirm when CREATE_NEW hits probable match (canonical rule). */
    confirmCreateDespiteMatch?: boolean;
  }>;
  placement: {
    grade: string;
    className?: string | null;
  };
};

export type ConversionPreflight = {
  application: {
    id: string;
    applicationNumber: string | null;
    status: string;
    alreadyConverted: boolean;
    promotedLearnerId: string | null;
    promotedFamilyAccountId: string | null;
    intakeYear: number;
    requestedGrade: string | null;
  };
  learner: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    birthDate: string | null;
    gender: string | null;
    hasIdNumber: boolean;
    homeLanguage: string | null;
    citizenship: string | null;
    requestedGrade: string | null;
    intakeYear: number;
    duplicate: null | {
      strength: "STRONG";
      matchReason: string;
      enrollmentStatus: string;
      learnerId: string;
      admissionNo: string | null;
      familyAccountId: string | null;
      accountRef: string | null;
      blockerCode: string;
    };
  };
  guardians: Array<{
    admissionGuardianId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    hasIdNumber: boolean;
    hasEmail: boolean;
    hasCellNo: boolean;
    isPrimary: boolean;
    isPayingPerson: boolean;
    identityDecision: ApplicationParentIdentityResult["decision"] | null;
    matchStrength: "STRONG" | "PROBABLE" | "AMBIGUOUS" | "NONE";
    candidates: Array<{
      parentId: string;
      firstName: string;
      surname: string;
      maskedIdNumber: string;
      maskedCellphone: string;
      maskedEmail: string;
      matchReasons: string[];
      familyAccountId: string | null;
    }>;
    suggestedMode: GuardianDecisionMode | null;
    suggestedExistingParentId: string | null;
  }>;
  family: {
    declaredExistingSibling: boolean;
    declaredExistingFamily: boolean;
    declaredSiblingLearnerName: string | null;
    declaredSiblingAdmissionNo: string | null;
    staffMatchedFamilyAccountId: string | null;
    staffMatchDecision: string | null;
    candidates: Array<{
      familyAccountId: string;
      accountRef: string;
      familyName: string;
      reason: string;
      strength: "STRONG" | "PROBABLE";
    }>;
    requiresFamilyDecision: boolean;
    requiresAckForCreateNewDespiteSiblingDeclaration: boolean;
  };
  placement: {
    requestedGrade: string | null;
    proposedGrade: string | null;
    classNameRequired: false;
  };
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  canConvert: boolean;
};

export type ConversionResult = {
  action: "convert_to_learner";
  idempotent: boolean;
  learnerId: string;
  familyAccountId: string;
  admissionNo: string | null;
  accountRef: string | null;
  familyMode: "created" | "reused";
  guardianOutcomes: Array<{
    admissionGuardianId: string;
    mode: "created" | "linked";
    parentId: string;
  }>;
  grade: string;
  className: string | null;
  /** True when zero-balance finance baseline is present/registered after DB commit. */
  financeBaselineRegistered: boolean;
  /** Present when conversion succeeded but file baseline sync failed (canonical records remain). */
  financeBaselineWarning?: "FINANCE_BASELINE_SYNC_FAILED";
};

const appInclude = {
  learnerCandidate: true,
  guardians: { orderBy: { sortOrder: "asc" as const } },
  feeRecord: true,
} as const;

type AppRow = Prisma.AdmissionApplicationGetPayload<{ include: typeof appInclude }>;

async function loadApplicationForSchool(
  db: PrismaClient | Prisma.TransactionClient,
  schoolId: string,
  applicationId: string
): Promise<AppRow> {
  const id = clean(applicationId);
  if (!id) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }
  const app = await db.admissionApplication.findFirst({
    where: { id, schoolId },
    include: appInclude,
  });
  if (!app) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }
  return app;
}

function maskPresence(value: unknown): boolean {
  return Boolean(clean(value));
}

function isoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function parentMatchStrength(
  result: ApplicationParentIdentityResult
): "STRONG" | "PROBABLE" | "AMBIGUOUS" | "NONE" {
  if (result.decision === "EXISTING_PARENT_MATCH" || result.code === "PARENT_ID_ALREADY_EXISTS") {
    return "STRONG";
  }
  if (result.decision === "POSSIBLE_MATCH") {
    return requiresExplicitCreateConfirmation(result) ? "PROBABLE" : "AMBIGUOUS";
  }
  if (result.decision === "CONFLICT") return "STRONG";
  return "NONE";
}

async function lockApplication(
  tx: Prisma.TransactionClient,
  schoolId: string,
  applicationId: string
): Promise<{
  id: string;
  status: string;
  promotedLearnerId: string | null;
  promotedFamilyAccountId: string | null;
}> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      status: string;
      promotedLearnerId: string | null;
      promotedFamilyAccountId: string | null;
    }>
  >`
    SELECT id, status::text AS status, "promotedLearnerId", "promotedFamilyAccountId"
    FROM "AdmissionApplication"
    WHERE id = ${applicationId} AND "schoolId" = ${schoolId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }
  return row;
}

function duplicateBlocker(dup: DuplicateLearnerMatch): NonNullable<
  ConversionPreflight["learner"]["duplicate"]
> {
  const status = String(dup.enrollmentStatus || "ACTIVE").toUpperCase();
  const blockerCode =
    status === "HISTORICAL"
      ? "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"
      : "LEARNER_IDENTITY_CONFLICT";
  return {
    strength: "STRONG",
    matchReason: dup.matchReason,
    enrollmentStatus: status,
    learnerId: dup.id,
    admissionNo: dup.admissionNo,
    familyAccountId: dup.familyAccountId,
    accountRef: dup.familyAccount?.accountRef || dup.admissionNo,
    blockerCode,
  };
}

export async function getConversionPreflight(
  prisma: PrismaClient,
  actor: ConversionActor,
  applicationId: string
): Promise<ConversionPreflight> {
  assertConversionAuthorized(actor);
  const app = await loadApplicationForSchool(prisma, actor.schoolId, applicationId);
  const blockers: ConversionPreflight["blockers"] = [];
  const warnings: ConversionPreflight["warnings"] = [];

  const alreadyConverted = Boolean(app.promotedLearnerId);
  if (app.status !== "ACCEPTED" && !alreadyConverted) {
    blockers.push({
      code: "APPLICATION_NOT_ACCEPTED",
      message: "Only ACCEPTED applications can be converted",
    });
  }

  const candidate = app.learnerCandidate;
  if (!candidate && !alreadyConverted) {
    blockers.push({
      code: "LEARNER_CANDIDATE_MISSING",
      message: "Application has no learner candidate",
    });
  }

  let duplicateInfo: ConversionPreflight["learner"]["duplicate"] = null;
  if (candidate && !alreadyConverted) {
    const dup = await findDuplicateLearnerInSchool({
      schoolId: actor.schoolId,
      idNumber: candidate.idNumber,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      birthDate: candidate.birthDate,
    });
    if (dup) {
      duplicateInfo = duplicateBlocker(dup);
      blockers.push({
        code: duplicateInfo.blockerCode,
        message:
          duplicateInfo.blockerCode === "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"
            ? "A historical learner matches this identity. Reactivate the existing record instead of converting."
            : "An existing learner matches this identity. Conversion is blocked.",
      });
    }
  }

  const guardianViews: ConversionPreflight["guardians"] = [];
  for (const g of app.guardians) {
    const identity = await checkApplicationParentIdentity({
      prisma,
      schoolId: actor.schoolId,
      incoming: {
        firstName: g.firstName,
        surname: g.surname,
        idNumber: g.idNumber,
        cellNo: g.cellNo,
        email: g.email,
        relationship: g.relationship,
      },
      actorIsOwnerAdmin: true,
    });
    const strength = parentMatchStrength(identity);
    let suggestedMode: GuardianDecisionMode | null = null;
    let suggestedExistingParentId: string | null = null;
    if (strength === "STRONG" && identity.existingParent?.id) {
      suggestedMode = "LINK_EXISTING";
      suggestedExistingParentId = identity.existingParent.id;
      warnings.push({
        code: "PARENT_STRONG_MATCH",
        message: `Guardian ${g.firstName} ${g.surname} has a strong Parent match — prefer LINK_EXISTING`,
      });
    } else if (strength === "PROBABLE") {
      warnings.push({
        code: "PARENT_PROBABLE_MATCH",
        message: `Guardian ${g.firstName} ${g.surname} has a probable contact match — do not auto-link; confirm create or link explicitly`,
      });
    } else if (strength === "AMBIGUOUS") {
      warnings.push({
        code: "PARENT_AMBIGUOUS_MATCH",
        message: `Guardian ${g.firstName} ${g.surname} has an ambiguous match`,
      });
    }

    const candidates = (identity.candidates || []).map((c) => ({
      parentId: c.parentId,
      firstName: c.firstName,
      surname: c.surname,
      maskedIdNumber: c.maskedIdNumber,
      maskedCellphone: c.maskedCellphone,
      maskedEmail: c.maskedEmail,
      matchReasons: c.matchReasons,
      familyAccountId: null as string | null,
    }));

    for (const c of candidates) {
      const parent = await prisma.parent.findFirst({
        where: { id: c.parentId, schoolId: actor.schoolId },
        select: { familyAccountId: true },
      });
      c.familyAccountId = parent?.familyAccountId || null;
    }

    guardianViews.push({
      admissionGuardianId: g.id,
      firstName: g.firstName,
      surname: g.surname,
      relationship: g.relationship,
      hasIdNumber: maskPresence(g.idNumber),
      hasEmail: maskPresence(g.email),
      hasCellNo: maskPresence(g.cellNo),
      isPrimary: g.isPrimary,
      isPayingPerson: g.isPayingPerson,
      identityDecision: identity.decision,
      matchStrength: strength,
      candidates,
      suggestedMode,
      suggestedExistingParentId,
    });
  }

  const familyCandidates: ConversionPreflight["family"]["candidates"] = [];
  const seenFa = new Set<string>();

  if (app.staffMatchedFamilyAccountId) {
    const fa = await prisma.familyAccount.findFirst({
      where: { id: app.staffMatchedFamilyAccountId, schoolId: actor.schoolId, retiredAt: null },
      select: { id: true, accountRef: true, familyName: true },
    });
    if (fa) {
      seenFa.add(fa.id);
      familyCandidates.push({
        familyAccountId: fa.id,
        accountRef: fa.accountRef,
        familyName: fa.familyName,
        reason: "staffMatchedFamilyAccountId",
        strength: "STRONG",
      });
    } else {
      warnings.push({
        code: "STAFF_MATCHED_FAMILY_INVALID",
        message: "Recorded staff-matched family account is missing or cross-tenant — ignored",
      });
    }
  }

  const siblingAdmission = clean(app.declaredSiblingAdmissionNo);
  if (siblingAdmission) {
    const siblingLearner = await prisma.learner.findFirst({
      where: {
        schoolId: actor.schoolId,
        admissionNo: { equals: siblingAdmission, mode: "insensitive" },
      },
      select: {
        familyAccountId: true,
        familyAccount: { select: { id: true, accountRef: true, familyName: true, retiredAt: true } },
      },
    });
    if (siblingLearner?.familyAccount && !siblingLearner.familyAccount.retiredAt) {
      if (!seenFa.has(siblingLearner.familyAccount.id)) {
        seenFa.add(siblingLearner.familyAccount.id);
        familyCandidates.push({
          familyAccountId: siblingLearner.familyAccount.id,
          accountRef: siblingLearner.familyAccount.accountRef,
          familyName: siblingLearner.familyAccount.familyName,
          reason: "declaredSiblingAdmissionNo",
          strength: "PROBABLE",
        });
      }
    } else if (app.declaredExistingSibling) {
      warnings.push({
        code: "SIBLING_DECLARATION_UNRESOLVED",
        message: "Sibling declared but no matching same-school admission number found",
      });
    }
  } else if (app.declaredExistingSibling || app.declaredExistingFamily) {
    warnings.push({
      code: "EXISTING_FAMILY_DECLARATION",
      message: "Applicant declared an existing family/sibling — resolve FamilyAccount explicitly",
    });
  }

  for (const gv of guardianViews) {
    if (gv.suggestedExistingParentId) {
      const parent = await prisma.parent.findFirst({
        where: { id: gv.suggestedExistingParentId, schoolId: actor.schoolId },
        select: {
          familyAccountId: true,
          familyAccount: {
            select: { id: true, accountRef: true, familyName: true, retiredAt: true },
          },
        },
      });
      if (
        parent?.familyAccount &&
        !parent.familyAccount.retiredAt &&
        !seenFa.has(parent.familyAccount.id)
      ) {
        seenFa.add(parent.familyAccount.id);
        familyCandidates.push({
          familyAccountId: parent.familyAccount.id,
          accountRef: parent.familyAccount.accountRef,
          familyName: parent.familyAccount.familyName,
          reason: "linked_parent_family",
          strength: "PROBABLE",
        });
      }
    }
  }

  const requiresAckForCreateNewDespiteSiblingDeclaration =
    app.declaredExistingSibling || app.declaredExistingFamily;

  if (requiresAckForCreateNewDespiteSiblingDeclaration && familyCandidates.length === 0) {
    warnings.push({
      code: "FAMILY_ACCOUNT_DECISION_REQUIRED",
      message:
        "Existing family/sibling declared but no confirmed FamilyAccount candidate — CREATE_NEW requires acknowledgement",
    });
  }

  const canConvert =
    (app.status === "ACCEPTED" || alreadyConverted) &&
    blockers.length === 0 &&
    Boolean(candidate || alreadyConverted);

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      alreadyConverted,
      promotedLearnerId: app.promotedLearnerId,
      promotedFamilyAccountId: app.promotedFamilyAccountId,
      intakeYear: app.intakeYear,
      requestedGrade: app.requestedGrade,
    },
    learner: {
      firstName: candidate?.firstName || "",
      lastName: candidate?.lastName || "",
      nickname: candidate?.nickname || null,
      birthDate: isoDate(candidate?.birthDate),
      gender: candidate?.gender || null,
      hasIdNumber: maskPresence(candidate?.idNumber),
      homeLanguage: candidate?.homeLanguage || null,
      citizenship: candidate?.citizenship || null,
      requestedGrade: app.requestedGrade,
      intakeYear: app.intakeYear,
      duplicate: duplicateInfo,
    },
    guardians: guardianViews,
    family: {
      declaredExistingSibling: app.declaredExistingSibling,
      declaredExistingFamily: app.declaredExistingFamily,
      declaredSiblingLearnerName: app.declaredSiblingLearnerName,
      declaredSiblingAdmissionNo: app.declaredSiblingAdmissionNo,
      staffMatchedFamilyAccountId: app.staffMatchedFamilyAccountId,
      staffMatchDecision: app.staffMatchDecision,
      candidates: familyCandidates,
      requiresFamilyDecision: true,
      requiresAckForCreateNewDespiteSiblingDeclaration,
    },
    placement: {
      requestedGrade: app.requestedGrade,
      proposedGrade: app.requestedGrade,
      classNameRequired: false,
    },
    blockers,
    warnings,
    canConvert,
  };
}

function rejectForbiddenDtoKeys(raw: Record<string, unknown>) {
  const bad = Object.keys(raw).filter((k) => CONVERSION_FORBIDDEN_DTO_KEYS.has(k));
  if (bad.length) {
    throw new StaffAdmissionsError(
      "Protected or disallowed conversion fields",
      400,
      "PROTECTED_FIELD",
      bad.map((field) => ({ field, message: "Not allowed on conversion DTO" }))
    );
  }
}

export function parseConversionDecisionDto(body: unknown): ConversionDecisionDto {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  rejectForbiddenDtoKeys(raw);

  const familyRaw = (raw.family && typeof raw.family === "object" ? raw.family : null) as Record<
    string,
    unknown
  > | null;
  if (!familyRaw) {
    throw new StaffAdmissionsError("family decision is required", 400, "FAMILY_DECISION_REQUIRED");
  }
  const familyMode = clean(familyRaw.mode).toUpperCase();
  if (familyMode !== "CREATE_NEW" && familyMode !== "USE_EXISTING") {
    throw new StaffAdmissionsError(
      "family.mode must be CREATE_NEW or USE_EXISTING",
      400,
      "INVALID_FAMILY_MODE"
    );
  }
  const existingFamilyAccountId = clean(familyRaw.existingFamilyAccountId) || undefined;
  if (familyMode === "USE_EXISTING" && !existingFamilyAccountId) {
    throw new StaffAdmissionsError(
      "existingFamilyAccountId is required for USE_EXISTING",
      400,
      "EXISTING_FAMILY_REQUIRED"
    );
  }
  if (familyMode === "CREATE_NEW" && existingFamilyAccountId) {
    throw new StaffAdmissionsError(
      "existingFamilyAccountId is not allowed with CREATE_NEW",
      400,
      "INVALID_FAMILY_DECISION"
    );
  }

  const guardiansRaw = Array.isArray(raw.guardians) ? raw.guardians : null;
  if (!guardiansRaw) {
    throw new StaffAdmissionsError(
      "guardians decisions are required",
      400,
      "GUARDIAN_DECISIONS_REQUIRED"
    );
  }
  const guardians: ConversionDecisionDto["guardians"] = [];
  const seenGuardian = new Set<string>();
  for (const g of guardiansRaw) {
    const row = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
    const admissionGuardianId = clean(row.admissionGuardianId);
    if (!admissionGuardianId) {
      throw new StaffAdmissionsError(
        "admissionGuardianId is required",
        400,
        "INVALID_GUARDIAN_DECISION"
      );
    }
    if (seenGuardian.has(admissionGuardianId)) {
      throw new StaffAdmissionsError(
        "Duplicate guardian decision",
        400,
        "DUPLICATE_GUARDIAN_DECISION"
      );
    }
    seenGuardian.add(admissionGuardianId);
    const mode = clean(row.mode).toUpperCase();
    if (mode !== "CREATE_NEW" && mode !== "LINK_EXISTING") {
      throw new StaffAdmissionsError(
        "guardian.mode must be CREATE_NEW or LINK_EXISTING",
        400,
        "INVALID_GUARDIAN_MODE"
      );
    }
    const existingParentId = clean(row.existingParentId) || undefined;
    if (mode === "LINK_EXISTING" && !existingParentId) {
      throw new StaffAdmissionsError(
        "existingParentId is required for LINK_EXISTING",
        400,
        "EXISTING_PARENT_REQUIRED"
      );
    }
    if (mode === "CREATE_NEW" && existingParentId) {
      throw new StaffAdmissionsError(
        "existingParentId is not allowed with CREATE_NEW",
        400,
        "INVALID_GUARDIAN_DECISION"
      );
    }
    guardians.push({
      admissionGuardianId,
      mode: mode as GuardianDecisionMode,
      existingParentId,
      confirmCreateDespiteMatch: Boolean(row.confirmCreateDespiteMatch === true),
    });
  }

  const placementRaw = (raw.placement && typeof raw.placement === "object"
    ? raw.placement
    : null) as Record<string, unknown> | null;
  if (!placementRaw) {
    throw new StaffAdmissionsError("placement is required", 400, "PLACEMENT_REQUIRED");
  }
  const grade = clean(placementRaw.grade);
  if (!grade) {
    throw new StaffAdmissionsError("placement.grade is required", 400, "GRADE_REQUIRED");
  }
  const className =
    placementRaw.className === undefined || placementRaw.className === null
      ? null
      : clean(placementRaw.className) || null;

  return {
    family: {
      mode: familyMode as FamilyDecisionMode,
      existingFamilyAccountId,
      acknowledgeCreateNewFamilyDespiteSiblingDeclaration: Boolean(
        familyRaw.acknowledgeCreateNewFamilyDespiteSiblingDeclaration === true
      ),
    },
    guardians,
    placement: { grade, className },
  };
}

export async function convertAcceptedApplicationToLearner(
  prisma: PrismaClient,
  actor: ConversionActor,
  applicationId: string,
  body: unknown
): Promise<ConversionResult> {
  assertConversionAuthorized(actor);
  const decision = parseConversionDecisionDto(body);
  const appId = clean(applicationId);

  const dbResult = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);

    if (locked.promotedLearnerId) {
      const learner = await tx.learner.findFirst({
        where: { id: locked.promotedLearnerId, schoolId: actor.schoolId },
        include: { familyAccount: true },
      });
      if (!learner || !learner.familyAccountId) {
        throw new StaffAdmissionsError(
          "Converted application is missing canonical learner",
          409,
          "CONVERSION_LINK_BROKEN"
        );
      }
      const links = await tx.parentLearnerLink.findMany({
        where: { learnerId: learner.id, schoolId: actor.schoolId },
        select: { parentId: true },
      });
      return {
        action: "convert_to_learner" as const,
        idempotent: true,
        learnerId: learner.id,
        familyAccountId: learner.familyAccountId,
        admissionNo: learner.admissionNo,
        accountRef: learner.familyAccount?.accountRef || null,
        familyName: learner.familyAccount?.familyName || learner.familyAccount?.accountRef || "",
        familyCreatedAt: learner.familyAccount?.createdAt,
        familyMode: "reused" as const,
        guardianOutcomes: links.map((l) => ({
          admissionGuardianId: "",
          mode: "linked" as const,
          parentId: l.parentId,
        })),
        grade: learner.grade,
        className: learner.className,
      };
    }

    if (locked.status !== "ACCEPTED") {
      throw new StaffAdmissionsError(
        "Only ACCEPTED applications can be converted",
        409,
        "APPLICATION_NOT_ACCEPTED"
      );
    }

    const app = await loadApplicationForSchool(tx, actor.schoolId, locked.id);
    const candidate = app.learnerCandidate;
    if (!candidate) {
      throw new StaffAdmissionsError("Learner candidate missing", 400, "LEARNER_CANDIDATE_MISSING");
    }

    if (
      decision.family.mode === "CREATE_NEW" &&
      (app.declaredExistingSibling || app.declaredExistingFamily) &&
      !decision.family.acknowledgeCreateNewFamilyDespiteSiblingDeclaration
    ) {
      throw new StaffAdmissionsError(
        "Creating a new family despite an existing-family/sibling declaration requires acknowledgement",
        400,
        "SIBLING_DECLARATION_ACK_REQUIRED"
      );
    }

    const appGuardianIds = new Set(app.guardians.map((g) => g.id));
    if (decision.guardians.length !== app.guardians.length) {
      throw new StaffAdmissionsError(
        "A decision is required for every admission guardian",
        400,
        "GUARDIAN_DECISIONS_INCOMPLETE"
      );
    }
    for (const gd of decision.guardians) {
      if (!appGuardianIds.has(gd.admissionGuardianId)) {
        throw new StaffAdmissionsError(
          "Unknown admission guardian id in decision",
          400,
          "UNKNOWN_GUARDIAN_ID"
        );
      }
    }

    const dup = await findDuplicateLearnerInSchool({
      schoolId: actor.schoolId,
      idNumber: candidate.idNumber,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      birthDate: candidate.birthDate,
      db: tx,
    });
    if (dup) {
      const status = String(dup.enrollmentStatus || "ACTIVE").toUpperCase();
      if (status === "HISTORICAL") {
        throw new StaffAdmissionsError(
          "Historical learner match requires reactivation workflow",
          409,
          "HISTORICAL_LEARNER_REQUIRES_REACTIVATION",
          [{ field: "learner", message: dup.id }]
        );
      }
      throw new StaffAdmissionsError(
        "Learner identity conflict blocks conversion",
        409,
        "LEARNER_IDENTITY_CONFLICT",
        [{ field: "learner", message: dup.id }]
      );
    }

    let existingFamilyAccountId: string | null = null;
    if (decision.family.mode === "USE_EXISTING") {
      const faId = clean(decision.family.existingFamilyAccountId);
      const fa = await tx.familyAccount.findFirst({
        where: { id: faId, schoolId: actor.schoolId },
        select: { id: true, retiredAt: true },
      });
      if (!fa) {
        throw new StaffAdmissionsError(
          "Family account not found in this school",
          400,
          "FAMILY_ACCOUNT_NOT_FOUND"
        );
      }
      if (fa.retiredAt) {
        throw new StaffAdmissionsError(
          "Cannot convert onto a retired family account",
          400,
          "FAMILY_ACCOUNT_RETIRED"
        );
      }
      existingFamilyAccountId = fa.id;
    }

    for (const gd of decision.guardians) {
      if (gd.mode !== "LINK_EXISTING") continue;
      const parent = await tx.parent.findFirst({
        where: { id: clean(gd.existingParentId), schoolId: actor.schoolId },
        select: { id: true },
      });
      if (!parent) {
        throw new StaffAdmissionsError("Parent not found in this school", 400, "PARENT_NOT_FOUND");
      }
    }

    const learnerPayload: Record<string, unknown> = {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      surname: candidate.lastName,
      birthDate: candidate.birthDate,
      gender: candidate.gender,
      idNumber: candidate.idNumber,
      grade: decision.placement.grade,
      className: decision.placement.className,
      allergies: candidate.allergies,
      medicalAlert: candidate.medicalAlert,
    };

    let registration;
    try {
      registration = await registerLearner({
        schoolId: actor.schoolId,
        learner: learnerPayload,
        existingFamilyAccountId,
        db: tx,
        withinTransaction: true,
        registerFinanceBaseline: false,
      });
    } catch (err) {
      if (err instanceof LearnerIdentityConflictError) {
        const status = String(err.existing.enrollmentStatus || "ACTIVE").toUpperCase();
        throw new StaffAdmissionsError(
          err.message,
          409,
          status === "HISTORICAL"
            ? "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"
            : "LEARNER_IDENTITY_CONFLICT"
        );
      }
      if (err instanceof CrossSchoolFamilyAccountError) {
        throw new StaffAdmissionsError(err.message, 400, err.code);
      }
      throw err;
    }

    const learner = registration.learner!;
    const familyAccount = registration.familyAccount;
    const familyMode: "created" | "reused" = registration.createdNewFamilyAccount
      ? "created"
      : "reused";

    const parentsForLink: Record<string, unknown>[] = [];
    const guardianOutcomes: ConversionResult["guardianOutcomes"] = [];

    for (const gd of decision.guardians) {
      const g = app.guardians.find((x) => x.id === gd.admissionGuardianId)!;
      if (gd.mode === "LINK_EXISTING") {
        parentsForLink.push({
          id: clean(gd.existingParentId),
          firstName: g.firstName,
          surname: g.surname,
          relationship: g.relationship,
          idNumber: g.idNumber,
          cellNo: g.cellNo,
          email: g.email,
          homeAddress: g.homeAddress,
          title: g.title,
          isPrimary: g.isPrimary,
          isPayingPerson: g.isPayingPerson,
        });
        guardianOutcomes.push({
          admissionGuardianId: g.id,
          mode: "linked",
          parentId: clean(gd.existingParentId),
        });
      } else {
        const identity = await checkApplicationParentIdentity({
          prisma: tx,
          schoolId: actor.schoolId,
          incoming: {
            firstName: g.firstName,
            surname: g.surname,
            idNumber: g.idNumber,
            cellNo: g.cellNo,
            email: g.email,
            relationship: g.relationship,
          },
          actorIsOwnerAdmin: true,
        });
        if (identity.decision === "EXISTING_PARENT_MATCH") {
          throw new StaffAdmissionsError(
            "Strong parent match requires LINK_EXISTING",
            409,
            "PARENT_MUST_LINK_EXISTING",
            [{ field: "admissionGuardianId", message: g.id }]
          );
        }
        if (
          identity.decision === "POSSIBLE_MATCH" &&
          requiresExplicitCreateConfirmation(identity) &&
          !gd.confirmCreateDespiteMatch
        ) {
          throw new StaffAdmissionsError(
            "Probable parent match requires confirmCreateDespiteMatch or LINK_EXISTING",
            409,
            "PARENT_POSSIBLE_MATCH",
            [{ field: "admissionGuardianId", message: g.id }]
          );
        }
        parentsForLink.push({
          firstName: g.firstName,
          surname: g.surname,
          relationship: g.relationship,
          idNumber: g.idNumber,
          cellNo: g.cellNo,
          email: g.email,
          homeAddress: g.homeAddress,
          title: g.title,
          isPrimary: g.isPrimary,
          isPayingPerson: g.isPayingPerson,
          confirmCreateDespiteMatch: gd.confirmCreateDespiteMatch === true,
        });
        guardianOutcomes.push({
          admissionGuardianId: g.id,
          mode: "created",
          parentId: "",
        });
      }
    }

    try {
      await saveParentLinks({
        schoolId: actor.schoolId,
        learnerId: learner.id,
        familyAccountId: familyAccount.id,
        parents: parentsForLink,
        trustedIsOwnerAdmin: true,
        db: tx,
      });
    } catch (err) {
      const code =
        err && typeof err === "object" && "body" in err
          ? String((err as { body?: { code?: string } }).body?.code || "")
          : err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code || "")
            : "";
      const status =
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode) || 409
          : 409;
      throw new StaffAdmissionsError(
        err instanceof Error ? err.message : "Parent link failed",
        status,
        code || "PARENT_LINK_FAILED"
      );
    }

    await alignParentsToCanonicalFamily({
      schoolId: actor.schoolId,
      learnerIds: [learner.id],
      canonicalFamilyAccountId: familyAccount.id,
      db: tx,
    });

    const links = await tx.parentLearnerLink.findMany({
      where: { learnerId: learner.id, schoolId: actor.schoolId },
      include: { parent: true },
    });
    const filledOutcomes = guardianOutcomes.map((outcome) => {
      if (outcome.parentId) return outcome;
      const g = app.guardians.find((x) => x.id === outcome.admissionGuardianId)!;
      const match = links.find(
        (l) =>
          clean(l.parent.firstName).toLowerCase() === clean(g.firstName).toLowerCase() &&
          clean(l.parent.surname).toLowerCase() === clean(g.surname).toLowerCase()
      );
      return { ...outcome, parentId: match?.parentId || links[0]?.parentId || "" };
    });

    await tx.admissionApplication.update({
      where: { id: app.id },
      data: {
        promotedLearnerId: learner.id,
        promotedFamilyAccountId: familyAccount.id,
      },
    });

    await tx.admissionAuditEvent.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: app.id,
        eventType: "APPLICATION_CONVERTED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        metadataJson: {
          learnerId: learner.id,
          familyAccountId: familyAccount.id,
          familyMode,
          admissionNo: learner.admissionNo,
          grade: decision.placement.grade,
          className: decision.placement.className,
          guardians: filledOutcomes.map((o) => ({
            admissionGuardianId: o.admissionGuardianId,
            mode: o.mode,
            parentId: o.parentId,
          })),
        },
      },
    });

    return {
      action: "convert_to_learner" as const,
      idempotent: false,
      learnerId: learner.id,
      familyAccountId: familyAccount.id,
      admissionNo: learner.admissionNo,
      accountRef: familyAccount.accountRef,
      familyName: familyAccount.familyName,
      familyCreatedAt: familyAccount.createdAt,
      familyMode,
      guardianOutcomes: filledOutcomes,
      grade: decision.placement.grade,
      className: decision.placement.className ?? null,
    };
  });

  // File baseline cannot join Postgres txn — register after commit. Idempotent retries also reconcile.
  return ensureConversionFinanceBaseline(actor.schoolId, dbResult);
}

function ensureConversionFinanceBaseline(
  schoolId: string,
  dbResult: {
    action: "convert_to_learner";
    idempotent: boolean;
    learnerId: string;
    familyAccountId: string;
    admissionNo: string | null;
    accountRef: string | null;
    familyName: string;
    familyCreatedAt?: Date;
    familyMode: "created" | "reused";
    guardianOutcomes: ConversionResult["guardianOutcomes"];
    grade: string;
    className: string | null;
  }
): ConversionResult {
  const base: ConversionResult = {
    action: dbResult.action,
    idempotent: dbResult.idempotent,
    learnerId: dbResult.learnerId,
    familyAccountId: dbResult.familyAccountId,
    admissionNo: dbResult.admissionNo,
    accountRef: dbResult.accountRef,
    familyMode: dbResult.familyMode,
    guardianOutcomes: dbResult.guardianOutcomes,
    grade: dbResult.grade,
    className: dbResult.className,
    financeBaselineRegistered: false,
  };

  const accountRef = clean(dbResult.accountRef);
  if (!accountRef) {
    return { ...base, financeBaselineWarning: "FINANCE_BASELINE_SYNC_FAILED" };
  }

  try {
    const outcome = registerFinanceAccountForLearner({
      schoolId,
      learnerId: dbResult.learnerId,
      familyAccountId: dbResult.familyAccountId,
      accountRef,
      accountHolder: dbResult.familyName || accountRef,
      createdAt: dbResult.familyCreatedAt,
    });
    if (outcome.status === "error") {
      return { ...base, financeBaselineWarning: "FINANCE_BASELINE_SYNC_FAILED" };
    }
    return { ...base, financeBaselineRegistered: true };
  } catch (err) {
    void err;
    return { ...base, financeBaselineWarning: "FINANCE_BASELINE_SYNC_FAILED" };
  }
}
