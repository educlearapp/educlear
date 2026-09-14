/**
 * SEC-01B — PATCH /api/learners/:id/enrollment-status authorization.
 *
 * Run: npx tsx src/routes/learnerEnrollmentStatus.security.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { evaluateParentStaffAuth } from "../middleware/requireParentStaffAuth";
import { setUserAccessMeta } from "../utils/userAccessStore";
import { permissionsForRole } from "../utils/userPermissions";
import learnerRoutes from "./learner";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

function testEnrollmentEditAuthDecisions() {
  const jwtA = { userId: "u1", schoolId: "school-a", email: "a@ex.com", role: "SCHOOL_ADMIN" };
  const userA = { id: "u1", schoolId: "school-a", role: "SCHOOL_ADMIN", isActive: true };

  const noAuth = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(noAuth.allowed, false);
  if (!noAuth.allowed) assert.equal(noAuth.status, 401);

  const teacher = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(teacher.allowed, false);
  if (!teacher.allowed) {
    assert.equal(teacher.status, 403);
    assert.equal(teacher.code, "FORBIDDEN_PERMISSION");
  }

  const finance = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(finance.allowed, false);
  if (!finance.allowed) {
    assert.equal(finance.status, 403);
    assert.equal(finance.code, "FORBIDDEN_PERMISSION");
  }

  const admin = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(admin.allowed, true);

  const owner = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(owner.allowed, true);

  const mismatch = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: "school-b",
  });
  assert.equal(mismatch.allowed, false);
  if (!mismatch.allowed) {
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.code, "SCHOOL_MISMATCH");
  }

  console.log("✓ enrollment-status auth decisions: 401 / Teacher+Finance 403 / Owner+Admin ok / mismatch");
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/learners", learnerRoutes);
  app.use("/learner", learnerRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function jsonFetch(
  url: string,
  opts: { method?: string; body?: unknown; token?: string } = {}
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, json };
}

async function createStaffUser(input: {
  schoolId: string;
  email: string;
  appRole: "Owner" | "Admin" | "Finance" | "Teacher";
  prismaRole?: string;
}) {
  const user = await prisma.user.create({
    data: {
      schoolId: input.schoolId,
      email: input.email,
      passwordHash: "x",
      role: input.prismaRole || "SCHOOL_ADMIN",
      fullName: input.appRole,
    },
  });
  await setUserAccessMeta(user.id, {
    schoolId: input.schoolId,
    appRole: input.appRole,
    firstName: input.appRole,
    surname: "Staff",
    permissions: permissionsForRole(input.appRole),
    lastLoginAt: null,
  });
  return user;
}

async function runLiveRouteTests() {
  const suffix = Date.now();
  const schoolA = await prisma.school.create({
    data: { name: `SEC01B A ${suffix}`, email: `sec01b-a-${suffix}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `SEC01B B ${suffix}`, email: `sec01b-b-${suffix}@test.local` },
  });

  const ownerA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec01b-owner-a-${suffix}@test.local`,
    appRole: "Owner",
  });
  const adminA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec01b-admin-a-${suffix}@test.local`,
    appRole: "Admin",
  });
  const financeA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec01b-finance-a-${suffix}@test.local`,
    appRole: "Finance",
    prismaRole: "FINANCE",
  });
  const teacherA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec01b-teacher-a-${suffix}@test.local`,
    appRole: "Teacher",
    prismaRole: "STAFF",
  });
  const adminB = await createStaffUser({
    schoolId: schoolB.id,
    email: `sec01b-admin-b-${suffix}@test.local`,
    appRole: "Admin",
  });

  const tokenOwnerA = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenAdminA = signToken({
    userId: adminA.id,
    schoolId: schoolA.id,
    email: adminA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenFinanceA = signToken({
    userId: financeA.id,
    schoolId: schoolA.id,
    email: financeA.email,
    role: "FINANCE",
  });
  const tokenTeacherA = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const tokenAdminB = signToken({
    userId: adminB.id,
    schoolId: schoolB.id,
    email: adminB.email,
    role: "SCHOOL_ADMIN",
  });

  const learnerA = await prisma.learner.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Sec",
      lastName: "OneB",
      grade: "R",
      className: "R",
      admissionNo: `SEC01B-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const learnerB = await prisma.learner.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Other",
      lastName: "School",
      grade: "1",
      className: "1",
      admissionNo: `SEC01B-B-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });

  await prisma.learnerBillingPlanLine.create({
    data: {
      schoolId: schoolA.id,
      learnerId: learnerA.id,
      feeDescription: "SEC-01B probe fee",
      amount: 100,
      sortOrder: 0,
    },
  });
  const plansBefore = await prisma.learnerBillingPlanLine.count({
    where: { learnerId: learnerA.id },
  });

  const { base, close } = await startServer();
  const patchApi = (learnerId: string, qs = "") =>
    `${base}/api/learners/${encodeURIComponent(learnerId)}/enrollment-status${qs}`;
  const patchAlias = (learnerId: string) =>
    `${base}/learner/${encodeURIComponent(learnerId)}/enrollment-status`;

  try {
    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
        })
      ).status,
      401
    );
    console.log("✓ unauthenticated PATCH → 401");

    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          token: tokenTeacherA,
          body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
        })
      ).status,
      403
    );
    console.log("✓ Teacher without learners.edit → 403");

    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          token: tokenFinanceA,
          body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
        })
      ).status,
      403
    );
    console.log("✓ Finance without learners.edit → 403");

    const noSchoolId = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "HISTORICAL" },
    });
    assert.notEqual(noSchoolId.status, 400);
    assert.equal(noSchoolId.status, 200);
    assert.equal(noSchoolId.json.success, true);
    assert.equal(noSchoolId.json.learner?.enrollmentStatus, "HISTORICAL");
    const afterNoSchoolId = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.equal(afterNoSchoolId?.enrollmentStatus, "HISTORICAL");
    console.log("✓ authorized request with NO schoolId → 200 using JWT school (not 400)");

    const bodyMatch = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenAdminA,
      body: { enrollmentStatus: "ACTIVE", schoolId: schoolA.id },
    });
    assert.equal(bodyMatch.status, 200);
    assert.equal(bodyMatch.json.learner?.enrollmentStatus, "ACTIVE");
    console.log("✓ body schoolId matching JWT → succeeds");

    const queryMatch = await jsonFetch(
      patchApi(learnerA.id, `?schoolId=${encodeURIComponent(schoolA.id)}`),
      {
        method: "PATCH",
        token: tokenAdminA,
        body: { enrollmentStatus: "HISTORICAL" },
      }
    );
    assert.equal(queryMatch.status, 200);
    assert.equal(queryMatch.json.learner?.enrollmentStatus, "HISTORICAL");
    console.log("✓ query schoolId matching JWT → succeeds");

    // Restore ACTIVE before mismatch / cross-school assertions
    await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "ACTIVE" },
    });

    const bodyMismatch = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenAdminA,
      body: { enrollmentStatus: "HISTORICAL", schoolId: schoolB.id },
    });
    assert.equal(bodyMismatch.status, 403);
    assert.equal(bodyMismatch.json.code, "SCHOOL_MISMATCH");
    console.log("✓ body schoolId ≠ JWT school → 403 SCHOOL_MISMATCH");

    const queryMismatch = await jsonFetch(patchApi(learnerA.id, `?schoolId=${encodeURIComponent(schoolB.id)}`), {
      method: "PATCH",
      token: tokenAdminA,
      body: { enrollmentStatus: "HISTORICAL" },
    });
    assert.equal(queryMismatch.status, 403);
    assert.equal(queryMismatch.json.code, "SCHOOL_MISMATCH");
    console.log("✓ query schoolId ≠ JWT school → 403 SCHOOL_MISMATCH");

    const bothContradict = await jsonFetch(
      patchApi(learnerA.id, `?schoolId=${encodeURIComponent(schoolB.id)}`),
      {
        method: "PATCH",
        token: tokenAdminA,
        body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
      }
    );
    assert.equal(bothContradict.status, 403);
    assert.equal(bothContradict.json.code, "SCHOOL_MISMATCH");
    console.log("✓ body match + query mismatch → 403 SCHOOL_MISMATCH");

    const crossSchool = await jsonFetch(patchApi(learnerB.id), {
      method: "PATCH",
      token: tokenAdminA,
      body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
    });
    assert.equal(crossSchool.status, 404);
    const learnerBAfter = await prisma.learner.findUnique({ where: { id: learnerB.id } });
    assert.equal(learnerBAfter?.enrollmentStatus, "ACTIVE");
    console.log("✓ cross-school learner id → 404 / not mutated");

    const toHistorical = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
    });
    assert.equal(toHistorical.status, 200);
    assert.equal(toHistorical.json.success, true);
    assert.equal(toHistorical.json.learner?.enrollmentStatus, "HISTORICAL");
    console.log("✓ Owner ACTIVE → HISTORICAL");

    const noopHistorical = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenAdminA,
      body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
    });
    assert.equal(noopHistorical.status, 200);
    assert.equal(noopHistorical.json.learner?.enrollmentStatus, "HISTORICAL");
    console.log("✓ HISTORICAL → HISTORICAL no-op ok (Admin)");

    const toActive = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenAdminA,
      body: { enrollmentStatus: "ACTIVE", schoolId: schoolA.id },
    });
    assert.equal(toActive.status, 200);
    assert.equal(toActive.json.learner?.enrollmentStatus, "ACTIVE");
    console.log("✓ Admin HISTORICAL → ACTIVE");

    const noopActive = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "ACTIVE", schoolId: schoolA.id },
    });
    assert.equal(noopActive.status, 200);
    assert.equal(noopActive.json.learner?.enrollmentStatus, "ACTIVE");
    console.log("✓ ACTIVE → ACTIVE no-op ok");

    const invalid = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "GRADUATED", schoolId: schoolA.id },
    });
    assert.equal(invalid.status, 400);
    console.log("✓ invalid status → 400");

    const aliasUnauth = await jsonFetch(patchAlias(learnerA.id), {
      method: "PATCH",
      body: { enrollmentStatus: "HISTORICAL", schoolId: schoolA.id },
    });
    assert.equal(aliasUnauth.status, 401);
    const aliasOk = await jsonFetch(patchAlias(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "HISTORICAL" },
    });
    assert.equal(aliasOk.status, 200);
    assert.equal(aliasOk.json.learner?.enrollmentStatus, "HISTORICAL");
    console.log("✓ /learner alias protected + authorized success (no client schoolId)");

    // Restore ACTIVE for clean assert trail
    await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { enrollmentStatus: "ACTIVE" },
    });

    const plansAfter = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerA.id },
    });
    assert.equal(plansAfter, plansBefore);
    console.log("✓ no billing-plan write side effects from enrollment-status PATCH");
  } finally {
    await close();
    await prisma.learnerBillingPlanLine.deleteMany({
      where: { learnerId: { in: [learnerA.id, learnerB.id] } },
    });
    await prisma.learner.deleteMany({ where: { id: { in: [learnerA.id, learnerB.id] } } });
    const userIds = [ownerA.id, adminA.id, financeA.id, teacherA.id, adminB.id];
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
  }
}

async function main() {
  testEnrollmentEditAuthDecisions();
  await runLiveRouteTests();
  console.log("\nAll SEC-01B enrollment-status security tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
