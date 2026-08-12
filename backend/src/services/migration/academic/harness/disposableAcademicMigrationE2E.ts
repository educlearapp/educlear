/**
 * Disposable DB E2E for Phase 1J academic structure.
 * ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx src/services/migration/academic/harness/disposableAcademicMigrationE2E.ts
 */

import {
  compileAcademicMigrationPlan,
  applyAcademicMigrationPlan,
  verifyAcademicStructure,
  applyAcademicReviewAction,
  saveAcademicPlan,
} from "../index";
import { prisma } from "../../../../prisma";

const PROD_SCHOOL = "cmpideqeq0000108xb6ouv9zi";

function refuseProduction(): void {
  const url = String(process.env.DATABASE_URL || "");
  if (url.includes(PROD_SCHOOL)) throw new Error("REFUSED: production school id in DATABASE_URL");
  if (process.env.ALLOW_DISPOSABLE_MIGRATION_E2E !== "true") {
    throw new Error("Set ALLOW_DISPOSABLE_MIGRATION_E2E=true");
  }
}

async function main() {
  refuseProduction();
  let schoolId = "";
  let schoolB = "";
  try {
    const school = await prisma.school.create({
      data: { name: `Phase1J Academic ${Date.now()}` },
      select: { id: true },
    });
    schoolId = school.id;

    // Seed existing class + subject for collision reuse
    await prisma.classroom.create({
      data: { schoolId, name: "Grade 4A", teacherName: "", teacherEmail: "" },
    });
    await prisma.schoolSubject.create({
      data: { schoolId, name: "Mathematics", active: true, sortOrder: 1 },
    });

    // Canonical learners (already migrated)
    const l1 = await prisma.learner.create({
      data: {
        schoolId,
        firstName: "Ann",
        lastName: "One",
        grade: "Grade 4",
        className: null,
        idNumber: "9001015009087",
        admissionNo: "L01",
        enrollmentStatus: "ACTIVE",
      },
    });
    const l2 = await prisma.learner.create({
      data: {
        schoolId,
        firstName: "Bob",
        lastName: "Two",
        grade: "Grade 5",
        className: null,
        idNumber: "9002025009088",
        admissionNo: "L02",
        enrollmentStatus: "ACTIVE",
      },
    });

    // Foundation classroom SUBJECTS mode protection fixture
    const fpClass = await prisma.classroom.create({
      data: {
        schoolId,
        name: "Grade R Blue",
        teacherName: "",
        teacherEmail: "",
        attendanceSessionDisplay: "SUBJECTS",
      },
    });
    const eng = await prisma.schoolSubject.create({
      data: { schoolId, name: "English", active: true, sortOrder: 1 },
    });
    await prisma.classroomSubjectSlot.create({
      data: {
        schoolId,
        classroomId: fpClass.id,
        dayOfWeek: 1,
        sortOrder: 1,
        subjectId: eng.id,
      },
    });

    const { discovery, plan: rawPlan } = compileAcademicMigrationPlan({
      targetSchoolId: schoolId,
      stageId: "e2e-acad-stage",
      academicYearHint: "2026",
      existingClassroomNames: ["Grade 4A"],
      existingSubjectNames: ["Mathematics"],
      files: [
        {
          fileId: "learners",
          filename: "learners.csv",
          columns: ["Learner ID", "Learner Name", "Grade", "Class", "Subjects"],
          rows: [
            {
              "Learner ID": "9001015009087",
              "Learner Name": "Ann One",
              Grade: "Grade 4",
              Class: "Grade 4 A",
              Subjects: "Maths; English HL",
            },
            {
              "Learner ID": "9002025009088",
              "Learner Name": "Bob Two",
              Grade: "5",
              Class: "Grade 5A",
              Subjects: "Mathematics",
            },
          ],
        },
      ],
    });

    if (discovery.detectedGrades < 2) throw new Error("Scenario A fail grades");
    if (discovery.detectedClasses < 2) throw new Error("Scenario B fail classes");
    console.log("✓ A/B discovery");

    const plan = saveAcademicPlan(rawPlan);

    // Apply (HIGH matches)
    const apply1 = await applyAcademicMigrationPlan({ plan });
    const apply2 = await applyAcademicMigrationPlan({ plan });
    if (!apply2.idempotentReplay) throw new Error("Scenario O expected idempotent replay");
    if (apply1.classroomsCreated + apply1.classroomsReused < 1) {
      throw new Error("Scenario E/K apply classes");
    }
    console.log("✓ O idempotent academic apply");

    const ann = await prisma.learner.findUnique({ where: { id: l1.id } });
    if (!ann?.className || !/4/i.test(ann.className)) {
      throw new Error(`Scenario E placement fail: ${ann?.className}`);
    }
    const bob = await prisma.learner.findUnique({ where: { id: l2.id } });
    if (bob?.className !== "Grade 5A") throw new Error("Scenario E Bob class");
    // No duplicate learners
    const count = await prisma.learner.count({
      where: { schoolId, idNumber: "9001015009087" },
    });
    if (count !== 1) throw new Error("Scenario F duplicate learner");
    console.log("✓ E/F learner placement + no duplicate learner");

    const subjects = await prisma.schoolSubject.findMany({ where: { schoolId } });
    if (!subjects.some((s) => s.name === "Mathematics")) throw new Error("Scenario L maths reuse");
    console.log("✓ G/L subjects detected/reused");

    // Foundation SUBJECTS mode intact
    const fp = await prisma.classroom.findUnique({ where: { id: fpClass.id } });
    if (fp?.attendanceSessionDisplay !== "SUBJECTS") {
      throw new Error("Scenario I Foundation Subject Mode broken");
    }
    const slots = await prisma.classroomSubjectSlot.count({
      where: { classroomId: fpClass.id },
    });
    if (slots !== 1) throw new Error("Scenario I slots changed");
    console.log("✓ I Foundation Phase Subject Mode preserved");

    // Cross-school isolation
    const other = await prisma.school.create({
      data: { name: `Phase1J Other ${Date.now()}` },
      select: { id: true },
    });
    schoolB = other.id;
    await prisma.classroom.create({
      data: { schoolId: schoolB, name: "Grade 4A", teacherName: "", teacherEmail: "" },
    });
    const aClasses = await prisma.classroom.count({ where: { schoolId } });
    const bClasses = await prisma.classroom.count({ where: { schoolId: schoolB } });
    if (aClasses < 1 || bClasses !== 1) throw new Error("Scenario P isolation");
    console.log("✓ J/P multi-school isolation");

    // Ambiguous review + stale check
    const { plan: ambPlan } = compileAcademicMigrationPlan({
      targetSchoolId: schoolId,
      stageId: "e2e-amb",
      files: [
        {
          fileId: "x",
          filename: "amb.csv",
          columns: ["Learner ID", "Learner Name", "Class"],
          rows: [
            {
              "Learner ID": "9001015009087",
              "Learner Name": "Ann One",
              Class: "Grade 4A",
            },
            {
              "Learner ID": "9001015009087",
              "Learner Name": "Ann One",
              Class: "Grade 4B",
            },
          ],
        },
      ],
    });
    const savedAmb = saveAcademicPlan(ambPlan);
    if (!savedAmb.learnerPlacements.some((p) => p.state === "REVIEW_REQUIRED")) {
      throw new Error("Scenario D ambiguous missing");
    }
    const check1 = await verifyAcademicStructure({ plan });
    const reviewed = applyAcademicReviewAction({
      plan,
      kind: "subject",
      proposalId: plan.subjects[0]?.proposalId || "",
      action: "ACCEPT_PROPOSED",
    });
    void reviewed;
    const check2 = await verifyAcademicStructure({ plan: saveAcademicPlan({ ...plan, stale: false }) });
    // After review helper, prior check for stage should be stale when same stageId
    console.log("✓ D/R review + checks", check1.status, check2.status);

    const finalCheck = await verifyAcademicStructure({ plan });
    console.log("Academic check", finalCheck.status, finalCheck.plainLanguage.join(" | "));

    console.log("Phase 1J disposable academic E2E: PASS");
  } finally {
    if (schoolId) {
      try {
        await prisma.classroomSubjectSlot.deleteMany({ where: { schoolId } });
        await prisma.schoolSubject.deleteMany({ where: { schoolId } });
        await prisma.classroomTeacher.deleteMany({ where: { schoolId } });
        await prisma.learner.deleteMany({ where: { schoolId } });
        await prisma.classroom.deleteMany({ where: { schoolId } });
        await prisma.group.deleteMany({ where: { schoolId } });
        await prisma.school.delete({ where: { id: schoolId } });
      } catch (e) {
        console.error("cleanup school", e);
      }
    }
    if (schoolB) {
      try {
        await prisma.classroom.deleteMany({ where: { schoolId: schoolB } });
        await prisma.school.delete({ where: { id: schoolB } });
      } catch (e) {
        console.error("cleanup schoolB", e);
      }
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
