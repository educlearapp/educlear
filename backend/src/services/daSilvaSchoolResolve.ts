import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "./activateDaSilvaSubscription";
import { prisma } from "../prisma";

/** Canonical key for Kid-e-Sys JSON billing files (ledger, plans, history). */
export const DA_SILVA_BILLING_DATA_SCHOOL_ID = DA_SILVA_ACADEMY_SCHOOL_ID;

const daSilvaSchoolIds = new Set<string>([DA_SILVA_ACADEMY_SCHOOL_ID]);

export function registerDaSilvaSchoolId(id: string): void {
  const key = String(id || "").trim();
  if (key) daSilvaSchoolIds.add(key);
}

export function isDaSilvaSchoolId(schoolId: string): boolean {
  const key = String(schoolId || "").trim();
  if (!key) return false;
  if (daSilvaSchoolIds.has(key)) return true;
  const fromEnv = String(process.env.DA_SILVA_SCHOOL_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.includes(key);
}

/**
 * Maps a live Da Silva school row id to the canonical JSON data bucket when needed.
 */
export function resolveSchoolJsonStoreKey<T>(
  schoolId: string,
  all: Record<string, T | undefined>,
  hasContent: (value: T | undefined) => boolean
): string {
  const key = String(schoolId || "").trim();
  if (!key) return key;
  if (hasContent(all[key])) return key;
  const canonical = DA_SILVA_BILLING_DATA_SCHOOL_ID;
  if (
    key !== canonical &&
    isDaSilvaSchoolId(key) &&
    hasContent(all[canonical])
  ) {
    return canonical;
  }
  return key;
}

/** Load every Prisma school row that belongs to Da Silva Academy (name / owner email / canonical id). */
export async function refreshDaSilvaSchoolIdCache(): Promise<string[]> {
  daSilvaSchoolIds.clear();
  daSilvaSchoolIds.add(DA_SILVA_ACADEMY_SCHOOL_ID);
  daSilvaSchoolIds.add(getDaSilvaResolvedSchoolId());

  for (const id of String(process.env.DA_SILVA_SCHOOL_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    daSilvaSchoolIds.add(id);
  }

  const schools = await prisma.school.findMany({
    where: {
      OR: [
        { id: DA_SILVA_ACADEMY_SCHOOL_ID },
        { email: DA_SILVA_OWNER_EMAIL },
        { name: DA_SILVA_SCHOOL_NAME },
      ],
    },
    select: { id: true },
  });

  for (const row of schools) {
    daSilvaSchoolIds.add(row.id);
    registerDaSilvaSchoolId(row.id);
  }

  return Array.from(daSilvaSchoolIds);
}
