/**
 * Shared Geofence Engine — geometry helpers (no product-specific clock logic).
 *
 * Validation is capture-method specific (Phase 2D correction):
 *
 * DRAW_ON_MAP (`validateDrawnBoundaryGeometry`):
 * - min 3 / max 200 points
 * - duplicate consecutive tolerance 2 m
 * - minimum area 50 m²
 * - maximum segment 5 000 m
 * - self-intersection blocked
 * - payload size guard
 * - valid lat/lng ranges
 *
 * SAVE_EACH_CORNER (`validateSavedCornerBoundaryGeometry`):
 * - preserves pre–Phase 2D accepted behaviour
 * - min 3 points, valid lat/lng, consecutive near-duplicate rejection (2 m)
 * - self-intersection blocked (safety; does not change normal corner walks)
 * - payload size guard (security)
 * - does NOT apply 50 m² minimum area
 * - does NOT apply 5 000 m max-segment usability rule
 *
 * Prefer the named profile functions. `validatePolygonVertices` remains as a
 * DRAW_ON_MAP alias for callers that intentionally want the draw profile.
 */
import {
  haversineDistanceMetres,
  isValidLatitude,
  isValidLongitude,
} from "../utils/educlockGpsDistance";
import type { GeofenceCaptureMethod } from "./geofenceCaptureMethods";

export const GEOFENCE_POLYGON_MIN_VERTICES = 3;
export const GEOFENCE_POLYGON_MAX_VERTICES = 200;
/** Soft accuracy warning threshold for owner corner capture (does not block save). */
export const GEOFENCE_CORNER_ACCURACY_WARN_METRES = 20;
/** Reject a new corner if within this distance of the previous corner (metres). */
export const GEOFENCE_CORNER_MIN_SEPARATION_METRES = 2;
/** DRAW_ON_MAP only — reject accidental pin-tap triangles (~7×7 m). */
export const GEOFENCE_POLYGON_MIN_AREA_SQ_METRES = 50;
/** DRAW_ON_MAP only — extreme consecutive-segment jump. */
export const GEOFENCE_POLYGON_MAX_SEGMENT_METRES = 5_000;
/** Shared security guard on vertex JSON size (both capture methods). */
export const GEOFENCE_POLYGON_MAX_PAYLOAD_JSON_CHARS = 200_000;

export type GeofenceLatLng = {
  latitude: number;
  longitude: number;
  accuracyMetres?: number | null;
  capturedAt?: string | Date | null;
};

export type GeofenceGeometryValidationError = {
  code:
    | "TOO_FEW_VERTICES"
    | "TOO_MANY_VERTICES"
    | "INVALID_COORDINATE"
    | "DUPLICATE_NEARBY_VERTEX"
    | "SELF_INTERSECTING"
    | "AREA_TOO_SMALL"
    | "SEGMENT_TOO_LONG"
    | "PAYLOAD_TOO_LARGE"
    | "EMPTY_NAME"
    | "UNSUPPORTED_TYPE"
    | "UNSUPPORTED_CAPTURE_METHOD";
  message: string;
};

