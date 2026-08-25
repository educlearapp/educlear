/**
 * Super Admin school password reset — local unit tests (mocked DB).
 * Run: npx tsx src/services/superAdmin/resetSuperAdminSchoolPassword.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { compareAuthPassword } from "../authCredentials";
import { isAuthenticatedSuperAdminEmail, requireSuperAdmin } from "../../middleware/requireSuperAdmin";
import superAdminSchoolsRoutes from "../../routes/superAdminSchools";
import { STAFF_JWT_SECRET } from "../../utils/staffJwt";
import {
  resetSuperAdminSchoolPassword,
  SuperAdminSchoolPasswordResetError,
} from "./resetSuperAdminSchoolPassword";

const FLY_EAGLE_FIXTURE_SCHOOL_ID = "school-fixture-fly-eagle-login";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MAGICAL = "cmq4xjckq00at60gqg4eb956h";
const OTHER_SCHOOL = "school-other-tenant";

const NEW_PASSWORD = "FlyEagleLocalTest9";

type UserRow = {
  id: string;
  schoolId: string;
  email: string;
  passwordHash: string;
  roleRef: { isOwner: boolean } | null;
  rbacMeta: { appRole: string } | null;
};

function mockDb(opts: {
  schools?: Record<string, { id: string; name: string }>;
  users?: UserRow[];
}) {
  const schools = opts.schools || {};
  const users = opts.users || [];
  const writes: Array<{ model: string; where: unknown; data: unknown }> = [];

  const db = {
    school: {
      findUnique: async ({ where }: { where: { id: string } }) => schools[where.id] || null,
    },
    user: {
      findMany: async ({ where }: { where: { schoolId: string } }) =>
        users.filter((u) => u.schoolId === where.schoolId),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; schoolId: string };
        data: { passwordHash?: string; email?: string; role?: string };
      }) => {
        writes.push({ model: "user", where, data });
        const match = users.filter((u) => u.id === where.id && u.schoolId === where.schoolId);
        if (data.email !== undefined || data.role !== undefined) {
          throw new Error("must not change email or role");
        }
        for (const row of match) {
          if (data.passwordHash) row.passwordHash = data.passwordHash;
        }
        return { count: match.length };
      },
    },
    learner: {
      create: async () => {
        throw new Error("must not write learners");
      },
      updateMany: async () => {
        throw new Error("must not write learners");
      },
    },
    familyAccount: {
      updateMany: async () => {
        throw new Error("must not write finance");
      },
    },
    writes,
  };

  return db;
}

async function expectReject(fn: () => Promise<unknown>, status: number, messagePart: string) {
  try {
    await fn();
    throw new Error("expected rejection");
  } catch (error) {
    assert.ok(error instanceof SuperAdminSchoolPasswordResetError, String(error));
    assert.strictEqual(error.statusCode, status, error.message);
    assert.match(error.message, new RegExp(messagePart, "i"));
  }
}

async function startAuthServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/super-admin/schools", requireSuperAdmin, superAdminSchoolsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/super-admin/schools`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function main() {
  const daSilvaHash = "da-silva-hash-unchanged";
  const magicalHash = "magical-hash-unchanged";
  const fixture: UserRow = {
    id: "owner-fe-fixture",
    schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
    email: "flyeagle-fixture@example.com",
    passwordHash: "old-hash",
    roleRef: { isOwner: true },
    rbacMeta: { appRole: "Owner" },
  };
  const daSilvaOwner: UserRow = {
    id: "owner-ds",
    schoolId: DA_SILVA,
    email: "dasilva@example.com",
    passwordHash: daSilvaHash,
    roleRef: { isOwner: true },
    rbacMeta: { appRole: "Owner" },
  };
  const magicalOwner: UserRow = {
    id: "owner-mb",
    schoolId: MAGICAL,
    email: "magical@example.com",
    passwordHash: magicalHash,
    roleRef: { isOwner: true },
    rbacMeta: { appRole: "Owner" },
  };
  const otherOwner: UserRow = {
    id: "owner-other",
    schoolId: OTHER_SCHOOL,
    email: "other@example.com",
    passwordHash: "other-hash",
    roleRef: { isOwner: true },
    rbacMeta: { appRole: "Owner" },
  };

  const db = mockDb({
    schools: {
      [FLY_EAGLE_FIXTURE_SCHOOL_ID]: {
        id: FLY_EAGLE_FIXTURE_SCHOOL_ID,
        name: "Fly Eagle Fixture School",
      },
    },
    users: [fixture, daSilvaOwner, magicalOwner, otherOwner],
  });

  const result = await resetSuperAdminSchoolPassword(
    {
      schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
      claimedSchoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    },
    db as never
  );
  assert.strictEqual(result.schoolId, FLY_EAGLE_FIXTURE_SCHOOL_ID);
  assert.strictEqual(result.ownerEmail, "flyeagle-fixture@example.com");
  assert.notStrictEqual(fixture.passwordHash, "old-hash");
  assert.ok(await compareAuthPassword(NEW_PASSWORD, fixture.passwordHash));
  assert.ok(!JSON.stringify(result).includes(NEW_PASSWORD));
  console.log("✓ Super Admin can reset a school password; fixture login hash verifies");

  assert.strictEqual(daSilvaOwner.passwordHash, daSilvaHash);
  assert.strictEqual(magicalOwner.passwordHash, magicalHash);
  assert.strictEqual(otherOwner.passwordHash, "other-hash");
  assert.deepStrictEqual(
    db.writes.map((w) => (w.where as { schoolId: string }).schoolId),
    [FLY_EAGLE_FIXTURE_SCHOOL_ID]
  );
  console.log("✓ Same operation cannot affect another school; Da Silva and Magical hashes unchanged");

  await expectReject(
    () =>
      resetSuperAdminSchoolPassword(
        {
          schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
          claimedSchoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
          newPassword: NEW_PASSWORD,
          confirmPassword: "DifferentPass9",
        },
        db as never
      ),
    400,
    "match"
  );
  console.log("✓ Password mismatch rejected");

  await expectReject(
    () =>
      resetSuperAdminSchoolPassword({
        schoolId: "",
        claimedSchoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    400,
    "schoolId"
  );
  await expectReject(
    () =>
      resetSuperAdminSchoolPassword(
        {
          schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
          claimedSchoolId: OTHER_SCHOOL,
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
        db as never
      ),
    400,
    "does not match"
  );
  await expectReject(
    () =>
      resetSuperAdminSchoolPassword(
        {
          schoolId: "missing-school",
          claimedSchoolId: "missing-school",
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
        db as never
      ),
    404,
    "School not found"
  );
  console.log("✓ Wrong/missing schoolId rejected");

  assert.strictEqual(isAuthenticatedSuperAdminEmail("info@educlear.co.za"), true);
  assert.strictEqual(isAuthenticatedSuperAdminEmail("owner@school.com"), false);
  assert.strictEqual(isAuthenticatedSuperAdminEmail("info@educlear.co.za", false), false);
  console.log("✓ Non-Super Admin email is rejected by requireSuperAdmin gate");

  const { baseUrl, close } = await startAuthServer();
  try {
    const unauth = await fetch(`${baseUrl}/${encodeURIComponent(FLY_EAGLE_FIXTURE_SCHOOL_ID)}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    });
    assert.strictEqual(unauth.status, 401);

    const schoolToken = jwt.sign(
      {
        userId: "school-user",
        schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
        email: "owner@school.com",
        role: "SCHOOL_ADMIN",
      },
      STAFF_JWT_SECRET,
      { expiresIn: "1h" }
    );
    const forbidden = await fetch(
      `${baseUrl}/${encodeURIComponent(FLY_EAGLE_FIXTURE_SCHOOL_ID)}/reset-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${schoolToken}`,
        },
        body: JSON.stringify({
          schoolId: FLY_EAGLE_FIXTURE_SCHOOL_ID,
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        }),
      }
    );
    assert.ok(forbidden.status === 403 || forbidden.status === 401, `got ${forbidden.status}`);
    console.log("✓ Unauthenticated and non-Super Admin HTTP requests rejected");
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
