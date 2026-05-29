/**
 * Production-safe Learner probes and queries for Da Silva audit/repair scripts.
 * Avoids Prisma P2022 when optional columns (e.g. enrollmentStatus) are not migrated yet.
 */
import type { PrismaClient } from "@prisma/client";

export type DaSilvaLearnerSchemaCaps = {
  enrollmentStatus: boolean;
  notes: string[];
};

const LEARNER_OPTIONAL_COLUMNS = ["enrollmentStatus"] as const;

export const LEARNER_PRODUCTION_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  className: true,
  admissionNo: true,
  familyAccountId: true,
  schoolId: true,
  createdAt: true,
} as const;

export const DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS = "Enrolled";

export function isPrismaMissingColumnError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2022"
  );
}

export async function probePublicTableColumns(
  prisma: PrismaClient,
  tableName: string
): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `;
  return new Set(rows.map((r) => r.column_name));
}

export async function getDaSilvaLearnerSchemaCaps(
  prisma: PrismaClient
): Promise<DaSilvaLearnerSchemaCaps> {
  const cols = await probePublicTableColumns(prisma, "Learner");
  const notes: string[] = [];
  for (const name of LEARNER_OPTIONAL_COLUMNS) {
    if (!cols.has(name)) {
      notes.push(`Learner.${name} not available in schema`);
    }
  }
  return {
    enrollmentStatus: cols.has("enrollmentStatus"),
    notes,
  };
}

export function deriveLearnerDisplayStatus(
  caps: DaSilvaLearnerSchemaCaps,
  enrollmentStatus?: string | null
): string {
  if (!caps.enrollmentStatus) {
    return DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS;
  }
  const upper = String(enrollmentStatus || "ACTIVE").toUpperCase();
  if (upper === "HISTORICAL") return "Historical";
  return DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS;
}

export type SampleLearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  admissionNo: string | null;
  familyAccountId: string | null;
  schoolId: string;
  createdAt: Date;
  displayStatus: string;
  accountRef: string | null;
  parentLinkCount: number | null;
  relationsNote: string | null;
};

export async function fetchSampleLearnersSafe(
  prisma: PrismaClient,
  schoolId: string,
  caps: DaSilvaLearnerSchemaCaps,
  take = 10
): Promise<SampleLearnerRow[]> {
  const orderBy = { lastName: "asc" as const };
  const where = { schoolId };

  type RawRow = {
    id: string;
    firstName: string;
    lastName: string;
    className: string | null;
    admissionNo: string | null;
    familyAccountId: string | null;
    schoolId: string;
    createdAt: Date;
    enrollmentStatus?: string;
    familyAccount?: { accountRef: string } | null;
    links?: { parentId: string }[];
  };

  const baseSelect = {
    ...LEARNER_PRODUCTION_SELECT,
    ...(caps.enrollmentStatus ? { enrollmentStatus: true } : {}),
  };

  const attempts: Array<{
    label: string;
    select: Record<string, unknown>;
  }> = [
    {
      label: "with familyAccount and links",
      select: {
        ...baseSelect,
        familyAccount: { select: { accountRef: true } },
        links: { select: { parentId: true } },
      },
    },
    {
      label: "with familyAccount only",
      select: {
        ...baseSelect,
        familyAccount: { select: { accountRef: true } },
      },
    },
    {
      label: "learner fields only",
      select: baseSelect,
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const rows = (await prisma.learner.findMany({
        where,
        take,
        orderBy,
        select: attempt.select as never,
      })) as RawRow[];

      const relationsNote =
        attempt.label === "learner fields only"
          ? "familyAccount/links not available in schema"
          : null;

      return rows.map((l) => ({
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        className: l.className,
        admissionNo: l.admissionNo,
        familyAccountId: l.familyAccountId,
        schoolId: l.schoolId,
        createdAt: l.createdAt,
        displayStatus: deriveLearnerDisplayStatus(caps, l.enrollmentStatus),
        accountRef: l.familyAccount?.accountRef ?? null,
        parentLinkCount: l.links ? l.links.length : relationsNote ? null : 0,
        relationsNote,
      }));
    } catch (error) {
      lastError = error;
      if (!isPrismaMissingColumnError(error)) throw error;
    }
  }

  throw lastError;
}

export async function countParentLearnerLinksSafe(
  prisma: PrismaClient,
  schoolId: string
): Promise<{ count: number; note: string | null }> {
  try {
    const count = await prisma.parentLearnerLink.count({ where: { schoolId } });
    return { count, note: null };
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;
    return { count: 0, note: "ParentLearnerLink not available in schema" };
  }
}

export async function countFamilyAccountsWithLearnersSafe(
  prisma: PrismaClient,
  schoolId: string
): Promise<{ count: number; note: string | null }> {
  try {
    const count = await prisma.familyAccount.count({
      where: { schoolId, learners: { some: {} } },
    });
    return { count, note: null };
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;
    return { count: 0, note: "FamilyAccount.learners relation not available in schema" };
  }
}
