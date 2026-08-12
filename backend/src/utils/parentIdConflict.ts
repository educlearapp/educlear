/**
 * Parent.idNumber uniqueness helpers — school-scoped.
 * Uniqueness rule: @@unique([schoolId, idNumber]) — same SA ID may exist at different schools.
 */

export const PARENT_ID_ALREADY_EXISTS = "PARENT_ID_ALREADY_EXISTS" as const;

export const PARENT_ID_CONFLICT_MESSAGE =
  "This ID number already belongs to another parent at this school and cannot be assigned here.";

export class ParentIdConflictError extends Error {
  readonly statusCode = 409;
  readonly body: ParentIdConflictBody;

  constructor(body: ParentIdConflictBody) {
    super(body.message);
    this.name = "ParentIdConflictError";
    this.body = body;
  }
}

export type ParentIdConflictExisting = {
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

export type ParentIdConflictBody = {
  success: false;
  code: typeof PARENT_ID_ALREADY_EXISTS;
  message: string;
  idNumber: string;
  existingParent: ParentIdConflictExisting | null;
};

export type ParentIdOwnershipWarning = {
  code: "DUPLICATE_PARENT_SIGNAL";
  message: string;
  matchedBy: Array<"cellNo" | "email">;
  existingParent: ParentIdConflictExisting;
};

type PrismaLike = {
  parent: {
    findFirst: (args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => Promise<any>;
  };
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  if (err?.code === "P2002") return true;
  const msg = String(err?.message || error || "");
  return /Unique constraint failed/i.test(msg) && /idNumber/i.test(msg);
}

/** True when P2002 targets Parent idNumber (alone or with schoolId composite). */
export function isParentIdNumberUniqueTarget(error: unknown): boolean {
  if (!isPrismaUniqueConstraintError(error)) return false;
  const err = error as { meta?: { target?: string | string[] }; message?: string };
  const target = err?.meta?.target;
  if (Array.isArray(target)) {
    return target.some((t) => String(t).toLowerCase().includes("idnumber"));
  }
  if (typeof target === "string") {
    return target.toLowerCase().includes("idnumber");
  }
  return /idNumber/i.test(String(err?.message || error || ""));
}

function mapExistingParent(row: any): ParentIdConflictExisting {
  const primaryLink = Array.isArray(row?.links) ? row.links[0] : null;
  return {
    id: String(row.id),
    schoolId: String(row.schoolId || ""),
    firstName: String(row.firstName || ""),
    surname: String(row.surname || ""),
    cellNo: String(row.cellNo || ""),
    email: row.email == null ? null : String(row.email),
    idNumber: row.idNumber == null ? null : String(row.idNumber),
    familyAccountId: row.familyAccountId == null ? null : String(row.familyAccountId),
    primaryLearnerId: primaryLink?.learnerId ? String(primaryLink.learnerId) : null,
  };
}

const existingParentSelect = {
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
    orderBy: { isPrimary: "desc" as const },
    select: { learnerId: true },
  },
};

/**
 * Find a Parent by SA ID within one school (authoritative uniqueness scope).
 */
export async function findParentByIdNumberInSchool(
  prisma: PrismaLike,
  schoolId: string,
  idNumber: string
): Promise<ParentIdConflictExisting | null> {
  const cleaned = cleanString(idNumber);
  const sid = cleanString(schoolId);
  if (!cleaned || !sid) return null;
  const row = await prisma.parent.findFirst({
    where: { schoolId: sid, idNumber: cleaned },
    select: existingParentSelect,
  });
  return row ? mapExistingParent(row) : null;
}

/**
 * @deprecated Prefer findParentByIdNumberInSchool — SA ID uniqueness is school-scoped.
 * Kept as a thin alias that requires schoolId via opts for call-site migration.
 */
export async function findParentByIdNumber(
  prisma: PrismaLike,
  idNumber: string,
  schoolId?: string
): Promise<ParentIdConflictExisting | null> {
  const sid = cleanString(schoolId);
  if (!sid) return null;
  return findParentByIdNumberInSchool(prisma, sid, idNumber);
}

export async function buildParentIdConflictBody(
  prisma: PrismaLike,
  idNumber: string,
  schoolId?: string
): Promise<ParentIdConflictBody> {
  const cleaned = cleanString(idNumber);
  const sid = cleanString(schoolId);
  const existingParent =
    cleaned && sid ? await findParentByIdNumberInSchool(prisma, sid, cleaned) : null;
  return {
    success: false,
    code: PARENT_ID_ALREADY_EXISTS,
    message: PARENT_ID_CONFLICT_MESSAGE,
    idNumber: cleaned,
    existingParent,
  };
}

/**
 * Pre-save soft warning: another parent in the SAME school already owns this ID and shares
 * cell and/or email with the record being edited. Does not block save by itself.
 */
export async function findDuplicateParentSignal(opts: {
  prisma: PrismaLike;
  schoolId: string;
  idNumber: string;
  excludeParentId?: string | null;
  cellNo?: string | null;
  email?: string | null;
}): Promise<ParentIdOwnershipWarning | null> {
  const idNumber = cleanString(opts.idNumber);
  const schoolId = cleanString(opts.schoolId);
  if (!idNumber || !schoolId) return null;

  const existing = await findParentByIdNumberInSchool(opts.prisma, schoolId, idNumber);
  if (!existing) return null;
  if (opts.excludeParentId && existing.id === String(opts.excludeParentId)) return null;

  const cellNo = cleanString(opts.cellNo);
  const email = cleanString(opts.email).toLowerCase();
  const matchedBy: Array<"cellNo" | "email"> = [];

  if (cellNo && cellNo !== "-" && cellNo !== "0000000000" && existing.cellNo === cellNo) {
    matchedBy.push("cellNo");
  }
  if (email && existing.email && existing.email.trim().toLowerCase() === email) {
    matchedBy.push("email");
  }

  if (!matchedBy.length) return null;

  return {
    code: "DUPLICATE_PARENT_SIGNAL",
    message: "This learner appears to be linked to a duplicate parent record.",
    matchedBy,
    existingParent: existing,
  };
}
