/**
 * Audit / optional repair: registration stats gender counts and crèche classroom labels (Da Silva).
 *
 * Usage:
 *   npx tsx scripts/repair-registration-stats-and-creche.ts
 *   npx tsx scripts/repair-registration-stats-and-creche.ts --apply
 *   npx tsx scripts/repair-registration-stats-and-creche.ts [schoolId]
 */
import "dotenv/config";

import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import { buildRegistrationStats } from "../src/services/registrationStatsService";
import { prisma } from "../src/prisma";

const apply = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => a !== "--apply");
const schoolIdArg = args[0] || "";

const PRE_SCHOOL_CRECHE = "Pre-School Creche";
const CRECHE_CANONICAL = "Creche";

async function resolveDaSilvaSchoolId(): Promise<string> {
  if (schoolIdArg) return schoolIdArg;

  setDaSilvaResolvedSchoolId(DA_SILVA_ACADEMY_SCHOOL_ID);
  try {
    return await getDaSilvaResolvedSchoolId();
  } catch {
    const byName = await prisma.school.findFirst({
      where: { name: DA_SILVA_SCHOOL_NAME },
      select: { id: true },
    });
    if (!byName) throw new Error(`Da Silva school not found (${DA_SILVA_SCHOOL_NAME})`);
    return byName.id;
  }
}

async function listClassroomNames(schoolId: string): Promise<string[]> {
  const fromLearners = await prisma.learner.groupBy({
    by: ["className"],
    where: { schoolId, enrollmentStatus: "ACTIVE", className: { not: "" } },
    _count: { _all: true },
  });
  const fromClassrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { name: true },
  });
  const names = new Set<string>();
  for (const row of fromLearners) {
    const n = String(row.className || "").trim();
    if (n) names.add(n);
  }
  for (const row of fromClassrooms) {
    const n = String(row.name || "").trim();
    if (n) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function findPreSchoolCrecheLearners(schoolId: string) {
  return prisma.learner.findMany({
    where: {
      schoolId,
      enrollmentStatus: "ACTIVE",
      OR: [
        { className: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
        { grade: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function main(): Promise<void> {
  const schoolId = await resolveDaSilvaSchoolId();
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  console.log(`=== Registration stats & crèche repair (${apply ? "APPLY" : "dry-run"}) ===`);
  console.log(`School: ${school.name} (${school.id})\n`);

  const { stats, debug } = await buildRegistrationStats(schoolId);

  console.log("Stats (source of truth):");
  console.log(`  children: ${stats.children}`);
  console.log(`  parents: ${stats.parents}`);
  console.log(`  boys: ${stats.boys}`);
  console.log(`  girls: ${stats.girls}`);
  console.log(`  classrooms: ${stats.classrooms}`);
  console.log(`  averageClassroomSize: ${stats.averageClassroomSize}`);

  console.log("\nFirst 10 learners (gender resolution proof):");
  for (const row of debug.sampleLearners) {
    console.log(
      `  ${row.name} ${row.surname} | gender=${row.gender ?? ""} | id=${row.idNumber ?? ""} | resolved=${row.resolvedGender ?? "—"}`
    );
  }

  const classroomNames = await listClassroomNames(schoolId);
  console.log("\nClassroom names in use:");
  for (const name of classroomNames) {
    console.log(`  - ${name}`);
  }

  const preSchoolRows = await findPreSchoolCrecheLearners(schoolId);
  const crecheRepairNeeded = preSchoolRows.length > 0;

  console.log(`\nLearners labeled "${PRE_SCHOOL_CRECHE}": ${preSchoolRows.length}`);
  if (preSchoolRows.length) {
    for (const row of preSchoolRows.slice(0, 20)) {
      console.log(
        `  ${row.firstName} ${row.lastName} | class=${row.className} | grade=${row.grade} | created=${row.createdAt.toISOString()}`
      );
    }
    if (preSchoolRows.length > 20) {
      console.log(`  ... and ${preSchoolRows.length - 20} more`);
    }
  }

  if (apply && crecheRepairNeeded) {
    let updated = 0;
    for (const row of preSchoolRows) {
      await prisma.learner.update({
        where: { id: row.id },
        data: {
          className: CRECHE_CANONICAL,
          grade: row.grade?.toLowerCase() === PRE_SCHOOL_CRECHE.toLowerCase() ? CRECHE_CANONICAL : row.grade,
        },
      });
      updated += 1;
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
        console.log(`\nRenamed classroom row "${PRE_SCHOOL_CRECHE}" → "${CRECHE_CANONICAL}"`);
      } else {
        console.log(
          `\nSkipped classroom rename: "${CRECHE_CANONICAL}" already exists (id ${existingCreche.id})`
        );
      }
    }

    console.log(`\nApplied: ${updated} learner(s) → className "${CRECHE_CANONICAL}"`);
  } else if (crecheRepairNeeded) {
    console.log(`\nRe-run with --apply to rename "${PRE_SCHOOL_CRECHE}" → "${CRECHE_CANONICAL}" for these learners.`);
  }

  const auditPass =
    stats.children > 0 &&
    stats.boys + stats.girls > 0 &&
    stats.boys + stats.girls <= stats.children;

  console.log(`\nCreche repair needed: ${crecheRepairNeeded ? "yes" : "no"}`);
  console.log(`Audit: ${auditPass ? "PASS" : "FAIL"}`);

  if (!apply && crecheRepairNeeded) {
    console.log("\nDry run only — add --apply to persist crèche label fixes.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
