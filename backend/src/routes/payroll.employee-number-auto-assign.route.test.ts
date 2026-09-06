/**
 * Automatic employee-number allocation for Add Employee (autoAssignEmployeeNumber: true).
 * Creates disposable schools only. Does not touch Da Silva or production rows.
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import payrollRoutes from "./payroll";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function api(
  baseUrl: string,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
) {
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

async function seedOwner(schoolId: string, stamp: number, tag: string) {
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  return prisma.user.create({
    data: {
      schoolId,
      email: `auto-emp-${tag}-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId,
          firstName: "O",
          surname: tag,
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
}

async function main() {
  const url = String(process.env.DATABASE_URL || "");
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("Refusing to run auto-assign tests against a non-local DATABASE_URL");
  }

  const stamp = Date.now();
  const schoolA = await prisma.school.create({ data: { name: `AutoEmp A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `AutoEmp B ${stamp}` } });
  const ownerA = await seedOwner(schoolA.id, stamp, "a");
  const ownerB = await seedOwner(schoolB.id, stamp, "b");
  const extraSchoolIds: string[] = [];
  const tokenA = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenB = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  const app = express();
  app.use(express.json());
  app.use("/api/payroll", payrollRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    let res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "First",
        lastName: "Empty",
        autoAssignEmployeeNumber: true,
      },
    });
    assert(res.status === 200, `first auto ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP001", "first automatic number is EMP001");
    const firstId = res.json.id;

    await prisma.employee.createMany({
      data: [
        { schoolId: schoolA.id, firstName: "Seed", lastName: "Two", employeeNumber: "EMP002" },
        { schoolId: schoolA.id, firstName: "Seed", lastName: "Eight", employeeNumber: "EMP008" },
        { schoolId: schoolA.id, firstName: "Seed", lastName: "Ten", employeeNumber: "EMP0010" },
        { schoolId: schoolA.id, firstName: "Seed", lastName: "SixtyThree", employeeNumber: "EMP0063" },
      ],
    });

    const before = await prisma.employee.findMany({
      where: { schoolId: schoolA.id },
      select: { id: true, employeeNumber: true },
    });
    const beforeMap = new Map(before.map((row) => [row.id, row.employeeNumber]));

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "Next",
        lastName: "SixtyFour",
        autoAssignEmployeeNumber: true,
        employeeNumber: "EMP0099",
      },
    });
    assert(res.status === 200, `max+1 auto ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP0064", "EMP002/008/0010/0063 → EMP0064");
    assert(res.json.employeeNumber !== "EMP0099", "client cannot force a different auto-assign number");

    const afterSeeds = await prisma.employee.findMany({
      where: { schoolId: schoolA.id, id: { in: [...beforeMap.keys()] } },
      select: { id: true, employeeNumber: true },
    });
    for (const row of afterSeeds) {
      assert(row.employeeNumber === beforeMap.get(row.id), `existing ${row.id} number unchanged`);
    }
    assert(
      afterSeeds.some((row) => row.employeeNumber === "EMP002"),
      "gap EMP002 remains"
    );
    assert(
      !afterSeeds.some((row) => row.employeeNumber === "EMP003"),
      "historic gap EMP003 was not filled"
    );

    res = await api(baseUrl, `/api/payroll/employee/${firstId}`, {
      method: "PUT",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "First",
        lastName: "Empty",
        autoAssignEmployeeNumber: true,
        employeeNumber: "EMP0099",
      },
    });
    assert(res.status === 200, `update ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP001", "malicious PUT keeps existing EMP001");

    await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Legacy",
        lastName: "Mbb",
        employeeNumber: "MBB-STAFF-DEADBEEF",
      },
    });
    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "After",
        lastName: "Legacy",
        autoAssignEmployeeNumber: true,
      },
    });
    assert(res.status === 200, `legacy ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP0065", "legacy non-standard number does not crash allocation");

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenB,
      body: {
        schoolId: schoolB.id,
        firstName: "Other",
        lastName: "School",
        autoAssignEmployeeNumber: true,
      },
    });
    assert(res.status === 200, `school B ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP001", "school B has an independent sequence");

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenB,
      body: {
        schoolId: schoolB.id,
        firstName: "Manual",
        lastName: "NoFlag",
      },
    });
    assert(res.status === 200, `no flag ${JSON.stringify(res.json)}`);
    assert(
      res.json.employeeNumber === null || res.json.employeeNumber === undefined,
      "without autoAssignEmployeeNumber the server does not generate a number"
    );

    await prisma.employee.create({
      data: {
        schoolId: schoolB.id,
        firstName: "Seed",
        lastName: "SixtyThree",
        employeeNumber: "EMP0063",
      },
    });
    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenB,
      body: {
        schoolId: schoolB.id,
        firstName: "Peer",
        lastName: "SixtyFour",
        autoAssignEmployeeNumber: true,
      },
    });
    assert(res.status === 200, `school B EMP0064 ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP0064", "two schools can both have EMP0064");

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenB,
      body: {
        schoolId: schoolB.id,
        firstName: "Explicit",
        lastName: "Manual",
        employeeNumber: "EMP0090",
      },
    });
    assert(res.status === 200, `explicit ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP0090", "manual POST without the flag still stores the supplied number");

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "Blank",
        lastName: "Spaces",
        employeeNumber: "   ",
      },
    });
    assert(res.status === 400, `whitespace-only still 400 ${res.status}`);
    assert(
      String(res.json?.error || "").toLowerCase().includes("blank"),
      `blank message: ${JSON.stringify(res.json)}`
    );

    const raceSchool = await prisma.school.create({ data: { name: `AutoEmp Race ${stamp}` } });
    extraSchoolIds.push(raceSchool.id);
    const raceOwner = await seedOwner(raceSchool.id, stamp, "race");
    const raceToken = signToken({
      userId: raceOwner.id,
      schoolId: raceSchool.id,
      email: raceOwner.email,
      role: "SCHOOL_ADMIN",
    });
    const raced = await Promise.all([
      api(baseUrl, "/api/payroll/employee", {
        method: "POST",
        token: raceToken,
        body: {
          schoolId: raceSchool.id,
          firstName: "Race",
          lastName: "One",
          autoAssignEmployeeNumber: true,
        },
      }),
      api(baseUrl, "/api/payroll/employee", {
        method: "POST",
        token: raceToken,
        body: {
          schoolId: raceSchool.id,
          firstName: "Race",
          lastName: "Two",
          autoAssignEmployeeNumber: true,
        },
      }),
    ]);
    assert(raced.every((row) => row.status === 200), `race statuses ${raced.map((row) => row.status)}`);
    const raceNumbers = raced.map((row) => String(row.json.employeeNumber)).sort();
    assert(raceNumbers[0] !== raceNumbers[1], `concurrent creates produced distinct numbers: ${raceNumbers.join(",")}`);
    assert(
      raceNumbers.includes("EMP001") && raceNumbers.includes("EMP002"),
      `race allocated EMP001 and EMP002, got ${raceNumbers.join(",")}`
    );

    console.log("PASS: auto-assign employee number create/gaps/school-scope/legacy/race/whitespace");
  } finally {
    server.close();
    const schoolIds = [schoolA.id, schoolB.id, ...extraSchoolIds];
    await prisma.employee.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.userRbacMeta.deleteMany({
      where: { user: { schoolId: { in: schoolIds } } },
    });
    await prisma.user.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("FAIL:", err);
  await prisma.$disconnect();
  process.exit(1);
});
