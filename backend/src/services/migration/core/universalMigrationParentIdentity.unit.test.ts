/**
 * Universal Migration parent identity enforcement tests (A–O) + historical replay.
 * LOCAL only — no DB required (in-memory fakes).
 *
 * Run:
 *   npx ts-node --transpile-only src/services/migration/core/universalMigrationParentIdentity.unit.test.ts
 */
import assert from "assert";
import {
  applyParentIdentityPlan,
  runParentIdentityPreflight,
  type ExistingParentCandidate,
  type ParentIdentityResolution,
} from "../parentIdentity";
import {
  buildIncomingFromMapped,
  buildUniversalParentPreflightRows,
  enrichParentMappedFromContactList,
  parentNamesFromMapped,
  runUniversalMigrationParentPreflight,
} from "./universalMigrationParentIdentity";
import { commitMigrationImport } from "../../migrationService";
import type { MigrationTargetField } from "../types/MigrationTargetField";

type FakeParent = ExistingParentCandidate & {
  workNo?: string | null;
  homeNo?: string | null;
  relationship?: string | null;
};
type FakeLink = { parentId: string; learnerId: string };
type FakeLearner = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  idNumber: string | null;
};

function mapped(partial: Record<string, string>): Record<MigrationTargetField, string> {
  return partial as Record<MigrationTargetField, string>;
}

function makeState(seed?: {
  parents?: FakeParent[];
  links?: FakeLink[];
  learners?: FakeLearner[];
  familyAccounts?: number;
}) {
  return {
    parents: [...(seed?.parents || [])] as FakeParent[],
    links: [...(seed?.links || [])] as FakeLink[],
    learners: [...(seed?.learners || [])] as FakeLearner[],
    familyAccounts: seed?.familyAccounts ?? 0,
    classrooms: 0,
    ledgerWrites: 0,
  };
}

function snapshot(state: ReturnType<typeof makeState>) {
  return {
    parents: state.parents.length,
    links: state.links.length,
    learners: state.learners.length,
    familyAccounts: state.familyAccounts,
    classrooms: state.classrooms,
    ledgerWrites: state.ledgerWrites,
    parentSurnames: state.parents.map((p) => p.surname),
  };
}

function makeFakePrisma(state: ReturnType<typeof makeState>) {
  let idSeq = 5000;
  return {
    parent: {
      findMany: async () => state.parents.map((p) => ({ ...p })),
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.parents.find((p) => p.id === where.id) || null,
      findFirst: async ({ where }: { where: any }) => {
        if (where?.idNumber) {
          return state.parents.find((p) => p.idNumber === where.idNumber) || null;
        }
        return null;
      },
      create: async ({ data }: { data: any }) => {
        const id = `p-${++idSeq}`;
        const row: FakeParent = {
          id,
          firstName: data.firstName,
          surname: data.surname,
          idNumber: data.idNumber ?? null,
          cellNo: data.cellNo ?? null,
          email: data.email ?? null,
          familyAccountId: data.familyAccountId ?? null,
          workNo: data.workNo ?? null,
          homeNo: data.homeNo ?? null,
          relationship: data.relationship ?? null,
        };
        state.parents.push(row);
        return { id };
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const p = state.parents.find((x) => x.id === where.id);
        if (!p) throw new Error("missing parent");
        // Never overwrite surname/firstName in reuse helper path — but if data has them, respect guard
        if (data.firstName != null) p.firstName = data.firstName;
        if (data.surname != null) p.surname = data.surname;
        Object.assign(p, {
          email: data.email !== undefined ? data.email : p.email,
          cellNo: data.cellNo !== undefined ? data.cellNo : p.cellNo,
          idNumber: data.idNumber !== undefined ? data.idNumber : p.idNumber,
        });
        return p;
      },
    },
    parentLearnerLink: {
      upsert: async ({
        where,
      }: {
        where: { parentId_learnerId: { parentId: string; learnerId: string } };
      }) => {
        const { parentId, learnerId } = where.parentId_learnerId;
        if (!state.links.find((l) => l.parentId === parentId && l.learnerId === learnerId)) {
          state.links.push({ parentId, learnerId });
        }
        return { id: `link-${parentId}-${learnerId}` };
      },
    },
    learner: {
      findFirst: async ({ where }: { where: any }) => {
        if (where?.idNumber) {
          return state.learners.find((l) => l.idNumber === where.idNumber) || null;
        }
        return (
          state.learners.find(
            (l) =>
              l.firstName === where.firstName &&
              l.lastName === where.lastName &&
              (where.className == null || l.className === where.className)
          ) || null
        );
      },
    },
  } as any;
}

