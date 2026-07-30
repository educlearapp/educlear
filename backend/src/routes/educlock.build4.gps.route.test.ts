/**
 * EduClock Build 4 — GPS validation route/service tests.
 * MUST run only against educlear_educlock_dev.
 * Run: DATABASE_URL=...educlear_educlock_dev npx tsc && node dist/routes/educlock.build4.gps.route.test.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import fs from "fs";
import http from "http";
import jwt from "jsonwebtoken";
import path from "path";
import { PrismaClient } from "@prisma/client";

import educlockRoutes from "./educlock";
import { haversineDistanceMetres } from "../utils/educlockGpsDistance";
import { EDUCLOCK_GPS_VALIDATION_VERSION } from "../services/educlockGpsValidation";

function loadDevDatabaseUrl(): string {
  const envPath = path.join(__dirname, "../../.env.educlock_dev");
  const raw = fs.readFileSync(envPath, "utf8");
  const m = raw.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error("Missing DATABASE_URL in .env.educlock_dev");
  return m[1];
}

const DEV_URL = loadDevDatabaseUrl();
process.env.DATABASE_URL = DEV_URL;

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
  pathName: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    token?: string;
    headers?: Record<string, string>;
  } = {}
) {
  const res = await fetch(`${baseUrl}${pathName}`, {
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

async function main() {
  const u = new URL(DEV_URL);
  const host = u.hostname;
  const dbName = u.pathname.replace(/^\//, "");
  console.log(JSON.stringify({ resolvedHost: host, resolvedDatabase: dbName }, null, 2));
  if ((host !== "localhost" && host !== "127.0.0.1") || dbName !== "educlear_educlock_dev") {
    throw new Error("ABORT: Build 4 GPS tests must target localhost/educlear_educlock_dev only");
  }

  const stamp = Date.now();
  const VALID_SA_ID = "9001015800088";
  const EMP_NO = "00123";
  const BASE_LAT = -26.2041;
  const BASE_LNG = 28.0473;

  const schoolA = await prisma.school.create({ data: { name: `EduClock B4 A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock B4 B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const staffA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `staff-b4-${stamp}@example.com`,
      fullName: "Staff GPS",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Staff",
          surname: "GPS",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });

  const empA = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      userId: staffA.id,
      firstName: "Staff",
      lastName: "GPS",
      fullName: "Staff GPS",
      employeeNumber: EMP_NO,
      identityType: "SA_ID",
      idNumber: VALID_SA_ID,
      isActive: true,
    },
  });

  const campusA = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolA.id,
      name: `Campus A ${stamp}`,
      isActive: true,
      toleranceMetres: 4,
      perimeterStatus: "NOT_DRAWN",
    },
  });
  const entranceNear = await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "Near Gate",
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  });
  const entranceFar = await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "Far Gate",
      latitude: BASE_LAT + 0.01,
      longitude: BASE_LNG,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  });
  const entranceNoCoords = await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "No Coords",
      latitude: null,
      longitude: null,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  });
  const entranceInactive = await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "Inactive Gate",
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      allowedRadiusMetres: 5,
      isActive: false,
    },
  });

  const inactiveCampus = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolA.id,
      name: `Inactive Campus ${stamp}`,
      isActive: false,
      toleranceMetres: 4,
      perimeterStatus: "NOT_DRAWN",
    },
  });
  await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: inactiveCampus.id,
      name: "On Inactive Campus",
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  });

  // School B entrance close to same coords — must never match School A staff
  const campusB = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolB.id,
      name: `Campus B ${stamp}`,
      isActive: true,
      toleranceMetres: 4,
      perimeterStatus: "NOT_DRAWN",
    },
  });
  const entranceB = await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolB.id,
      campusId: campusB.id,
      name: "School B Gate",
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  });

  // Equal-distance tie fixtures (separate school for isolation of tie test)
  const schoolTie = await prisma.school.create({ data: { name: `EduClock B4 Tie ${stamp}` } });
  const staffTie = await prisma.user.create({
    data: {
      schoolId: schoolTie.id,
      email: `tie-b4-${stamp}@example.com`,
      fullName: "Tie Staff",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolTie.id,
          firstName: "Tie",
          surname: "Staff",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  await prisma.employee.create({
    data: {
      schoolId: schoolTie.id,
      userId: staffTie.id,
      firstName: "Tie",
      lastName: "Staff",
      fullName: "Tie Staff",
      employeeNumber: "T001",
      identityType: "SA_ID",
      idNumber: "9101015800086",
      isActive: true,
    },
  });
  const campusTie = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolTie.id,
      name: `Tie Campus ${stamp}`,
      isActive: true,
      toleranceMetres: 4,
      perimeterStatus: "NOT_DRAWN",
    },
  });
  // Two entrances equidistant north/south of origin
  const tieLat = -26.3;
  const tieLng = 28.1;
  const north5 = offsetMetres(tieLat, tieLng, 5, 0);
  const south5 = offsetMetres(tieLat, tieLng, -5, 0);
  // Force IDs so tie-break is deterministic by ID ascending
  const entranceTieZ = await prisma.eduClockEntrance.create({
    data: {
      id: `z-tie-${stamp}`,
      schoolId: schoolTie.id,
      campusId: campusTie.id,
      name: "Z Gate",
      latitude: north5.latitude,
      longitude: north5.longitude,
      allowedRadiusMetres: 10,
      isActive: true,
    },
  });
  const entranceTieA = await prisma.eduClockEntrance.create({
    data: {
      id: `a-tie-${stamp}`,
      schoolId: schoolTie.id,
      campusId: campusTie.id,
      name: "A Gate",
      latitude: south5.latitude,
      longitude: south5.longitude,
      allowedRadiusMetres: 10,
      isActive: true,
    },
  });
  void entranceTieZ;
  void entranceNoCoords;
  void entranceInactive;
  void entranceFar;

  const app = express();
  app.use(express.json());
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const staffToken = signToken({
    userId: staffA.id,
    schoolId: schoolA.id,
    email: staffA.email,
    role: "STAFF",
  });
  const tieToken = signToken({
    userId: staffTie.id,
    schoolId: schoolTie.id,
    email: staffTie.email,
    role: "STAFF",
  });

  const createdSchoolIds = [schoolA.id, schoolB.id, schoolTie.id];
  const eventsBefore = await prisma.eduClockEvent.count({
    where: { schoolId: { in: createdSchoolIds } },
  });
  const attemptsBefore = await prisma.eduClockGpsAttempt.count({
    where: { schoolId: { in: createdSchoolIds } },
  });

  try {
    // 1-2 distance utility already covered in unit test; spot-check here
    assert(haversineDistanceMetres({ latitude: BASE_LAT, longitude: BASE_LNG }, { latitude: BASE_LAT, longitude: BASE_LNG }) === 0, "identical 0");

    const gpsInside = {
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
      capturedAtClient: "2099-01-01T00:00:00.000Z",
      // Ignored (never trusted as authority):
      entranceId: entranceB.id,
      distanceMetres: 9999,
      insideGeofence: false,
      matchedEntranceId: entranceB.id,
    };

    // 26-27 client schoolId / employeeId must not be accepted as authority (rejected)
    const forgedIds = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { ...gpsInside, schoolId: schoolB.id, employeeId: "forged-employee" },
    });
    assert(forgedIds.status === 400, "client schoolId/employeeId rejected");
    assert(
      String(forgedIds.json.error || "").includes("schoolId") ||
        String(forgedIds.json.error || "").includes("employeeId"),
      "forged id rejection message"
    );

    // 3 valid clock-in within 5m
    const beforeIn = new Date();
    const clockIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-in-${stamp}` },
    });
    assert(clockIn.status === 201, `inside clock-in 201, got ${clockIn.status}: ${JSON.stringify(clockIn.json)}`);
    assert(clockIn.json.event.matchedEntranceId === entranceNear.id, "nearest entrance matched");
    assert(clockIn.json.event.matchedEntranceId !== entranceB.id, "never school B entrance");
    assert(clockIn.json.event.validationVersion === EDUCLOCK_GPS_VALIDATION_VERSION, "validation version");
    assert(clockIn.json.event.latitude === BASE_LAT, "lat stored");
    assert(Number(clockIn.json.event.distanceMetres) <= 5, "distance within radius");
    assert(new Date(clockIn.json.event.occurredAtUtc).getTime() >= beforeIn.getTime() - 2000, "server time");
    assert(clockIn.json.event.occurredAtUtc !== "2099-01-01T00:00:00.000Z", "client time ignored");

    // 32 idempotency
    const replay = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-in-${stamp}` },
    });
    assert(replay.json.event.id === clockIn.json.event.id, "idempotent accepted replay");

    // 30 duplicate clock-in
    const dup = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-dup-${stamp}` },
    });
    assert(dup.status === 409, `dup clock-in 409, got ${dup.status}`);

    // 4 clock-out within 5m
    const clockOut = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: { ...gpsInside, accuracyMetres: 20 },
      headers: { "Idempotency-Key": `b4-out-${stamp}` },
    });
    assert(clockOut.status === 200, `clock-out 200, got ${clockOut.status}`);
    assert(clockOut.json.event.accuracyMetres === 20, "accuracy 20 accepted");

    // 31 clock-out without open shift
    const noOpen = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-noopen-${stamp}` },
    });
    assert(noOpen.status === 409, `no open shift 409, got ${noOpen.status}`);

    // 5 boundary exactly at radius
    const atBoundary = offsetMetres(BASE_LAT, BASE_LNG, 5, 0);
    const dBoundary = haversineDistanceMetres(
      { latitude: BASE_LAT, longitude: BASE_LNG },
      atBoundary
    );
    assert(dBoundary <= 5.05, `boundary fixture distance ${dBoundary}`);
    const boundaryIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { ...atBoundary, accuracyMetres: 8 },
    });
    assert(boundaryIn.status === 201, `boundary accepted, got ${boundaryIn.status}: ${JSON.stringify(boundaryIn.json)}`);
    await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: { ...atBoundary, accuracyMetres: 8 },
    });

    // 6 outside
    const outside = offsetMetres(BASE_LAT, BASE_LNG, 10, 0);
    const outsideRes = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { ...outside, accuracyMetres: 5 },
    });
    assert(outsideRes.status === 400, `outside 400, got ${outsideRes.status}`);
    assert(outsideRes.json.code === "OUTSIDE_GEOFENCE", `code OUTSIDE, got ${outsideRes.json.code}`);
    const outsideAttempts = await prisma.eduClockGpsAttempt.count({
      where: { schoolId: schoolA.id, employeeId: empA.id, rejectionCode: "OUTSIDE_GEOFENCE" },
    });
    assert(outsideAttempts >= 1, "outside audited");
    assert(
      (await prisma.eduClockEvent.count({ where: { schoolId: schoolA.id, employeeId: empA.id, eventType: "CLOCK_IN" } })) ===
        2,
      "outside created no extra event beyond prior 2 clock-ins"
    );

    // 8 accuracy > 20
    const accHigh = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 20.01 },
      headers: { "Idempotency-Key": `b4-acc-${stamp}` },
    });
    assert(accHigh.status === 400 && accHigh.json.code === "GPS_ACCURACY_TOO_LOW", "accuracy too low");
    // idempotent rejection replay should not flood
    const accHigh2 = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 20.01 },
      headers: { "Idempotency-Key": `b4-acc-${stamp}` },
    });
    assert(accHigh2.status === 400 && accHigh2.json.code === "GPS_ACCURACY_TOO_LOW", "acc replay");
    const accAttempts = await prisma.eduClockGpsAttempt.count({
      where: { schoolId: schoolA.id, rejectionCode: "GPS_ACCURACY_TOO_LOW" },
    });
    assert(accAttempts === 1, `accuracy audit once for same idem key, got ${accAttempts}`);

    // 9-16 missing/invalid/denied/unavailable/timeout
    const cases: Array<{ body: Record<string, unknown>; code: string }> = [
      { body: { accuracyMetres: 5 }, code: "GPS_COORDINATES_MISSING" },
      { body: { latitude: 999, longitude: BASE_LNG, accuracyMetres: 5 }, code: "GPS_COORDINATES_INVALID" },
      { body: { latitude: BASE_LAT, longitude: 999, accuracyMetres: 5 }, code: "GPS_COORDINATES_INVALID" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG }, code: "GPS_ACCURACY_MISSING" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: -1 }, code: "GPS_ACCURACY_INVALID" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: "not-a-number" }, code: "GPS_ACCURACY_INVALID" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5, permissionState: "denied" }, code: "GPS_PERMISSION_DENIED" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5, locationError: "UNAVAILABLE" }, code: "GPS_UNAVAILABLE" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5, locationError: "TIMEOUT" }, code: "GPS_TIMEOUT" },
    ];
    for (const c of cases) {
      const res = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
        method: "POST",
        token: staffToken,
        body: c.body,
      });
      assert(res.status === 400 && res.json.code === c.code, `${c.code} expected, got ${res.status}/${res.json?.code}`);
      const n = await prisma.eduClockGpsAttempt.count({
        where: { schoolId: schoolA.id, rejectionCode: c.code },
      });
      assert(n >= 1, `${c.code} audited`);
    }

    // 17 no active entrance — deactivate school A entrances with coords temporarily via inactive campus only school
    const schoolEmpty = await prisma.school.create({ data: { name: `EduClock B4 Empty ${stamp}` } });
    createdSchoolIds.push(schoolEmpty.id);
    const staffEmpty = await prisma.user.create({
      data: {
        schoolId: schoolEmpty.id,
        email: `empty-b4-${stamp}@example.com`,
        fullName: "Empty Staff",
        passwordHash,
        role: "STAFF",
        isActive: true,
        rbacMeta: {
          create: {
            schoolId: schoolEmpty.id,
            firstName: "Empty",
            surname: "Staff",
            appRole: "Teacher",
            permissions: {},
          },
        },
      },
    });
    await prisma.employee.create({
      data: {
        schoolId: schoolEmpty.id,
        userId: staffEmpty.id,
        firstName: "Empty",
        lastName: "Staff",
        fullName: "Empty Staff",
        employeeNumber: "E001",
        identityType: "SA_ID",
        idNumber: "8701015800084",
        isActive: true,
      },
    });
    const emptyToken = signToken({
      userId: staffEmpty.id,
      schoolId: schoolEmpty.id,
      email: staffEmpty.email,
      role: "STAFF",
    });
    const noEnt = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: emptyToken,
      body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5 },
    });
    assert(noEnt.status === 400 && noEnt.json.code === "NO_ACTIVE_ENTRANCE", "no active entrance");

    // 21 nearest entrance — already checked entranceNear vs far
    // 22 equal distance tie => lower entrance id
    const tieIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: tieToken,
      body: { latitude: tieLat, longitude: tieLng, accuracyMetres: 5 },
    });
    assert(tieIn.status === 201, `tie clock-in 201, got ${tieIn.status}: ${JSON.stringify(tieIn.json)}`);
    assert(tieIn.json.event.matchedEntranceId === entranceTieA.id, `tie prefers lower id, got ${tieIn.json.event.matchedEntranceId}`);

    // 35 metadata safety
    const attempts = await prisma.eduClockGpsAttempt.findMany({
      where: { schoolId: schoolA.id },
      take: 50,
    });
    for (const row of attempts) {
      const meta = JSON.stringify(row.deviceMetadata || {});
      assert(!meta.includes("TestPass"), "password not in metadata");
      assert(!meta.includes("Bearer"), "token not in metadata");
      assert(!meta.includes(VALID_SA_ID), "identity not in metadata");
    }

    // 34 historical non-GPS event readable
    const hist = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: empA.id,
        employeeNumberSnapshot: EMP_NO,
        userId: staffA.id,
        eventType: "CLOCK_OUT",
        occurredAtUtc: new Date("2020-01-01T10:00:00.000Z"),
        schoolLocalDate: "2020-01-01",
        schoolLocalTime: "12:00:00.000",
        timezone: "Africa/Johannesburg",
        source: "OWNER_MANUAL",
        createdByUserId: staffA.id,
        isManualCorrection: true,
        note: "historical pre-gps",
      },
    });
    const loaded = await prisma.eduClockEvent.findUnique({ where: { id: hist.id } });
    assert(loaded != null && loaded.latitude == null && loaded.validationVersion == null, "historical null GPS readable");

    const eventsAfter = await prisma.eduClockEvent.count({
      where: { schoolId: { in: createdSchoolIds } },
    });
    const attemptsAfter = await prisma.eduClockGpsAttempt.count({
      where: { schoolId: { in: createdSchoolIds } },
    });
    console.log(
      JSON.stringify(
        {
          disposableSchools: createdSchoolIds,
          eventsCreatedDuringTest: eventsAfter - eventsBefore,
          gpsAttemptsCreatedDuringTest: attemptsAfter - attemptsBefore,
        },
        null,
        2
      )
    );

    console.log("✓ EduClock Build 4 GPS validation tests passed");
  } finally {
    server.close();
    // Cleanup disposable schools (force-remove GPS rows then schools)
    await prisma.eduClockGpsAttempt.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockIdempotencyKey.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockOpenShift.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockException.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockEvent.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockEntrance.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockCampus.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    for (const id of createdSchoolIds) {
      await prisma.employee.deleteMany({ where: { schoolId: id } });
      await prisma.user.deleteMany({ where: { schoolId: id } });
      await prisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    const leftoverEvents = await prisma.eduClockEvent.count({
      where: { schoolId: { in: createdSchoolIds } },
    });
    const leftoverAttempts = await prisma.eduClockGpsAttempt.count({
      where: { schoolId: { in: createdSchoolIds } },
    });
    assert(leftoverEvents === 0 && leftoverAttempts === 0, "cleanup removed disposable GPS rows");
    console.log(JSON.stringify({ cleanupOk: true, leftoverEvents, leftoverAttempts }, null, 2));
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
