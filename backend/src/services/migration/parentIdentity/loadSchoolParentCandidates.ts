/**
 * DB helpers for migration parent identity — school-scoped candidate load.
 * Intentionally ignores familyAccountId for identity matching.
 */

import type { PrismaClient } from "@prisma/client";
import type { ExistingParentCandidate } from "./parentIdentityTypes";

export async function loadSchoolParentCandidates(
  prisma: PrismaClient,
  schoolId: string
): Promise<ExistingParentCandidate[]> {
  const rows = await prisma.parent.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      surname: true,
      idNumber: true,
      cellNo: true,
      email: true,
      familyAccountId: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    surname: r.surname,
    idNumber: r.idNumber,
    cellNo: r.cellNo,
    email: r.email,
    familyAccountId: r.familyAccountId,
  }));
}

/**
 * Safe contact enrichment on reuse: fill blanks only.
 * NEVER overwrites firstName, surname, or an existing non-empty idNumber.
 */
export function buildParentReuseUpdateData(input: {
  existing: {
    email?: string | null;
    cellNo?: string | null;
    idNumber?: string | null;
    workNo?: string | null;
    homeNo?: string | null;
    relationship?: string | null;
  };
  incoming: {
    email?: string | null;
    cellNo?: string | null;
    idNumber?: string | null;
    workNo?: string | null;
    homeNo?: string | null;
    relationship?: string | null;
  };
  /** Normalized cell for storage when existing cell is placeholder. */
  normalizedCellNo?: string | null;
}): Record<string, string | null | undefined> {
  const data: Record<string, string | null | undefined> = {};
  const existingEmail = String(input.existing.email || "").trim();
  const incomingEmail = String(input.incoming.email || "").trim();
  if (!existingEmail && incomingEmail) data.email = incomingEmail;

  const existingCell = String(input.existing.cellNo || "").trim();
  const placeholder = !existingCell || existingCell === "-" || existingCell === "0000000000";
  if (placeholder && input.normalizedCellNo && input.normalizedCellNo !== "0000000000") {
    data.cellNo = input.normalizedCellNo;
  }

  const existingId = String(input.existing.idNumber || "").trim();
  const incomingId = String(input.incoming.idNumber || "").trim();
  if (!existingId && incomingId) data.idNumber = incomingId;

  if (!String(input.existing.workNo || "").trim() && input.incoming.workNo) {
    data.workNo = input.incoming.workNo;
  }
  if (!String(input.existing.homeNo || "").trim() && input.incoming.homeNo) {
    data.homeNo = input.incoming.homeNo;
  }
  if (!String(input.existing.relationship || "").trim() && input.incoming.relationship) {
    data.relationship = input.incoming.relationship;
  }
  return data;
}