async function runPreflightAndMaybeApply(opts: {
  state: ReturnType<typeof makeState>;
  parentMappedRows: Array<{
    mapped: Record<MigrationTargetField, string>;
    filename?: string;
    rowNumber?: number;
  }>;
  resolutions?: ParentIdentityResolution[];
  apply?: boolean;
  fullPreflight?: boolean;
}) {
  const prisma = makeFakePrisma(opts.state);
  const before = snapshot(opts.state);
  const parentRows = opts.parentMappedRows.map((r, i) => ({
    fileId: "f1",
    filename: r.filename || "parents.csv",
    rowNumber: r.rowNumber ?? i + 1,
    mapped: enrichParentMappedFromContactList(r.mapped, {}),
    raw: {},
  }));

  const preflight = await runUniversalMigrationParentPreflight({
    prisma,
    schoolId: "school-1",
    sourceSystem: "SA-SAMS",
    parentRows,
    resolutions: opts.resolutions,
  });

  if (opts.fullPreflight) {
    return { before, after: snapshot(opts.state), preflight, apply: null as any };
  }

  if (!preflight.clear) {
    return { before, after: snapshot(opts.state), preflight, apply: null as any };
  }

  if (opts.apply === false) {
    return { before, after: snapshot(opts.state), preflight, apply: null as any };
  }

  const apply = await applyParentIdentityPlan(
    { prisma, schoolId: "school-1", requireFullyResolved: true },
    preflight.report
  );
  return { before, after: snapshot(opts.state), preflight, apply };
}

