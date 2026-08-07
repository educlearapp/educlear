/**
 * Normal-application Parent identity check.
 * Reuses migration normalization + resolveParentIdentity principles.
 * Does NOT auto-merge historical duplicates. Does NOT mutate FamilyAccount.
 */

import type { PrismaClient } from "@prisma/client";
import {
  firstNamesCompatible,
  maskCellphone,
  maskEmail,
  maskIdentityNumber,
  normalizeParentCellphone,
  normalizeParentEmail,
  normalizeParentIdentityNumber,
  resolveParentIdentity,
  type ExistingParentCandidate,
  type ParentIdentityCandidateView,
} from "./migration/parentIdentity";
import {
  buildParentIdConflictBody,
  PARENT_ID_ALREADY_EXISTS,
  type ParentIdConflictBody,
  type ParentIdConflictExisting,
} from "../utils/parentIdConflict";

export const POSSIBLE_PARENT_MATCH = "POSSIBLE_PARENT_MATCH" as const;
export const PARENT_CONTACT_CONFLICT_DIFFERENT_IDS = "PARENT_CONTACT_CONFLICT_DIFFERENT_IDS" as const;

export type ApplicationParentIdentityDecision =
  | "CREATE_ALLOWED"
  | "EXISTING_PARENT_MATCH"
  | "POSSIBLE_MATCH"
  | "CONFLICT"
  | "EDIT_SELF_OK";

export type ApplicationParentCandidateView = {
  parentId: string;
  firstName: string;
  surname: string;
  maskedIdNumber: string;
  maskedCellphone: string;
  maskedEmail: string;
  matchReasons: string[];
  conflictReasons: string[];
  primaryLearnerId: string | null;
  linkedLearnerNames: string[];
};

export type ApplicationParentIdentityResult = {
  decision: ApplicationParentIdentityDecision;
  code?:
    | typeof PARENT_ID_ALREADY_EXISTS
    | typeof POSSIBLE_PARENT_MATCH
    | typeof PARENT_CONTACT_CONFLICT_DIFFERENT_IDS;
  message: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  existingParent: ParentIdConflictExisting | null;
  candidates: ApplicationParentCandidateView[];
  /** True when Owner/Admin may proceed with create after explicit confirm. */
  allowExplicitCreate: boolean;
  /** True when Owner/Admin may link the existing Parent instead of creating. */
  allowLinkExisting: boolean;
};

export class ParentPossibleMatchError extends Error {
  readonly statusCode = 409;
  readonly body: {
    success: false;
    code: typeof POSSIBLE_PARENT_MATCH;
    message: string;
    decision: "POSSIBLE_MATCH";
    confidence: "HIGH" | "MEDIUM" | "LOW";
    existingParent: ParentIdConflictExisting | null;
    candidates: ApplicationParentCandidateView[];
    allowExplicitCreate: boolean;
    allowLinkExisting: boolean;
  };

