/**
 * Draw Campus Boundary — client helpers (Phase 2D).
 * Server remains the authority on final save; these mirror backend thresholds for UX.
 *
 * Thresholds (must stay aligned with backend/src/services/geofenceGeometry.ts):
 * - MIN 3 points, MAX 200 points
 * - MIN area 50 m² (reject accidental pin-tap triangles)
 * - MAX segment 5 000 m (extreme jump)
 * - Duplicate consecutive tolerance 2 m
 */

export const GEOFENCE_POLYGON_MIN_VERTICES = 3;
export const GEOFENCE_POLYGON_MAX_VERTICES = 200;
export const GEOFENCE_CORNER_MIN_SEPARATION_METRES = 2;
export const GEOFENCE_POLYGON_MIN_AREA_SQ_METRES = 50;
export const GEOFENCE_POLYGON_MAX_SEGMENT_METRES = 5_000;

export type DrawPoint = {
  id: string;
  latitude: number;
  longitude: number;
};

export type DrawEntranceOverlay = {
  id: string;
  name: string;
  entranceTypeLabel?: string | null;
  latitude: number;
  longitude: number;
  allowedRadiusMetres: number;
  isActive: boolean;
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toLocalMetres(
  origin: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number }
): { x: number; y: number } {
  const metresPerDegLat = 111_320;
  const metresPerDegLon = 111_320 * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (point.longitude - origin.longitude) * metresPerDegLon,
    y: (point.latitude - origin.latitude) * metresPerDegLat,
  };
}

export function polygonAreaSquareMetres(
  points: Array<{ latitude: number; longitude: number }>
): number {
  if (points.length < GEOFENCE_POLYGON_MIN_VERTICES) return 0;
  const origin = points[0];
  const pts = points.map((p) => toLocalMetres(origin, p));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeterMetres(
  points: Array<{ latitude: number; longitude: number }>
): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += haversineMetres(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  return total;
}

function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  const v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  return (
    Math.min(ax, bx) - 1e-9 <= cx &&
    cx <= Math.max(ax, bx) + 1e-9 &&
    Math.min(ay, by) - 1e-9 <= cy &&
    cy <= Math.max(ay, by) + 1e-9
  );
}

function segmentsProperlyIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number }
): boolean {
  const o1 = orientation(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y);
  const o2 = orientation(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y);
  const o3 = orientation(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y);
  const o4 = orientation(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y);
  if (o1 !== o2 && o3 !== o4) {
    const shareEndpoint =
      (Math.abs(a1.x - b1.x) < 1e-9 && Math.abs(a1.y - b1.y) < 1e-9) ||
      (Math.abs(a1.x - b2.x) < 1e-9 && Math.abs(a1.y - b2.y) < 1e-9) ||
      (Math.abs(a2.x - b1.x) < 1e-9 && Math.abs(a2.y - b1.y) < 1e-9) ||
      (Math.abs(a2.x - b2.x) < 1e-9 && Math.abs(a2.y - b2.y) < 1e-9);
    if (shareEndpoint) return false;
    return true;
  }
  if (o1 === 0 && onSegment(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y)) return true;
  if (o2 === 0 && onSegment(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y)) return true;
  if (o3 === 0 && onSegment(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y)) return true;
  if (o4 === 0 && onSegment(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y)) return true;
  return false;
}

