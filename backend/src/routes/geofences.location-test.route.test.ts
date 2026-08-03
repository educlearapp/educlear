/**
 * Phase 2C — Owner Location Test Mode route tests (educlear_educlock_dev only).
 * Run:
 *   set -a && source .env.educlock_dev && set +a
 *   npx esbuild src/routes/geofences.location-test.route.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/gf-loc-route.cjs --external:bcryptjs --external:@prisma/client --external:express --external:jsonwebtoken
 *   node /tmp/gf-loc-route.cjs
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import geofencesRoutes from "./geofences";
import { isGeofencePolygonValidationEnabled } from "../services/geofencePolygonValidationFlag";

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
  options: { method?: string; body?: Record<string, unknown>; token?: string } = {}
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
  const dbUrl = process.env.DATABASE_URL || "";
  assert(dbUrl.includes("educlear_educlock_dev"), `Refuse: need educlear_educlock_dev, got ${dbUrl}`);
  assert(isGeofencePolygonValidationEnabled() === false, "polygon validation must stay OFF");

  const stamp = Date.now();
  const schoolA = await prisma.school.create({ data: { name: `LocTest A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `LocTest B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-loc-${stamp}@example.com`,
      fullName: "Owner Loc",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Owner",
          surname: "Loc",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
  const staffA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `staff-loc-${stamp}@example.com`,
      fullName: "Staff Loc",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Staff",
          surname: "Loc",
          appRole: "Teacher",
          permissions: { dashboard: { view: true } },
        },
      },
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `owner-loc-b-${stamp}@example.com`,
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

  const campusA = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolA.id,
      name: "Main Campus",
      timezone: "Africa/Johannesburg",
      isActive: true,
      toleranceMetres: 4,
      perimeterStatus: "DRAWN",
    },
  });
  const campusB = await prisma.eduClockCampus.create({
    data: {
      schoolId: schoolB.id,
      name: "Other School Campus",
      timezone: "Africa/Johannesburg",
      isActive: true,
      toleranceMetres: 4,
      perimeterStatus: "NOT_DRAWN",
    },
  });

  const BASE_LAT = -26.2041;
  const BASE_LNG = 28.0473;

  const mainGate = await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "Main Gate",
      isActive: true,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      allowedRadiusMetres: 10,
    },
  });
  await prisma.eduClockEntrance.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "Inactive Gate",
      isActive: false,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      allowedRadiusMetres: 10,
    },
  });

  // Small square around Main Gate
  const zone = await prisma.geofenceZone.create({
    data: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      name: "Campus Boundary",
      type: "CAMPUS_BOUNDARY",
      active: true,
      geometryKind: "POLYGON",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [BASE_LNG - 0.001, BASE_LAT - 0.001],
            [BASE_LNG + 0.001, BASE_LAT - 0.001],
            [BASE_LNG + 0.001, BASE_LAT + 0.001],
            [BASE_LNG - 0.001, BASE_LAT + 0.001],
            [BASE_LNG - 0.001, BASE_LAT - 0.001],
          ],
        ],
      },
      vertices: {
        create: [
          { schoolId: schoolA.id, sequence: 0, latitude: BASE_LAT - 0.001, longitude: BASE_LNG - 0.001 },
          { schoolId: schoolA.id, sequence: 1, latitude: BASE_LAT - 0.001, longitude: BASE_LNG + 0.001 },
          { schoolId: schoolA.id, sequence: 2, latitude: BASE_LAT + 0.001, longitude: BASE_LNG + 0.001 },
          { schoolId: schoolA.id, sequence: 3, latitude: BASE_LAT + 0.001, longitude: BASE_LNG - 0.001 },
        ],
      },
    },
  });
  assert(Boolean(zone.id), "boundary zone created");

  const app = express();
  app.use(express.json());
  app.use("/api/geofences", geofencesRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert(addr && typeof addr === "object", "server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const ownerToken = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const staffToken = signToken({
    userId: staffA.id,
    schoolId: schoolA.id,
    email: staffA.email,
    role: "STAFF",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  const eventsBefore = await prisma.eduClockEvent.count({ where: { schoolId: schoolA.id } });
  const attemptsBefore = await prisma.eduClockGpsAttempt.count({ where: { schoolId: schoolA.id } });

  // Owner can test own school campus
  const ok = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerToken,
    body: {
      campusId: campusA.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(ok.status === 200, `owner test 200, got ${ok.status} ${JSON.stringify(ok.json)}`);
  assert(ok.json.currentEntranceRuleWouldAccept === true, "Would be accepted");
  assert(ok.json.nearestEntranceName === "Main Gate", "nearest Main Gate");
  assert(ok.json.polygonRuleEnabled === true, "polygon rule enabled for current clock");
  assert(ok.json.simulatedOverallResult.polygonEnforcement === "ENABLED", "enforcement ENABLED");
  assert(ok.json.recordsCreated.eduClockEvent === 0, "zero events");
  assert(ok.json.recordsCreated.eduClockGpsAttempt === 0, "zero gps attempts");
  assert(ok.json.simulationOnly === true, "simulation only");

  // Staff 403
  const staff = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: staffToken,
    body: {
      campusId: campusA.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(staff.status === 403, `staff 403, got ${staff.status}`);

  // Tenant isolation — owner B cannot test campus A
  const cross = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerBToken,
    body: {
      campusId: campusA.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(cross.status === 404, `cross-tenant campus 404, got ${cross.status}`);

  // No client schoolId trust — mismatched schoolId rejected
  const spoof = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerToken,
    body: {
      schoolId: schoolB.id,
      campusId: campusA.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(spoof.status === 403, `spoof schoolId 403, got ${spoof.status}`);

  // Matching schoolId still uses session school (ok)
  const matchSchool = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerToken,
    body: {
      schoolId: schoolA.id,
      campusId: campusA.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(matchSchool.status === 200, "matching schoolId still ok");

  // Outside campus boundary (still near gate would have passed entrance-radius)
  const reject = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerToken,
    body: {
      campusId: campusA.id,
      latitude: BASE_LAT + 0.002,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(reject.status === 200, "reject simulation still 200");
  assert(reject.json.currentEntranceRuleWouldAccept === false, "Would be rejected");
  assert(reject.json.rejectionCode === "OUTSIDE_GEOFENCE", "outside boundary code");
  assert(reject.json.isInsideCampusBoundary === false, "outside polygon");

  // Accuracy fail
  const acc = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerToken,
    body: {
      campusId: campusA.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 25,
    },
  });
  assert(acc.json.currentEntranceRuleWouldAccept === false, "accuracy reject");
  assert(acc.json.rejectionCode === "GPS_ACCURACY_TOO_LOW", "accuracy code");

  // Owner B campus with no entrances
  const empty = await apiCall(baseUrl, "/api/geofences/test-location", {
    method: "POST",
    token: ownerBToken,
    body: {
      campusId: campusB.id,
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracyMetres: 5,
    },
  });
  assert(empty.status === 200, "empty campus 200");
  assert(empty.json.rejectionCode === "NO_ACTIVE_BOUNDARY", "no boundary state");
  assert(empty.json.campusBoundaryAvailable === false, "no boundary");

  const eventsAfter = await prisma.eduClockEvent.count({ where: { schoolId: schoolA.id } });
  const attemptsAfter = await prisma.eduClockGpsAttempt.count({ where: { schoolId: schoolA.id } });
  assert(eventsAfter === eventsBefore, "zero EduClockEvent created");
  assert(attemptsAfter === attemptsBefore, "zero EduClockGpsAttempt created");
  assert(mainGate.id === ok.json.nearestActiveEntranceId, "nearest id matches Main Gate");

  server.close();
  await prisma.$disconnect();
  console.log("geofences.location-test.route.test.ts PASS");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
