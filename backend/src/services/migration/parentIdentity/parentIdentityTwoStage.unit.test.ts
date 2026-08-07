/**
 * Two-stage parent identity — REVIEW/CONFLICT must write ZERO parents/links.
 * Run: npx ts-node --transpile-only src/services/migration/parentIdentity/parentIdentityTwoStage.unit.test.ts
 */
import assert from "assert";
import {
  applyParentIdentityPlan,
  isParentIdentityPreflightClear,
  runParentIdentityPreflight,
  type ExistingParentCandidate,
  type ParentIdentityResolution,
} from "./index";

type FakeParent = ExistingParentCandidate;
type FakeLink = { parentId: string; learnerId: string };

function makeFakePrisma(state: {
  parents: FakeParent[];
  links: FakeLink[];
  learners: number;
  familyAccounts: number;
}) {
  let idSeq = 1000;
  return {
    parent: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.parents.find((p) => p.id === where.id) || null,
      create: async ({ data }: { data: any }) => {
        const id = `created-${++idSeq}`;
        const row: FakeParent = {
          id,
          firstName: data.firstName,
          surname: data.surname,
          idNumber: data.idNumber ?? null,
          cellNo: data.cellNo ?? null,
          email: data.email ?? null,
          familyAccountId: data.familyAccountId ?? null,
        };
        state.parents.push(row);
        return { id };
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const p = state.parents.find((x) => x.id === where.id);
        if (!p) throw new Error("missing");
        Object.assign(p, data);
        return p;
      },
    },
    parentLearnerLink: {
      upsert: async ({
        where,
      }: {
        where: { parentId_learnerId: { parentId: string; learnerId: string } };
        create: any;
      }) => {
        const { parentId, learnerId } = where.parentId_learnerId;
        const existing = state.links.find(
          (l) => l.parentId === parentId && l.learnerId === learnerId
        );
        if (!existing) state.links.push({ parentId, learnerId });
        return { id: `link-${parentId}-${learnerId}` };
      },
    },
  } as any;
}

function snapshot(state: {
  parents: FakeParent[];
  links: FakeLink[];
  learners: number;
  familyAccounts: number;
}) {
  return {
    parents: state.parents.length,
    links: state.links.length,
    learners: state.learners,
    familyAccounts: state.familyAccounts,
    parentIds: state.parents.map((p) => p.id).sort(),
  };
}

async function awaitableApply(
  state: {
    parents: FakeParent[];
    links: FakeLink[];
    learners: number;
    familyAccounts: number;
  },
  report: ReturnType<typeof runParentIdentityPreflight>
) {
  return applyParentIdentityPlan(
    { prisma: makeFakePrisma(state), schoolId: "school-1", requireFullyResolved: true },
    report
  );
}

async function test13ReviewCreatesZeroParents() {
  const state = {
    parents: [
      {
        id: "p1",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ] as FakeParent[],
    links: [] as FakeLink[],
    learners: 3,
    familyAccounts: 2,
  };
  const before = snapshot(state);
  const report = runParentIdentityPreflight({
    candidates: state.parents,
    rows: [
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Puseletso",
          surname: "KGSOANE",
          cellNo: "0780000051",
          email: null,
          idNumber: null,
          learnerLabel: "Child",
        },
        link: { learnerId: "L1", relation: "Guardian", isPrimary: true },
      },
    ],
  });
  assert.strictEqual(report.items[0]!.decision, "REVIEW_REQUIRED");
  assert.ok(!isParentIdentityPreflightClear(report));
  assert.strictEqual(report.status, "MIGRATION_REQUIRES_REVIEW");

  const result = await awaitableApply(state, report);
  assert.strictEqual(result.status, "BLOCKED_REQUIRES_REVIEW");
  assert.strictEqual(result.parentsCreated, 0);
  assert.strictEqual(result.linksUpserted, 0);
  assert.strictEqual(result.unresolvedCreatedParents, 0);
  assert.deepStrictEqual(snapshot(state), before);
  console.log("✓ TEST 13 REVIEW_REQUIRED → zero Parent/link writes");
}

