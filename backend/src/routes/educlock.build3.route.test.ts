/**
 * EduClock Build 3 — clock event lifecycle tests.
 * Run: npx tsc && node dist/routes/educlock.build3.route.test.js
 */
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

function containsRaw(payload: unknown, raw: string): boolean {
  return JSON.stringify(payload).includes(raw);
}

async function main() {
  const stamp = Date.now();
  const VALID_SA_ID = "9001015800088";
  const EMP_NO = "00123";

  const schoolA = await prisma.school.create({ data: { name: `EduClock B3 A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock B3 B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-b3-${stamp}@example.com`,
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

  const staffUser = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `staff-b3-${stamp}@example.com`,
      fullName: "Staff Clock",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Staff",
          surname: "Clock",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });

  const otherStaff = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `other-b3-${stamp}@example.com`,
      fullName: "Other Staff",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Other",
          surname: "Staff",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });

  const teacherNoManage = staffUser;

  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `owner-b3-b-${stamp}@example.com`,
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
      userId: staffUser.id,
      firstName: "Staff",
      lastName: "Clock",
      fullName: "Staff Clock",
      employeeNumber: EMP_NO,
      identityType: "SA_ID",
      idNumber: VALID_SA_ID,
      isActive: true,
    },
  });

  const empOther = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: otherStaff.id,
      firstName: "Other",
      lastName: "Staff",
      fullName: "Other Staff",
      employeeNumber: "00456",
      identityType: "SA_ID",
      idNumber: "9101015800086",
      isActive: true,
    },
  });

  const empMissingNo = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `missingno-b3-${stamp}@example.com`,
      fullName: "Missing Number",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Missing",
          surname: "Number",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: empMissingNo.id,
      firstName: "Missing",
      lastName: "Number",
      fullName: "Missing Number",
      employeeNumber: null,
      identityType: "SA_ID",
      idNumber: "8701015800084",
      isActive: true,
    },
  });

  const inactiveUser = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `inactive-b3-${stamp}@example.com`,
      fullName: "Inactive Emp",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Inactive",
          surname: "Emp",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: inactiveUser.id,
      firstName: "Inactive",
      lastName: "Emp",
      fullName: "Inactive Emp",
      employeeNumber: "00999",
      identityType: "SA_ID",
      idNumber: "8001015009087",
      isActive: false,
    },
  });

  const unlinkedUser = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `unlinked-b3-${stamp}@example.com`,
      fullName: "Unlinked",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Unlinked",
          surname: "User",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });

  // Build 4: staff mobile clock requires an active entrance with coordinates.
  const ENTRANCE_LAT = -26.2041;
  const ENTRANCE_LNG = 28.0473;
  const campus = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolA.id,
      name: `Campus B3 ${stamp}`,
      toleranceMetres: 4,
      isActive: true,
      perimeterStatus: "NOT_DRAWN",
    },
  });
  await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campus.id,
      name: "Main Gate",
      latitude: ENTRANCE_LAT,
      longitude: ENTRANCE_LNG,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  });
  const gpsInside = {
    latitude: ENTRANCE_LAT,
    longitude: ENTRANCE_LNG,
    accuracyMetres: 5,
    capturedAtClient: "2020-01-01T00:00:00.000Z",
  };

  const app = express();
  app.use(express.json());
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const staffToken = signToken({
    userId: staffUser.id,
    schoolId: schoolA.id,
    email: staffUser.email,
    role: "STAFF",
  });
  const otherToken = signToken({
    userId: otherStaff.id,
    schoolId: schoolA.id,
    email: otherStaff.email,
    role: "STAFF",
  });
  const ownerToken = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });
  const missingNoToken = signToken({
    userId: empMissingNo.id,
    schoolId: schoolA.id,
    email: empMissingNo.email,
    role: "STAFF",
  });
  const inactiveToken = signToken({
    userId: inactiveUser.id,
    schoolId: schoolA.id,
    email: inactiveUser.email,
    role: "STAFF",
  });
  const unlinkedToken = signToken({
    userId: unlinkedUser.id,
    schoolId: schoolA.id,
    email: unlinkedUser.email,
    role: "STAFF",
  });

  try {
    // Blocked: no link / missing number / inactive
    const unlinkedStatus = await apiCall(baseUrl, "/api/educlock/me/status", { token: unlinkedToken });
    assert(unlinkedStatus.status === 200, "unlinked status 200");
    assert(unlinkedStatus.json.canClock === false, "unlinked cannot clock");

    const missingNoIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: missingNoToken,
      body: {},
    });
    assert(missingNoIn.status === 403, `missing number blocked, got ${missingNoIn.status}`);

    const inactiveIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: inactiveToken,
      body: {},
    });
    assert(inactiveIn.status === 403, `inactive blocked, got ${inactiveIn.status}`);

    // Client timestamp ignored / rejected
    const rejectTs = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { occurredAt: "2020-01-01T00:00:00.000Z", timezone: "America/New_York", employeeId: empOther.id },
    });
    assert(rejectTs.status === 400, `client timestamp rejected, got ${rejectTs.status}`);

    // Clock in
    const before = new Date();
    const clockIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `in-${stamp}` },
    });
    assert(clockIn.status === 201, `clock in expected 201, got ${clockIn.status}: ${JSON.stringify(clockIn.json)}`);
    assert(clockIn.json.event.eventType === "CLOCK_IN", "CLOCK_IN type");
    assert(clockIn.json.event.employeeNumber === EMP_NO, "leading zeros preserved on snapshot");
    assert(clockIn.json.event.timezone === "Africa/Johannesburg", "school TZ");
    const occurred = new Date(clockIn.json.event.occurredAtUtc);
    assert(occurred.getTime() >= before.getTime() - 2000, "server timestamp near now");
    assert(!containsRaw(clockIn.json, VALID_SA_ID), "raw ID leaked on clock-in");

    // Idempotent replay
    const clockInReplay = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `in-${stamp}` },
    });
    assert(clockInReplay.status === 201 || clockInReplay.status === 200, "idempotent replay ok");
    assert(clockInReplay.json.event.id === clockIn.json.event.id, "idempotent same event");

    // Duplicate clock in rejected
    const dupIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `in-dup-${stamp}` },
    });
    assert(dupIn.status === 409, `duplicate clock in 409, got ${dupIn.status}`);

    // Concurrent clock-in: only one open shift (employee already open — use other staff)
    const concurrent = await Promise.all([
      apiCall(baseUrl, "/api/educlock/me/clock-in", {
        method: "POST",
        token: otherToken,
        body: gpsInside,
        headers: { "Idempotency-Key": `c1-${stamp}` },
      }),
      apiCall(baseUrl, "/api/educlock/me/clock-in", {
        method: "POST",
        token: otherToken,
        body: gpsInside,
        headers: { "Idempotency-Key": `c2-${stamp}` },
      }),
    ]);
    const okIns = concurrent.filter((r) => r.status === 201);
    const conflictIns = concurrent.filter((r) => r.status === 409);
    assert(okIns.length === 1, `concurrent clock-in should succeed once, got ${okIns.length}`);
    assert(conflictIns.length === 1, `concurrent clock-in should conflict once, got ${conflictIns.length}`);
    const openCount = await prisma.eduClockOpenShift.count({
      where: { schoolId: schoolA.id, employeeId: empOther.id },
    });
    assert(openCount === 1, "one open shift after concurrent");

    // Clock out without clock in (unlinked) already covered; staff already in — clock out
    const clockOut = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `out-${stamp}` },
    });
    assert(clockOut.status === 200, `clock out 200, got ${clockOut.status}`);
    assert(clockOut.json.completedShift.durationDisplay, "duration present");
    assert(clockOut.json.event.eventType === "CLOCK_OUT", "CLOCK_OUT");

    const dupOut = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `out-dup-${stamp}` },
    });
    assert(dupOut.status === 409, `duplicate clock out 409, got ${dupOut.status}`);

    // Concurrent clock-out for otherStaff (still open)
    const concurrentOut = await Promise.all([
      apiCall(baseUrl, "/api/educlock/me/clock-out", {
        method: "POST",
        token: otherToken,
        body: gpsInside,
        headers: { "Idempotency-Key": `o1-${stamp}` },
      }),
      apiCall(baseUrl, "/api/educlock/me/clock-out", {
        method: "POST",
        token: otherToken,
        body: gpsInside,
        headers: { "Idempotency-Key": `o2-${stamp}` },
      }),
    ]);
    const okOuts = concurrentOut.filter((r) => r.status === 200);
    assert(okOuts.length === 1, `concurrent clock-out once, got ${okOuts.length}`);
    assert(
      (await prisma.eduClockOpenShift.count({ where: { employeeId: empOther.id } })) === 0,
      "no open shift after concurrent out"
    );

    // History is personal
    const hist = await apiCall(baseUrl, "/api/educlock/me/history", { token: staffToken });
    assert(hist.status === 200, "history 200");
    assert(hist.json.employeeId === emp.id, "own history only");
    for (const shift of hist.json.shifts || []) {
      assert(shift.clockIn.employeeId === emp.id, "history employee scoped");
    }

    // Owner attendance
    const attendance = await apiCall(baseUrl, "/api/educlock/owner/attendance", { token: ownerToken });
    assert(attendance.status === 200, "owner attendance 200");
    assert(!containsRaw(attendance.json, VALID_SA_ID), "raw ID in attendance");

    // Teacher without manage blocked from owner attendance
    const teacherAtt = await apiCall(baseUrl, "/api/educlock/owner/attendance", {
      token: staffToken,
    });
    assert(teacherAtt.status === 403, `staff cannot owner attendance, got ${teacherAtt.status}`);

    // Cross-school blocked
    const cross = await apiCall(baseUrl, "/api/educlock/owner/attendance", {
      token: ownerToken,
      // claim other school via query — middleware should reject
    });
    // Use body schoolId on correction
    const crossCorr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        schoolId: schoolB.id,
        employeeId: emp.id,
        action: "ADD_CLOCK_OUT",
        reason: "Owner-approved correction",
        schoolLocalDate: "2026-07-22",
        schoolLocalTime: "16:00",
      },
    });
    assert(crossCorr.status === 403, `cross-school correction 403, got ${crossCorr.status}`);

    // Missing clock out exception: create open shift on previous school-local day
    const yesterdayUtc = new Date("2026-07-20T10:00:00+02:00");
    const yLocal = resolveSchoolLocalParts(yesterdayUtc, "Africa/Johannesburg");
    const pastIn = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: emp.id,
        employeeNumberSnapshot: EMP_NO,
        userId: staffUser.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: yesterdayUtc,
        schoolLocalDate: yLocal.schoolLocalDate,
        schoolLocalTime: yLocal.schoolLocalTime,
        timezone: yLocal.timezone,
        source: "STAFF_MOBILE",
        createdByUserId: staffUser.id,
      },
    });
    await prisma.eduClockOpenShift.create({
      data: {
        schoolId: schoolA.id,
        employeeId: emp.id,
        clockInEventId: pastIn.id,
        schoolLocalDate: yLocal.schoolLocalDate,
        openedAtUtc: yesterdayUtc,
      },
    });

    const exceptions = await apiCall(baseUrl, "/api/educlock/owner/exceptions", {
      token: ownerToken,
      // no date filter — should include missing clock out after ensure
    });
    assert(exceptions.status === 200, "exceptions 200");
    const missing = (exceptions.json.rows || []).find(
      (r: any) => r.exceptionType === "MISSING_CLOCK_OUT" && r.employeeId === emp.id
    );
    assert(Boolean(missing), "Missing Clock Out exception present");

    // Owner audited correction closes open shift
    const corr = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Employee forgot to clock out",
        schoolLocalDate: yLocal.schoolLocalDate,
        schoolLocalTime: "16:04",
      },
    });
    assert(corr.status === 201, `correction 201, got ${corr.status}: ${JSON.stringify(corr.json)}`);
    assert(corr.json.correctionEvent.isManualCorrection === true, "manual correction flag");
    assert(corr.json.originalEventId === pastIn.id, "links original clock-in");
    const stillThere = await prisma.eduClockEvent.findUnique({ where: { id: pastIn.id } });
    assert(Boolean(stillThere), "original event preserved");

    // Impossible order rejected
    const reopen = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `reopen-${stamp}` },
    });
    assert(reopen.status === 201, `reopen clock-in 201, got ${reopen.status}`);
    const reopenLocal = resolveSchoolLocalParts(new Date(), "Africa/Johannesburg");
    const badOrder = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "Owner-approved correction",
        schoolLocalDate: reopenLocal.schoolLocalDate,
        // Before any realistic clock-in on the same day
        schoolLocalTime: "00:01",
      },
    });
    assert(badOrder.status === 400, `impossible order 400, got ${badOrder.status}`);

    // Correction requires reason
    const noReason = await apiCall(baseUrl, "/api/educlock/owner/corrections", {
      method: "POST",
      token: ownerToken,
      body: {
        employeeId: emp.id,
        action: "CLOSE_OPEN_SHIFT",
        reason: "",
        schoolLocalDate: resolveSchoolLocalParts(new Date(), "Africa/Johannesburg").schoolLocalDate,
        schoolLocalTime: "17:00",
      },
    });
    assert(noReason.status === 400, "reason required");

    // Midnight / TZ: UTC date differs from school-local
    const nearMidnightUtc = new Date("2026-07-21T22:30:00.000Z"); // 00:30 SAST next day
    const parts = resolveSchoolLocalParts(nearMidnightUtc, "Africa/Johannesburg");
    assert(parts.schoolLocalDate === "2026-07-22", `expected 2026-07-22, got ${parts.schoolLocalDate}`);
    assert(parts.timezone === "Africa/Johannesburg", "timezone Johannesburg");

    // Owner B cannot see school A event
    const steal = await apiCall(baseUrl, `/api/educlock/owner/events/${pastIn.id}`, {
      token: ownerBToken,
    });
    assert(steal.status === 404 || steal.status === 403, `cross-school event blocked ${steal.status}`);

    // Clean open shift if any left from bad-order attempt
    await prisma.eduClockOpenShift.deleteMany({ where: { employeeId: emp.id } });

    console.log("EDUCLOCK BUILD 3 ROUTE TESTS PASS");
  } finally {
    server.close();
    await prisma.eduClockIdempotencyKey.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockException.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockOpenShift.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockEvent.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockActivationAudit.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.employee.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: {
        userId: {
          in: [
            ownerA.id,
            staffUser.id,
            otherStaff.id,
            ownerB.id,
            empMissingNo.id,
            inactiveUser.id,
            unlinkedUser.id,
          ],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            ownerA.id,
            staffUser.id,
            otherStaff.id,
            ownerB.id,
            empMissingNo.id,
            inactiveUser.id,
            unlinkedUser.id,
          ],
        },
      },
    });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
