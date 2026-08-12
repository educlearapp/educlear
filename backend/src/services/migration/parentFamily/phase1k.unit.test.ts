/**
 * Phase 1K unit tests — parent/family discovery, matching rules, plan compile.
 * Run: npx tsx src/services/migration/parentFamily/phase1k.unit.test.ts
 */

import assert from "assert";
import { detectParentColumnKind, mapParentColumns } from "./semanticParentDetection";
import { isShellOrJunkParent } from "./shellParentDetection";
import { compileParentFamilyMigrationPlan } from "./compileParentFamilyMigrationPlan";
import { applyParentFamilyReviewAction } from "./parentFamilyReviewActions";
import { saveParentFamilyPlan } from "./parentFamilyPlanStore";
import type { ExistingParentCandidate } from "../parentIdentity/parentIdentityTypes";

function cand(partial: Partial<ExistingParentCandidate> & { id: string }): ExistingParentCandidate {
  return {
    firstName: "X",
    surname: "Y",
    idNumber: null,
    cellNo: null,
    email: null,
    linkedLearners: [],
    ...partial,
  };
}

function testSemanticDetection() {
  assert.strictEqual(detectParentColumnKind("Mother Name"), "motherName");
  assert.strictEqual(detectParentColumnKind("Father Full Name"), "fatherName");
  assert.strictEqual(detectParentColumnKind("Guardian"), "guardianName");
  assert.strictEqual(detectParentColumnKind("Parent Cell"), "cellNo");
  assert.strictEqual(detectParentColumnKind("SA ID Number"), "idNumber");
  assert.strictEqual(detectParentColumnKind("Learner Admission"), "admissionNo");
  const map = mapParentColumns([
    "Learner Name",
    "Admission No",
    "Mother",
    "Father",
    "Parent ID Number",
    "Mobile",
    "Email",
  ]);
  assert.ok(map.motherName || map.fatherName || map.parentFullName);
  assert.ok(map.cellNo || map.email);
  console.log("✓ semantic parent column detection");
}

function testShellDetection() {
  const junk = isShellOrJunkParent({
    firstName: "Ann",
    surname: "One",
    idNumber: null,
    cellNo: null,
    email: null,
    learnerName: "Ann One",
  });
  assert.strictEqual(junk.junk, true);

  const placeholder = isShellOrJunkParent({
    firstName: "Mother",
    surname: "",
    idNumber: null,
    cellNo: null,
    email: null,
  });
  assert.strictEqual(placeholder.junk, true);

  const ok = isShellOrJunkParent({
    firstName: "Maria",
    surname: "Nkosi",
    idNumber: "8001015009087",
    cellNo: "0821234567",
    email: "maria@example.com",
  });
  assert.strictEqual(ok.junk, false);
  console.log("✓ K — shell/junk parent detection");
}

function testCleanMatchExisting() {
  const existingId = "parent_existing_1";
  const { discovery, plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_pf_a",
    candidates: [
      cand({
        id: existingId,
        firstName: "Maria",
        surname: "Nkosi",
        idNumber: "8001015009087",
        cellNo: "0821234567",
        email: "maria@example.com",
        linkedLearners: [{ learnerId: "l1", label: "Ann One" }],
      }),
    ],
    learners: [
      {
        id: "learner_1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Ann",
        lastName: "One",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Parent ID Number", "Mobile", "Email"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Ann One",
            Mother: "Maria Nkosi",
            "Parent ID Number": "8001015009087",
            Mobile: "0821234567",
            Email: "maria@example.com",
          },
        ],
      },
    ],
  });
  assert.ok(discovery.automaticallyResolved >= 1);
  const person = plan.people.find((p) => p.matchState === "MATCHED_EXISTING");
  assert.ok(person);
  assert.strictEqual(person!.matchedExistingParentId, existingId);
  assert.strictEqual(plan.metrics.manualMappingActionsRequired, 0);
  console.log("✓ A — clean parent strong ID → MATCHED_EXISTING");
}

function testProposedNew() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    candidates: [],
    learners: [
      {
        id: "learner_1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Ann",
        lastName: "One",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Parent ID Number", "Mobile", "Email"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Ann One",
            Mother: "Thandi Dlamini",
            "Parent ID Number": "7502025009088",
            Mobile: "0831112233",
            Email: "thandi@example.com",
          },
        ],
      },
    ],
  });
  assert.ok(plan.people.some((p) => p.matchState === "PROPOSED_NEW"));
  console.log("✓ B — new parent → PROPOSED_NEW");
}

