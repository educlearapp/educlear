import { superAdminApiFetch } from "../superAdminApi";
import type { SchoolOption } from "../types/migration";

export type MigrationTargetSchoolsDebug = {
  total: number;
  schoolIds: string[];
  schoolNames: string[];
};

export type MigrationTargetSchoolsResponse = {
  schools: SchoolOption[];
  debug: MigrationTargetSchoolsDebug;
};

export async function fetchMigrationTargetSchools(): Promise<MigrationTargetSchoolsResponse> {
  const data = (await superAdminApiFetch("/api/super-admin/migration/target-schools")) as {
    schools?: Array<{ id: string; name: string }>;
    debug?: MigrationTargetSchoolsDebug;
  };

  const schools = (data.schools || []).map((s) => ({
    id: String(s.id),
    name: String(s.name),
  }));

  const debug: MigrationTargetSchoolsDebug = data.debug ?? {
    total: schools.length,
    schoolIds: schools.map((s) => s.id),
    schoolNames: schools.map((s) => s.name),
  };

  if (import.meta.env.DEV) {
    console.log("[Migration Center] target-schools", {
      total: debug.total,
      schoolIds: debug.schoolIds,
      schoolNames: debug.schoolNames,
    });
  }

  return { schools, debug };
}