async function test14ConflictCreatesZeroParents() {
  const state = {
    parents: [
      {
        id: "pA",
        firstName: "Amal",
        surname: "SERGE",
        cellNo: "0710000001",
        idNumber: "8001015009087",
        email: null,
      },
    ] as FakeParent[],
    links: [] as FakeLink[],
    learners: 1,
    familyAccounts: 1,
  };
  const before = snapshot(state);
  const report = runParentIdentityPreflight({
    candidates: state.parents,
    rows: [
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Amal",
          surname: "SERGE",
          cellNo: "0710000001",
          idNumber: "9001015009087",
        },
        link: { learnerId: "L1", isPrimary: true },
      },
    ],
  });
  assert.strictEqual(report.items[0]!.decision, "CONFLICT");
  const result = await awaitableApply(state, report);
  assert.strictEqual(result.status, "BLOCKED_REQUIRES_REVIEW");
  assert.strictEqual(result.parentsCreated, 0);
  assert.strictEqual(result.linksUpserted, 0);
  assert.deepStrictEqual(snapshot(state), before);
  console.log("✓ TEST 14 CONFLICT → zero Parent/link writes");
}

async function test15PreflightZeroWrites() {
  const state = {
    parents: [
      {
        id: "seed",
        firstName: "Melita",
        surname: "Dikgale",
        cellNo: "0821234565",
        email: "m@example.com",
        idNumber: "9905015009086",
      },
    ] as FakeParent[],
    links: [{ parentId: "seed", learnerId: "Lx" }] as FakeLink[],
    learners: 5,
    familyAccounts: 4,
  };
  const before = snapshot(state);
  const report = runParentIdentityPreflight({
    candidates: [...state.parents],
    rows: [
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Melita",
          surname: "DIKGALE",
          cellNo: "0821234565",
          email: "m@example.com",
        },
        link: { learnerId: "L2", isPrimary: true },
      },
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Mystery",
          surname: "Person",
          cellNo: "0821234565",
        },
        link: { learnerId: "L3", isPrimary: true },
      },
    ],
  });
  assert.ok(report.counts.readyToReuse >= 1);
  assert.ok(report.counts.reviewRequired >= 1);
  assert.deepStrictEqual(snapshot(state), before);
  console.log("✓ TEST 15 preflight has zero writes");
}

async function test16ApplyOnlyWhenFullyResolved() {
  const state = {
    parents: [
      {
        id: "p1",
        firstName: "Edwin",
        surname: "Kgasoane",
        cellNo: "0830000005",
        email: "e@example.com",
        idNumber: "7903015009083",
      },
    ] as FakeParent[],
    links: [] as FakeLink[],
    learners: 2,
    familyAccounts: 1,
  };
  const before = snapshot(state);
  const report = runParentIdentityPreflight({
    candidates: state.parents,
    rows: [
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Edwin",
          surname: "KGASOANE",
          cellNo: "0830000005",
          email: "e@example.com",
          idNumber: "7903015009083",
        },
        link: { learnerId: "L1", isPrimary: true },
      },
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Brand",
          surname: "New",
          cellNo: "0840000099",
          email: "new@example.com",
        },
        link: { learnerId: "L2", isPrimary: true },
      },
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Ambiguous",
          surname: "One",
          cellNo: "0830000005",
        },
        link: { learnerId: "L3", isPrimary: true },
      },
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Edwin",
          surname: "Kgasoane",
          cellNo: "0830000005",
          idNumber: "8001015009087",
        },
        link: { learnerId: "L4", isPrimary: true },
      },
    ],
  });
  assert.ok(report.counts.readyToReuse >= 1);
  assert.ok(report.counts.readyToCreate >= 1);
  assert.ok(report.counts.reviewRequired >= 1);
  assert.ok(report.counts.conflicts >= 1);
  assert.strictEqual(report.status, "MIGRATION_REQUIRES_REVIEW");

  const result = await awaitableApply(state, report);
  assert.strictEqual(result.status, "BLOCKED_REQUIRES_REVIEW");
  assert.strictEqual(result.parentsCreated, 0);
  assert.strictEqual(result.linksUpserted, 0);
  assert.deepStrictEqual(snapshot(state).parents, before.parents);
  assert.deepStrictEqual(snapshot(state).links, before.links);
  console.log("✓ TEST 16 atomic apply blocked while REVIEW/CONFLICT remain");
}

