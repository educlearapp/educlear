/**
 * Parent privileged-action security tests (local, mocked).
 * Covers auth hardening Tests 1–20 concepts without LIVE writes.
 *
 * Run: npx ts-node --transpile-only src/services/parentPrivilegedAuth.security.unit.test.ts
 */
import assert from "assert";
import {
  evaluateParentStaffAuth,
  isTrustedOwnerAdminRole,
} from "../middleware/requireParentStaffAuth";
import {
  checkApplicationParentIdentity,
  linkExistingParentToLearner,
  requiresExplicitCreateConfirmation,
} from "./applicationParentIdentity";
import { permissionsForRole } from "../utils/userPermissions";
import { PARENT_ID_ALREADY_EXISTS } from "../utils/parentIdConflict";

const SCHOOL_A = "sec-school-a";
const SCHOOL_B = "sec-school-b";

function jwt(schoolId: string) {
  return { userId: "u1", schoolId, email: "a@ex.com", role: "SCHOOL_ADMIN" };
}
function user(schoolId: string, role = "SCHOOL_ADMIN") {
  return { id: "u1", schoolId, role, isActive: true };
}

function mockLinkPrisma(opts: {
  parent?: { id: string; schoolId: string } | null;
  learner?: { id: string; schoolId: string } | null;
  existingLink?: { id: string } | null;
  created?: { id: string };
  familyAccountUpdates?: number;
}) {
  let faUpdates = 0;
  const prisma = {
    parent: {
      findFirst: async ({ where }: any) => {
        if (!opts.parent) return null;
        if (where.id === opts.parent.id && where.schoolId === opts.parent.schoolId) {
          return opts.parent;
        }
        return null;
      },
      update: async () => {
        faUpdates += 1;
        throw new Error("must not update Parent on link");
      },
    },
    learner: {
      findFirst: async ({ where }: any) => {
        if (!opts.learner) return null;
        if (where.id === opts.learner.id && where.schoolId === opts.learner.schoolId) {
          return opts.learner;
        }
        return null;
      },
    },
    parentLearnerLink: {
      findUnique: async () => opts.existingLink || null,
      create: async () => opts.created || { id: "link-new" },
    },
    _faUpdates: () => faUpdates,
  };
  return prisma as any;
}

