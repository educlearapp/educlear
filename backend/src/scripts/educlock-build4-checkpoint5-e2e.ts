/**
 * EduClock Build 4 Checkpoint 5 — integrated API E2E on educlear_educlock_dev only.
 * Spins an ephemeral auth+educlock+subscriptions server (does NOT use protected :3000 / educlear).
 *
 * Run (after tsc/esbuild):
 *   node dist/scripts/educlock-build4-checkpoint5-e2e.js
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { PrismaClient } from "@prisma/client";

import authRoutes from "../routes/auth";
import educlockRoutes from "../routes/educlock";
import subscriptionsRoutes from "../routes/subscriptions";

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
const PASSWORD = "TestPass123!";
const VALID_SA_ID = "9001015800088";
const BASE_LAT = -26.2041;
const BASE_LNG = 28.0473;
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function offsetMetres(lat: number, lng: number, northM: number, eastM = 0) {
  const R = 6_371_000;
  const dLat = (northM * (180 / Math.PI)) / R;
  const dLng = (eastM * (180 / Math.PI)) / (R * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + dLat, longitude: lng + dLng };
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

function financeShaSnapshot(): { ok: boolean; files: Record<string, boolean> } {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../storage/live-to-local-baseline-2026-07-24/baseline-checkpoint.json"),
      "utf8"
    )
  );
  const files: Record<string, boolean> = {};
  let ok = true;
  for (const [name, meta] of Object.entries(baseline.restoredFinanceFiles as Record<string, any>)) {
    const buf = fs.readFileSync(path.join(__dirname, "../../data", name));
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    files[name] = sha === meta.sha256 && buf.length === meta.bytes;
    if (!files[name]) ok = false;
  }
  return { ok, files };
}

async function main() {
  const u = new URL(DEV_URL);
  const host = u.hostname;
  const dbName = u.pathname.replace(/^\//, "");
  console.log(
    JSON.stringify(
      {
        safetyGate: { resolvedHost: host, resolvedDatabase: dbName },
        note: "Ephemeral C5 server — not the protected :3000/educlear process",
      },
      null,
      2
    )
  );
  if ((host !== "localhost" && host !== "127.0.0.1") || dbName !== "educlear_educlock_dev") {
    throw new Error("ABORT: C5 must target localhost/educlear_educlock_dev only");
  }

  const financeBefore = financeShaSnapshot();
  assert(financeBefore.ok, "Finance SHA256 mismatch BEFORE testing — abort");

  const daBefore = {
    events: await prisma.eduClockEvent.count({ where: { schoolId: DA_SILVA } }),
    attempts: await prisma.eduClockGpsAttempt.count({ where: { schoolId: DA_SILVA } }),
    entrances: await prisma.eduClockEntrance.count({ where: { schoolId: DA_SILVA } }),
  };

  const stamp = Date.now();
  const disposableIds: Record<string, string> = {};
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const school = await prisma.school.create({
    data: { name: `EduClock B4C5 Disposable ${stamp}` },
  });
  disposableIds.schoolId = school.id;

  const starterPkg = await prisma.eduClearPackage.findFirst({
    where: { code: "STARTER", isActive: true },
  });
  assert(Boolean(starterPkg), "STARTER package required on educlear_educlock_dev");
  const sub = await prisma.schoolSubscription.create({
    data: {
      schoolId: school.id,
      packageId: starterPkg!.id,
      packageCode: "STARTER",
      status: "ACTIVE",
      activationSource: "educlock_b4_c5",
      activatedAt: new Date(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 864e5),
    },
  });
  disposableIds.subscriptionId = sub.id;

  const owner = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `owner-b4c5-${stamp}@example.com`,
      fullName: "Owner C5",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: school.id,
          firstName: "Owner",
          surname: "C5",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
  disposableIds.ownerUserId = owner.id;

  const staff = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `staff-b4c5-${stamp}@example.com`,
      fullName: "Staff C5",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: school.id,
          firstName: "Staff",
          surname: "C5",
          appRole: "Teacher",
          permissions: {},
        },
      },
    },
  });
  disposableIds.staffUserId = staff.id;

  const emp = await prisma.employee.create({
    data: {
      schoolId: school.id,
      firstName: "Staff",
      lastName: "C5",
      fullName: "Staff C5",
      employeeNumber: `C5${String(stamp).slice(-5)}`,
      identityType: "SA_ID",
      idNumber: VALID_SA_ID,
      isActive: true,
    },
  });
  disposableIds.employeeId = emp.id;

  const app = express();
  app.use((req, res, next) => {
    const origin = String(req.headers.origin || "");
    if (
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("http://localhost:")
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key, X-Requested-With"
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use("/auth", authRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/educlock", educlockRoutes);
  app.use("/api/subscriptions", subscriptionsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  disposableIds.apiBaseUrl = baseUrl;

  const evidence: Record<string, unknown> = {
    disposableIds,
    rejectionScenarios: [] as Array<Record<string, unknown>>,
  };

  try {
    // Owner login
    const ownerLogin = await apiCall(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: owner.email, password: PASSWORD },
    });
    assert(ownerLogin.status === 200, `Owner login ${ownerLogin.status}`);
    const ownerToken = String(ownerLogin.json.token);
    assert(ownerLogin.json.school?.id === school.id, "Owner school from session");

    // 1–2 Owner configures entrance → GPS READY
    const campus = await apiCall(baseUrl, "/api/educlock/owner/campuses", {
      method: "POST",
      token: ownerToken,
      body: { name: `C5 Campus ${stamp}`, description: "Disposable", toleranceMetres: 4 },
    });
    assert(campus.status === 201, `Campus create ${campus.status}`);
    disposableIds.campusId = String(campus.json.id);

    const entrance = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${campus.json.id}/entrances`,
      {
        method: "POST",
        token: ownerToken,
        body: {
          name: "Main Gate",
          latitude: BASE_LAT,
          longitude: BASE_LNG,
        },
      }
    );
    assert(entrance.status === 201, `Entrance create ${entrance.status}`);
    assert(entrance.json.allowedRadiusMetres === 5, "Default radius 5");
    assert(entrance.json.gpsReady === true, "Entrance GPS READY");
    disposableIds.entranceId = String(entrance.json.id);

    // 3 Staff login + activate
    const staffLogin = await apiCall(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: staff.email, password: PASSWORD },
    });
    assert(staffLogin.status === 200, `Staff login ${staffLogin.status}`);
    const staffToken = String(staffLogin.json.token);

    const activate = await apiCall(baseUrl, "/api/educlock/activate", {
      method: "POST",
      token: staffToken,
      body: { identityType: "SA_ID", identityNumber: VALID_SA_ID },
    });
    assert(activate.status === 200, `Activate ${activate.status}`);
    assert(activate.json.employeeId === emp.id, "Linked employee");

    const inside = offsetMetres(BASE_LAT, BASE_LNG, 2, 1);
    const clockInKey = `c5-in-${stamp}`;
    const clockIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      headers: { "Idempotency-Key": clockInKey },
      body: {
        latitude: inside.latitude,
        longitude: inside.longitude,
        accuracyMetres: 4,
        capturedAtClient: new Date().toISOString(),
        permissionState: "granted",
      },
    });
    assert(clockIn.status === 201, `Clock-in ${clockIn.status} ${JSON.stringify(clockIn.json)}`);
    assert(clockIn.json.event?.matchedEntranceId === entrance.json.id, "matchedEntranceId");
    assert(clockIn.json.event?.validationVersion === "gps-entrance-v1", "validationVersion");
    assert(clockIn.json.event?.matchedEntranceName === "Main Gate", "matchedEntranceName");
    disposableIds.clockInEventId = String(clockIn.json.event.id);
    evidence.acceptedClockIn = clockIn.json.event;

    // 6 Duplicate clock-in blocked
    const dupIn = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
      method: "POST",
      token: staffToken,
      headers: { "Idempotency-Key": `c5-in-dup-${stamp}` },
      body: {
        latitude: inside.latitude,
        longitude: inside.longitude,
        accuracyMetres: 4,
        capturedAtClient: new Date().toISOString(),
        permissionState: "granted",
      },
    });
    assert(dupIn.status === 409, `Duplicate clock-in expected 409, got ${dupIn.status}`);

    // 7 Clock out inside radius
    const clockOutKey = `c5-out-${stamp}`;
    const clockOut = await apiCall(baseUrl, "/api/educlock/me/clock-out", {
      method: "POST",
      token: staffToken,
      headers: { "Idempotency-Key": clockOutKey },
      body: {
        latitude: inside.latitude,
        longitude: inside.longitude,
        accuracyMetres: 5,
        capturedAtClient: new Date().toISOString(),
        permissionState: "granted",
      },
    });
    assert(clockOut.status === 200 || clockOut.status === 201, `Clock-out ${clockOut.status}`);
    assert(clockOut.json.event?.eventType === "CLOCK_OUT", "CLOCK_OUT");
    disposableIds.clockOutEventId = String(clockOut.json.event.id);
    evidence.acceptedClockOut = clockOut.json.event;

    // 8 Attendance board
    const attendance = await apiCall(baseUrl, "/api/educlock/owner/attendance", {
      token: ownerToken,
    });
    assert(attendance.status === 200, `Attendance ${attendance.status}`);
    evidence.attendanceSample = {
      status: attendance.status,
      rowCount: Array.isArray(attendance.json?.rows)
        ? attendance.json.rows.length
        : Array.isArray(attendance.json?.shifts)
          ? attendance.json.shifts.length
          : Array.isArray(attendance.json)
            ? attendance.json.length
            : Object.keys(attendance.json || {}).length,
      hasClockData: JSON.stringify(attendance.json).includes(String(emp.employeeNumber)),
    };

    // Rejection helpers
    async function expectReject(label: string, body: Record<string, unknown>, expectedCode: string) {
      const beforeEvents = await prisma.eduClockEvent.count({ where: { schoolId: school.id } });
      const beforeAttempts = await prisma.eduClockGpsAttempt.count({
        where: { schoolId: school.id },
      });
      const key = `c5-rej-${label}-${stamp}`;
      const res1 = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
        method: "POST",
        token: staffToken,
        headers: { "Idempotency-Key": key },
        body,
      });
      assert(res1.status >= 400, `${label} expected reject, got ${res1.status}`);
      assert(res1.json?.code === expectedCode, `${label} code ${res1.json?.code} != ${expectedCode}`);
      const afterEvents = await prisma.eduClockEvent.count({ where: { schoolId: school.id } });
      const afterAttempts = await prisma.eduClockGpsAttempt.count({
        where: { schoolId: school.id },
      });
      assert(afterEvents === beforeEvents, `${label}: no new event`);
      assert(afterAttempts === beforeAttempts + 1, `${label}: one gps attempt`);

      // same idempotency key does not duplicate audit
      const res2 = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
        method: "POST",
        token: staffToken,
        headers: { "Idempotency-Key": key },
        body,
      });
      assert(res2.status >= 400, `${label} idempotent replay reject`);
      const afterAttempts2 = await prisma.eduClockGpsAttempt.count({
        where: { schoolId: school.id },
      });
      assert(afterAttempts2 === afterAttempts, `${label}: no duplicate audit on same key`);

      // deliberate new key creates another attempt
      const res3 = await apiCall(baseUrl, "/api/educlock/me/clock-in", {
        method: "POST",
        token: staffToken,
        headers: { "Idempotency-Key": `${key}-retry` },
        body,
      });
      assert(res3.status >= 400, `${label} retry reject`);
      const afterAttempts3 = await prisma.eduClockGpsAttempt.count({
        where: { schoolId: school.id },
      });
      assert(afterAttempts3 === afterAttempts + 1, `${label}: new key new audit`);

      (evidence.rejectionScenarios as Array<Record<string, unknown>>).push({
        label,
        expectedCode,
        message: res1.json?.error,
        attemptsDelta: 1,
        eventsDelta: 0,
        idempotentNoDup: true,
        newKeyCreatesAttempt: true,
      });
    }

    // Staff is clocked out — rejections use clock-in
    const outside = offsetMetres(BASE_LAT, BASE_LNG, 40, 0);

    await expectReject(
      "permission_denied",
      { permissionState: "denied", locationError: "PERMISSION_DENIED" },
      "GPS_PERMISSION_DENIED"
    );
    await expectReject(
      "unavailable",
      { permissionState: "unavailable", locationError: "UNAVAILABLE" },
      "GPS_UNAVAILABLE"
    );
    await expectReject(
      "timeout",
      { permissionState: "timeout", locationError: "TIMEOUT" },
      "GPS_TIMEOUT"
    );
    await expectReject(
      "poor_accuracy",
      {
        latitude: inside.latitude,
        longitude: inside.longitude,
        accuracyMetres: 25,
        capturedAtClient: new Date().toISOString(),
        permissionState: "granted",
      },
      "GPS_ACCURACY_TOO_LOW"
    );
    await expectReject(
      "outside_geofence",
      {
        latitude: outside.latitude,
        longitude: outside.longitude,
        accuracyMetres: 5,
        capturedAtClient: new Date().toISOString(),
        permissionState: "granted",
      },
      "OUTSIDE_GEOFENCE"
    );

    // 12 Exceptions page still functional
    const exceptions = await apiCall(baseUrl, "/api/educlock/owner/exceptions", {
      token: ownerToken,
    });
    assert(exceptions.status === 200, `Exceptions ${exceptions.status}`);
    const exceptionsBody = JSON.stringify(exceptions.json || {});
    evidence.exceptions = {
      status: exceptions.status,
      gpsRejectionVisibleInOwnerUiApi: /GPS_|OUTSIDE_GEOFENCE|GpsAttempt/i.test(exceptionsBody),
      note: /GPS_|OUTSIDE_GEOFENCE|GpsAttempt/i.test(exceptionsBody)
        ? "GPS rejection codes appear in exceptions payload"
        : "GPS rejected attempts not exposed on Exceptions API — future follow-up",
    };

    // 13 Deactivate entrance prevents future matching
    const deact = await apiCall(baseUrl, `/api/educlock/owner/entrances/${entrance.json.id}`, {
      method: "PATCH",
      token: ownerToken,
      body: { isActive: false },
    });
    assert(deact.status === 200 && deact.json.isActive === false, "Entrance deactivated");

    await expectReject(
      "no_active_entrance",
      {
        latitude: inside.latitude,
        longitude: inside.longitude,
        accuracyMetres: 4,
        capturedAtClient: new Date().toISOString(),
        permissionState: "granted",
      },
      "NO_ACTIVE_ENTRANCE"
    );

    // 14 Historical accepted events retain matched entrance
    const histIn = await prisma.eduClockEvent.findUnique({
      where: { id: disposableIds.clockInEventId },
    });
    const histOut = await prisma.eduClockEvent.findUnique({
      where: { id: disposableIds.clockOutEventId },
    });
    assert(histIn?.matchedEntranceId === entrance.json.id, "Clock-in matchedEntrance retained");
    assert(histOut?.matchedEntranceId === entrance.json.id, "Clock-out matchedEntrance retained");
    evidence.historicalLinkAfterDeactivate = {
      clockInMatchedEntranceId: histIn?.matchedEntranceId,
      clockOutMatchedEntranceId: histOut?.matchedEntranceId,
    };

    // DB evidence for accepted clock-in
    evidence.dbClockIn = {
      schoolId: histIn?.schoolId,
      employeeId: histIn?.employeeId,
      userId: histIn?.userId,
      latitude: histIn?.latitude == null ? null : Number(histIn.latitude),
      longitude: histIn?.longitude == null ? null : Number(histIn.longitude),
      accuracyMetres: histIn?.accuracyMetres == null ? null : Number(histIn.accuracyMetres),
      matchedEntranceId: histIn?.matchedEntranceId,
      distanceMetres: histIn?.distanceMetres == null ? null : Number(histIn.distanceMetres),
      validationVersion: histIn?.validationVersion,
      occurredAtUtc: histIn?.occurredAtUtc?.toISOString(),
      schoolLocalDate: histIn?.schoolLocalDate,
      schoolLocalTime: histIn?.schoolLocalTime,
      eventType: histIn?.eventType,
      source: histIn?.source,
    };

    const sampleAttempt = await prisma.eduClockGpsAttempt.findFirst({
      where: { schoolId: school.id, rejectionCode: "OUTSIDE_GEOFENCE" },
      orderBy: { createdAt: "desc" },
    });
    evidence.dbRejectSample = sampleAttempt
      ? {
          rejectionCode: sampleAttempt.rejectionCode,
          hasLatitude: sampleAttempt.latitude != null,
          hasLongitude: sampleAttempt.longitude != null,
          nearestEntranceId: sampleAttempt.nearestEntranceId,
          distanceMetres:
            sampleAttempt.distanceMetres == null ? null : Number(sampleAttempt.distanceMetres),
          noPasswordFields: !JSON.stringify(sampleAttempt).toLowerCase().includes("password"),
          noTokenFields: !JSON.stringify(sampleAttempt).toLowerCase().includes("token"),
          noIdentityNumber: !JSON.stringify(sampleAttempt).includes(VALID_SA_ID),
        }
      : null;

    // Write fixture for Playwright browser run
    const fixturePath = path.join(
      __dirname,
      "../../storage/educlock-build4-checkpoint5-browser-fixture.json"
    );
    fs.writeFileSync(
      fixturePath,
      JSON.stringify(
        {
          apiBaseUrl: baseUrl,
          schoolId: school.id,
          ownerEmail: owner.email,
          staffEmail: staff.email,
          password: PASSWORD,
          validSaId: VALID_SA_ID,
          campusId: campus.json.id,
          entranceId: entrance.json.id,
          baseLat: BASE_LAT,
          baseLng: BASE_LNG,
          inside,
          outside,
          disposableIds,
        },
        null,
        2
      )
    );
    evidence.browserFixturePath = fixturePath;

    // Keep server alive for browser step — write PID info
    const keepAlivePath = path.join(
      __dirname,
      "../../storage/educlock-build4-checkpoint5-server.json"
    );
    fs.writeFileSync(
      keepAlivePath,
      JSON.stringify({ baseUrl, port: addr.port, schoolId: school.id, disposableIds }, null, 2)
    );

    const reportPath = path.join(
      __dirname,
      "../../storage/educlock-build4-checkpoint5-api-evidence.json"
    );
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ pass: true, financeBefore, daBefore, evidence }, null, 2)
    );
    console.log(JSON.stringify({ pass: true, baseUrl, reportPath, fixturePath }, null, 2));
    console.log("EDUCLOCK BUILD 4 CHECKPOINT 5 API E2E PASS — server kept alive for browser");
    console.log("C5_SERVER_READY");

    const shutdown = async (signal: string) => {
      console.log(`C5 shutting down on ${signal}`);
      server.close();
      const doCleanup = process.env.C5_SKIP_CLEANUP !== "1";
      if (doCleanup) {
        const counts = await cleanup(disposableIds);
        console.log(JSON.stringify({ cleanup: counts }, null, 2));
      }
      await prisma.$disconnect();
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));

    // Hold process open for browser (orchestrator sends SIGTERM)
    await new Promise(() => {});
  } catch (err) {
    console.error(err);
    server.close();
    await cleanup(disposableIds);
    await prisma.$disconnect();
    process.exitCode = 1;
  }
}

async function cleanup(ids: Record<string, string>) {
  const schoolId = ids.schoolId;
  if (!schoolId) {
    return { skipped: true };
  }
  const before = {
    events: await prisma.eduClockEvent.count({ where: { schoolId } }),
    attempts: await prisma.eduClockGpsAttempt.count({ where: { schoolId } }),
    entrances: await prisma.eduClockEntrance.count({ where: { schoolId } }),
    campuses: await prisma.eduClockCampus.count({ where: { schoolId } }),
    employees: await prisma.employee.count({ where: { schoolId } }),
    users: await prisma.user.count({ where: { schoolId } }),
  };
  await prisma.eduClockEvent.deleteMany({ where: { schoolId } });
  await prisma.eduClockGpsAttempt.deleteMany({ where: { schoolId } });
  await prisma.eduClockException.deleteMany({ where: { schoolId } });
  await prisma.eduClockOpenShift.deleteMany({ where: { schoolId } });
  await prisma.eduClockIdempotencyKey.deleteMany({ where: { schoolId } });
  await prisma.eduClockEntrance.deleteMany({ where: { schoolId } });
  await prisma.eduClockCampus.deleteMany({ where: { schoolId } });
  await prisma.eduClockActivationAudit.deleteMany({ where: { schoolId } });
  await prisma.employee.deleteMany({ where: { schoolId } });
  const users = await prisma.user.findMany({ where: { schoolId }, select: { id: true } });
  await prisma.userRbacMeta.deleteMany({ where: { userId: { in: users.map((x) => x.id) } } });
  await prisma.user.deleteMany({ where: { schoolId } });
  await prisma.schoolSubscription.deleteMany({ where: { schoolId } });
  await prisma.school.deleteMany({ where: { id: schoolId } });
  const after = {
    events: await prisma.eduClockEvent.count({ where: { schoolId } }),
    attempts: await prisma.eduClockGpsAttempt.count({ where: { schoolId } }),
    entrances: await prisma.eduClockEntrance.count({ where: { schoolId } }),
    campuses: await prisma.eduClockCampus.count({ where: { schoolId } }),
    employees: await prisma.employee.count({ where: { schoolId } }),
    users: await prisma.user.count({ where: { schoolId } }),
    schoolGone: (await prisma.school.count({ where: { id: schoolId } })) === 0,
  };
  return { before, after, leftoversZero: Object.entries(after).every(([k, v]) => k === "schoolGone" || v === 0) && after.schoolGone };
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await prisma.$disconnect();
});
