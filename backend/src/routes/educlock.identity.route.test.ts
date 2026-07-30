/**
 * EduClock Build 1 identity activation tests.
 * Run: npx tsc && node dist/routes/educlock.identity.route.test.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import educlockRoutes from "./educlock";
import {
  identityEqualsStored,
  maskIdentityNumber,
  normalizeIdentityForComparison,
  validateIdentityInput,
} from "../services/employeeIdentityVerification";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function apiCall(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; token?: string } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
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
  const VALID_SA_ID = "9001015800088";
  const PASSPORT_NO = "A1234567";
  const PERMIT_NO = "P-998877";
  const ALT_SA_MISSING_NUMBER = "9101015800086";
  const ALT_SA_INACTIVE = "8701015800084";
  const ALT_SA_UNKNOWN = "8001015009087";

  const school = await prisma.school.create({ data: { name: `EduClock Test ${stamp}` } });
  const other = await prisma.school.create({ data: { name: `EduClock Other ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const owner = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `owner-educlock-${stamp}@example.com`,
      fullName: "Owner User",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: school.id,
          firstName: "Owner",
          surname: "User",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });

  const staff = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `staff-educlock-${stamp}@example.com`,
      fullName: "Staff User",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: school.id,
          firstName: "Staff",
          surname: "User",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });

  const otherStaff = await prisma.user.create({
    data: {
      schoolId: other.id,
      email: `other-educlock-${stamp}@example.com`,
      passwordHash,
      role: "STAFF",
      isActive: true,
    },
  });

  const empSa = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Alice",
      lastName: "SA",
      fullName: "Alice SA",
      employeeNumber: "EMP-001",
      idNumber: VALID_SA_ID,
      identityType: "SA_ID",
      identityCountryCode: "ZA",
      isActive: true,
      email: staff.email,
    },
  });

  const empPass = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Bob",
      lastName: "Passport",
      employeeNumber: "EMP-002",
      idNumber: PASSPORT_NO,
      identityType: "PASSPORT",
      identityCountryCode: "MW",
      isActive: true,
    },
  });

  const empPermit = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Cara",
      lastName: "Permit",
      employeeNumber: "EMP-003",
      idNumber: PERMIT_NO,
      identityType: "PERMIT",
      identityCountryCode: "ZA",
      isActive: true,
    },
  });

  const staffToken = signToken({
    userId: staff.id,
    schoolId: school.id,
    email: staff.email,
    role: "STAFF",
  });
  const ownerToken = signToken({
    userId: owner.id,
    schoolId: school.id,
    email: owner.email,
    role: "SCHOOL_ADMIN",
  });
  const otherToken = signToken({
    userId: otherStaff.id,
    schoolId: other.id,
    email: otherStaff.email,
    role: "STAFF",
  });

  const app = express();
  app.use(express.json());
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const salaryBefore = await prisma.employee.findUnique({ where: { id: empSa.id } });

  try {
    assert(maskIdentityNumber(VALID_SA_ID) === "**********088", "mask last 3");
    assert(validateIdentityInput({ identityType: "SA_ID", identityNumber: VALID_SA_ID }).valid, "SA valid");
    assert(
      validateIdentityInput({
        identityType: "PASSPORT",
        identityNumber: PASSPORT_NO,
        identityCountryCode: "MW",
      }).valid,
      "passport valid"
    );
    assert(
      validateIdentityInput({
        identityType: "PERMIT",
        identityNumber: PERMIT_NO,
        identityCountryCode: "ZA",
      }).valid,
      "permit valid"
    );
    const norm = normalizeIdentityForComparison("SA_ID", VALID_SA_ID)!;
    assert(
      identityEqualsStored({
        submittedType: "SA_ID",
        submittedNormalized: norm.normalized,
        submittedCountry: "ZA",
        storedIdNumber: VALID_SA_ID,
        storedIdentityType: "SA_ID",
        storedCountryCode: "ZA",
      }),
      "identity equals"
    );

    let res = await apiCall(baseUrl, "/api/educlock/me", { token: staffToken });
    assert(res.status === 200, "me 200");
    assert(res.json.status === "NOT_ACTIVATED", "not activated");
    assert(!JSON.stringify(res.json).includes(VALID_SA_ID), "me no raw id");

    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: staffToken,
      body: { identityType: "SA_ID", identityNumber: VALID_SA_ID },
    });
    assert(res.status === 200, `activate SA ${JSON.stringify(res.json)}`);
    assert(res.json.employeeId === empSa.id, "linked emp");
    assert(res.json.identityMasked === "**********088", "masked response");
    assert(!JSON.stringify(res.json).includes(VALID_SA_ID), "no raw id in activate");

    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: staffToken,
      body: { identityType: "SA_ID", identityNumber: VALID_SA_ID },
    });
    assert(res.status === 409 && res.json.code === "EDUCLOCK_ACTIVATION_ALREADY_COMPLETE", "repeat blocked");

    await prisma.employee.update({ where: { id: empSa.id }, data: { userId: null } });
    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: staffToken,
      body: {
        identityType: "SA_ID",
        identityNumber: VALID_SA_ID,
        employeeId: empSa.id,
        schoolId: other.id,
      },
    });
    assert(res.status === 400, "reject client override fields");

    const passportUser = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `passport-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: school.id,
            firstName: "P",
            surname: "U",
            appRole: "Teacher",
            permissions: {},
          },
        },
      },
    });
    const passportToken = signToken({
      userId: passportUser.id,
      schoolId: school.id,
      email: passportUser.email,
      role: "STAFF",
    });
    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: passportToken,
      body: { identityType: "PASSPORT", identityNumber: PASSPORT_NO, identityCountryCode: "MW" },
    });
    assert(res.status === 200 && res.json.employeeId === empPass.id, "passport activate");
    assert(!JSON.stringify(res.json).includes(PASSPORT_NO), "no passport leak");

    const permitUser = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `permit-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: school.id,
            firstName: "Q",
            surname: "U",
            appRole: "Teacher",
            permissions: {},
          },
        },
      },
    });
    const permitToken = signToken({
      userId: permitUser.id,
      schoolId: school.id,
      email: permitUser.email,
      role: "STAFF",
    });
    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: permitToken,
      body: { identityType: "PERMIT", identityNumber: PERMIT_NO, identityCountryCode: "ZA" },
    });
    assert(res.status === 200 && res.json.employeeId === empPermit.id, "permit activate");

    const noFind = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `nofind-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: school.id,
            firstName: "N",
            surname: "F",
            appRole: "Teacher",
            permissions: {},
          },
        },
      },
    });
    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: signToken({ userId: noFind.id, schoolId: school.id, email: noFind.email, role: "STAFF" }),
      body: { identityType: "SA_ID", identityNumber: ALT_SA_UNKNOWN },
    });
    assert(res.status === 404 && res.json.code === "EDUCLOCK_IDENTITY_NOT_FOUND", "not found");

    await prisma.employee.create({
      data: {
        schoolId: school.id,
        firstName: "No",
        lastName: "Number",
        employeeNumber: null,
        idNumber: ALT_SA_MISSING_NUMBER,
        identityType: "SA_ID",
        isActive: true,
      },
    });
    const noNumUser = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `nonumber-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: school.id,
            firstName: "N",
            surname: "N",
            appRole: "Teacher",
            permissions: {},
          },
        },
      },
    });
    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: signToken({
        userId: noNumUser.id,
        schoolId: school.id,
        email: noNumUser.email,
        role: "STAFF",
      }),
      body: { identityType: "SA_ID", identityNumber: ALT_SA_MISSING_NUMBER },
    });
    assert(res.status === 403 && res.json.code === "EDUCLOCK_EMPLOYEE_MISSING_NUMBER", "missing number");

    await prisma.employee.create({
      data: {
        schoolId: school.id,
        firstName: "In",
        lastName: "Active",
        employeeNumber: "EMP-INACTIVE",
        idNumber: ALT_SA_INACTIVE,
        identityType: "SA_ID",
        isActive: false,
      },
    });
    const inactiveUser = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `inactive-${stamp}@example.com`,
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: school.id,
            firstName: "I",
            surname: "A",
            appRole: "Teacher",
            permissions: {},
          },
        },
      },
    });
    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: signToken({
        userId: inactiveUser.id,
        schoolId: school.id,
        email: inactiveUser.email,
        role: "STAFF",
      }),
      body: { identityType: "SA_ID", identityNumber: ALT_SA_INACTIVE },
    });
    assert(res.status === 403 && res.json.code === "EDUCLOCK_EMPLOYEE_INACTIVE", "inactive");

    res = await apiCall(baseUrl, "/api/educlock/owner/staff", { token: staffToken });
    assert(res.status === 403, "non-owner blocked");

    await prisma.employee.update({ where: { id: empSa.id }, data: { userId: staff.id } });
    res = await apiCall(baseUrl, "/api/educlock/owner/staff", { token: ownerToken });
    assert(res.status === 200, "owner list");
    assert(!JSON.stringify(res.json).includes(VALID_SA_ID), "owner list no raw id");

    res = await apiCall(baseUrl, `/api/educlock/owner/staff/${staff.id}/reset`, {
      method: "POST",
      token: ownerToken,
    });
    assert(res.status === 200, "owner reset");
    const afterReset = await prisma.employee.findUnique({ where: { id: empSa.id } });
    assert(afterReset?.userId === null, "unlinked");
    assert(afterReset?.employeeNumber === "EMP-001", "employee preserved");
    assert(afterReset?.idNumber === VALID_SA_ID, "id preserved");
    assert(String(afterReset?.basicSalary) === String(salaryBefore?.basicSalary), "salary untouched");

    res = await apiCall(baseUrl, `/api/educlock/owner/staff/${staff.id}/link`, {
      method: "POST",
      token: ownerToken,
      body: { employeeId: empSa.id },
    });
    assert(res.status === 200, "owner link");
    assert(!JSON.stringify(res.json).includes(VALID_SA_ID), "link no raw id");

    await prisma.user.update({
      where: { id: staff.id },
      data: { email: `renamed-staff-${stamp}@example.com` },
    });
    res = await apiCall(baseUrl, "/api/educlock/me", { token: staffToken });
    assert(res.json.status === "ACTIVE" && res.json.employeeId === empSa.id, "email change keeps link");

    res = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: otherToken,
      body: { identityType: "SA_ID", identityNumber: VALID_SA_ID },
    });
    assert(res.status === 404 && res.json.code === "EDUCLOCK_IDENTITY_NOT_FOUND", "wrong school");

    // No EduClockEvent table in Build 1 — confirm audits only
    const audits = await prisma.eduClockActivationAudit.findMany({ where: { schoolId: school.id } });
    assert(audits.length >= 1, "audit written");
    assert(
      audits.every((a) => !String(a.detail || "").includes(VALID_SA_ID.slice(0, 8))),
      "audit detail does not contain raw identity prefix"
    );

    console.log("✓ EduClock Build 1 identity activation tests passed");
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