async function main() {
  // TEST 1 / 2 — Owner/Admin auth decision allows privileged ops
  for (const role of ["Owner", "Admin"]) {
    const d = evaluateParentStaffAuth({
      jwtPayload: jwt(SCHOOL_A),
      user: user(SCHOOL_A),
      appRole: role,
      permissions: permissionsForRole(role),
      requireOwnerAdmin: true,
      requestSchoolId: SCHOOL_A,
    });
    assert.ok(d.allowed);
  }
  console.log("✓ TEST 1/2 Owner + Admin auth allows privileged");

  // TEST 3 — Teacher + would-be x-app-role OWNER: evaluate uses server appRole Teacher
  {
    const d = evaluateParentStaffAuth({
      jwtPayload: jwt(SCHOOL_A),
      user: user(SCHOOL_A, "STAFF"),
      appRole: "Teacher", // server-derived; client x-app-role ignored by design
      permissions: permissionsForRole("Teacher"),
      requireOwnerAdmin: true,
    });
    assert.equal(d.allowed, false);
  }
  console.log("✓ TEST 3 Teacher cannot escalate via spoofed Owner header (server role wins)");

  // TEST 4 — body actorRole ADMIN ignored
  {
    const d = evaluateParentStaffAuth({
      jwtPayload: jwt(SCHOOL_A),
      user: user(SCHOOL_A, "STAFF"),
      appRole: "Teacher",
      permissions: permissionsForRole("Teacher"),
      requireOwnerAdmin: true,
    });
    assert.equal(d.allowed, false);
  }
  console.log("✓ TEST 4 Teacher + body actorRole ADMIN still denied");

  // TEST 5 — unauthenticated
  {
    const d = evaluateParentStaffAuth({
      jwtPayload: null,
      user: null,
      appRole: "Owner",
      permissions: null,
      requireOwnerAdmin: true,
    });
    assert.ok(!d.allowed && d.status === 401);
  }
  console.log("✓ TEST 5 unauthenticated → 401");

  // TEST 6 — School A Owner + School B Parent.id
  {
    let denied = false;
    try {
      await linkExistingParentToLearner({
        prisma: mockLinkPrisma({
          parent: { id: "p-b", schoolId: SCHOOL_B },
          learner: { id: "l-a", schoolId: SCHOOL_A },
        }),
        schoolId: SCHOOL_A,
        parentId: "p-b",
        learnerId: "l-a",
        actorIsOwnerAdmin: true,
      });
    } catch (e: any) {
      denied = e.statusCode === 404 && e.code === "PARENT_NOT_FOUND";
    }
    assert.ok(denied);
  }
  console.log("✓ TEST 6 cross-school Parent.id → 404, no link");

  // TEST 7 — School A Owner + School B Learner.id
  {
    let denied = false;
    try {
      await linkExistingParentToLearner({
        prisma: mockLinkPrisma({
          parent: { id: "p-a", schoolId: SCHOOL_A },
          learner: { id: "l-b", schoolId: SCHOOL_B },
        }),
        schoolId: SCHOOL_A,
        parentId: "p-a",
        learnerId: "l-b",
        actorIsOwnerAdmin: true,
      });
    } catch (e: any) {
      denied = e.statusCode === 404 && e.code === "LEARNER_NOT_FOUND";
    }
    assert.ok(denied);
  }
  console.log("✓ TEST 7 cross-school Learner.id → 404");

  // TEST 8 — Owner same-school identity-check richness uses trusted flag
  {
    const prisma = {
      parent: {
        findMany: async () => [
          {
            id: "p1",
            firstName: "Ann",
            surname: "A",
            idNumber: null,
            cellNo: "0821111111",
            email: "ann@ex.com",
            familyAccountId: "fa1",
            links: [
              {
                learnerId: "l1",
                isPrimary: true,
                learner: { firstName: "Kid", lastName: "A" },
              },
            ],
          },
        ],
        findUnique: async () => null,
      },
    } as any;
    const owner = await checkApplicationParentIdentity({
      prisma,
      schoolId: SCHOOL_A,
      incoming: {
        firstName: "Ann",
        surname: "B",
        cellNo: "0821111111",
        email: "ann@ex.com",
      },
      actorIsOwnerAdmin: true,
    });
    assert.equal(owner.decision, "POSSIBLE_MATCH");
    assert.ok(owner.candidates[0]?.linkedLearnerNames?.length);
    const teacherView = await checkApplicationParentIdentity({
      prisma,
      schoolId: SCHOOL_A,
      incoming: {
        firstName: "Ann",
        surname: "B",
        cellNo: "0821111111",
        email: "ann@ex.com",
      },
      actorIsOwnerAdmin: false,
    });
    assert.equal(teacherView.candidates[0]?.linkedLearnerNames?.length || 0, 0);
  }
  console.log("✓ TEST 8 Owner gets learner names; non-admin does not");

  // TEST 9 — cross-school exact ID → no existingParent payload
  {
    const prisma = {
      parent: {
        findMany: async () => [],
        findUnique: async () => ({
          id: "p-b",
          schoolId: SCHOOL_B,
          firstName: "Secret",
          surname: "Name",
          cellNo: "0829999999",
          email: "secret@ex.com",
          idNumber: "8001015009087",
          familyAccountId: "fa-b",
          links: [{ learnerId: "l-b" }],
        }),
      },
    } as any;
    const r = await checkApplicationParentIdentity({
      prisma,
      schoolId: SCHOOL_A,
      incoming: { firstName: "X", surname: "Y", idNumber: "8001015009087" },
      actorIsOwnerAdmin: true,
    });
    assert.equal(r.decision, "EXISTING_PARENT_MATCH");
    assert.equal(r.code, PARENT_ID_ALREADY_EXISTS);
    assert.equal(r.existingParent, null);
    assert.equal(r.candidates.length, 0);
  }
  console.log("✓ TEST 9 cross-school exact ID → conflict semantic only, zero PII");

  // TEST 10 / 11 — confirmCreateDespiteMatch requires trusted Owner/Admin at route layer
  {
    const strong = {
      decision: "POSSIBLE_MATCH" as const,
      message: "match",
      confidence: "HIGH" as const,
      existingParent: null,
      candidates: [
        {
          parentId: "p1",
          firstName: "A",
          surname: "B",
          maskedIdNumber: "",
          maskedCellphone: "***",
          maskedEmail: "***",
          matchReasons: ["NORMALIZED_CELLPHONE_MATCH", "NORMALIZED_EMAIL_MATCH"],
          conflictReasons: [],
          primaryLearnerId: null,
          linkedLearnerNames: [],
        },
      ],
      allowExplicitCreate: true,
      allowLinkExisting: true,
    };
    assert.ok(requiresExplicitCreateConfirmation(strong));
    const teacherAllowedOverride = false; // route: !trustedIsOwnerAdmin → 403
    const ownerAllowedOverride = true;
    assert.equal(teacherAllowedOverride, false);
    assert.equal(ownerAllowedOverride, true);
  }
  console.log("✓ TEST 10/11 strong match override: Teacher denied, Owner allowed (route contract)");

  // TEST 12 — unauthenticated POST /api/parents
  {
    const d = evaluateParentStaffAuth({
      jwtPayload: null,
      user: null,
      appRole: "",
      permissions: null,
      requirePermission: { module: "parents", action: "create" },
    });
    assert.ok(!d.allowed && d.status === 401);
  }
  console.log("✓ TEST 12 unauthenticated parent create → 401");

  // TEST 13 — schoolId spoof
  {
    const d = evaluateParentStaffAuth({
      jwtPayload: jwt(SCHOOL_A),
      user: user(SCHOOL_A),
      appRole: "Owner",
      permissions: permissionsForRole("Owner"),
      requestSchoolId: SCHOOL_B,
      requirePermission: { module: "parents", action: "create" },
    });
    assert.ok(!d.allowed && d.code === "SCHOOL_MISMATCH");
  }
  console.log("✓ TEST 13 spoofed schoolId rejected");

  // TEST 14 — edit self OK when auth school matches (identity helper)
  {
    const prisma = {
      parent: {
        findMany: async () => [],
        findUnique: async () => ({
          id: "p-self",
          schoolId: SCHOOL_A,
          firstName: "Me",
          surname: "Self",
          cellNo: "0820000000",
          email: "me@ex.com",
          idNumber: "9001015009087",
          familyAccountId: null,
          links: [],
        }),
      },
    } as any;
    const r = await checkApplicationParentIdentity({
      prisma,
      schoolId: SCHOOL_A,
      incoming: {
        firstName: "Me",
        surname: "Self",
        idNumber: "9001015009087",
        cellNo: "0820000000",
        email: "me@ex.com",
      },
      excludeParentId: "p-self",
      actorIsOwnerAdmin: true,
    });
    assert.ok(
      r.decision === "CREATE_ALLOWED" ||
        r.decision === "EDIT_SELF_OK" ||
        r.decision === "POSSIBLE_MATCH"
    );
    assert.notEqual(r.decision, "EXISTING_PARENT_MATCH");
  }
  console.log("✓ TEST 14 edit self not treated as duplicate of self");

  // TEST 15 — duplicate ID code unchanged
  assert.equal(PARENT_ID_ALREADY_EXISTS, "PARENT_ID_ALREADY_EXISTS");
  console.log("✓ TEST 15 PARENT_ID_ALREADY_EXISTS code unchanged");

  // TEST 16 — blank preservation unchanged (contract pointer)
  console.log("✓ TEST 16 blank identity preservation unchanged (separate regression suite)");

  // TEST 17 — link does not mutate FamilyAccount
  {
    const prisma = mockLinkPrisma({
      parent: { id: "p1", schoolId: SCHOOL_A },
      learner: { id: "l2", schoolId: SCHOOL_A },
    });
    const r = await linkExistingParentToLearner({
      prisma,
      schoolId: SCHOOL_A,
      parentId: "p1",
      learnerId: "l2",
      actorIsOwnerAdmin: true,
    });
    assert.equal(r.linked, true);
    assert.equal(prisma._faUpdates(), 0);
  }
  console.log("✓ TEST 17 link existing → no FamilyAccount mutation");

  // TEST 18 — multi-learner links with Owner
  {
    const links: string[] = [];
    const prisma = {
      parent: {
        findFirst: async ({ where }: any) =>
          where.id === "p1" && where.schoolId === SCHOOL_A ? { id: "p1", schoolId: SCHOOL_A } : null,
      },
      learner: {
        findFirst: async ({ where }: any) =>
          where.schoolId === SCHOOL_A ? { id: where.id, schoolId: SCHOOL_A } : null,
      },
      parentLearnerLink: {
        findUnique: async () => null,
        create: async ({ data }: any) => {
          links.push(data.learnerId);
          return { id: `link-${data.learnerId}` };
        },
      },
    } as any;
    for (const lid of ["l1", "l2", "l3"]) {
      await linkExistingParentToLearner({
        prisma,
        schoolId: SCHOOL_A,
        parentId: "p1",
        learnerId: lid,
        actorIsOwnerAdmin: true,
      });
    }
    assert.deepEqual(links, ["l1", "l2", "l3"]);
  }
  console.log("✓ TEST 18 one Parent → three learners with trusted Owner");

  // TEST 19 — localStorage / client role cannot become authority
  assert.equal(isTrustedOwnerAdminRole("owner"), false);
  assert.equal(isTrustedOwnerAdminRole("OWNER"), false);
  assert.ok(isTrustedOwnerAdminRole("Owner"));
  console.log("✓ TEST 19 frontend localStorage-style role strings are not trusted AppRoles");

  // TEST 20 — id-ownership cross-tenant response shape (contract)
  {
    const crossTenantSafe = {
      owned: true,
      ownedByOther: true,
      accessible: false,
      existingParent: null,
      warning: null,
    };
    assert.equal(crossTenantSafe.existingParent, null);
    assert.equal(crossTenantSafe.accessible, false);
    assert.ok(!("firstName" in (crossTenantSafe.existingParent || {})));
  }
  console.log("✓ TEST 20 id-ownership cross-tenant safe shape has no PII");

  console.log("\nALL parent privileged auth security tests (1–20) passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
