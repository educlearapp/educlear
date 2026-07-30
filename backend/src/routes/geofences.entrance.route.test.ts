/**
 * Phase 2B — entrance type + boundary containment (local educlear_educlock_dev).
 * Run:
 *   set -a && source .env.educlock_dev && set +a
 *   npx esbuild src/routes/geofences.entrance.route.test.ts --bundle --platform=node --format=cjs --outfile=tmp-ent.cjs --external:bcryptjs --external:@prisma/client --external:express --external:jsonwebtoken
 *   node tmp-ent.cjs
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import geofencesRoutes from "./geofences";
import educlockRoutes from "./educlock";
import { isGeofencePolygonValidationEnabled } from "../services/geofencePolygonValidationFlag";
import { isPointInsidePolygon } from "../services/geofenceGeometry";

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

  assert(
    isPointInsidePolygon(
      { latitude: 0.5, longitude: 0.5 },
      [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 1 },
        { latitude: 1, longitude: 0 },
      ]
    ) === true,
    "pip inside"
  );

  const stamp = Date.now();
  const schoolA = await prisma.school.create({ data: { name: `Ent Wiz A ${stamp}` } });
  const schoolB = await prisma.school.create({ data: { name: `Ent Wiz B ${stamp}` } });
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const ownerA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `owner-ent-${stamp}@example.com`,
      fullName: "Owner Ent",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Owner",
          surname: "Ent",
          appRole: "Owner",
          permissions: {},
        },
      },
    },
  });
  const staffA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `staff-ent-${stamp}@example.com`,
      fullName: "Staff Ent",
      passwordHash,
      role: "STAFF",
      isActive: true,
      rbacMeta: {
        create: {
          schoolId: schoolA.id,
          firstName: "Staff",
          surname: "Ent",
          appRole: "Teacher",
          permissions: { dashboard: { view: true } },
        },
      },
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `owner-ent-b-${stamp}@example.com`,
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

  const campus = await prisma.eduClockCampus.create({
    data: { schoolId: schoolA.id, name: `Campus ${stamp}`, perimeterStatus: "NOT_DRAWN" },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/geofences", geofencesRoutes);
  app.use("/api/educlock", educlockRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const tokenOwner = signToken({
    userId: ownerA.id,
    schoolId: schoolA.id,
    email: ownerA.email,
    role: "SCHOOL_ADMIN",
  });
  const tokenStaff = signToken({
    userId: staffA.id,
    schoolId: schoolA.id,
    email: staffA.email,
    role: "STAFF",
  });
  const tokenB = signToken({
    userId: ownerB.id,
    schoolId: schoolB.id,
    email: ownerB.email,
    role: "SCHOOL_ADMIN",
  });

  const clockEventsBefore = await prisma.eduClockEvent.count({ where: { schoolId: schoolA.id } });

  try {
    const staffBlocked = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenStaff,
      body: { name: "Nope", latitude: -26.1, longitude: 28.0, entranceType: "MAIN_GATE" },
    });
    assert(staffBlocked.status === 403, `staff cannot configure, got ${staffBlocked.status}`);

    // Save campus boundary square (mocked coords)
    const boundary = await apiCall(baseUrl, "/api/geofences/campus-boundaries", {
      method: "POST",
      token: tokenOwner,
      body: {
        campusId: campus.id,
        vertices: [
          { latitude: -26.2, longitude: 28.0 },
          { latitude: -26.2, longitude: 28.01 },
          { latitude: -26.21, longitude: 28.01 },
          { latitude: -26.21, longitude: 28.0 },
        ],
      },
    });
    assert(boundary.status === 201, `boundary save ${boundary.status}`);

    const outsideBlocked = await apiCall(
      baseUrl,
      `/api/educlock/owner/campuses/${campus.id}/entrances`,
      {
        method: "POST",
        token: tokenOwner,
        body: {
          name: "Outside Gate",
          entranceType: "MAIN_GATE",
          latitude: -26.3,
          longitude: 28.05,
          allowedRadiusMetres: 10,
        },
      }
    );
    assert(outsideBlocked.status === 400, "outside without confirm blocked");
    assert(
      outsideBlocked.json.code === "EDUCLOCK_ENTRANCE_OUTSIDE_BOUNDARY",
      `code ${outsideBlocked.json.code}`
    );

    const outsideOk = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenOwner,
      body: {
        name: "Outside Gate",
        entranceType: "MAIN_GATE",
        latitude: -26.3,
        longitude: 28.05,
        allowedRadiusMetres: 10,
        confirmOutsideBoundary: true,
      },
    });
    assert(outsideOk.status === 201, `outside with confirm ${outsideOk.status}`);
    assert(outsideOk.json.boundaryStatus === "OUTSIDE", "boundaryStatus OUTSIDE");
    assert(outsideOk.json.entranceType === "MAIN_GATE", "type stored");
    assert(outsideOk.json.allowedRadiusMetres === 10, "radius 10");
    assert(outsideOk.json.polygonValidationEnabled === false, "flag off");

    const inside = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenOwner,
      body: {
        name: "Main Gate",
        entranceType: "MAIN_GATE",
        latitude: -26.205,
        longitude: 28.005,
        allowedRadiusMetres: 10,
      },
    });
    assert(inside.status === 201, `inside ${inside.status} ${JSON.stringify(inside.json)}`);
    assert(inside.json.boundaryStatus === "INSIDE", "inside");

    const dup = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenOwner,
      body: {
        name: "main gate",
        entranceType: "STAFF",
        latitude: -26.2051,
        longitude: 28.0051,
        allowedRadiusMetres: 10,
      },
    });
    assert(dup.status === 409 || dup.status === 400, `duplicate blocked ${dup.status}`);

    const other = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenOwner,
      body: {
        name: "Custom Door",
        entranceType: "OTHER",
        customTypeLabel: "Delivery",
        latitude: -26.2052,
        longitude: 28.0052,
        allowedRadiusMetres: 12,
      },
    });
    assert(other.status === 201, "other type");
    assert(other.json.customTypeLabel === "Delivery", "custom label");

    const badRadius = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenOwner,
      body: {
        name: "Bad Radius",
        entranceType: "VISITOR",
        latitude: -26.2053,
        longitude: 28.0053,
        allowedRadiusMetres: 26,
      },
    });
    assert(badRadius.status === 400, "radius 26 rejected");

    const cross = await apiCall(baseUrl, `/api/educlock/owner/campuses/${campus.id}/entrances`, {
      method: "POST",
      token: tokenB,
      body: {
        name: "Cross",
        entranceType: "MAIN_GATE",
        latitude: -26.205,
        longitude: 28.005,
        allowedRadiusMetres: 10,
      },
    });
    assert(cross.status === 404, "tenant isolation");

    const contain = await apiCall(baseUrl, "/api/geofences/containment-check", {
      method: "POST",
      token: tokenOwner,
      body: { campusId: campus.id, latitude: -26.205, longitude: 28.005 },
    });
    assert(contain.status === 200 && contain.json.status === "INSIDE", "containment API");

    const edit = await apiCall(baseUrl, `/api/educlock/owner/entrances/${inside.json.id}`, {
      method: "PATCH",
      token: tokenOwner,
      body: { allowedRadiusMetres: 15 },
    });
    assert(edit.status === 200 && edit.json.allowedRadiusMetres === 15, "edit radius");

    const deact = await apiCall(baseUrl, `/api/educlock/owner/entrances/${inside.json.id}`, {
      method: "PATCH",
      token: tokenOwner,
      body: { isActive: false },
    });
    assert(deact.status === 200 && deact.json.isActive === false, "deactivate");

    const react = await apiCall(baseUrl, `/api/educlock/owner/entrances/${inside.json.id}`, {
      method: "PATCH",
      token: tokenOwner,
      body: { isActive: true },
    });
    assert(react.status === 200 && react.json.isActive === true, "reactivate");

    const clockEventsAfter = await prisma.eduClockEvent.count({ where: { schoolId: schoolA.id } });
    assert(clockEventsAfter === clockEventsBefore, "no clock events created");

    console.log("geofences.entrance.route.test.ts PASS");
  } finally {
    server.close();
    await prisma.geofenceVertex.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.geofenceZone.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockEntrance.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.eduClockCampus.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.userRbacMeta.deleteMany({
      where: { userId: { in: [ownerA.id, staffA.id, ownerB.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, staffA.id, ownerB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