export function isPolygonSelfIntersecting(
  points: Array<{ latitude: number; longitude: number }>
): boolean {
  if (points.length < 4) return false;
  const origin = points[0];
  const pts = points.map((p) => toLocalMetres(origin, p));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      if (segmentsProperlyIntersect(a1, a2, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function isPointInsidePolygon(
  point: { latitude: number; longitude: number },
  ring: Array<{ latitude: number; longitude: number }>
): boolean {
  if (!ring || ring.length < GEOFENCE_POLYGON_MIN_VERTICES) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude;
    const yi = ring[i].latitude;
    const xj = ring[j].longitude;
    const yj = ring[j].latitude;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function validateDrawnPolygon(
  points: Array<{ latitude: number; longitude: number }>
): { ok: true } | { ok: false; error: string; code: string } {
  if (points.length < GEOFENCE_POLYGON_MIN_VERTICES) {
    return {
      ok: false,
      code: "TOO_FEW_VERTICES",
      error: `Add at least ${GEOFENCE_POLYGON_MIN_VERTICES} points before finishing.`,
    };
  }
  if (points.length > GEOFENCE_POLYGON_MAX_VERTICES) {
    return {
      ok: false,
      code: "TOO_MANY_VERTICES",
      error: `A campus boundary may have at most ${GEOFENCE_POLYGON_MAX_VERTICES} points.`,
    };
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90) {
      return { ok: false, code: "INVALID_COORDINATE", error: `Point ${i + 1} has an invalid latitude.` };
    }
    if (!Number.isFinite(p.longitude) || p.longitude < -180 || p.longitude > 180) {
      return { ok: false, code: "INVALID_COORDINATE", error: `Point ${i + 1} has an invalid longitude.` };
    }
    if (i > 0) {
      const prev = points[i - 1];
      const dist = haversineMetres(prev.latitude, prev.longitude, p.latitude, p.longitude);
      if (dist < GEOFENCE_CORNER_MIN_SEPARATION_METRES) {
        return {
          ok: false,
          code: "DUPLICATE_NEARBY_VERTEX",
          error: `Point ${i + 1} is too close to point ${i}. Move it further apart.`,
        };
      }
      if (dist > GEOFENCE_POLYGON_MAX_SEGMENT_METRES) {
        return {
          ok: false,
          code: "SEGMENT_TOO_LONG",
          error: `Point ${i + 1} is unrealistically far from point ${i}.`,
        };
      }
    }
  }
  if (isPolygonSelfIntersecting(points)) {
    return {
      ok: false,
      code: "SELF_INTERSECTING",
      error:
        "This boundary crosses itself. Edit the points so edges do not cross. EduClock will not auto-correct the shape.",
    };
  }
  const area = polygonAreaSquareMetres(points);
  if (!(area > 0) || area < GEOFENCE_POLYGON_MIN_AREA_SQ_METRES) {
    return {
      ok: false,
      code: "AREA_TOO_SMALL",
      error: `Boundary area is too small (${area.toFixed(0)} m²). Draw a larger outline of the school property.`,
    };
  }
  return { ok: true };
}

export function collectShapeWarnings(
  points: Array<{ latitude: number; longitude: number }>
): string[] {
  const warnings: string[] = [];
  if (points.length >= GEOFENCE_POLYGON_MIN_VERTICES && isPolygonSelfIntersecting(points)) {
    warnings.push("Shape crosses itself — fix before saving.");
  }
  const area = polygonAreaSquareMetres(points);
  if (points.length >= GEOFENCE_POLYGON_MIN_VERTICES && area > 0 && area < 200) {
    warnings.push("Area looks unusually small for a school campus — double-check the outline.");
  }
  if (points.length > 80) {
    warnings.push("Many points — consider simplifying if the outline is noisy.");
  }
  return warnings;
}

export function classifyEntrancesAgainstBoundary(
  points: Array<{ latitude: number; longitude: number }>,
  entrances: DrawEntranceOverlay[]
): {
  inside: DrawEntranceOverlay[];
  outside: DrawEntranceOverlay[];
  unknown: DrawEntranceOverlay[];
} {
  if (points.length < GEOFENCE_POLYGON_MIN_VERTICES) {
    return { inside: [], outside: [], unknown: entrances };
  }
  const inside: DrawEntranceOverlay[] = [];
  const outside: DrawEntranceOverlay[] = [];
  for (const e of entrances) {
    if (isPointInsidePolygon({ latitude: e.latitude, longitude: e.longitude }, points)) {
      inside.push(e);
    } else {
      outside.push(e);
    }
  }
  return { inside, outside, unknown: [] };
}

export function formatAreaLabel(areaSqM: number): string {
  if (!Number.isFinite(areaSqM) || areaSqM <= 0) return "—";
  if (areaSqM >= 10_000) return `${(areaSqM / 10_000).toFixed(2)} ha`;
  return `${Math.round(areaSqM).toLocaleString()} m²`;
}

export function formatPerimeterLabel(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return "—";
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${Math.round(metres).toLocaleString()} m`;
}

export function newDrawPointId(): string {
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Near enough to first point to treat tap as “close polygon” (metres). */
export const GEOFENCE_CLOSE_TO_START_METRES = 12;
