/**
 * Geofence Engine geometry unit tests (no DB).
 * Run via esbuild bundle (tests excluded from tsconfig).
 */
import assert from "node:assert/strict";

import {
  GEOFENCE_POLYGON_MIN_AREA_SQ_METRES,
  GEOFENCE_POLYGON_MIN_VERTICES,
  buildGeoJsonPolygon,
  isAccuracyWarning,
  isPointInsidePolygon,
  isPolygonSelfIntersecting,
  polygonAreaSquareMetres,
  validateBoundaryGeometryForCaptureMethod,
  validateDrawnBoundaryGeometry,
  validatePolygonVertices,
  validateSavedCornerBoundaryGeometry,
} from "./geofenceGeometry";
import { isGeofencePolygonValidationEnabled } from "./geofencePolygonValidationFlag";
import {
  parseGeofenceCaptureMethod,
  isApprovedGeofenceCaptureMethod,
} from "./geofenceCaptureMethods";

function main() {
  assert.equal(GEOFENCE_POLYGON_MIN_VERTICES, 3);
  assert.equal(GEOFENCE_POLYGON_MIN_AREA_SQ_METRES, 50);

  // Both profiles: too few points
  assert.equal(
    validateDrawnBoundaryGeometry([
      { latitude: -26.1, longitude: 28.0 },
      { latitude: -26.1, longitude: 28.01 },
    ])?.code,
    "TOO_FEW_VERTICES"
  );
  assert.equal(
    validateSavedCornerBoundaryGeometry([
      { latitude: -26.1, longitude: 28.0 },
      { latitude: -26.1, longitude: 28.01 },
    ])?.code,
    "TOO_FEW_VERTICES"
  );

  // Both profiles: invalid coordinates
  assert.equal(
    validateDrawnBoundaryGeometry([
      { latitude: 999, longitude: 28.0 },
      { latitude: -26.1, longitude: 28.01 },
      { latitude: -26.11, longitude: 28.01 },
    ])?.code,
    "INVALID_COORDINATE"
  );
  assert.equal(
    validateSavedCornerBoundaryGeometry([
      { latitude: -26.1, longitude: 999 },
      { latitude: -26.1, longitude: 28.01 },
      { latitude: -26.11, longitude: 28.01 },
    ])?.code,
    "INVALID_COORDINATE"
  );

  // Large OK triangle for both
  const largeOk = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.01 },
    { latitude: -26.11, longitude: 28.01 },
  ];
  assert.equal(validateDrawnBoundaryGeometry(largeOk), null);
  assert.equal(validateSavedCornerBoundaryGeometry(largeOk), null);

  // Duplicate consecutive
  const dup = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.000001 },
    { latitude: -26.11, longitude: 28.01 },
  ];
  assert.equal(validateDrawnBoundaryGeometry(dup)?.code, "DUPLICATE_NEARBY_VERTEX");
  assert.equal(validateSavedCornerBoundaryGeometry(dup)?.code, "DUPLICATE_NEARBY_VERTEX");

  // Self-intersect — DRAW rejects; SAVE_EACH_CORNER also rejects (shared safety)
  const bowtie = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.11, longitude: 28.01 },
    { latitude: -26.1, longitude: 28.01 },
    { latitude: -26.11, longitude: 28.0 },
  ];
  assert.equal(isPolygonSelfIntersecting(bowtie), true);
  assert.equal(validateDrawnBoundaryGeometry(bowtie)?.code, "SELF_INTERSECTING");
  assert.equal(validateSavedCornerBoundaryGeometry(bowtie)?.code, "SELF_INTERSECTING");

  /**
   * Small right triangle (~15.5 m²) — below DRAW 50 m² rule, above zero.
   * Legs ≈ 0.00005 deg ≈ 5.566 m at this latitude → area ≈ 0.5 * 5.566 * 5.566 ≈ 15.49 m²
   */
  const smallTriangle = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.00005 },
    { latitude: -26.10005, longitude: 28.00005 },
  ];
  const smallArea = polygonAreaSquareMetres(smallTriangle);
  assert.ok(
    smallArea > 0 && smallArea < GEOFENCE_POLYGON_MIN_AREA_SQ_METRES,
    `expected small area under 50 m², got ${smallArea}`
  );
  // Exact area used in this fixture (reported for checkpoint):
  console.log(`SMALL_POLYGON_AREA_SQ_METRES=${smallArea.toFixed(4)}`);

  assert.equal(
    validateDrawnBoundaryGeometry(smallTriangle)?.code,
    "AREA_TOO_SMALL",
    "DRAW_ON_MAP must reject < 50 m²"
  );
  assert.equal(
    validateSavedCornerBoundaryGeometry(smallTriangle),
    null,
    "SAVE_EACH_CORNER must accept valid small polygon"
  );
  assert.equal(
    validateBoundaryGeometryForCaptureMethod("DRAW_ON_MAP", smallTriangle)?.code,
    "AREA_TOO_SMALL"
  );
  assert.equal(
    validateBoundaryGeometryForCaptureMethod("SAVE_EACH_CORNER", smallTriangle),
    null
  );

  // DRAW max-segment; SAVE_EACH_CORNER must not apply this usability rule
  const longSegment = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.1 }, // ~10 km
    { latitude: -26.2, longitude: 28.1 },
  ];
  assert.equal(validateDrawnBoundaryGeometry(longSegment)?.code, "SEGMENT_TOO_LONG");
  assert.equal(validateSavedCornerBoundaryGeometry(longSegment), null);

  // Deprecated alias = DRAW profile
  assert.equal(validatePolygonVertices(smallTriangle)?.code, "AREA_TOO_SMALL");

  const geo = buildGeoJsonPolygon(largeOk);
  assert.equal(geo.type, "Polygon");
  assert.equal(geo.coordinates[0].length, 4);
  assert.deepEqual(geo.coordinates[0][0], geo.coordinates[0][3]);

  assert.equal(isAccuracyWarning(5), false);
  assert.equal(isAccuracyWarning(25), true);
  assert.equal(isAccuracyWarning(null), true);

  const square = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 },
    { latitude: 1, longitude: 1 },
    { latitude: 1, longitude: 0 },
  ];
  assert.equal(isPointInsidePolygon({ latitude: 0.5, longitude: 0.5 }, square), true);
  assert.equal(isPointInsidePolygon({ latitude: 2, longitude: 2 }, square), false);

  assert.equal(isApprovedGeofenceCaptureMethod("DRAW_ON_MAP"), true);
  assert.equal(isApprovedGeofenceCaptureMethod("WALK_BOUNDARY"), false);
  assert.equal(parseGeofenceCaptureMethod(undefined), "SAVE_EACH_CORNER");
  assert.equal(parseGeofenceCaptureMethod("DRAW_ON_MAP"), "DRAW_ON_MAP");

  const prev = process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED;
  delete process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED;
  assert.equal(isGeofencePolygonValidationEnabled(), false);
  process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED = "true";
  assert.equal(isGeofencePolygonValidationEnabled(), true);
  if (prev === undefined) delete process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED;
  else process.env.GEOFENCE_POLYGON_VALIDATION_ENABLED = prev;

  console.log("geofenceGeometry.test.ts PASS");
}

main();
