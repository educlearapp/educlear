import { prisma } from "../prisma";
import { resolveLearnerGender } from "../utils/learnerGender";

export type RegistrationStats = {
  children: number;
  parents: number;
  boys: number;
  girls: number;
  classrooms: number;
  averageClassroomSize: number;
  /** @deprecated Use averageClassroomSize — kept for older clients */
  avg: number;
};

export type RegistrationStatsDebugLearner = {
  name: string;
  surname: string;
  gender: string | null;
  idNumber: string | null;
  resolvedGender: "Male" | "Female" | null;
};

export type RegistrationStatsResult = {
  stats: RegistrationStats;
  debug: { sampleLearners: RegistrationStatsDebugLearner[] };
};

/**
 * Single source of truth for Registrations dashboard stats (boys/girls/classrooms).
 */
export async function buildRegistrationStats(schoolId: string): Promise<RegistrationStatsResult> {
  const activeLearners = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      firstName: true,
      lastName: true,
      gender: true,
      idNumber: true,
      className: true,
      grade: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  let boys = 0;
  let girls = 0;
  const classroomSet = new Set<string>();
  const sampleLearners: RegistrationStatsDebugLearner[] = [];

  for (const learner of activeLearners) {
    const resolved = resolveLearnerGender({
      gender: learner.gender,
      idNumber: learner.idNumber,
    });
    if (resolved === "Male") boys += 1;
    else if (resolved === "Female") girls += 1;

    const classroom = String(learner.className || learner.grade || "").trim();
    if (classroom && !/no classroom/i.test(classroom)) {
      classroomSet.add(classroom);
    }

    if (sampleLearners.length < 10) {
      sampleLearners.push({
        name: learner.firstName || "",
        surname: learner.lastName || "",
        gender: learner.gender,
        idNumber: learner.idNumber,
        resolvedGender: resolved,
      });
    }
  }

  const parents = await prisma.parent.count({ where: { schoolId } });
  const children = activeLearners.length;
  const classrooms = classroomSet.size;
  const averageClassroomSize = classrooms > 0 ? Math.round(children / classrooms) : 0;

  return {
    stats: {
      children,
      parents,
      boys,
      girls,
      classrooms,
      averageClassroomSize,
      avg: averageClassroomSize,
    },
    debug: { sampleLearners },
  };
}
