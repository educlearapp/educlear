/**
 * PayrollRun list/create contract + reuse hardening tests.
 * Isolated DB only: educlear_educlock_payroll_import
 * Run: npx tsx src/routes/payroll.runs.route.test.ts
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import payrollRoutes from "./payroll";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function proveIsolatedDb() {
  const u = process.env.DATABASE_URL || "";
  assert(/localhost|127\.0\.0\.1/.test(u), "localhost required");
  assert(u.includes("educlear_educlock_payroll_import"), "isolated DB required");
  assert(!/render\.com|educlear_main_db|dpg-/.test(u), "no production");
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
  proveIsolatedDb();
  const stamp = Date.now();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const schoolA = await prisma.school.create({ data: { name: `Runs A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `Runs B ${stamp}` } });

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `ownera-runs-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "A",
          surname: "Owner",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
  const teacherA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `teacher-runs-${stamp}@example.com`,
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "T",
          surname: "Each",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `ownerb-runs-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolB.id,
          firstName: "B",
          surname: "Owner",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });

  await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Pat",
      lastName: "Roll",
      employeeNumber: `PR-${stamp}`,
      basicSalary: 5000,
      isActive: true,
    },
  });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/payroll", payrollRoutes);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const tokenA = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenTeacher = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const tokenB = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  try {
    // GET /runs requires owner
    const unauth = await api(baseUrl, "/api/payroll/runs");
    assert(unauth.status === 401 || unauth.status === 403, "unauth denied");
    const teacherDenied = await api(baseUrl, "/api/payroll/runs", { token: tokenTeacher });
    assert(teacherDenied.status === 403, "teacher denied");

    // Empty list safe
    const empty = await api(baseUrl, "/api/payroll/runs?payrollMonth=3&payrollYear=2025", {
      token: tokenA,
    });
    assert(empty.status === 200, "empty list ok");
    assert(Array.isArray(empty.json.runs) && empty.json.runs.length === 0, "empty array");

    // Create first run
    const create1 = await api(baseUrl, "/api/payroll/run", {
      method: "POST",
      token: tokenA,
      body: { month: 8, year: 2026, schoolId: "forged-school-id-ignored" },
    });
    assert(create1.status === 200, `create1 ${create1.status} ${JSON.stringify(create1.json)}`);
    assert(create1.json.payrollRunId, "has payrollRunId");
    assert(create1.json.created === true, "created true");
    assert(create1.json.reusedExisting === false, "not reused");
    assert(create1.json.payrollMonth === 8 && create1.json.payrollYear === 2026, "period");
    assert(create1.json.status === "DRAFT", "draft");
    assert(typeof create1.json.grossTotal === "number", "compat grossTotal");
    assert(Array.isArray(create1.json.employees), "compat employees");
    const runId = create1.json.payrollRunId;

    // School forged body does not attach to other school
    const owned = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    assert(owned.schoolId === schoolA.id, "auth school owned");

    // Repeated create reuses
    const create2 = await api(baseUrl, "/api/payroll/run", {
      method: "POST",
      token: tokenA,
      body: { month: 8, year: 2026 },
    });
    assert(create2.status === 200 && create2.json.reusedExisting === true, "reused");
    assert(create2.json.created === false, "not created");
    assert(create2.json.payrollRunId === runId, "same id");
    assert(
      (await prisma.payrollRun.count({
        where: { schoolId: schoolA.id, payrollMonth: 8, payrollYear: 2026 },
      })) === 1,
      "still one run"
    );

    // Concurrent identical creates
    const [cA, cB] = await Promise.all([
      api(baseUrl, "/api/payroll/run", {
        method: "POST",
        token: tokenA,
        body: { month: 8, year: 2026 },
      }),
      api(baseUrl, "/api/payroll/run", {
        method: "POST",
        token: tokenA,
        body: { month: 8, year: 2026 },
      }),
    ]);
    assert(cA.status === 200 && cB.status === 200, "concurrent ok");
    assert(cA.json.payrollRunId === runId && cB.json.payrollRunId === runId, "same concurrent");
    assert(
      (await prisma.payrollRun.count({
        where: { schoolId: schoolA.id, payrollMonth: 8, payrollYear: 2026 },
      })) === 1,
      "no duplicate after concurrent"
    );

    // GET /runs school isolation + field shape
    await api(baseUrl, "/api/payroll/run", {
      method: "POST",
      token: tokenB,
      body: { month: 8, year: 2026 },
    });
    const listA = await api(baseUrl, "/api/payroll/runs?payrollMonth=8&payrollYear=2026", {
      token: tokenA,
    });
    assert(listA.status === 200, "list A");
    assert(listA.json.runs.length === 1, "only school A run");
    assert(listA.json.runs[0].id === runId, "correct run");
    const sample = listA.json.runs[0];
    for (const forbidden of [
      "basicSalary",
      "grossPay",
      "payeAmount",
      "bankAccountNumber",
      "employees",
      "payslips",
    ]) {
      assert(!(forbidden in sample), `must not expose ${forbidden}`);
    }
    for (const reqField of ["id", "payrollMonth", "payrollYear", "status", "finalizedAt", "createdAt"]) {
      assert(reqField in sample, `requires ${reqField}`);
    }

    // Cross-school never reused
    const cross = await api(baseUrl, "/api/payroll/run", {
      method: "POST",
      token: tokenB,
      body: { month: 8, year: 2026 },
    });
    assert(cross.json.payrollRunId !== runId, "school B different run");

    // Finalize then reuse returns FINALIZED — no new draft
    const fin = await api(baseUrl, `/api/payroll/run/${runId}/finalize`, {
      method: "POST",
      token: tokenA,
      body: {},
    });
    assert(fin.status === 200 && fin.json.payrollRun.status === "FINALIZED", "finalized");
    const afterFin = await api(baseUrl, "/api/payroll/run", {
      method: "POST",
      token: tokenA,
      body: { month: 8, year: 2026 },
    });
    assert(afterFin.json.payrollRunId === runId, "reuse finalized id");
    assert(afterFin.json.status === "FINALIZED", "still finalized");
    assert(afterFin.json.reusedExisting === true, "reused finalized");
    assert(
      (await prisma.payrollRun.count({
        where: { schoolId: schoolA.id, payrollMonth: 8, payrollYear: 2026 },
      })) === 1,
      "no draft beside finalized"
    );

    // Historical duplicate conflict
    const dupMonth = 9;
    const d1 = await prisma.payrollRun.create({
      data: {
        schoolId: schoolA.id,
        taxYear: 2026,
        payrollMonth: dupMonth,
        payrollYear: 2026,
        payDate: new Date(),
        status: "DRAFT",
      },
    });
    await prisma.payrollRun.create({
      data: {
        schoolId: schoolA.id,
        taxYear: 2026,
        payrollMonth: dupMonth,
        payrollYear: 2026,
        payDate: new Date(),
        status: "DRAFT",
      },
    });
    const conflict = await api(baseUrl, "/api/payroll/run", {
      method: "POST",
      token: tokenA,
      body: { month: dupMonth, year: 2026 },
    });
    assert(conflict.status === 409 && conflict.json.code === "DUPLICATE_PERIOD_RUNS", "conflict");
    assert(/Owner review is required/i.test(conflict.json.error), "friendly conflict");

    // Confirm import never creates a PayrollRun
    const beforeConfirmCount = await prisma.payrollRun.count({ where: { schoolId: schoolA.id } });
    const confirmNoRun = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: tokenA,
      body: { previewHash: "abc" }, // missing payrollRunId
    });
    assert(confirmNoRun.status === 400 || confirmNoRun.status === 409, "confirm needs run");
    assert(
      (await prisma.payrollRun.count({ where: { schoolId: schoolA.id } })) === beforeConfirmCount,
      "confirm did not create run"
    );

    // Unbound preview not confirmable
    await api(baseUrl, `/api/payroll/run/${runId}/reopen`, {
      method: "POST",
      token: tokenA,
      body: { reason: "Test reopen after finalize checks" },
    });
    // Use a clean month without clock events
    const unbound = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: tokenA,
      body: { payrollMonth: 10, payrollYear: 2026 },
    });
    assert(unbound.status === 200, "unbound preview");
    assert(unbound.json.preview.confirmable === false, "not confirmable");
    assert(unbound.json.preview.payrollRunId === null, "null run");

    void d1;
    console.log("payroll.runs.route.test.ts: OK");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
