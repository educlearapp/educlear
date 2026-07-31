/**
 * Local verification: Employee.employeeNumber trim / unique / cross-school / blank reject.
 * Run: npx tsc && node dist/routes/payroll.employee-number.route.test.js
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

async function main() {
  const stamp = Date.now();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const schoolA = await prisma.school.create({ data: { name: `EmpNo Verify A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EmpNo Verify B ${stamp}` } });

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `ownera-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "O",
          surname: "A",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `ownerb-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolB.id,
          firstName: "O",
          surname: "B",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });

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
        firstName: "Ada",
        lastName: "One",
        employeeNumber: "  EMP001  ",
      },
    });
    assert(res.status === 200, `create EMP001 ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP001", "trimmed on create");
    const emp1Id = res.json.id;

    res = await api(baseUrl, `/api/payroll/employees/${schoolA.id}`, { token: tokenA });
    assert(res.status === 200, "reload list");
    const listed = Array.isArray(res.json) ? res.json : [];
    const reloaded = listed.find((row: any) => row.id === emp1Id);
    assert(reloaded?.employeeNumber === "EMP001", "reload shows EMP001");

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "Bob",
        lastName: "Two",
        employeeNumber: "EMP001",
      },
    });
    assert(res.status === 409, `same-school dup ${res.status}`);
    assert(
      String(res.json?.error || "").toLowerCase().includes("unique"),
      `dup message: ${JSON.stringify(res.json)}`
    );

    res = await api(baseUrl, "/api/payroll/employee", {
      method: "POST",
      token: tokenB,
      body: {
        schoolId: schoolB.id,
        firstName: "Cara",
        lastName: "Other",
        employeeNumber: "EMP001",
      },
    });
    assert(res.status === 200, `cross-school same number allowed ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP001", "school B EMP001");

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
    assert(res.status === 400, `blank reject ${res.status}`);
    assert(
      String(res.json?.error || "").toLowerCase().includes("blank"),
      `blank message: ${JSON.stringify(res.json)}`
    );

    res = await api(baseUrl, `/api/payroll/employee/${emp1Id}`, {
      method: "PUT",
      token: tokenA,
      body: {
        schoolId: schoolA.id,
        firstName: "Ada",
        lastName: "One",
        employeeNumber: "EMP001-UPDATED",
      },
    });
    assert(res.status === 200, `update number ${JSON.stringify(res.json)}`);
    assert(res.json.employeeNumber === "EMP001-UPDATED", "updated value");

    console.log("PASS: employee number create/reload/unique/cross-school/blank/update");
  } finally {
    server.close();
    await prisma.employee.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: { user: { schoolId: { in: [schoolA.id, schoolB.id] } } },
    });
    await prisma.user.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("FAIL:", err);
  await prisma.$disconnect();
  process.exit(1);
});
