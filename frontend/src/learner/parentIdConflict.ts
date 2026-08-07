import { API_URL } from "../api";

export const PARENT_ID_ALREADY_EXISTS = "PARENT_ID_ALREADY_EXISTS";

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

export class ParentIdConflictClientError extends Error {
  readonly payload: ParentIdConflictErrorPayload;

  constructor(payload: ParentIdConflictErrorPayload) {
    super(payload.message || PARENT_ID_CONFLICT_MESSAGE);
    this.name = "ParentIdConflictClientError";
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

/** Owner / school admin — may use "View existing parent". */
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
  const response = await fetch(`${API_URL}/api/parents/id-ownership?${qs.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to look up parent ID ownership");
  }
  return payload as ParentIdOwnershipResponse;
}

export function existingParentDisplayName(parent: ExistingParentConflict | null | undefined) {
  if (!parent) return "existing parent";
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "existing parent";
}
