/**
 * Phase 1D — Parent Identity Review / Full Preflight safety tests.
 * LOCAL only. Pure preflight + session binding helpers (zero school writes).
 *
 * Run:
 *   npx tsx src/services/migration/core/parentIdentityReview.phase1d.unit.test.ts
 */
import assert from "assert";
import {
  isParentIdentityPreflightClear,
  runParentIdentityPreflight,
  type ExistingParentCandidate,
  type ParentIdentityResolution,
} from "../parentIdentity";
import {
  getBoundParentIdentityResolutions,
  type PersistentMigrationSession,
} from "./migrationSessionStore";

type FakeParent = ExistingParentCandidate;

function incoming(partial: {
  firstName: string;
  surname: string;
  idNumber?: string | null;
  cellNo?: string | null;
  email?: string | null;
  learnerLabel?: string | null;
  sourceRow?: number;
}) {
  return {
    sourceSystem: "SA-SAMS" as const,
    firstName: partial.firstName,
    surname: partial.surname,
    idNumber: partial.idNumber ?? null,
    cellNo: partial.cellNo ?? null,
    email: partial.email ?? null,
    learnerLabel: partial.learnerLabel ?? null,
    sourceRow: partial.sourceRow ?? 1,
  };
}

function assertZeroWrites(before: number, after: number, label: string) {
  assert.strictEqual(after, before, `${label}: unexpected parent list mutation`);
}

