/**
 * SEC-02B — PUT /api/learners/:id authorization + billingPlan rejection.
 *
 * Run: npx tsx src/routes/learnerPut.security.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { setUserAccessMeta } from "../utils/userAccessStore";
import { permissionsForRole } from "../utils/userPermissions";
import learnerRoutes from "./learner";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
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

async function main() {
  const suffix = Date.now();
  const schoolA = await prisma.school.create({
    data: { name: `SEC02B A ${suffix}`, email: `sec02b-a-${suffix}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `SEC02B B ${suffix}`, email: `sec02b-b-${suffix}@test.local` },
  });

  const ownerA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02b-owner-a-${suffix}@test.local`,
    appRole: "Owner",
  });
  const adminA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02b-admin-a-${suffix}@test.local`,
    appRole: "Admin",
  });
  const financeA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02b-finance-a-${suffix}@test.local`,
    appRole: "Finance",
    prismaRole: "FINANCE",
  });
  const teacherA = await createStaffUser({
    schoolId: schoolA.id,
    email: `sec02b-teacher-a-${suffix}@test.local`,
    appRole: "Teacher",
    prismaRole: "STAFF",
  });
  const adminB = await createStaffUser({
    schoolId: schoolB.id,
    email: `sec02b-admin-b-${suffix}@test.local`,
    appRole: "Admin",
  });

  // learners.edit without parents.edit — must fail when parents payload present
  const learnerEditorOnly = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `sec02b-learner-edit-only-${suffix}@test.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Learner Editor Only",
    },
  });
  const learnerEditOnlyPerms = permissionsForRole("Admin");
  learnerEditOnlyPerms.parents = {
    ...(learnerEditOnlyPerms.parents || {}),
    create: false,
    edit: false,
  };
  await setUserAccessMeta(learnerEditorOnly.id, {
    schoolId: schoolA.id,
    appRole: "Admin",
    firstName: "Learner",
    surname: "EditorOnly",
    permissions: learnerEditOnlyPerms,
    lastLoginAt: null,
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
  const tokenLearnerEditOnly = signToken({
    userId: learnerEditorOnly.id,
    schoolId: schoolA.id,
    email: learnerEditorOnly.email,
    role: "SCHOOL_ADMIN",
  });

  const learnerA = await prisma.learner.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Put",
      lastName: "Target",
      grade: "R",
      className: "R-A",
      admissionNo: `SEC02B-${suffix}`,
      enrollmentStatus: "ACTIVE",
      tuitionFee: 100,
    },
  });
  const learnerB = await prisma.learner.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Other",
      lastName: "School",
      grade: "1",
      className: "1-A",
      admissionNo: `SEC02B-B-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });

  await prisma.learnerBillingPlanLine.create({
    data: {
      schoolId: schoolA.id,
      learnerId: learnerA.id,
      feeDescription: "SEC-02B probe fee",
      amount: 250,
      sortOrder: 0,
    },
  });
  const plansBefore = await prisma.learnerBillingPlanLine.count({
    where: { learnerId: learnerA.id },
  });

  const { base, close } = await startServer();
  const putApi = (learnerId: string) =>
    `${base}/api/learners/${encodeURIComponent(learnerId)}`;
  const putAlias = (learnerId: string) =>
    `${base}/learner/${encodeURIComponent(learnerId)}`;

  try {
    assert.equal(
      (
        await jsonFetch(putApi(learnerA.id), {
          method: "PUT",
          body: { firstName: "Hacked", className: "X" },
        })
      ).status,
      401
    );
    console.log("✓ unauthenticated learner-only PUT → 401");

    assert.equal(
      (
        await jsonFetch(putApi(learnerA.id), {
          method: "PUT",
          token: tokenTeacherA,
          body: { firstName: "TeacherEdit" },
        })
      ).status,
      403
    );
    console.log("✓ Teacher without learners.edit → 403");

    assert.equal(
      (
        await jsonFetch(putApi(learnerA.id), {
          method: "PUT",
          token: tokenFinanceA,
          body: { firstName: "FinanceEdit" },
        })
      ).status,
      403
    );
    console.log("✓ Finance without learners.edit → 403");

    const ownerOk = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenOwnerA,
      body: { firstName: "OwnerPut", className: "R-B", grade: "R" },
    });
    assert.equal(ownerOk.status, 200);
    assert.equal(ownerOk.json.success, true);
    assert.equal(ownerOk.json.learner?.firstName, "OwnerPut");
    assert.equal(ownerOk.json.learner?.className, "R-B");
    assert.ok(Array.isArray(ownerOk.json.billingPlan));
    console.log("✓ Owner same-school learner-only PUT → 200");

    const adminOk = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenAdminA,
      body: { firstName: "AdminPut" },
    });
    assert.equal(adminOk.status, 200);
    assert.equal(adminOk.json.learner?.firstName, "AdminPut");
    console.log("✓ Admin same-school learner-only PUT → 200");

    const cross = await jsonFetch(putApi(learnerB.id), {
      method: "PUT",
      token: tokenAdminA,
      body: { firstName: "CrossHack" },
    });
    assert.equal(cross.status, 404);
    const learnerBAfter = await prisma.learner.findUnique({ where: { id: learnerB.id } });
    assert.equal(learnerBAfter?.firstName, "Other");
    console.log("✓ cross-school learner id → 404 / not mutated");

    const schoolOverride = await jsonFetch(putApi(learnerB.id), {
      method: "PUT",
      token: tokenAdminA,
      body: { firstName: "Override", schoolId: schoolB.id },
    });
    assert.ok(schoolOverride.status === 403 || schoolOverride.status === 404);
    const learnerBStill = await prisma.learner.findUnique({ where: { id: learnerB.id } });
    assert.equal(learnerBStill?.firstName, "Other");
    console.log("✓ client schoolId cannot authorize foreign learner");

    const parentsDenied = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenFinanceA,
      body: {
        firstName: "FinParent",
        parents: [{ firstName: "P", surname: "Q", cellNo: "0820000001", relation: "Mother" }],
      },
    });
    assert.equal(parentsDenied.status, 403);
    console.log("✓ parents payload still requires learners.edit (Finance denied)");

    const parentsEditMissing = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenLearnerEditOnly,
      body: {
        firstName: "NoParentsPerm",
        parents: [
          {
            firstName: "Pat",
            surname: "Denied",
            cellNo: "0820000088",
            relation: "Mother",
            isPrimary: true,
          },
        ],
      },
    });
    assert.equal(parentsEditMissing.status, 403);
    assert.equal(parentsEditMissing.json.code, "FORBIDDEN_PERMISSION");
    const afterParentsDenied = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.notEqual(afterParentsDenied?.firstName, "NoParentsPerm");
    console.log("✓ parents payload requires parents.edit in addition to learners.edit");

    // Same user can still do learner-only PUT
    const learnerOnlyWithEdit = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenLearnerEditOnly,
      body: { firstName: "LearnerEditOnlyOk" },
    });
    assert.equal(learnerOnlyWithEdit.status, 200);
    assert.equal(learnerOnlyWithEdit.json.learner?.firstName, "LearnerEditOnlyOk");
    console.log("✓ learner-only payload requires auth even with no parents");

    const parentsOk = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenAdminA,
      body: {
        firstName: "WithParent",
        parents: [
          {
            firstName: "Pat",
            surname: "Parent",
            cellNo: "0820000099",
            relation: "Mother",
            isPrimary: true,
          },
        ],
      },
    });
    assert.equal(parentsOk.status, 200);
    assert.equal(parentsOk.json.learner?.firstName, "WithParent");
    assert.ok((parentsOk.json.learner?.parents || []).length >= 1);
    console.log("✓ Owner/Admin parents payload (learners.edit + parents.edit) works");

    const beforeBillingReject = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    const billingReject = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenOwnerA,
      body: {
        firstName: "ShouldNotApply",
        billingPlan: [{ feeDescription: "Evil", amount: 999 }],
      },
    });
    assert.equal(billingReject.status, 400);
    assert.equal(billingReject.json.code, "USE_BILLING_PLAN_ENDPOINT");
    const afterBillingReject = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.equal(afterBillingReject?.firstName, beforeBillingReject?.firstName);
    const plansAfterReject = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerA.id },
    });
    assert.equal(plansAfterReject, plansBefore);
    console.log("✓ billingPlan on PUT → 400 before mutation; zero plan writes");

    const medical = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenOwnerA,
      body: { allergies: "Peanuts" },
    });
    assert.equal(medical.status, 400);
    assert.equal(medical.json.code, "USE_SENSITIVE_FIELDS_ENDPOINT");
    console.log("✓ medical fields still → USE_SENSITIVE_FIELDS_ENDPOINT");

    const statusAttempt = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenOwnerA,
      body: { firstName: "StatusSafe", enrollmentStatus: "HISTORICAL" },
    });
    assert.equal(statusAttempt.status, 200);
    const afterStatus = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.equal(afterStatus?.enrollmentStatus, "ACTIVE");
    assert.equal(afterStatus?.firstName, "StatusSafe");
    console.log("✓ enrollmentStatus cannot be changed through PUT");

    const familyAttempt = await jsonFetch(putApi(learnerA.id), {
      method: "PUT",
      token: tokenOwnerA,
      body: { firstName: "FamilySafe", familyAccountId: "fake-family-id" },
    });
    assert.equal(familyAttempt.status, 200);
    const afterFamily = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.notEqual(afterFamily?.familyAccountId, "fake-family-id");
    assert.equal(afterFamily?.firstName, "FamilySafe");
    console.log("✓ familyAccountId cannot be changed through PUT");

    assert.equal(
      (
        await jsonFetch(putAlias(learnerA.id), {
          method: "PUT",
          body: { firstName: "AliasHack" },
        })
      ).status,
      401
    );
    const aliasOk = await jsonFetch(putAlias(learnerA.id), {
      method: "PUT",
      token: tokenOwnerA,
      body: { firstName: "AliasOk" },
    });
    assert.equal(aliasOk.status, 200);
    assert.equal(aliasOk.json.learner?.firstName, "AliasOk");
    console.log("✓ /learner alias protected + authorized success");

    const plansFinal = await prisma.learnerBillingPlanLine.count({
      where: { learnerId: learnerA.id },
    });
    assert.equal(plansFinal, plansBefore);
    console.log("✓ generic PUT performed zero LearnerBillingPlanLine writes");

    // tokenAdminB unused except proving other school tokens exist
    assert.ok(tokenAdminB);
  } finally {
    await close();
    await prisma.parentLearnerLink.deleteMany({
      where: { learnerId: { in: [learnerA.id, learnerB.id] } },
    });
    await prisma.parent.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.learnerBillingPlanLine.deleteMany({
      where: { learnerId: { in: [learnerA.id, learnerB.id] } },
    });
    await prisma.learner.deleteMany({ where: { id: { in: [learnerA.id, learnerB.id] } } });
    const userIds = [
      ownerA.id,
      adminA.id,
      financeA.id,
      teacherA.id,
      adminB.id,
      learnerEditorOnly.id,
    ];
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
  }

  console.log("\nAll SEC-02B learner PUT security tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
