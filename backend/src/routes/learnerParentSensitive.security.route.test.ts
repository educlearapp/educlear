/**
 * Security regression: legacy unauth learner/parent responses must not expose
 * allergies, medicalAlert, or newly-added Parent.birthDate.
 *
 * Run: npx tsx src/routes/learnerParentSensitive.security.route.test.ts
 *
 * Pure serializer/auth contract tests always run.
 * Live route tests run only when additive columns exist in the local DB.
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { evaluateParentStaffAuth } from "../middleware/requireParentStaffAuth";
import { setUserAccessMeta } from "../utils/userAccessStore";
import { permissionsForRole } from "../utils/userPermissions";
import { mapLearnerDetailForClient, mapParentForClient } from "./learner";
import { mapParentForLegacyUnauthList } from "./parents";
import learnerRoutes from "./learner";
import parentsRoutes from "./parents";
import registrationsRoutes from "./registrations";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const SCHOOL_A = "sec-school-a-sensitive";
const SCHOOL_B = "sec-school-b-sensitive";

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

function assertNoMedicalKeys(row: Record<string, unknown>, label: string) {
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "allergies"), `${label}: allergies absent`);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(row, "medicalAlert"),
    `${label}: medicalAlert absent`
  );
}

function assertNoParentBirthDate(parent: Record<string, unknown>, label: string) {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(parent, "birthDate"),
    `${label}: birthDate absent`
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(parent, "dateOfBirth"),
    `${label}: dateOfBirth absent`
  );
}

function testLegacyLearnerSerializerOmitsMedical() {
  const mapped = mapLearnerDetailForClient({
    id: "l1",
    schoolId: SCHOOL_A,
    familyAccountId: null,
    firstName: "Med",
    lastName: "Kid",
    birthDate: new Date("2015-01-01T00:00:00.000Z"),
    gender: "F",
    idNumber: null,
    homeLanguage: null,
    citizenship: null,
    grade: "R",
    className: "R",
    enrollmentStatus: "ACTIVE",
    admissionNo: "A1",
    admissionDate: new Date("2024-01-15T00:00:00.000Z"),
    allergies: "Peanuts",
    medicalAlert: "EpiPen",
    tuitionFee: 0,
    transportFee: 0,
    otherFee: 0,
    totalFee: 0,
    createdAt: new Date(),
    notes: null,
    familyAccount: null,
    links: [
      {
        relation: "Mother",
        isPrimary: true,
        isPayingPerson: false,
        billingStatement: true,
        billingInvoice: true,
        billingReceipt: true,
        parent: {
          id: "p1",
          firstName: "Pat",
          surname: "Parent",
          birthDate: new Date("1980-03-10T00:00:00.000Z"),
          cellNo: "082",
          idNumber: null,
          email: null,
        },
      },
    ],
  });
  assertNoMedicalKeys(mapped as any, "mapLearnerDetailForClient");
  assert.ok(Object.prototype.hasOwnProperty.call(mapped, "admissionDate"));
  const parents = (mapped as any).parents || [];
  assert.equal(parents.length, 1);
  assertNoParentBirthDate(parents[0], "mapParentForClient via detail");
  console.log("✓ legacy learner detail serializer omits allergies/medicalAlert/parent.birthDate");
}

function testLegacyParentListOmitsBirthDate() {
  const stripped = mapParentForLegacyUnauthList({
    id: "p1",
    schoolId: SCHOOL_A,
    firstName: "Pat",
    surname: "Parent",
    birthDate: new Date("1980-03-10T00:00:00.000Z"),
    cellNo: "082",
  });
  assertNoParentBirthDate(stripped as any, "mapParentForLegacyUnauthList");
  assert.equal((stripped as any).firstName, "Pat");
  console.log("✓ legacy parent list mapper omits Parent.birthDate");
}

function testSensitiveWriteAuthDecisions() {
  const jwtA = { userId: "u1", schoolId: SCHOOL_A, email: "a@ex.com", role: "SCHOOL_ADMIN" };
  const userA = { id: "u1", schoolId: SCHOOL_A, role: "SCHOOL_ADMIN", isActive: true };

  const noAuth = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: SCHOOL_A,
  });
  assert.equal(noAuth.allowed, false);
  if (!noAuth.allowed) assert.equal(noAuth.status, 401);

  const cross = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: SCHOOL_B,
  });
  assert.equal(cross.allowed, false);
  if (!cross.allowed) {
    assert.equal(cross.status, 403);
    assert.equal(cross.code, "SCHOOL_MISMATCH");
  }

  const ok = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "learners", action: "edit" },
    requestSchoolId: SCHOOL_A,
  });
  assert.equal(ok.allowed, true);
  console.log("✓ medical write auth: 401 / cross-school 403 / same-school allowed");
}

function testParentDobWriteAuthDecisions() {
  const jwtA = { userId: "u1", schoolId: SCHOOL_A, email: "a@ex.com", role: "SCHOOL_ADMIN" };
  const userA = { id: "u1", schoolId: SCHOOL_A, role: "SCHOOL_ADMIN", isActive: true };

  const noAuth = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "parents", action: "edit" },
    requestSchoolId: SCHOOL_A,
  });
  assert.equal(noAuth.allowed, false);
  if (!noAuth.allowed) assert.equal(noAuth.status, 401);

  const cross = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "parents", action: "edit" },
    requestSchoolId: SCHOOL_B,
  });
  assert.equal(cross.allowed, false);
  if (!cross.allowed) assert.equal(cross.status, 403);

  const ok = evaluateParentStaffAuth({
    jwtPayload: jwtA,
    user: userA,
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "parents", action: "edit" },
    requestSchoolId: SCHOOL_A,
  });
  assert.equal(ok.allowed, true);
  console.log("✓ parent DOB write auth: 401 / cross-school 403 / same-school allowed");
}

async function additiveColumnsPresent(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe(
      `SELECT "allergies", "medicalAlert", "admissionDate" FROM "Learner" LIMIT 0`
    );
    await prisma.$queryRawUnsafe(`SELECT "birthDate" FROM "Parent" LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/learners", learnerRoutes);
  app.use("/api/parents", parentsRoutes);
  app.use("/api/registrations", registrationsRoutes);
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

async function runLiveRouteTests() {
  const suffix = Date.now();
  const schoolA = await prisma.school.create({
    data: { name: `Sens Sec A ${suffix}`, email: `sens-a-${suffix}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `Sens Sec B ${suffix}`, email: `sens-b-${suffix}@test.local` },
  });

  const userA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `sens-admin-a-${suffix}@test.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Admin A",
    },
  });
  const userB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `sens-admin-b-${suffix}@test.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Admin B",
    },
  });
  await setUserAccessMeta(userA.id, {
    schoolId: schoolA.id,
    appRole: "Admin",
    firstName: "Admin",
    surname: "A",
    permissions: permissionsForRole("Admin"),
    lastLoginAt: null,
  });
  await setUserAccessMeta(userB.id, {
    schoolId: schoolB.id,
    appRole: "Admin",
    firstName: "Admin",
    surname: "B",
    permissions: permissionsForRole("Admin"),
    lastLoginAt: null,
  });

  const tokenA = signToken({
    userId: userA.id,
    schoolId: schoolA.id,
    email: userA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenB = signToken({
    userId: userB.id,
    schoolId: schoolB.id,
    email: userB.email,
    role: "SCHOOL_ADMIN",
  });

  const learnerA = await prisma.learner.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Med",
      lastName: "Kid",
      grade: "R",
      className: "R",
      admissionNo: `MED-${suffix}`,
      enrollmentStatus: "ACTIVE",
      allergies: "Peanuts",
      medicalAlert: "EpiPen",
      admissionDate: new Date("2024-01-15T00:00:00.000Z"),
    },
  });
  const parentA = await prisma.parent.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Pat",
      surname: "Parent",
      cellNo: "0820000001",
      birthDate: new Date("1980-03-10T00:00:00.000Z"),
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parentA.id,
      learnerId: learnerA.id,
      relation: "Mother",
    },
  });
  const learnerB = await prisma.learner.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Other",
      lastName: "Kid",
      grade: "1",
      className: "1",
      admissionNo: `OTH-${suffix}`,
      enrollmentStatus: "ACTIVE",
      allergies: "Shellfish",
      medicalAlert: "Asthma",
    },
  });

  const { base, close } = await startServer();
  try {
    const list = await jsonFetch(
      `${base}/api/learners?schoolId=${encodeURIComponent(schoolA.id)}`
    );
    assert.equal(list.status, 200);
    const listRow = (list.json.learners || []).find(
      (r: any) => String(r.id) === String(learnerA.id)
    );
    assert.ok(listRow);
    assertNoMedicalKeys(listRow, "GET /api/learners row");
    for (const p of listRow.parents || []) {
      assertNoParentBirthDate(p, "GET /api/learners embedded parent");
    }
    console.log("✓ GET /api/learners unauth: no allergies/medicalAlert/parent.birthDate");

    const detail = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`);
    assert.equal(detail.status, 200);
    const detailLearner = detail.json.learner || detail.json;
    assertNoMedicalKeys(detailLearner, "GET /api/learners/:id");
    for (const p of detailLearner.parents || []) {
      assertNoParentBirthDate(p, "GET /api/learners/:id embedded parent");
    }
    console.log("✓ GET /api/learners/:id unauth: no allergies/medicalAlert/parent.birthDate");

    const parentsList = await jsonFetch(
      `${base}/api/parents?schoolId=${encodeURIComponent(schoolA.id)}`
    );
    assert.equal(parentsList.status, 200);
    const parentRow = (parentsList.json.parents || []).find(
      (p: any) => String(p.id) === String(parentA.id)
    );
    assert.ok(parentRow);
    assertNoParentBirthDate(parentRow, "GET /api/parents");
    console.log("✓ GET /api/parents unauth: no Parent.birthDate");

    const legacyPut = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`, {
      method: "PUT",
      body: { allergies: "HACK", medicalAlert: "HACK" },
    });
    assert.equal(legacyPut.status, 400);
    const afterHack = await prisma.learner.findUnique({ where: { id: learnerA.id } });
    assert.equal(afterHack?.allergies, "Peanuts");
    console.log("✓ PUT /api/learners/:id rejects medical fields");

    assert.equal(
      (
        await jsonFetch(
          `${base}/api/learners/${encodeURIComponent(learnerA.id)}/sensitive-fields`
        )
      ).status,
      401
    );
    assert.equal(
      (
        await jsonFetch(
          `${base}/api/learners/${encodeURIComponent(learnerA.id)}/sensitive-fields`,
          { token: tokenB }
        )
      ).status,
      403
    );
    const sensOk = await jsonFetch(
      `${base}/api/learners/${encodeURIComponent(learnerA.id)}/sensitive-fields`,
      { token: tokenA }
    );
    assert.equal(sensOk.status, 200);
    assert.equal(sensOk.json.allergies, "Peanuts");
    assert.equal(sensOk.json.medicalAlert, "EpiPen");
    console.log("✓ GET sensitive-fields: 401 / 403 / same-school medical");

    assert.equal(
      (
        await jsonFetch(
          `${base}/api/learners/${encodeURIComponent(learnerA.id)}/sensitive-fields`,
          { method: "PUT", body: { allergies: "Dairy" } }
        )
      ).status,
      401
    );
    assert.equal(
      (
        await jsonFetch(
          `${base}/api/learners/${encodeURIComponent(learnerA.id)}/sensitive-fields`,
          { method: "PUT", token: tokenB, body: { allergies: "Dairy" } }
        )
      ).status,
      403
    );
    const putOk = await jsonFetch(
      `${base}/api/learners/${encodeURIComponent(learnerA.id)}/sensitive-fields`,
      {
        method: "PUT",
        token: tokenA,
        body: { allergies: "Dairy", medicalAlert: "Inhaler" },
      }
    );
    assert.equal(putOk.status, 200);
    assert.equal(putOk.json.allergies, "Dairy");
    console.log("✓ PUT sensitive-fields: 401 / 403 / same-school allowed");

    assert.equal(
      (
        await jsonFetch(`${base}/api/parents/${encodeURIComponent(parentA.id)}`, {
          method: "PUT",
          body: { birthDate: "1990-01-01" },
        })
      ).status,
      401
    );
    assert.equal(
      (
        await jsonFetch(`${base}/api/parents/${encodeURIComponent(parentA.id)}`, {
          method: "PUT",
          token: tokenB,
          body: { birthDate: "1990-01-01" },
        })
      ).status,
      403
    );
    const parentPutOk = await jsonFetch(
      `${base}/api/parents/${encodeURIComponent(parentA.id)}`,
      { method: "PUT", token: tokenA, body: { birthDate: "1991-05-05" } }
    );
    assert.equal(parentPutOk.status, 200);
    assert.equal(String(parentPutOk.json.parent?.birthDate || "").slice(0, 10), "1991-05-05");
    const parentClear = await jsonFetch(
      `${base}/api/parents/${encodeURIComponent(parentA.id)}`,
      { method: "PUT", token: tokenA, body: { birthDate: null } }
    );
    assert.equal(parentClear.status, 200);
    assert.equal(parentClear.json.parent?.birthDate, null);
    console.log("✓ Parent DOB write live: 401 / 403 / allowed + clear");

    assert.equal(
      (
        await jsonFetch(
          `${base}/api/registrations/learners?schoolId=${encodeURIComponent(schoolA.id)}`
        )
      ).status,
      401
    );
    assert.equal(
      (
        await jsonFetch(
          `${base}/api/registrations/learners?schoolId=${encodeURIComponent(schoolA.id)}`,
          { token: tokenB }
        )
      ).status,
      403
    );
    const regOk = await jsonFetch(
      `${base}/api/registrations/learners?schoolId=${encodeURIComponent(schoolA.id)}`,
      { token: tokenA }
    );
    assert.equal(regOk.status, 200);
    const regRow = (regOk.json.learners || []).find(
      (r: any) => String(r.id) === String(learnerA.id)
    );
    assert.ok(regRow);
    assert.equal(regRow.allergies, "Dairy");
    assert.equal(regRow.medicalAlert, "Inhaler");
    console.log("✓ GET /api/registrations/learners auth same-school returns medical");

    assert.equal(
      (
        await jsonFetch(
          `${base}/api/learners/${encodeURIComponent(learnerB.id)}/sensitive-fields`,
          { token: tokenA }
        )
      ).status,
      403
    );
    console.log("✓ cannot read School B medical as School A");
  } finally {
    await close();
    await prisma.parentLearnerLink.deleteMany({
      where: { learnerId: { in: [learnerA.id, learnerB.id] } },
    });
    await prisma.parent.deleteMany({ where: { id: parentA.id } });
    await prisma.learner.deleteMany({ where: { id: { in: [learnerA.id, learnerB.id] } } });
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
  }
}

async function main() {
  testLegacyLearnerSerializerOmitsMedical();
  testLegacyParentListOmitsBirthDate();
  testSensitiveWriteAuthDecisions();
  testParentDobWriteAuthDecisions();

  // Silence unused export warning in some tooling by referencing mapParentForClient
  assert.ok(typeof mapParentForClient === "function");

  if (await additiveColumnsPresent()) {
    await runLiveRouteTests();
  } else {
    console.log(
      "⚠ skipping live route tests — additive Parent.birthDate / Learner medical columns not in local DB yet"
    );
  }

  console.log("\nAll learner/parent sensitive security tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
