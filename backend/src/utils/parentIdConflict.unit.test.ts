/**
 * Parent ID conflict helpers + school-scoped uniqueness regression.
 * Run: npx ts-node --transpile-only src/utils/parentIdConflict.unit.test.ts
 */
import assert from "assert";
import {
  buildParentIdConflictBody,
  findDuplicateParentSignal,
  findParentByIdNumberInSchool,
  isParentIdNumberUniqueTarget,
  isPrismaUniqueConstraintError,
  PARENT_ID_ALREADY_EXISTS,
  PARENT_ID_CONFLICT_MESSAGE,
  ParentIdConflictError,
} from "./parentIdConflict";

function testDetectsP2002() {
  assert.strictEqual(isPrismaUniqueConstraintError({ code: "P2002" }), true);
  assert.strictEqual(
    isParentIdNumberUniqueTarget({
      code: "P2002",
      meta: { target: ["idNumber"] },
      message: "Unique constraint failed on the fields: (`idNumber`)",
    }),
    true
  );
  assert.strictEqual(
    isParentIdNumberUniqueTarget({
      code: "P2002",
      meta: { target: ["schoolId", "idNumber"] },
    }),
    true
  );
  assert.strictEqual(
    isParentIdNumberUniqueTarget({
      code: "P2002",
      meta: { target: ["email"] },
    }),
    false
  );
  console.log("✓ detects Prisma idNumber / composite unique constraint");
}

function testConflictErrorIs409() {
  const err = new ParentIdConflictError({
    success: false,
    code: PARENT_ID_ALREADY_EXISTS,
    message: PARENT_ID_CONFLICT_MESSAGE,
    idNumber: "8001015009087",
    existingParent: null,
  });
  assert.strictEqual(err.statusCode, 409);
  assert.strictEqual(err.body.code, PARENT_ID_ALREADY_EXISTS);
  assert.strictEqual(err.body.message, PARENT_ID_CONFLICT_MESSAGE);
  console.log("✓ ParentIdConflictError exposes HTTP 409 body");
}

async function testBuildConflictBodyLooksUpOwnerInSchool() {
  const prisma = {
    parent: {
      findFirst: async ({ where }: any) => {
        if (where.schoolId !== "school-1" || where.idNumber !== "8001015009087") return null;
        return {
          id: "owner-1",
          schoolId: "school-1",
          firstName: "Jane",
          surname: "Doe",
          cellNo: "0821111111",
          email: "jane@example.com",
          idNumber: "8001015009087",
          familyAccountId: "fam-1",
          links: [{ learnerId: "learner-1" }],
        };
      },
    },
  };
  const body = await buildParentIdConflictBody(prisma as any, "8001015009087", "school-1");
  assert.strictEqual(body.code, PARENT_ID_ALREADY_EXISTS);
  assert.strictEqual(body.existingParent?.id, "owner-1");
  assert.strictEqual(body.existingParent?.primaryLearnerId, "learner-1");

  const otherSchool = await buildParentIdConflictBody(prisma as any, "8001015009087", "school-2");
  assert.strictEqual(otherSchool.existingParent, null);

  const missingSchool = await findParentByIdNumberInSchool(prisma as any, "", "8001015009087");
  assert.strictEqual(missingSchool, null);
  console.log("✓ buildParentIdConflictBody is school-scoped");
}

async function testDuplicateSignalByCellAndEmail() {
  const owner = {
    id: "owner-1",
    schoolId: "school-1",
    firstName: "Jane",
    surname: "Doe",
    cellNo: "0821111111",
    email: "jane@example.com",
    idNumber: "8001015009087",
    familyAccountId: null,
    links: [{ learnerId: "learner-1" }],
  };
  const prisma = {
    parent: {
      findFirst: async ({ where }: any) => {
        if (where.schoolId !== "school-1") return null;
        return owner;
      },
    },
  };
  const warning = await findDuplicateParentSignal({
    prisma: prisma as any,
    schoolId: "school-1",
    idNumber: "8001015009087",
    excludeParentId: "shell-1",
    cellNo: "0821111111",
    email: "jane@example.com",
  });
  assert.ok(warning);
  assert.strictEqual(warning!.code, "DUPLICATE_PARENT_SIGNAL");
  assert.ok(warning!.matchedBy.includes("cellNo"));
  assert.ok(warning!.matchedBy.includes("email"));
  assert.match(warning!.message, /duplicate parent record/i);
  console.log("✓ duplicate parent signal warns on shared cell/email (same school)");
}

async function testNoWarningWhenSelfOwnsId() {
  const owner = {
    id: "owner-1",
    schoolId: "school-1",
    firstName: "Jane",
    surname: "Doe",
    cellNo: "0821111111",
    email: "jane@example.com",
    idNumber: "8001015009087",
    familyAccountId: null,
    links: [],
  };
  const prisma = {
    parent: {
      findFirst: async () => owner,
    },
  };
  const warning = await findDuplicateParentSignal({
    prisma: prisma as any,
    schoolId: "school-1",
    idNumber: "8001015009087",
    excludeParentId: "owner-1",
    cellNo: "0821111111",
    email: "jane@example.com",
  });
  assert.strictEqual(warning, null);
  console.log("✓ no duplicate warning when excluded parent already owns ID");
}

function testSchoolScopedUniquenessRegression() {
  assert.strictEqual(
    isParentIdNumberUniqueTarget({
      code: "P2002",
      meta: { target: ["schoolId", "idNumber"] },
    }),
    true
  );
  console.log("✓ uniqueness regression: composite schoolId+idNumber P2002 still treated as conflict");
}

async function main() {
  testDetectsP2002();
  testConflictErrorIs409();
  await testBuildConflictBodyLooksUpOwnerInSchool();
  await testDuplicateSignalByCellAndEmail();
  await testNoWarningWhenSelfOwnsId();
  testSchoolScopedUniquenessRegression();
  console.log("\nALL parentIdConflict tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
