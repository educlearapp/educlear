/**
 * EduClock owner attendance corrections — missing clock-out workflow.
 * Run: npx tsc && node dist/routes/educlock.corrections.route.test.js
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import educlockRoutes from "./educlock";
import { resolveSchoolLocalParts } from "../utils/schoolLocalTime";

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
  options: {
    method?: string;
    body?: Record<string, unknown>;
    token?: string;
  } = {}
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
  const schoolA = await prisma.school.create({ data: { name: `EduClock Corr A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock Corr B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-corr-${stamp}@example.com`,
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
  const teacherA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `teacher-corr-${stamp}@example.com`,
      fullName: "Teacher A",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Teacher",
          surname: "A",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `owner-corr-b-${stamp}@example.com`,
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

  const emp = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: teacherA.id,
      firstName: "Test",
      lastName: "Employee",
      fullName: "Test Employee",
      employeeNumber: "EMPTEST01",
      identityType: "SA_ID",
      idNumber: "9001015800088",
      isActive: true,
    },
  });
  const empB = await prisma.employee.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Other",
      lastName: "School",
      fullName: "Other School",
      employeeNumber: "EMPB01",
      identityType: "SA_ID",
      idNumber: "9101015800086",
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
  const teacherToken = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  const ids = {
    schoolIds: [schoolA.id, schoolB.id],
    userIds: [ownerA.id, teacherA.id, ownerB.id],
    employeeIds: [emp.id, empB.id],
  };

  try {
    const clockInAt = new Date("2026-08-12T07:18:00+02:00");
    const local = resolveSchoolLocalParts(clockInAt, "Africa/Johannesburg");
    assert(local.schoolLocalDate === "2026-08-12", "school-local date 2026-08-12");

    const pastIn = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: emp.id,
        employeeNumberSnapshot: "EMPTEST01",
        userId: teacherA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: clockInAt,
        schoolLocalDate: local.schoolLocalDate,
        schoolLocalTime: local.schoolLocalTime,
        timezone: local.timezone,
        source: "STAFF_MOBILE",
        createdByUserId: teacherA.id,
      },
    });
    await prisma.eduClockOpenShift.create({
      data: {
        schoolId: schoolA.id,
        employeeId: emp.id,
        clockInEventId: pastIn.id,
        schoolLocalDate: local.schoolLocalDate,
        openedAtUtc: clockInAt,
      },
    });

    const frozenNow = new Date("2026-08-13T09:34:00+02:00");
    const attendance = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    assert(attendance.status === 200, `attendance 200 got ${attendance.status}`);
    const row = (attendance.json.rows || []).find((r: any) => r.employeeId === emp.id);
    assert(Boolean(row), "EMPTEST01 row present");
    assert(row.currentStatus === "Missing Clock Out", `status ${row.currentStatus}`);
    assert(row.workedDuration == null, `duration must be incomplete, got ${row.workedDuration}`);
    assert(row.workedDurationIncomplete === true, "incomplete flag");
    assert(row.clockInTime === "07:18", `clock in ${row.clockInTime}`);
    assert(row.clockOutTime == null, "clock out missing");
    assert(row.affectedSchoolLocalDate === "2026-08-12", "affected date");

    const exceptions = await apiCall(baseUrl, "/api/educlock/owner/exceptions?status=OPEN", {
      token: ownerToken,
    });
    assert(exceptions.status === 200, "exceptions 200");
    const missing = (exceptions.json.rows || []).find(
      (r: any) => r.exceptionType === "MISSING_CLOCK_OUT" && r.employeeId === emp.id
    );
    assert(Boolean(missing), "open missing clock-out exception");
    assert(missing.status === "OPEN", "exception open");

    const unauth = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:00",
      },
    });
    assert(unauth.status === 401, `unauthenticated 401, got ${unauth.status}`);

    const forbidden = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: teacherToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:00",
      },
    });
    assert(forbidden.status === 403, `teacher 403, got ${forbidden.status}`);

    const mismatch = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: empB.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:00",
      },
    });
    assert(mismatch.status === 404, `other-school employee 404, got ${mismatch.status}`);

    const wrongDay = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-13",
        schoolLocalTime: "15:00",
      },
    });
    assert(wrongDay.status === 400, `viewed-today date rejected, got ${wrongDay.status}`);

    const beforeIn = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "07:00",
      },
    });
    assert(beforeIn.status === 400, `clock-out before clock-in 400, got ${beforeIn.status}`);

    const blankTime = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "",
      },
    });
    assert(blankTime.status === 400, `blank clock-out 400, got ${blankTime.status}`);

    const ampmTime = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "04:00 PM",
      },
    });
    assert(ampmTime.status === 400, `locale AM/PM string 400, got ${ampmTime.status}`);

    const malformedTime = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "16",
      },
    });
    assert(malformedTime.status === 400, `malformed time 400, got ${malformedTime.status}`);

    const impossibleTime = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "25:61",
      },
    });
    assert(impossibleTime.status === 400, `impossible timestamp 400, got ${impossibleTime.status}`);

    const invalidDate = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "12/08/2026",
        schoolLocalTime: "16:00",
      },
    });
    assert(invalidDate.status === 400, `invalid date 400, got ${invalidDate.status}`);

    const staffStaleOut = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: teacherToken,
      body: {},
    });
    assert(staffStaleOut.status === 409, `staff cannot close stale shift, got ${staffStaleOut.status}`);
    assert(
      String(staffStaleOut.json?.error || "").toLowerCase().includes("owner"),
      "staff stale clock-out tells them to ask owner"
    );

    const corr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:00",
      },
    });
    assert(corr.status === 201, `correction 201, got ${corr.status}: ${JSON.stringify(corr.json)}`);
    assert(corr.json.correctionEvent.isManualCorrection === true, "manual correction");
    assert(corr.json.originalEventId === pastIn.id, "links original clock-in");
    assert(corr.json.durationDisplay === "7h 42m", `duration ${corr.json.durationDisplay}`);
    assert(corr.json.audit?.reason === "Forgot to clock out", "audit reason");
    assert(corr.json.audit?.correctedByUserId === ownerA.id, "audit actor");
    assert(corr.json.audit?.correctedByRole === "Owner", "audit role");
    assert(corr.json.audit?.employeeNumber === "EMPTEST01", "audit employee number");
    assert(corr.json.exceptionResolved === true, "exception resolved by correction");
    const stillOriginal = await prisma.eduClockEvent.findUnique({ where: { id: pastIn.id } });
    assert(Boolean(stillOriginal), "original event preserved");
    assert(stillOriginal?.isManualCorrection === false, "original not overwritten");

    const after = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    const afterRow = (after.json.rows || []).find((r: any) => r.employeeId === emp.id);
    assert(afterRow.currentStatus === "Clocked Out", `after status ${afterRow.currentStatus}`);
    assert(afterRow.clockInTime === "07:18", "clock in unchanged");
    assert(afterRow.clockOutTime === "15:00", `clock out ${afterRow.clockOutTime}`);
    assert(afterRow.workedDuration === "7h 42m", `after duration ${afterRow.workedDuration}`);
    assert(afterRow.correctionStatus === "Manually Corrected", "correction visible");

    const resolvedEx = await apiCall(baseUrl, "/api/educlock/owner/exceptions?status=RESOLVED", {
      token: ownerToken,
    });
    const resolvedMissing = (resolvedEx.json.rows || []).find(
      (r: any) => r.exceptionType === "MISSING_CLOCK_OUT" && r.employeeId === emp.id
    );
    assert(Boolean(resolvedMissing), "missing clock-out now resolved");
    assert(resolvedMissing.status === "RESOLVED", "resolved status");
    assert(resolvedMissing.resolvedByUserId === ownerA.id, "resolved by owner");
    assert(resolvedMissing.resolutionSource === "OWNER_ATTENDANCE_CORRECTION", "resolution source");
    assert(Boolean(resolvedMissing.associatedCorrectionEventId), "associated correction");

    const duplicate = await prisma.eduClockException.create({
      data: {
        schoolId: schoolA.id,
        employeeId: emp.id,
        employeeNumberSnapshot: "EMPTEST01",
        schoolLocalDate: "2026-08-12",
        exceptionType: "DUPLICATE_CLOCK_ATTEMPT",
        details: "Informational duplicate clock attempt",
        status: "OPEN",
      },
    });
    const exAfter = await apiCall(baseUrl, "/api/educlock/owner/exceptions?status=OPEN", {
      token: ownerToken,
    });
    const dupRow = (exAfter.json.rows || []).find((r: any) => r.id === duplicate.id);
    assert(Boolean(dupRow), "duplicate clock attempt remains open");
    assert(dupRow.exceptionType === "DUPLICATE_CLOCK_ATTEMPT", "duplicate type unchanged");

    const repeat = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:00",
      },
    });
    assert(repeat.status === 409, `repeat correction 409, got ${repeat.status}`);
    const outEvents = await prisma.eduClockEvent.count({
      where: {
        schoolId: schoolA.id,
        employeeId: emp.id,
        eventType: "CLOCK_OUT",
        isManualCorrection: true,
      },
    });
    assert(outEvents === 1, `exactly one correction clock-out, got ${outEvents}`);

    const jemmahEmp = await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Jemmah",
        lastName: "Harris",
        fullName: "Jemmah Harris",
        employeeNumber: "EMP0058SYN",
        identityType: "SA_ID",
        idNumber: "9201015800084",
        isActive: true,
      },
    });
    ids.employeeIds.push(jemmahEmp.id);
    const jemmahIn = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: jemmahEmp.id,
        employeeNumberSnapshot: "EMP0058SYN",
        userId: teacherA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: clockInAt,
        schoolLocalDate: local.schoolLocalDate,
        schoolLocalTime: local.schoolLocalTime,
        timezone: local.timezone,
        source: "STAFF_MOBILE",
        createdByUserId: teacherA.id,
      },
    });
    await prisma.eduClockOpenShift.create({
      data: {
        schoolId: schoolA.id,
        employeeId: jemmahEmp.id,
        clockInEventId: jemmahIn.id,
        schoolLocalDate: local.schoolLocalDate,
        openedAtUtc: clockInAt,
      },
    });
    const jemmahCorr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: jemmahEmp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "16:00",
      },
    });
    assert(jemmahCorr.status === 201, `jemmah 16:00 correction 201, got ${jemmahCorr.status}: ${JSON.stringify(jemmahCorr.json)}`);
    assert(jemmahCorr.json.durationDisplay === "8h 42m", `jemmah duration ${jemmahCorr.json.durationDisplay}`);
    assert(jemmahCorr.json.correctionEvent.schoolLocalDate === "2026-08-12", "jemmah affected date");
    assert(String(jemmahCorr.json.correctionEvent.schoolLocalTime).startsWith("16:00"), `jemmah time ${jemmahCorr.json.correctionEvent.schoolLocalTime}`);
    const stillJemmahIn = await prisma.eduClockEvent.findUnique({ where: { id: jemmahIn.id } });
    assert(Boolean(stillJemmahIn), "jemmah original clock-in preserved");
    assert(stillJemmahIn?.isManualCorrection === false, "jemmah original not overwritten");

    // Current-day live open shift still shows duration (not incomplete).
    const liveInAt = frozenNow;
    const liveLocal = resolveSchoolLocalParts(liveInAt, "Africa/Johannesburg");
    const liveEmp = await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Live",
        lastName: "Shift",
        fullName: "Live Shift",
        employeeNumber: "EMPLIVE01",
        identityType: "SA_ID",
        idNumber: "8001015009087",
        isActive: true,
      },
    });
    ids.employeeIds.push(liveEmp.id);
    const liveIn = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: liveEmp.id,
        employeeNumberSnapshot: "EMPLIVE01",
        userId: ownerA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date(`${liveLocal.schoolLocalDate}T07:18:00+02:00`),
        schoolLocalDate: liveLocal.schoolLocalDate,
        schoolLocalTime: "07:18:00",
        timezone: liveLocal.timezone,
        source: "STAFF_MOBILE",
        createdByUserId: ownerA.id,
      },
    });
    await prisma.eduClockOpenShift.create({
      data: {
        schoolId: schoolA.id,
        employeeId: liveEmp.id,
        clockInEventId: liveIn.id,
        schoolLocalDate: liveLocal.schoolLocalDate,
        openedAtUtc: new Date(`${liveLocal.schoolLocalDate}T07:18:00+02:00`),
      },
    });
    const liveAtt = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=${liveLocal.schoolLocalDate}`,
      { token: ownerToken }
    );
    const liveRow = (liveAtt.json.rows || []).find((r: any) => r.employeeId === liveEmp.id);
    assert(liveRow.currentStatus === "Clocked In", `live status ${liveRow.currentStatus}`);
    assert(typeof liveRow.workedDuration === "string" && liveRow.workedDuration !== "—", "live duration present");
    assert(liveRow.isLiveOpenShift === true, "live open shift flag");
    assert(!String(liveRow.workedDuration).includes("50h"), "live duration is not multi-day");

    void frozenNow;
    console.log("EDUCLOCK CORRECTION ROUTE TESTS PASS");
  } finally {
    server.close();
    await prisma.eduClockException.deleteMany({ where: { schoolId: { in: ids.schoolIds } } });
    await prisma.eduClockOpenShift.deleteMany({ where: { schoolId: { in: ids.schoolIds } } });
    await prisma.eduClockEvent.deleteMany({ where: { schoolId: { in: ids.schoolIds } } });
    await prisma.eduClockActivationAudit.deleteMany({ where: { schoolId: { in: ids.schoolIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids.employeeIds } } });
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: ids.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    await prisma.school.deleteMany({ where: { id: { in: ids.schoolIds } } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
