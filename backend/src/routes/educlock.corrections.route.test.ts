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
    assert(wrongDay.status === 409, `unrelated date without that day's clock-in rejected, got ${wrongDay.status}`);

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
    assert(afterRow.source === "OWNER_MANUAL", "source OWNER_MANUAL");

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

    // Case B — Micaela pattern: 12 Aug unmatched IN + later 13 Aug open shift.
    const micaelaEmp = await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Micaela",
        lastName: "Erasmus",
        fullName: "Micaela Lee Erasmus",
        employeeNumber: "EMP0020SYN",
        identityType: "SA_ID",
        idNumber: "9301015800082",
        isActive: true,
      },
    });
    ids.employeeIds.push(micaelaEmp.id);
    const micaelaIn12 = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: micaelaEmp.id,
        employeeNumberSnapshot: "EMP0020SYN",
        userId: teacherA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date("2026-08-12T06:35:00+02:00"),
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "06:35:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: teacherA.id,
      },
    });
    const micaelaIn13 = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: micaelaEmp.id,
        employeeNumberSnapshot: "EMP0020SYN",
        userId: teacherA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date("2026-08-13T07:00:00+02:00"),
        schoolLocalDate: "2026-08-13",
        schoolLocalTime: "07:00:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: teacherA.id,
      },
    });
    await prisma.eduClockOpenShift.create({
      data: {
        schoolId: schoolA.id,
        employeeId: micaelaEmp.id,
        clockInEventId: micaelaIn13.id,
        schoolLocalDate: "2026-08-13",
        openedAtUtc: new Date("2026-08-13T07:00:00+02:00"),
      },
    });
    await prisma.eduClockException.create({
      data: {
        schoolId: schoolA.id,
        employeeId: micaelaEmp.id,
        employeeNumberSnapshot: "EMP0020SYN",
        schoolLocalDate: "2026-08-12",
        exceptionType: "MISSING_CLOCK_OUT",
        details: "Unmatched 12 Aug clock-in",
        status: "OPEN",
        relatedEventId: micaelaIn12.id,
      },
    });
    await prisma.eduClockException.create({
      data: {
        schoolId: schoolA.id,
        employeeId: micaelaEmp.id,
        employeeNumberSnapshot: "EMP0020SYN",
        schoolLocalDate: "2026-08-13",
        exceptionType: "MISSING_CLOCK_OUT",
        details: "Later 13 Aug open shift",
        status: "OPEN",
        relatedEventId: micaelaIn13.id,
      },
    });
    const micaelaBoard = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    const micaelaRow = (micaelaBoard.json.rows || []).find((r: any) => r.employeeId === micaelaEmp.id);
    assert(micaelaRow.currentStatus === "Missing Clock Out", `micaela 12 Aug status ${micaelaRow.currentStatus}`);
    assert(micaelaRow.affectedSchoolLocalDate === "2026-08-12", "micaela row stays 12 Aug");
    assert(micaelaRow.clockInTime === "06:35", "micaela 12 Aug clock-in");

    const micaelaWrongAuthority = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: micaelaEmp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:02",
        targetEventId: micaelaIn12.id,
      },
    });
    assert(
      micaelaWrongAuthority.status === 201,
      `micaela 12 Aug correction must not hijack 13 Aug, got ${micaelaWrongAuthority.status}: ${JSON.stringify(micaelaWrongAuthority.json)}`
    );
    assert(
      !String(micaelaWrongAuthority.json?.error || "").includes("2026-08-13"),
      "following-day open shift must not become date authority"
    );
    assert(micaelaWrongAuthority.json.correctionEvent.schoolLocalDate === "2026-08-12", "correction bound to 12 Aug");
    assert(String(micaelaWrongAuthority.json.correctionEvent.schoolLocalTime).startsWith("15:02"), "micaela out 15:02");
    assert(micaelaWrongAuthority.json.durationDisplay === "8h 27m", `micaela duration ${micaelaWrongAuthority.json.durationDisplay}`);
    assert(micaelaWrongAuthority.json.exceptionResolved === true, "12 Aug missing clock-out resolved");
    const micaelaOpen = await prisma.eduClockOpenShift.findUnique({
      where: { schoolId_employeeId: { schoolId: schoolA.id, employeeId: micaelaEmp.id } },
    });
    assert(Boolean(micaelaOpen), "13 Aug open shift left in place");
    assert(micaelaOpen?.clockInEventId === micaelaIn13.id, "open shift still 13 Aug clock-in");
    assert(micaelaOpen?.schoolLocalDate === "2026-08-13", "open shift date remains 13 Aug");
    const micaelaEx12 = await prisma.eduClockException.findFirst({
      where: {
        employeeId: micaelaEmp.id,
        schoolLocalDate: "2026-08-12",
        exceptionType: "MISSING_CLOCK_OUT",
      },
    });
    const micaelaEx13 = await prisma.eduClockException.findFirst({
      where: {
        employeeId: micaelaEmp.id,
        schoolLocalDate: "2026-08-13",
        exceptionType: "MISSING_CLOCK_OUT",
      },
    });
    assert(micaelaEx12?.status === "RESOLVED", "12 Aug exception resolved");
    assert(micaelaEx13?.status === "OPEN", "13 Aug exception untouched");
    const stillMicaelaIn = await prisma.eduClockEvent.findUnique({ where: { id: micaelaIn12.id } });
    assert(stillMicaelaIn?.isManualCorrection === false, "original 12 Aug IN preserved");

    const micaelaAfter = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    const micaelaAfterRow = (micaelaAfter.json.rows || []).find((r: any) => r.employeeId === micaelaEmp.id);
    assert(micaelaAfterRow.currentStatus === "Clocked Out", `micaela after ${micaelaAfterRow.currentStatus}`);
    assert(micaelaAfterRow.clockOutTime === "15:02", "micaela 12 Aug now has clock-out");
    assert(micaelaAfterRow.workedDuration === "8h 27m", `micaela board duration ${micaelaAfterRow.workedDuration}`);
    assert(micaelaAfterRow.correctionStatus === "Manually Corrected", "micaela corrected badge");
    assert(micaelaAfterRow.source === "OWNER_MANUAL", "micaela source OWNER_MANUAL");

    // Midnight boundary: 23:59 SAST remains 2026-08-12, not UTC next day.
    const midnightEmp = await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Midnight",
        lastName: "Bound",
        fullName: "Midnight Bound",
        employeeNumber: "EMPMID01",
        identityType: "SA_ID",
        idNumber: "9401015800080",
        isActive: true,
      },
    });
    ids.employeeIds.push(midnightEmp.id);
    const midnightIn = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: midnightEmp.id,
        employeeNumberSnapshot: "EMPMID01",
        userId: teacherA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date("2026-08-12T06:35:00+02:00"),
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "06:35:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: teacherA.id,
      },
    });
    const midnightCorr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: midnightEmp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Forgot to clock out",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "23:59",
        targetEventId: midnightIn.id,
      },
    });
    assert(midnightCorr.status === 201, `midnight 201, got ${midnightCorr.status}: ${JSON.stringify(midnightCorr.json)}`);
    assert(midnightCorr.json.correctionEvent.schoolLocalDate === "2026-08-12", "23:59 stays on 12 Aug");
    assert(String(midnightCorr.json.correctionEvent.occurredAtUtc).startsWith("2026-08-12T21:59:00"), "23:59 SAST = 21:59 UTC");

    // Case C / Zahne-like: missing clock-in with existing same-day clock-out.
    const zahneEmp = await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Zahne",
        lastName: "Klopper",
        fullName: "Zahne Klopper",
        employeeNumber: "EMP0045SYN",
        identityType: "SA_ID",
        idNumber: "9501015800088",
        isActive: true,
      },
    });
    ids.employeeIds.push(zahneEmp.id);
    const zahneOut = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: zahneEmp.id,
        employeeNumberSnapshot: "EMP0045SYN",
        userId: teacherA.id,
        eventType: "CLOCK_OUT",
        occurredAtUtc: new Date("2026-08-12T15:02:00+02:00"),
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "15:02:00",
        timezone: "Africa/Johannesburg",
        source: "STAFF_MOBILE",
        createdByUserId: teacherA.id,
      },
    });
    const zahneBoard = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    const zahneRow = (zahneBoard.json.rows || []).find((r: any) => r.employeeId === zahneEmp.id);
    assert(zahneRow.currentStatus === "Missing Clock In", `zahne status ${zahneRow.currentStatus}`);
    assert(zahneRow.clockInTime == null, "zahne clock-in missing");
    assert(zahneRow.clockOutTime === "15:02", "zahne existing out");

    const zahneAfterOut = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: zahneEmp.id,
        action: "ADD_CLOCK_IN",
        reason: "Forgot to clock in",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "16:00",
      },
    });
    assert(zahneAfterOut.status === 400, `clock-in after clock-out 400, got ${zahneAfterOut.status}`);

    const zahneCorr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: zahneEmp.id,
        action: "ADD_CLOCK_IN",
        reason: "Forgot to clock in",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "06:35",
      },
    });
    assert(zahneCorr.status === 201, `zahne 201, got ${zahneCorr.status}: ${JSON.stringify(zahneCorr.json)}`);
    assert(zahneCorr.json.correctionEvent.eventType === "CLOCK_IN", "adds clock-in");
    assert(zahneCorr.json.correctionEvent.source === "OWNER_MANUAL", "OWNER_MANUAL");
    assert(zahneCorr.json.correctionEvent.schoolLocalDate === "2026-08-12", "zahne date 12 Aug");
    assert(String(zahneCorr.json.correctionEvent.occurredAtUtc).startsWith("2026-08-12T04:35:00"), "06:35 SAST = 04:35 UTC");
    assert(zahneCorr.json.durationDisplay === "8h 27m", `zahne duration ${zahneCorr.json.durationDisplay}`);
    assert(zahneCorr.json.audit?.originalClockOut?.eventId === zahneOut.id, "audit keeps original out");
    const stillZahneOut = await prisma.eduClockEvent.findUnique({ where: { id: zahneOut.id } });
    assert(stillZahneOut?.isManualCorrection === false, "original out preserved");
    assert(stillZahneOut?.source === "STAFF_MOBILE", "original out still mobile");

    const zahneAfter = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    const zahneAfterRow = (zahneAfter.json.rows || []).find((r: any) => r.employeeId === zahneEmp.id);
    assert(zahneAfterRow.currentStatus === "Clocked Out", `zahne after ${zahneAfterRow.currentStatus}`);
    assert(zahneAfterRow.clockInTime === "06:35", "zahne clock-in saved");
    assert(zahneAfterRow.clockOutTime === "15:02", "zahne clock-out unchanged");
    assert(zahneAfterRow.workedDuration === "8h 27m", `zahne board duration ${zahneAfterRow.workedDuration}`);
    assert(zahneAfterRow.correctionStatus === "Manually Corrected", "zahne Corrected badge");
    assert(zahneAfterRow.source === "OWNER_MANUAL", "zahne source OWNER_MANUAL");

    const zahneNotClocked = await prisma.employee.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Not",
        lastName: "Clocked",
        fullName: "Not Clocked",
        employeeNumber: "EMPNCI01",
        identityType: "SA_ID",
        idNumber: "9601015800086",
        isActive: true,
      },
    });
    ids.employeeIds.push(zahneNotClocked.id);
    const bothCorr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: zahneNotClocked.id,
        action: "ADD_CLOCK_IN",
        reason: "Forgot to clock in",
        schoolLocalDate: "2026-08-12",
        schoolLocalTime: "07:00",
        schoolLocalClockOutTime: "16:00",
      },
    });
    assert(bothCorr.status === 201, `both-missing reconstruction 201, got ${bothCorr.status}: ${JSON.stringify(bothCorr.json)}`);
    assert(bothCorr.json.durationDisplay === "9h 0m" || bothCorr.json.durationDisplay === "9h", `both duration ${bothCorr.json.durationDisplay}`);
    const bothAfter = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=2026-08-12`,
      { token: ownerToken }
    );
    const bothRow = (bothAfter.json.rows || []).find((r: any) => r.employeeId === zahneNotClocked.id);
    assert(bothRow.currentStatus === "Clocked Out", `both after ${bothRow.currentStatus}`);
    assert(bothRow.clockInTime === "07:00", "both in");
    assert(bothRow.clockOutTime === "16:00", "both out");
    assert(bothRow.correctionStatus === "Manually Corrected", "both corrected");

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
