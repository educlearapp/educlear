import assert from "assert";
import fs from "fs";
import path from "path";
import { parseMigrationLearnerFileBuffer } from "../../../utils/migrationLearnerFileParser";
import {
  isKidESysLearnerClassListLayout,
  normalizeKidESysLearnerClassListSheet,
} from "./kideesysLearnerClassListNormalization";

const SAMPLE = path.resolve(
  __dirname,
  "../../../../uploads/migration-staging/cmpideqeq0000108xb6ouv9zi/kideesys-mpksdsua-p5rbjh/uploads/05_class_list/Grade_1A.xls"
);

function testSyntheticLayout(): void {
  const matrix = [
    ["Grade 1A 2026", ""],
    ["1", "Aiden Jacques Du Plessis"],
    ["2", "Amogelang Letoloto Raborife"],
  ];
  assert.strictEqual(isKidESysLearnerClassListLayout(matrix), true);
  const parsed = normalizeKidESysLearnerClassListSheet(matrix, "Grade_1A.xls");
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.headers, ["fullName", "classroom"]);
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0].fullName, "Aiden Jacques Du Plessis");
  assert.strictEqual(parsed.rows[0].classroom, "Grade 1A");
}

function testStandardHeaderSheetNotNormalized(): void {
  const matrix = [
    ["Learner Name", "Grade", "Class"],
    ["Jane Doe", "5", "5A"],
  ];
  assert.strictEqual(isKidESysLearnerClassListLayout(matrix), false);
  assert.strictEqual(normalizeKidESysLearnerClassListSheet(matrix, "learners.csv"), null);
}

function testChildListSixExtraFieldsMapsColumnBName(): void {
  const matrix = [
    [
      "Grade 2A 2026",
      "",
      "Age",
      "Birth Date",
      "Gender",
      "Parent 1 Contact Info",
      "Parent 2 Contact Info",
      "Enrolment Date",
    ],
    [
      "1",
      "Jane Mary Doe",
      "8",
      "2018/04/05",
      "F",
      "Mother - 0821234567",
      "Father - 0831234567",
      "2026/01/10",
    ],
    [
      "2",
      "John James Smith",
      "8",
      "2018/06/12",
      "M",
      "Guardian - 0841234567",
      "",
      "2026/01/10",
    ],
  ];

  assert.strictEqual(isKidESysLearnerClassListLayout(matrix), true);
  const parsed = normalizeKidESysLearnerClassListSheet(matrix, "child_list.xls");
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.headers, [
    "fullName",
    "Age",
    "Birth Date",
    "Gender",
    "Parent 1 Contact Info",
    "Parent 2 Contact Info",
    "Enrolment Date",
    "classroom",
  ]);
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0].fullName, "Jane Mary Doe");
  assert.strictEqual(parsed.rows[0]["Birth Date"], "2018/04/05");
  assert.strictEqual(parsed.rows[0]["Parent 1 Contact Info"], "Mother - 0821234567");
  assert.strictEqual(parsed.rows[0].classroom, "Grade 2A");
}

function testGrade1AFileIfPresent(): void {
  if (!fs.existsSync(SAMPLE)) return;
  const buffer = fs.readFileSync(SAMPLE);
  const parsed = parseMigrationLearnerFileBuffer(buffer, "Grade_1A.xls");
  assert.ok(parsed.headers.includes("fullName"), `headers: ${parsed.headers.join(",")}`);
  assert.ok(parsed.rows.length > 0, "expected learner rows");
  const first = parsed.rows[0].fullName;
  assert.ok(first && first.length > 3, `first learner: ${first}`);
  assert.ok(parsed.rows.some((r) => /du\s*plessis/i.test(r.fullName)), "expected Du Plessis in list");
}

testSyntheticLayout();
testStandardHeaderSheetNotNormalized();
testChildListSixExtraFieldsMapsColumnBName();
testGrade1AFileIfPresent();
console.log("kideesysLearnerClassListNormalization.test.ts: ok");
