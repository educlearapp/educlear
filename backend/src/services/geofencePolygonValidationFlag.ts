/**
 * Geofence Engine — polygon validation feature flag (legacy env toggle).
 *
 * Staff CLOCK_IN / CLOCK_OUT now always validate against active campus boundary
 * polygons (see educlockGpsValidation.ts / gps-boundary-v1). This helper remains
 * for owner simulation / status APIs that still surface the env flag.
 *
 * Default: disabled env flag. Clock authority does not consult this flag.
 */
export function isGeofencePolygonValidationEnabled(): boolean {
  const raw = String(process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
