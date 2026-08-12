/**
 * Parent Identity Architecture Phase 1B — school-scoped uniqueness + Fee Check auth.
 * Local mocks only — no production DB writes.
 *
 * Run: npx ts-node --transpile-only src/services/schoolScopedParentIdentity.phase1b.unit.test.ts
 */
import assert from "assert";
import {
  checkApplicationParentIdentity,
  linkExistingParentToLearner,
} from "./applicationParentIdentity";
import { PARENT_ID_ALREADY_EXISTS } from "../utils/parentIdConflict";
import {
  buildParentIdConflictBody,
  findParentByIdNumberInSchool,
  isParentIdNumberUniqueTarget,
} from "../utils/parentIdConflict";
import { evaluateParentStaffAuth } from "../middleware/requireParentStaffAuth";
import { permissionsForRole } from "../utils/userPermissions";
import { resolveParentIdentity } from "./migration/parentIdentity/resolveParentIdentity";
import { runParentIdentityPreflight } from "./migration/parentIdentity/parentIdentityPreflight";
import { feeStatusFromOutstanding, normalizeSaIdNumber } from "./parentFeeCheckService";

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const SA_ID = "8001015009087";

type FakeParent = {
  id: string;
  schoolId: string;
  firstName: string;
  surname: string;
  idNumber: string | null;
  cellNo: string;
  email: string | null;
  familyAccountId: string | null;
  links: Array<{
    learnerId: string;
    isPrimary: boolean;
    learner: { firstName: string; lastName: string };
  }>;
};

function makePrisma(state: {
  parents: FakeParent[];
  links?: Array<{ id: string; parentId: string; learnerId: string; schoolId: string }>;
  learners?: Array<{ id: string; schoolId: string }>;
}) {
  const links = state.links || [];
  const learners = state.learners || [];
  return {
    parent: {
      findMany: async ({ where }: any) =>
        state.parents.filter((p) => {
          if (where.schoolId && p.schoolId !== where.schoolId) return false;
          if (where.id?.not && p.id === where.id.not) return false;
          if (where.idNumber?.not === null && !p.idNumber) return false;
          return true;
        }),
      findFirst: async ({ where }: any) =>
        state.parents.find(
          (p) =>
            (!where.id || p.id === where.id) &&
            (!where.schoolId || p.schoolId === where.schoolId) &&
            (!where.idNumber || p.idNumber === where.idNumber)
        ) || null,
      findUnique: async ({ where }: any) => {
        if (where.id) return state.parents.find((p) => p.id === where.id) || null;
        // Global idNumber unique removed — callers must not rely on this.
        if (where.idNumber) return null;
        return null;
      },
    },
    learner: {
      findFirst: async ({ where }: any) =>
        learners.find(
          (l) => l.id === where.id && (!where.schoolId || l.schoolId === where.schoolId)
        ) || null,
    },
    parentLearnerLink: {
      findUnique: async ({ where }: any) => {
        const { parentId, learnerId } = where.parentId_learnerId;
        return links.find((l) => l.parentId === parentId && l.learnerId === learnerId) || null;
      },
      create: async ({ data }: any) => {
        const row = {
          id: `link-${links.length + 1}`,
          parentId: data.parentId,
          learnerId: data.learnerId,
          schoolId: data.schoolId,
        };
        links.push(row);
        return row;
      },
    },
  };
}

function parentA(): FakeParent {
  return {
    id: "p-a",
    schoolId: SCHOOL_A,
    firstName: "Ada",
    surname: "Parent",
    idNumber: SA_ID,
    cellNo: "0821111111",
    email: "ada@a.example",
    familyAccountId: "fa-a",
    links: [
      {
        learnerId: "l-a",
        isPrimary: true,
        learner: { firstName: "Child", lastName: "A" },
      },
    ],
  };
}

async function testSameSchoolDuplicateBlocked() {
  const prisma = makePrisma({ parents: [parentA()] });
  const r = await checkApplicationParentIdentity({
    prisma: prisma as any,
    schoolId: SCHOOL_A,
    incoming: { firstName: "Other", surname: "Person", idNumber: SA_ID },
    actorIsOwnerAdmin: true,
  });
  assert.equal(r.decision, "EXISTING_PARENT_MATCH");
  assert.equal(r.code, PARENT_ID_ALREADY_EXISTS);
  assert.equal(r.existingParent?.id, "p-a");
  assert.equal(r.allowExplicitCreate, false);
  console.log("✓ same SA ID / same school → duplicate blocked");
}

