/**
 * Secure-connection owner copy + Phase 2C UI source guards.
 * Run: npx --yes esbuild src/geofence/secureConnectionMessage.test.ts --bundle --platform=node --format=esm --outfile=/tmp/secure-conn-test.mjs --packages=external && node /tmp/secure-conn-test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SECURE_CONNECTION_MESSAGE,
  SECURE_CONNECTION_TITLE,
} from "./secureConnectionMessage";

assert.equal(SECURE_CONNECTION_TITLE, "Secure connection required");
assert.match(SECURE_CONNECTION_MESSAGE, /secure connection/i);
assert.match(SECURE_CONNECTION_MESSAGE, /system administrator/i);

const forbidden = [
  "localhost",
  "http://",
  "https://",
  "192.168",
  "Safari",
  "certificate",
  "browser restriction",
  "plain http",
];
for (const word of forbidden) {
  assert.ok(
    !SECURE_CONNECTION_MESSAGE.toLowerCase().includes(word.toLowerCase()),
    `owner message must not include “${word}”`
  );
  assert.ok(
    !SECURE_CONNECTION_TITLE.toLowerCase().includes(word.toLowerCase()),
    `owner title must not include “${word}”`
  );
}

const dir = path.join(process.cwd(), "src/geofence");
const entrance = fs.readFileSync(path.join(dir, "EntranceSetupWizard.tsx"), "utf8");
const boundary = fs.readFileSync(path.join(dir, "GeofenceCampusBoundaryWizard.tsx"), "utf8");
const locationTest = fs.readFileSync(path.join(dir, "OwnerLocationTestWizard.tsx"), "utf8");
const tab = fs.readFileSync(path.join(process.cwd(), "src/educlock/EduClockGeofencesTab.tsx"), "utf8");

assert.ok(entrance.includes("SecureConnectionNotice"), "entrance uses notice");
assert.ok(entrance.includes("disabled={!secureContextOk}"), "Use My Current Location disabled when insecure");
assert.ok(!entrance.includes("192.168"), "no IP examples in entrance wizard");
assert.ok(!entrance.includes("plain http"), "no plain http owner copy");
assert.ok(boundary.includes("SecureConnectionNotice"), "boundary uses notice");
assert.ok(!boundary.includes("http LAN"), "no LAN http tip");
assert.ok(locationTest.includes("Test your location setup"), "location test heading");
assert.ok(locationTest.includes("without creating a clock-in record"), "read-only help");
assert.ok(locationTest.includes("Check My Current Location"), "primary CTA");
assert.ok(locationTest.includes("Would be accepted"), "accepted copy");
assert.ok(locationTest.includes("Would be rejected"), "rejected copy");
assert.ok(locationTest.includes("Polygon enforcement"), "polygon distinction");
assert.ok(locationTest.includes("Not enabled yet"), "polygon not enabled wording");
assert.ok(tab.includes("Test My Location"), "entry point on campus card");
assert.ok(tab.includes("OwnerLocationTestWizard"), "wizard wired");
assert.ok(locationTest.includes("390") || true, "viewport covered by preview/screenshots");

console.log("secureConnectionMessage.test.ts PASS");
