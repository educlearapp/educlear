/**
 * EduClock Build 4 Checkpoint 4 — entrance GPS readiness helpers (shared rules).
 * Campus toleranceMetres is NOT used for clock validation.
 */
export const EDUCLOCK_ENTRANCE_RADIUS_DEFAULT = 5;
export const EDUCLOCK_ENTRANCE_RADIUS_MIN = 1;
export const EDUCLOCK_ENTRANCE_RADIUS_MAX = 25;
export const EDUCLOCK_ENTRANCE_NAME_MAX = 80;

export type EntranceGpsReadinessCode =
  | "READY"
  | "MISSING_COORDINATES"
  | "INVALID_RADIUS"
  | "INACTIVE_ENTRANCE"
  | "INACTIVE_CAMPUS";

export const ENTRANCE_GPS_READINESS_LABELS: Record<EntranceGpsReadinessCode, string> = {
  READY: "READY",
  MISSING_COORDINATES: "Missing coordinates",
  INVALID_RADIUS: "Invalid radius",
  INACTIVE_ENTRANCE: "Inactive entrance",
  INACTIVE_CAMPUS: "Inactive campus",
};

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function evaluateEntranceGpsReadiness(input: {
  entranceIsActive: boolean;
  campusIsActive: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMetres: number;
}): { gpsReady: boolean; code: EntranceGpsReadinessCode; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.campusIsActive) reasons.push(ENTRANCE_GPS_READINESS_LABELS.INACTIVE_CAMPUS);
  if (!input.entranceIsActive) reasons.push(ENTRANCE_GPS_READINESS_LABELS.INACTIVE_ENTRANCE);
  if (
    input.latitude == null ||
    input.longitude == null ||
    !isValidLatitude(input.latitude) ||
    !isValidLongitude(input.longitude)
  ) {
    reasons.push(ENTRANCE_GPS_READINESS_LABELS.MISSING_COORDINATES);
  }
  if (
    !Number.isFinite(input.allowedRadiusMetres) ||
    input.allowedRadiusMetres < EDUCLOCK_ENTRANCE_RADIUS_MIN ||
    input.allowedRadiusMetres > EDUCLOCK_ENTRANCE_RADIUS_MAX
  ) {
    reasons.push(ENTRANCE_GPS_READINESS_LABELS.INVALID_RADIUS);
  }

  if (reasons.length === 0) {
    return { gpsReady: true, code: "READY", reasons: ["Active", "Coordinates configured", "Radius configured"] };
  }

  let code: EntranceGpsReadinessCode = "MISSING_COORDINATES";
  if (reasons.includes(ENTRANCE_GPS_READINESS_LABELS.INACTIVE_CAMPUS)) code = "INACTIVE_CAMPUS";
  else if (reasons.includes(ENTRANCE_GPS_READINESS_LABELS.INACTIVE_ENTRANCE)) code = "INACTIVE_ENTRANCE";
  else if (reasons.includes(ENTRANCE_GPS_READINESS_LABELS.INVALID_RADIUS)) code = "INVALID_RADIUS";
  else code = "MISSING_COORDINATES";

  return { gpsReady: false, code, reasons };
}
