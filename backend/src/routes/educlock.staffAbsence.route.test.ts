/**
 * EduClock staff self-reported absence — route + authority tests (A–Q).
 * Disposable fixtures only. Does not touch production or 12 August attendance.
 * Run: npx tsc && node dist/routes/educlock.staffAbsence.route.test.js
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient, EduClockEventType } from "@prisma/client";

import educlockRoutes from "./educlock";
import { resolveSchoolLocalParts } from "../utils/schoolLocalTime";
import { staffReportAbsence } from "../services/educlockStaffAbsence";
import {
  ABSENCE_AFTER_CLOCK_IN_MESSAGE,
  ABSENCE_CLOCK_IN_BLOCKED_MESSAGE,
} from "../services/educlockAbsenceLabels";
import { pairEffectiveEventsForEmployee, computePayrollPeriodBounds } from "../services/payrollEduClockPairing";

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
    headers?: Record<string, string>;
  } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
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

function offsetMetres(lat: number, lng: number, northM: number, eastM = 0) {
  const R = 6_371_000;
  const dLat = (northM * (180 / Math.PI)) / R;
  const dLng = (eastM * (180 / Math.PI)) / (R * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + dLat, longitude: lng + dLng };
}

function squareRingAround(lat: number, lng: number, halfSideMetres = 100) {
  const sw = offsetMetres(lat, lng, -halfSideMetres, -halfSideMetres);
  const se = offsetMetres(lat, lng, -halfSideMetres, halfSideMetres);
  const ne = offsetMetres(lat, lng, halfSideMetres, halfSideMetres);
  const nw = offsetMetres(lat, lng, halfSideMetres, -halfSideMetres);
  return [sw, se, ne, nw];
}

async function main() {
  const stamp = Date.now();
  const BASE_LAT = -26.2041;
  const BASE_LNG = 28.0473;
  const RING = squareRingAround(BASE_LAT, BASE_LNG, 100);
  const gpsInside = { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5 };

  const schoolA = await prisma.school.create({ data: { name: `EduClock Abs A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock Abs B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  async function createStaff(input: {
    schoolId: string;
    email: string;
    name: string;
    role: "STAFF" | "SCHOOL_ADMIN";
    appRole: string;
  }) {
    return prisma.user.create({
      data: {
        schoolId: input.schoolId,
        email: input.email,
        fullName: input.name,
        passwordHash,
        role: input.role,
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: input.schoolId,
            firstName: input.name.split(" ")[0] || input.name,
            surname: input.name.split(" ")[1] || "User",
            appRole: input.appRole,
            permissions: {},
          },
        },
      },
    });
  }

  const ownerA = await createStaff({
    schoolId: schoolA.id,
    email: `owner-abs-${stamp}@example.com`,
    name: "Owner A",
    role: "SCHOOL_ADMIN",
    appRole: "Owner",
  });
  const teacherA = await createStaff({
    schoolId: schoolA.id,
    email: `teacher-abs-${stamp}@example.com`,
    name: "Teacher A",
    role: "STAFF",
    appRole: "Teacher",
  });
  const teacherOther = await createStaff({
    schoolId: schoolA.id,
    email: `teacher-abs-o-${stamp}@example.com`,
    name: "Teacher Other",
    role: "STAFF",
    appRole: "Teacher",
  });
  const teacherTz = await createStaff({
    schoolId: schoolA.id,
    email: `teacher-abs-tz-${stamp}@example.com`,
    name: "Teacher Tz",
    role: "STAFF",
    appRole: "Teacher",
  });
  const ownerB = await createStaff({
    schoolId: schoolB.id,
    email: `owner-abs-b-${stamp}@example.com`,
    name: "Owner B",
    role: "SCHOOL_ADMIN",
    appRole: "Owner",
  });
  const teacherB = await createStaff({
    schoolId: schoolB.id,
    email: `teacher-abs-b-${stamp}@example.com`,
    name: "Teacher B",
    role: "STAFF",
    appRole: "Teacher",
  });

  const empA = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: teacherA.id,
      firstName: "Teacher",
      lastName: "A",
      fullName: "Teacher A",
      employeeNumber: "EMPABS01",
      identityType: "SA_ID",
      idNumber: "9001015800088",
      isActive: true,
    },
  });
  const empOther = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: teacherOther.id,
      firstName: "Teacher",
      lastName: "Other",
      fullName: "Teacher Other",
      employeeNumber: "EMPABS02",
      identityType: "SA_ID",
      idNumber: "9101015800086",
      isActive: true,
    },
  });
  const empTz = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: teacherTz.id,
      firstName: "Teacher",
      lastName: "Tz",
      fullName: "Teacher Tz",
      employeeNumber: "EMPABS03",
      identityType: "SA_ID",
      idNumber: "8001015009087",
      isActive: true,
    },
  });
  const empB = await prisma.employee.create({
    data: {
      schoolId: schoolB.id,
      userId: teacherB.id,
      firstName: "Teacher",
      lastName: "B",
      fullName: "Teacher B",
      employeeNumber: "EMPABS B1",
      identityType: "SA_ID",
      idNumber: "8701015800084",
      isActive: true,
    },
  });

  const campus = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolA.id,
      name: `Campus Abs ${stamp}`,
      isActive: true,
      toleranceMetres: 4,
      perimeterStatus: "NOT_DRAWN",
    },
  });
  await prisma.geofenceZone.create({
    data: {
      schoolId: schoolA.id,
      campusId: campus.id,
      name: `Boundary Abs ${stamp}`,
      type: "CAMPUS_BOUNDARY",
      active: true,
      geometryKind: "POLYGON",
      vertices: {
        create: RING.map((p, sequence) => ({
          schoolId: schoolA.id,
          sequence,
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      },
    },
  });
  await prisma.eduClockCampus.update({
    where: { id: campus.id },
    data: { perimeterStatus: "DRAWN" },
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
  const otherToken = signToken({
    userId: teacherOther.id,
    schoolId: schoolA.id,
    email: teacherOther.email,
    role: "STAFF",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });
  const teacherBToken = signToken({
    userId: teacherB.id,
    schoolId: schoolB.id,
    email: teacherB.email,
    role: "STAFF",
  });

  const today = resolveSchoolLocalParts(new Date()).schoolLocalDate;
  const yesterday = resolveSchoolLocalParts(new Date(Date.now() - 24 * 60 * 60 * 1000)).schoolLocalDate;
  const tomorrow = resolveSchoolLocalParts(new Date(Date.now() + 24 * 60 * 60 * 1000)).schoolLocalDate;

  try {
    // B — reason required
    const blankReason = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "" },
    });
    assert(blankReason.status === 400, `B blank reason 400, got ${blankReason.status}`);

    // C — Other requires note
    const otherBlank = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "OTHER", note: "   " },
    });
    assert(otherBlank.status === 400, `C OTHER blank note 400, got ${otherBlank.status}`);
    assert(String(otherBlank.json.error || "").toLowerCase().includes("note"), "C mentions note");

    // D — identity authority: client employeeId rejected; session employee is used
    const forged = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "SICK", employeeId: empOther.id, schoolId: schoolB.id },
    });
    assert(forged.status === 400, `D forged identity 400, got ${forged.status}`);

    // F — today only
    const yest = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "SICK", schoolLocalDate: yesterday },
    });
    assert(yest.status === 400, `F yesterday 400, got ${yest.status}`);
    const tom = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "SICK", schoolLocalDate: tomorrow },
    });
    assert(tom.status === 400, `F tomorrow 400, got ${tom.status}`);

    // O — GPS still required for clock-in (no coords)
    const gpsMissing = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: teacherToken,
      body: {},
    });
    assert(gpsMissing.status === 400, `O missing GPS 400, got ${gpsMissing.status}`);
    assert(
      String(gpsMissing.json.code || gpsMissing.json.error || "").includes("GPS") ||
        String(gpsMissing.json.error || "").toLowerCase().includes("location"),
      `O GPS message, got ${JSON.stringify(gpsMissing.json)}`
    );

    // A — successful Sick
    const eventsBeforeA = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    const reported = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "SICK", note: "  Flu  ", approvalStatus: "AUTHORISED" },
    });
    assert(reported.status === 201, `A report 201, got ${reported.status}: ${JSON.stringify(reported.json)}`);
    assert(reported.json.absence.reason === "SICK", "A reason SICK");
    assert(reported.json.absence.reasonLabel === "Sick", "A label Sick");
    assert(reported.json.absence.approvalStatus === "REPORTED", "A never self-authorises");
    assert(reported.json.absence.source === "STAFF_SELF_REPORT", "A source");
    assert(reported.json.absence.schoolLocalDate === today, "A today");
    assert(reported.json.absence.note === "Flu", "A note trimmed");
    assert(reported.json.absence.employeeId === empA.id, "A session employee");
    const rowsA = await prisma.eduClockStaffAbsence.findMany({
      where: { schoolId: schoolA.id, employeeId: empA.id, schoolLocalDate: today },
    });
    assert(rowsA.length === 1, `A one row, got ${rowsA.length}`);
    const originalReason = rowsA[0]!.reason;
    const originalNote = rowsA[0]!.note;
    const originalReportedAt = rowsA[0]!.reportedAtUtc.toISOString();
    const originalReportedBy = rowsA[0]!.reportedByUserId;
    const absenceId = rowsA[0]!.id;

    const eventsAfterA = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    assert(eventsAfterA === eventsBeforeA, "A created zero clock events");

    const statusA = await apiCall(baseUrl, "/api/educlock/me/status", { token: teacherToken });
    assert(statusA.json.currentStatus === "ABSENT", "A staff status ABSENT");
    assert(statusA.json.canReportAbsent === false, "A cannot report again");
    assert(statusA.json.absence.reasonLabel === "Sick", "A status reason");

    // I — duplicate
    const dup = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherToken,
      body: { reason: "SICK" },
    });
    assert(dup.status === 200, `I duplicate 200, got ${dup.status}`);
    assert(dup.json.idempotentReplay === true, "I replay flag");
    const rowsDup = await prisma.eduClockStaffAbsence.count({
      where: { schoolId: schoolA.id, employeeId: empA.id, schoolLocalDate: today },
    });
    assert(rowsDup === 1, "I still one row");
    assert(!JSON.stringify(dup.json).includes("P2002"), "I no raw Prisma error");

    // M — payroll: zero events, zero payable minutes
    const clockIns = await prisma.eduClockEvent.count({
      where: { employeeId: empA.id, eventType: EduClockEventType.CLOCK_IN },
    });
    const clockOuts = await prisma.eduClockEvent.count({
      where: { employeeId: empA.id, eventType: EduClockEventType.CLOCK_OUT },
    });
    assert(clockIns === 0, "M zero CLOCK_IN");
    assert(clockOuts === 0, "M zero CLOCK_OUT");
    const payroll = pairEffectiveEventsForEmployee(
      empA.id,
      [],
      computePayrollPeriodBounds(2026, 8)
    );
    assert(payroll.workedMinutes === 0, "M zero payable minutes");

    // J/K/L — Owner visibility
    const board = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=${today}&search=Teacher%20A`,
      { token: ownerToken }
    );
    assert(board.status === 200, `J board 200, got ${board.status}`);
    const row = (board.json.rows || []).find((r: any) => r.employeeId === empA.id);
    assert(row, "J absent employee on board");
    assert(String(row.currentStatus).includes("Absent"), `J status ${row.currentStatus}`);
    assert(String(row.currentStatus).includes("Sick"), "K reason visible");
    assert(row.shiftStatus === "Absent Reported", "J shift Absent Reported");
    assert(row.clockInTime == null && row.clockOutTime == null, "J no fabricated times");
    assert(row.absence.note === "Flu", "L owner note");
    assert(row.absence.source === "STAFF_SELF_REPORT", "L source");
    assert(row.absence.approvalStatus === "REPORTED", "L approval");
    assert(Number(board.json.counts.absentReported) >= 1, "J absent count");

    const teacherBoard = await apiCall(baseUrl, `/api/educlock/owner/attendance`, {
      token: teacherToken,
    });
    assert(teacherBoard.status === 403, "L teacher cannot read owner board");

    // H — absence blocks clock-in
    const blockedIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: teacherToken,
      body: gpsInside,
    });
    assert(blockedIn.status === 409, `H clock-in 409, got ${blockedIn.status}`);
    assert(String(blockedIn.json.error) === ABSENCE_CLOCK_IN_BLOCKED_MESSAGE, "H message");
    const stillNoIn = await prisma.eduClockEvent.count({
      where: { employeeId: empA.id, eventType: EduClockEventType.CLOCK_IN },
    });
    assert(stillNoIn === 0, "H did not create CLOCK_IN");

    // N — clock-out unchanged (still requires open shift)
    const out = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: teacherToken,
      body: gpsInside,
    });
    assert(out.status === 409, `N clock-out 409, got ${out.status}`);
    assert(String(out.json.error || "").toLowerCase().includes("not clocked in"), "N not clocked in");
    const stillNoOut = await prisma.eduClockEvent.count({
      where: { employeeId: empA.id, eventType: EduClockEventType.CLOCK_OUT },
    });
    assert(stillNoOut === 0, "N no CLOCK_OUT");

    // Staff cannot cancel
    const staffCancel = await apiCall(baseUrl, `/api/educlock/owner/absences/${absenceId}/cancel`, {
      method: "POST",
      token: teacherToken,
      body: {},
    });
    assert(staffCancel.status === 403, `staff cancel 403, got ${staffCancel.status}`);

    // Cross-school cancel rejected
    const crossCancel = await apiCall(baseUrl, `/api/educlock/owner/absences/${absenceId}/cancel`, {
      method: "POST",
      token: ownerBToken,
      body: {},
    });
    assert(crossCancel.status === 404 || crossCancel.status === 403, `E cross cancel ${crossCancel.status}`);

    // Q — owner cancel preserves original evidence, does not fabricate CLOCK_IN
    const cancelled = await apiCall(baseUrl, `/api/educlock/owner/absences/${absenceId}/cancel`, {
      method: "POST",
      token: ownerToken,
      body: { note: "Arrived after accidental report" },
    });
    assert(cancelled.status === 200, `Q cancel 200, got ${cancelled.status}`);
    const afterCancel = await prisma.eduClockStaffAbsence.findUnique({ where: { id: absenceId } });
    assert(afterCancel?.approvalStatus === "CANCELLED", "Q cancelled");
    assert(afterCancel?.reason === originalReason, "Q original reason");
    assert(afterCancel?.note === originalNote, "Q original note");
    assert(afterCancel?.reportedAtUtc.toISOString() === originalReportedAt, "Q original reportedAt");
    assert(afterCancel?.reportedByUserId === originalReportedBy, "Q original actor");
    assert(afterCancel?.cancelledByUserId === ownerA.id, "Q cancel actor");
    const eventsAfterCancel = await prisma.eduClockEvent.count({
      where: { employeeId: empA.id },
    });
    assert(eventsAfterCancel === 0, "Q no fabricated clock events");

    const boardAfter = await apiCall(
      baseUrl,
      `/api/educlock/owner/attendance?schoolLocalDate=${today}&search=Teacher%20A`,
      { token: ownerToken }
    );
    const rowAfter = (boardAfter.json.rows || []).find((r: any) => r.employeeId === empA.id);
    assert(rowAfter.currentStatus === "Not Clocked In", `Q board unlocked, got ${rowAfter.currentStatus}`);

    // After cancel, GPS-valid clock-in is allowed
    const clockAfterCancel = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: teacherToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `abs-in-${stamp}` },
    });
    assert(
      clockAfterCancel.status === 201,
      `clock-in after cancel 201, got ${clockAfterCancel.status}: ${JSON.stringify(clockAfterCancel.json)}`
    );

    // G — existing CLOCK_IN blocks absence
    const nowParts = resolveSchoolLocalParts(new Date());
    await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: empOther.id,
        employeeNumberSnapshot: "EMPABS02",
        userId: teacherOther.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date(),
        schoolLocalDate: nowParts.schoolLocalDate,
        schoolLocalTime: nowParts.schoolLocalTime,
        timezone: nowParts.timezone,
        source: "STAFF_MOBILE",
        createdByUserId: teacherOther.id,
        isManualCorrection: false,
      },
    });
    const afterClock = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: otherToken,
      body: { reason: "SICK" },
    });
    assert(afterClock.status === 409, `G 409, got ${afterClock.status}`);
    assert(String(afterClock.json.error) === ABSENCE_AFTER_CLOCK_IN_MESSAGE, "G message");

    // E — school isolation
    const schoolABeforeB = await prisma.eduClockStaffAbsence.count({ where: { schoolId: schoolA.id } });
    const reportB = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: teacherBToken,
      body: { reason: "EMERGENCY" },
    });
    assert(reportB.status === 201, `E school B report 201, got ${reportB.status}`);
    assert(reportB.json.absence.schoolId === schoolB.id, "E school B row");
    assert(reportB.json.absence.employeeId === empB.id, "E school B employee");
    const schoolAAfterB = await prisma.eduClockStaffAbsence.count({ where: { schoolId: schoolA.id } });
    assert(schoolAAfterB === schoolABeforeB, "E school A unchanged");
    const boardB = await apiCall(baseUrl, `/api/educlock/owner/attendance?search=Teacher%20B`, {
      token: ownerBToken,
    });
    const rowB = (boardB.json.rows || []).find((r: any) => r.employeeId === empB.id);
    assert(rowB && String(rowB.currentStatus).includes("Emergency"), "E owner B sees Emergency");
    const leak = await apiCall(baseUrl, `/api/educlock/owner/attendance?search=Teacher%20B`, {
      token: ownerToken,
    });
    const leakRow = (leak.json.rows || []).find((r: any) => r.employeeId === empB.id);
    assert(!leakRow, "E school A owner cannot see school B employee");

    // P — timezone boundary (UTC evening is next SAST calendar day)
    const afterMidnightUtc = new Date("2026-08-13T22:30:00.000Z");
    const beforeMidnightUtc = new Date("2026-08-13T21:30:00.000Z");
    assert(resolveSchoolLocalParts(afterMidnightUtc).schoolLocalDate === "2026-08-14", "P 22:30Z is 14 Aug");
    assert(resolveSchoolLocalParts(beforeMidnightUtc).schoolLocalDate === "2026-08-13", "P 21:30Z is 13 Aug");
    const tzAfter = await staffReportAbsence({
      userId: teacherTz.id,
      schoolId: schoolA.id,
      reason: "SICK",
      nowUtc: afterMidnightUtc,
    });
    assert((tzAfter.absence as any).schoolLocalDate === "2026-08-14", "P absence uses 14 Aug");
    const tzBefore = await staffReportAbsence({
      userId: teacherTz.id,
      schoolId: schoolA.id,
      reason: "FAMILY_RESPONSIBILITY",
      nowUtc: beforeMidnightUtc,
    });
    assert((tzBefore.absence as any).schoolLocalDate === "2026-08-13", "P second row 13 Aug");
    const tzRows = await prisma.eduClockStaffAbsence.findMany({
      where: { employeeId: empTz.id },
      orderBy: { schoolLocalDate: "asc" },
    });
    assert(tzRows.length === 2, "P two local dates");
    assert(tzRows[0]!.schoolLocalDate === "2026-08-13", "P 13 Aug row");
    assert(tzRows[1]!.schoolLocalDate === "2026-08-14", "P 14 Aug row");

    console.log("educlock.staffAbsence.route.test.ts: OK");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
