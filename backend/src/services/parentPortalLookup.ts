/**
 * School-scoped Parent Portal lookup (Phase 6E).
 * Never resolves parents across tenants.
 */
import { prisma } from "../prisma";
import {
  assertSchoolModuleEntitled,
  MODULE_NOT_ENTITLED,
} from "../middleware/requireSchoolModule";

export const PARENT_PORTAL_LOOKUP_NOT_FOUND =
  "Parent not found. Check the mobile number, ID number, and selected school.";

export function buildParentLookupPhoneVariants(rawCellNo: string): string[] {
  const digits = String(rawCellNo || "").replace(/\D/g, "");
  if (!digits) return [];

  const localCell = digits.startsWith("27") ? `0${digits.slice(2)}` : digits;
  const internationalCell = digits.startsWith("27")
    ? `+${digits}`
    : `+27${digits.replace(/^0/, "")}`;
  const plainInternational = internationalCell.replace("+", "");

  return Array.from(
    new Set(
      [rawCellNo, localCell, internationalCell, plainInternational]
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  );
}

export type ParentPortalLookupResult =
  | {
      ok: true;
      parent: {
        id: string;
        firstName: string;
        surname: string;
        cellNo: string | null;
        email: string | null;
        school: { id: string; name: string } | null;
      };
      learners: Array<{
        linkId: string;
        isPrimary: boolean;
        relation: string;
        learner: {
          id: string;
          firstName: string;
          lastName: string;
          grade: string | null;
          className: string | null;
          admissionNo: string | null;
        };
      }>;
    }
  | {
      ok: false;
      status: 400 | 403 | 404;
      error: string;
      code?: string;
      module?: string;
    };

/**
 * Tenant-isolated Parent Portal lookup.
 * Explicit CORE=false → denied. Missing entitlement rows → fail-open (CORE treated enabled).
 * Queries are always constrained to the supplied schoolId — no cross-tenant fallback.
 */
export async function lookupParentPortalBySchool(input: {
  schoolId: string;
  cellNo: string;
  idNumber?: string;
}): Promise<ParentPortalLookupResult> {
  const schoolId = String(input.schoolId || "").trim();
  const rawCellNo = String(input.cellNo || "").trim();
  const idNumber = String(input.idNumber || "").trim();

  if (!schoolId || !rawCellNo) {
    return {
      ok: false,
      status: 400,
      error: "schoolId and cellNo are required",
    };
  }

  const coreGate = await assertSchoolModuleEntitled(schoolId, "CORE");
  if (!coreGate.allowed) {
    return {
      ok: false,
      status: coreGate.status === 400 ? 400 : 403,
      error: coreGate.error,
      code: coreGate.code || MODULE_NOT_ENTITLED,
      module: "CORE",
    };
  }

  const phoneVariants = buildParentLookupPhoneVariants(rawCellNo);
  if (!phoneVariants.length) {
    return { ok: false, status: 404, error: PARENT_PORTAL_LOOKUP_NOT_FOUND };
  }

  const parent = await prisma.parent.findFirst({
    where: {
      schoolId,
      OR: [
        ...phoneVariants.map((cellNo) => ({ cellNo })),
        ...(idNumber ? [{ idNumber }] : []),
      ],
    },
    include: {
      links: {
        where: { schoolId },
        include: {
          learner: true,
        },
      },
      school: { select: { id: true, name: true } },
    },
  });

  if (!parent || parent.schoolId !== schoolId) {
    return { ok: false, status: 404, error: PARENT_PORTAL_LOOKUP_NOT_FOUND };
  }

  // Defense: only include learners that belong to the same school.
  const learners = (parent.links || [])
    .filter((link) => {
      const learnerSchoolId = String((link.learner as { schoolId?: string } | null)?.schoolId || "").trim();
      return !learnerSchoolId || learnerSchoolId === schoolId;
    })
    .map((link) => ({
      linkId: link.id,
      isPrimary: Boolean(link.isPrimary),
      relation: String(link.relation || (link as { relationship?: string }).relationship || ""),
      learner: {
        id: link.learner.id,
        firstName: link.learner.firstName,
        lastName: link.learner.lastName,
        grade: link.learner.grade,
        className: link.learner.className,
        admissionNo: link.learner.admissionNo,
      },
    }));

  return {
    ok: true,
    parent: {
      id: parent.id,
      firstName: parent.firstName,
      surname: parent.surname,
      cellNo: parent.cellNo,
      email: parent.email,
      school: parent.school
        ? { id: parent.school.id, name: parent.school.name }
        : { id: schoolId, name: "" },
    },
    learners,
  };
}