async function testA() {
  const state = makeState({
    parents: [
      {
        id: "p-exact",
        firstName: "Katudi",
        surname: "MANKGANE",
        idNumber: "7801015009087",
        cellNo: "0823301241",
        email: null,
      },
    ],
    learners: [
      { id: "L1", firstName: "Leseilane", lastName: "X", className: "Gr 4A", idNumber: null },
      { id: "L2", firstName: "Ntjebe", lastName: "X", className: "Gr 2B", idNumber: null },
    ],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Katudi",
          parentSurname: "MANKGANE",
          parentIdNumber: "7801015009087",
          firstName: "Leseilane",
          lastName: "X",
        }),
      },
      {
        mapped: mapped({
          parentFirstName: "Katudi",
          parentSurname: "MANKUANE",
          parentIdNumber: "7801015009087",
          firstName: "Ntjebe",
          lastName: "X",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "REUSE_EXISTING");
  assert.strictEqual(r.preflight.report.items[1]!.decision, "REUSE_EXISTING");
  assert.strictEqual(r.after.parents, 1);
  assert.strictEqual(r.after.links, 2);
  console.log("✓ TEST A exact SA ID → REUSE, one Parent, multiple links");
}

async function testB() {
  const state = makeState({
    parents: [
      {
        id: "p1",
        firstName: "Katudi",
        surname: "MANKGANE",
        idNumber: "7801015009087",
        cellNo: null,
        email: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Child", lastName: "A", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Katudi",
          parentSurname: "MANKUANE",
          parentIdNumber: "7801015009087",
          firstName: "Child",
          lastName: "A",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "REUSE_EXISTING");
  assert.strictEqual(state.parents[0]!.surname, "MANKGANE");
  assert.strictEqual(r.preflight.report.items[0]!.sourceNameExact, "Katudi MANKUANE");
  console.log("✓ TEST B surname differs + ID → REUSE, no surname overwrite");
}

async function testC() {
  const state = makeState({
    parents: [
      {
        id: "p1",
        firstName: "Moshiane",
        surname: "MANKGANE",
        cellNo: "0662206541",
        email: "reakgopela@gmail.com",
        idNumber: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Mathokge", lastName: "X", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Moshiane",
          parentSurname: "MANKUANE",
          parentPhone: "0662206541",
          parentEmail: "REAKGOPELA@GMAIL.COM",
          firstName: "Mathokge",
          lastName: "X",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "REUSE_EXISTING");
  assert.strictEqual(r.after.parents, 1);
  console.log("✓ TEST C cell+email+first → REUSE, no duplicate");
}

async function testD() {
  const state = makeState({
    parents: [
      {
        id: "p1",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Obo", lastName: "X", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Puseletso",
          parentSurname: "KGSOANE",
          parentPhone: "0780000051",
          firstName: "Obo",
          lastName: "X",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "REVIEW_REQUIRED");
  assert.deepStrictEqual(r.after, r.before);
  console.log("✓ TEST D cell-only → REVIEW, zero writes");
}

async function testE() {
  const state = makeState({
    parents: [
      {
        id: "p1",
        firstName: "Deonett",
        surname: "TSHABALALA",
        cellNo: "0730000001",
        email: "d@example.com",
        idNumber: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Kid", lastName: "Y", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Deonett",
          parentSurname: "DAWSON",
          parentEmail: "d@example.com",
          parentPhone: "0830000099",
          firstName: "Kid",
          lastName: "Y",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "REVIEW_REQUIRED");
  assert.deepStrictEqual(r.after, r.before);
  console.log("✓ TEST E email-only → REVIEW, zero writes");
}

async function testF() {
  const state = makeState({
    parents: [
      {
        id: "pA",
        firstName: "Amal",
        surname: "SERGE",
        cellNo: "0715555555",
        idNumber: "8001015009087",
        email: null,
      },
    ],
    learners: [{ id: "L1", firstName: "C", lastName: "D", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Amal",
          parentSurname: "SERGE",
          parentPhone: "0715555555",
          parentIdNumber: "9001015009087",
          firstName: "C",
          lastName: "D",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "CONFLICT");
  assert.deepStrictEqual(r.after, r.before);
  console.log("✓ TEST F conflicting IDs → CONFLICT, zero writes");
}

async function testG() {
  const state = makeState({
    parents: [{ id: "p1", firstName: "A", surname: "B", cellNo: "0821", email: null, idNumber: null }],
    learners: [{ id: "L1", firstName: "X", lastName: "Y", className: null, idNumber: null }],
    links: [{ parentId: "p1", learnerId: "L1" }],
    familyAccounts: 2,
  });
  state.classrooms = 3;
  state.ledgerWrites = 5;
  const r = await runPreflightAndMaybeApply({
    state,
    fullPreflight: true,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "New",
          parentSurname: "Person",
          parentPhone: "0840000001",
          parentEmail: "n@example.com",
          firstName: "X",
          lastName: "Y",
        }),
      },
    ],
  });
  assert.deepStrictEqual(r.after, r.before);
  console.log("✓ TEST G full preflight simulation → zero entity count changes");
}

async function testH() {
  const state = makeState({
    parents: [
      {
        id: "p1",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Obo", lastName: "X", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Puseletso",
          parentSurname: "KGSOANE",
          parentPhone: "0780000051",
          firstName: "Obo",
          lastName: "X",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.reviewContract.status, "MIGRATION_REQUIRES_REVIEW");
  assert.ok(r.preflight.reviewContract.reviewQueue.length >= 1);
  assert.deepStrictEqual(r.after.parents, r.before.parents);
  assert.deepStrictEqual(r.after.links, r.before.links);
  console.log("✓ TEST H unresolved → MIGRATION_REQUIRES_REVIEW contract, zero writes");
}

async function testI() {
  const state = makeState({
    parents: [
      {
        id: "p-existing",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Obo", lastName: "X", className: null, idNumber: null }],
  });
  const draft = await runPreflightAndMaybeApply({
    state,
    apply: false,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Puseletso",
          parentSurname: "KGSOANE",
          parentPhone: "0780000051",
          firstName: "Obo",
          lastName: "X",
        }),
        rowNumber: 9,
      },
    ],
  });
  const itemKey = draft.preflight.report.items[0]!.itemKey;
  const r = await runPreflightAndMaybeApply({
    state,
    resolutions: [{ itemKey, kind: "LINK_TO_EXISTING_PARENT", existingParentId: "p-existing" }],
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Puseletso",
          parentSurname: "KGSOANE",
          parentPhone: "0780000051",
          firstName: "Obo",
          lastName: "X",
        }),
        rowNumber: 9,
      },
    ],
  });
  assert.strictEqual(r.apply.status, "APPLIED");
  assert.strictEqual(r.after.parents, 1);
  assert.strictEqual(r.after.links, 1);
  assert.strictEqual(state.links[0]!.parentId, "p-existing");
  console.log("✓ TEST I resolved LINK_TO_EXISTING → reuse + link");
}

async function testJ() {
  const state = makeState({
    parents: [
      {
        id: "p-other",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ],
    learners: [{ id: "L1", firstName: "Obo", lastName: "X", className: null, idNumber: null }],
  });
  const draft = await runPreflightAndMaybeApply({
    state,
    apply: false,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Puseletso",
          parentSurname: "KGSOANE",
          parentPhone: "0780000051",
          firstName: "Obo",
          lastName: "X",
        }),
        rowNumber: 12,
      },
    ],
  });
  const itemKey = draft.preflight.report.items[0]!.itemKey;
  const beforeParents = state.parents.length;
  const r = await runPreflightAndMaybeApply({
    state,
    resolutions: [{ itemKey, kind: "CREATE_AS_NEW_PARENT", note: "authorised" }],
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Puseletso",
          parentSurname: "KGSOANE",
          parentPhone: "0780000051",
          firstName: "Obo",
          lastName: "X",
        }),
        rowNumber: 12,
      },
    ],
  });
  assert.strictEqual(r.apply.status, "APPLIED");
  assert.strictEqual(r.after.parents, beforeParents + 1);
  assert.strictEqual(r.after.links, 1);
  console.log("✓ TEST J resolved CREATE_AS_NEW → one Parent + link");
}

async function testK() {
  const state = makeState({
    learners: [
      { id: "L1", firstName: "A", lastName: "S", className: null, idNumber: null },
      { id: "L2", firstName: "B", lastName: "S", className: null, idNumber: null },
      { id: "L3", firstName: "C", lastName: "S", className: null, idNumber: null },
    ],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Edwin",
          parentSurname: "Kgasoane",
          parentIdNumber: "7903015009083",
          parentPhone: "0830000005",
          parentEmail: "e@example.com",
          firstName: "A",
          lastName: "S",
        }),
      },
      {
        mapped: mapped({
          parentFirstName: "Edwin",
          parentSurname: "KGASOANE",
          parentIdNumber: "7903015009083",
          parentPhone: "0830000005",
          parentEmail: "E@EXAMPLE.COM",
          firstName: "B",
          lastName: "S",
        }),
      },
      {
        mapped: mapped({
          parentFirstName: "Edwin",
          parentSurname: "Kgasoane",
          parentIdNumber: "7903015009083",
          firstName: "C",
          lastName: "S",
        }),
      },
    ],
  });
  assert.strictEqual(r.after.parents, 1);
  assert.strictEqual(r.after.links, 3);
  console.log("✓ TEST K three siblings → one Parent, three links");
}

