import { prisma } from "../prisma";
import { resolveLearnerGender } from "../utils/learnerGender";
import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  getDaSilvaResolvedSchoolId,
} from "./activateDaSilvaSubscription";
import { repairDaSilvaSasamsLearners } from "./daSilvaMigration/daSilvaCurrentDbRepair";
import { findLatestDaSilvaStagingBundle } from "./daSilvaMigration/relinkDaSilvaLearnerBilling";
import { isProductionOrGoLive } from "./runtime";

const PRE_SCHOOL_CRECHE = "Pre-School Creche";
const CRECHE_CANONICAL = "Creche";
const CORRUPTION_MIN_ACTIVE = 300;
const CORRUPTION_MAX_WITH_GENDER = 5;

export type DaSilvaCorruptionProbe = {
  schoolId: string;
  activeLearners: number;
  learnersWithGender: number;
  preSchoolCrecheCount: number;
};

export async function probeDaSilvaLearnerCorruption(
  schoolId: string
): Promise<DaSilvaCorruptionProbe> {
  const sid = String(schoolId || "").trim();
  const [activeLearners, genderRows, preSchoolCrecheCount] = await Promise.all([
    prisma.learner.count({ where: { schoolId: sid, enrollmentStatus: "ACTIVE" } }),
    prisma.learner.findMany({
      where: { schoolId: sid, enrollmentStatus: "ACTIVE" },
      select: { gender: true, idNumber: true },
    }),
    prisma.learner.count({
      where: {
        schoolId: sid,
        enrollmentStatus: "ACTIVE",
        OR: [
          { className: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
          { grade: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
        ],
      },
    }),
  ]);

  let learnersWithGender = 0;
  for (const row of genderRows) {
    if (resolveLearnerGender({ gender: row.gender, idNumber: row.idNumber })) {
      learnersWithGender += 1;
    }
  }

  return { schoolId: sid, activeLearners, learnersWithGender, preSchoolCrecheCount };
}

export function isDaSilvaManifestOverwriteCorruption(probe: DaSilvaCorruptionProbe): boolean {
  return (
    probe.activeLearners >= CORRUPTION_MIN_ACTIVE &&
    probe.learnersWithGender <= CORRUPTION_MAX_WITH_GENDER
  );
}

async function healCrecheLabels(schoolId: string): Promise<number> {
  const rows = await prisma.learner.findMany({
    where: {
      schoolId,
      enrollmentStatus: "ACTIVE",
      OR: [
        { className: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
        { grade: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
      ],
    },
    select: { id: true, grade: true },
  });
  if (!rows.length) return 0;

  for (const row of rows) {
    await prisma.learner.update({
      where: { id: row.id },
      data: {
        className: CRECHE_CANONICAL,
        grade:
          row.grade?.toLowerCase() === PRE_SCHOOL_CRECHE.toLowerCase()
            ? CRECHE_CANONICAL
            : row.grade,
      },
    });
  }

  const classroomRow = await prisma.classroom.findFirst({
    where: { schoolId, name: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
  });
  if (classroomRow) {
    const existingCreche = await prisma.classroom.findFirst({
      where: { schoolId, name: { equals: CRECHE_CANONICAL, mode: "insensitive" } },
    });
    if (!existingCreche) {
      await prisma.classroom.update({
        where: { id: classroomRow.id },
        data: { name: CRECHE_CANONICAL },
      });
    }
  }

  return rows.length;
}

/**
 * Repairs manifest-overwrite damage (missing gender, crèche labels) using staged SASAMS when present.
 * Never imports learners or billing from manifest.
 */
export async function healDaSilvaProductionDataIfCorrupted(): Promise<void> {
  if (!isProductionOrGoLive()) return;

  const schoolId = getDaSilvaResolvedSchoolId() || DA_SILVA_ACADEMY_SCHOOL_ID;
  const probe = await probeDaSilvaLearnerCorruption(schoolId);
  if (!isDaSilvaManifestOverwriteCorruption(probe)) {
    if (probe.preSchoolCrecheCount > 0) {
      const fixed = await healCrecheLabels(schoolId);
      if (fixed > 0) {
        console.log(`[startup] Da Silva crèche labels normalized: ${fixed} learner(s)`);
      }
    }
    return;
  }

  console.warn(
    `[startup] Da Silva manifest-overwrite detected (${probe.activeLearners} active, ${probe.learnersWithGender} with gender) — attempting SASAMS profile heal`
  );

  const latest = findLatestDaSilvaStagingBundle(schoolId);
  if (!latest?.projectId) {
    console.error(
      "[startup] Da Silva SASAMS heal skipped — no staging bundle on disk (gender/class data not restored)"
    );
    const crecheFixed = await healCrecheLabels(schoolId);
    if (crecheFixed > 0) {
      console.log(`[startup] Da Silva crèche labels normalized: ${crecheFixed} learner(s)`);
    }
    return;
  }

  try {
    const sasams = await repairDaSilvaSasamsLearners({
      schoolId,
      projectId: latest.projectId,
      apply: true,
    });
    console.log(
      `[startup] Da Silva SASAMS profile heal: matched=${sasams.matched} updated=${sasams.updated} unmatched=${sasams.unmatched.length}`
    );
  } catch (error) {
    console.error("[startup] Da Silva SASAMS profile heal failed:", error);
  }

  const crecheFixed = await healCrecheLabels(schoolId);
  if (crecheFixed > 0) {
    console.log(`[startup] Da Silva crèche labels normalized: ${crecheFixed} learner(s)`);
  }

  const after = await probeDaSilvaLearnerCorruption(schoolId);
  console.log(
    `[startup] Da Silva post-heal: active=${after.activeLearners} withGender=${after.learnersWithGender} preSchoolCreche=${after.preSchoolCrecheCount}`
  );
}
