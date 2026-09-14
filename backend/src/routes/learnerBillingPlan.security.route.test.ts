/**
 * SEC-02C — PATCH /api/learners/:id/billing-plan authorization.
 *
 * Run: npx tsx src/routes/learnerBillingPlan.security.route.test.ts
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

function testBillingPlanEditAuthDecisions() {
  const jwtA = { userId: "u1", schoolId: "school-a", email: "a@ex.com", role: "SCHOOL_ADMIN" };
  const userA = { id: "u1", schoolId: "school-a", role: "SCHOOL_ADMIN", isActive: true };

  const noAuth = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requirePermission: { module: "billingPlans", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(noAuth.allowed, false);
  if (!noAuth.allowed) assert.equal(noAuth.status, 401);

  const admin = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "billingPlans", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(admin.allowed, false);
  if (!admin.allowed) {
    assert.equal(admin.status, 403);
    assert.equal(admin.code, "FORBIDDEN_PERMISSION");
  }

  const finance = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requirePermission: { module: "billingPlans", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(finance.allowed, true);

  const owner = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requirePermission: { module: "billingPlans", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(owner.allowed, true);

  const viewOnly = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: {
      ...permissionsForRole("Admin"),
      billingPlans: { view: true, edit: false },
    },
    requirePermission: { module: "billingPlans", action: "edit" },
    requestSchoolId: "school-a",
  });
  assert.equal(viewOnly.allowed, false);

  console.log("✓ billing-plan auth decisions: 401 / Admin denied / Finance+Owner ok / view-only denied");
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
  appRole: "Owner" | "Admin" | "Finance" | "Teacher" | "Viewer";
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
    data: { name: `SEC02C A ${suffix}`, email: `sec02c-a-${suffix}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `SEC02C B ${suffix}`, email: `sec02c-b-${suffix}@test.local` },
  });

  const ownerA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02c-owner-a-${suffix}@test.local`,
    appRole: "Owner",
  });
  const financeA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02c-finance-a-${suffix}@test.local`,
    appRole: "Finance",
    prismaRole: "FINANCE",
  });
  const adminA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02c-admin-a-${suffix}@test.local`,
    appRole: "Admin",
  });
  const teacherA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02c-teacher-a-${suffix}@test.local`,
    appRole: "Teacher",
    prismaRole: "STAFF",
  });
  const viewerA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02c-viewer-a-${suffix}@test.local`,
    appRole: "Viewer",
    prismaRole: "STAFF",
  });
  const adminB = await createStaffUser({
    schoolId: schoolB.id,
    email: `sec02c-admin-b-${suffix}@test.local`,
    appRole: "Admin",
  });

  const tokenOwnerA = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenFinanceA = signToken({
    userId: financeA.id,
    schoolId: schoolA.id,
    email: financeA.email,
    role: "FINANCE",
  });
  const tokenAdminA = signToken({
    userId: adminA.id,
    schoolId: schoolA.id,
    email: adminA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenTeacherA = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const tokenViewerA = signToken({
    userId: viewerA.id,
    schoolId: schoolA.id,
    email: viewerA.email,
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
      firstName: "Bill",
      lastName: "Plan",
      grade: "R",
      className: "R",
      admissionNo: `SEC02C-${suffix}`,
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
      admissionNo: `SEC02C-B-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });

  const { base, close } = await startServer();
  const patchApi = (learnerId: string, qs = "") =>
    `${base}/api/learners/${encodeURIComponent(learnerId)}/billing-plan${qs}`;
  const patchAlias = (learnerId: string) =>
    `${base}/learner/${encodeURIComponent(learnerId)}/billing-plan`;

  try {
    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          body: { billingPlan: [{ feeDescription: "X", amount: 1 }] },
        })
      ).status,
      401
    );
    console.log("✓ unauthenticated PATCH → 401");

    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          token: tokenAdminA,
          body: { billingPlan: [{ feeDescription: "AdminDenied", amount: 10 }] },
        })
      ).status,
      403
    );
    console.log("✓ Admin without billingPlans.edit → 403");

    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          token: tokenTeacherA,
          body: { billingPlan: [{ feeDescription: "T", amount: 1 }] },
        })
      ).status,
      403
    );
    console.log("✓ Teacher → 403");

    assert.equal(
      (
        await jsonFetch(patchApi(learnerA.id), {
          method: "PATCH",
          token: tokenViewerA,
          body: { billingPlan: [{ feeDescription: "V", amount: 1 }] },
        })
      ).status,
      403
    );
    console.log("✓ Viewer → 403");

    const createOk = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenFinanceA,
      body: {
        billingPlan: [{ feeDescription: "Tuition", amount: 500 }],
      },
    });
    assert.equal(createOk.status, 200);
    assert.equal(createOk.json.success, true);
    assert.equal(createOk.json.billingPlan?.length, 1);
    assert.equal(createOk.json.billingPlan[0].feeDescription, "Tuition");
    const linesAfterCreate = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerA.id },
    });
    assert.equal(linesAfterCreate, 1);
    console.log("✓ Finance create plan → 200");

    const replaceOk = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: {
        billingPlan: [
          { feeDescription: "Tuition", amount: 600 },
          { feeDescription: "Transport", amount: 200 },
        ],
      },
    });
    assert.equal(replaceOk.status, 200);
    assert.equal(replaceOk.json.billingPlan?.length, 2);
    const linesAfterReplace = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerA.id },
    });
    assert.equal(linesAfterReplace, 2);
    console.log("✓ Owner replace plan → 200");

    const clearOk = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenFinanceA,
      body: { billingPlan: [] },
    });
    assert.equal(clearOk.status, 200);
    assert.equal(clearOk.json.billingPlan?.length, 0);
    const linesAfterClear = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerA.id },
    });
    assert.equal(linesAfterClear, 0);
    console.log("✓ Finance empty-array clear → 200");

    const noSchoolId = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenFinanceA,
      body: { billingPlan: [{ feeDescription: "NoSchoolId", amount: 50 }] },
    });
    assert.equal(noSchoolId.status, 200);
    assert.equal(noSchoolId.json.billingPlan?.length, 1);
    console.log("✓ missing client schoolId → allowed with JWT");

    const bodyMismatch = await jsonFetch(patchApi(learnerA.id), {
      method: "PATCH",
      token: tokenFinanceA,
      body: {
        schoolId: schoolB.id,
        billingPlan: [{ feeDescription: "Mismatch", amount: 1 }],
      },
    });
    assert.equal(bodyMismatch.status, 403);
    assert.equal(bodyMismatch.json.code, "SCHOOL_MISMATCH");
    console.log("✓ body schoolId ≠ JWT → 403 SCHOOL_MISMATCH");

    const queryMismatch = await jsonFetch(
      patchApi(learnerA.id, `?schoolId=${encodeURIComponent(schoolB.id)}`),
      {
        method: "PATCH",
        token: tokenFinanceA,
        body: { billingPlan: [{ feeDescription: "QMismatch", amount: 1 }] },
      }
    );
    assert.equal(queryMismatch.status, 403);
    assert.equal(queryMismatch.json.code, "SCHOOL_MISMATCH");
    console.log("✓ query schoolId ≠ JWT → 403 SCHOOL_MISMATCH");

    const cross = await jsonFetch(patchApi(learnerB.id), {
      method: "PATCH",
      token: tokenFinanceA,
      body: { billingPlan: [{ feeDescription: "Cross", amount: 99 }] },
    });
    assert.equal(cross.status, 404);
    const bLines = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerB.id },
    });
    assert.equal(bLines, 0);
    console.log("✓ cross-school learner → 404 / not mutated");

    assert.equal(
      (
        await jsonFetch(patchAlias(learnerA.id), {
          method: "PATCH",
          body: { billingPlan: [{ feeDescription: "Alias", amount: 1 }] },
        })
      ).status,
      401
    );
    const aliasOk = await jsonFetch(patchAlias(learnerA.id), {
      method: "PATCH",
      token: tokenOwnerA,
      body: { billingPlan: [{ feeDescription: "AliasOk", amount: 75 }] },
    });
    assert.equal(aliasOk.status, 200);
    assert.equal(aliasOk.json.billingPlan?.[0]?.feeDescription, "AliasOk");
    console.log("✓ /learner alias protected + authorized success");

    // SEC-02B regression: generic PUT still rejects billingPlan
    const putReject = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`, {
      method: "PUT",
      token: tokenOwnerA,
      body: {
        firstName: "ShouldNotChange",
        billingPlan: [{ feeDescription: "ViaPut", amount: 1 }],
      },
    });
    assert.equal(putReject.status, 400);
    assert.equal(putReject.json.code, "USE_BILLING_PLAN_ENDPOINT");
    const learnerAfterPut = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.equal(learnerAfterPut?.firstName, "Bill");
    console.log("✓ SEC-02B regression: PUT billingPlan still rejected");

    assert.ok(tokenAdminB);
  } finally {
    await close();
    await prisma.learnerBillingPlanCleared.deleteMany({
      where: { learnerId: { in: [learnerA.id, learnerB.id] } },
    });
    await prisma.learnerBillingPlanLine.deleteMany({
      where: { learnerId: { in: [learnerA.id, learnerB.id] } },
    });
    await prisma.learner.deleteMany({ where: { id: { in: [learnerA.id, learnerB.id] } } });
    const userIds = [
      ownerA.id,
      financeA.id,
      adminA.id,
      teacherA.id,
      viewerA.id,
      adminB.id,
    ];
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
  }
}

async function main() {
  testBillingPlanEditAuthDecisions();
  await runLiveRouteTests();
  console.log("\nAll SEC-02C billing-plan security tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