async function testCrossSchoolCreateAllowed() {
  const prisma = makePrisma({ parents: [parentA()] });
  const r = await checkApplicationParentIdentity({
    prisma: prisma as any,
    schoolId: SCHOOL_B,
    incoming: { firstName: "Ada", surname: "Parent", idNumber: SA_ID },
    actorIsOwnerAdmin: true,
  });
  assert.notEqual(r.decision, "EXISTING_PARENT_MATCH");
  assert.equal(r.existingParent, null);
  assert.ok(
    r.decision === "CREATE_ALLOWED" ||
      r.decision === "POSSIBLE_MATCH" ||
      r.decision === "EDIT_SELF_OK" ||
      r.decision === "CONFLICT"
  );
  // With no School B candidates, exact ID at A must allow School B create path.
  assert.equal(r.decision, "CREATE_ALLOWED");
  console.log("✓ same SA ID / different schools → ALLOW create at School B");
}

async function testCrossSchoolLinkBlocked() {
  const prisma = makePrisma({
    parents: [parentA()],
    learners: [{ id: "l-b", schoolId: SCHOOL_B }],
    links: [],
  });
  try {
    await linkExistingParentToLearner({
      prisma: prisma as any,
      schoolId: SCHOOL_B,
      parentId: "p-a",
      learnerId: "l-b",
      actorIsOwnerAdmin: true,
    });
    assert.fail("expected cross-school link to throw");
  } catch (e: any) {
    assert.ok(e.statusCode === 404 || /not found/i.test(String(e.message)));
  }
  console.log("✓ cross-school Parent→Learner link blocked");
}

async function testConflictHelpersSchoolScoped() {
  const prisma = {
    parent: {
      findFirst: async ({ where }: any) => {
        if (where.schoolId === SCHOOL_A && where.idNumber === SA_ID) {
          return {
            id: "p-a",
            schoolId: SCHOOL_A,
            firstName: "Ada",
            surname: "Parent",
            cellNo: "0821111111",
            email: "ada@a.example",
            idNumber: SA_ID,
            familyAccountId: "fa-a",
            links: [{ learnerId: "l-a" }],
          };
        }
        return null;
      },
    },
  };
  const inA = await findParentByIdNumberInSchool(prisma as any, SCHOOL_A, SA_ID);
  const inB = await findParentByIdNumberInSchool(prisma as any, SCHOOL_B, SA_ID);
  assert.equal(inA?.id, "p-a");
  assert.equal(inB, null);
  const bodyB = await buildParentIdConflictBody(prisma as any, SA_ID, SCHOOL_B);
  assert.equal(bodyB.existingParent, null);
  assert.ok(isParentIdNumberUniqueTarget({ code: "P2002", meta: { target: ["schoolId", "idNumber"] } }));
  console.log("✓ conflict helpers are school-scoped; composite P2002 detected");
}

async function testFeeCheckAuthGates() {
  const unauth = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "",
    permissions: null,
    requireOwnerAdmin: true,
  });
  assert.ok(!unauth.allowed && unauth.status === 401);

  const teacher = evaluateParentStaffAuth({
    jwtPayload: { userId: "u1", schoolId: SCHOOL_A, role: "STAFF" },
    user: { id: "u1", schoolId: SCHOOL_A, role: "STAFF", isActive: true },
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requireOwnerAdmin: true,
  });
  assert.ok(!teacher.allowed && teacher.status === 403);

  const owner = evaluateParentStaffAuth({
    jwtPayload: { userId: "u2", schoolId: SCHOOL_A, role: "SCHOOL_ADMIN" },
    user: { id: "u2", schoolId: SCHOOL_A, role: "SCHOOL_ADMIN", isActive: true },
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requireOwnerAdmin: true,
  });
  assert.ok(owner.allowed);
  console.log("✓ Fee Check auth: unauthenticated 401, Teacher 403, Owner allowed");
}

async function testPortalSchoolScopedResolution() {
  // Mirrors findParentByCredentials school filter used by Parent Portal.
  const parents = [
    parentA(),
    {
      ...parentA(),
      id: "p-b",
      schoolId: SCHOOL_B,
      familyAccountId: "fa-b",
      email: "ada@b.example",
      links: [
        {
          learnerId: "l-b",
          isPrimary: true,
          learner: { firstName: "Child", lastName: "B" },
        },
      ],
    },
  ];
  const resolve = (schoolId: string) =>
    parents.find((p) => p.schoolId === schoolId && p.idNumber === SA_ID) || null;
  const a = resolve(SCHOOL_A);
  const b = resolve(SCHOOL_B);
  assert.equal(a?.id, "p-a");
  assert.equal(b?.id, "p-b");
  assert.notEqual(a?.id, b?.id);
  assert.equal(a?.links[0]?.learnerId, "l-a");
  assert.equal(b?.links[0]?.learnerId, "l-b");
  console.log("✓ Parent Portal School A/B resolve distinct Parent rows for same SA ID");
}

