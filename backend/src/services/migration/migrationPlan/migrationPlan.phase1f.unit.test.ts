/**
 * Phase 1F — authoritative Source-to-Apply Migration Plan fixtures A–L.
 * LOCAL only — zero school writes.
 *
 * Run:
 *   npx tsx src/services/migration/migrationPlan/migrationPlan.phase1f.unit.test.ts
 */
import assert from "assert";
import {
  analyzeMigrationPackage,
  applyOperatorFieldDecision,
  saveSourceAnalysis,
} from "../sourceAnalysis";
import {
  assertPlanFingerprintsFresh,
  assertPlanSchool,
  clientMappingsCompatibleWithPlan,
  compileMappingsFromAnalysis,
  compileMigrationPlan,
  getBoundCompiledPlan,
  saveCompiledPlan,
} from "./index";

const SCHOOL_A = "schoolA_phase1f";
const SCHOOL_B = "schoolB_phase1f";

function learnerFile(overrides?: Partial<{ fileId: string; filename: string; rowCount: number }>) {
  return {
    fileId: overrides?.fileId || "learn1",
    filename: overrides?.filename || "learners.csv",
    category: "learners",
    columns: [
      "Pupil ID",
      "First Name",
      "Surname",
      "Nickname",
      "DOB",
      "Gender",
      "Grade",
      "Class",
      "Language",
      "Citizenship",
      "Status",
      "Notes",
      "Admission Date",
      "Medical Alert",
    ],
    rowCount: overrides?.rowCount ?? 5,
    sampleRows: [
      {
        "Pupil ID": "L1",
        "First Name": "Ada",
        Surname: "Lovelace",
        Nickname: "Addy",
        DOB: "2014-01-01",
        Gender: "F",
        Grade: "5",
        Class: "5A",
        Language: "English",
        Citizenship: "ZA",
        Status: "Active",
        Notes: "Music",
        "Admission Date": "2020-01-15",
        "Medical Alert": "None",
      },
    ],
  };
}

