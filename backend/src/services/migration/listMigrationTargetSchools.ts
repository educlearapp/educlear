import { prisma } from "../../prisma";

export type MigrationTargetSchool = {
  id: string;
  name: string;
};

export type MigrationTargetSchoolsDebug = {
  total: number;
  schoolIds: string[];
  schoolNames: string[];
};

export type MigrationTargetSchoolsResult = {
  schools: MigrationTargetSchool[];
  debug: MigrationTargetSchoolsDebug;
};

/** All Prisma School rows for migration target picker — alphabetical, no platform-only filter. */
export async function listMigrationTargetSchools(): Promise<MigrationTargetSchoolsResult> {
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
    },
  };
}
