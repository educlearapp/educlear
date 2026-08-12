/**
 * Phase 1J unit tests — academic detection / normalization / plan compile.
 * Run: npx tsx src/services/migration/academic/phase1j.unit.test.ts
 */

import assert from "assert";
import { detectAcademicColumnKind, mapAcademicColumns } from "./semanticFieldDetection";
import { normalizeGradeLabel, normalizeSubjectName } from "./normalizeAcademicValues";
import { compileAcademicMigrationPlan } from "./compileAcademicMigrationPlan";
import { normalizeClassroomInput } from "../../../utils/classroomNormalization";

function testSemanticDetection() {
  assert.strictEqual(detectAcademicColumnKind("Register Class"), "classroom");
  assert.strictEqual(detectAcademicColumnKind("GRADE_NAME"), "grade");
  assert.strictEqual(detectAcademicColumnKind("CourseName"), "subject");
  assert.strictEqual(detectAcademicColumnKind("Academic Year"), "academicYear");
  assert.strictEqual(detectAcademicColumnKind("Homeroom"), "classroom");
  const map = mapAcademicColumns(["Learner", "Grade", "Class", "Subjects"]);
  assert.strictEqual(map.grade, "Grade");
  assert.strictEqual(map.classroom, "Class");
  assert.strictEqual(map.subject, "Subjects");
  console.log("✓ A — semantic academic column detection");
}

function testGradeNormalize() {
  assert.strictEqual(normalizeGradeLabel("GR1").proposedLabel, "Grade 1");
  assert.strictEqual(normalizeGradeLabel("Grade One").proposedLabel, "Grade 1");
  assert.strictEqual(normalizeGradeLabel("G10").proposedLabel, "Grade 10");
  assert.strictEqual(normalizeGradeLabel("Grade R").matchState, "AUTO_MATCH");
  assert.strictEqual(normalizeGradeLabel("RR").matchState, "REVIEW_REQUIRED");
  assert.strictEqual(normalizeGradeLabel("Year 1").matchState, "REVIEW_REQUIRED");
  assert.strictEqual(normalizeGradeLabel("Grade 0").matchState, "REVIEW_REQUIRED");
  console.log("✓ grade normalize + ambiguity review");
}

function testClassNormalizeNoDupes() {
  const a = normalizeClassroomInput("Grade 3 A");
  const b = normalizeClassroomInput("GRADE 3A");
  const c = normalizeClassroomInput("Grade 3A");
  assert.strictEqual(a.matchKey, b.matchKey);
  assert.strictEqual(b.matchKey, c.matchKey);
  console.log("✓ C — harmless class naming variations share matchKey");
}

function testSubjectNormalize() {
  const maths = normalizeSubjectName("Maths");
  const mathematics = normalizeSubjectName("Mathematics");
  assert.strictEqual(maths.normalizeKey, mathematics.normalizeKey);
  assert.strictEqual(maths.proposedName, "Mathematics");
  const eng = normalizeSubjectName("English");
  assert.strictEqual(eng.matchState, "REVIEW_REQUIRED");
  console.log("✓ G — subject normalize Maths/Mathematics; English review");
}

function testCleanPlanCompile() {
  const { discovery, plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_a",
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Grade", "Class", "Subjects"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Ann One",
            Grade: "Grade 4",
            Class: "Grade 4A",
            Subjects: "Mathematics; English HL; Natural Sciences",
          },
          {
            "Learner ID": "9002025009088",
            "Learner Name": "Bob Two",
            Grade: "GR4",
            Class: "G4-A",
            Subjects: "Mathematics; Mathematical Literacy",
          },
          {
            "Learner ID": "9003035009089",
            "Learner Name": "Cara Three",
            Grade: "Grade 10",
            Class: "Grade 10A",
            Subjects: "English; Mathematics; Physical Sciences",
          },
        ],
      },
    ],
  });
  assert.ok(discovery.detectedGrades >= 2, "grades detected");
  assert.ok(discovery.detectedClasses >= 2, "classes detected");
  assert.ok(discovery.detectedSubjects >= 3, "subjects detected");
  assert.ok(discovery.learnersWithClearPrimaryClass >= 2);
  assert.ok(plan.learnerPlacements.some((p) => p.state === "MATCHED"));
  assert.ok(plan.subjectEnrollments.every((e) => e.persistMode === "UNSUPPORTED_LEARNER_ENROLLMENT"));
  console.log("✓ A/B/E/H — clean source discovery + learner subject selections recorded");
}

