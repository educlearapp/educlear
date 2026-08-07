import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";

export const PARENT_ID_ALREADY_EXISTS = "PARENT_ID_ALREADY_EXISTS";
export const POSSIBLE_PARENT_MATCH = "POSSIBLE_PARENT_MATCH";

export const PARENT_ID_CONFLICT_MESSAGE =
  "This ID number already belongs to another parent record and cannot be assigned here.";

export type ExistingParentConflict = {
  id: string;
  schoolId: string;
  firstName: string;
  surname: string;
  cellNo: string;
  email: string | null;
  idNumber: string | null;
  familyAccountId: string | null;
  primaryLearnerId: string | null;
};

export type ParentIdConflictErrorPayload = {
  success: false;
  code: typeof PARENT_ID_ALREADY_EXISTS;
  message: string;
  idNumber: string;
  existingParent: ExistingParentConflict | null;
};

export type PossibleParentMatchPayload = {
  success: false;
  code: typeof POSSIBLE_PARENT_MATCH;
  message: string;
  decision: "POSSIBLE_MATCH";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  existingParent: ExistingParentConflict | null;
  candidates: Array<{
    parentId: string;
    firstName: string;
    surname: string;
    maskedIdNumber: string;
    maskedCellphone: string;
    maskedEmail: string;
    matchReasons: string[];
    primaryLearnerId: string | null;
    linkedLearnerNames: string[];
  }>;
  allowExplicitCreate: boolean;
  allowLinkExisting: boolean;
};

export class ParentIdConflictClientError extends Error {
  readonly payload: ParentIdConflictErrorPayload;

  constructor(payload: ParentIdConflictErrorPayload) {
    super(payload.message || PARENT_ID_CONFLICT_MESSAGE);
    this.name = "ParentIdConflictClientError";
    this.payload = payload;
  }
}

export class PossibleParentMatchClientError extends Error {
  readonly payload: PossibleParentMatchPayload;

  constructor(payload: PossibleParentMatchPayload) {
    super(payload.message || "An existing parent may already match these details.");
    this.name = "PossibleParentMatchClientError";
    this.payload = payload;
  }
}

export type ParentIdOwnershipResponse = {
  success: boolean;
  idNumber?: string;
  ownedByOther?: boolean;
  existingParent?: ExistingParentConflict | null;
  warning?: {
    code: "DUPLICATE_PARENT_SIGNAL";
    message: string;
    matchedBy: Array<"cellNo" | "email">;
    existingParent: ExistingParentConflict;
  } | null;
  conflictMessage?: string | null;
};

/** Owner / school admin — may use "View existing parent" / Link Existing. */
export function canViewExistingParentConflict(): boolean {
  const role = String(localStorage.getItem("userRole") || "").trim().toUpperCase();
  const appRole = String(localStorage.getItem("userAppRole") || "").trim().toLowerCase();
  const isOwner = localStorage.getItem("isOwner") === "true";
  return (
    isOwner ||
    role === "SCHOOL_ADMIN" ||
    appRole === "owner" ||
    appRole === "admin"
  );
}

export function actorRoleForApi(): string {
  if (localStorage.getItem("isOwner") === "true") return "owner";
  const appRole = String(localStorage.getItem("userAppRole") || "").trim();
  if (appRole) return appRole;
  return String(localStorage.getItem("userRole") || "").trim() || "viewer";
}

export function parseParentIdConflictPayload(payload: unknown): ParentIdConflictErrorPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  if (body.code !== PARENT_ID_ALREADY_EXISTS) return null;
  return {
    success: false,
    code: PARENT_ID_ALREADY_EXISTS,
    message: String(body.message || PARENT_ID_CONFLICT_MESSAGE),
    idNumber: String(body.idNumber || ""),
    existingParent: (body.existingParent as ExistingParentConflict) || null,
  };
}

export function parsePossibleParentMatchPayload(payload: unknown): PossibleParentMatchPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  if (body.code !== POSSIBLE_PARENT_MATCH) return null;
  return {
    success: false,
    code: POSSIBLE_PARENT_MATCH,
    message: String(body.message || "An existing parent may already match these details."),
    decision: "POSSIBLE_MATCH",
    confidence: (body.confidence as PossibleParentMatchPayload["confidence"]) || "MEDIUM",
    existingParent: (body.existingParent as ExistingParentConflict) || null,
    candidates: Array.isArray(body.candidates)
      ? (body.candidates as PossibleParentMatchPayload["candidates"])
      : [],
    allowExplicitCreate: Boolean(body.allowExplicitCreate),
    allowLinkExisting: Boolean(body.allowLinkExisting),
  };
}

export async function fetchParentIdOwnership(input: {
  idNumber: string;
  excludeParentId?: string;
  cellNo?: string;
  email?: string;
}): Promise<ParentIdOwnershipResponse> {
  const qs = new URLSearchParams();
  qs.set("idNumber", input.idNumber);
  if (input.excludeParentId) qs.set("excludeParentId", input.excludeParentId);
  if (input.cellNo) qs.set("cellNo", input.cellNo);
  if (input.email) qs.set("email", input.email);
  const response = await fetch(`${API_URL}/api/parents/id-ownership?${qs.toString()}`, {
    headers: { ...staffAuthHeaders() },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to look up parent ID ownership");
  }
  return payload as ParentIdOwnershipResponse;
}

export async function linkExistingParentToLearnerApi(input: {
  schoolId: string;
  parentId: string;
  learnerId: string;
  relation?: string;
  isPrimary?: boolean;
}): Promise<{ success: true; linked: boolean; alreadyLinked: boolean }> {
  const response = await fetch(`${API_URL}/api/parents/link-to-learner`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...staffAuthHeaders() },
    body: JSON.stringify({
      schoolId: input.schoolId,
      parentId: input.parentId,
      learnerId: input.learnerId,
      relation: input.relation,
      isPrimary: input.isPrimary,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to link existing parent");
  }
  return payload;
}

export function existingParentDisplayName(parent: ExistingParentConflict | null | undefined) {
  if (!parent) return "existing parent";
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "existing parent";
}
