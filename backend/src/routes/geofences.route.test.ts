/**
 * Geofence Engine API route tests (local DB).
 * Run against educlear_educlock_dev:
 *   set -a && source .env.educlock_dev && set +a && npx tsc && node dist/routes/geofences.route.test.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import geofencesRoutes from "./geofences";
import { isGeofencePolygonValidationEnabled } from "../services/geofencePolygonValidationFlag";
import { polygonAreaSquareMetres } from "../services/geofenceGeometry";

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
  assert(dbUrl.includes("educlear_educlock_dev"), `Refuse: DATABASE_URL must be educlear_educlock_dev, got ${dbUrl}`);
  assert(isGeofencePolygonValidationEnabled() === false, "Polygon validation must default OFF");

  const stamp = Date.now();
  const schoolA = await prisma.school.create({ data: { name: `Geofence A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `Geofence B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-gf-${stamp}@example.com`,
      fullName: "Owner GF",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Owner",
          surname: "GF",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });

  const teacherA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `teacher-gf-${stamp}@example.com`,
      fullName: "Teacher GF",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Teacher",
          surname: "GF",
          appRole: "Teacher",
          permissions: { dashboard: { view: true } },
        },
      },
    },
  });

  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `owner-gf-b-${stamp}@example.com`,
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
      name: `Main ${stamp}`,
      perimeterStatus: "NOT_DRAWN",
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/geofences", geofencesRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const tokenOwnerA = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenTeacher = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "TEACHER",
  });
  const tokenOwnerB = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  try {
    const unauth = await apiCall(baseUrl, "/api/geofences/status");
    assert(unauth.status === 401, `expected 401, got ${unauth.status}`);

    const forbidden = await apiCall(baseUrl, "/api/geofences/status", { token: tokenTeacher });
    assert(forbidden.status === 403, `teacher should be 403, got ${forbidden.status}`);

    const status = await apiCall(baseUrl, "/api/geofences/status", { token: tokenOwnerA });
    assert(status.status === 200, `status 200 got ${status.status}`);
    assert(status.json.polygonValidationEnabled === false, "flag off");
    assert(status.json.schoolId === schoolA.id, "school scoped");

    const tooFew = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: [
          { latitude: -26.1, longitude: 28.0 },
          { latitude: -26.1, longitude: 28.01 },
        ],
      },
    });
    assert(tooFew.status === 400, `too few corners should 400, got ${tooFew.status}`);

    const crossSchool = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerB,
      body: {
        campusId: campusA.id,
        vertices: [
          { latitude: -26.1, longitude: 28.0 },
          { latitude: -26.1, longitude: 28.01 },
          { latitude: -26.11, longitude: 28.01 },
        ],
      },
    });
    assert(crossSchool.status === 404, `cross-school campus should 404, got ${crossSchool.status}`);

    const saved = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        name: "Main Boundary",
        vertices: [
          { latitude: -26.1, longitude: 28.0, accuracyMetres: 4 },
          { latitude: -26.1, longitude: 28.01, accuracyMetres: 5 },
          { latitude: -26.11, longitude: 28.01, accuracyMetres: 6 },
          { latitude: -26.11, longitude: 28.0, accuracyMetres: 5 },
        ],
      },
    });
    assert(saved.status === 201, `save should 201, got ${saved.status} ${JSON.stringify(saved.json)}`);
    assert(saved.json.clockBehaviourUnchanged === true, "clock unchanged");
    assert(saved.json.zone.type === "CAMPUS_BOUNDARY", "type");
    assert(saved.json.zone.vertexCount === 4, "4 vertices");
    assert(saved.json.zone.active === true, "active");

    const campusAfter = await prisma.eduClockCampus.findUnique({ where: { id: campusA.id } });
    assert(campusAfter?.perimeterStatus === "DRAWN", "perimeterStatus DRAWN");

    const listed = await apiCall(
      baseUrl,
      `/api/geofences/zones?type=CAMPUS_BOUNDARY&campusId=${campusA.id}&activeOnly=true`,
      { token: tokenOwnerA }
    );
    assert(listed.status === 200, "list ok");
    assert(listed.json.zones.length === 1, "one active zone");

    // Replace boundary — previous deactivated
    const replaced = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: [
          { latitude: -26.2, longitude: 28.0 },
          { latitude: -26.2, longitude: 28.02 },
          { latitude: -26.22, longitude: 28.02 },
        ],
      },
    });
    assert(replaced.status === 201, "replace ok");
    const allZones = await prisma.geofenceZone.findMany({
      where: { schoolId: schoolA.id, campusId: campusA.id, type: "CAMPUS_BOUNDARY" },
    });
    assert(allZones.length === 2, "history retained");
    assert(allZones.filter((z) => z.active).length === 1, "one active");

    const drawn = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: [
          { latitude: -26.15, longitude: 28.0 },
          { latitude: -26.15, longitude: 28.02 },
          { latitude: -26.17, longitude: 28.02 },
          { latitude: -26.17, longitude: 28.0 },
        ],
        metadata: {
          captureMethod: "DRAW_ON_MAP",
          pointCount: 4,
          entrancesInside: 1,
          entrancesOutside: 0,
        },
      },
    });
    assert(drawn.status === 201, `draw save 201 got ${drawn.status} ${JSON.stringify(drawn.json)}`);
    assert(drawn.json.zone.metadata.captureMethod === "DRAW_ON_MAP", "draw capture method");
    assert(drawn.json.zone.metadata.source === "educlock_draw_on_map", "draw source");
    assert(drawn.json.zone.metadata.lastAudit?.action === "BOUNDARY_REPLACED", "audit replaced");
    assert(drawn.json.clockBehaviourUnchanged === true, "clock still unchanged after draw");

    const badMethod = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: [
          { latitude: -26.15, longitude: 28.0 },
          { latitude: -26.15, longitude: 28.02 },
          { latitude: -26.17, longitude: 28.02 },
        ],
        metadata: { captureMethod: "WALK_BOUNDARY" },
      },
    });
    assert(badMethod.status === 400, `unsupported method 400 got ${badMethod.status}`);

    const selfX = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: [
          { latitude: -26.1, longitude: 28.0 },
          { latitude: -26.11, longitude: 28.01 },
          { latitude: -26.1, longitude: 28.01 },
          { latitude: -26.11, longitude: 28.0 },
        ],
        metadata: { captureMethod: "DRAW_ON_MAP" },
      },
    });
    assert(selfX.status === 400, `self-intersect 400 got ${selfX.status}`);

    // Small triangle ≈ 15.5 m² — DRAW rejects; SAVE_EACH_CORNER accepts (regression fix)
    const smallVertices = [
      { latitude: -26.1, longitude: 28.0 },
      { latitude: -26.1, longitude: 28.00005 },
      { latitude: -26.10005, longitude: 28.00005 },
    ];
    const smallArea = polygonAreaSquareMetres(smallVertices);
    assert(smallArea > 0 && smallArea < 50, `fixture area must be < 50 m², got ${smallArea}`);
    console.log(`ROUTE_TEST_SMALL_POLYGON_AREA_SQ_METRES=${smallArea.toFixed(4)}`);

    const drawTooSmall = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: smallVertices,
        metadata: { captureMethod: "DRAW_ON_MAP" },
      },
    });
    assert(
      drawTooSmall.status === 400,
      `DRAW_ON_MAP small area should 400, got ${drawTooSmall.status} ${JSON.stringify(drawTooSmall.json)}`
    );

    const cornerSmallOk = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwnerA,
      body: {
        campusId: campusA.id,
        vertices: smallVertices,
        metadata: { captureMethod: "SAVE_EACH_CORNER" },
      },
    });
    assert(
      cornerSmallOk.status === 201,
      `SAVE_EACH_CORNER small area should 201, got ${cornerSmallOk.status} ${JSON.stringify(cornerSmallOk.json)}`
    );
    assert(
      cornerSmallOk.json.zone.metadata.captureMethod === "SAVE_EACH_CORNER",
      "corner capture method preserved"
    );

    console.log("geofences.route.test.ts PASS");
  } finally {
    server.close();
    await prisma.geofenceVertex.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.geofenceZone.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockCampus.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: { userId: { in: [ownerA.id, teacherA.id, ownerB.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, teacherA.id, ownerB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
