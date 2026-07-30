/**
 * Approved campus-boundary capture methods (Geofence Engine).
 * Stored as strings in GeofenceZone.metadata — no Prisma enum required.
 */

export const GEOFENCE_CAPTURE_METHODS = ["SAVE_EACH_CORNER", "DRAW_ON_MAP"] as const;

export type GeofenceCaptureMethod = (typeof GEOFENCE_CAPTURE_METHODS)[number];

export const GEOFENCE_CAPTURE_METHOD_SOURCE: Record<GeofenceCaptureMethod, string> = {
  SAVE_EACH_CORNER: "educlock_save_each_corner",
  DRAW_ON_MAP: "educlock_draw_on_map",
};

export function parseGeofenceCaptureMethod(
  raw: unknown,
  fallback: GeofenceCaptureMethod = "SAVE_EACH_CORNER"
): GeofenceCaptureMethod {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if ((GEOFENCE_CAPTURE_METHODS as readonly string[]).includes(value)) {
    return value as GeofenceCaptureMethod;
  }
  return fallback;
}

export function isApprovedGeofenceCaptureMethod(raw: unknown): raw is GeofenceCaptureMethod {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  return (GEOFENCE_CAPTURE_METHODS as readonly string[]).includes(value);
}
