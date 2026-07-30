/**
 * Guards: live owner geofence maps must never hard-code Johannesburg/Carlton,
 * and preview mock coordinates must not be wired into EduClock Geofences.
 *
 * Run:
 *   node --experimental-strip-types is not required — plain JS via esbuild without leaflet:
 *   npx esbuild src/geofence/ownerGeofenceMap.noFakeCenter.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/no-fake-center.cjs --external:leaflet && node /tmp/no-fake-center.cjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FAKE = "-26.2041";
const FAKE_LNG = "28.0473";

const dir = path.join(process.cwd(), "src/geofence");
const educlockDir = path.join(process.cwd(), "src/educlock");

const liveOwnerFiles = [
  "GeofenceLocationTestMap.tsx",
  "GeofenceEntranceMap.tsx",
  "GeofenceLiveMap.tsx",
  "GeofenceDrawBoundaryMap.tsx",
  "GeofenceDrawBoundaryWizard.tsx",
  "ownerGeofenceMap.ts",
  "OwnerLocationTestWizard.tsx",
  "EntranceSetupWizard.tsx",
  "GeofenceCampusBoundaryWizard.tsx",
];

for (const file of liveOwnerFiles) {
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  if (file === "ownerGeofenceMap.ts") {
    assert.ok(src.includes("FORBIDDEN_DEFAULT_MAP_CENTER"), "documents forbidden centre");
    assert.ok(!src.includes(`setView([${FAKE}`), "ownerGeofenceMap must not setView fake centre");
    const withoutConst = src.replace(
      /export const FORBIDDEN_DEFAULT_MAP_CENTER[\s\S]*?} as const;/,
      ""
    );
    assert.ok(!withoutConst.includes(FAKE), "no operational use of Carlton lat outside constant");
    continue;
  }
  assert.ok(
    !src.includes(FAKE) && !src.includes(FAKE_LNG),
    `${file} must not contain Carlton/Johannesburg default ${FAKE}, ${FAKE_LNG}`
  );
  assert.ok(!/setView\(\s*\[\s*-26\.2041/.test(src), `${file}: no hard-coded setView Carlton`);
}

const tabSrc = fs.readFileSync(path.join(educlockDir, "EduClockGeofencesTab.tsx"), "utf8");
assert.ok(tabSrc.includes("OwnerLocationTestWizard"), "location test wired");
assert.ok(!tabSrc.includes("mockLocation"), "Geofences tab must not pass mockLocation");
assert.ok(!tabSrc.includes("demoResult"), "Geofences tab must not pass demoResult");
assert.ok(tabSrc.includes("existingEntrances"), "passes real campus entrances");

const wizardSrc = fs.readFileSync(path.join(dir, "OwnerLocationTestWizard.tsx"), "utf8");
assert.ok(wizardSrc.includes("import.meta.env.DEV"), "preview injection gated to DEV");
assert.ok(
  wizardSrc.includes("We couldn't determine your current location."),
  "GPS fail copy"
);
assert.ok(wizardSrc.includes("Try Again"), "Try Again");
assert.ok(wizardSrc.includes("Enter Coordinates Manually (Advanced)"), "manual advanced");
assert.ok(wizardSrc.includes("canCheck"), "check gated on real coords");
assert.ok(!wizardSrc.includes("result?.map.current || live"), "must not prefer demo map.current over live");

const mapSrc = fs.readFileSync(path.join(dir, "GeofenceLocationTestMap.tsx"), "utf8");
assert.ok(mapSrc.includes("createOwnerGeofenceMap"), "uses deferred map bootstrap");
assert.ok(mapSrc.includes("location-test-map-waiting"), "empty waiting state");
assert.ok(!mapSrc.includes("setView([-26"), "no JHB setView");

const previewSrc = fs.readFileSync(path.join(dir, "OwnerLocationTestPreviewPage.tsx"), "utf8");
assert.ok(previewSrc.includes(FAKE), "preview page may keep mock coords");
assert.ok(previewSrc.includes("mockLocation"), "preview injects mock only on preview route");

const appSrc = fs.readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");
assert.ok(
  appSrc.includes("/__local/geofence-location-test-preview"),
  "preview stays on DEV-only route"
);
assert.match(
  appSrc,
  /import\.meta\.env\.DEV[\s\S]*geofence-location-test-preview/,
  "preview route is DEV-gated"
);

console.log("ownerGeofenceMap.noFakeCenter.test.ts PASS");
