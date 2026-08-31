import { prisma } from "../../prisma";
import type { Prisma } from "@prisma/client";
import {
  SCHOOL_LIFECYCLE_UPDATE_KEYS,
  SchoolLifecycleError,
  assertLifecycleActor,
  assertProtectedOperatingSchoolLifecycle,
  buildLifecycleSchoolUpdateData,
  parseSchoolLifecycleStatus,
  type SchoolLifecycleStatus,
} from "./schoolLifecycle";

export type SuperAdminLifecycleActor = {
  userId: string;
  email: string;
};

export type UpdateSchoolLifecycleInput = {
  schoolId: string;
  lifecycleStatus: unknown;
  actor: SuperAdminLifecycleActor | null | undefined;
};

export async function updateSchoolLifecycle(input: UpdateSchoolLifecycleInput): Promise<{
  success: true;
  schoolId: string;
  schoolName: string;
  lifecycleStatus: SchoolLifecycleStatus;
  previousLifecycleStatus: SchoolLifecycleStatus;
}> {
  assertLifecycleActor(input.actor);

  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new SchoolLifecycleError("Missing schoolId", 400);

  const next = parseSchoolLifecycleStatus(input.lifecycleStatus);
  assertProtectedOperatingSchoolLifecycle(schoolId, next);

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      lifecycleStatus: true,
    },
  });
  if (!school) throw new SchoolLifecycleError("School not found", 404);

  const previous = parseSchoolLifecycleStatus(school.lifecycleStatus);
  const actor = input.actor!;
  const data = buildLifecycleSchoolUpdateData({
    lifecycleStatus: next,
    actorUserId: actor.userId,
    actorEmail: actor.email,
  });

  const writtenKeys = Object.keys(data);
  for (const key of writtenKeys) {
    if (!(SCHOOL_LIFECYCLE_UPDATE_KEYS as readonly string[]).includes(key)) {
      throw new SchoolLifecycleError("Lifecycle update attempted a non-lifecycle field", 500);
    }
  }

  await prisma.school.update({
    where: { id: school.id },
    data: data as Prisma.SchoolUpdateInput,
  });

  console.log(
    `[super-admin/lifecycle] school=${school.id} name=${JSON.stringify(school.name)} ` +
      `from=${previous} to=${next} by=${actor.email}`
  );

  return {
    success: true,
    schoolId: school.id,
    schoolName: school.name,
    lifecycleStatus: next,
    previousLifecycleStatus: previous,
  };
}
