/**
 * Local EduClock Build 1 manual-acceptance fixture runner (API-level).
 * Creates disposable local school fixtures — never production.
 * Run: npx tsc && node dist/scripts/educlock-build1-acceptance-fixtures.js
 *
 * Does not print raw identity numbers.
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import educlockRoutes from "../routes/educlock";
import { maskIdentityNumber } from "../services/employeeIdentityVerification";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const SA_ID = "9001015800088";
const PASSPORT = "A1234567";
const PERMIT = "P-998877";
const WRONG_SA = "8001015009087";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sign(userId: string, schoolId: string, email: string, role = "STAFF") {
  return jwt.sign({ userId, schoolId, email, role }, JWT_SECRET, { expiresIn: "1h" });
}

async function api(baseUrl: string, path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  const stamp = Date.now();
  const passwordHash = await bcrypt.hash("AcceptPass123!", 10);
  const school = await prisma.school.create({ data: { name: `EduClock Accept ${stamp}` } });
  const other = await prisma.school.create({ data: { name: `EduClock Accept Other ${stamp}` } });

  const owner = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `owner-accept-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: { schoolId: school.id, firstName: "Owner", surname: "A", appRole: "Owner", permissions: {} },
      },
    },
  });
  const saUser = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `sa-accept-${stamp}@example.com`,
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: { schoolId: school.id, firstName: "SA", surname: "Staff", appRole: "Teacher", permissions: {} },
      },
    },
  });
  const passUser = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `pass-accept-${stamp}@example.com`,
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: { schoolId: school.id, firstName: "Pass", surname: "Staff", appRole: "Teacher", permissions: {} },
      },
    },
  });
  const permitUser = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `permit-accept-${stamp}@example.com`,
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: { schoolId: school.id, firstName: "Permit", surname: "Staff", appRole: "Teacher", permissions: {} },
      },
    },
  });

  const empSa = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "SA",
      lastName: "Emp",
      employeeNumber: "ACC-SA-01",
      idNumber: SA_ID,
      identityType: "SA_ID",
      isActive: true,
      basicSalary: 12000,
      overtimeHours: 1,
    },
  });
  const empPass = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Pass",
      lastName: "Emp",
      employeeNumber: "ACC-PASS-01",
      idNumber: PASSPORT,
      identityType: "PASSPORT",
      identityCountryCode: "MW",
      isActive: true,
    },
  });
  const empPermit = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Permit",
      lastName: "Emp",
      employeeNumber: "ACC-PERMIT-01",
      idNumber: PERMIT,
      identityType: "PERMIT",
      identityCountryCode: "ZA",
      isActive: true,
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const saToken = sign(saUser.id, school.id, saUser.email);
  const passToken = sign(passUser.id, school.id, passUser.email);
  const permitToken = sign(permitUser.id, school.id, permitUser.email);
  const ownerToken = sign(owner.id, school.id, owner.email, "SCHOOL_ADMIN");
  const outcomes: string[] = [];

  try {
    // A SA ID
    let res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: saToken,
      body: { identityType: "SA_ID", identityNumber: SA_ID },
    });
    assert(res.status === 200 && res.json.employeeId === empSa.id, "A SA activate");
    assert(res.json.identityMasked === maskIdentityNumber(SA_ID), "A masked");
    assert(!JSON.stringify(res.json).includes(SA_ID), "A no raw");
    outcomes.push("A SA ID activation: PASS");

    // E repeat login status
    res = await api(baseUrl, "/api/educlock/me", { token: saToken });
    assert(res.json.status === "ACTIVE", "E ACTIVE after activation");
    outcomes.push("E repeat-login /me ACTIVE: PASS");

    // B Passport
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: passToken,
      body: { identityType: "PASSPORT", identityNumber: PASSPORT, identityCountryCode: "MW" },
    });
    assert(res.status === 200 && res.json.employeeId === empPass.id, "B passport");
    outcomes.push("B Passport activation: PASS");

    // C Permit
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: permitToken,
      body: { identityType: "PERMIT", identityNumber: PERMIT, identityCountryCode: "ZA" },
    });
    assert(res.status === 200 && res.json.employeeId === empPermit.id, "C permit");
    outcomes.push("C Permit activation: PASS");

    // D failures — use fresh users where needed
    const failUser = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `fail-accept-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: { schoolId: school.id, firstName: "F", surname: "A", appRole: "Teacher", permissions: {} },
        },
      },
    });
    const failToken = sign(failUser.id, school.id, failUser.email);

    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: failToken,
      body: { identityType: "SA_ID", identityNumber: WRONG_SA },
    });
    assert(res.json.code === "EDUCLOCK_IDENTITY_NOT_FOUND", "D incorrect number");

    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: failToken,
      body: { identityType: "PASSPORT", identityNumber: SA_ID, identityCountryCode: "ZA" },
    });
    assert(res.status === 404 || res.status === 400, "D wrong type");

    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: failToken,
      body: { identityType: "PASSPORT", identityNumber: PASSPORT, identityCountryCode: "ZA" },
    });
    assert(res.json.code === "EDUCLOCK_IDENTITY_NOT_FOUND" || res.json.code === "EDUCLOCK_EMPLOYEE_ALREADY_LINKED", "D wrong country / already linked");

    // missing number
    const missingNo = await prisma.employee.create({
      data: {
        schoolId: school.id,
        firstName: "Miss",
        lastName: "No",
        employeeNumber: null,
        idNumber: "9101015800086",
        identityType: "SA_ID",
        isActive: true,
      },
    });
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: failToken,
      body: { identityType: "SA_ID", identityNumber: "9101015800086" },
    });
    assert(res.json.code === "EDUCLOCK_EMPLOYEE_MISSING_NUMBER", "D missing employeeNumber");

    // inactive
    await prisma.employee.update({ where: { id: missingNo.id }, data: { employeeNumber: "ACC-INACT", isActive: false } });
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: failToken,
      body: { identityType: "SA_ID", identityNumber: "9101015800086" },
    });
    assert(res.json.code === "EDUCLOCK_EMPLOYEE_INACTIVE", "D inactive");

    // already linked employee
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: failToken,
      body: { identityType: "SA_ID", identityNumber: SA_ID },
    });
    assert(res.json.code === "EDUCLOCK_EMPLOYEE_ALREADY_LINKED", "D employee already linked");

    // user already linked
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: saToken,
      body: { identityType: "SA_ID", identityNumber: SA_ID },
    });
    assert(res.json.code === "EDUCLOCK_ACTIVATION_ALREADY_COMPLETE", "D user already linked");

    // cross-school
    const crossUser = await prisma.user.create({
      data: {
        schoolId: other.id,
        email: `cross-accept-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
      },
    });
    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: sign(crossUser.id, other.id, crossUser.email),
      body: { identityType: "SA_ID", identityNumber: SA_ID },
    });
    assert(res.json.code === "EDUCLOCK_IDENTITY_NOT_FOUND", "D cross-school");
    outcomes.push("D failed activation cases: PASS");

    // F owner reset
    const beforeSalary = await prisma.employee.findUnique({ where: { id: empSa.id } });
    res = await api(baseUrl, `/api/educlock/owner/staff/${saUser.id}/reset`, {
      method: "POST",
      token: ownerToken,
    });
    assert(res.status === 200, "F reset");
    const afterReset = await prisma.employee.findUnique({ where: { id: empSa.id } });
    assert(afterReset?.userId === null, "F unlinked");
    assert(String(afterReset?.basicSalary) === String(beforeSalary?.basicSalary), "F salary intact");
    assert(afterReset?.employeeNumber === "ACC-SA-01", "F emp no intact");
    assert(afterReset?.idNumber === SA_ID, "F identity intact");

    res = await api(baseUrl, "/api/educlock/me", { token: saToken });
    assert(res.json.status === "NOT_ACTIVATED", "F NOT_ACTIVATED");

    res = await api(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: saToken,
      body: { identityType: "SA_ID", identityNumber: SA_ID },
    });
    assert(res.status === 200, "F reactivate");
    outcomes.push("F Owner reset + reactivate: PASS");

    // readiness endpoint
    res = await api(baseUrl, "/api/educlock/owner/readiness", { token: ownerToken });
    assert(res.status === 200 && res.json.counts, "readiness");
    assert(!JSON.stringify(res.json).includes(SA_ID), "readiness no raw");

    // non-owner blocked
    res = await api(baseUrl, "/api/educlock/owner/readiness", { token: saToken });
    assert(res.status === 403, "owner gate");

    console.log("EduClock Build 1 acceptance fixture outcomes:");
    for (const line of outcomes) console.log(" -", line);
    console.log("✓ acceptance fixtures passed (no raw identity printed)");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await prisma.eduClockActivationAudit.deleteMany({
      where: { schoolId: { in: [school.id, other.id] } },
    });
    await prisma.employee.deleteMany({ where: { schoolId: { in: [school.id, other.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: { user: { schoolId: { in: [school.id, other.id] } } },
    });
    await prisma.user.deleteMany({ where: { schoolId: { in: [school.id, other.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [school.id, other.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
