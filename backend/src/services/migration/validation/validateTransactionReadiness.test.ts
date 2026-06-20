import assert from "assert";
import { validateLearnerStatusRows } from "./validateTransactionReadiness";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";

const classListPreview: MigrationFilePreview = {
  fileId: "class-list",
  filename: "Grade_1A.xls",
  category: "learners",
  columns: ["fullName", "classroom"],
  sampleRows: [],
  rowCount: 2,
  warnings: ["Kid-e-Sys class list (Grade 1A, 2 learner(s))."],
};

const statusMapping: MigrationFileColumnMappings = {
  fileId: "class-list",
  mappings: [
    { sourceColumn: "fullName", targetField: "fullName" },
    { sourceColumn: "status", targetField: "status" },
    { sourceColumn: "classroom", targetField: "classroom" },
  ],
};

function testKidESysClassListWithoutStatusDefaultsActive(): void {
  const issues = validateLearnerStatusRows({
    preview: classListPreview,
    fileMappings: statusMapping,
    rows: [
      { fullName: "A Learner", classroom: "Grade 1A" },
      { fullName: "B Learner", classroom: "Grade 1A" },
    ],
  });

  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "info");
  assert.strictEqual(
    issues[0].message,
    "Kid-e-Sys Class List has no learner status column; learners default to ACTIVE."
  );
}

function testKidESysClassListWithBadStatusStillBlocks(): void {
  const issues = validateLearnerStatusRows({
    preview: {
      ...classListPreview,
      columns: ["fullName", "status", "classroom"],
    },
    fileMappings: statusMapping,
    rows: [
      { fullName: "A Learner", status: "Definitely Maybe", classroom: "Grade 1A" },
    ],
  });

  assert.strictEqual(issues.length, 2);
  assert.strictEqual(issues[0].severity, "info");
  assert.strictEqual(issues[1].severity, "error");
  assert.strictEqual(
    issues[1].message,
    "Learner status is UNKNOWN — review enrollment before apply"
  );
}

function testKidESysClassListIgnoresFeeRelatedStatusText(): void {
  const issues = validateLearnerStatusRows({
    preview: {
      ...classListPreview,
      columns: ["fullName", "status", "classroom"],
    },
    fileMappings: statusMapping,
    rows: [
      { fullName: "A Learner", status: "OUTSTANDING FEES & LEFT", classroom: "Grade 1A" },
    ],
  });

  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "info");
  assert.strictEqual(
    issues[0].message,
    "Kid-e-Sys Class List has no learner status column; learners default to ACTIVE."
  );
}

testKidESysClassListWithoutStatusDefaultsActive();
testKidESysClassListWithBadStatusStillBlocks();
testKidESysClassListIgnoresFeeRelatedStatusText();
console.log("validateTransactionReadiness.test.ts: ok");
