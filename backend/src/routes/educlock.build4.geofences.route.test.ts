/**
 * EduClock Build 4 Checkpoint 4 — Owner Geofences management tests.
 * MUST run only against educlear_educlock_dev.
 * Duplicate entrance names: case-insensitive uniqueness enforced in service;
 * DB @@unique([campusId, name]) remains case-sensitive (limitation documented).
 *
 * Run: DATABASE_URL=...educlear_educlock_dev npx tsc && node dist/routes/educlock.build4.geofences.route.test.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import fs from "fs";
import http from "http";
import jwt from "jsonwebtoken";
import path from "path";
import { PrismaClient } from "@prisma/client";

import educlockRoutes from "./educlock";

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
  } = {}
) {
  const res = await fetch(`${baseUrl}${pathName}`, {
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
  const u = new URL(DEV_URL);
  const host = u.hostname;
  const dbName = u.pathname.replace(/^\//, "");
  console.log(JSON.stringify({ resolvedHost: host, resolvedDatabase: dbName }, null, 2));
  if ((host !== "localhost" && host !== "127.0.0.1") || dbName !== "educlear_educlock_dev") {
    throw new Error("ABORT: Build 4 geofence tests must target localhost/educlear_educlock_dev only");
  }

  const stamp = Date.now();
  const BASE_LAT = -26.2041;
  const BASE_LNG = 28.0473;
  const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";

  const daSilvaEntranceBefore = await prisma.eduClockEntrance.count({
    where: { schoolId: DA_SILVA },
  });

  const schoolA = await prisma.school.create({ data: { name: `EduClock B4G A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `EduClock B4G B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-b4g-a-${stamp}@example.com`,
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
      email: `teacher-b4g-a-${stamp}@example.com`,
      fullName: "Teacher A",
      passwordHash,
      role: "SCHOOL_ADMIN",
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
      email: `owner-b4g-b-${stamp}@example.com`,
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

  const staffEmp = await prisma.employee.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Hist",
      lastName: "Link",
      fullName: "Hist Link",
      employeeNumber: `B4G${stamp % 100000}`.padStart(5, "0"),
      isActive: true,
    },
  });

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
    role: "SCHOOL_ADMIN",
  });
  const ownerBToken = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  const app = express();
  app.use(express.json());
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Seed campus A1 for list/create flow
    const campusCreate = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerToken,
      body: { name: `Campus One ${stamp}`, description: "Disposable", toleranceMetres: 4 },
    });
    assert(campusCreate.status === 201, `Campus create 201, got ${campusCreate.status}`);
    const campusId = String(campusCreate.json.id);

    const campus2 = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerToken,
      body: { name: `Campus Two ${stamp}`, toleranceMetres: 4 },
    });
    assert(campus2.status === 201, `Campus 2 create 201, got ${campus2.status}`);
    const campus2Id = String(campus2.json.id);

    // School B campus for cross-school attempts
    const campusB = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerBToken,
      body: { name: `Campus B ${stamp}`, toleranceMetres: 4 },
    });
    assert(campusB.status === 201, `Campus B create 201, got ${campusB.status}`);
    const campusBId = String(campusB.json.id);

    // 1 — Owner lists own campuses/entrances
    const list1 = await apiCall(baseUrl, "/api/educlock/owner/campuses", { token: ownerToken });
    assert(list1.status === 200, `List campuses 200, got ${list1.status}`);
    assert(list1.json.schoolId === schoolA.id, "List schoolId must be session school");
    assert(Array.isArray(list1.json.campuses), "campuses array required");
    assert(list1.json.summary && typeof list1.json.summary.totalCampuses === "number", "summary required");
    assert(
      (list1.json.campuses as Array<{ id: string }>).some((c) => c.id === campusId),
      "Owner must see own campus"
    );

    // 2 — Non-owner cannot list management data
    const teacherList = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      token: teacherToken,
    });
    assert(teacherList.status === 403, `Teacher list expected 403, got ${teacherList.status}`);

    // 3 — Owner creates valid entrance (coords + defaults)
    const createValid = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${campusId}/entrances`,
      {
        method: "POST",
        token: ownerToken,
        body: {
          name: "Main Gate",
          description: "Front",
          latitude: BASE_LAT,
          longitude: BASE_LNG,
        },
      }
    );
    assert(createValid.status === 201, `Create valid entrance 201, got ${createValid.status}`);
    assert(createValid.json.schoolId === schoolA.id, "Entrance school scoped");
    assert(createValid.json.campusId === campusId, "Entrance campus linked");
    // 4 — Default radius is 5
    assert(createValid.json.allowedRadiusMetres === 5, `Default radius 5, got ${createValid.json.allowedRadiusMetres}`);
    // 25 — Valid active entrance reports ready
    assert(createValid.json.gpsReady === true, "Valid entrance must be gpsReady");
    assert(createValid.json.gpsReadinessCode === "READY", "Readiness code READY");
    const entranceId = String(createValid.json.id);

    // 5 — Radius 1 accepted
    const r1 = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: {
        name: "Radius One",
        latitude: BASE_LAT,
        longitude: BASE_LNG,
        allowedRadiusMetres: 1,
      },
    });
    assert(r1.status === 201, `Radius 1 create 201, got ${r1.status}`);
    assert(r1.json.allowedRadiusMetres === 1, "Radius 1 stored");

    // 6 — Radius 25 accepted
    const r25 = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: {
        name: "Radius TwentyFive",
        latitude: BASE_LAT,
        longitude: BASE_LNG,
        allowedRadiusMetres: 25,
      },
    });
    assert(r25.status === 201, `Radius 25 create 201, got ${r25.status}`);
    assert(r25.json.allowedRadiusMetres === 25, "Radius 25 stored");

    // 7 — Radius 0 rejected
    const r0 = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "Bad Zero", latitude: BASE_LAT, longitude: BASE_LNG, allowedRadiusMetres: 0 },
    });
    assert(r0.status === 400, `Radius 0 expected 400, got ${r0.status}`);

    // 8 — Radius 26 rejected
    const r26 = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "Bad TwentySix", latitude: BASE_LAT, longitude: BASE_LNG, allowedRadiusMetres: 26 },
    });
    assert(r26.status === 400, `Radius 26 expected 400, got ${r26.status}`);

    // 9 — Invalid latitude rejected
    const badLat = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "Bad Lat", latitude: 91, longitude: BASE_LNG },
    });
    assert(badLat.status === 400, `Invalid lat expected 400, got ${badLat.status}`);

    // 10 — Invalid longitude rejected
    const badLng = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "Bad Lng", latitude: BASE_LAT, longitude: 181 },
    });
    assert(badLng.status === 400, `Invalid lng expected 400, got ${badLng.status}`);

    // 11 — Missing name rejected
    const missingName = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { latitude: BASE_LAT, longitude: BASE_LNG },
    });
    assert(missingName.status === 400, `Missing name expected 400, got ${missingName.status}`);

    // 12 — Empty trimmed name rejected
    const emptyName = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "   ", latitude: BASE_LAT, longitude: BASE_LNG },
    });
    assert(emptyName.status === 400, `Empty name expected 400, got ${emptyName.status}`);

    // 13 — Duplicate name same campus case-insensitive
    const dup = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "main gate", latitude: BASE_LAT, longitude: BASE_LNG },
    });
    assert(dup.status === 409, `Duplicate name expected 409, got ${dup.status}`);

    // 14 — Same name different campus accepted
    const crossCampus = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${campus2Id}/entrances`,
      {
        method: "POST",
        token: ownerToken,
        body: { name: "Main Gate", latitude: BASE_LAT, longitude: BASE_LNG },
      }
    );
    assert(crossCampus.status === 201, `Same name other campus 201, got ${crossCampus.status}`);

    // 15 — Owner edits coordinates
    const editCoords = await apiCall(baseUrl, `/api/educlock/owner/entrances/${entranceId}`, {
      method: "PATCH",
      token: ownerToken,
      body: { latitude: BASE_LAT + 0.001, longitude: BASE_LNG + 0.001 },
    });
    assert(editCoords.status === 200, `Edit coords 200, got ${editCoords.status}`);
    assert(Math.abs(editCoords.json.latitude - (BASE_LAT + 0.001)) < 1e-6, "Latitude updated");
    assert(Math.abs(editCoords.json.longitude - (BASE_LNG + 0.001)) < 1e-6, "Longitude updated");

    // 16 — Owner edits radius
    const editRadius = await apiCall(baseUrl, `/api/educlock/owner/entrances/${entranceId}`, {
      method: "PATCH",
      token: ownerToken,
      body: { allowedRadiusMetres: 12 },
    });
    assert(editRadius.status === 200, `Edit radius 200, got ${editRadius.status}`);
    assert(editRadius.json.allowedRadiusMetres === 12, "Radius updated to 12");

    // Historical event before deactivation (19)
    const histEvent = await prisma.eduClockEvent.create({
      data: {
        schoolId: schoolA.id,
        employeeId: staffEmp.id,
        employeeNumberSnapshot: staffEmp.employeeNumber || "00000",
        userId: ownerA.id,
        eventType: "CLOCK_IN",
        occurredAtUtc: new Date(),
        schoolLocalDate: "2026-07-24",
        schoolLocalTime: "08:00:00",
        timezone: "Africa/Johannesburg",
        source: "OWNER_MANUAL",
        createdByUserId: ownerA.id,
        matchedEntranceId: entranceId,
        distanceMetres: 2.5,
        validationVersion: "gps-entrance-v1",
      },
    });

    // 17 — Owner deactivates entrance
    const deactivate = await apiCall(baseUrl, `/api/educlock/owner/entrances/${entranceId}`, {
      method: "PATCH",
      token: ownerToken,
      body: { isActive: false },
    });
    assert(deactivate.status === 200, `Deactivate 200, got ${deactivate.status}`);
    assert(deactivate.json.isActive === false, "isActive false");
    assert(deactivate.json.gpsReady === false, "Deactivated not gpsReady");

    // 18 — Deactivated entrance remains in database
    const stillThere = await prisma.eduClockEntrance.findUnique({ where: { id: entranceId } });
    assert(Boolean(stillThere), "Entrance row must remain after deactivate");
    assert(stillThere!.isActive === false, "DB isActive false");

    // 19 — Historical event link remains valid after deactivation
    const linked = await prisma.eduClockEvent.findUnique({ where: { id: histEvent.id } });
    assert(linked?.matchedEntranceId === entranceId, "matchedEntranceId must remain after deactivate");

    // Still visible in owner list
    const listAfter = await apiCall(baseUrl, "/api/educlock/owner/campuses", { token: ownerToken });
    const campusRow = (listAfter.json.campuses as Array<{ id: string; entrances: Array<{ id: string }> }>).find(
      (c) => c.id === campusId
    );
    assert(
      Boolean(campusRow?.entrances.some((e) => e.id === entranceId)),
      "Deactivated entrance remains visible in list"
    );

    // 20 — School A owner cannot alter School B entrance
    const bEntrance = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusBId}/entrances`, {
      method: "POST",
      token: ownerBToken,
      body: { name: "B Gate", latitude: BASE_LAT, longitude: BASE_LNG },
    });
    assert(bEntrance.status === 201, `B entrance create 201, got ${bEntrance.status}`);
    const steal = await apiCall(baseUrl, `/api/educlock/owner/entrances/${bEntrance.json.id}`, {
      method: "PATCH",
      token: ownerToken,
      body: { name: "Stolen" },
    });
    assert(steal.status === 404 || steal.status === 403, `Cross-school patch blocked, got ${steal.status}`);

    // 21 — Client-supplied schoolId ignored / mismatch rejected
    const mismatch = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: {
        schoolId: schoolB.id,
        name: "Mismatch School",
        latitude: BASE_LAT,
        longitude: BASE_LNG,
      },
    });
    assert(
      mismatch.status === 403,
      `Client schoolId mismatch expected 403, got ${mismatch.status}`
    );

    // Matching client schoolId does not override — still creates under session school
    const matchBody = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: {
        schoolId: schoolA.id,
        name: "Session Wins",
        latitude: BASE_LAT,
        longitude: BASE_LNG,
      },
    });
    assert(matchBody.status === 201, `Matching schoolId body still creates, got ${matchBody.status}`);
    assert(matchBody.json.schoolId === schoolA.id, "Session school used");

    // 22 — Entrance linked only to campus in owner’s school
    const wrongCampus = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${campusBId}/entrances`,
      {
        method: "POST",
        token: ownerToken,
        body: { name: "Wrong Campus", latitude: BASE_LAT, longitude: BASE_LNG },
      }
    );
    assert(
      wrongCampus.status === 404 || wrongCampus.status === 403,
      `Foreign campus create blocked, got ${wrongCampus.status}`
    );

    // 24 — Null coordinate entrance reports not ready
    const noCoords = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campusId}/entrances`, {
      method: "POST",
      token: ownerToken,
      body: { name: "No Coords Yet" },
    });
    assert(noCoords.status === 201, `Null coords create 201, got ${noCoords.status}`);
    assert(noCoords.json.latitude == null && noCoords.json.longitude == null, "Coords stay null");
    assert(noCoords.json.allowedRadiusMetres === 5, "Default radius even without coords");
    assert(noCoords.json.gpsReady === false, "Null coords not ready");
    assert(
      (noCoords.json.gpsReadinessReasons as string[]).some((r) => /coordinates/i.test(r)),
      "Missing coordinates reason"
    );

    // 23 — Inactive campus entrance reports not ready
    const inactiveCampusCreate = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerToken,
      body: { name: `Inactive Camp ${stamp}`, toleranceMetres: 4 },
    });
    const inactiveCampusId = String(inactiveCampusCreate.json.id);
    const onInactive = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${inactiveCampusId}/entrances`,
      {
        method: "POST",
        token: ownerToken,
        body: {
          name: "On Inactive",
          latitude: BASE_LAT,
          longitude: BASE_LNG,
          allowedRadiusMetres: 5,
        },
      }
    );
    assert(onInactive.status === 201, `Entrance on soon-inactive campus 201, got ${onInactive.status}`);
    const deactCampus = await apiCall(baseUrl, `/api/educlock/owner/campuses/${inactiveCampusId}`, {
      method: "PATCH",
      token: ownerToken,
      body: { isActive: false },
    });
    assert(deactCampus.status === 200, `Deactivate campus 200, got ${deactCampus.status}`);
    const listInactive = await apiCall(baseUrl, "/api/educlock/owner/campuses", { token: ownerToken });
    const inactiveCampusRow = (
      listInactive.json.campuses as Array<{
        id: string;
        isActive: boolean;
        entrances: Array<{ id: string; gpsReady: boolean; gpsReadinessReasons: string[] }>;
      }>
    ).find((c) => c.id === inactiveCampusId);
    assert(inactiveCampusRow?.isActive === false, "Campus inactive");
    const inactiveEntrance = inactiveCampusRow?.entrances.find((e) => e.id === onInactive.json.id);
    assert(inactiveEntrance?.gpsReady === false, "Entrance on inactive campus not ready");
    assert(
      Boolean(inactiveEntrance?.gpsReadinessReasons.some((r) => /Inactive campus/i.test(r))),
      "Inactive campus reason"
    );

    // Summary sanity
    assert(listInactive.json.summary.totalEntrances >= 1, "summary totalEntrances");
    assert(
      listInactive.json.summary.notReadyEntrances ===
        listInactive.json.summary.totalEntrances - listInactive.json.summary.gpsReadyEntrances,
      "summary ready/not-ready math"
    );

    const daSilvaEntranceAfter = await prisma.eduClockEntrance.count({
      where: { schoolId: DA_SILVA },
    });
    assert(
      daSilvaEntranceAfter === daSilvaEntranceBefore,
      "Da Silva entrances must be unchanged by disposable tests"
    );

    console.log(
      JSON.stringify(
        {
          pass: true,
          cases: "1-25",
          leftoverCleanupNext: true,
          daSilvaEntrancesUnchanged: true,
        },
        null,
        2
      )
    );
    console.log("EDUCLOCK BUILD 4 GEOFENCES ROUTE TESTS PASS");
  } finally {
    server.close();
    await prisma.eduClockEvent.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockGpsAttempt.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockEntrance.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockCampus.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.eduClockActivationAudit.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.employee.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: { userId: { in: [ownerA.id, teacherA.id, ownerB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerA.id, teacherA.id, ownerB.id] } },
    });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });

    const leftoverEntrances = await prisma.eduClockEntrance.count({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    const leftoverCampuses = await prisma.eduClockCampus.count({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    console.log(
      JSON.stringify(
        { leftoverEntrances, leftoverCampuses, cleanupOk: leftoverEntrances === 0 && leftoverCampuses === 0 },
        null,
        2
      )
    );
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return prisma.$disconnect();
});
