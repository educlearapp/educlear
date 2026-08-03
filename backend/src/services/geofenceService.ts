/**
 * Shared Geofence Engine service.
 * Product modules (EduClock, HomeSafe, …) reuse this instead of duplicating GPS/boundary storage.
 *
 * Phase 2–4 scope: create/list/update CAMPUS_BOUNDARY polygons.
 * Staff clock GPS (gps-boundary-v1) validates against active campus boundaries.
 */
import {
  GeofenceGeometryKind,
  GeofenceZoneType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "../prisma";
import {
  GEOFENCE_CAPTURE_METHOD_SOURCE,
  isApprovedGeofenceCaptureMethod,
  parseGeofenceCaptureMethod,
  type GeofenceCaptureMethod,
} from "./geofenceCaptureMethods";
import {
  buildGeoJsonPolygon,
  isPointInsidePolygon,
  polygonAreaSquareMetres,
  polygonPerimeterMetres,
  validateBoundaryGeometryForCaptureMethod,
  type CampusBoundaryContainment,
  type GeofenceLatLng,
} from "./geofenceGeometry";
import { isGeofencePolygonValidationEnabled } from "./geofencePolygonValidationFlag";
import { evaluateOwnerLocationSimulation } from "./geofenceLocationTest";

function asMetadataObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/**
 * Minimal boundary audit — stored on GeofenceZone.metadata (no new schema in Phase 2D).
 * No existing geofence audit table; EduClockActivationAudit is identity-only and must not be reused.
 */
function buildBoundaryAuditEvent(input: {
  action: "BOUNDARY_CREATED" | "BOUNDARY_REPLACED" | "BOUNDARY_ACTIVATED" | "BOUNDARY_DEACTIVATED";
  schoolId: string;
  campusId: string | null;
  actorUserId: string;
  captureMethod?: GeofenceCaptureMethod | null;
  pointCount?: number | null;
  previousBoundaryId?: string | null;
  newBoundaryId?: string | null;
}) {
  return {
    action: input.action,
    schoolId: input.schoolId,
    campusId: input.campusId,
    actorUserId: input.actorUserId,
    serverTimestamp: new Date().toISOString(),
    captureMethod: input.captureMethod ?? null,
    pointCount: input.pointCount ?? null,
    previousBoundaryId: input.previousBoundaryId ?? null,
    newBoundaryId: input.newBoundaryId ?? null,
  };
}

export class GeofenceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type GeofenceVertexInput = GeofenceLatLng;

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  return Number(value);
}