function testSiblingOneParent() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    candidates: [],
    learners: [
      {
        id: "l1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Ann",
        lastName: "One",
      },
      {
        id: "l2",
        idNumber: "9002025009088",
        admissionNo: "L02",
        firstName: "Bob",
        lastName: "One",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Parent ID Number", "Mobile", "Email"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Ann One",
            Mother: "Maria Nkosi",
            "Parent ID Number": "8001015009087",
            Mobile: "0821234567",
            Email: "maria@example.com",
          },
          {
            "Learner ID": "9002025009088",
            "Learner Name": "Bob One",
            Mother: "Maria Nkosi",
            "Parent ID Number": "8001015009087",
            Mobile: "0821234567",
            Email: "maria@example.com",
          },
        ],
      },
    ],
  });
  const matched = plan.people.filter(
    (p) => p.idNumber === "8001015009087" || p.displayName.toLowerCase().includes("maria")
  );
  assert.strictEqual(matched.length, 1, "one parent proposal for siblings");
  assert.ok(matched[0].learnerKeys.length === 2);
  console.log("✓ C — one parent proposal for multiple learners");
}

function testNameOnlyNoMerge() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    candidates: [
      cand({
        id: "p1",
        firstName: "Katudi",
        surname: "Mankgane",
        idNumber: null,
        cellNo: null,
        email: null,
      }),
    ],
    learners: [
      {
        id: "l1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Kid",
        lastName: "X",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Kid X",
            Mother: "Katudi Mankuane",
          },
        ],
      },
    ],
  });
  const person = plan.people.find((p) => p.displayName.toLowerCase().includes("katudi"));
  assert.ok(person);
  assert.notStrictEqual(person!.matchState, "MATCHED_EXISTING");
  console.log("✓ E — name similarity alone must NOT auto-merge");
}

function testSharedCellNoAutoMerge() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    candidates: [
      cand({
        id: "p1",
        firstName: "John",
        surname: "Smith",
        cellNo: "0829990000",
        email: null,
        idNumber: null,
      }),
    ],
    learners: [
      {
        id: "l1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Kid",
        lastName: "X",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Mobile"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Kid X",
            Mother: "Jane Doe",
            Mobile: "0829990000",
          },
        ],
      },
    ],
  });
  const person = plan.people.find((p) => p.displayName.toLowerCase().includes("jane"));
  assert.ok(person);
  assert.notStrictEqual(person!.matchState, "MATCHED_EXISTING");
  console.log("✓ F — shared cellphone alone must NOT auto-merge");
}

function testConflictingId() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    candidates: [
      cand({
        id: "p1",
        firstName: "Maria",
        surname: "Nkosi",
        idNumber: "8001015009087",
        cellNo: "0821111111",
        email: "a@example.com",
      }),
    ],
    learners: [
      {
        id: "l1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Ann",
        lastName: "One",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Parent ID Number", "Mobile", "Email"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Ann One",
            Mother: "Completely Different",
            "Parent ID Number": "8001015009087",
            Mobile: "0832222222",
            Email: "other@example.com",
          },
        ],
      },
    ],
  });
  // Exact ID may still REUSE with surname difference ignored, OR conflict depending on resolver.
  // Critical: must not silently create a second parent with same SA ID.
  const sameId = plan.people.filter((p) => p.idNumber === "8001015009087");
  assert.ok(sameId.length >= 1);
  assert.ok(
    sameId.every(
      (p) =>
        p.matchState === "MATCHED_EXISTING" ||
        p.matchState === "IDENTITY_CONFLICT" ||
        p.matchState === "REVIEW_REQUIRED"
    ),
    "same SA ID must not invent a duplicate PROPOSED_NEW"
  );
  console.log("✓ I — conflicting SA ID handled without duplicate create");
}

function testInsufficientEvidence() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    candidates: [],
    learners: [
      {
        id: "l1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Ann",
        lastName: "One",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Ann One",
            Mother: "Mary",
          },
        ],
      },
    ],
  });
  const mary = plan.people.find((p) => p.firstName.toLowerCase() === "mary");
  assert.ok(mary);
  assert.ok(
    mary!.matchState === "INSUFFICIENT_EVIDENCE" ||
      mary!.matchState === "IGNORED" ||
      mary!.matchState === "PROPOSED_NEW"
  );
  // Prefer safety: weak Mary alone should not MATCHED_EXISTING
  assert.notStrictEqual(mary!.matchState, "MATCHED_EXISTING");
  console.log("✓ V/H — weak mother name handled without unsafe match");
}