async function test17ResolvedReviewReusesExisting() {
  const state = {
    parents: [
      {
        id: "p-existing",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ] as FakeParent[],
    links: [] as FakeLink[],
    learners: 1,
    familyAccounts: 1,
  };
  const draft = runParentIdentityPreflight({
    candidates: state.parents,
    rows: [
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Puseletso",
          surname: "KGSOANE",
          cellNo: "0780000051",
          sourceRow: 9,
          learnerLabel: "Obo",
        },
        link: { learnerId: "L1", isPrimary: true, cellNoForStorage: "0780000051" },
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
    candidates: state.parents,
    rows: [
      {
        incoming: draft.items[0]!.incoming,
        link: draft.items[0]!.link,
      },
    ],
    resolutions,
  });
  assert.strictEqual(resolved.items[0]!.decision, "REUSE_EXISTING");
  assert.ok(isParentIdentityPreflightClear(resolved));
  const result = await awaitableApply(state, resolved);
  assert.strictEqual(result.status, "APPLIED");
  assert.strictEqual(result.parentsCreated, 0);
  assert.strictEqual(result.parentsReused, 1);
  assert.strictEqual(state.parents.length, 1);
  assert.strictEqual(state.links.length, 1);
  assert.strictEqual(state.links[0]!.parentId, "p-existing");
  // Source spelling preserved in plan
  assert.strictEqual(resolved.items[0]!.sourceNameExact, "Puseletso KGSOANE");
  assert.strictEqual(state.parents[0]!.surname, "Kgasoane");
  console.log("✓ TEST 17 resolved REVIEW → LINK_TO_EXISTING (no new Parent)");
}

async function test18ResolvedReviewCreateNew() {
  const state = {
    parents: [
      {
        id: "p-other",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0780000051",
        email: null,
        idNumber: null,
      },
    ] as FakeParent[],
    links: [] as FakeLink[],
    learners: 1,
    familyAccounts: 1,
  };
  const draft2 = runParentIdentityPreflight({
    candidates: state.parents,
    rows: [
      {
        incoming: {
          sourceSystem: "SA-SAMS",
          firstName: "Puseletso",
          surname: "KGSOANE",
          cellNo: "0780000051",
          sourceRow: 12,
        },
        link: { learnerId: "L1", isPrimary: true, cellNoForStorage: "0780000051" },
      },
    ],
  });
  assert.strictEqual(draft2.items[0]!.decision, "REVIEW_REQUIRED");
  const resolutions: ParentIdentityResolution[] = [
    {
      itemKey: draft2.items[0]!.itemKey,
      kind: "CREATE_AS_NEW_PARENT",
      note: "Owner confirmed different people",
    },
  ];
  const resolved = runParentIdentityPreflight({
    candidates: state.parents,
    rows: [
      {
        incoming: draft2.items[0]!.incoming,
        link: draft2.items[0]!.link,
        cellNoForStorage: "0780000051",
      },
    ],
    resolutions,
  });
  assert.strictEqual(resolved.items[0]!.decision, "CREATE_NEW");
  assert.strictEqual(resolved.items[0]!.resolution?.kind, "CREATE_AS_NEW_PARENT");
  const beforeParents = state.parents.length;
  const result = await awaitableApply(state, resolved);
  assert.strictEqual(result.status, "APPLIED");
  assert.strictEqual(result.parentsCreated, 1);
  assert.strictEqual(state.parents.length, beforeParents + 1);
  assert.strictEqual(state.links.length, 1);
  console.log("✓ TEST 18 resolved REVIEW → CREATE_AS_NEW_PARENT");
}

async function main() {
  await test13ReviewCreatesZeroParents();
  await test14ConflictCreatesZeroParents();
  await test15PreflightZeroWrites();
  await test16ApplyOnlyWhenFullyResolved();
  await test17ResolvedReviewReusesExisting();
  await test18ResolvedReviewCreateNew();
  console.log("\nALL two-stage parent identity tests (13–18) passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
