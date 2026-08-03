/**
 * EduClock GPS validation (backend authority).
 * CLOCK_IN and CLOCK_OUT accept any point inside an active campus boundary polygon,
 * plus a conservative 10 m edge tolerance for GPS drift (when accuracy ≤ 20 m).
 * Entrance coordinates / radiuses do not determine acceptance.
 * Does not create clock events; callers persist accepted GPS fields or rejected attempts.
 */
import { EduClockEventType, Prisma, type PrismaClient } from "@prisma/client";

import {
  haversineDistanceMetres,
  isValidLatitude,
  isValidLongitude,
  roundDistanceMetresForStorage,
} from "../utils/educlockGpsDistance";
import { isPointInsidePolygon } from "./geofenceGeometry";
import { EduClockError } from "./educlockService";

/** Strict inside-polygon accept. */
export const EDUCLOCK_GPS_VALIDATION_VERSION = "gps-boundary-v1";
/** Outside polygon but within edge tolerance. */
export const EDUCLOCK_GPS_VALIDATION_VERSION_EDGE = "gps-boundary-v1-edge10";
export type EduClockGpsValidationVersion =
  | typeof EDUCLOCK_GPS_VALIDATION_VERSION
  | typeof EDUCLOCK_GPS_VALIDATION_VERSION_EDGE;

export const EDUCLOCK_GPS_MAX_ACCURACY_METRES = 20;
/** Conservative GPS-drift buffer outside the drawn polygon (metres). Does not rewrite the polygon. */
export const EDUCLOCK_GPS_BOUNDARY_EDGE_TOLERANCE_METRES = 10;
export const EDUCLOCK_GPS_EDGE_TOLERANCE_VERSION = "edge10";
/** Retained for entrance setup / owner UI — not used for clock accept/reject. */
export const EDUCLOCK_GPS_DEFAULT_RADIUS_METRES = 5;
export const EDUCLOCK_GPS_MIN_RADIUS_METRES = 1;
export const EDUCLOCK_GPS_MAX_RADIUS_METRES = 25;

export type EduClockGpsRejectionCode =
  | "GPS_PERMISSION_DENIED"
  | "GPS_UNAVAILABLE"
  | "GPS_TIMEOUT"
  | "GPS_COORDINATES_MISSING"
  | "GPS_COORDINATES_INVALID"
  | "GPS_ACCURACY_MISSING"
  | "GPS_ACCURACY_INVALID"
  | "GPS_ACCURACY_TOO_LOW"
  /** Historical rejection code (entrance-era). New rejects use NO_ACTIVE_BOUNDARY. */
  | "NO_ACTIVE_ENTRANCE"
  | "NO_ACTIVE_BOUNDARY"
  | "OUTSIDE_GEOFENCE";

export const EDUCLOCK_GPS_MESSAGES: Record<EduClockGpsRejectionCode, string> = {
  GPS_PERMISSION_DENIED: "Location permission is required to clock in or out.",
  GPS_UNAVAILABLE: "We could not access your location. Please check location services and try again.",
  GPS_TIMEOUT: "Your location request timed out. Move into an open area and try again.",
  GPS_COORDINATES_MISSING: "Location coordinates are required to clock in or out.",
  GPS_COORDINATES_INVALID: "Location coordinates are invalid. Please try again.",
  GPS_ACCURACY_MISSING: "Location accuracy is required to clock in or out.",
  GPS_ACCURACY_INVALID: "Location accuracy is invalid. Please try again.",
  GPS_ACCURACY_TOO_LOW: "We could not get an accurate enough location. Move into an open area and try again.",
  NO_ACTIVE_ENTRANCE: "No EduClock entrance has been configured. Contact the school owner.",
  NO_ACTIVE_BOUNDARY:
    "No active campus boundary has been configured. Contact the school owner.",
  OUTSIDE_GEOFENCE: "You are outside the permitted school clocking area.",
};

export class EduClockGpsError extends EduClockError {
  readonly rejectionCode: EduClockGpsRejectionCode;
  readonly nearestEntranceId: string | null;
  readonly distanceMetres: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyMetres: number | null;
  readonly deviceMetadata: Record<string, unknown> | null;
  readonly matchedZoneId: string | null;

