/**
 * Draw Boundary client helpers (Phase 2D).
 * Run: npx esbuild src/geofence/geofenceDrawBoundary.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/draw-boundary.cjs && node /tmp/draw-boundary.cjs
 */
import assert from "node:assert/strict";
import {
  GEOFENCE_POLYGON_MIN_AREA_SQ_METRES,
  GEOFENCE_POLYGON_MIN_VERTICES,
  classifyEntrancesAgainstBoundary,
  isPolygonSelfIntersecting,
  polygonAreaSquareMetres,
  validateDrawnPolygon,
} from "./geofenceDrawBoundary";

function main() {
  assert.equal(GEOFENCE_POLYGON_MIN_VERTICES, 3);
  assert.ok(GEOFENCE_POLYGON_MIN_AREA_SQ_METRES >= 50);

  const tooFew = validateDrawnPolygon([
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.01 },
  ]);
  assert.equal(tooFew.ok, false);

  const square = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.01 },
    { latitude: -26.11, longitude: 28.01 },
    { latitude: -26.11, longitude: 28.0 },
  ];
  assert.equal(validateDrawnPolygon(square).ok, true);
  assert.ok(polygonAreaSquareMetres(square) > 50);

  const bowtie = [
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.11, longitude: 28.01 },
    { latitude: -26.1, longitude: 28.01 },
    { latitude: -26.11, longitude: 28.0 },
  ];
  assert.equal(isPolygonSelfIntersecting(bowtie), true);
  const bad = validateDrawnPolygon(bowtie);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, "SELF_INTERSECTING");

  const dup = validateDrawnPolygon([
    { latitude: -26.1, longitude: 28.0 },
    { latitude: -26.1, longitude: 28.000001 },
    { latitude: -26.11, longitude: 28.01 },
  ]);
  assert.equal(dup.ok, false);

  const entrances = [
    {
      id: "in",
      name: "Inside Gate",
      latitude: -26.105,
      longitude: 28.005,
      allowedRadiusMetres: 5,
      isActive: true,
    },
    {
      id: "out",
      name: "Outside Gate",
      latitude: -26.2,
      longitude: 28.2,
      allowedRadiusMetres: 5,
      isActive: true,
    },
  ];
  const classified = classifyEntrancesAgainstBoundary(square, entrances);
  assert.equal(classified.inside.length, 1);
  assert.equal(classified.outside.length, 1);
  assert.equal(classified.inside[0].id, "in");

  console.log("geofenceDrawBoundary.test.ts PASS");
}

main();