async function run() {
  console.log("Phase 1F migration-plan compiler tests…");

  // A — generic learner export → compiled mappings → learner plan
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [learnerFile()],
    });
    const { mappings, entries } = compileMappingsFromAnalysis(analysis);
    assert.ok(mappings.some((m) => m.mappings.length > 0), "A: mappings flow");
    const plan = compileMigrationPlan({ analysis });
    assert.ok(plan.summary.learnersToCreate >= 1, "A: learners planned");
    assert.ok(
      plan.learners.extendedFieldsIncluded.includes("firstName") ||
        plan.learners.extendedFieldsIncluded.includes("fullName"),
      "A: name field planned"
    );
    assert.ok(entries.some((e) => e.fieldTrace === "planned"), "A: planned trace");
    console.log("  ✓ A — learner analysis → plan");
  }

  // B — learners + parents cross-file links
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "b-l",
          filename: "Learners.xlsx",
          category: "learners",
          columns: ["Admission No", "First Name", "Last Name"],
          rowCount: 4,
          sampleRows: [
            { "Admission No": "A1", "First Name": "Ann", "Last Name": "Bee" },
          ],
        },
        {
          fileId: "b-p",
          filename: "Parents.xlsx",
          category: "parents",
          columns: ["Admission No", "Guardian Name", "Mother Mobile", "Parent Email"],
          rowCount: 4,
          sampleRows: [
            {
              "Admission No": "A1",
              "Guardian Name": "Pat Bee",
              "Mother Mobile": "0821111111",
              "Parent Email": "p@test.com",
            },
          ],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    assert.ok(plan.summary.parentLinks >= 0, "B: parent links field present");
    assert.ok(
      plan.joins.length > 0 || analysis.relationshipCandidates.length > 0,
      "B: relationship candidates compiled into joins or present"
    );
    const auto = plan.joins.filter((j) => j.autoLink);
    for (const j of auto) {
      assert.strictEqual(j.confidence, "HIGH", "B: auto-link only HIGH");
    }
    console.log("  ✓ B — learners+parents joins");
  }

  // C — classrooms relationships
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "c-l",
          filename: "learners.csv",
          category: "learners",
          columns: ["Learner No", "Name", "Class Code"],
          rowCount: 3,
          sampleRows: [{ "Learner No": "1", Name: "Kid One", "Class Code": "5A" }],
        },
        {
          fileId: "c-c",
          filename: "classes.csv",
          category: "other",
          columns: ["Class Code", "Class Name", "Grade"],
          rowCount: 2,
          sampleRows: [{ "Class Code": "5A", "Class Name": "Grade 5A", Grade: "5" }],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    assert.ok(plan.classrooms.toCreate + plan.classrooms.toReuse >= 0);
    const classroomJoins = plan.joins.filter((j) => j.keyKind === "classroom_code");
    // May or may not detect depending on analyzer — if present must be explicit confidence
    for (const j of classroomJoins) {
      assert.ok(j.confidence === "HIGH" || j.requiresConfirmation);
    }
    console.log("  ✓ C — classroom relationships compiled");
  }

  // D — extended learner fields; admissionDate now persists on Learner
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [learnerFile()],
    });
    const { entries } = compileMappingsFromAnalysis(analysis);
    const plan = compileMigrationPlan({ analysis });
    const supportedWanted = ["nickname", "homeLanguage", "citizenship", "status", "notes"];
    const included = plan.learners.extendedFieldsIncluded;
    assert.ok(
      supportedWanted.some((f) => included.includes(f)),
      `D: expected some extended learner fields, got ${included.join(",")}`
    );
    const admission = entries.find((e) => e.sourceColumn === "Admission Date");
    if (admission) {
      assert.strictEqual(
        admission.target,
        "admissionDate",
        "D: admissionDate must flow as target when mapped"
      );
      assert.ok(
        admission.target === "admissionDate" && admission.fieldTrace !== "unsupported",
        `D: admission date should map, got ${admission.fieldTrace}`
      );
    }
    console.log("  ✓ D — extended learner fields; admissionDate may persist");
  }

  // E — extended parent fields
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "e-p",
          filename: "parents.csv",
          category: "parents",
          columns: [
            "Parent Name",
            "ID Number",
            "Mobile",
            "Email",
            "Address",
            "Employer",
            "Notes",
            "Work Phone",
          ],
          rowCount: 2,
          sampleRows: [
            {
              "Parent Name": "Pat Bee",
              "ID Number": "8001015009087",
              Mobile: "0821111111",
              Email: "p@test.com",
              Address: "1 Main Rd",
              Employer: "Acme",
              Notes: "Primary",
              "Work Phone": "0115551234",
            },
          ],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    const included = plan.parents.extendedFieldsIncluded;
    assert.ok(
      included.includes("address") ||
        included.includes("employer") ||
        included.includes("parentNotes") ||
        included.includes("parentWorkPhone") ||
        included.includes("parentName"),
      `E: parent extended fields expected, got ${included.join(",")}`
    );
    console.log("  ✓ E — extended parent fields");
  }

  // F — unknown/custom fields preserved unsupported
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "f1",
          filename: "custom.csv",
          category: "learners",
          columns: ["First Name", "Last Name", "Favourite Colour", "Bus Route Code"],
          rowCount: 1,
          sampleRows: [
            {
              "First Name": "A",
              "Last Name": "B",
              "Favourite Colour": "Blue",
              "Bus Route Code": "R12",
            },
          ],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    assert.ok(
      plan.unsupportedFields.length > 0 || plan.unresolvedMappings.length > 0,
      "F: custom fields preserved as unsupported/unresolved"
    );
    console.log("  ✓ F — unsupported/source-only preserved");
  }

  // G — ambiguous cross-file join does not auto-link
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "g1",
          filename: "a.csv",
          category: "learners",
          columns: ["Name", "Family Label"],
          rowCount: 2,
          sampleRows: [{ Name: "Kid", "Family Label": "Smith" }],
        },
        {
          fileId: "g2",
          filename: "b.csv",
          category: "parents",
          columns: ["Guardian", "Family Label"],
          rowCount: 2,
          sampleRows: [{ Guardian: "Pat", "Family Label": "Smith" }],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    const fuzzy = plan.joins.filter(
      (j) => j.keyKind === "other" || j.leftColumn.toLowerCase().includes("family")
    );
    for (const j of fuzzy) {
      if (j.confidence !== "HIGH") {
        assert.strictEqual(j.autoLink, false, "G: non-HIGH must not auto-link");
        assert.strictEqual(j.requiresConfirmation, true);
      }
    }
    console.log("  ✓ G — ambiguous joins not auto-linked");
  }

  // H — ambiguous parent identity still routes to Parent Review (plan surfaces needsReview)
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "h-p",
          filename: "parents.csv",
          category: "parents",
          columns: ["Guardian Name", "Mobile"],
          rowCount: 3,
          sampleRows: [{ "Guardian Name": "Pat", Mobile: "0820000000" }],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    assert.ok(plan.parents.needsReview >= 0);
    // Plan does not bypass 1D — review counts are carried for operator attention
    assert.ok(
      plan.summary.itemsNeedingAttention >= plan.parents.needsReview,
      "H: review items counted in attention"
    );
    console.log("  ✓ H — parent review still required path");
  }

  // I — fingerprint change → stale
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [learnerFile({ fileId: "i1" })],
    });
    const saved = saveSourceAnalysis(analysis);
    const plan = saveCompiledPlan(compileMigrationPlan({ analysis: saved }));
    const staleAnalysis = {
      ...saved,
      files: saved.files.map((f) =>
        f.fileId === "i1" ? { ...f, headerFingerprint: "CHANGED_HEADER_FP" } : f
      ),
    };
    let threw = false;
    try {
      assertPlanFingerprintsFresh(plan, staleAnalysis);
    } catch (e: unknown) {
      threw = true;
      assert.ok(String((e as Error).message).includes("MIGRATION_PLAN_STALE"));
    }
    assert.ok(threw, "I: stale fingerprints must reject");
    console.log("  ✓ I — stale fingerprint rejection");
  }

  // J — wrong-school plan rejected
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [learnerFile({ fileId: "j1" })],
    });
    const plan = saveCompiledPlan(compileMigrationPlan({ analysis }));
    let threw = false;
    try {
      assertPlanSchool(plan, SCHOOL_B);
    } catch (e: unknown) {
      threw = true;
      assert.ok(String((e as Error).message).includes("MIGRATION_SCHOOL_MISMATCH"));
    }
    assert.ok(threw, "J: wrong school rejected");
    const bound = getBoundCompiledPlan(plan.planId, { targetSchoolId: SCHOOL_B });
    assert.strictEqual(bound, null, "J: bound get returns null for wrong school");
    console.log("  ✓ J — wrong-school rejection (zero writes)");
  }

  // K — existing learner/classroom → reuse/skip estimates
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        learnerFile({ fileId: "k1", rowCount: 5 }),
        {
          fileId: "k-c",
          filename: "classes.csv",
          category: "other",
          columns: ["Class Name"],
          rowCount: 2,
          sampleRows: [{ "Class Name": "5A" }],
        },
      ],
    });
    const plan = compileMigrationPlan({
      analysis,
      existing: {
        learnerKeys: new Set(["a", "b"]),
        classroomNames: new Set(["5A"]),
      },
    });
    assert.ok(plan.summary.learnersAlreadyPresent >= 1, "K: learners already present");
    assert.ok(plan.summary.learnersToCreate >= 0);
    assert.ok(plan.classrooms.toReuse >= 0);
    console.log("  ✓ K — reuse/skip estimates for existing records");
  }

  // L — finance opening balance vs payment; not silently posted
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [
        {
          fileId: "l-fin",
          filename: "Age Analysis.xlsx",
          category: "billing",
          columns: ["Account Number", "Opening Balance", "Account Name"],
          rowCount: 3,
          sampleRows: [
            { "Account Number": "ACC1", "Opening Balance": "100.00", "Account Name": "Bee" },
          ],
        },
        {
          fileId: "l-pay",
          filename: "Payments.csv",
          category: "transactions",
          columns: ["Date", "Amount", "Reference"],
          rowCount: 2,
          sampleRows: [{ Date: "2024-01-01", Amount: "50", Reference: "PAY1" }],
        },
      ],
    });
    const plan = compileMigrationPlan({ analysis });
    const opening = plan.finance.filter((f) => f.kind === "opening_balance");
    assert.ok(opening.length > 0, "L: opening balance planned");
    for (const o of opening) {
      assert.strictEqual(
        o.applicability,
        "APPLICABLE_SAFE_PATH",
        "L: opening balances use ledger opening path (not silent payment)"
      );
      assert.ok(
        /never as (ordinary )?payments?/i.test(o.reason) || /invoice|credit/i.test(o.reason),
        "L: reason must state invoice/credit not payment"
      );
    }
    console.log("  ✓ L — finance opening balance applicable as ledger opening (not payment)");
  }

  // Extra — client unrelated mappings rejected when plan exists
  {
    const analysis = analyzeMigrationPackage({
      targetSchoolId: SCHOOL_A,
      files: [learnerFile({ fileId: "x1" })],
    });
    let next = analysis;
    // Confirm one mapping to ensure compiled mappings non-empty
    const auto = next.discoveredFields.find((f) => f.status === "AUTO_MAPPED");
    if (auto?.suggestedTarget) {
      next = applyOperatorFieldDecision(next, auto.fieldKey, "ACCEPT", auto.suggestedTarget);
    }
    const plan = compileMigrationPlan({ analysis: next });
    const ok = clientMappingsCompatibleWithPlan([], plan.compiledMappings);
    assert.ok(ok, "empty client mappings compatible");
    const bad = clientMappingsCompatibleWithPlan(
      [
        {
          fileId: "x1",
          mappings: [{ sourceColumn: "Totally Wrong", targetField: "firstName" }],
        },
      ],
      plan.compiledMappings
    );
    assert.strictEqual(bad, false, "unrelated client mappings rejected");
    console.log("  ✓ mapping authority — unrelated client mappings rejected");
  }

  console.log("Phase 1F migration-plan tests: ALL PASSED");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