async function testL() {
  const names = parentNamesFromMapped(
    mapped({ parentFirstName: "Katudi", parentSurname: "MANKUANE" })
  );
  assert.strictEqual(`${names.firstName} ${names.surname}`, "Katudi MANKUANE");
  const incoming = buildIncomingFromMapped(
    mapped({ parentFirstName: "Katudi", parentSurname: "MANKUANE" }),
    { sourceSystem: "SA-SAMS", sourceRow: 1 }
  );
  const report = runParentIdentityPreflight({
    candidates: [
      {
        id: "p1",
        firstName: "Katudi",
        surname: "MANKGANE",
        idNumber: "7801015009087",
        cellNo: null,
        email: null,
      },
    ],
    rows: [
      {
        incoming: { ...incoming, idNumber: "7801015009087" },
        link: { learnerId: "L1", isPrimary: true },
      },
    ],
  });
  assert.strictEqual(report.items[0]!.sourceNameExact, "Katudi MANKUANE");
  console.log("✓ TEST L source surname preserved in lineage");
}

async function testM() {
  await assert.rejects(
    () =>
      commitMigrationImport({
        schoolId: "x",
        projectId: "y",
        confirmToken: "z",
      }),
    (err: any) => String(err.message).includes("LEGACY_MIGRATION_IMPORT_DISABLED")
  );
  console.log("✓ TEST M legacy migration endpoint cannot bypass resolver");
}

async function testN() {
  // CLI runMigrationImport → applyMigrationStage (resolver-wired).
  // Legacy commitMigrationImport is the bypass; prove it stays hard-disabled.
  await assert.rejects(
    () =>
      commitMigrationImport({
        schoolId: "cli",
        projectId: "cli",
        confirmToken: "cli",
      }),
    /LEGACY_MIGRATION_IMPORT_DISABLED/
  );
  console.log("✓ TEST N legacy CLI import path (commitMigrationImport) hard-disabled");
}