function testAmbiguousPlacement() {
  const { discovery, plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_b",
    academicYearHint: "2026",
    files: [
      {
        fileId: "f1",
        filename: "messy.csv",
        columns: ["Learner ID", "Learner", "GRADE_NAME", "REGISTER"],
        rows: [
          {
            "Learner ID": "8001015009087",
            Learner: "Pat Dual",
            GRADE_NAME: "Grade 5",
            REGISTER: "Grade 5A",
          },
          {
            "Learner ID": "8001015009087",
            Learner: "Pat Dual",
            GRADE_NAME: "Grade 5",
            REGISTER: "Grade 5B",
          },
        ],
      },
    ],
  });
  assert.ok(discovery.learnersWithAmbiguousClass >= 1);
  const p = plan.learnerPlacements.find((x) => x.learnerIdNumber?.includes("800101"));
  assert.ok(p && p.state === "REVIEW_REQUIRED");
  console.log("✓ D — ambiguous class placement enters review");
}

function testHistoricalNotCurrent() {
  const { plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_c",
    academicYearHint: "2026",
    files: [
      {
        fileId: "f1",
        filename: "hist.csv",
        columns: ["Learner ID", "Learner Name", "Class", "Academic Year"],
        rows: [
          {
            "Learner ID": "7001015009087",
            "Learner Name": "Old Class Kid",
            Class: "Grade 6A",
            "Academic Year": "2025",
          },
        ],
      },
    ],
  });
  const p = plan.learnerPlacements[0];
  assert.ok(p);
  assert.strictEqual(p!.state, "REVIEW_REQUIRED");
  assert.ok(p!.warnings.some((w) => /historical/i.test(w)));
  console.log("✓ M — historical class not mistaken for current");
}

function testPartialExport() {
  const { discovery, plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_d",
    files: [
      {
        fileId: "f1",
        filename: "partial.csv",
        columns: ["Learner ID", "Learner Name", "Grade"],
        rows: [
          {
            "Learner ID": "6001015009087",
            "Learner Name": "No Class",
            Grade: "Grade 2",
          },
        ],
      },
    ],
  });
  assert.ok(discovery.learnersWithNoClass >= 1);
  assert.ok(plan.warnings.some((w) => /incomplete|Partial|fabricated/i.test(w)) || plan.learnerPlacements[0]?.state === "UNPLACED");
  console.log("✓ N — partial export → incomplete/unplaced, not fabricated classes");
}

function testExistingReuseFlags() {
  const { plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_e",
    existingClassroomNames: ["Grade 4A"],
    existingSubjectNames: ["Mathematics"],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Grade", "Class", "Subjects"],
        rows: [
          {
            "Learner ID": "5001015009087",
            "Learner Name": "Reuse",
            Grade: "4",
            Class: "Grade 4A",
            Subjects: "Maths",
          },
        ],
      },
    ],
  });
  assert.ok(plan.classes.some((c) => c.existingClassroomId === "existing"));
  assert.ok(plan.subjects.some((s) => s.existingSubjectId === "existing"));
  console.log("✓ K/L — existing class/subject reuse flagged");
}

function testTeacherNoUnsafeCreate() {
  const { plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_f",
    existingStaffEmails: [],
    files: [
      {
        fileId: "f1",
        filename: "t.csv",
        columns: ["Class", "Teacher"],
        rows: [{ Class: "Grade 1A", Teacher: "Mrs Smith" }],
      },
    ],
  });
  assert.ok(plan.teacherAssignments.length >= 1);
  assert.ok(plan.teacherAssignments.every((t) => !t.applyAllowed || t.state === "MATCHED_EXISTING"));
  assert.ok(plan.teacherAssignments[0]!.state !== "MATCHED_EXISTING");
  console.log("✓ Q — ambiguous teacher does not auto-create staff");
}

function testGroupNotConfusedWithClass() {
  const { plan } = compileAcademicMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_g",
    files: [
      {
        fileId: "f1",
        filename: "g.csv",
        columns: ["Learner Name", "Group"],
        rows: [{ "Learner Name": "X", Group: "Grade 4A" }],
      },
    ],
  });
  assert.ok(plan.groups[0]);
  assert.strictEqual(plan.groups[0]!.safeToApplyAsGroup, false);
  assert.strictEqual(plan.groups[0]!.matchState, "REVIEW_REQUIRED");
  console.log("✓ I/groups — classroom-like group not auto-imported as EduClear Group");
}

function main() {
  testSemanticDetection();
  testGradeNormalize();
  testClassNormalizeNoDupes();
  testSubjectNormalize();
  testCleanPlanCompile();
  testAmbiguousPlacement();
  testHistoricalNotCurrent();
  testPartialExport();
  testExistingReuseFlags();
  testTeacherNoUnsafeCreate();
  testGroupNotConfusedWithClass();
  console.log("Phase 1J unit tests: PASS");
}

main();