  constructor(result: ApplicationParentIdentityResult) {
    super(result.message);
    this.name = "ParentPossibleMatchError";
    this.body = {
      success: false,
      code: POSSIBLE_PARENT_MATCH,
      message: result.message,
      decision: "POSSIBLE_MATCH",
      confidence: result.confidence,
      existingParent: result.existingParent,
      candidates: result.candidates,
      allowExplicitCreate: result.allowExplicitCreate,
      allowLinkExisting: result.allowLinkExisting,
    };
  }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export function isOwnerAdminActor(actorRole: unknown): boolean {
  const role = String(actorRole || "").trim().toUpperCase();
  const app = String(actorRole || "").trim().toLowerCase();
  return (
    role === "SCHOOL_ADMIN" ||
    role === "OWNER" ||
    app === "owner" ||
    app === "admin" ||
    app === "school_admin"
  );
}

async function loadSchoolCandidates(
  prisma: PrismaClient,
  schoolId: string,
  excludeParentId?: string | null
): Promise<(ExistingParentCandidate & { primaryLearnerId: string | null; linkedLearnerNames: string[] })[]> {
  const rows = await prisma.parent.findMany({
    where: {
      schoolId,
      ...(excludeParentId ? { id: { not: String(excludeParentId) } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      surname: true,
      idNumber: true,
      cellNo: true,
      email: true,
      familyAccountId: true,
      links: {
        take: 5,
        orderBy: { isPrimary: "desc" },
        select: {
          learnerId: true,
          isPrimary: true,
          learner: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  return rows.map((r) => {
    const primary = r.links.find((l) => l.isPrimary) || r.links[0] || null;
    return {
      id: r.id,
      firstName: r.firstName,
      surname: r.surname,
      idNumber: r.idNumber,
      cellNo: r.cellNo,
      email: r.email,
      familyAccountId: r.familyAccountId,
      primaryLearnerId: primary?.learnerId || null,
      linkedLearnerNames: r.links
        .map((l) => `${l.learner?.firstName || ""} ${l.learner?.lastName || ""}`.trim())
        .filter(Boolean),
    };
  });
}

function toConflictExisting(
  c: ExistingParentCandidate & { primaryLearnerId?: string | null }
): ParentIdConflictExisting {
  return {
    id: c.id,
    schoolId: "", // filled by caller when known
    firstName: c.firstName,
    surname: c.surname,
    cellNo: String(c.cellNo || ""),
    email: c.email ?? null,
    idNumber: c.idNumber ?? null,
    familyAccountId: c.familyAccountId ?? null,
    primaryLearnerId: c.primaryLearnerId ?? null,
  };
}

function enrichCandidate(
  view: ParentIdentityCandidateView,
  meta: { primaryLearnerId: string | null; linkedLearnerNames: string[] },
  includeLearnerNames: boolean
): ApplicationParentCandidateView {
  return {
    parentId: view.parentId,
    firstName: view.firstName,
    surname: view.surname,
    maskedIdNumber: view.maskedIdNumber,
    maskedCellphone: view.maskedCellphone,
    maskedEmail: view.maskedEmail,
    matchReasons: view.matchReasons,
    conflictReasons: view.conflictReasons,
    primaryLearnerId: meta.primaryLearnerId,
    linkedLearnerNames: includeLearnerNames ? meta.linkedLearnerNames : [],
  };
}

/**
 * Application identity check for CREATE or EDIT.
 * Exclude current Parent.id on EDIT so self is never treated as a duplicate.
 */
export async function checkApplicationParentIdentity(opts: {
  prisma: PrismaClient;
  schoolId: string;
  incoming: {
    firstName?: string | null;
    surname?: string | null;
    idNumber?: string | null;
    cellNo?: string | null;
    email?: string | null;
    relationship?: string | null;
  };
  /** When editing an existing Parent, exclude that id from candidates. */
  excludeParentId?: string | null;
  /** Owner/Admin may see linked learner names. */
  actorIsOwnerAdmin?: boolean;
}): Promise<ApplicationParentIdentityResult> {
  const schoolId = cleanString(opts.schoolId);
  const excludeParentId = cleanString(opts.excludeParentId) || null;
  const includeNames = Boolean(opts.actorIsOwnerAdmin);

  const candidatesRaw = await loadSchoolCandidates(opts.prisma, schoolId, excludeParentId);
  const candidates: ExistingParentCandidate[] = candidatesRaw.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    surname: c.surname,
    idNumber: c.idNumber,
    cellNo: c.cellNo,
    email: c.email,
    familyAccountId: c.familyAccountId,
  }));
  const metaById = new Map(candidatesRaw.map((c) => [c.id, c]));

  const incoming = {
    firstName: cleanString(opts.incoming.firstName) || "Parent",
    surname: cleanString(opts.incoming.surname) || "-",
    idNumber: opts.incoming.idNumber,
    cellNo: opts.incoming.cellNo,
    email: opts.incoming.email,
    relationship: opts.incoming.relationship,
    sourceSystem: "MANUAL" as const,
  };

  // Exact ID owned by another parent (school-scoped preference; global unique still applies).
  const inId = normalizeParentIdentityNumber(incoming.idNumber);
  if (inId) {
    const byId = await opts.prisma.parent.findUnique({
      where: { idNumber: inId },
      select: {
        id: true,
        schoolId: true,
        firstName: true,
        surname: true,
        cellNo: true,
        email: true,
        idNumber: true,
        familyAccountId: true,
        links: {
          take: 1,
          orderBy: { isPrimary: "desc" },
          select: { learnerId: true },
        },
      },
    });
    if (byId && (!excludeParentId || byId.id !== excludeParentId)) {
      if (byId.schoolId !== schoolId) {
        // Cross-tenant: do not leak other-school parent details.
        return {
          decision: "EXISTING_PARENT_MATCH",
          code: PARENT_ID_ALREADY_EXISTS,
          message:
            "This ID number already belongs to another parent record and cannot be assigned here.",
          confidence: "HIGH",
          existingParent: null,
          candidates: [],
          allowExplicitCreate: false,
          allowLinkExisting: false,
        };
      }
      const existing: ParentIdConflictExisting = {
        id: byId.id,
        schoolId: byId.schoolId,
        firstName: byId.firstName,
        surname: byId.surname,
        cellNo: byId.cellNo,
        email: byId.email,
        idNumber: byId.idNumber,
        familyAccountId: byId.familyAccountId,
        primaryLearnerId: byId.links[0]?.learnerId || null,
      };
      return {
        decision: "EXISTING_PARENT_MATCH",
        code: PARENT_ID_ALREADY_EXISTS,
        message:
          "This ID number already belongs to another parent record and cannot be assigned here.",
        confidence: "HIGH",
        existingParent: existing,
        candidates: [
          {
            parentId: existing.id,
            firstName: existing.firstName,
            surname: existing.surname,
            maskedIdNumber: maskIdentityNumber(existing.idNumber),
            maskedCellphone: maskCellphone(existing.cellNo),
            maskedEmail: maskEmail(existing.email),
            matchReasons: ["EXACT_IDENTITY_NUMBER"],
            conflictReasons: [],
            primaryLearnerId: existing.primaryLearnerId,
            linkedLearnerNames: [],
          },
        ],
        allowExplicitCreate: false,
        allowLinkExisting: true,
      };
    }
  }

  if (excludeParentId && !inId && !normalizeParentCellphone(incoming.cellNo) && !normalizeParentEmail(incoming.email)) {
    return {
      decision: "EDIT_SELF_OK",
      message: "Edit of existing parent.",
      confidence: "HIGH",
      existingParent: null,
      candidates: [],
      allowExplicitCreate: false,
      allowLinkExisting: false,
    };
  }

  const decision = resolveParentIdentity({
    incoming,
    candidates,
  });

  const mappedCandidates = decision.candidates.map((v) => {
    const meta = metaById.get(v.parentId);
    return enrichCandidate(
      v,
      {
        primaryLearnerId: meta?.primaryLearnerId || null,
        linkedLearnerNames: meta?.linkedLearnerNames || [],
      },
      includeNames
    );
  });

  if (decision.decision === "CONFLICT") {
    return {
      decision: "CONFLICT",
      code: PARENT_CONTACT_CONFLICT_DIFFERENT_IDS,
      message:
        "Another parent uses this contact information, but the identity numbers are different. They are treated as different people.",
      confidence: "HIGH",
      existingParent: null,
      candidates: mappedCandidates,
      allowExplicitCreate: true,
      allowLinkExisting: false,
    };
  }

  if (decision.decision === "REUSE_EXISTING" && decision.parentId) {
    // Strong corroboration without ID (cell+email+first) → POSSIBLE_MATCH for app UX (no silent reuse).
    const meta = metaById.get(decision.parentId);
    const existing = meta
      ? { ...toConflictExisting(meta), schoolId }
      : null;
    const strongWithoutId =
      !inId &&
      decision.reasons.includes("NORMALIZED_CELLPHONE_MATCH") &&
      decision.reasons.includes("NORMALIZED_EMAIL_MATCH");
    if (strongWithoutId || decision.reasons.includes("EXACT_IDENTITY_NUMBER")) {
      if (decision.reasons.includes("EXACT_IDENTITY_NUMBER") && existing) {
        return {
          decision: "EXISTING_PARENT_MATCH",
          code: PARENT_ID_ALREADY_EXISTS,
          message:
            "This ID number already belongs to another parent record and cannot be assigned here.",
          confidence: "HIGH",
          existingParent: existing,
          candidates: mappedCandidates,
          allowExplicitCreate: false,
          allowLinkExisting: true,
        };
      }
      return {
        decision: "POSSIBLE_MATCH",
        code: POSSIBLE_PARENT_MATCH,
        message: "An existing parent may already match these details.",
        confidence: decision.confidence,
        existingParent: existing,
        candidates: mappedCandidates,
        allowExplicitCreate: true,
        allowLinkExisting: true,
      };
    }
  }

  if (decision.decision === "REVIEW_REQUIRED") {
    const top = mappedCandidates[0] || null;
    const meta = top ? metaById.get(top.parentId) : null;
    const existing = meta ? { ...toConflictExisting(meta), schoolId } : null;
    const singleContact =
      decision.reasons.includes("SINGLE_CONTACT_ONLY") ||
      (decision.reasons.includes("NORMALIZED_CELLPHONE_MATCH") &&
        !decision.reasons.includes("NORMALIZED_EMAIL_MATCH")) ||
      (decision.reasons.includes("NORMALIZED_EMAIL_MATCH") &&
        !decision.reasons.includes("NORMALIZED_CELLPHONE_MATCH"));

    return {
      decision: "POSSIBLE_MATCH",
      code: POSSIBLE_PARENT_MATCH,
      message: singleContact
        ? "Another parent shares this contact information. Confirm whether they are the same person before creating a new record."
        : "An existing parent may already match these details.",
      confidence: decision.confidence,
      existingParent: existing,
      candidates: mappedCandidates,
      // Single-contact: warning but create allowed without forced confirm flag severity is lower —
      // still require explicit confirm for strong double-contact; for single allow create with warning flag.
      allowExplicitCreate: true,
      allowLinkExisting: Boolean(existing),
    };
  }

  return {
    decision: "CREATE_ALLOWED",
    message: "No blocking identity match — create allowed.",
    confidence: "HIGH",
    existingParent: null,
    candidates: [],
    allowExplicitCreate: true,
    allowLinkExisting: false,
  };
}

/** Strong double-contact match requires explicit confirmCreateDespiteMatch. */
export function requiresExplicitCreateConfirmation(result: ApplicationParentIdentityResult): boolean {
  if (result.decision !== "POSSIBLE_MATCH") return false;
  const reasons = result.candidates.flatMap((c) => c.matchReasons);
  return (
    reasons.includes("NORMALIZED_CELLPHONE_MATCH") && reasons.includes("NORMALIZED_EMAIL_MATCH")
  );
}

/**
 * Link existing Parent → Learner. Does NOT create Parent, merge, or change FamilyAccount.
 */
export async function linkExistingParentToLearner(opts: {
  prisma: PrismaClient;
  schoolId: string;
  parentId: string;
  learnerId: string;
  relation?: string | null;
  isPrimary?: boolean;
  actorIsOwnerAdmin: boolean;
}): Promise<{
  success: true;
  linked: boolean;
  alreadyLinked: boolean;
  parentId: string;
  learnerId: string;
  linkId: string;
}> {
  if (!opts.actorIsOwnerAdmin) {
    throw Object.assign(new Error("Only Owner/Admin may link an existing parent."), {
      statusCode: 403,
      code: "FORBIDDEN_LINK_EXISTING_PARENT",
    });
  }
  const schoolId = cleanString(opts.schoolId);
  const parentId = cleanString(opts.parentId);
  const learnerId = cleanString(opts.learnerId);
  if (!schoolId || !parentId || !learnerId) {
    throw Object.assign(new Error("schoolId, parentId, and learnerId are required"), {
      statusCode: 400,
    });
  }

  const parent = await opts.prisma.parent.findFirst({
    where: { id: parentId, schoolId },
    select: { id: true, schoolId: true },
  });
  if (!parent) {
    throw Object.assign(new Error("Parent not found in this school"), {
      statusCode: 404,
      code: "PARENT_NOT_FOUND",
    });
  }

  const learner = await opts.prisma.learner.findFirst({
    where: { id: learnerId, schoolId },
    select: { id: true, schoolId: true },
  });
  if (!learner) {
    throw Object.assign(new Error("Learner not found in this school"), {
      statusCode: 404,
      code: "LEARNER_NOT_FOUND",
    });
  }

  const existing = await opts.prisma.parentLearnerLink.findUnique({
    where: { parentId_learnerId: { parentId, learnerId } },
    select: { id: true },
  });
  if (existing) {
    return {
      success: true,
      linked: false,
      alreadyLinked: true,
      parentId,
      learnerId,
      linkId: existing.id,
    };
  }

  const link = await opts.prisma.parentLearnerLink.create({
    data: {
      schoolId,
      parentId,
      learnerId,
      relation: cleanString(opts.relation) || null,
      isPrimary: opts.isPrimary !== undefined ? Boolean(opts.isPrimary) : true,
    },
    select: { id: true },
  });

  return {
    success: true,
    linked: true,
    alreadyLinked: false,
    parentId,
    learnerId,
    linkId: link.id,
  };
}

export async function buildConflictBodyFromCheck(
  prisma: PrismaClient,
  idNumber: string
): Promise<ParentIdConflictBody> {
  return buildParentIdConflictBody(prisma, idNumber);
}

/** Exported for tests — surname compatibility is never an identity key alone. */
export function applicationNamesAreIdentityKeys(): false {
  return false;
}

export {
  firstNamesCompatible,
  normalizeParentCellphone,
  normalizeParentEmail,
  normalizeParentIdentityNumber,
};