  constructor(input: {
    rejectionCode: EduClockGpsRejectionCode;
    nearestEntranceId?: string | null;
    distanceMetres?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracyMetres?: number | null;
    deviceMetadata?: Record<string, unknown> | null;
    matchedZoneId?: string | null;
  }) {
    super(input.rejectionCode, 400, EDUCLOCK_GPS_MESSAGES[input.rejectionCode]);
    this.rejectionCode = input.rejectionCode;
    this.nearestEntranceId = input.nearestEntranceId ?? null;
    this.distanceMetres =
      input.distanceMetres == null ? null : roundDistanceMetresForStorage(input.distanceMetres);
    this.latitude = input.latitude ?? null;
    this.longitude = input.longitude ?? null;
    this.accuracyMetres = input.accuracyMetres ?? null;
    this.deviceMetadata = input.deviceMetadata ?? null;
    this.matchedZoneId = input.matchedZoneId ?? null;
  }
}

export type AcceptedGpsValidation = {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  /** Always null under boundary GPS — entrance proximity is not authoritative. */
  matchedEntranceId: string | null;
  /** Active CAMPUS_BOUNDARY zone that matched (inside or edge tolerance). */
  matchedZoneId: string;
  /** Distance to nearest polygon edge when edge tolerance was used; otherwise null. */
  distanceMetresRaw: number | null;
  distanceMetres: number | null;
  validationVersion: EduClockGpsValidationVersion;
  deviceMetadata: Record<string, unknown> | null;
};

type TxClient = Prisma.TransactionClient | PrismaClient;
type LatLng = { latitude: number; longitude: number };

function readOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function buildDeviceMetadata(body: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const meta: Record<string, unknown> = {};
  if (body.capturedAtClient !== undefined && body.capturedAtClient !== null) {
    meta.capturedAtClient = String(body.capturedAtClient).slice(0, 128);
  }
  if (body.permissionState !== undefined && body.permissionState !== null) {
    meta.permissionState = String(body.permissionState).slice(0, 64);
  }
  if (body.locationError !== undefined && body.locationError !== null) {
    meta.locationError = String(body.locationError).slice(0, 128);
  }
  // Never store tokens, passwords, identity numbers.
  return Object.keys(meta).length ? meta : null;
}

function mapClientLocationError(
  body: Record<string, unknown> | undefined
): EduClockGpsRejectionCode | null {
  if (!body || typeof body !== "object") return null;
  const permission = String(body.permissionState || "").trim().toLowerCase();
  const locErr = String(body.locationError || "").trim().toUpperCase();
  if (
    permission === "denied" ||
    locErr === "PERMISSION_DENIED" ||
    locErr === "GPS_PERMISSION_DENIED"
  ) {
    return "GPS_PERMISSION_DENIED";
  }
  if (locErr === "TIMEOUT" || locErr === "GPS_TIMEOUT") {
    return "GPS_TIMEOUT";
  }
  if (
    locErr === "UNAVAILABLE" ||
    locErr === "POSITION_UNAVAILABLE" ||
    locErr === "GPS_UNAVAILABLE"
  ) {
    return "GPS_UNAVAILABLE";
  }
  return null;
}

/**
 * Shortest distance from a point to a polygon ring (metres).
 * Uses local equirectangular projection per edge + clamp to segment endpoints.
 * Does not modify the saved polygon.
 */
export function shortestDistanceToPolygonMetres(point: LatLng, ring: LatLng[]): number {
  if (!ring || ring.length < 2) return Number.POSITIVE_INFINITY;
  const metresPerDegLat = 111_320;
  const metresPerDegLon = 111_320 * Math.cos((point.latitude * Math.PI) / 180);
  const px = 0;
  const py = 0;

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ax = (a.longitude - point.longitude) * metresPerDegLon;
    const ay = (a.latitude - point.latitude) * metresPerDegLat;
    const bx = (b.longitude - point.longitude) * metresPerDegLon;
    const by = (b.latitude - point.latitude) * metresPerDegLat;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLen2 = abx * abx + aby * aby;
    let t = abLen2 > 0 ? (apx * abx + apy * aby) / abLen2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    const d = Math.hypot(cx - px, cy - py);
    if (d < min) min = d;
  }

  // Cross-check endpoints with haversine for numerical safety on tiny campuses.
  for (const v of ring) {
    const d = haversineDistanceMetres(point, v);
    if (d < min) min = d;
  }
  return min;
}