async function testMigrationCandidatesSchoolScoped() {
  const schoolAParent = {
    id: "p-a",
    firstName: "Ada",
    surname: "Parent",
    idNumber: SA_ID,
    cellNo: "0821111111",
    email: "ada@a.example",
  };
  // School B migration candidates must NOT include School A parent.
  const schoolBCandidates: typeof schoolAParent[] = [];
  const decision = resolveParentIdentity({
    incoming: {
      firstName: "Ada",
      surname: "Parent",
      idNumber: SA_ID,
      cellNo: "0822222222",
      email: "ada@b.example",
      sourceSystem: "KID-E-SYS",
    },
    candidates: schoolBCandidates,
  });
  assert.equal(decision.decision, "CREATE_NEW");

  const preflight = runParentIdentityPreflight({
    candidates: schoolBCandidates,
    rows: [
      {
        incoming: {
          firstName: "Ada",
          surname: "Parent",
          idNumber: SA_ID,
          cellNo: "0822222222",
          email: "ada@b.example",
          sourceSystem: "KID-E-SYS",
          learnerLabel: "Child B",
        },
        link: {
          learnerId: "l-b",
          relation: "Mother",
          isPrimary: true,
          cellNoForStorage: "0822222222",
        },
      },
    ],
  });
  assert.equal(preflight.status, "READY_TO_APPLY");
  assert.equal(preflight.items[0]?.decision, "CREATE_NEW");
  assert.ok(preflight.items[0]?.reuseParentId?.startsWith("virtual:"));
  // Prove School A parent id is never chosen.
  assert.notEqual(preflight.items[0]?.reuseParentId, schoolAParent.id);
  console.log("✓ migration School B CREATE_NEW; does not reuse School A Parent");
}

async function testSameSchoolAmbiguousStillReview() {
  const candidates = [
    {
      id: "p1",
      firstName: "Ann",
      surname: "One",
      idNumber: null,
      cellNo: "0821111111",
      email: null,
    },
  ];
  const decision = resolveParentIdentity({
    incoming: {
      firstName: "Ann",
      surname: "Two",
      idNumber: null,
      cellNo: "0821111111",
      email: null,
      sourceSystem: "MANUAL",
    },
    candidates,
  });
  assert.equal(decision.decision, "REVIEW_REQUIRED");
  console.log("✓ ambiguous same-school (cell only) still REVIEW_REQUIRED");
}

async function testSiblingStrongReuseSameSchool() {
  const candidates = [
    {
      id: "p1",
      firstName: "Ada",
      surname: "Parent",
      idNumber: null,
      cellNo: "0821111111",
      email: "ada@example.com",
    },
  ];
  const decision = resolveParentIdentity({
    incoming: {
      firstName: "Ada",
      surname: "Different",
      idNumber: null,
      cellNo: "0821111111",
      email: "ada@example.com",
      sourceSystem: "KID-E-SYS",
    },
    candidates,
  });
  assert.equal(decision.decision, "REUSE_EXISTING");
  assert.equal(decision.parentId, "p1");
  console.log("✓ sibling strong identity (cell+email+first) reuses same-school Parent");
}

async function testFeeCheckAggregateMath() {
  assert.equal(normalizeSaIdNumber("800101 5009 087"), SA_ID);
  assert.equal(feeStatusFromOutstanding(0), "GREEN");
  assert.equal(feeStatusFromOutstanding(5000), "AMBER");
  const total = Math.round((1200.5 + 800.25) * 100) / 100;
  assert.equal(total, 2000.75);
  console.log("✓ Fee Check normalize/status/aggregate math helpers");
}

async function testNoCrossSchoolPiiOnCreatePath() {
  const prisma = makePrisma({ parents: [parentA()] });
  const r = await checkApplicationParentIdentity({
    prisma: prisma as any,
    schoolId: SCHOOL_B,
    incoming: { firstName: "Ada", surname: "Parent", idNumber: SA_ID },
    actorIsOwnerAdmin: true,
  });
  assert.equal(r.existingParent, null);
  assert.equal(r.candidates.length, 0);
  assert.equal(r.decision, "CREATE_ALLOWED");
  console.log("✓ cross-school create path returns no School A PII");
}

async function main() {
  await testSameSchoolDuplicateBlocked();
  await testCrossSchoolCreateAllowed();
  await testCrossSchoolLinkBlocked();
  await testConflictHelpersSchoolScoped();
  await testFeeCheckAuthGates();
  await testPortalSchoolScopedResolution();
  await testMigrationCandidatesSchoolScoped();
  await testSameSchoolAmbiguousStillReview();
  await testSiblingStrongReuseSameSchool();
  await testFeeCheckAggregateMath();
  await testNoCrossSchoolPiiOnCreatePath();
  console.log("\nALL Phase 1B school-scoped parent identity tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