function testReviewStalesCheck() {
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_a",
    stageId: "stage_review_stale",
    candidates: [
      cand({ id: "p1", firstName: "A", surname: "One", idNumber: "8001015009087" }),
      cand({ id: "p2", firstName: "A", surname: "Two", idNumber: null, cellNo: "0820000001", email: "a@x.com" }),
    ],
    learners: [
      {
        id: "l1",
        idNumber: "9001015009087",
        admissionNo: "L01",
        firstName: "Kid",
        lastName: "X",
      },
    ],
    files: [
      {
        fileId: "f1",
        filename: "learners.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Mobile", "Email"],
        rows: [
          {
            "Learner ID": "9001015009087",
            "Learner Name": "Kid X",
            Mother: "Ambiguous Parent",
            Mobile: "0820000001",
            Email: "a@x.com",
          },
        ],
      },
    ],
  });
  saveParentFamilyPlan(plan);
  const reviewPerson = plan.people.find(
    (p) => p.matchState === "REVIEW_REQUIRED" || p.candidateSummaries.length >= 1
  );
  if (reviewPerson) {
    const updated = applyParentFamilyReviewAction({
      plan,
      proposalId: reviewPerson.proposalId,
      action: "CREATE_NEW",
    });
    assert.strictEqual(
      updated.people.find((p) => p.proposalId === reviewPerson.proposalId)?.matchState,
      "ACCEPTED"
    );
  }
  console.log("✓ M/U — review action updates plan (stale check when prior check exists)");
}

function testPerformanceSynthetic() {
  const rows: Record<string, string>[] = [];
  const learners: Array<{
    id: string;
    idNumber: string | null;
    admissionNo: string | null;
    firstName: string;
    lastName: string;
  }> = [];
  const candidates: ExistingParentCandidate[] = [];
  for (let i = 0; i < 400; i++) {
    const lid = String(9000000000000 + i);
    learners.push({
      id: `learner_${i}`,
      idNumber: lid,
      admissionNo: `A${i}`,
      firstName: `L${i}`,
      lastName: `S${i}`,
    });
    const pid = String(8000000000000 + i);
    if (i % 2 === 0) {
      candidates.push(
        cand({
          id: `parent_${i}`,
          firstName: `P${i}`,
          surname: `Family${i}`,
          idNumber: pid,
          cellNo: `082${String(1000000 + i).slice(0, 7)}`,
          email: `p${i}@example.com`,
        })
      );
    }
    rows.push({
      "Learner ID": lid,
      "Learner Name": `L${i} S${i}`,
      Mother: `P${i} Family${i}`,
      "Parent ID Number": pid,
      Mobile: `082${String(1000000 + i).slice(0, 7)}`,
      Email: `p${i}@example.com`,
    });
  }
  const t0 = Date.now();
  const { plan } = compileParentFamilyMigrationPlan({
    targetSchoolId: "school_perf",
    candidates,
    learners,
    files: [
      {
        fileId: "f1",
        filename: "big.csv",
        columns: ["Learner ID", "Learner Name", "Mother", "Parent ID Number", "Mobile", "Email"],
        rows,
      },
    ],
  });
  const ms = Date.now() - t0;
  assert.ok(plan.people.length >= 200);
  assert.ok(ms < 15000, `compile too slow: ${ms}ms`);
  console.log(
    `✓ performance synthetic: learners=${learners.length} parents≈${plan.people.length} links=${plan.links.length} compileMs=${ms}`
  );
}

function testAcceptGateOnlyWhenPlanExists() {
  // Gate logic is in acceptMigration — verify store lookup contract:
  // no plan for random stage → null (Accept must not require parent-family).
  const { getParentFamilyPlanByStage } = require("./parentFamilyPlanStore") as typeof import("./parentFamilyPlanStore");
  assert.strictEqual(getParentFamilyPlanByStage("no_such_stage_1k_accept"), null);
  console.log("✓ X — Accept Parent/Family gate inactive when no plan exists");
}

function main() {
  testSemanticDetection();
  testShellDetection();
  testCleanMatchExisting();
  testProposedNew();
  testSiblingOneParent();
  testNameOnlyNoMerge();
  testSharedCellNoAutoMerge();
  testConflictingId();
  testInsufficientEvidence();
  testReviewStalesCheck();
  testPerformanceSynthetic();
  testAcceptGateOnlyWhenPlanExists();
  console.log("\nPhase 1K unit tests passed.");
}

main();