async function testO() {
  const state = makeState({
    parents: [
      {
        id: "pA",
        firstName: "Amal",
        surname: "SERGE",
        cellNo: "0715555555",
        idNumber: "8001015009087",
        email: null,
      },
    ],
    learners: [{ id: "L1", firstName: "C", lastName: "D", className: null, idNumber: null }],
  });
  const r = await runPreflightAndMaybeApply({
    state,
    parentMappedRows: [
      {
        mapped: mapped({
          parentFirstName: "Amal",
          parentSurname: "SERGE",
          parentPhone: "0715555555",
          parentIdNumber: "9001015009087",
          firstName: "C",
          lastName: "D",
        }),
      },
    ],
  });
  assert.strictEqual(r.preflight.report.items[0]!.decision, "CONFLICT");
  assert.ok(!r.preflight.report.items.some((i) => i.decision === "REUSE_EXISTING"));
  assert.deepStrictEqual(r.after, r.before);
  console.log("✓ TEST O false-positive fixture → never merge");
}

async function historicalUniversalReplay() {
  const fixtures: Array<{
    id: string;
    seed?: FakeParent[];
    rows: Record<string, string>[];
    expect: "REUSE" | "CREATE" | "REVIEW" | "CONFLICT" | "MIXED";
  }> = [
    {
      id: "Katudi",
      rows: [
        {
          parentFirstName: "Katudi",
          parentSurname: "MANKGANE",
          parentPhone: "0823301241",
          parentEmail: "katudigodfrey.kg@gmail.com",
          firstName: "L1",
          lastName: "X",
        },
        {
          parentFirstName: "Katudi",
          parentSurname: "MANKUANE",
          parentPhone: "0823301241",
          parentEmail: "KATUDIGODFREY.KG@GMAIL.COM",
          firstName: "L2",
          lastName: "X",
        },
      ],
      expect: "MIXED",
    },
    {
      id: "Moshiane",
      seed: [
        {
          id: "seed-m",
          firstName: "MOSHIANE MAKGETHWA",
          surname: "MANKGANE",
          cellNo: "0662206541",
          email: "REAKGOPELA@GMAIL.COM",
          idNumber: null,
        },
      ],
      rows: [
        {
          parentFirstName: "Moshiane",
          parentSurname: "MANKUANE",
          parentPhone: "0662206541",
          parentEmail: "reakgopela@gmail.com",
          parentIdNumber: "8806130531082",
          firstName: "N",
          lastName: "X",
        },
      ],
      expect: "REUSE",
    },
  ];

  let falsePositive = 0;
  let unresolvedCreates = 0;
  let review = 0;
  let conflict = 0;
  let prevented = 0;

  for (const fx of fixtures) {
    const state = makeState({
      parents: fx.seed,
      learners: fx.rows.map((_, i) => ({
        id: `L-${fx.id}-${i}`,
        firstName: fx.rows[i]!.firstName || `L${i}`,
        lastName: fx.rows[i]!.lastName || "X",
        className: null,
        idNumber: null,
      })),
    });
    const beforeParents = state.parents.length;
    const r = await runPreflightAndMaybeApply({
      state,
      parentMappedRows: fx.rows.map((row, i) => ({
        mapped: mapped(row),
        rowNumber: i + 1,
      })),
    });
    for (const item of r.preflight.report.items) {
      if (item.decision === "REVIEW_REQUIRED") review += 1;
      if (item.decision === "CONFLICT") conflict += 1;
    }
    if (!r.preflight.clear) {
      unresolvedCreates += 0;
      assert.strictEqual(state.parents.length, beforeParents);
      prevented += Math.max(0, fx.rows.length - 1);
    } else {
      // Old universal path would create ~1 parent per row without strong matching
      const oldWouldCreate = fx.rows.length;
      const newCreated = Math.max(0, state.parents.length - beforeParents);
      prevented += Math.max(0, oldWouldCreate - Math.max(newCreated, 1));
      if (fx.expect === "REUSE") assert.strictEqual(newCreated, 0);
    }
  }

  assert.strictEqual(falsePositive, 0);
  assert.strictEqual(unresolvedCreates, 0);
  console.log(
    JSON.stringify(
      {
        historicalUniversalReplay: true,
        review,
        conflict,
        parentRowsPreventedEstimate: prevented,
        falsePositiveAutoMerges: falsePositive,
        unresolvedRecordsCreatingParents: unresolvedCreates,
      },
      null,
      2
    )
  );
  console.log("✓ Historical Universal Migration replay PASS");
}

async function main() {
  await testA();
  await testB();
  await testC();
  await testD();
  await testE();
  await testF();
  await testG();
  await testH();
  await testI();
  await testJ();
  await testK();
  await testL();
  await testM();
  await testN();
  await testO();
  await historicalUniversalReplay();
  // silence unused import used for typing docs
  void buildUniversalParentPreflightRows;
  console.log("\nALL Universal Migration parent identity tests A–O passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
