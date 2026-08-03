/**
 * Owner Location Test Mode — pure simulation unit tests.
 * Current clock rule = campus boundary polygon (gps-boundary-v1).
 * Run:
 *   set -a && source .env.educlock_dev && set +a
 *   npx esbuild src/services/geofenceLocationTest.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/gf-loc-test.cjs --external:@prisma/client
 *   node /tmp/gf-loc-test.cjs
 */
import assert from "node:assert/strict";
import { evaluateOwnerLocationSimulation } from "./geofenceLocationTest";
import { haversineDistanceMetres } from "../utils/educlockGpsDistance";

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
});
assert.equal(near.currentEntranceRuleWouldAccept, true, "inside boundary pass");
assert.equal(near.nearestActiveEntranceName, "Main Gate");
assert.equal(near.accuracyAcceptedByCurrentClockRule, true);
assert.equal(near.polygonRuleEnabled, true);
assert.equal(near.futurePolygonAwareRuleWouldAccept, true);
assert.equal(near.isInsideCampusBoundary, true);
assert.equal(near.recordsCreated.eduClockEvent, 0);
assert.equal(near.recordsCreated.eduClockGpsAttempt, 0);
assert.equal(near.recordsCreated.attendance, 0);
assert.equal(near.recordsCreated.payroll, 0);
assert.equal(near.simulatedOverallResult.polygonEnforcement, "ENABLED");

// Inside polygon but far from every entrance — must still accept
const farInside = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: -26.2045,
  longitude: 28.0475,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [MAIN],
});
assert.equal(farInside.isInsideCampusBoundary, true, "far-inside still in polygon");
assert.equal(farInside.currentEntranceRuleWouldAccept, true, "entrance proximity not required");
assert.equal(farInside.isWithinEntranceRadius, false, "informational: outside entrance radius");
assert.equal(farInside.rejectionCode, null);

const weakAcc = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 20.01,
  boundaryRing: SQUARE,
  entrances: [MAIN],
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
});
assert.equal(noEntrance.rejectionCode, null, "no entrance required when inside boundary");
assert.equal(noEntrance.currentEntranceRuleWouldAccept, true);

const inactiveOnly = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [INACTIVE],
});
assert.equal(inactiveOnly.nearestActiveEntranceId, null, "inactive entrance ignored");
assert.equal(inactiveOnly.currentEntranceRuleWouldAccept, true, "boundary still accepts");

const noBoundary = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: MAIN.latitude,
  longitude: MAIN.longitude,
  accuracyMetres: 5,
  boundaryRing: null,
  entrances: [MAIN],
});
assert.equal(noBoundary.campusBoundaryAvailable, false, "no boundary state");
assert.equal(noBoundary.currentEntranceRuleWouldAccept, false, "boundary required");
assert.equal(noBoundary.rejectionCode, "NO_ACTIVE_BOUNDARY");
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
});
assert.equal(outsidePolyNearEntrance.isInsideCampusBoundary, false, "outside polygon");
assert.equal(
  outsidePolyNearEntrance.currentEntranceRuleWouldAccept,
  false,
  "outside boundary rejected even near entrance"
);
assert.equal(outsidePolyNearEntrance.rejectionCode, "OUTSIDE_GEOFENCE");
assert.equal(outsidePolyNearEntrance.isWithinEntranceRadius, true, "informational entrance radius");

const insidePoly = evaluateOwnerLocationSimulation({
  campusId: "c1",
  campusName: "Da Silva",
  campusActive: true,
  latitude: -26.2041,
  longitude: 28.0473,
  accuracyMetres: 5,
  boundaryRing: SQUARE,
  entrances: [MAIN],
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
});
assert.equal(inactiveCampus.rejectionCode, "INACTIVE_CAMPUS");

console.log("geofenceLocationTest.test.ts PASS");
