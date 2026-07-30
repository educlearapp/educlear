/**
 * EduClock Build 2 — Owner control centre / campus foundation tests.
 * Run: npx tsc && node dist/routes/educlock.build2.route.test.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import educlockRoutes from "./educlock";
import { EDUCLOCK_READINESS_REASONS } from "../services/educlockService";
import { maskIdentityNumber } from "../services/employeeIdentityVerification";

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

function responseContainsRawId(payload: unknown, rawId: string): boolean {
  return JSON.stringify(payload).includes(rawId);
}

async function main() {
  const stamp = Date.now();
  const VALID_SA_ID = "9001015800088";
  const LEADING_ZERO_NUMBER = "00123";

  const schoolA = await prisma.school.create({ data: { name: `EduClock B2 A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock B2 B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-b2-${stamp}@example.com`,
      fullName: "Owner A",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Owner",
          surname: "A",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });

  const manageUser = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `manage-b2-${stamp}@example.com`,
      fullName: "Manage Custom",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Manage",
          surname: "Custom",
          appRole: "Custom",
          permissions: {
            educlock: { manage: true, clock: true, viewOwn: true },
            dashboard: { view: true },
          },
        },
      },
    },
  });

  const teacherNoManage = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `teacher-b2-${stamp}@example.com`,
      fullName: "Teacher No Manage",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Teacher",
          surname: "NoManage",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });

  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `owner-b2-other-${stamp}@example.com`,
      fullName: "Owner B",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolB.id,
          firstName: "Owner",
          surname: "B",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });

  const empReady = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Ready",
      lastName: "Staff",
      fullName: "Ready Staff",
      employeeNumber: LEADING_ZERO_NUMBER,
      identityType: "SA_ID",
      idNumber: VALID_SA_ID,
      isActive: true,
    },
  });

  const empInactive = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Inactive",
      lastName: "Staff",
      fullName: "Inactive Staff",
      employeeNumber: "INACT-1",
      identityType: "SA_ID",
      idNumber: "9101015800086",
      isActive: false,
    },
  });

  const empMissingNumber = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Missing",
      lastName: "Number",
      fullName: "Missing Number",
      employeeNumber: null,
      identityType: "SA_ID",
      idNumber: "8701015800084",
      isActive: true,
    },
  });

  await prisma.employee.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Other",
      lastName: "School",
      fullName: "Other School",
      employeeNumber: LEADING_ZERO_NUMBER,
      identityType: "SA_ID",
      idNumber: "8001015009087",
      isActive: true,
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const ownerToken = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const manageToken = signToken({
    userId: manageUser.id,
    schoolId: schoolA.id,
    email: manageUser.email,
    role: "SCHOOL_ADMIN",
  });
  const teacherToken = signToken({
    userId: teacherNoManage.id,
    schoolId: schoolA.id,
    email: teacherNoManage.email,
    role: "STAFF",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  try {
    // Owner can open EduClock management APIs
    const ownerReady = await apiCall(baseUrl, "/api/educlock/owner/readiness", { token: ownerToken });
    assert(ownerReady.status === 200, `Owner readiness expected 200, got ${ownerReady.status}`);
    assert(ownerReady.json.schoolId === schoolA.id, "Owner readiness must be school-scoped");

    // User with educlock.manage can open
    const manageReady = await apiCall(baseUrl, "/api/educlock/owner/readiness", { token: manageToken });
    assert(manageReady.status === 200, `Manage user readiness expected 200, got ${manageReady.status}`);

    // User without permission blocked
    const teacherReady = await apiCall(baseUrl, "/api/educlock/owner/readiness", { token: teacherToken });
    assert(teacherReady.status === 403, `Teacher without manage expected 403, got ${teacherReady.status}`);

    // Cross-school body schoolId rejected
    const cross = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerToken,
      body: { name: "Hack Campus", schoolId: schoolB.id },
    });
    assert(cross.status === 403, `Cross-school campus create expected 403, got ${cross.status}`);

    // Readiness reasons accurate + leading zeros preserved
    const employees = ownerReady.json.employees as Array<Record<string, unknown>>;
    const readyRow = employees.find((e) => e.employeeId === empReady.id);
    assert(Boolean(readyRow), "Ready employee row missing");
    assert(readyRow!.employeeNumber === LEADING_ZERO_NUMBER, "Leading zeros must be preserved");
    assert(
      Array.isArray(readyRow!.reasons) &&
        (readyRow!.reasons as string[]).includes(EDUCLOCK_READINESS_REASONS.READY),
      "Ready reason missing"
    );
    assert(
      (readyRow!.reasons as string[]).includes(EDUCLOCK_READINESS_REASONS.USER_ACCOUNT_NOT_LINKED),
      "User Account Not Linked reason missing for unlinked ready employee"
    );

    const inactiveRow = employees.find((e) => e.employeeId === empInactive.id);
    assert(
      (inactiveRow!.reasons as string[]).includes(EDUCLOCK_READINESS_REASONS.EMPLOYEE_INACTIVE),
      "Employee Inactive reason missing"
    );

    const missingNoRow = employees.find((e) => e.employeeId === empMissingNumber.id);
    assert(
      (missingNoRow!.reasons as string[]).includes(EDUCLOCK_READINESS_REASONS.MISSING_EMPLOYEE_NUMBER),
      "Missing Employee Number reason missing"
    );

    // Raw identity never in API responses
    assert(!responseContainsRawId(ownerReady.json, VALID_SA_ID), "Raw SA ID leaked in readiness");
    const masked = maskIdentityNumber(VALID_SA_ID);
    assert(
      String(readyRow!.identityMasked) === masked,
      `Expected masked identity ${masked}, got ${readyRow!.identityMasked}`
    );

    // Duplicate employee number within school rejected
    const dup = await apiCall(baseUrl, "/api/educlock/owner/employees/numbers", {
      method: "POST",
      token: ownerToken,
      body: {
        updates: [{ employeeId: empMissingNumber.id, employeeNumber: LEADING_ZERO_NUMBER }],
      },
    });
    assert(dup.status === 409, `In-school duplicate number expected 409, got ${dup.status}`);

    // Same number allowed in different schools (already created on schoolB)
    const schoolBReady = await apiCall(baseUrl, "/api/educlock/owner/readiness", { token: ownerBToken });
    assert(schoolBReady.status === 200, "School B readiness failed");
    const bEmp = (schoolBReady.json.employees as Array<Record<string, unknown>>).find(
      (e) => e.employeeNumber === LEADING_ZERO_NUMBER
    );
    assert(Boolean(bEmp), "School B should keep same employee number string");

    // Campus + entrance school-scoped
    const campusCreate = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerToken,
      body: { name: "Main Campus", description: "Primary site", toleranceMetres: 4 },
    });
    assert(campusCreate.status === 201, `Campus create expected 201, got ${campusCreate.status}`);
    assert(campusCreate.json.schoolId === schoolA.id, "Campus schoolId mismatch");
    assert(campusCreate.json.toleranceMetres === 4, "Default tolerance should be 4");
    assert(campusCreate.json.perimeterStatus === "NOT_DRAWN", "Perimeter should be NOT_DRAWN");

    const entrance = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${campusCreate.json.id}/entrances`,
      {
        method: "POST",
        token: ownerToken,
        body: { name: "Main Gate", description: "Front street" },
      }
    );
    assert(entrance.status === 201, `Entrance create expected 201, got ${entrance.status}`);
    assert(entrance.json.schoolId === schoolA.id, "Entrance must be school-scoped");

    // Owner B cannot see school A campuses
    const otherList = await apiCall(baseUrl, "/api/educlock/owner/campuses", { token: ownerBToken });
    assert(otherList.status === 200, "Owner B campus list failed");
    assert(
      !(otherList.json.campuses as Array<{ id: string }>).some((c) => c.id === campusCreate.json.id),
      "Cross-school campus leak"
    );

    // Owner B cannot patch school A campus
    const steal = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusCreate.json.id}`, {
      method: "PATCH",
      token: ownerBToken,
      body: { name: "Stolen" },
    });
    assert(steal.status === 404 || steal.status === 403, `Cross-school campus patch blocked, got ${steal.status}`);

    console.log("EDUCLOCK BUILD 2 ROUTE TESTS PASS");
  } finally {
    server.close();
    await prisma.eduClockEntrance.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockCampus.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockActivationAudit.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.employee.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: { userId: { in: [ownerA.id, manageUser.id, teacherNoManage.id, ownerB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerA.id, manageUser.id, teacherNoManage.id, ownerB.id] } },
    });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
