import { normalizeClassroomInput, groupClassroomsByMatchKey } from "./classroomNormalization";

function norm(
  raw: string,
  gradeHint?: string,
  options?: Parameters<typeof normalizeClassroomInput>[2]
) {
  return normalizeClassroomInput(raw, gradeHint, options);
}

const cases: Array<{
  input: string;
  classroomName: string;
  importYear: number | null;
  gradeLabel?: string;
  classLetter?: string;
  matchKey?: string;
}> = [
  { input: "Grade 1A 2026", classroomName: "Grade 1A", importYear: 2026, classLetter: "A" },
  { input: "Grade 1 A 2026", classroomName: "Grade 1A", importYear: 2026, classLetter: "A" },
  { input: "GRADE 3A 2026", classroomName: "Grade 3A", importYear: 2026, classLetter: "A" },
  { input: "Grade 8 / 8A", classroomName: "Grade 8 / 8A", importYear: null, classLetter: "8A" },
  { input: "Grade 8-8A", classroomName: "Grade 8 / 8A", importYear: null, classLetter: "8A" },
  { input: "8A", classroomName: "Grade 8A", importYear: null, classLetter: "A" },
  { input: "Gr R", classroomName: "Grade R", importYear: null },
  { input: "Grade R", classroomName: "Grade R", importYear: null },
  { input: "Reception", classroomName: "Reception", importYear: null },
  { input: "Creche", classroomName: "Creche", importYear: null },
  { input: "Crèche", classroomName: "Creche", importYear: null },
  { input: "Pre-Grade R", classroomName: "Pre-Grade R", importYear: null },
  { input: "Year 1", classroomName: "Year 1", importYear: null },
  { input: "Class 1A", classroomName: "Class 1A", importYear: null, classLetter: "A" },
];

let failed = 0;
for (const c of cases) {
  const r = norm(c.input);
  const ok =
    r.classroomName === c.classroomName &&
    r.importYear === c.importYear &&
    (c.classLetter == null || r.classLetter === c.classLetter);
  if (!ok) {
    failed++;
    console.error("FAIL", c.input, {
      expected: c,
      got: {
        classroomName: r.classroomName,
        importYear: r.importYear,
        classLetter: r.classLetter,
        matchKey: r.matchKey,
        warnings: r.warnings,
      },
    });
  }
}

const g1 = norm("Grade 1A 2026");
const g2 = norm("GRADE 1 A 2026");
if (g1.matchKey !== g2.matchKey) {
  failed++;
  console.error("FAIL dedupe Grade 1A vs GRADE 1 A", g1.matchKey, g2.matchKey);
}

const groups = groupClassroomsByMatchKey([
  { raw: "Grade 1A 2026" },
  { raw: "GRADE 1 A 2026" },
]);
if (groups.size !== 1) {
  failed++;
  console.error("FAIL group size", groups.size);
}

const receptionMapped = norm("Reception", undefined, { mapReceptionToGradeR: true });
if (receptionMapped.classroomName !== "Grade R") {
  failed++;
  console.error("FAIL reception map", receptionMapped);
}

if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("All classroom normalization checks passed.");