export function validateLatLng(point: { latitude: number; longitude: number }): string | null {
  if (!Number.isFinite(point.latitude) || !isValidLatitude(point.latitude)) {
    return "Latitude must be a number between -90 and 90.";
  }
  if (!Number.isFinite(point.longitude) || !isValidLongitude(point.longitude)) {
    return "Longitude must be a number between -180 and 180.";
  }
  return null;
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

/** Absolute polygon area in square metres (planar equirectangular shoelace). */
export function polygonAreaSquareMetres(vertices: GeofenceLatLng[]): number {
  if (!Array.isArray(vertices) || vertices.length < GEOFENCE_POLYGON_MIN_VERTICES) return 0;
  const origin = vertices[0];
  const pts = vertices.map((v) => toLocalMetres(origin, v));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Perimeter in metres including closing edge back to the first point. */
export function polygonPerimeterMetres(vertices: GeofenceLatLng[]): number {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    total += haversineDistanceMetres(
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: b.latitude, longitude: b.longitude }
    );
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

/**
 * Detect self-intersecting polygon rings (including closing edge).
 * Does not silently repair — caller must ask the owner to fix the shape.
 */
export function isPolygonSelfIntersecting(vertices: GeofenceLatLng[]): boolean {
  if (!Array.isArray(vertices) || vertices.length < 4) return false;
  const origin = vertices[0];
  const pts = vertices.map((v) => toLocalMetres(origin, v));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function validateSharedBaseGeometry(
  vertices: GeofenceLatLng[],
  options: { enforceMaxVertices: boolean }
): GeofenceGeometryValidationError | null {
  if (!Array.isArray(vertices) || vertices.length < GEOFENCE_POLYGON_MIN_VERTICES) {
    return {
      code: "TOO_FEW_VERTICES",
      message: `A polygon boundary requires at least ${GEOFENCE_POLYGON_MIN_VERTICES} corners.`,
    };
  }

  if (options.enforceMaxVertices && vertices.length > GEOFENCE_POLYGON_MAX_VERTICES) {
    return {
      code: "TOO_MANY_VERTICES",
      message: `A campus boundary may have at most ${GEOFENCE_POLYGON_MAX_VERTICES} points. Simplify the shape and try again.`,
    };
  }

  const payloadChars = JSON.stringify(vertices).length;
  if (payloadChars > GEOFENCE_POLYGON_MAX_PAYLOAD_JSON_CHARS) {
    return {
      code: "PAYLOAD_TOO_LARGE",
      message: "Boundary payload is too large. Reduce the number of points and try again.",
    };
  }

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const coordError = validateLatLng(v);
    if (coordError) {
      return { code: "INVALID_COORDINATE", message: `Corner ${i + 1}: ${coordError}` };
    }
    if (i > 0) {
      const prev = vertices[i - 1];
      const dist = haversineDistanceMetres(
        { latitude: prev.latitude, longitude: prev.longitude },
        { latitude: v.latitude, longitude: v.longitude }
      );
      if (dist < GEOFENCE_CORNER_MIN_SEPARATION_METRES) {
        return {
          code: "DUPLICATE_NEARBY_VERTEX",
          message: `Corner ${i + 1} is too close to corner ${i} (within ${GEOFENCE_CORNER_MIN_SEPARATION_METRES} m). Move further and try again.`,
        };
      }
    }
  }

  if (isPolygonSelfIntersecting(vertices)) {
    return {
      code: "SELF_INTERSECTING",
      message:
        "This boundary crosses itself. Edit the points so edges do not cross, then try again. EduClock will not auto-correct the shape.",
    };
  }

  return null;
}

/**
 * DRAW_ON_MAP validation profile — full Phase 2D usability + safety rules.
 */
export function validateDrawnBoundaryGeometry(
  vertices: GeofenceLatLng[]
): GeofenceGeometryValidationError | null {
  const base = validateSharedBaseGeometry(vertices, { enforceMaxVertices: true });
  if (base) return base;

  for (let i = 1; i < vertices.length; i++) {
    const prev = vertices[i - 1];
    const v = vertices[i];
    const dist = haversineDistanceMetres(
      { latitude: prev.latitude, longitude: prev.longitude },
      { latitude: v.latitude, longitude: v.longitude }
    );
    if (dist > GEOFENCE_POLYGON_MAX_SEGMENT_METRES) {
      return {
        code: "SEGMENT_TOO_LONG",
        message: `Corner ${i + 1} is unrealistically far from corner ${i} (${Math.round(dist)} m). Check the shape and try again.`,
      };
    }
  }

  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const closeDist = haversineDistanceMetres(
    { latitude: last.latitude, longitude: last.longitude },
    { latitude: first.latitude, longitude: first.longitude }
  );
  if (closeDist > GEOFENCE_POLYGON_MAX_SEGMENT_METRES) {
    return {
      code: "SEGMENT_TOO_LONG",
      message: `Closing the polygon would create an unrealistically long edge (${Math.round(closeDist)} m). Adjust the first or last point.`,
    };
  }

  const area = polygonAreaSquareMetres(vertices);
  if (!(area > 0) || area < GEOFENCE_POLYGON_MIN_AREA_SQ_METRES) {
    return {
      code: "AREA_TOO_SMALL",
      message: `Campus boundary area is too small (${area.toFixed(1)} m²). Draw a larger outline of the school property.`,
    };
  }

  return null;
}

/**
 * SAVE_EACH_CORNER validation profile — preserves accepted GPS corner behaviour.
 * No 50 m² minimum area and no 5 000 m max-segment usability rule.
 */
export function validateSavedCornerBoundaryGeometry(
  vertices: GeofenceLatLng[]
): GeofenceGeometryValidationError | null {
  // Max vertex count kept as a shared payload safety ceiling (not a draw-shape usability rule).
  return validateSharedBaseGeometry(vertices, { enforceMaxVertices: true });
}

/**
 * Dispatch geometry validation by approved capture method.
 */
export function validateBoundaryGeometryForCaptureMethod(
  captureMethod: GeofenceCaptureMethod,
  vertices: GeofenceLatLng[]
): GeofenceGeometryValidationError | null {
  if (captureMethod === "DRAW_ON_MAP") {
    return validateDrawnBoundaryGeometry(vertices);
  }
  return validateSavedCornerBoundaryGeometry(vertices);
}

/**
 * @deprecated Prefer `validateDrawnBoundaryGeometry` or `validateSavedCornerBoundaryGeometry`.
 * Kept as DRAW_ON_MAP alias so older call sites that meant “strict polygon” stay explicit.
 */
export function validatePolygonVertices(
  vertices: GeofenceLatLng[]
): GeofenceGeometryValidationError | null {
  return validateDrawnBoundaryGeometry(vertices);
}

/** Build GeoJSON Polygon from ordered vertices (closes ring if needed). */
export function buildGeoJsonPolygon(vertices: GeofenceLatLng[]): {
  type: "Polygon";
  coordinates: number[][][];
} {
  const ring = vertices.map((v) => [v.longitude, v.latitude]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export function isAccuracyWarning(accuracyMetres: number | null | undefined): boolean {
  if (accuracyMetres == null || !Number.isFinite(accuracyMetres)) return true;
  return accuracyMetres > GEOFENCE_CORNER_ACCURACY_WARN_METRES;
}

/**
 * Ray-casting point-in-polygon (lat/lng treated as planar for small campus polygons).
 * Ring may be open or closed. Returns false for degenerate polygons.
 * Used by staff clock GPS (gps-boundary-v1) and owner advisory containment checks.
 */
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

export type CampusBoundaryContainment =
  | { status: "NO_BOUNDARY" }
  | { status: "INSIDE"; zoneId: string }
  | { status: "OUTSIDE"; zoneId: string };