async function run() {
  console.log("Phase 1D parent-review / preflight tests…");

  // A — Preflight unresolved review + zero writes
  {
    const candidates: FakeParent[] = [
      {
        id: "p-a1",
        firstName: "Thabo",
        surname: "Molefe",
        cellNo: "0821111111",
        email: null,
        idNumber: null,
      },
      {
        id: "p-a2",
        firstName: "Thabo",
        surname: "Molefe",
        cellNo: "0821111111",
        email: null,
        idNumber: null,
      },
    ];
    const before = candidates.length;
    const report = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Thabo",
            surname: "Molefe",
            cellNo: "0821111111",
            learnerLabel: "Learner A",
          }),
        },
      ],
    });
    assert.strictEqual(report.status, "MIGRATION_REQUIRES_REVIEW");
    assert.ok(report.counts.unresolved > 0);
    assert.strictEqual(report.items[0]!.decision, "REVIEW_REQUIRED");
    assertZeroWrites(before, candidates.length, "Test A");
    console.log("  ✓ A — unresolved review, zero writes");
  }

  // B — Valid Use Existing Parent → clean
  {
    const candidates: FakeParent[] = [
      {
        id: "p-existing",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ];
    const draft = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Puseletso",
            surname: "KGSOANE",
            cellNo: "0780000051",
            sourceRow: 2,
          }),
        },
      ],
    });
    assert.strictEqual(draft.items[0]!.decision, "REVIEW_REQUIRED");
    const resolutions: ParentIdentityResolution[] = [
      {
        itemKey: draft.items[0]!.itemKey,
        kind: "LINK_TO_EXISTING_PARENT",
        existingParentId: "p-existing",
      },
    ];
    const resolved = runParentIdentityPreflight({
      candidates,
      rows: [{ incoming: draft.items[0]!.incoming }],
      resolutions,
    });
    assert.ok(isParentIdentityPreflightClear(resolved));
    assert.strictEqual(resolved.items[0]!.decision, "REUSE_EXISTING");
    assert.strictEqual(resolved.counts.readyToReuse, 1);
    console.log("  ✓ B — LINK_TO_EXISTING produces clean preflight");
  }

  // C — Valid Create New → clean
  {
    const candidates: FakeParent[] = [
      {
        id: "p-other",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ];
    const draft = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Puseletso",
            surname: "KGSOANE",
            cellNo: "0780000051",
            sourceRow: 3,
          }),
        },
      ],
    });
    const resolutions: ParentIdentityResolution[] = [
      {
        itemKey: draft.items[0]!.itemKey,
        kind: "CREATE_AS_NEW_PARENT",
      },
    ];
    const resolved = runParentIdentityPreflight({
      candidates,
      rows: [{ incoming: draft.items[0]!.incoming }],
      resolutions,
    });
    assert.ok(isParentIdentityPreflightClear(resolved));
    assert.strictEqual(resolved.items[0]!.decision, "CREATE_NEW");
    assert.strictEqual(resolved.counts.readyToCreate, 1);
    console.log("  ✓ C — CREATE_AS_NEW produces clean preflight");
  }

  // D — Resolution referencing Parent from another school rejected
  {
    // School B has ambiguous same-school candidates → REVIEW_REQUIRED.
    // School A parent id is NOT in School B candidate list.
    const schoolBCandidates: FakeParent[] = [
      {
        id: "schoolB-parent-1",
        firstName: "Nomsa",
        surname: "Dlamini",
        cellNo: "0830000001",
        idNumber: null,
        email: null,
      },
      {
        id: "schoolB-parent-2",
        firstName: "Nomsa",
        surname: "Dlamini",
        cellNo: "0830000001",
        idNumber: null,
        email: null,
      },
    ];
    const draft = runParentIdentityPreflight({
      candidates: schoolBCandidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Nomsa",
            surname: "Dlamini",
            cellNo: "0830000001",
            sourceRow: 4,
          }),
        },
      ],
    });
    assert.strictEqual(draft.items[0]!.decision, "REVIEW_REQUIRED");
    // Forged School A parent id — must not resolve.
    const resolved = runParentIdentityPreflight({
      candidates: schoolBCandidates,
      rows: [{ incoming: draft.items[0]!.incoming }],
      resolutions: [
        {
          itemKey: draft.items[0]!.itemKey,
          kind: "LINK_TO_EXISTING_PARENT",
          existingParentId: "schoolA-parent-FORGED",
        },
      ],
    });
    assert.notStrictEqual(resolved.items[0]!.decision, "REUSE_EXISTING");
    assert.ok(resolved.items[0]!.resolutionInvalidReason);
    assert.ok(resolved.counts.unresolved > 0);
    console.log("  ✓ D — cross-school parent id rejected");
  }

  // E — Resolution for wrong stage/run rejected by session binder
  {
    const session = {
      schoolId: "schoolA",
      parentIdentityResolutions: {
        stageId: "stage-A",
        migrationRunId: "stage-A",
        targetSchoolId: "schoolA",
        resolutions: [
          {
            itemKey: "k1",
            kind: "CREATE_AS_NEW_PARENT" as const,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    } as PersistentMigrationSession;
    const wrongStage = getBoundParentIdentityResolutions(session, {
      stageId: "stage-B",
      targetSchoolId: "schoolA",
    });
    assert.strictEqual(wrongStage.length, 0);
    const wrongSchool = getBoundParentIdentityResolutions(session, {
      stageId: "stage-A",
      targetSchoolId: "schoolB",
    });
    assert.strictEqual(wrongSchool.length, 0);
    const ok = getBoundParentIdentityResolutions(session, {
      stageId: "stage-A",
      targetSchoolId: "schoolA",
    });
    assert.strictEqual(ok.length, 1);
    console.log("  ✓ E — wrong stage/school resolutions rejected");
  }

  // F — Stale/deleted Parent candidate rejected
  {
    const candidates: FakeParent[] = [
      {
        id: "p-live",
        firstName: "Ada",
        surname: "Lovelace",
        cellNo: "0710000000",
        email: null,
        idNumber: null,
      },
    ];
    const draft = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Ada",
            surname: "Lovelace",
            cellNo: "0710000000",
            sourceRow: 5,
          }),
        },
      ],
    });
    const resolved = runParentIdentityPreflight({
      candidates, // deleted id not present
      rows: [{ incoming: draft.items[0]!.incoming }],
      resolutions: [
        {
          itemKey: draft.items[0]!.itemKey,
          kind: "LINK_TO_EXISTING_PARENT",
          existingParentId: "p-deleted",
        },
      ],
    });
    assert.ok(resolved.items[0]!.resolutionInvalidReason);
    assert.ok(resolved.counts.unresolved > 0);
    console.log("  ✓ F — stale/deleted parent rejected");
  }

  // G — Apply without required resolutions remains blocked (preflight clear false)
  {
    const candidates: FakeParent[] = [
      {
        id: "p1",
        firstName: "Sam",
        surname: "Botha",
        cellNo: "0722222222",
        email: "sam@example.com",
        idNumber: null,
      },
      {
        id: "p2",
        firstName: "Sam",
        surname: "Botha",
        cellNo: "0722222222",
        email: "other@example.com",
        idNumber: null,
      },
    ];
    const report = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Sam",
            surname: "Botha",
            cellNo: "0722222222",
            sourceRow: 6,
          }),
        },
      ],
      resolutions: [],
    });
    assert.strictEqual(isParentIdentityPreflightClear(report), false);
    assert.strictEqual(report.status, "MIGRATION_REQUIRES_REVIEW");
    console.log("  ✓ G — without resolutions remains blocked");
  }

  // H — Complete valid resolutions succeed (local preflight READY)
  {
    const candidates: FakeParent[] = [
      {
        id: "p-h",
        firstName: "Sam",
        surname: "Botha",
        cellNo: "0722222222",
        email: null,
        idNumber: null,
      },
    ];
    const draft = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: incoming({
            firstName: "Sam",
            surname: "BOTHA",
            cellNo: "0722222222",
            sourceRow: 7,
            learnerLabel: "Child One",
          }),
          link: { learnerId: "L1", isPrimary: true },
        },
      ],
    });
    const resolved = runParentIdentityPreflight({
      candidates,
      rows: [
        {
          incoming: draft.items[0]!.incoming,
          link: { learnerId: "L1", isPrimary: true },
        },
      ],
      resolutions: [
        {
          itemKey: draft.items[0]!.itemKey,
          kind: "LINK_TO_EXISTING_PARENT",
          existingParentId: "p-h",
        },
      ],
    });
    assert.ok(isParentIdentityPreflightClear(resolved));
    assert.strictEqual(resolved.counts.unresolved, 0);
    assert.strictEqual(resolved.counts.expectedLinks, 1);
    console.log("  ✓ H — complete valid resolutions → READY_TO_APPLY");
  }

  // False-merge regressions
  {
    const cellOnly = runParentIdentityPreflight({
      candidates: [
        {
          id: "c1",
          firstName: " ann",
          surname: "Smith",
          cellNo: "0825555555",
          email: null,
          idNumber: null,
        },
      ],
      rows: [
        {
          incoming: incoming({
            firstName: "Bob",
            surname: "Jones",
            cellNo: "0825555555",
            sourceRow: 10,
          }),
        },
      ],
    });
    assert.notStrictEqual(cellOnly.items[0]!.decision, "REUSE_EXISTING");

    const emailOnly = runParentIdentityPreflight({
      candidates: [
        {
          id: "e1",
          firstName: "Ann",
          surname: "Smith",
          cellNo: null,
          email: "shared@school.test",
          idNumber: null,
        },
      ],
      rows: [
        {
          incoming: incoming({
            firstName: "Bob",
            surname: "Jones",
            email: "shared@school.test",
            sourceRow: 11,
          }),
        },
      ],
    });
    assert.notStrictEqual(emailOnly.items[0]!.decision, "REUSE_EXISTING");

    const nameOnly = runParentIdentityPreflight({
      candidates: [
        {
          id: "n1",
          firstName: "John",
          surname: "Doe",
          cellNo: null,
          email: null,
          idNumber: null,
        },
      ],
      rows: [
        {
          incoming: incoming({
            firstName: "John",
            surname: "Doe",
            sourceRow: 12,
          }),
        },
      ],
    });
    assert.notStrictEqual(nameOnly.items[0]!.decision, "REUSE_EXISTING");

    const typo = runParentIdentityPreflight({
      candidates: [
        {
          id: "t1",
          firstName: "Puseletso",
          surname: "Kgasoane",
          cellNo: null,
          email: null,
          idNumber: null,
        },
      ],
      rows: [
        {
          incoming: incoming({
            firstName: "Puseletso",
            surname: "KGSOANE",
            sourceRow: 13,
          }),
        },
      ],
    });
    assert.notStrictEqual(typo.items[0]!.decision, "REUSE_EXISTING");

    const exactId = runParentIdentityPreflight({
      candidates: [
        {
          id: "id1",
          firstName: "Exact",
          surname: "Match",
          idNumber: "8001015009087",
          cellNo: null,
          email: null,
        },
      ],
      rows: [
        {
          incoming: incoming({
            firstName: "Exact",
            surname: "Match",
            idNumber: "8001015009087",
            sourceRow: 14,
          }),
        },
      ],
    });
    assert.strictEqual(exactId.items[0]!.decision, "REUSE_EXISTING");
    console.log("  ✓ False-merge regressions (cell/email/name/typo/exact ID)");
  }

  // Cross-school: School B must not see School A parent as candidate
  {
    const schoolBOnly: FakeParent[] = []; // empty — SA ID exists only at A in real DB
    const report = runParentIdentityPreflight({
      candidates: schoolBOnly,
      rows: [
        {
          incoming: incoming({
            firstName: "Shared",
            surname: "IdHuman",
            idNumber: "9001015800085",
            sourceRow: 20,
          }),
        },
      ],
    });
    assert.strictEqual(report.items[0]!.decision, "CREATE_NEW");
    assert.strictEqual(report.items[0]!.candidates.length, 0);
    console.log("  ✓ Cross-school — School B creates new (no School A candidate)");
  }

  console.log("\nPhase 1D parent-review: ALL TESTS PASSED");
}

run().catch((err) => {
  console.error("Phase 1D parent-review FAILED", err);
  process.exit(1);
});
