/**
 * Frontend geofence corner-capture helpers.
 * Run: npx --yes esbuild src/geofence/geofenceCapture.test.ts --bundle --platform=node --format=esm --outfile=/tmp/geofence-capture-test.mjs --packages=external && node /tmp/geofence-capture-test.mjs
 */
import assert from "node:assert/strict";
import {
  buildBoundaryProgressRows,
  canAddCorner,
  canFinishBoundary,
  isAccuracyWarning,
  resolveGpsSignalStatus,
  type DraftCorner,
} from "./geofenceCapture";

const base: DraftCorner = {
  id: "1",
  latitude: -26.1,
  longitude: 28.0,
  accuracyMetres: 5,
  capturedAt: new Date().toISOString(),
};

assert.equal(canAddCorner([], { latitude: -26.1, longitude: 28.0 }).ok, true);
assert.equal(
  canAddCorner([base], { latitude: -26.1, longitude: 28.000001 }).ok,
  false,
  "near duplicate rejected"
);
assert.equal(canAddCorner([base], { latitude: -26.11, longitude: 28.01 }).ok, true);
assert.equal(canFinishBoundary([base]).ok, false);
assert.equal(
  canFinishBoundary([
    base,
    { ...base, id: "2", latitude: -26.1, longitude: 28.01 },
    { ...base, id: "3", latitude: -26.11, longitude: 28.01 },
  ]).ok,
  true
);
assert.equal(isAccuracyWarning(30), true);
assert.equal(isAccuracyWarning(8), false);

assert.equal(resolveGpsSignalStatus(3).tier, "excellent");
assert.equal(resolveGpsSignalStatus(7).tier, "good");
assert.equal(resolveGpsSignalStatus(15).tier, "weak");
assert.equal(resolveGpsSignalStatus(25).tier, "poor");
assert.equal(resolveGpsSignalStatus(null).tier, "unknown");
assert.ok(resolveGpsSignalStatus(25).tip?.includes("open area"));

const finishFail = canFinishBoundary([base]);
assert.equal(finishFail.ok, false);
if (!finishFail.ok) {
  assert.match(finishFail.error, /Save at least 3 corners before completing/);
}

const progress = buildBoundaryProgressRows(1);
assert.ok(progress.some((r) => r.label === "Corner 1" && r.done));
assert.ok(progress.some((r) => r.label === "Corner 2" && !r.done));
assert.ok(progress.some((r) => r.label === "Continue until complete"));

console.log("geofenceCapture.test.ts PASS");
