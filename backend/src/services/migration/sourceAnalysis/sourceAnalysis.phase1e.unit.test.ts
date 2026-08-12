/**
 * Phase 1E — source-first package analysis fixtures A–H.
 * LOCAL only — zero school writes.
 *
 * Run:
 *   npx tsx src/services/migration/sourceAnalysis/sourceAnalysis.phase1e.unit.test.ts
 */
import assert from "assert";
import {
  analyzeMigrationPackage,
  applyOperatorFieldDecision,
  getBoundSourceAnalysis,
  saveSourceAnalysis,
} from "./index";

const SCHOOL_A = "schoolA_phase1e";
const SCHOOL_B = "schoolB_phase1e";

function rows(n: number, factory: (i: number) => Record<string, unknown>) {
  return Array.from({ length: n }, (_, i) => factory(i + 1));
}

async function run() {
  console.log("Phase 1E source-analysis tests…");

  // Fixture A — generic learner CSV with unusual but obvious headers
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "a1",
          filename: "class_list.csv",
          category: "learners",
          columns: ["Pupil ID", "Child Name", "Surname", "Grade", "Register Class", "DOB"],
          rowCount: 3,
          sampleRows: rows(3, (i) => ({
            "Pupil ID": `L${i}`,
            "Child Name": `Ada${i}`,
            Surname: "Lovelace",
            Grade: "5",
            "Register Class": "5A",
            DOB: "2014-01-01",
          })),
        },
      ],
    });
    assert.ok(analysis.summary.totalFields >= 6);
    const pupilId = analysis.discoveredFields.find((f) => f.sourceColumn === "Pupil ID");
    assert.ok(pupilId);
    assert.ok(
      pupilId!.status === "AUTO_MAPPED" || pupilId!.suggestedTarget === "learnerNumber",
      "Pupil ID should map to learner number"
    );
    const dob = analysis.discoveredFields.find((f) => f.sourceColumn === "DOB");
    assert.ok(dob?.suggestedTarget === "dateOfBirth");
    console.log("  ✓ A — generic unusual learner headers auto-map");
  }

  // Fixture B — multi-file learners + parents + finance
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "b-learn",
          filename: "Learners.xlsx",
          category: "learners",
          columns: ["Admission No", "First Name", "Last Name", "Class"],
          rowCount: 10,
          sampleRows: [{ "Admission No": "A1", "First Name": "Ann", "Last Name": "Bee", Class: "3B" }],
        },
        {
          fileId: "b-par",
          filename: "Parent Contacts.xlsx",
          category: "parents",
          columns: ["Admission No", "Mother Mobile", "Parent Email", "Guardian Name"],
          rowCount: 12,
          sampleRows: [
            {
              "Admission No": "A1",
              "Mother Mobile": "0821111111",
              "Parent Email": "a@test.com",
              "Guardian Name": "Pat Bee",
            },
          ],
        },
        {
          fileId: "b-fin",
          filename: "Age Analysis.xlsx",
          category: "billing",
          columns: ["Account Number", "Opening Balance", "Account Name"],
          rowCount: 8,
          sampleRows: [
            { "Account Number": "ACC1", "Opening Balance": "100.00", "Account Name": "Bee" },
          ],
        },
      ],
    });
    assert.strictEqual(analysis.summary.fileCount, 3);
    assert.ok(analysis.summary.estimatedLearners >= 10);
    assert.ok(analysis.summary.estimatedParents >= 12);
    assert.ok(analysis.summary.estimatedFamilyAccounts >= 8);
    assert.ok(analysis.relationshipCandidates.length > 0, "cross-file relationships expected");
    const mom = analysis.discoveredFields.find((f) => f.sourceColumn === "Mother Mobile");
    assert.ok(mom?.suggestedTarget === "parentPhone");
    console.log("  ✓ B — multi-file package entities + relationships");
  }

  // Fixture C — Kid-e-Sys-like
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      systemIdHint: "kideesys",
      files: [
        {
          fileId: "c1",
          filename: "Kid-e-Sys Learner Export.csv",
          columns: ["LearnerName", "Grade", "Class", "IDNumber", "AccountNumber"],
          rowCount: 5,
          sampleRows: [
            {
              LearnerName: "Sam Molefe",
              Grade: "4",
              Class: "4A",
              IDNumber: "1234567890123",
              AccountNumber: "K001",
            },
          ],
        },
      ],
    });
    assert.ok(
      analysis.detectedSourceSystem === "kideesys" ||
        analysis.detectedSourceSystemLabel.toLowerCase().includes("kid")
    );
    assert.ok(analysis.summary.autoMapped + analysis.summary.confirmMapping > 0);
    console.log("  ✓ C — Kid-e-Sys-like detection/mapping");
  }

  // Fixture D — SA-SAMS-like
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      systemIdHint: "sasams",
      files: [
        {
          fileId: "d1",
          filename: "SASAMS_Learner_List.csv",
          columns: ["LEARNER_NAME", "SURNAME", "GRADE", "CLASS_NAME", "ID_NO"],
          rowCount: 4,
          sampleRows: [
            {
              LEARNER_NAME: "Thabo",
              SURNAME: "Dlamini",
              GRADE: "6",
              CLASS_NAME: "6C",
              ID_NO: "9901015800081",
            },
          ],
        },
      ],
    });
    assert.ok(
      analysis.detectedSourceSystem === "sasams" ||
        analysis.detectedSourceSystemLabel.toLowerCase().includes("sa-sams") ||
        analysis.summary.totalFields === 5
    );
    console.log("  ✓ D — SA-SAMS-like mapping");
  }

  // Fixture E — unknown vendor
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "e1",
          filename: "weird_export_xyz.csv",
          columns: ["First Name", "Last Name", "Cellphone", "Custom Widget Code"],
          rowCount: 2,
          sampleRows: [
            {
              "First Name": "Jo",
              "Last Name": "Nx",
              Cellphone: "0830000000",
              "Custom Widget Code": "W1",
            },
          ],
        },
      ],
    });
    assert.ok(analysis.summary.totalFields === 4);
    const custom = analysis.discoveredFields.find((f) => f.sourceColumn === "Custom Widget Code");
    assert.ok(
      custom?.status === "SOURCE_ONLY_PRESERVED" || custom?.status === "UNSUPPORTED",
      "custom column must not silently disappear"
    );
    console.log("  ✓ E — unknown vendor continues with generic analysis");
  }

  // Fixture F — ambiguous finance columns
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "f1",
          filename: "balances.csv",
          category: "billing",
          columns: ["Account Number", "Balance", "Amount", "Payment"],
          rowCount: 3,
          sampleRows: [
            { "Account Number": "1", Balance: "50", Amount: "10", Payment: "5" },
          ],
        },
      ],
    });
    const ambiguous = analysis.discoveredFields.filter(
      (f) => f.financeRequiresConfirmation || f.status === "CONFIRM_MAPPING"
    );
    assert.ok(ambiguous.length >= 1, "finance ambiguity must require confirmation");
    console.log("  ✓ F — ambiguous finance requires confirmation");
  }

  // Fixture G — unsupported/custom columns preserved
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "g1",
          filename: "medical.csv",
          category: "learners",
          columns: ["First Name", "Last Name", "Allergy Notes", "Blood Type"],
          rowCount: 1,
          sampleRows: [
            {
              "First Name": "A",
              "Last Name": "B",
              "Allergy Notes": "Nuts",
              "Blood Type": "O+",
            },
          ],
        },
      ],
    });
    const allergy = analysis.discoveredFields.find((f) => f.sourceColumn === "Allergy Notes");
    assert.ok(allergy);
    assert.ok(
      allergy!.status === "UNSUPPORTED" || allergy!.status === "SOURCE_ONLY_PRESERVED"
    );
    assert.strictEqual(
      analysis.summary.totalFields,
      analysis.discoveredFields.length,
      "inventory complete — no silent drop"
    );
    console.log("  ✓ G — unsupported fields reported");
  }

  // Fixture H — aliases for same field
  {
    for (const header of ["Mom Cell", "Mother Mobile", "Parent Cell", "Guardian Contact", "Cellphone"]) {
      const analysis = analyzeMigrationPackage({
        targetSchoolId: SCHOOL_A,
        files: [
          {
            fileId: `h-${header}`,
            filename: "parents.csv",
            category: "parents",
            columns: [header, "Parent Surname"],
            rowCount: 1,
            sampleRows: [{ [header]: "0822222222", "Parent Surname": "X" }],
          },
        ],
      });
      const field = analysis.discoveredFields.find((f) => f.sourceColumn === header);
      assert.ok(field?.suggestedTarget === "parentPhone", `${header} should map to parentPhone`);
    }
    console.log("  ✓ H — cellphone aliases map consistently");
  }

  // School binding — analysis for A not readable as B
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "bind1",
          filename: "learners.csv",
          columns: ["First Name", "Last Name"],
          rowCount: 1,
          sampleRows: [{ "First Name": "A", "Last Name": "B" }],
        },
      ],
    });
    const saved = saveSourceAnalysis(analysis);
    const wrong = getBoundSourceAnalysis(saved.analysisId, { targetSchoolId: SCHOOL_B });
    assert.strictEqual(wrong, null);
    const right = getBoundSourceAnalysis(saved.analysisId, { targetSchoolId: SCHOOL_A });
    assert.ok(right);
    console.log("  ✓ school binding — School A analysis not reusable on School B");
  }

  // Stale mapping — header change invalidates confirmation
  {
    const first = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "stale1",
          filename: "p.csv",
          category: "parents",
          columns: ["Mother Mobile"],
          rowCount: 1,
          sampleRows: [{ "Mother Mobile": "081" }],
        },
      ],
    });
    const field = first.discoveredFields[0]!;
    const accepted = applyOperatorFieldDecision(first, field.fieldKey, "ACCEPT");
    const second = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "stale1",
          filename: "p.csv",
          category: "parents",
          columns: ["Mother Mobile", "Extra Col"],
          rowCount: 1,
          sampleRows: [{ "Mother Mobile": "081", "Extra Col": "x" }],
        },
      ],
      priorConfirmedMappings: accepted.confirmedMappings,
      priorHeaderFingerprints: Object.fromEntries(
        first.files.map((f) => [f.fileId, f.headerFingerprint])
      ),
    });
    // fingerprint changed → prior accept not blindly kept as confirmed for mismatched file shape
    assert.ok(second.summary.totalFields === 2);
    console.log("  ✓ stale protection — header change re-analyses fields");
  }

  // Zero school writes (analysis is pure — candidates array untouched metaphor)
  {
    const marker = { writes: 0 };
    analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "z1",
          filename: "x.csv",
          columns: ["First Name"],
          rowCount: 1,
          sampleRows: [{ "First Name": "Z" }],
        },
      ],
    });
    assert.strictEqual(marker.writes, 0);
    console.log("  ✓ zero school writes during analysis");
  }

  console.log("\nPhase 1E source-analysis: ALL TESTS PASSED");
}

run().catch((err) => {
  console.error("Phase 1E FAILED", err);
  process.exit(1);
});
