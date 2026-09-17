/**
 * OA-05B — Admissions historical learner reactivation (preflight + transactional promote).
 * Does NOT call stock POST /api/learners/:id/reactivate as a separate step.
 * NO CREATE_NEW family. NO demographic overwrite. NO invoice/OTP/SMS/admission-fee ledger.
 * Status remains ACCEPTED; promotedLearnerId / promotedFamilyAccountId are the durable link.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  checkApplicationParentIdentity,
  requiresExplicitCreateConfirmation,
  type ApplicationParentIdentityResult,
} from "../applicationParentIdentity";
import {
  birthDayKey,
  findAllStrongLearnerMatchesInSchool,
  isUsableLearnerIdNumber,
  normaliseLearnerIdNumber,
  type DuplicateLearnerMatch,
} from "../learnerIdentityGuard";
import { registerFinanceAccountForLearner } from "../financeAccountBaseline";
import { resolveAuthoritativeFamilyAccountBalance } from "../financeAuthority/resolveAuthoritativeFamilyAccountBalance";
import { readLearnerBillingPlanFromDb } from "../learnerBillingPlanDbStore";
import { saveParentLinks } from "../parentLinkService";
import {
  assertConversionAuthorized,
  type ConversionActor,
  type GuardianDecisionMode,
} from "./admissionsConversionService";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function compactName(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export type ReactivationFamilyMode = "KEEP_EXISTING" | "USE_EXISTING";

export type ReactivationDecisionDto = {
  learnerId: string;
  family: {
    mode: ReactivationFamilyMode;
    familyAccountId?: string;
    acknowledgeHistoricalFamilyChange?: boolean;
  };
  guardians: Array<{
    admissionGuardianId: string;
    mode: GuardianDecisionMode;
    existingParentId?: string;
    confirmCreateDespiteMatch?: boolean;
  }>;
  placement: {
    grade: string;
    className?: string | null;
  };
  acknowledgeExistingBillingPlan?: boolean;
};

export type ReactivationPreflight = {
  application: {
    id: string;
    applicationNumber: string | null;
    status: string;
    alreadyEnrolled: boolean;
    promotedLearnerId: string | null;
    promotedFamilyAccountId: string | null;
    intakeYear: number;
    requestedGrade: string | null;
  };
  historicalLearner: null | {
    id: string;
    firstName: string;
    lastName: string;
    admissionNo: string | null;
    birthDate: string | null;
    historicalGrade: string;
    historicalClassName: string | null;
    enrollmentStatus: string;
  };
  match: null | {
    strength: "STRONG";
    matchReason: "idNumber" | "name+dob";
    caution: "EXACT_ID" | "NAME_DOB";
  };
  currentFamily: null | {
    familyAccountId: string;
    accountRef: string;
    accountNo: string | null;
    familyName: string;
  };
  finance: {
    balanceRand: number | null;
    balanceStatus: "POSITIVE" | "ZERO" | "CREDIT" | "UNKNOWN";
    warningCode: string | null;
    warningMessage: string | null;
  };
  billingPlan: {
    lineCount: number;
    summary: string[];
    warningCode: string | null;
    warningMessage: string | null;
    requiresAcknowledgeExistingBillingPlan: boolean;
  };
  existingParentLinks: Array<{
    parentId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    isPrimary: boolean;
    isPayingPerson: boolean;
  }>;
  preserveExistingParentLinksWarning: { code: string; message: string };
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
    alreadyLinkedToLearner: boolean;
  }>;
  family: {
    defaultMode: ReactivationFamilyMode | null;
    allowedModes: ReactivationFamilyMode[];
    createNewSupported: false;
    candidates: Array<{
      familyAccountId: string;
      accountRef: string;
      familyName: string;
      reason: string;
      strength: "STRONG" | "PROBABLE";
      isCurrent: boolean;
    }>;
    requiresAcknowledgeHistoricalFamilyChange: boolean;
  };
  placement: {
    historicalGrade: string | null;
    historicalClassName: string | null;
    requestedGrade: string | null;
    proposedGrade: string | null;
    classNameRequired: false;
    mustConfirmGrade: true;
  };
  identityWarnings: Array<{ code: string; message: string }>;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  canReactivate: boolean;
};

export type ReactivationResult = {
  action: "reactivate_historical_learner";
  idempotent: boolean;
  learnerId: string;
  familyAccountId: string;
  admissionNo: string | null;
  accountRef: string | null;
  familyMode: "kept" | "switched";
  guardianOutcomes: Array<{
    admissionGuardianId: string;
    mode: "created" | "linked" | "already_linked";
    parentId: string;
  }>;
  grade: string;
  className: string | null;
  financeBaselineRegistered: boolean;
  financeBaselineWarning?: "FINANCE_BASELINE_SYNC_FAILED";
};

const REACTIVATION_FORBIDDEN_DTO_KEYS = new Set([
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
  "createNewFamily",
]);

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

async function lockLearner(
  tx: Prisma.TransactionClient,
  schoolId: string,
  learnerId: string
): Promise<{
  id: string;
  schoolId: string;
  enrollmentStatus: string;
  admissionNo: string | null;
  familyAccountId: string | null;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  idNumber: string | null;
  birthDate: Date | null;
  gender: string | null;
}> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      schoolId: string;
      enrollmentStatus: string;
      admissionNo: string | null;
      familyAccountId: string | null;
      firstName: string;
      lastName: string;
      grade: string;
      className: string | null;
      idNumber: string | null;
      birthDate: Date | null;
      gender: string | null;
    }>
  >`
    SELECT id, "schoolId", "enrollmentStatus"::text AS "enrollmentStatus", "admissionNo", "familyAccountId",
           "firstName", "lastName", grade, "className", "idNumber", "birthDate", gender
    FROM "Learner"
    WHERE id = ${learnerId} AND "schoolId" = ${schoolId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new StaffAdmissionsError("Historical learner not found", 404, "LEARNER_NOT_FOUND");
  }
  return row;
}

function balanceStatusFromRand(
  balanceRand: number | null
): ReactivationPreflight["finance"]["balanceStatus"] {
  if (balanceRand == null || Number.isNaN(balanceRand)) return "UNKNOWN";
  if (balanceRand > 0) return "POSITIVE";
  if (balanceRand < 0) return "CREDIT";
  return "ZERO";
}

function identityFieldWarnings(
  candidate: {
    firstName: string;
    lastName: string;
    birthDate: Date | null;
    idNumber: string | null;
    gender: string | null;
  },
  learner: {
    firstName: string;
    lastName: string;
    birthDate: Date | null;
    idNumber: string | null;
    gender: string | null;
  }
): Array<{ code: string; message: string }> {
  const warnings: Array<{ code: string; message: string }> = [];
  if (compactName(candidate.firstName) !== compactName(learner.firstName)) {
    warnings.push({
      code: "IDENTITY_FIRST_NAME_DIFFERS",
      message:
        "Application first name differs from canonical learner — demographics will not be overwritten",
    });
  }
  if (compactName(candidate.lastName) !== compactName(learner.lastName)) {
    warnings.push({
      code: "IDENTITY_LAST_NAME_DIFFERS",
      message:
        "Application last name differs from canonical learner — demographics will not be overwritten",
    });
  }
  const cDob = birthDayKey(candidate.birthDate);
  const lDob = birthDayKey(learner.birthDate);
  if (cDob && lDob && cDob !== lDob) {
    warnings.push({
      code: "IDENTITY_BIRTH_DATE_DIFFERS",
      message:
        "Application birth date differs from canonical learner — demographics will not be overwritten",
    });
  }
  const cId = normaliseLearnerIdNumber(candidate.idNumber);
  const lId = normaliseLearnerIdNumber(learner.idNumber);
  if (isUsableLearnerIdNumber(cId) && isUsableLearnerIdNumber(lId) && cId !== lId) {
    warnings.push({
      code: "IDENTITY_ID_NUMBER_DIFFERS",
      message:
        "Application ID number differs from canonical learner — demographics will not be overwritten",
    });
  }
  const cGender = clean(candidate.gender).toUpperCase();
  const lGender = clean(learner.gender).toUpperCase();
  if (cGender && lGender && cGender !== lGender) {
    warnings.push({
      code: "IDENTITY_GENDER_DIFFERS",
      message:
        "Application gender differs from canonical learner — demographics will not be overwritten",
    });
  }
  return warnings;
}

function pickStrongHistoricalMatch(matches: DuplicateLearnerMatch[]): {
  match: DuplicateLearnerMatch | null;
  blockers: Array<{ code: string; message: string }>;
} {
  const historical = matches.filter(
    (m) => String(m.enrollmentStatus || "").toUpperCase() === "HISTORICAL"
  );
  const active = matches.filter(
    (m) => String(m.enrollmentStatus || "").toUpperCase() === "ACTIVE"
  );

  if (active.length > 0) {
    return {
      match: null,
      blockers: [
        {
          code: "LEARNER_IDENTITY_CONFLICT",
          message:
            "An active learner already matches this identity. Reactivation is not offered — review the existing learner outside this flow.",
        },
      ],
    };
  }

  if (historical.length === 0) {
    return {
      match: null,
      blockers: [
        {
          code: "NO_HISTORICAL_LEARNER_MATCH",
          message: "No strong historical learner match was found for this application.",
        },
      ],
    };
  }

  if (historical.length > 1) {
    return {
      match: null,
      blockers: [
        {
          code: "AMBIGUOUS_HISTORICAL_LEARNER_MATCH",
          message:
            "Multiple possible historical learner records were found. Resolve records manually before reactivation.",
        },
      ],
    };
  }

  return { match: historical[0]!, blockers: [] };
}

async function buildGuardianViews(
  prisma: PrismaClient | Prisma.TransactionClient,
  schoolId: string,
  app: AppRow,
  learnerId: string | null,
  warnings: Array<{ code: string; message: string }>
): Promise<ReactivationPreflight["guardians"]> {
  const linkedParentIds = new Set<string>();
  if (learnerId) {
    const links = await prisma.parentLearnerLink.findMany({
      where: { learnerId, schoolId },
      select: { parentId: true },
    });
    for (const l of links) linkedParentIds.add(l.parentId);
  }

  const guardianViews: ReactivationPreflight["guardians"] = [];
  for (const g of app.guardians) {
    const identity = await checkApplicationParentIdentity({
      prisma,
      schoolId,
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
        message: `Guardian ${g.firstName} ${g.surname} has a strong Parent match — must LINK_EXISTING`,
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
        where: { id: c.parentId, schoolId },
        select: { familyAccountId: true },
      });
      c.familyAccountId = parent?.familyAccountId || null;
    }

    const alreadyLinkedToLearner = Boolean(
      suggestedExistingParentId && linkedParentIds.has(suggestedExistingParentId)
    );

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
      alreadyLinkedToLearner,
    });
  }
  return guardianViews;
}

async function buildFamilyCandidates(
  prisma: PrismaClient | Prisma.TransactionClient,
  schoolId: string,
  app: AppRow,
  currentFamilyAccountId: string | null,
  guardianViews: ReactivationPreflight["guardians"],
  warnings: Array<{ code: string; message: string }>
): Promise<ReactivationPreflight["family"]["candidates"]> {
  const familyCandidates: ReactivationPreflight["family"]["candidates"] = [];
  const seenFa = new Set<string>();

  const pushFa = async (
    familyAccountId: string,
    reason: string,
    strength: "STRONG" | "PROBABLE"
  ) => {
    if (!familyAccountId || seenFa.has(familyAccountId)) return;
    const fa = await prisma.familyAccount.findFirst({
      where: { id: familyAccountId, schoolId, retiredAt: null },
      select: { id: true, accountRef: true, familyName: true },
    });
    if (!fa) return;
    seenFa.add(fa.id);
    familyCandidates.push({
      familyAccountId: fa.id,
      accountRef: fa.accountRef,
      familyName: fa.familyName,
      reason,
      strength,
      isCurrent: fa.id === currentFamilyAccountId,
    });
  };

  if (currentFamilyAccountId) {
    await pushFa(currentFamilyAccountId, "learner_current_family", "STRONG");
  }

  if (app.staffMatchedFamilyAccountId) {
    const before = seenFa.size;
    await pushFa(app.staffMatchedFamilyAccountId, "staffMatchedFamilyAccountId", "STRONG");
    if (seenFa.size === before && app.staffMatchedFamilyAccountId !== currentFamilyAccountId) {
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
        schoolId,
        admissionNo: { equals: siblingAdmission, mode: "insensitive" },
      },
      select: { familyAccountId: true },
    });
    if (siblingLearner?.familyAccountId) {
      await pushFa(siblingLearner.familyAccountId, "declaredSiblingAdmissionNo", "PROBABLE");
    }
  }

  for (const gv of guardianViews) {
    if (gv.suggestedExistingParentId) {
      const parent = await prisma.parent.findFirst({
        where: { id: gv.suggestedExistingParentId, schoolId },
        select: { familyAccountId: true },
      });
      if (parent?.familyAccountId) {
        await pushFa(parent.familyAccountId, "linked_parent_family", "PROBABLE");
      }
    }
  }

  return familyCandidates;
}

export async function getReactivationPreflight(
  prisma: PrismaClient,
  actor: ConversionActor,
  applicationId: string
): Promise<ReactivationPreflight> {
  assertConversionAuthorized(actor);
  const app = await loadApplicationForSchool(prisma, actor.schoolId, applicationId);
  const blockers: ReactivationPreflight["blockers"] = [];
  const warnings: ReactivationPreflight["warnings"] = [];
  const identityWarnings: ReactivationPreflight["identityWarnings"] = [];

  const alreadyEnrolled = Boolean(app.promotedLearnerId);
  if (alreadyEnrolled) {
    return {
      application: {
        id: app.id,
        applicationNumber: app.applicationNumber,
        status: app.status,
        alreadyEnrolled: true,
        promotedLearnerId: app.promotedLearnerId,
        promotedFamilyAccountId: app.promotedFamilyAccountId,
        intakeYear: app.intakeYear,
        requestedGrade: app.requestedGrade,
      },
      historicalLearner: null,
      match: null,
      currentFamily: null,
      finance: {
        balanceRand: null,
        balanceStatus: "UNKNOWN",
        warningCode: null,
        warningMessage: null,
      },
      billingPlan: {
        lineCount: 0,
        summary: [],
        warningCode: null,
        warningMessage: null,
        requiresAcknowledgeExistingBillingPlan: false,
      },
      existingParentLinks: [],
      preserveExistingParentLinksWarning: {
        code: "EXISTING_GUARDIAN_LINKS_PRESERVED",
        message: "Existing guardian links will be preserved.",
      },
      guardians: [],
      family: {
        defaultMode: null,
        allowedModes: ["KEEP_EXISTING", "USE_EXISTING"],
        createNewSupported: false,
        candidates: [],
        requiresAcknowledgeHistoricalFamilyChange: true,
      },
      placement: {
        historicalGrade: null,
        historicalClassName: null,
        requestedGrade: app.requestedGrade,
        proposedGrade: app.requestedGrade,
        classNameRequired: false,
        mustConfirmGrade: true,
      },
      identityWarnings: [],
      blockers: [],
      warnings: [
        {
          code: "ALREADY_ENROLLED",
          message:
            "Application is already linked to a promoted learner — reactivation is idempotent.",
        },
      ],
      canReactivate: false,
    };
  }

  if (app.status !== "ACCEPTED") {
    blockers.push({
      code: "APPLICATION_NOT_ACCEPTED",
      message: "Only ACCEPTED applications can reactivate a historical learner",
    });
  }

  const candidate = app.learnerCandidate;
  if (!candidate) {
    blockers.push({
      code: "LEARNER_CANDIDATE_MISSING",
      message: "Application has no learner candidate",
    });
  }

  let historicalMatch: DuplicateLearnerMatch | null = null;
  if (candidate && blockers.length === 0) {
    const allMatches = await findAllStrongLearnerMatchesInSchool({
      schoolId: actor.schoolId,
      idNumber: candidate.idNumber,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      birthDate: candidate.birthDate,
    });
    const picked = pickStrongHistoricalMatch(allMatches);
    blockers.push(...picked.blockers);
    historicalMatch = picked.match;
  }

  let historicalLearner: ReactivationPreflight["historicalLearner"] = null;
  let matchInfo: ReactivationPreflight["match"] = null;
  let currentFamily: ReactivationPreflight["currentFamily"] = null;
  let finance: ReactivationPreflight["finance"] = {
    balanceRand: null,
    balanceStatus: "UNKNOWN",
    warningCode: null,
    warningMessage: null,
  };
  let billingPlan: ReactivationPreflight["billingPlan"] = {
    lineCount: 0,
    summary: [],
    warningCode: null,
    warningMessage: null,
    requiresAcknowledgeExistingBillingPlan: false,
  };
  let existingParentLinks: ReactivationPreflight["existingParentLinks"] = [];

  if (historicalMatch && candidate) {
    const learner = await prisma.learner.findFirst({
      where: { id: historicalMatch.id, schoolId: actor.schoolId },
      include: {
        familyAccount: true,
        links: {
          include: {
            parent: {
              select: {
                id: true,
                firstName: true,
                surname: true,
              },
            },
          },
        },
      },
    });
    if (!learner || learner.schoolId !== actor.schoolId) {
      blockers.push({
        code: "CROSS_SCHOOL_LEARNER_BLOCKED",
        message: "Historical learner is not in this school",
      });
    } else if (String(learner.enrollmentStatus || "").toUpperCase() !== "HISTORICAL") {
      blockers.push({
        code: "LEARNER_IDENTITY_CONFLICT",
        message: "Matched learner is not HISTORICAL — reactivation is not offered",
      });
    } else {
      historicalLearner = {
        id: learner.id,
        firstName: learner.firstName,
        lastName: learner.lastName,
        admissionNo: learner.admissionNo,
        birthDate: isoDate(learner.birthDate),
        historicalGrade: learner.grade,
        historicalClassName: learner.className,
        enrollmentStatus: learner.enrollmentStatus,
      };
      matchInfo = {
        strength: "STRONG",
        matchReason: historicalMatch.matchReason,
        caution: historicalMatch.matchReason === "idNumber" ? "EXACT_ID" : "NAME_DOB",
      };
      if (matchInfo.caution === "NAME_DOB") {
        warnings.push({
          code: "NAME_DOB_MATCH_CAUTION",
          message:
            "Match is by name and date of birth (not exact ID). Confirm this is the correct historical learner before continuing.",
        });
      }

      identityWarnings.push(
        ...identityFieldWarnings(candidate, {
          firstName: learner.firstName,
          lastName: learner.lastName,
          birthDate: learner.birthDate,
          idNumber: learner.idNumber,
          gender: learner.gender,
        })
      );

      if (learner.familyAccount && !learner.familyAccount.retiredAt) {
        currentFamily = {
          familyAccountId: learner.familyAccount.id,
          accountRef: learner.familyAccount.accountRef,
          accountNo: learner.familyAccount.accountNo,
          familyName: learner.familyAccount.familyName,
        };
        try {
          const bal = await resolveAuthoritativeFamilyAccountBalance(
            actor.schoolId,
            learner.familyAccount.accountRef
          );
          const status = balanceStatusFromRand(bal.balanceRand);
          finance = {
            balanceRand: bal.balanceRand,
            balanceStatus: status,
            warningCode:
              status === "POSITIVE"
                ? "FAMILY_POSITIVE_BALANCE"
                : status === "CREDIT"
                  ? "FAMILY_CREDIT_BALANCE"
                  : null,
            warningMessage:
              status === "POSITIVE"
                ? "Existing family account has a positive outstanding balance. Balance is preserved — reactivation does not clear debt."
                : status === "CREDIT"
                  ? "Existing family account has a credit balance. Credit is preserved — reactivation does not clear or migrate credit."
                  : null,
          };
          if (finance.warningCode) {
            warnings.push({
              code: finance.warningCode,
              message: finance.warningMessage || "",
            });
          }
        } catch {
          finance = {
            balanceRand: null,
            balanceStatus: "UNKNOWN",
            warningCode: null,
            warningMessage: null,
          };
        }
      } else {
        blockers.push({
          code: "NO_USABLE_FAMILY_ACCOUNT",
          message:
            "Historical learner has no usable same-school FamilyAccount. CREATE_NEW family is not supported in OA-05B — resolve family linkage outside this flow.",
        });
      }

      const planLines = await readLearnerBillingPlanFromDb(actor.schoolId, learner.id);
      billingPlan = {
        lineCount: planLines.length,
        summary: planLines.slice(0, 5).map((l) => `${l.feeDescription}: ${l.amount}`),
        warningCode: planLines.length > 0 ? "STALE_BILLING_PLAN_REVIEW_REQUIRED" : null,
        warningMessage:
          planLines.length > 0
            ? "This learner has an existing billing plan from the historical enrolment. Review the plan before the next invoice run."
            : null,
        requiresAcknowledgeExistingBillingPlan: planLines.length > 0,
      };
      if (billingPlan.warningCode) {
        warnings.push({
          code: billingPlan.warningCode,
          message: billingPlan.warningMessage || "",
        });
      }

      existingParentLinks = learner.links.map((link) => ({
        parentId: link.parent.id,
        firstName: link.parent.firstName,
        surname: link.parent.surname,
        relationship: link.relation,
        isPrimary: link.isPrimary,
        isPayingPerson: link.isPayingPerson,
      }));

      const otherPromoted = await prisma.admissionApplication.findFirst({
        where: {
          schoolId: actor.schoolId,
          promotedLearnerId: learner.id,
          id: { not: app.id },
        },
        select: { id: true },
      });
      if (otherPromoted) {
        blockers.push({
          code: "HISTORICAL_LEARNER_ALREADY_REACTIVATED",
          message:
            "Another application is already linked to this historical learner. Do not reactivate again from this application.",
        });
      }
    }
  }

  const guardianViews =
    candidate && historicalLearner
      ? await buildGuardianViews(prisma, actor.schoolId, app, historicalLearner.id, warnings)
      : [];

  const familyCandidates = historicalLearner
    ? await buildFamilyCandidates(
        prisma,
        actor.schoolId,
        app,
        currentFamily?.familyAccountId || null,
        guardianViews,
        warnings
      )
    : [];

  const defaultMode: ReactivationFamilyMode | null = currentFamily ? "KEEP_EXISTING" : null;

  const canReactivate =
    app.status === "ACCEPTED" &&
    !alreadyEnrolled &&
    blockers.length === 0 &&
    Boolean(historicalLearner) &&
    Boolean(currentFamily);

  return {
    application: {
      id: app.id,
      applicationNumber: app.applicationNumber,
      status: app.status,
      alreadyEnrolled,
      promotedLearnerId: app.promotedLearnerId,
      promotedFamilyAccountId: app.promotedFamilyAccountId,
      intakeYear: app.intakeYear,
      requestedGrade: app.requestedGrade,
    },
    historicalLearner,
    match: matchInfo,
    currentFamily,
    finance,
    billingPlan,
    existingParentLinks,
    preserveExistingParentLinksWarning: {
      code: "EXISTING_GUARDIAN_LINKS_PRESERVED",
      message: "Existing guardian links will be preserved.",
    },
    guardians: guardianViews,
    family: {
      defaultMode,
      allowedModes: ["KEEP_EXISTING", "USE_EXISTING"],
      createNewSupported: false,
      candidates: familyCandidates,
      requiresAcknowledgeHistoricalFamilyChange: true,
    },
    placement: {
      historicalGrade: historicalLearner?.historicalGrade || null,
      historicalClassName: historicalLearner?.historicalClassName || null,
      requestedGrade: app.requestedGrade,
      proposedGrade: app.requestedGrade,
      classNameRequired: false,
      mustConfirmGrade: true,
    },
    identityWarnings,
    blockers,
    warnings,
    canReactivate,
  };
}

function rejectForbiddenDtoKeys(raw: Record<string, unknown>) {
  const bad = Object.keys(raw).filter((k) => REACTIVATION_FORBIDDEN_DTO_KEYS.has(k));
  if (bad.length) {
    throw new StaffAdmissionsError(
      "Protected or disallowed reactivation fields",
      400,
      "PROTECTED_FIELD",
      bad.map((field) => ({ field, message: "Not allowed on reactivation DTO" }))
    );
  }
}

export function parseReactivationDecisionDto(body: unknown): ReactivationDecisionDto {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  rejectForbiddenDtoKeys(raw);

  const learnerId = clean(raw.learnerId);
  if (!learnerId) {
    throw new StaffAdmissionsError("learnerId is required", 400, "LEARNER_ID_REQUIRED");
  }

  const familyRaw = (raw.family && typeof raw.family === "object" ? raw.family : null) as Record<
    string,
    unknown
  > | null;
  if (!familyRaw) {
    throw new StaffAdmissionsError("family decision is required", 400, "FAMILY_DECISION_REQUIRED");
  }
  const familyMode = clean(familyRaw.mode).toUpperCase();
  if (familyMode === "CREATE_NEW") {
    throw new StaffAdmissionsError(
      "CREATE_NEW family is not supported for historical reactivation",
      400,
      "CREATE_NEW_FAMILY_NOT_SUPPORTED"
    );
  }
  if (familyMode !== "KEEP_EXISTING" && familyMode !== "USE_EXISTING") {
    throw new StaffAdmissionsError(
      "family.mode must be KEEP_EXISTING or USE_EXISTING",
      400,
      "INVALID_FAMILY_MODE"
    );
  }
  const familyAccountId = clean(familyRaw.familyAccountId) || undefined;
  if (familyMode === "USE_EXISTING" && !familyAccountId) {
    throw new StaffAdmissionsError(
      "familyAccountId is required for USE_EXISTING",
      400,
      "EXISTING_FAMILY_REQUIRED"
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
  const guardians: ReactivationDecisionDto["guardians"] = [];
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
    learnerId,
    family: {
      mode: familyMode as ReactivationFamilyMode,
      familyAccountId,
      acknowledgeHistoricalFamilyChange: Boolean(
        familyRaw.acknowledgeHistoricalFamilyChange === true
      ),
    },
    guardians,
    placement: { grade, className },
    acknowledgeExistingBillingPlan: Boolean(raw.acknowledgeExistingBillingPlan === true),
  };
}

function ensureReactivationFinanceBaseline(
  schoolId: string,
  dbResult: {
    action: "reactivate_historical_learner";
    idempotent: boolean;
    learnerId: string;
    familyAccountId: string;
    admissionNo: string | null;
    accountRef: string | null;
    familyName: string;
    familyCreatedAt?: Date;
    familyMode: "kept" | "switched";
    guardianOutcomes: ReactivationResult["guardianOutcomes"];
    grade: string;
    className: string | null;
  }
): ReactivationResult {
  const base: ReactivationResult = {
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
  } catch {
    return { ...base, financeBaselineWarning: "FINANCE_BASELINE_SYNC_FAILED" };
  }
}

export async function reactivateHistoricalLearnerForApplication(
  prisma: PrismaClient,
  actor: ConversionActor,
  applicationId: string,
  body: unknown
): Promise<ReactivationResult> {
  assertConversionAuthorized(actor);
  const decision = parseReactivationDecisionDto(body);
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
          "Enrolled application is missing canonical learner",
          409,
          "CONVERSION_LINK_BROKEN"
        );
      }
      const links = await tx.parentLearnerLink.findMany({
        where: { learnerId: learner.id, schoolId: actor.schoolId },
        select: { parentId: true },
      });
      return {
        action: "reactivate_historical_learner" as const,
        idempotent: true,
        learnerId: learner.id,
        familyAccountId: learner.familyAccountId,
        admissionNo: learner.admissionNo,
        accountRef: learner.familyAccount?.accountRef || null,
        familyName: learner.familyAccount?.familyName || learner.familyAccount?.accountRef || "",
        familyCreatedAt: learner.familyAccount?.createdAt,
        familyMode: "kept" as const,
        guardianOutcomes: links.map((l) => ({
          admissionGuardianId: "",
          mode: "already_linked" as const,
          parentId: l.parentId,
        })),
        grade: learner.grade,
        className: learner.className,
      };
    }

    if (locked.status !== "ACCEPTED") {
      throw new StaffAdmissionsError(
        "Only ACCEPTED applications can reactivate a historical learner",
        409,
        "APPLICATION_NOT_ACCEPTED"
      );
    }

    const app = await loadApplicationForSchool(tx, actor.schoolId, locked.id);
    const candidate = app.learnerCandidate;
    if (!candidate) {
      throw new StaffAdmissionsError("Learner candidate missing", 400, "LEARNER_CANDIDATE_MISSING");
    }

    const allMatches = await findAllStrongLearnerMatchesInSchool({
      schoolId: actor.schoolId,
      idNumber: candidate.idNumber,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      birthDate: candidate.birthDate,
      db: tx,
    });
    const picked = pickStrongHistoricalMatch(allMatches);
    if (picked.blockers.length || !picked.match) {
      const first = picked.blockers[0];
      throw new StaffAdmissionsError(
        first?.message || "Historical learner match failed",
        409,
        first?.code || "NO_HISTORICAL_LEARNER_MATCH"
      );
    }

    const serverLearnerId = picked.match.id;
    if (clean(decision.learnerId) !== serverLearnerId) {
      throw new StaffAdmissionsError(
        "Client learnerId does not match server-validated historical candidate",
        400,
        "LEARNER_ID_MISMATCH"
      );
    }

    const learnerLocked = await lockLearner(tx, actor.schoolId, serverLearnerId);
    if (String(learnerLocked.enrollmentStatus || "").toUpperCase() === "ACTIVE") {
      throw new StaffAdmissionsError(
        "Historical learner was already reactivated",
        409,
        "HISTORICAL_LEARNER_ALREADY_REACTIVATED"
      );
    }
    if (String(learnerLocked.enrollmentStatus || "").toUpperCase() !== "HISTORICAL") {
      throw new StaffAdmissionsError(
        "Learner is not HISTORICAL",
        409,
        "LEARNER_IDENTITY_CONFLICT"
      );
    }

    const otherPromoted = await tx.admissionApplication.findFirst({
      where: {
        schoolId: actor.schoolId,
        promotedLearnerId: learnerLocked.id,
        id: { not: app.id },
      },
      select: { id: true },
    });
    if (otherPromoted) {
      throw new StaffAdmissionsError(
        "Another application is already linked to this learner",
        409,
        "HISTORICAL_LEARNER_ALREADY_REACTIVATED"
      );
    }

    const recheck = await findAllStrongLearnerMatchesInSchool({
      schoolId: actor.schoolId,
      idNumber: candidate.idNumber,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      birthDate: candidate.birthDate,
      db: tx,
    });
    if (!recheck.some((m) => m.id === learnerLocked.id)) {
      throw new StaffAdmissionsError(
        "Historical identity match no longer valid",
        409,
        "HISTORICAL_MATCH_STALE"
      );
    }

    const planLines = await tx.learnerBillingPlanLine.count({
      where: { schoolId: actor.schoolId, learnerId: learnerLocked.id },
    });
    if (planLines > 0 && !decision.acknowledgeExistingBillingPlan) {
      throw new StaffAdmissionsError(
        "Existing billing plan acknowledgement is required",
        400,
        "BILLING_PLAN_ACK_REQUIRED"
      );
    }

    const currentFamilyId = clean(learnerLocked.familyAccountId);
    if (!currentFamilyId) {
      throw new StaffAdmissionsError(
        "Historical learner has no usable FamilyAccount",
        409,
        "NO_USABLE_FAMILY_ACCOUNT"
      );
    }

    let nextFamilyAccountId = currentFamilyId;
    let familyMode: "kept" | "switched" = "kept";

    if (decision.family.mode === "KEEP_EXISTING") {
      nextFamilyAccountId = currentFamilyId;
      familyMode = "kept";
    } else {
      const requestedFa = clean(decision.family.familyAccountId);
      const fa = await tx.familyAccount.findFirst({
        where: { id: requestedFa, schoolId: actor.schoolId },
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
          "Cannot reactivate onto a retired family account",
          400,
          "FAMILY_ACCOUNT_RETIRED"
        );
      }
      if (fa.id !== currentFamilyId) {
        if (!decision.family.acknowledgeHistoricalFamilyChange) {
          throw new StaffAdmissionsError(
            "Switching FamilyAccount requires acknowledgeHistoricalFamilyChange",
            400,
            "HISTORICAL_FAMILY_CHANGE_ACK_REQUIRED"
          );
        }
        nextFamilyAccountId = fa.id;
        familyMode = "switched";
      } else {
        nextFamilyAccountId = currentFamilyId;
        familyMode = "kept";
      }
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

    const admissionNoBefore = learnerLocked.admissionNo;

    const updatedLearner = await tx.learner.update({
      where: { id: learnerLocked.id },
      data: {
        enrollmentStatus: "ACTIVE",
        grade: decision.placement.grade,
        className: decision.placement.className,
        ...(nextFamilyAccountId !== currentFamilyId
          ? { familyAccountId: nextFamilyAccountId }
          : {}),
      },
      include: { familyAccount: true },
    });

    if (updatedLearner.admissionNo !== admissionNoBefore) {
      throw new StaffAdmissionsError(
        "Admission number must be preserved during reactivation",
        500,
        "ADMISSION_NO_MUTATED"
      );
    }

    const existingLinksBefore = await tx.parentLearnerLink.findMany({
      where: { learnerId: updatedLearner.id, schoolId: actor.schoolId },
      select: { parentId: true },
    });
    const existingParentIds = new Set(existingLinksBefore.map((l) => l.parentId));

    const parentsForLink: Record<string, unknown>[] = [];
    const guardianOutcomes: ReactivationResult["guardianOutcomes"] = [];

    for (const gd of decision.guardians) {
      const g = app.guardians.find((x) => x.id === gd.admissionGuardianId)!;
      if (gd.mode === "LINK_EXISTING") {
        const parentId = clean(gd.existingParentId);
        const already = existingParentIds.has(parentId);
        parentsForLink.push({
          id: parentId,
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
          mode: already ? "already_linked" : "linked",
          parentId,
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
        learnerId: updatedLearner.id,
        familyAccountId: nextFamilyAccountId,
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

    const linksAfter = await tx.parentLearnerLink.findMany({
      where: { learnerId: updatedLearner.id, schoolId: actor.schoolId },
      include: { parent: true },
    });
    for (const prior of existingParentIds) {
      if (!linksAfter.some((l) => l.parentId === prior)) {
        throw new StaffAdmissionsError(
          "Existing parent links must be preserved",
          500,
          "PARENT_LINK_PRESERVATION_FAILED"
        );
      }
    }

    // Resolve created parent IDs first, then align ONLY application-reconciled parents.
    // Do NOT call alignParentsToCanonicalFamily(learnerIds) — that would silently move
    // untouched historical guardians onto the switched FamilyAccount.
    const filledOutcomes = guardianOutcomes.map((outcome) => {
      if (outcome.parentId) return outcome;
      const g = app.guardians.find((x) => x.id === outcome.admissionGuardianId)!;
      const match = linksAfter.find(
        (l) =>
          clean(l.parent.firstName).toLowerCase() === clean(g.firstName).toLowerCase() &&
          clean(l.parent.surname).toLowerCase() === clean(g.surname).toLowerCase()
      );
      return { ...outcome, parentId: match?.parentId || "" };
    });

    const reconciledParentIds = Array.from(
      new Set(
        filledOutcomes
          .map((o) => clean(o.parentId))
          .filter(Boolean)
      )
    );
    if (reconciledParentIds.length) {
      await tx.parent.updateMany({
        where: {
          schoolId: actor.schoolId,
          id: { in: reconciledParentIds },
        },
        data: { familyAccountId: nextFamilyAccountId },
      });
    }

    const familyAccount =
      updatedLearner.familyAccountId === nextFamilyAccountId && updatedLearner.familyAccount
        ? updatedLearner.familyAccount
        : await tx.familyAccount.findFirstOrThrow({
            where: { id: nextFamilyAccountId, schoolId: actor.schoolId },
          });

    await tx.admissionApplication.update({
      where: { id: app.id },
      data: {
        promotedLearnerId: updatedLearner.id,
        promotedFamilyAccountId: familyAccount.id,
      },
    });

    await tx.admissionAuditEvent.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: app.id,
        eventType: "APPLICATION_REACTIVATED_TO_LEARNER",
        actorType: "STAFF",
        actorUserId: actor.userId,
        metadataJson: {
          learnerId: updatedLearner.id,
          familyAccountId: familyAccount.id,
          familyMode,
          grade: decision.placement.grade,
          className: decision.placement.className,
          matchReason: picked.match.matchReason,
          guardians: filledOutcomes.map((o) => ({
            admissionGuardianId: o.admissionGuardianId,
            mode: o.mode,
            parentId: o.parentId,
          })),
        },
      },
    });

    return {
      action: "reactivate_historical_learner" as const,
      idempotent: false,
      learnerId: updatedLearner.id,
      familyAccountId: familyAccount.id,
      admissionNo: updatedLearner.admissionNo,
      accountRef: familyAccount.accountRef,
      familyName: familyAccount.familyName,
      familyCreatedAt: familyAccount.createdAt,
      familyMode,
      guardianOutcomes: filledOutcomes,
      grade: decision.placement.grade,
      className: decision.placement.className ?? null,
    };
  });

  return ensureReactivationFinanceBaseline(actor.schoolId, dbResult);
}
