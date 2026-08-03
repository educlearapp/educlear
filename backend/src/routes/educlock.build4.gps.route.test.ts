/**
 * EduClock GPS validation — campus boundary polygon (gps-boundary-v1).
 * CLOCK_IN and CLOCK_OUT accept any point inside an active campus boundary.
 * Entrance proximity must not determine accept/reject.
 * MUST run only against educlear_educlock_dev.
 * Run:
 *   set -a && source .env.educlock_dev && set +a
 *   npx tsc
 *   npx esbuild src/routes/educlock.build4.gps.route.test.ts --bundle --platform=node --format=cjs --outfile=dist/routes/educlock.build4.gps.route.test.js --packages=external
 *   node dist/routes/educlock.build4.gps.route.test.js
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
import { isPointInsidePolygon } from "../services/geofenceGeometry";

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

/** ~200 m square centred on (lat,lng). */
function squareRingAround(lat: number, lng: number, halfSideMetres = 100) {
  const sw = offsetMetres(lat, lng, -halfSideMetres, -halfSideMetres);
  const se = offsetMetres(lat, lng, -halfSideMetres, halfSideMetres);
  const ne = offsetMetres(lat, lng, halfSideMetres, halfSideMetres);
  const nw = offsetMetres(lat, lng, halfSideMetres, -halfSideMetres);
  return [sw, se, ne, nw];
}

