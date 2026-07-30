/**
 * EduClock Build 4 — geodesic distance (Haversine) in metres.
 * Backend-only; never trust client-calculated distance.
 */
export const EARTH_RADIUS_METRES = 6_371_000;

export type LatLng = {
  latitude: number;
  longitude: number;
};

export function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in metres (Haversine).
 * Returns full-precision metres — do not round before inside/outside decisions.
 */
export function haversineDistanceMetres(a: LatLng, b: LatLng): number {
  const lat1 = assertFiniteNumber(a.latitude, "latitude");
  const lon1 = assertFiniteNumber(a.longitude, "longitude");
  const lat2 = assertFiniteNumber(b.latitude, "latitude");
  const lon2 = assertFiniteNumber(b.longitude, "longitude");

  if (!isValidLatitude(lat1) || !isValidLatitude(lat2)) {
    throw new Error("latitude out of range");
  }
  if (!isValidLongitude(lon1) || !isValidLongitude(lon2)) {
    throw new Error("longitude out of range");
  }

  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const metres = EARTH_RADIUS_METRES * c;

  if (!Number.isFinite(metres) || metres < 0) {
    throw new Error("distance calculation failed");
  }
  return metres;
}

/** Persist distance at 2 decimal places (after validation decision). */
export function roundDistanceMetresForStorage(metres: number): number {
  const n = assertFiniteNumber(metres, "distanceMetres");
  return Math.round(n * 100) / 100;
}
