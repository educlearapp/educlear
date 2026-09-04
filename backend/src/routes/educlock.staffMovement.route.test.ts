/**
 * EduClock staff movement register — route + authority tests.
 * Disposable fixtures only. Does not touch production.
 * Run: npx tsc && node dist/routes/educlock.staffMovement.route.test.js
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient, EduClockEventType } from "@prisma/client";

import educlockRoutes from "./educlock";
import { resolveSchoolLocalParts } from "../utils/schoolLocalTime";
import {
  MOVEMENT_ALREADY_OPEN_MESSAGE,
  MOVEMENT_CLOCK_OUT_BLOCKED_MESSAGE,
  MOVEMENT_LEAVE_ABSENT_MESSAGE,
  MOVEMENT_LEAVE_REQUIRES_CLOCK_IN_MESSAGE,
  MOVEMENT_RETURN_NO_OPEN_MESSAGE,
} from "../services/educlockMovementLabels";
import { staffLeavePremises, staffReturnToPremises } from "../services/educlockStaffMovement";
import {
  pairEffectiveEventsForEmployee,
  computePayrollPeriodBounds,
} from "../services/payrollEduClockPairing";

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
  return { status: res.status, json, text };
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

  const schoolA = await prisma.school.create({ data: { name: `EduClock Mov A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock Mov B ${stamp}` } });
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
    email: `owner-mov-${stamp}@example.com`,
    name: "Owner A",
    role: "SCHOOL_ADMIN",
    appRole: "Owner",
  });
  const teacherA = await createStaff({
    schoolId: schoolA.id,
    email: `teacher-mov-${stamp}@example.com`,
    name: "Teacher A",
    role: "STAFF",
    appRole: "Teacher",
  });
  const teacherOther = await createStaff({
    schoolId: schoolA.id,
    email: `teacher-mov-o-${stamp}@example.com`,
    name: "Teacher Other",
    role: "STAFF",
    appRole: "Teacher",
  });
  const teacherDur = await createStaff({
    schoolId: schoolA.id,
    email: `teacher-mov-d-${stamp}@example.com`,
    name: "Teacher Dur",
    role: "STAFF",
    appRole: "Teacher",
  });
  const ownerB = await createStaff({
    schoolId: schoolB.id,
    email: `owner-mov-b-${stamp}@example.com`,
    name: "Owner B",
    role: "SCHOOL_ADMIN",
    appRole: "Owner",
  });
  const teacherB = await createStaff({
    schoolId: schoolB.id,
    email: `teacher-mov-b-${stamp}@example.com`,
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
      employeeNumber: "EMPMOV01",
      department: "Foundation",
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
      employeeNumber: "EMPMOV02",
      department: "Admin",
      identityType: "SA_ID",
      idNumber: "9101015800086",
      isActive: true,
    },
  });
  const empDur = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: teacherDur.id,
      firstName: "Teacher",
      lastName: "Dur",
      fullName: "Teacher Dur",
      employeeNumber: "EMPMOV03",
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
      employeeNumber: "EMPMOV B1",
      identityType: "SA_ID",
      idNumber: "8701015800084",
      isActive: true,
    },
  });

  async function drawCampus(schoolId: string, name: string) {
    const campus = await prisma.eduClockCampus.create({
      data: {
        schoolId,
        name,
        isActive: true,
        toleranceMetres: 4,
        perimeterStatus: "NOT_DRAWN",
      },
    });
    await prisma.geofenceZone.create({
      data: {
        schoolId,
        campusId: campus.id,
        name: `${name} boundary`,
        type: "CAMPUS_BOUNDARY",
        active: true,
        geometryKind: "POLYGON",
        vertices: {
          create: RING.map((p, sequence) => ({
            schoolId,
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
  }
  await drawCampus(schoolA.id, `Campus Mov A ${stamp}`);
  await drawCampus(schoolB.id, `Campus Mov B ${stamp}`);

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
  const durToken = signToken({
    userId: teacherDur.id,
    schoolId: schoolA.id,
    email: teacherDur.email,
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

  async function clockIn(token: string) {
    const res = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token,
      body: gpsInside,
      headers: { "Idempotency-Key": `in-${token.slice(-8)}-${Date.now()}-${Math.random()}` },
    });
    assert(res.status === 201, `clock-in 201, got ${res.status}: ${JSON.stringify(res.json)}`);
    return res;
  }

  try {
    const noShift = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: { reason: "PERSONAL" },
    });
    assert(noShift.status === 409, `leave without shift 409, got ${noShift.status}`);
    assert(String(noShift.json.error) === MOVEMENT_LEAVE_REQUIRES_CLOCK_IN_MESSAGE, "leave requires clock-in message");

    const absent = await apiCall(baseUrl, "/api/educlock/me/absence", {
      method: "POST",
      token: otherToken,
      body: { reason: "SICK", note: "flu" },
    });
    assert(absent.status === 201, `absence 201, got ${absent.status}`);
    const leaveWhileAbsent = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: otherToken,
      body: { reason: "PERSONAL" },
    });
    assert(leaveWhileAbsent.status === 409, "leave rejected if absent");
    assert(String(leaveWhileAbsent.json.error) === MOVEMENT_LEAVE_ABSENT_MESSAGE, "absent message");

    await clockIn(teacherToken);

    const gpsStillRequired = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: durToken,
      body: {},
    });
    assert(gpsStillRequired.status === 400, "clock GPS still required");

    const destRequired = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: { reason: "SCHOOL_BUSINESS" },
    });
    assert(destRequired.status === 400, "business reason requires destination");
    assert(String(destRequired.json.error || "").toLowerCase().includes("destination"), "destination mentioned");

    const otherNote = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: { reason: "OTHER", destination: "Town" },
    });
    assert(otherNote.status === 400, "OTHER requires note");

    const forged = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: { reason: "PERSONAL", employeeId: empOther.id, schoolId: schoolB.id },
    });
    assert(forged.status === 400, "client identity rejected");

    const eventsBefore = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    const openBefore = await prisma.eduClockOpenShift.findUnique({
      where: { schoolId_employeeId: { schoolId: schoolA.id, employeeId: empA.id } },
    });
    assert(Boolean(openBefore), "open shift exists before leave");

    const left = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: {
        reason: "MEETING",
        destination: "District office",
        note: "SGB",
        latitude: -26.21,
        longitude: 28.05,
        accuracyMetres: 12,
      },
      headers: { "Idempotency-Key": `leave-a-${stamp}` },
    });
    assert(left.status === 201, `leave 201, got ${left.status}: ${JSON.stringify(left.json)}`);
    assert(left.json.movement.status === "OPEN", "status OPEN");
    assert(left.json.movement.reason === "MEETING", "reason MEETING");
    assert(left.json.movement.destination === "District office", "destination");
    assert(left.json.movement.employeeId === empA.id, "session employee");
    assert(left.json.movement.departGps, "optional GPS stored");
    const gpsAttempts = await prisma.eduClockGpsAttempt.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    assert(gpsAttempts === 0, "movement must not write GPS attempts");

    const replayLeave = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: { reason: "MEETING", destination: "District office" },
      headers: { "Idempotency-Key": `leave-a-${stamp}` },
    });
    assert(replayLeave.status === 200, `idempotent leave 200, got ${replayLeave.status}`);
    assert(replayLeave.json.idempotentReplay === true, "leave replay flag");

    const secondOpen = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherToken,
      body: { reason: "PERSONAL" },
      headers: { "Idempotency-Key": `leave-a2-${stamp}` },
    });
    assert(secondOpen.status === 409, "second OPEN rejected");
    assert(String(secondOpen.json.error) === MOVEMENT_ALREADY_OPEN_MESSAGE, "already open message");

    const st = await apiCall(baseUrl, "/api/educlock/me/status", { token: teacherToken });
    assert(st.json.currentStatus === "CLOCKED_IN", `status remains CLOCKED_IN, got ${st.json.currentStatus}`);
    assert(st.json.offPremises === true, "offPremises true");
    assert(st.json.canLeavePremises === false, "cannot leave again");
    assert(st.json.canReturnToPremises === true, "can return");
    assert(st.json.openMovement?.reason === "MEETING", "openMovement on status");

    const eventsAfterLeave = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    assert(eventsAfterLeave === eventsBefore, "no EduClockEvent created by leave");
    const openAfterLeave = await prisma.eduClockOpenShift.findUnique({
      where: { schoolId_employeeId: { schoolId: schoolA.id, employeeId: empA.id } },
    });
    assert(openAfterLeave?.id === openBefore!.id, "open shift unchanged");

    const clockOutBlocked = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: teacherToken,
      body: gpsInside,
    });
    assert(clockOutBlocked.status === 409, "clock-out while OPEN 409");
    assert(String(clockOutBlocked.json.error) === MOVEMENT_CLOCK_OUT_BLOCKED_MESSAGE, "clock-out blocked message");
    const gpsAfterBlockedClockOut = await prisma.eduClockGpsAttempt.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    assert(gpsAfterBlockedClockOut === gpsAttempts, "clock-out 409 must not write GPS attempts");

    const board = await apiCall(baseUrl, "/api/educlock/owner/attendance", { token: ownerToken });
    const rowA = (board.json.rows || []).find((r: any) => r.employeeId === empA.id);
    assert(rowA?.currentStatus === "Clocked In", `attendance still Clocked In, got ${rowA?.currentStatus}`);
    assert(rowA?.offPremises === true, "attendance offPremises badge data");
    assert(Number(board.json.counts.staffOffPremises) >= 1, "overview count from OpenMovement");

    const returned = await apiCall(baseUrl, "/api/educlock/me/movements/return", {
      method: "POST",
      token: teacherToken,
      body: {},
      headers: { "Idempotency-Key": `return-a-${stamp}` },
    });
    assert(returned.status === 201, `return 201, got ${returned.status}: ${JSON.stringify(returned.json)}`);
    assert(returned.json.movement.status === "RETURNED", "returned");
    assert(typeof returned.json.movement.durationAwayMs === "number", "duration stored");
    assert(!returned.json.movement.returnGps, "GPS optional on return without coords");

    const replayReturn = await apiCall(baseUrl, "/api/educlock/me/movements/return", {
      method: "POST",
      token: teacherToken,
      body: {},
      headers: { "Idempotency-Key": `return-a-${stamp}` },
    });
    assert(replayReturn.status === 200, "idempotent return 200");

    const noOpenReturn = await apiCall(baseUrl, "/api/educlock/me/movements/return", {
      method: "POST",
      token: teacherToken,
      body: {},
      headers: { "Idempotency-Key": `return-a-none-${stamp}` },
    });
    assert(noOpenReturn.status === 409, "return without OPEN rejected");
    assert(String(noOpenReturn.json.error) === MOVEMENT_RETURN_NO_OPEN_MESSAGE, "no open message");

    const eventsAfterReturn = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id },
    });
    assert(eventsAfterReturn === eventsBefore, "return creates no clock events");

    await clockIn(durToken);
    const t0 = new Date();
    const t1 = new Date(t0.getTime() + 70 * 60 * 1000);
    const durLeave = await staffLeavePremises({
      userId: teacherDur.id,
      schoolId: schoolA.id,
      reason: "BANK_ERRAND",
      destination: "ABSA",
      nowUtc: t0,
    });
    assert((durLeave.movement as any).status === "OPEN", "duration leave open");
    const durReturn = await staffReturnToPremises({
      userId: teacherDur.id,
      schoolId: schoolA.id,
      nowUtc: t1,
    });
    assert((durReturn.movement as any).durationAwayMs === 70 * 60 * 1000, "duration 70 minutes ms");
    assert((durReturn.movement as any).durationAwayDisplay === "1h 10m", "duration display 1h 10m");

    await clockIn(teacherBToken);
    const leaveB = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: teacherBToken,
      body: { reason: "EMERGENCY", destination: "Hospital" },
    });
    assert(leaveB.status === 201, "school B leave 201");
    const listA = await apiCall(baseUrl, `/api/educlock/owner/movements?status=OPEN`, { token: ownerToken });
    const liveA = listA.json.live?.rows || [];
    assert(!liveA.some((r: any) => r.employeeId === empB.id), "school A cannot see school B movement");
    const listB = await apiCall(baseUrl, `/api/educlock/owner/movements?status=OPEN`, { token: ownerBToken });
    assert((listB.json.live?.rows || []).some((r: any) => r.employeeId === empB.id), "school B sees own live row");

    const teacherOwner = await apiCall(baseUrl, "/api/educlock/owner/movements", { token: teacherToken });
    assert(teacherOwner.status === 403, "teacher cannot list owner movements");

    const leaveOther = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: durToken,
      body: { reason: "PERSONAL" },
    });
    assert(leaveOther.status === 201, "other leave for owner return/cancel");
    const otherMovementId = leaveOther.json.movement.id;
    const originalDeparted = leaveOther.json.movement.departedAtUtc;
    const originalReason = leaveOther.json.movement.reason;

    const ownerReturn = await apiCall(baseUrl, `/api/educlock/owner/movements/${otherMovementId}/return`, {
      method: "POST",
      token: ownerToken,
      body: {},
    });
    assert(ownerReturn.status === 200 || ownerReturn.status === 201, `owner return ok, got ${ownerReturn.status}`);
    assert(ownerReturn.json.movement.status === "RETURNED", "owner return status");
    assert(ownerReturn.json.movement.departedAtUtc === originalDeparted, "owner return keeps original departure");
    assert(ownerReturn.json.movement.reason === originalReason, "owner return keeps original reason");

    const leaveCancel = await apiCall(baseUrl, "/api/educlock/me/movements/leave", {
      method: "POST",
      token: durToken,
      body: { reason: "COLLECT_DELIVER", destination: "Post office", note: "parcels" },
    });
    assert(leaveCancel.status === 201, "leave for cancel");
    const cancelId = leaveCancel.json.movement.id;
    const cancelOrig = {
      departedAtUtc: leaveCancel.json.movement.departedAtUtc,
      reason: leaveCancel.json.movement.reason,
      destination: leaveCancel.json.movement.destination,
      note: leaveCancel.json.movement.note,
    };
    const cancelled = await apiCall(baseUrl, `/api/educlock/owner/movements/${cancelId}/cancel`, {
      method: "POST",
      token: ownerToken,
      body: { note: "Entered in error" },
    });
    assert(cancelled.status === 200, `owner cancel 200, got ${cancelled.status}`);
    assert(cancelled.json.movement.status === "CANCELLED", "cancelled");
    assert(cancelled.json.movement.departedAtUtc === cancelOrig.departedAtUtc, "cancel preserves departure");
    assert(cancelled.json.movement.reason === cancelOrig.reason, "cancel preserves reason");
    assert(cancelled.json.movement.destination === cancelOrig.destination, "cancel preserves destination");
    assert(cancelled.json.movement.note === cancelOrig.note, "cancel preserves note");
    assert(cancelled.json.movement.returnedAtUtc == null, "cancel does not invent return");
    assert(cancelled.json.movement.cancelNote === "Entered in error", "cancel note stored");

    const filtered = await apiCall(
      baseUrl,
      `/api/educlock/owner/movements?reason=MEETING&department=Foundation&startDate=2020-01-01&endDate=2099-12-31`,
      { token: ownerToken }
    );
    assert(filtered.status === 200, "owner list 200");
    const hist = filtered.json.history?.rows || [];
    assert(hist.some((r: any) => r.reason === "MEETING" && r.employeeId === empA.id), "filter reason+department");

    const csv = await apiCall(
      baseUrl,
      `/api/educlock/owner/movements/export.csv?startDate=2020-01-01&endDate=2099-12-31`,
      { token: ownerToken }
    );
    assert(csv.status === 200, `csv 200, got ${csv.status}`);
    const csvText = typeof csv.json === "string" ? csv.json : csv.text;
    assert(String(csvText).includes("date,employee"), "csv header");
    assert(String(csvText).toLowerCase().includes("meeting") || String(csvText).includes("MEETING") || String(csvText).includes("Meeting"), "csv contains meeting row");

    const clockIns = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id, eventType: EduClockEventType.CLOCK_IN },
    });
    const clockOuts = await prisma.eduClockEvent.count({
      where: { schoolId: schoolA.id, employeeId: empA.id, eventType: EduClockEventType.CLOCK_OUT },
    });
    assert(clockIns === 1, "payroll: still one CLOCK_IN");
    assert(clockOuts === 0, "payroll: movement did not add CLOCK_OUT");
    const payroll = pairEffectiveEventsForEmployee(empA.id, [], computePayrollPeriodBounds(2026, 9));
    assert(payroll.workedMinutes === 0, "payroll minutes unchanged");

    console.log("educlock.staffMovement.route.test PASS");
  } finally {
    server.close();
    await prisma.eduClockGpsAttempt.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockOpenMovement.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockStaffMovement.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockOpenShift.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockEvent.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockStaffAbsence.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockException.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockIdempotencyKey.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.geofenceVertex.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.geofenceZone.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockCampus.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.employee.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.user.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