async function createActiveBoundary(input: {
  schoolId: string;
  campusId: string;
  name: string;
  ring: Array<{ latitude: number; longitude: number }>;
}) {
  const zone = await prisma.geofenceZone.create({
    data: {
      schoolId: input.schoolId,
      campusId: input.campusId,
      name: input.name,
      type: "CAMPUS_BOUNDARY",
      active: true,
      geometryKind: "POLYGON",
      vertices: {
        create: input.ring.map((p, sequence) => ({
          schoolId: input.schoolId,
          sequence,
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      },
    },
  });
  await prisma.eduClockCampus.update({
    where: { id: input.campusId },
    data: { perimeterStatus: "DRAWN" },
  });
  return zone;
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
  const RING = squareRingAround(BASE_LAT, BASE_LNG, 100);

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
  // Entrances exist for isolation / ignore checks — must NOT gate acceptance.
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
  await prisma.eduClockEntrance.create({
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

  const zoneA = await createActiveBoundary({
    schoolId: schoolA.id,
    campusId: campusA.id,
    name: `Boundary A ${stamp}`,
    ring: RING,
  });

  // School B boundary + entrance near same coords — must never authorize School A staff
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
  await createActiveBoundary({
    schoolId: schoolB.id,
    campusId: campusB.id,
    name: `Boundary B ${stamp}`,
    ring: RING,
  });

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

  const createdSchoolIds = [schoolA.id, schoolB.id];
  const eventsBefore = await prisma.eduClockEvent.count({
    where: { schoolId: { in: createdSchoolIds } },
  });
  const attemptsBefore = await prisma.eduClockGpsAttempt.count({
    where: { schoolId: { in: createdSchoolIds } },
  });

  try {
    assert(
      haversineDistanceMetres(
        { latitude: BASE_LAT, longitude: BASE_LNG },
        { latitude: BASE_LAT, longitude: BASE_LNG }
      ) === 0,
      "identical 0"
    );
    assert(
      isPointInsidePolygon({ latitude: BASE_LAT, longitude: BASE_LNG }, RING),
      "fixture centre inside ring"
    );

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

    // Valid clock-in inside polygon (near entrance — still must not set matchedEntranceId)
    const beforeIn = new Date();
    const clockIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-in-${stamp}` },
    });
    assert(clockIn.status === 201, `inside clock-in 201, got ${clockIn.status}: ${JSON.stringify(clockIn.json)}`);
    assert(clockIn.json.event.matchedEntranceId == null, "entrance must not determine match");
    assert(clockIn.json.event.matchedEntranceId !== entranceB.id, "never school B entrance");
    assert(clockIn.json.event.validationVersion === EDUCLOCK_GPS_VALIDATION_VERSION, "validation version");
    assert(clockIn.json.event.validationVersion === "gps-boundary-v1", "gps-boundary-v1");
    assert(clockIn.json.event.latitude === BASE_LAT, "lat stored");
    assert(clockIn.json.event.distanceMetres == null, "entrance distance not stored");
    assert(new Date(clockIn.json.event.occurredAtUtc).getTime() >= beforeIn.getTime() - 2000, "server time");
    assert(clockIn.json.event.occurredAtUtc !== "2099-01-01T00:00:00.000Z", "client time ignored");
    const storedIn = await prisma.eduClockEvent.findUnique({ where: { id: clockIn.json.event.id } });
    assert(storedIn?.matchedEntranceId == null, "DB matchedEntranceId null");
    assert(storedIn?.validationVersion === "gps-boundary-v1", "DB validation version");
    const storedMeta = JSON.stringify(storedIn?.metadata || {});
    assert(storedMeta.includes(zoneA.id), "matchedZoneId persisted in event metadata");
    void entranceNear;

    // Idempotency
    const replay = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-in-${stamp}` },
    });
    assert(replay.json.event.id === clockIn.json.event.id, "idempotent accepted replay");

    // Duplicate clock-in
    const dup = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-dup-${stamp}` },
    });
    assert(dup.status === 409, `dup clock-in 409, got ${dup.status}`);

    // Clock-out inside polygon
    const clockOut = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: { ...gpsInside, accuracyMetres: 20 },
      headers: { "Idempotency-Key": `b4-out-${stamp}` },
    });
    assert(clockOut.status === 200, `clock-out 200, got ${clockOut.status}`);
    assert(clockOut.json.event.accuracyMetres === 20, "accuracy 20 accepted");
    assert(clockOut.json.event.matchedEntranceId == null, "clock-out no entrance match");
    assert(clockOut.json.event.validationVersion === "gps-boundary-v1", "clock-out boundary version");

    // Clock-out without open shift
    const noOpen = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: gpsInside,
      headers: { "Idempotency-Key": `b4-noopen-${stamp}` },
    });
    assert(noOpen.status === 409, `no open shift 409, got ${noOpen.status}`);

    // Inside polygon but far from every entrance (~70 m from centre entrance; radius 5)
    const farInside = offsetMetres(BASE_LAT, BASE_LNG, 70, 0);
    assert(isPointInsidePolygon(farInside, RING), "farInside must be in polygon");
    const dFar = haversineDistanceMetres(
      { latitude: BASE_LAT, longitude: BASE_LNG },
      farInside
    );
    assert(dFar > 25, `farInside must be beyond entrance radius, got ${dFar}`);
    const farIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { ...farInside, accuracyMetres: 8 },
    });
    assert(
      farIn.status === 201,
      `far-from-entrance inside polygon accepted, got ${farIn.status}: ${JSON.stringify(farIn.json)}`
    );
    assert(farIn.json.event.matchedEntranceId == null, "far-inside no entrance id");
    await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: { ...farInside, accuracyMetres: 8 },
    });

    // Near polygon edge (inside, ~2 m from northern edge of 100 m half-side)
    const nearEdge = offsetMetres(BASE_LAT, BASE_LNG, 98, 0);
    assert(isPointInsidePolygon(nearEdge, RING), "nearEdge inside");
    const edgeIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { ...nearEdge, accuracyMetres: 5 },
    });
    assert(
      edgeIn.status === 201,
      `near-edge accepted, got ${edgeIn.status}: ${JSON.stringify(edgeIn.json)}`
    );
    await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: { ...nearEdge, accuracyMetres: 5 },
    });

    // Raw outside by ~4 m (half-side 100 → 104 m north) with accuracy ≤ 20 → edge tolerance accept
    const justOutside = offsetMetres(BASE_LAT, BASE_LNG, 104, 0);
    assert(!isPointInsidePolygon(justOutside, RING), "justOutside must be outside raw polygon");
    const edgeTolIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { ...justOutside, accuracyMetres: 15 },
    });
    assert(
      edgeTolIn.status === 201,
      `edge-tolerance accept, got ${edgeTolIn.status}: ${JSON.stringify(edgeTolIn.json)}`
    );
    assert(edgeTolIn.json.event.validationVersion === "gps-boundary-v1-edge10", "edge10 version");
    assert(edgeTolIn.json.event.matchedEntranceId == null, "edge tol no entrance");
    const edgeTolStored = await prisma.eduClockEvent.findUnique({
      where: { id: edgeTolIn.json.event.id },
    });
    const edgeMeta = JSON.stringify(edgeTolStored?.metadata || {});
    assert(edgeMeta.includes("edgeToleranceUsed"), "edge tolerance metadata");
    assert(edgeMeta.includes('"rawInsidePolygon":false') || edgeMeta.includes('"rawInsidePolygon": false'), "raw outside recorded");
    await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      body: { ...justOutside, accuracyMetres: 15 },
    });

    // Outside by more than 10 m from edge (half-side 100 → 115 m)
    const outside = offsetMetres(BASE_LAT, BASE_LNG, 115, 0);
    assert(!isPointInsidePolygon(outside, RING), "outside fixture");
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
      (await prisma.eduClockEvent.count({
        where: { schoolId: schoolA.id, employeeId: empA.id, eventType: "CLOCK_IN" },
      })) === 4,
      "outside created no extra event beyond prior 4 clock-ins"
    );

    // Accuracy > 20
    const accHigh = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 20.01 },
      headers: { "Idempotency-Key": `b4-acc-${stamp}` },
    });
    assert(accHigh.status === 400 && accHigh.json.code === "GPS_ACCURACY_TOO_LOW", "accuracy too low");
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

    // Missing/invalid/denied/unavailable/timeout
    const cases: Array<{ body: Record<string, unknown>; code: string }> = [
      { body: { accuracyMetres: 5 }, code: "GPS_COORDINATES_MISSING" },
      { body: { latitude: 999, longitude: BASE_LNG, accuracyMetres: 5 }, code: "GPS_COORDINATES_INVALID" },
      { body: { latitude: BASE_LAT, longitude: 999, accuracyMetres: 5 }, code: "GPS_COORDINATES_INVALID" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG }, code: "GPS_ACCURACY_MISSING" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: -1 }, code: "GPS_ACCURACY_INVALID" },
      { body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: "not-a-number" }, code: "GPS_ACCURACY_INVALID" },
      {
        body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5, permissionState: "denied" },
        code: "GPS_PERMISSION_DENIED",
      },
      {
        body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5, locationError: "UNAVAILABLE" },
        code: "GPS_UNAVAILABLE",
      },
      {
        body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5, locationError: "TIMEOUT" },
        code: "GPS_TIMEOUT",
      },
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

    // No active boundary
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
    const noBoundary = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: emptyToken,
      body: { latitude: BASE_LAT, longitude: BASE_LNG, accuracyMetres: 5 },
    });
    assert(
      noBoundary.status === 400 && noBoundary.json.code === "NO_ACTIVE_BOUNDARY",
      `no active boundary, got ${noBoundary.json?.code}`
    );

    // Metadata safety
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

    // Historical non-GPS event readable (preserve audit)
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

    // Existing open shifts untouched by GPS rule change — create one and ensure still present
    const openShiftCount = await prisma.eduClockOpenShift.count({
      where: { schoolId: schoolA.id },
    });
    assert(openShiftCount === 0, "no leftover open shifts after paired in/out");

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

    console.log("✓ EduClock GPS boundary validation tests passed");
  } finally {
    server.close();
    await prisma.eduClockGpsAttempt.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockIdempotencyKey.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockOpenShift.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockException.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.eduClockEvent.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.geofenceVertex.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
    await prisma.geofenceZone.deleteMany({ where: { schoolId: { in: createdSchoolIds } } });
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
