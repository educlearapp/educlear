/**
 * Geofence Engine — polygon validation feature flag.
 *
 * Clock-in / clock-out MUST continue using entrance-point GPS only until an owner
 * explicitly approves enabling polygon validation.
 *
 * Default: disabled. Set GEOFENCE_POLYGON_VALIDATION_ENABLED=true to enable later.
 */
export function isGeofencePolygonValidationEnabled(): boolean {
  const raw = String(process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
