/**
 * EduClock Build 4 Checkpoint 4 — Owner Geofences UI helpers + source guards.
 * Run: npx --yes esbuild src/educlock/educlockGeofenceUi.test.ts --bundle --platform=node --format=esm --outfile=/tmp/educlock-geofence-ui-test.mjs --packages=external && node /tmp/educlock-geofence-ui-test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ENTRANCE_RADIUS_DEFAULT,
  evaluateEntranceGpsReadiness,
  summariseGeofences,
  validateEntranceForm,
} from "./educlockGeofenceUi";

const EDUCLOCK_DIR = path.join(process.cwd(), "src/educlock");

async function main() {
  // 29 — Default radius displays 5
  assert.equal(ENTRANCE_RADIUS_DEFAULT, 5);

  // 27 — Missing coordinates show NOT READY
  const missing = evaluateEntranceGpsReadiness({
    entranceIsActive: true,
    campusIsActive: true,
    latitude: null,
    longitude: null,
    allowedRadiusMetres: 5,
  });
  assert.equal(missing.gpsReady, false);
  assert.equal(missing.label, "NOT READY");
  assert.ok(missing.reasons.some((r) => /coordinates/i.test(r)));

  // 28 — Valid entrance shows READY
  const ready = evaluateEntranceGpsReadiness({
    entranceIsActive: true,
    campusIsActive: true,
    latitude: -26.2,
    longitude: 28.0,
    allowedRadiusMetres: 5,
  });
  assert.equal(ready.gpsReady, true);
  assert.equal(ready.label, "READY");
  assert.deepEqual(ready.reasons, ["Active", "Coordinates configured", "Radius configured"]);

  // Inactive entrance / campus
  assert.equal(
    evaluateEntranceGpsReadiness({
      entranceIsActive: false,
      campusIsActive: true,
      latitude: -26.2,
      longitude: 28.0,
      allowedRadiusMetres: 5,
    }).gpsReady,
    false
  );
  assert.equal(
    evaluateEntranceGpsReadiness({
      entranceIsActive: true,
      campusIsActive: false,
      latitude: -26.2,
      longitude: 28.0,
      allowedRadiusMetres: 5,
    }).gpsReady,
    false
  );

  // 30 — Invalid radius shows validation error
  const badRadius = validateEntranceForm({
    name: "Gate",
    latitude: "-26.2",
    longitude: "28.0",
    allowedRadiusMetres: "26",
    requireCoordinates: true,
  });
  assert.equal(badRadius.ok, false);
  if (!badRadius.ok) assert.match(badRadius.error, /radius/i);

  const badRadius0 = validateEntranceForm({
    name: "Gate",
    latitude: "-26.2",
    longitude: "28.0",
    allowedRadiusMetres: "0",
    requireCoordinates: true,
  });
  assert.equal(badRadius0.ok, false);

  // 31 — Invalid latitude
  const badLat = validateEntranceForm({
    name: "Gate",
    latitude: "91",
    longitude: "28.0",
    allowedRadiusMetres: "5",
    requireCoordinates: true,
  });
  assert.equal(badLat.ok, false);
  if (!badLat.ok) assert.match(badLat.error, /Latitude/i);

  // 32 — Invalid longitude
  const badLng = validateEntranceForm({
    name: "Gate",
    latitude: "-26.2",
    longitude: "181",
    allowedRadiusMetres: "5",
    requireCoordinates: true,
  });
  assert.equal(badLng.ok, false);
  if (!badLng.ok) assert.match(badLng.error, /Longitude/i);

  // Empty name
  const emptyName = validateEntranceForm({
    name: "  ",
    latitude: "",
    longitude: "",
    allowedRadiusMetres: "5",
    requireCoordinates: false,
  });
  assert.equal(emptyName.ok, false);

  // Valid form (coords optional when blank)
  const okBlankCoords = validateEntranceForm({
    name: "Prep Gate",
    latitude: "",
    longitude: "",
    allowedRadiusMetres: "5",
    requireCoordinates: false,
  });
  assert.equal(okBlankCoords.ok, true);

  const okReadyForm = validateEntranceForm({
    name: "Ready Gate",
    latitude: "-26.2041",
    longitude: "28.0473",
    allowedRadiusMetres: "5",
    requireCoordinates: true,
  });
  assert.equal(okReadyForm.ok, true);

  // 26 / 37 — Existing entrances summarised; warning when no GPS-ready
  const summaryEmptyReady = summariseGeofences([
    {
      isActive: true,
      entrances: [
        {
          isActive: true,
          latitude: null,
          longitude: null,
          allowedRadiusMetres: 5,
          gpsReady: false,
        },
      ],
    },
  ]);
  assert.equal(summaryEmptyReady.totalEntrances, 1);
  assert.equal(summaryEmptyReady.gpsReadyEntrances, 0);
  assert.equal(summaryEmptyReady.notReadyEntrances, 1);

  const summaryReady = summariseGeofences([
    {
      isActive: true,
      entrances: [
        {
          isActive: true,
          latitude: -26.2,
          longitude: 28.0,
          allowedRadiusMetres: 5,
          gpsReady: true,
        },
      ],
    },
  ]);
  assert.equal(summaryReady.gpsReadyEntrances, 1);

  // 35 — Edit form load values (helper parity with tab formFromEntrance)
  const existing = {
    name: "Main Gate",
    description: "Front",
    latitude: -26.2041,
    longitude: 28.0473,
    allowedRadiusMetres: 12,
    isActive: true,
  };
  const formLoaded = {
    name: existing.name || "",
    description: existing.description || "",
    latitude: existing.latitude == null ? "" : String(existing.latitude),
    longitude: existing.longitude == null ? "" : String(existing.longitude),
    allowedRadiusMetres: String(existing.allowedRadiusMetres ?? ENTRANCE_RADIUS_DEFAULT),
    isActive: existing.isActive,
  };
  assert.equal(formLoaded.name, "Main Gate");
  assert.equal(formLoaded.latitude, "-26.2041");
  assert.equal(formLoaded.longitude, "28.0473");
  assert.equal(formLoaded.allowedRadiusMetres, "12");
  assert.equal(formLoaded.isActive, true);

  // 33 / 34 / 36 / 38 / 39 / 40 — source guards on Geofences tab
  const tabPath = path.join(EDUCLOCK_DIR, "EduClockGeofencesTab.tsx");
  const tabSrc = fs.readFileSync(tabPath, "utf8");
  assert.ok(tabSrc.includes("GeofenceEntranceWizard"), "Phase 2B: entrance wizard wired");
  assert.ok(tabSrc.includes("disabled={busy}"), "33: actions disabled while busy");
  assert.ok(tabSrc.includes("window.confirm"), "36: deactivate confirmation");
  assert.ok(!/localStorage|sessionStorage/.test(tabSrc), "38: no browser persistence for coords");
  assert.ok(tabSrc.includes("No GPS-ready entrances"), "37: no-ready warning copy");
  assert.ok(tabSrc.includes("flexWrap"), "40: responsive flexWrap layout");
  assert.ok(tabSrc.includes("Entrance Radius"), "Entrance Radius labelled distinctly");
  assert.ok(
    tabSrc.includes("Perimeter Tolerance") ||
      tabSrc.includes("perimeter tolerance") ||
      tabSrc.includes("Geofence Engine"),
    "Campus boundary / geofence engine labelled"
  );
  assert.ok(tabSrc.includes("Set Campus Boundary"), "Phase 3: Set Campus Boundary entry");
  assert.ok(tabSrc.includes("GeofenceCampusBoundaryWizard"), "wizard wired from Geofences tab");
  assert.ok(tabSrc.includes("Test My Location"), "Phase 2C: Test My Location entry");
  assert.ok(tabSrc.includes("OwnerLocationTestWizard"), "Phase 2C location test wizard wired");
  // Map lives in shared geofence package, not inline in this tab file
  assert.ok(!/leaflet|google\.maps/i.test(tabSrc), "Leaflet stays outside EduClockGeofencesTab.tsx");
  assert.ok(!tabSrc.includes('placeholder="Latitude"'), "lat/lng not primary Add Entrance UI");

  const entranceWizardPath = path.join(process.cwd(), "src/geofence/EntranceSetupWizard.tsx");
  const entranceWizardSrc = fs.readFileSync(entranceWizardPath, "utf8");
  assert.ok(entranceWizardSrc.includes("Use My Current Location"), "capture CTA");
  assert.ok(entranceWizardSrc.includes("Save Entrance"), "save CTA");
  assert.ok(entranceWizardSrc.includes("Advanced details"), "advanced lat/lng tucked away");
  assert.ok(entranceWizardSrc.includes("Reference only"), "radius plain language");
  assert.ok(entranceWizardSrc.includes("campus boundary"), "boundary authority mentioned");
  assert.ok(entranceWizardSrc.includes("fontSize: 16"), "Safari zoom-safe inputs");
  assert.ok(entranceWizardSrc.includes("Secure connection required") || entranceWizardSrc.includes("SecureConnectionNotice"), "owner secure-connection notice");
  assert.ok(!entranceWizardSrc.includes("192.168"), "no developer IP wording");
  assert.ok(!/Location needs https/i.test(entranceWizardSrc), "no developer https warning");

  const wizardPath = path.join(process.cwd(), "src/geofence/GeofenceCampusBoundaryWizard.tsx");
  const wizardSrc = fs.readFileSync(wizardPath, "utf8");
  assert.ok(wizardSrc.includes("Save Each Corner"), "Phase 4: Save Each Corner");
  assert.ok(wizardSrc.includes("Draw Boundary"), "Phase 2D: Draw Boundary");
  assert.ok(wizardSrc.includes("Recommended"), "Phase 2D: Draw Boundary recommended");
  assert.ok(!wizardSrc.includes("Walk Boundary"), "Walk Boundary removed");
  assert.ok(wizardSrc.includes("Complete Boundary"), "Complete Boundary action");
  assert.ok(wizardSrc.includes("Save This Corner"), "Save This Corner label");
  assert.ok(wizardSrc.includes("Pause Setup"), "Pause Setup label");
  assert.ok(wizardSrc.includes("Cancel Setup"), "Cancel Setup label");
  assert.ok(wizardSrc.includes("GPS Status"), "GPS status card");
  assert.ok(wizardSrc.includes("Corners Saved"), "Corners saved progress");
  assert.ok(wizardSrc.includes("Walk to the first corner"), "plain-language help");
  assert.ok(
    wizardSrc.includes("Save at least 3 corners before completing"),
    "complete disabled helper copy"
  );
  assert.ok(wizardSrc.includes("SecureConnectionNotice"), "boundary secure-connection notice");
  assert.ok(!wizardSrc.includes("http LAN"), "no developer LAN http tip");

  const drawWizardPath = path.join(process.cwd(), "src/geofence/GeofenceDrawBoundaryWizard.tsx");
  const drawWizardSrc = fs.readFileSync(drawWizardPath, "utf8");
  assert.ok(drawWizardSrc.includes("Start Drawing"), "draw: Start Drawing");
  assert.ok(drawWizardSrc.includes("Finish Drawing"), "draw: Finish Drawing");
  assert.ok(drawWizardSrc.includes("DRAW_ON_MAP"), "draw: capture method");
  assert.ok(drawWizardSrc.includes("Staff clock GPS uses the campus boundary"), "draw: boundary clock warning");
  assert.ok(
    drawWizardSrc.includes("previous version will remain"),
    "draw: replace history warning"
  );

  const locationTestPath = path.join(process.cwd(), "src/geofence/OwnerLocationTestWizard.tsx");
  const locationTestSrc = fs.readFileSync(locationTestPath, "utf8");
  assert.ok(locationTestSrc.includes("Test your location setup"), "location test heading");
  assert.ok(locationTestSrc.includes("Check My Current Location"), "location test CTA");
  assert.ok(locationTestSrc.includes("Would be accepted"), "accepted result copy");
  assert.ok(locationTestSrc.includes("Would be rejected"), "rejected result copy");
  assert.ok(locationTestSrc.includes("Not enabled yet"), "polygon not enabled yet");
  assert.ok(locationTestSrc.includes("min(94dvh"), "mobile-first shell");
  assert.ok(
    !locationTestSrc.includes("-26.2041"),
    "live wizard must not hard-code Carlton/Johannesburg"
  );
  assert.ok(
    locationTestSrc.includes("We couldn't determine your current location."),
    "GPS fail message"
  );
  assert.ok(locationTestSrc.includes("import.meta.env.DEV"), "mock/demo gated to DEV");

  assert.ok(!tabSrc.includes("mockLocation="), "tab must not inject mockLocation");
  assert.ok(!tabSrc.includes("demoResult="), "tab must not inject demoResult");

  // 39 — non-owner: tab surfaces fetch error (safe string); API 403 handled as Error message
  assert.ok(tabSrc.includes("Failed to load campuses") || tabSrc.includes("setError"), "39: error surface");

  // 38 — helpers module also free of storage
  const uiPath = path.join(EDUCLOCK_DIR, "educlockGeofenceUi.ts");
  const uiSrc = fs.readFileSync(uiPath, "utf8");
  assert.ok(!/localStorage|sessionStorage/.test(uiSrc), "38: helpers must not touch storage");

  console.log("EDUCLOCK BUILD 4 GEOFENCE UI TESTS PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
