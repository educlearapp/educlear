/**
 * Entrance wizard helpers + point-in-polygon client check.
 * Run: npx --yes esbuild src/geofence/entranceWizardLogic.test.ts --bundle --platform=node --format=esm --outfile=/tmp/entrance-wizard-logic-test.mjs --packages=external && node /tmp/entrance-wizard-logic-test.mjs
 */
import assert from "node:assert/strict";
import {
  ENTRANCE_WIZARD_RADIUS_DEFAULT,
  gpsStatusForEntrance,
  isPointInsidePolygonClient,
  validateEntranceDetails,
  validateEntranceLocation,
} from "./entranceWizardLogic";

assert.equal(ENTRANCE_WIZARD_RADIUS_DEFAULT, 10);

assert.equal(validateEntranceDetails({
  name: "",
  entranceType: "MAIN_GATE",
  customTypeLabel: "",
  allowedRadiusMetres: "10",
}).ok, false);

assert.equal(validateEntranceDetails({
  name: "Main Gate",
  entranceType: "",
  customTypeLabel: "",
  allowedRadiusMetres: "10",
}).ok, false);

assert.equal(validateEntranceDetails({
  name: "Side",
  entranceType: "OTHER",
  customTypeLabel: "",
  allowedRadiusMetres: "10",
}).ok, false);

assert.equal(validateEntranceDetails({
  name: "Side",
  entranceType: "OTHER",
  customTypeLabel: "Delivery Door",
  allowedRadiusMetres: "10",
}).ok, true);

assert.equal(validateEntranceDetails({
  name: "Main Gate",
  entranceType: "MAIN_GATE",
  customTypeLabel: "",
  allowedRadiusMetres: "26",
}).ok, false);

assert.equal(validateEntranceDetails({
  name: "Main Gate",
  entranceType: "MAIN_GATE",
  customTypeLabel: "",
  allowedRadiusMetres: "0",
}).ok, false);

assert.equal(validateEntranceLocation({ latitude: null, longitude: null }).ok, false);
assert.equal(validateEntranceLocation({ latitude: -26.2, longitude: 28.0 }).ok, true);

assert.equal(gpsStatusForEntrance(3).tier, "excellent");
assert.equal(gpsStatusForEntrance(8).tier, "good");
assert.equal(gpsStatusForEntrance(15).tier, "weak");
assert.equal(gpsStatusForEntrance(25).tier, "poor");

const square = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 1 },
  { latitude: 1, longitude: 1 },
  { latitude: 1, longitude: 0 },
];
assert.equal(isPointInsidePolygonClient({ latitude: 0.5, longitude: 0.5 }, square), true);
assert.equal(isPointInsidePolygonClient({ latitude: 2, longitude: 2 }, square), false);

console.log("geofenceEntranceWizard.test.ts PASS");