export async function persistGpsRejectionAttempt(
  db: TxClient,
  input: {
    schoolId: string;
    employeeId: string;
    userId: string;
    attemptType: EduClockEventType;
    occurredAtUtc: Date;
    error: EduClockGpsError;
  }
): Promise<void> {
  await db.eduClockGpsAttempt.create({
    data: {
      schoolId: input.schoolId,
      employeeId: input.employeeId,
      userId: input.userId,
      attemptType: input.attemptType,
      occurredAtUtc: input.occurredAtUtc,
      latitude:
        input.error.latitude == null ? null : new Prisma.Decimal(input.error.latitude.toFixed(7)),
      longitude:
        input.error.longitude == null ? null : new Prisma.Decimal(input.error.longitude.toFixed(7)),
      accuracyMetres:
        input.error.accuracyMetres == null
          ? null
          : new Prisma.Decimal(input.error.accuracyMetres.toFixed(2)),
      nearestEntranceId: input.error.nearestEntranceId,
      distanceMetres:
        input.error.distanceMetres == null
          ? null
          : new Prisma.Decimal(input.error.distanceMetres.toFixed(2)),
      rejectionCode: input.error.rejectionCode,
      rejectionReason: input.error.message,
      deviceMetadata: (input.error.deviceMetadata || undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Validate staff GPS for clock-in/out against active campus boundary polygons.
 * Ignores client entranceId / distanceMetres / insideGeofence / matchedEntranceId.
 * Entrance coordinates and radiuses are never loaded or consulted.
 */
export async function validateStaffClockGps(input: {
  db: TxClient;
  schoolId: string;
  body?: Record<string, unknown>;
}): Promise<AcceptedGpsValidation> {
  const body = input.body && typeof input.body === "object" ? input.body : {};
  const deviceMetadata = buildDeviceMetadata(body);

  const early = mapClientLocationError(body);
  if (early) {
    const latEarly = readOptionalNumber(body.latitude);
    const lngEarly = readOptionalNumber(body.longitude);
    const accEarly = readOptionalNumber(body.accuracyMetres);
    throw new EduClockGpsError({
      rejectionCode: early,
      deviceMetadata,
      latitude: latEarly != null && Number.isFinite(latEarly) ? latEarly : null,
      longitude: lngEarly != null && Number.isFinite(lngEarly) ? lngEarly : null,
      accuracyMetres: accEarly != null && Number.isFinite(accEarly) ? accEarly : null,
    });
  }

  const latRaw = body.latitude;
  const lngRaw = body.longitude;
  if (latRaw === undefined || latRaw === null || latRaw === "" || lngRaw === undefined || lngRaw === null || lngRaw === "") {
    throw new EduClockGpsError({
      rejectionCode: "GPS_COORDINATES_MISSING",
      deviceMetadata,
    });
  }

  const latitude = readOptionalNumber(latRaw);
  const longitude = readOptionalNumber(lngRaw);
  if (
    latitude == null ||
    longitude == null ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    !isValidLatitude(latitude) ||
    !isValidLongitude(longitude)
  ) {
    throw new EduClockGpsError({
      rejectionCode: "GPS_COORDINATES_INVALID",
      deviceMetadata,
      latitude: Number.isFinite(latitude as number) ? (latitude as number) : null,
      longitude: Number.isFinite(longitude as number) ? (longitude as number) : null,
    });
  }

  if (body.accuracyMetres === undefined || body.accuracyMetres === null || body.accuracyMetres === "") {
    throw new EduClockGpsError({
      rejectionCode: "GPS_ACCURACY_MISSING",
      deviceMetadata,
      latitude,
      longitude,
    });
  }

  const accuracyMetres = readOptionalNumber(body.accuracyMetres);
  if (accuracyMetres == null || Number.isNaN(accuracyMetres) || !Number.isFinite(accuracyMetres) || accuracyMetres <= 0) {
    throw new EduClockGpsError({
      rejectionCode: "GPS_ACCURACY_INVALID",
      deviceMetadata,
      latitude,
      longitude,
      accuracyMetres: Number.isFinite(accuracyMetres as number) ? (accuracyMetres as number) : null,
    });
  }

  if (accuracyMetres > EDUCLOCK_GPS_MAX_ACCURACY_METRES) {
    throw new EduClockGpsError({
      rejectionCode: "GPS_ACCURACY_TOO_LOW",
      deviceMetadata,
      latitude,
      longitude,
      accuracyMetres,
    });
  }

  const zones = await input.db.geofenceZone.findMany({
    where: {
      schoolId: input.schoolId,
      type: "CAMPUS_BOUNDARY",
      active: true,
      campusId: { not: null },
      campus: { isActive: true },
    },
    select: {
      id: true,
      vertices: {
        orderBy: { sequence: "asc" },
        select: { latitude: true, longitude: true },
      },
    },
    orderBy: { id: "asc" },
  });

  const usableZones: Array<{ id: string; ring: LatLng[] }> = [];
  for (const zone of zones) {
    const ring = zone.vertices
      .map((v) => ({ latitude: Number(v.latitude), longitude: Number(v.longitude) }))
      .filter((p) => isValidLatitude(p.latitude) && isValidLongitude(p.longitude));
    if (ring.length >= 3) {
      usableZones.push({ id: zone.id, ring });
    }
  }

  if (usableZones.length === 0) {
    throw new EduClockGpsError({
      rejectionCode: "NO_ACTIVE_BOUNDARY",
      deviceMetadata,
      latitude,
      longitude,
      accuracyMetres,
    });
  }

  const point = { latitude, longitude };

  // Prefer a strict inside match (lowest zone id order already applied).
  for (const zone of usableZones) {
    if (isPointInsidePolygon(point, zone.ring)) {
      const metaWithZone: Record<string, unknown> = {
        ...(deviceMetadata || {}),
        matchedZoneId: zone.id,
        rawInsidePolygon: true,
        edgeToleranceUsed: false,
      };
      return {
        latitude,
        longitude,
        accuracyMetres,
        matchedEntranceId: null,
        matchedZoneId: zone.id,
        distanceMetresRaw: null,
        distanceMetres: null,
        validationVersion: EDUCLOCK_GPS_VALIDATION_VERSION,
        deviceMetadata: metaWithZone,
      };
    }
  }

  // Outside every polygon: apply edge tolerance against the nearest usable boundary.
  let best: { zoneId: string; distanceRaw: number } | null = null;
  for (const zone of usableZones) {
    const distanceRaw = shortestDistanceToPolygonMetres(point, zone.ring);
    if (!best || distanceRaw < best.distanceRaw) {
      best = { zoneId: zone.id, distanceRaw };
    }
  }

  if (
    best &&
    best.distanceRaw <= EDUCLOCK_GPS_BOUNDARY_EDGE_TOLERANCE_METRES &&
    accuracyMetres <= EDUCLOCK_GPS_MAX_ACCURACY_METRES
  ) {
    const distanceRounded = roundDistanceMetresForStorage(best.distanceRaw);
    const metaWithZone: Record<string, unknown> = {
      ...(deviceMetadata || {}),
      matchedZoneId: best.zoneId,
      rawInsidePolygon: false,
      edgeToleranceUsed: true,
      distanceToBoundaryMetres: distanceRounded,
      reportedAccuracyMetres: accuracyMetres,
      edgeToleranceMetres: EDUCLOCK_GPS_BOUNDARY_EDGE_TOLERANCE_METRES,
      edgeToleranceVersion: EDUCLOCK_GPS_EDGE_TOLERANCE_VERSION,
    };
    return {
      latitude,
      longitude,
      accuracyMetres,
      matchedEntranceId: null,
      matchedZoneId: best.zoneId,
      distanceMetresRaw: best.distanceRaw,
      distanceMetres: distanceRounded,
      validationVersion: EDUCLOCK_GPS_VALIDATION_VERSION_EDGE,
      deviceMetadata: metaWithZone,
    };
  }

  throw new EduClockGpsError({
    rejectionCode: "OUTSIDE_GEOFENCE",
    deviceMetadata: {
      ...(deviceMetadata || {}),
      rawInsidePolygon: false,
      edgeToleranceUsed: false,
      distanceToBoundaryMetres:
        best == null ? null : roundDistanceMetresForStorage(best.distanceRaw),
      reportedAccuracyMetres: accuracyMetres,
      edgeToleranceMetres: EDUCLOCK_GPS_BOUNDARY_EDGE_TOLERANCE_METRES,
      edgeToleranceVersion: EDUCLOCK_GPS_EDGE_TOLERANCE_VERSION,
      nearestZoneId: best?.zoneId ?? null,
    },
    latitude,
    longitude,
    accuracyMetres,
    nearestEntranceId: null,
    distanceMetres: best == null ? null : best.distanceRaw,
  });
}
