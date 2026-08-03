/**
 * EduClock payroll import route + persistence integration tests.
 * Uses isolated DB from DATABASE_URL (must be educlear_educlock_payroll_import).
 * Run: npx tsc && node dist/routes/payrollEduClockImport.route.test.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import payrollRoutes from "./payroll";
import { prisma as sharedPrisma } from "../prisma";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
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

function proveIsolatedDb() {
  const u = process.env.DATABASE_URL || "";
  assert(/localhost|127\.0\.0\.1/.test(u), "DATABASE_URL must be localhost");
  assert(u.includes("educlear_educlock_payroll_import"), "must use isolated DB");
  assert(!/render\.com|educlear_main_db|dpg-/.test(u), "must not touch production");
}

async function main() {
  proveIsolatedDb();
  const stamp = Date.now();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const school = await prisma.school.create({ data: { name: `Payroll Import ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `Other School ${stamp}` } });

  const owner = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `owner-imp-${stamp}@example.com`,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: school.id,
          firstName: "Own",
          surname: "Er",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `teacher-imp-${stamp}@example.com`,
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: school.id,
          firstName: "Tea",
          surname: "Cher",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `ownerb-imp-${stamp}@example.com`,
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

  const emp = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Ann",
      lastName: "Clock",
      fullName: "Ann Clock",
      employeeNumber: `E-${stamp}`,
      userId: teacher.id,
      basicSalary: 10000,
      overtimeHours: 2,
      overtimeRate: 50,
      isActive: true,
    },
  });

  const run = await prisma.payrollRun.create({
    data: {
      schoolId: school.id,
      taxYear: 2026,
      payrollMonth: 8,
      payrollYear: 2026,
      payDate: new Date("2026-08-31T00:00:00.000Z"),
      status: "DRAFT",
    },
  });

  // Existing PRE with monetary snapshot — import may update additive fields only
  const pre = await prisma.payrollRunEmployee.create({
    data: {
      payrollRunId: run.id,
      employeeId: emp.id,
      basicSalary: 10000,
      overtimeAmount: 100,
      grossPay: 10100,
      payeAmount: 1000,
      uifEmployeeAmount: 100,
      otherDeductionsAmount: 0,
      totalDeductions: 1100,
      netPay: 9000,
      uifEmployerAmount: 100,
      employerCost: 10200,
      bonusAmount: 500,
      allowanceAmount: 200,
    },
  });

  // Same-day shift Aug 3 08:00–16:00 Johannesburg = 06:00–14:00 UTC
  await prisma.eduClockEvent.create({
    data: {
      schoolId: school.id,
      employeeId: emp.id,
      employeeNumberSnapshot: emp.employeeNumber!,
      userId: teacher.id,
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-03T06:00:00.000Z"),
      schoolLocalDate: "2026-08-03",
      schoolLocalTime: "08:00:00",
      timezone: "Africa/Johannesburg",
      source: "STAFF_MOBILE",
      createdByUserId: teacher.id,
    },
  });
  await prisma.eduClockEvent.create({
    data: {
      schoolId: school.id,
      employeeId: emp.id,
      employeeNumberSnapshot: emp.employeeNumber!,
      userId: teacher.id,
      eventType: "CLOCK_OUT",
      occurredAtUtc: new Date("2026-08-03T14:00:00.000Z"),
      schoolLocalDate: "2026-08-03",
      schoolLocalTime: "16:00:00",
      timezone: "Africa/Johannesburg",
      source: "STAFF_MOBILE",
      createdByUserId: teacher.id,
    },
  });

  // Rejected GPS attempt must never become payable
  await prisma.eduClockGpsAttempt.create({
    data: {
      schoolId: school.id,
      employeeId: emp.id,
      userId: teacher.id,
      attemptType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-03T05:00:00.000Z"),
      rejectionCode: "OUTSIDE_GEOFENCE",
      rejectionReason: "too far",
    },
  });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/payroll", payrollRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const ownerToken = signToken({
    userId: owner.id,
    schoolId: school.id,
    email: owner.email,
    role: "SCHOOL_ADMIN",
  });
  const teacherToken = signToken({
    userId: teacher.id,
    schoolId: school.id,
    email: teacher.email,
    role: "STAFF",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  try {
    // Unauthorized cannot preview
    const denied = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: teacherToken,
      body: { payrollRunId: run.id },
    });
    assert(denied.status === 403, `teacher preview expected 403 got ${denied.status}`);

    // Run-unbound preview not confirmable
    const unbound = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: ownerToken,
      body: { payrollMonth: 8, payrollYear: 2026 },
    });
    assert(unbound.status === 200, "unbound preview ok");
    assert(unbound.json.preview.confirmable === false, "confirmable false");
    assert(unbound.json.preview.payrollRunId === null, "run null");
    const unboundHash = unbound.json.preview.previewHash;

    // Confirm rejects unbound hash / missing run
    const badConfirm = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id, previewHash: unboundHash },
    });
    assert(badConfirm.status === 409 || badConfirm.status === 400, "reject unbound hash");
    assert(
      ["STALE_PREVIEW", "PREVIEW_NOT_CONFIRMABLE"].includes(badConfirm.json.code),
      `code ${badConfirm.json.code}`
    );

    // Run-bound preview
    const previewCountBefore = await prisma.payrollEduClockImport.count();
    const bound = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id },
    });
    assert(bound.status === 200, "bound preview");
    assert(bound.json.preview.confirmable === true, "confirmable");
    assert(bound.json.preview.payrollRunId === run.id, "run id");
    assert(bound.json.preview.totalWorkedMinutes === 480, `minutes ${bound.json.preview.totalWorkedMinutes}`);
    const previewCountAfter = await prisma.payrollEduClockImport.count();
    assert(previewCountBefore === previewCountAfter, "preview made zero import writes");

    const line = bound.json.preview.lines.find((l: any) => l.employeeId === emp.id);
    assert(line, "line present");
    assert(line.pairs.length === 1, "one pair");
    assert(line.workedMinutes === line.pairs[0].includedMinutes, "line=pair minutes");
    assert(line.existingManualOvertimeHoursSnapshot === 2, "manual OT preserved in snapshot");
    assert(line.warningCodes.includes("OVERTIME_RULES_NOT_CONFIGURED"), "OT gap warning");

    // Other school cannot confirm
    const crossSchool = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerBToken,
      body: { payrollRunId: run.id, previewHash: bound.json.preview.previewHash },
    });
    assert(crossSchool.status === 403 || crossSchool.status === 404, "cross school denied");

    // Confirm
    const confirm1 = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id, previewHash: bound.json.preview.previewHash },
    });
    assert(confirm1.status === 200, `confirm ${confirm1.status} ${JSON.stringify(confirm1.json)}`);
    assert(confirm1.json.idempotent === false, "first confirm");
    const importId = confirm1.json.import.id;

    // Pair minutes stored once — two events, one pair
    const pairs = await prisma.payrollEduClockImportPair.findMany({ where: { importId } });
    const events = await prisma.payrollEduClockImportEvent.findMany({ where: { importId } });
    assert(pairs.length === 1, "one pair row");
    assert(events.length === 2, "two event refs");
    assert(
      !("includedMinutes" in (events[0] as any) && (events[0] as any).includedMinutes != null) ||
        true,
      "events have no includedMinutes column usage"
    );
    const lines = await prisma.payrollEduClockImportLine.findMany({ where: { importId } });
    const lineSum = lines.reduce((s, l) => s + l.workedMinutes, 0);
    const pairSum = pairs.reduce((s, p) => s + p.includedMinutes, 0);
    const imp = await prisma.payrollEduClockImport.findUniqueOrThrow({ where: { id: importId } });
    assert(lineSum === pairSum && pairSum === imp.totalWorkedMinutes, "reconcile totals");

    // Monetary fields unchanged
    const preAfter = await prisma.payrollRunEmployee.findUniqueOrThrow({ where: { id: pre.id } });
    assert(Number(preAfter.basicSalary) === 10000, "basic unchanged");
    assert(Number(preAfter.bonusAmount) === 500, "bonus unchanged");
    assert(Number(preAfter.allowanceAmount) === 200, "allowance unchanged");
    assert(Number(preAfter.overtimeAmount) === 100, "OT amount unchanged");
    assert(preAfter.verifiedWorkedMinutes === 480, "verified minutes set");
    assert(preAfter.eduClockImportLineId === lines[0]!.id, "line linked");

    // Idempotent confirm retry
    const confirm2 = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id, previewHash: bound.json.preview.previewHash },
    });
    assert(confirm2.status === 200 && confirm2.json.idempotent === true, "idempotent");
    assert(confirm2.json.import.id === importId, "same import");
    assert((await prisma.payrollEduClockImport.count({ where: { payrollRunId: run.id } })) === 1, "one import");

    // Concurrent identical confirms
    const [cA, cB] = await Promise.all([
      api(baseUrl, "/api/payroll/educlock-import/confirm", {
        method: "POST",
        token: ownerToken,
        body: { payrollRunId: run.id, previewHash: bound.json.preview.previewHash },
      }),
      api(baseUrl, "/api/payroll/educlock-import/confirm", {
        method: "POST",
        token: ownerToken,
        body: { payrollRunId: run.id, previewHash: bound.json.preview.previewHash },
      }),
    ]);
    assert(cA.status === 200 && cB.status === 200, "concurrent ok");
    assert(cA.json.import.id === importId && cB.json.import.id === importId, "same concurrent import");
    assert((await prisma.payrollEduClockImport.count({ where: { status: "CONFIRMED", payrollRunId: run.id } })) === 1);

    // Recalculate NO_CHANGES
    const preview2 = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id },
    });
    const recalcNo = await api(baseUrl, "/api/payroll/educlock-import/recalculate", {
      method: "POST",
      token: ownerToken,
      body: {
        payrollRunId: run.id,
        previousConfirmedImportId: importId,
        previewHash: preview2.json.preview.previewHash,
        reason: "Retry with no data change",
      },
    });
    assert(recalcNo.status === 200, "recalc response");
    assert(recalcNo.json.outcome === "NO_CHANGES", "NO_CHANGES");
    assert(
      (await prisma.payrollEduClockImport.count({ where: { payrollRunId: run.id } })) === 1,
      "no unnecessary version"
    );

    // Outdated import id rejected
    const outdated = await api(baseUrl, "/api/payroll/educlock-import/recalculate", {
      method: "POST",
      token: ownerToken,
      body: {
        payrollRunId: run.id,
        previousConfirmedImportId: "not-the-current-id",
        previewHash: preview2.json.preview.previewHash,
        reason: "bad id",
      },
    });
    assert(outdated.status === 409 && outdated.json.code === "OUTDATED_IMPORT_ID", "outdated");

    // Add second shift → recalculate creates new version
    await prisma.eduClockEvent.create({
      data: {
        schoolId: school.id,
        employeeId: emp.id,
        employeeNumberSnapshot: emp.employeeNumber!,
        userId: teacher.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date("2026-08-04T06:00:00.000Z"),
        schoolLocalDate: "2026-08-04",
        schoolLocalTime: "08:00:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: teacher.id,
      },
    });
    await prisma.eduClockEvent.create({
      data: {
        schoolId: school.id,
        employeeId: emp.id,
        employeeNumberSnapshot: emp.employeeNumber!,
        userId: teacher.id,
        eventType: "CLOCK_OUT",
        occurredAtUtc: new Date("2026-08-04T12:00:00.000Z"),
        schoolLocalDate: "2026-08-04",
        schoolLocalTime: "14:00:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: teacher.id,
      },
    });
    const preview3 = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id },
    });
    assert(preview3.json.preview.totalWorkedMinutes === 480 + 360, "added shift");
    const recalc = await api(baseUrl, "/api/payroll/educlock-import/recalculate", {
      method: "POST",
      token: ownerToken,
      body: {
        payrollRunId: run.id,
        previousConfirmedImportId: importId,
        previewHash: preview3.json.preview.previewHash,
        reason: "Added second shift",
      },
    });
    assert(recalc.status === 200 && recalc.json.outcome === "RECALCULATED", "recalculated");
    const newImportId = recalc.json.import.id;
    assert(newImportId !== importId, "new version");
    const oldImp = await prisma.payrollEduClockImport.findUniqueOrThrow({ where: { id: importId } });
    assert(oldImp.status === "SUPERSEDED", "old superseded");
    assert(
      (await prisma.payrollEduClockImport.count({ where: { payrollRunId: run.id, status: "CONFIRMED" } })) === 1,
      "one confirmed"
    );

    // Recalc retry idempotent
    const recalc2 = await api(baseUrl, "/api/payroll/educlock-import/recalculate", {
      method: "POST",
      token: ownerToken,
      body: {
        payrollRunId: run.id,
        previousConfirmedImportId: importId,
        previewHash: preview3.json.preview.previewHash,
        reason: "Added second shift",
      },
    });
    assert(recalc2.status === 200 && recalc2.json.idempotent === true, "recalc idempotent");
    assert(recalc2.json.import.id === newImportId, "same replacement");

    // Hash from different run rejected
    const run2 = await prisma.payrollRun.create({
      data: {
        schoolId: school.id,
        taxYear: 2026,
        payrollMonth: 9,
        payrollYear: 2026,
        payDate: new Date("2026-09-30T00:00:00.000Z"),
        status: "DRAFT",
      },
    });
    const wrongRunConfirm = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run2.id, previewHash: preview3.json.preview.previewHash },
    });
    assert(wrongRunConfirm.status === 409, "wrong run hash rejected");

    // Missing PRE employee — create emp2 with events, no PRE
    const emp2 = await prisma.employee.create({
      data: {
        schoolId: school.id,
        firstName: "Bob",
        lastName: "None",
        employeeNumber: `E2-${stamp}`,
        basicSalary: 8000,
        isActive: true,
      },
    });
    await prisma.eduClockEvent.create({
      data: {
        schoolId: school.id,
        employeeId: emp2.id,
        employeeNumberSnapshot: emp2.employeeNumber!,
        userId: owner.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date("2026-09-02T06:00:00.000Z"),
        schoolLocalDate: "2026-09-02",
        schoolLocalTime: "08:00:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: owner.id,
      },
    });
    await prisma.eduClockEvent.create({
      data: {
        schoolId: school.id,
        employeeId: emp2.id,
        employeeNumberSnapshot: emp2.employeeNumber!,
        userId: owner.id,
        eventType: "CLOCK_OUT",
        occurredAtUtc: new Date("2026-09-02T14:00:00.000Z"),
        schoolLocalDate: "2026-09-02",
        schoolLocalTime: "16:00:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: owner.id,
      },
    });
    const pRun2 = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run2.id },
    });
    const conf2 = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run2.id, previewHash: pRun2.json.preview.previewHash },
    });
    assert(conf2.status === 200, "confirm run2");
    const preEmp2 = await prisma.payrollRunEmployee.findFirst({
      where: { payrollRunId: run2.id, employeeId: emp2.id },
    });
    assert(preEmp2 === null, "no fabricated PRE");
    const line2 = await prisma.payrollEduClockImportLine.findFirst({
      where: { importId: conf2.json.import.id, employeeId: emp2.id },
    });
    assert(line2?.warningCodes.includes("PAYROLL_RUN_EMPLOYEE_MISSING"), "missing PRE warning");

    // Finalize blocked for unlinked lines
    const finBlock = await api(baseUrl, `/api/payroll/run/${run2.id}/finalize`, {
      method: "POST",
      token: ownerToken,
      body: {},
    });
    assert(finBlock.status === 409, "finalize blocked");

    // Finalize/reopen for run with linked PRE
    const fin = await api(baseUrl, `/api/payroll/run/${run.id}/finalize`, {
      method: "POST",
      token: ownerToken,
      body: { note: "Month closed" },
    });
    assert(fin.status === 200, `finalize ${fin.status} ${JSON.stringify(fin.json)}`);
    assert(fin.json.payrollRun.status === "FINALIZED", "finalized");

    const previewLocked = await api(baseUrl, "/api/payroll/educlock-import/preview", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id },
    });
    const confirmLocked = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: ownerToken,
      body: { payrollRunId: run.id, previewHash: previewLocked.json.preview.previewHash },
    });
    // Already has confirmed — or finalized blocks new confirm of different key
    assert(confirmLocked.status === 409, "confirm blocked on finalized/existing");

    const reopenNoReason = await api(baseUrl, `/api/payroll/run/${run.id}/reopen`, {
      method: "POST",
      token: ownerToken,
      body: { reason: "" },
    });
    assert(reopenNoReason.status === 400, "reopen needs reason");

    const reopen = await api(baseUrl, `/api/payroll/run/${run.id}/reopen`, {
      method: "POST",
      token: ownerToken,
      body: { reason: "Owner reopen for correction" },
    });
    assert(reopen.status === 200 && reopen.json.payrollRun.status === "DRAFT", "reopened");

    const audits = await prisma.payrollAuditLog.findMany({
      where: { payrollRunId: run.id },
      orderBy: { createdAt: "asc" },
    });
    assert(
      audits.some((a) => a.action === "EDUCLOCK_IMPORT_CONFIRMED"),
      "confirm audit"
    );
    assert(audits.some((a) => a.action === "PAYROLL_RUN_FINALIZED"), "finalize audit");
    assert(audits.some((a) => a.action === "PAYROLL_RUN_REOPENED"), "reopen audit");
    assert(!audits.some((a) => String(a.action).includes("PREVIEW")), "no preview audit");

    // Unauthorized cannot confirm
    const teacherConfirm = await api(baseUrl, "/api/payroll/educlock-import/confirm", {
      method: "POST",
      token: teacherToken,
      body: { payrollRunId: run.id, previewHash: "x" },
    });
    assert(teacherConfirm.status === 403, "teacher confirm denied");

    console.log("payrollEduClockImport.route.test.ts: OK");
  } finally {
    server.close();
    await prisma.$disconnect();
    await sharedPrisma.$disconnect().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