function serializeVertex(v: {
  id: string;
  schoolId: string;
  zoneId: string;
  sequence: number;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  accuracyMetres: Prisma.Decimal | null;
  capturedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: v.id,
    schoolId: v.schoolId,
    zoneId: v.zoneId,
    sequence: v.sequence,
    latitude: Number(v.latitude),
    longitude: Number(v.longitude),
    accuracyMetres: decimalToNumber(v.accuracyMetres),
    capturedAt: v.capturedAt ? v.capturedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
}

function serializeZone(zone: {
  id: string;
  schoolId: string;
  name: string;
  type: GeofenceZoneType;
  active: boolean;
  geometryKind: GeofenceGeometryKind;
  geometry: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  campusId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  vertices?: Array<{
    id: string;
    schoolId: string;
    zoneId: string;
    sequence: number;
    latitude: Prisma.Decimal;
    longitude: Prisma.Decimal;
    accuracyMetres: Prisma.Decimal | null;
    capturedAt: Date | null;
    createdAt: Date;
  }>;
}) {
  const vertices = (zone.vertices || [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(serializeVertex);
  return {
    id: zone.id,
    schoolId: zone.schoolId,
    name: zone.name,
    type: zone.type,
    active: zone.active,
    geometryKind: zone.geometryKind,
    geometry: zone.geometry,
    metadata: zone.metadata,
    campusId: zone.campusId,
    createdByUserId: zone.createdByUserId,
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
    vertices,
    vertexCount: vertices.length,
    /** Informational only — clock path does not use this until flag is enabled. */
    polygonValidationEnabled: isGeofencePolygonValidationEnabled(),
  };
}

export async function listGeofenceZones(
  schoolId: string,
  filters?: {
    type?: GeofenceZoneType;
    campusId?: string;
    activeOnly?: boolean;
  }
) {
  const zones = await prisma.geofenceZone.findMany({
    where: {
      schoolId,
      ...(filters?.type ? { type: filters.type } : {}),
      ...(filters?.campusId ? { campusId: filters.campusId } : {}),
      ...(filters?.activeOnly ? { active: true } : {}),
    },
    include: { vertices: { orderBy: { sequence: "asc" } } },
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });
  return {
    schoolId,
    polygonValidationEnabled: isGeofencePolygonValidationEnabled(),
    zones: zones.map(serializeZone),
  };
}

export async function getGeofenceZone(schoolId: string, zoneId: string) {
  const zone = await prisma.geofenceZone.findFirst({
    where: { id: zoneId, schoolId },
    include: { vertices: { orderBy: { sequence: "asc" } } },
  });
  if (!zone) {
    throw new GeofenceError("GEOFENCE_NOT_FOUND", 404, "Geofence zone not found for this school.");
  }
  return serializeZone(zone);
}

async function assertCampusBelongsToSchool(
  db: PrismaClient | Prisma.TransactionClient,
  schoolId: string,
  campusId: string
) {
  const campus = await db.eduClockCampus.findFirst({
    where: { id: campusId, schoolId },
    select: { id: true, name: true },
  });
  if (!campus) {
    throw new GeofenceError("GEOFENCE_CAMPUS_NOT_FOUND", 404, "Campus not found for this school.");
  }
  return campus;
}

/**
 * Create or replace the active CAMPUS_BOUNDARY polygon for a campus.
 * Previous active campus-boundary zones for the same campus are deactivated (history retained).
 * Active boundaries are the authority for staff CLOCK_IN / CLOCK_OUT GPS (gps-boundary-v1).
 */
export async function upsertCampusBoundaryPolygon(input: {
  schoolId: string;
  actorUserId: string;
  campusId: string;
  name?: string | null;
  vertices: GeofenceVertexInput[];
  metadata?: Record<string, unknown> | null;
}) {
  const incomingMeta = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const requestedMethod = incomingMeta.captureMethod;
  if (
    requestedMethod != null &&
    String(requestedMethod).trim() !== "" &&
    !isApprovedGeofenceCaptureMethod(requestedMethod)
  ) {
    throw new GeofenceError(
      "GEOFENCE_INVALID",
      400,
      `Unsupported captureMethod. Allowed: SAVE_EACH_CORNER, DRAW_ON_MAP.`
    );
  }
  const captureMethod = parseGeofenceCaptureMethod(requestedMethod, "SAVE_EACH_CORNER");

  const geometryError = validateBoundaryGeometryForCaptureMethod(captureMethod, input.vertices);
  if (geometryError) {
    throw new GeofenceError("GEOFENCE_INVALID_GEOMETRY", 400, geometryError.message);
  }

  const areaSquareMetres = Math.round(polygonAreaSquareMetres(input.vertices) * 100) / 100;
  const perimeterMetres = Math.round(polygonPerimeterMetres(input.vertices) * 100) / 100;
  const pointCount = input.vertices.length;

  const campus = await assertCampusBelongsToSchool(prisma, input.schoolId, input.campusId);
  const name =
    String(input.name || "").trim() || `${campus.name} Campus Boundary`;
  const geometry = buildGeoJsonPolygon(input.vertices);

  const zone = await prisma.$transaction(async (tx) => {
    const previousActive = await tx.geofenceZone.findMany({
      where: {
        schoolId: input.schoolId,
        campusId: input.campusId,
        type: GeofenceZoneType.CAMPUS_BOUNDARY,
        active: true,
      },
      select: { id: true, metadata: true },
    });
    const previousBoundaryId = previousActive[0]?.id ?? null;
    const action = previousBoundaryId ? "BOUNDARY_REPLACED" : "BOUNDARY_CREATED";

    for (const prev of previousActive) {
      const prevMeta = asMetadataObject(prev.metadata);
      const deactivateAudit = buildBoundaryAuditEvent({
        action: "BOUNDARY_DEACTIVATED",
        schoolId: input.schoolId,
        campusId: input.campusId,
        actorUserId: input.actorUserId,
        captureMethod,
        pointCount:
          typeof prevMeta.pointCount === "number" ? prevMeta.pointCount : null,
        previousBoundaryId: prev.id,
        newBoundaryId: null,
      });
      await tx.geofenceZone.update({
        where: { id: prev.id },
        data: {
          active: false,
          metadata: {
            ...prevMeta,
            deactivatedAt: deactivateAudit.serverTimestamp,
            deactivatedByUserId: input.actorUserId,
            deactivationReason: "REPLACED",
            lastAudit: deactivateAudit,
          } as Prisma.InputJsonValue,
        },
      });
    }

    const created = await tx.geofenceZone.create({
      data: {
        schoolId: input.schoolId,
        name,
        type: GeofenceZoneType.CAMPUS_BOUNDARY,
        active: true,
        geometryKind: GeofenceGeometryKind.POLYGON,
        geometry: geometry as unknown as Prisma.InputJsonValue,
        metadata: {
          ...incomingMeta,
          source: GEOFENCE_CAPTURE_METHOD_SOURCE[captureMethod],
          captureMethod,
          pointCount,
          areaSquareMetres,
          perimeterMetres,
          entrancesInside:
            typeof incomingMeta.entrancesInside === "number"
              ? incomingMeta.entrancesInside
              : null,
          entrancesOutside:
            typeof incomingMeta.entrancesOutside === "number"
              ? incomingMeta.entrancesOutside
              : null,
          replacesZoneId: previousBoundaryId,
          lastAudit: buildBoundaryAuditEvent({
            action,
            schoolId: input.schoolId,
            campusId: input.campusId,
            actorUserId: input.actorUserId,
            captureMethod,
            pointCount,
            previousBoundaryId,
            newBoundaryId: null,
          }),
        } as Prisma.InputJsonValue,
        campusId: input.campusId,
        createdByUserId: input.actorUserId,
        vertices: {
          create: input.vertices.map((v, sequence) => ({
            schoolId: input.schoolId,
            sequence,
            latitude: v.latitude,
            longitude: v.longitude,
            accuracyMetres:
              v.accuracyMetres == null || !Number.isFinite(Number(v.accuracyMetres))
                ? null
                : Number(v.accuracyMetres),
            capturedAt: v.capturedAt ? new Date(v.capturedAt) : new Date(),
          })),
        },
      },
      include: { vertices: { orderBy: { sequence: "asc" } } },
    });

    // Patch newBoundaryId onto lastAudit now that the id exists.
    const createdMeta = asMetadataObject(created.metadata);
    const lastAudit = {
      ...(typeof createdMeta.lastAudit === "object" && createdMeta.lastAudit
        ? (createdMeta.lastAudit as Record<string, unknown>)
        : {}),
      newBoundaryId: created.id,
    };
    const withAuditId = await tx.geofenceZone.update({
      where: { id: created.id },
      data: {
        metadata: {
          ...createdMeta,
          lastAudit,
        } as Prisma.InputJsonValue,
      },
      include: { vertices: { orderBy: { sequence: "asc" } } },
    });

    // Link previous zones to the replacement id.
    for (const prev of previousActive) {
      const prevRow = await tx.geofenceZone.findUnique({ where: { id: prev.id } });
      if (!prevRow) continue;
      const prevMeta = asMetadataObject(prevRow.metadata);
      await tx.geofenceZone.update({
        where: { id: prev.id },
        data: {
          metadata: {
            ...prevMeta,
            replacedByZoneId: created.id,
            lastAudit: {
              ...(typeof prevMeta.lastAudit === "object" && prevMeta.lastAudit
                ? (prevMeta.lastAudit as Record<string, unknown>)
                : {}),
              newBoundaryId: created.id,
            },
          } as Prisma.InputJsonValue,
        },
      });
    }

    await tx.eduClockCampus.update({
      where: { id: input.campusId },
      data: { perimeterStatus: "DRAWN" },
    });

    return withAuditId;
  });

  return serializeZone(zone);
}

export async function updateGeofenceZone(input: {
  schoolId: string;
  zoneId: string;
  actorUserId?: string;
  name?: string;
  active?: boolean;
  metadata?: Record<string, unknown> | null;
}) {
  const existing = await prisma.geofenceZone.findFirst({
    where: { id: input.zoneId, schoolId: input.schoolId },
  });
  if (!existing) {
    throw new GeofenceError("GEOFENCE_NOT_FOUND", 404, "Geofence zone not found for this school.");
  }

  const data: Prisma.GeofenceZoneUpdateInput = {};
  if (input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (!name) {
      throw new GeofenceError("GEOFENCE_INVALID", 400, "Zone name is required.");
    }
    data.name = name;
  }
  if (input.active !== undefined) {
    data.active = Boolean(input.active);
  }

  const existingMeta = asMetadataObject(existing.metadata);
  let nextMeta: Record<string, unknown> | null | undefined =
    input.metadata === undefined ? undefined : input.metadata;
  if (input.active !== undefined && existing.active !== Boolean(input.active)) {
    const actorUserId = String(input.actorUserId || existing.createdByUserId || "").trim();
    const audit = buildBoundaryAuditEvent({
      action: input.active ? "BOUNDARY_ACTIVATED" : "BOUNDARY_DEACTIVATED",
      schoolId: input.schoolId,
      campusId: existing.campusId,
      actorUserId: actorUserId || "unknown",
      captureMethod: parseGeofenceCaptureMethod(existingMeta.captureMethod, "SAVE_EACH_CORNER"),
      pointCount: typeof existingMeta.pointCount === "number" ? existingMeta.pointCount : null,
      previousBoundaryId: existing.id,
      newBoundaryId: existing.id,
    });
    const base = nextMeta === undefined ? existingMeta : nextMeta == null ? {} : nextMeta;
    nextMeta = {
      ...base,
      lastAudit: audit,
      ...(input.active
        ? { reactivatedAt: audit.serverTimestamp, reactivatedByUserId: actorUserId || null }
        : {
            deactivatedAt: audit.serverTimestamp,
            deactivatedByUserId: actorUserId || null,
            deactivationReason: "MANUAL",
          }),
    };
  }
  if (nextMeta !== undefined) {
    data.metadata =
      nextMeta == null ? Prisma.JsonNull : (nextMeta as Prisma.InputJsonValue);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const zone = await tx.geofenceZone.update({
      where: { id: input.zoneId },
      data,
      include: { vertices: { orderBy: { sequence: "asc" } } },
    });

    // Keep EduClock campus perimeterStatus in sync for CAMPUS_BOUNDARY zones.
    if (
      zone.type === GeofenceZoneType.CAMPUS_BOUNDARY &&
      zone.campusId &&
      input.active !== undefined
    ) {
      if (input.active) {
        const others = await tx.geofenceZone.findMany({
          where: {
            schoolId: input.schoolId,
            campusId: zone.campusId,
            type: GeofenceZoneType.CAMPUS_BOUNDARY,
            active: true,
            NOT: { id: zone.id },
          },
          select: { id: true, metadata: true },
        });
        for (const other of others) {
          const otherMeta = asMetadataObject(other.metadata);
          await tx.geofenceZone.update({
            where: { id: other.id },
            data: {
              active: false,
              metadata: {
                ...otherMeta,
                deactivatedAt: new Date().toISOString(),
                deactivationReason: "SUPERSEDED_BY_ACTIVATION",
                replacedByZoneId: zone.id,
              } as Prisma.InputJsonValue,
            },
          });
        }
        await tx.eduClockCampus.update({
          where: { id: zone.campusId },
          data: { perimeterStatus: "DRAWN" },
        });
      } else {
        const stillActive = await tx.geofenceZone.count({
          where: {
            schoolId: input.schoolId,
            campusId: zone.campusId,
            type: GeofenceZoneType.CAMPUS_BOUNDARY,
            active: true,
          },
        });
        if (stillActive === 0) {
          await tx.eduClockCampus.update({
            where: { id: zone.campusId },
            data: { perimeterStatus: "NOT_DRAWN" },
          });
        }
      }
    }

    return zone;
  });

  return serializeZone(updated);
}

/**
 * Advisory containment check for owner entrance setup.
 * Staff clock GPS also uses active campus boundary polygons (gps-boundary-v1).
 */
export async function evaluateCampusBoundaryContainment(input: {
  schoolId: string;
  campusId: string;
  latitude: number;
  longitude: number;
}): Promise<CampusBoundaryContainment> {
  const zone = await prisma.geofenceZone.findFirst({
    where: {
      schoolId: input.schoolId,
      campusId: input.campusId,
      type: GeofenceZoneType.CAMPUS_BOUNDARY,
      active: true,
    },
    include: { vertices: { orderBy: { sequence: "asc" } } },
  });
  if (!zone || !zone.vertices || zone.vertices.length < 3) {
    return { status: "NO_BOUNDARY" };
  }
  const ring = zone.vertices.map((v) => ({
    latitude: Number(v.latitude),
    longitude: Number(v.longitude),
  }));
  const inside = isPointInsidePolygon(
    { latitude: input.latitude, longitude: input.longitude },
    ring
  );
  return inside
    ? { status: "INSIDE", zoneId: zone.id }
    : { status: "OUTSIDE", zoneId: zone.id };
}

export async function getActiveCampusBoundaryForMap(input: {
  schoolId: string;
  campusId: string;
}) {
  const zone = await prisma.geofenceZone.findFirst({
    where: {
      schoolId: input.schoolId,
      campusId: input.campusId,
      type: GeofenceZoneType.CAMPUS_BOUNDARY,
      active: true,
    },
    include: { vertices: { orderBy: { sequence: "asc" } } },
  });
  if (!zone) return null;
  return serializeZone(zone);
}

/**
 * Owner Location Test Mode — read-only simulation for one campus.
 * Does not create EduClockEvent, EduClockGpsAttempt, attendance, or payroll rows.
 */
export async function testOwnerLocation(input: {
  schoolId: string;
  campusId: string;
  latitude: number;
  longitude: number;
  accuracyMetres: number;
}) {
  const campus = await prisma.eduClockCampus.findFirst({
    where: { id: input.campusId, schoolId: input.schoolId },
    select: {
      id: true,
      name: true,
      isActive: true,
      entrances: {
        select: {
          id: true,
          name: true,
          isActive: true,
          latitude: true,
          longitude: true,
          allowedRadiusMetres: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!campus) {
    throw new GeofenceError("GEOFENCE_CAMPUS_NOT_FOUND", 404, "Campus not found for this school.");
  }

  const zone = await prisma.geofenceZone.findFirst({
    where: {
      schoolId: input.schoolId,
      campusId: input.campusId,
      type: GeofenceZoneType.CAMPUS_BOUNDARY,
      active: true,
    },
    include: { vertices: { orderBy: { sequence: "asc" } } },
  });

  const boundaryRing =
    zone && zone.vertices.length >= 3
      ? zone.vertices.map((v) => ({
          latitude: Number(v.latitude),
          longitude: Number(v.longitude),
        }))
      : null;

  const simulation = evaluateOwnerLocationSimulation({
    campusId: campus.id,
    campusName: campus.name,
    campusActive: campus.isActive,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMetres: input.accuracyMetres,
    boundaryRing,
    entrances: campus.entrances.map((e) => ({
      id: e.id,
      name: e.name,
      isActive: e.isActive,
      latitude: e.latitude == null ? null : Number(e.latitude),
      longitude: e.longitude == null ? null : Number(e.longitude),
      allowedRadiusMetres: e.allowedRadiusMetres,
    })),
  });

  return {
    ...simulation,
    map: {
      boundary: boundaryRing || [],
      entrances: campus.entrances
        .filter((e) => e.isActive && e.latitude != null && e.longitude != null)
        .map((e) => ({
          id: e.id,
          name: e.name,
          latitude: Number(e.latitude),
          longitude: Number(e.longitude),
          allowedRadiusMetres: e.allowedRadiusMetres,
          isNearest: e.id === simulation.nearestActiveEntranceId,
        })),
      current: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMetres: input.accuracyMetres,
      },
    },
  };
}
