/**
 * EduClock Build 4 — GPS entrance validation (backend authority).
 * Does not create clock events; callers persist accepted GPS fields or rejected attempts.
 */
import { EduClockEventType, Prisma, type PrismaClient } from "@prisma/client";

import {
  haversineDistanceMetres,
  isValidLatitude,
  isValidLongitude,
  roundDistanceMetresForStorage,
} from "../utils/educlockGpsDistance";
import { EduClockError } from "./educlockService";

export const EDUCLOCK_GPS_VALIDATION_VERSION = "gps-entrance-v1";
export const EDUCLOCK_GPS_MAX_ACCURACY_METRES = 20;
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
  | "NO_ACTIVE_ENTRANCE"
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

  constructor(input: {
    rejectionCode: EduClockGpsRejectionCode;
    nearestEntranceId?: string | null;
    distanceMetres?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracyMetres?: number | null;
    deviceMetadata?: Record<string, unknown> | null;
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
  }
}

export type AcceptedGpsValidation = {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  matchedEntranceId: string;
  /** Full-precision metres used for the inside/outside decision. */
  distanceMetresRaw: number;
  /** Rounded to 2 dp for persistence. */
  distanceMetres: number;
  validationVersion: typeof EDUCLOCK_GPS_VALIDATION_VERSION;
  deviceMetadata: Record<string, unknown> | null;
};

type TxClient = Prisma.TransactionClient | PrismaClient;

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
 * Validate staff GPS for clock-in/out.
 * Ignores client entranceId / distanceMetres / insideGeofence / matchedEntranceId.
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

  const entrances = await input.db.eduClockEntrance.findMany({
    where: {
      schoolId: input.schoolId,
      isActive: true,
      latitude: { not: null },
      longitude: { not: null },
      campus: { isActive: true },
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      allowedRadiusMetres: true,
    },
    orderBy: { id: "asc" },
  });

  if (entrances.length === 0) {
    throw new EduClockGpsError({
      rejectionCode: "NO_ACTIVE_ENTRANCE",
      deviceMetadata,
      latitude,
      longitude,
      accuracyMetres,
    });
  }

  type Ranked = {
    id: string;
    distanceRaw: number;
    allowedRadiusMetres: number;
  };

  const ranked: Ranked[] = [];
  for (const entrance of entrances) {
    const eLat = Number(entrance.latitude);
    const eLng = Number(entrance.longitude);
    if (!isValidLatitude(eLat) || !isValidLongitude(eLng)) continue;
    const distanceRaw = haversineDistanceMetres(
      { latitude, longitude },
      { latitude: eLat, longitude: eLng }
    );
    let radius = entrance.allowedRadiusMetres;
    if (!Number.isFinite(radius)) radius = EDUCLOCK_GPS_DEFAULT_RADIUS_METRES;
    radius = Math.min(
      EDUCLOCK_GPS_MAX_RADIUS_METRES,
      Math.max(EDUCLOCK_GPS_MIN_RADIUS_METRES, Math.floor(radius))
    );
    ranked.push({ id: entrance.id, distanceRaw, allowedRadiusMetres: radius });
  }

  if (ranked.length === 0) {
    throw new EduClockGpsError({
      rejectionCode: "NO_ACTIVE_ENTRANCE",
      deviceMetadata,
      latitude,
      longitude,
      accuracyMetres,
    });
  }

  ranked.sort((a, b) => {
    if (a.distanceRaw !== b.distanceRaw) return a.distanceRaw - b.distanceRaw;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const nearest = ranked[0];
  // Full-precision compare — do not round before inside/outside.
  if (nearest.distanceRaw > nearest.allowedRadiusMetres) {
    throw new EduClockGpsError({
      rejectionCode: "OUTSIDE_GEOFENCE",
      deviceMetadata,
      latitude,
      longitude,
      accuracyMetres,
      nearestEntranceId: nearest.id,
      distanceMetres: nearest.distanceRaw,
    });
  }

  return {
    latitude,
    longitude,
    accuracyMetres,
    matchedEntranceId: nearest.id,
    distanceMetresRaw: nearest.distanceRaw,
    distanceMetres: roundDistanceMetresForStorage(nearest.distanceRaw),
    validationVersion: EDUCLOCK_GPS_VALIDATION_VERSION,
    deviceMetadata,
  };
}
