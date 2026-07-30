/**
 * EduClock Build 4 Checkpoint 4 — Owner Geofences UI helpers (no storage writes).
 */
export const ENTRANCE_RADIUS_DEFAULT = 5;
export const ENTRANCE_RADIUS_MIN = 1;
export const ENTRANCE_RADIUS_MAX = 25;
export const ENTRANCE_NAME_MAX = 80;

export type EntranceGpsReadyState = {
  gpsReady: boolean;
  label: "READY" | "NOT READY";
  reasons: string[];
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
}): EntranceGpsReadyState {
  const reasons: string[] = [];
  if (!input.campusIsActive) reasons.push("Inactive campus");
  if (!input.entranceIsActive) reasons.push("Inactive entrance");
  if (
    input.latitude == null ||
    input.longitude == null ||
    !isValidLatitude(input.latitude) ||
    !isValidLongitude(input.longitude)
  ) {
    reasons.push("Missing coordinates");
  }
  if (
    !Number.isFinite(input.allowedRadiusMetres) ||
    input.allowedRadiusMetres < ENTRANCE_RADIUS_MIN ||
    input.allowedRadiusMetres > ENTRANCE_RADIUS_MAX
  ) {
    reasons.push("Invalid radius");
  }
  if (reasons.length === 0) {
    return {
      gpsReady: true,
      label: "READY",
      reasons: ["Active", "Coordinates configured", "Radius configured"],
    };
  }
  return { gpsReady: false, label: "NOT READY", reasons };
}

export function validateEntranceForm(input: {
  name: string;
  latitude: string;
  longitude: string;
  allowedRadiusMetres: string;
  requireCoordinates: boolean;
}): { ok: true } | { ok: false; error: string } {
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, error: "Entrance name is required." };
  if (name.length > ENTRANCE_NAME_MAX) {
    return { ok: false, error: `Entrance name must be at most ${ENTRANCE_NAME_MAX} characters.` };
  }

  const latRaw = String(input.latitude || "").trim();
  const lngRaw = String(input.longitude || "").trim();
  const radiusRaw = String(input.allowedRadiusMetres || "").trim();

  if (input.requireCoordinates || latRaw || lngRaw) {
    if (!latRaw || !lngRaw) {
      return { ok: false, error: "Latitude and longitude are both required for GPS-ready entrances." };
    }
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!isValidLatitude(lat)) return { ok: false, error: "Latitude must be a number between -90 and 90." };
    if (!isValidLongitude(lng)) return { ok: false, error: "Longitude must be a number between -180 and 180." };
  }

  if (!radiusRaw) return { ok: false, error: "Entrance radius is required (1–25 metres)." };
  const radius = Number(radiusRaw);
  if (!Number.isFinite(radius) || !Number.isInteger(radius)) {
    return { ok: false, error: "Entrance radius must be a whole number between 1 and 25." };
  }
  if (radius < ENTRANCE_RADIUS_MIN || radius > ENTRANCE_RADIUS_MAX) {
    return { ok: false, error: "Entrance radius must be between 1 and 25 metres." };
  }

  return { ok: true };
}

export function summariseGeofences(
  campuses: Array<{
    isActive: boolean;
    entrances?: Array<{
      isActive: boolean;
      latitude: number | null;
      longitude: number | null;
      allowedRadiusMetres?: number;
      gpsReady?: boolean;
    }>;
  }>
) {
  const totalCampuses = campuses.length;
  const activeCampuses = campuses.filter((c) => c.isActive).length;
  let totalEntrances = 0;
  let gpsReadyEntrances = 0;
  for (const campus of campuses) {
    for (const e of campus.entrances || []) {
      totalEntrances += 1;
      const ready =
        typeof e.gpsReady === "boolean"
          ? e.gpsReady
          : evaluateEntranceGpsReadiness({
              entranceIsActive: e.isActive,
              campusIsActive: campus.isActive,
              latitude: e.latitude,
              longitude: e.longitude,
              allowedRadiusMetres: e.allowedRadiusMetres ?? ENTRANCE_RADIUS_DEFAULT,
            }).gpsReady;
      if (ready) gpsReadyEntrances += 1;
    }
  }
  return {
    totalCampuses,
    activeCampuses,
    totalEntrances,
    gpsReadyEntrances,
    notReadyEntrances: totalEntrances - gpsReadyEntrances,
  };
}
