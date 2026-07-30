/**
 * Owner Location Test Mode — pure simulation unit tests.
 * Run:
 *   set -a && source .env.educlock_dev && set +a
 *   npx esbuild src/services/geofenceLocationTest.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/gf-loc-test.cjs --external:@prisma/client
 *   node /tmp/gf-loc-test.cjs
 */
import assert from "node:assert/strict";
import { evaluateOwnerLocationSimulation } from "./geofenceLocationTest";
import { haversineDistanceMetres } from "../utils/educlockGpsDistance";
import { isGeofencePolygonValidationEnabled } from "./geofencePolygonValidationFlag";

const MAIN = {
  id: "ent-main",
  name: "Main Gate",
  isActive: true,
  latitude: -26.2041,
  longitude: 28.0473,
  allowedRadiusMetres: 10,
};

const INACTIVE = {
  id: "ent-old",
  name: "Old Gate",
  isActive: false,
  latitude: -26.2041,
  longitude: 28.0473,
  allowedRadiusMetres: 10,
};

const SQUARE = [
  { latitude: -26.205, longitude: 28.046 },
  { latitude: -26.205, longitude: 28.048 },
  { latitude: -26.203, longitude: 28.048 },
  { latitude: -26.203, longitude: 28.046 },
];

assert.equal(isGeofencePolygonValidationEnabled(), false, "polygon flag remains OFF");

// Haversine sanity
const d0 = haversineDistanceMetres(
  { latitude: MAIN.latitude, longitude: MAIN.longitude },
  { latitude: MAIN.latitude, longitude: MAIN.longitude }
);
assert.ok(d0 < 0.01, "haversine zero");

const near = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [MAIN, INACTIVE],
  polygonRuleEnabled: false,
});
assert.equal(near.currentEntranceRuleWouldAccept, true, "radius pass");
assert.equal(near.nearestActiveEntranceName, "Main Gate");
assert.equal(near.accuracyAcceptedByCurrentClockRule, true);
assert.equal(near.polygonRuleEnabled, false);
assert.equal(near.futurePolygonAwareRuleWouldAccept, true);
assert.equal(near.isInsideCampusBoundary, true);
assert.equal(near.recordsCreated.eduClockEvent, 0);
assert.equal(near.recordsCreated.eduClockGpsAttempt, 0);
assert.equal(near.recordsCreated.attendance, 0);
assert.equal(near.recordsCreated.payroll, 0);
assert.equal(near.simulatedOverallResult.polygonEnforcement, "NOT_ENABLED");

const far = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude + 0.0005, // ~55 m
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [MAIN],
  polygonRuleEnabled: false,
});
assert.equal(far.currentEntranceRuleWouldAccept, false, "radius fail");
assert.equal(far.rejectionCode, "OUTSIDE_ENTRANCE_RADIUS");
assert.ok((far.distanceToNearestEntranceMetres || 0) > 10);
assert.match(String(far.rejectionReason), /Main Gate/);

const weakAcc = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 20.01,
  boundaryRing: SQUARE,
  entrances: [MAIN],
  polygonRuleEnabled: false,
});
assert.equal(weakAcc.accuracyAcceptedByCurrentClockRule, false, "accuracy fail over 20 m");
assert.equal(weakAcc.currentEntranceRuleWouldAccept, false);
assert.equal(weakAcc.rejectionCode, "GPS_ACCURACY_TOO_LOW");

const accPass = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 20,
  boundaryRing: SQUARE,
  entrances: [MAIN],
  polygonRuleEnabled: false,
});
assert.equal(accPass.accuracyAcceptedByCurrentClockRule, true, "accuracy pass at 20 m");
assert.equal(accPass.currentEntranceRuleWouldAccept, true);

const noEntrance = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [],
  polygonRuleEnabled: false,
});
assert.equal(noEntrance.rejectionCode, "NO_ACTIVE_ENTRANCE");
assert.equal(noEntrance.currentEntranceRuleWouldAccept, false);

const inactiveOnly = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [INACTIVE],
  polygonRuleEnabled: false,
});
assert.equal(inactiveOnly.nearestActiveEntranceId, null, "inactive entrance ignored");
assert.equal(inactiveOnly.rejectionCode, "NO_ACTIVE_ENTRANCE");

const noBoundary = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: null,
  entrances: [MAIN],
  polygonRuleEnabled: false,
});
assert.equal(noBoundary.campusBoundaryAvailable, false, "no boundary state");
assert.equal(noBoundary.currentEntranceRuleWouldAccept, true, "current rule remains entrance-only");
assert.equal(noBoundary.futurePolygonAwareRuleWouldAccept, null);
assert.equal(noBoundary.simulatedOverallResult.futurePolygonAwareRule, "NOT_EVALUABLE");

const outsidePolyNearEntrance = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  // Slightly south of the southern boundary edge, still within 10 m of the gate on the edge
  latitude: -26.20408,
  longitude: 28.0473,
  accuracyMetres: 5,
  boundaryRing: [
    { latitude: -26.2040, longitude: 28.0472 },
    { latitude: -26.2040, longitude: 28.0474 },
    { latitude: -26.2038, longitude: 28.0474 },
    { latitude: -26.2038, longitude: 28.0472 },
  ],
  entrances: [
    {
      id: "ent-edge",
      name: "Edge Gate",
      isActive: true,
      latitude: -26.2040,
      longitude: 28.0473,
      allowedRadiusMetres: 10,
    },
  ],
  polygonRuleEnabled: false,
});
assert.equal(outsidePolyNearEntrance.isInsideCampusBoundary, false, "outside polygon");
assert.equal(
  outsidePolyNearEntrance.currentEntranceRuleWouldAccept,
  true,
  "current real rule remains entrance-only"
);
assert.equal(
  outsidePolyNearEntrance.futurePolygonAwareRuleWouldAccept,
  false,
  "future polygon-aware would reject"
);
assert.equal(outsidePolyNearEntrance.polygonRuleEnabled, false);

const insidePoly = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: -26.2041,
  longitude: 28.0473,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [MAIN],
  polygonRuleEnabled: false,
});
assert.equal(insidePoly.isInsideCampusBoundary, true, "inside polygon");

const inactiveCampus = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: false,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [MAIN],
  polygonRuleEnabled: false,
});
assert.equal(inactiveCampus.rejectionCode, "INACTIVE_CAMPUS");

console.log("geofenceLocationTest.test.ts PASS");
