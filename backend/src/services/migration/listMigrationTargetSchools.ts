import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  setDaSilvaResolvedSchoolId,
} from "../activateDaSilvaSubscription";
import { refreshDaSilvaSchoolIdCache } from "../daSilvaSchoolResolve";
import { prisma } from "../../prisma";

export type MigrationTargetSchool = {
  id: string;
  name: string;
};

export type MigrationTargetSchoolsDebug = {
  total: number;
  schoolIds: string[];
  schoolNames: string[];
  ensuredDaSilva: boolean;
  daSilvaCreated: boolean;
  daSilvaSchoolId: string | null;
};

export type MigrationTargetSchoolsResult = {
  schools: MigrationTargetSchool[];
  debug: MigrationTargetSchoolsDebug;
};

/**
 * Ensures Da Silva Academy exists as a migration target when the row was removed by hard delete.
 * Does not import learners or billing — school shell only.
 */
async function ensureDaSilvaSchoolRow(): Promise<{
  id: string;
  created: boolean;
} | null> {
  try {
    const byId = await prisma.school.findUnique({
      where: { id: DA_SILVA_ACADEMY_SCHOOL_ID },
      select: { id: true },
    });
    if (byId) {
      setDaSilvaResolvedSchoolId(byId.id);
      return { id: byId.id, created: false };
    }

    const byEmail = await prisma.school.findFirst({
      where: { email: DA_SILVA_OWNER_EMAIL },
      select: { id: true },
    });
    if (byEmail) {
      await prisma.school.update({
        where: { id: byEmail.id },
        data: { name: DA_SILVA_SCHOOL_NAME, email: DA_SILVA_OWNER_EMAIL },
      });
      setDaSilvaResolvedSchoolId(byEmail.id);
      return { id: byEmail.id, created: false };
    }

    const byName = await prisma.school.findFirst({
      where: { name: DA_SILVA_SCHOOL_NAME },
      select: { id: true },
    });
    if (byName) {
      setDaSilvaResolvedSchoolId(byName.id);
      return { id: byName.id, created: false };
    }

    await prisma.school.create({
      data: {
        id: DA_SILVA_ACADEMY_SCHOOL_ID,
        name: DA_SILVA_SCHOOL_NAME,
        email: DA_SILVA_OWNER_EMAIL,
      },
    });
    setDaSilvaResolvedSchoolId(DA_SILVA_ACADEMY_SCHOOL_ID);
    return { id: DA_SILVA_ACADEMY_SCHOOL_ID, created: true };
  } catch (error) {
    console.error("[listMigrationTargetSchools] ensure Da Silva school failed:", error);
    return null;
  }
}

/** All Prisma School rows for migration target picker — alphabetical, no platform-only filter. */
export async function listMigrationTargetSchools(): Promise<MigrationTargetSchoolsResult> {
  const daSilva = await ensureDaSilvaSchoolRow();
  await refreshDaSilvaSchoolIdCache().catch(() => {});

  const rows = await prisma.school.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const schools: MigrationTargetSchool[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
  }));

  const schoolIds = schools.map((s) => s.id);
  const schoolNames = schools.map((s) => s.name);

  return {
    schools,
    debug: {
      total: schools.length,
      schoolIds,
      schoolNames,
      ensuredDaSilva: daSilva !== null,
      daSilvaCreated: daSilva?.created ?? false,
      daSilvaSchoolId: daSilva?.id ?? null,
    },
  };
}
