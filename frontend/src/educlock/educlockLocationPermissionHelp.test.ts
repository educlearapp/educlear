/**
 * EduClock location-permission help unit tests (no browser / no DB).
 * Run:
 *   npx --yes esbuild src/educlock/educlockLocationPermissionHelp.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/educlock-loc-help-test.cjs --packages=external && node /tmp/educlock-loc-help-test.cjs
 */
import assert from "node:assert/strict";
import {
  buildLocationHelpContent,
  detectDeviceGuidanceKind,
  queryGeolocationPermissionState,
  shouldShowLocationHelp,
} from "./educlockLocationPermissionHelp";

async function main() {
  assert.equal(
    detectDeviceGuidanceKind(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "iphone_safari"
  );
  assert.equal(
    detectDeviceGuidanceKind(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      { standaloneNavigator: true }
    ),
    "iphone_pwa"
  );
  assert.equal(
    detectDeviceGuidanceKind(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    ),
    "android_chrome"
  );
  assert.equal(
    detectDeviceGuidanceKind(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0"
    ),
    "embedded_browser"
  );
  assert.equal(
    detectDeviceGuidanceKind("WhatsApp/2.24.0 Android"),
    "embedded_browser"
  );

  const safariHelp = buildLocationHelpContent("iphone_safari");
  assert.match(safariHelp.steps.join(" "), /Privacy & Security/);
  assert.match(safariHelp.steps.join(" "), /Precise Location/i);

  const pwaHelp = buildLocationHelpContent("iphone_pwa");
  assert.match(pwaHelp.steps.join(" "), /Home Screen|Safari/i);

  const androidHelp = buildLocationHelpContent("android_chrome");
  assert.match(androidHelp.steps.join(" "), /Apps → Chrome/);
  assert.match(androidHelp.steps.join(" "), /Precise location/i);

  const embedHelp = buildLocationHelpContent("embedded_browser");
  assert.match(embedHelp.steps.join(" "), /Safari \(iPhone\) or Chrome \(Android\)/);

  assert.equal(shouldShowLocationHelp({ permissionQueryState: "denied" }), true);
  assert.equal(shouldShowLocationHelp({ geoFailureCode: "PERMISSION_DENIED" }), true);
  assert.equal(shouldShowLocationHelp({ permissionQueryState: "granted" }), false);
  assert.equal(shouldShowLocationHelp({ permissionQueryState: "prompt" }), false);

  const denied = await queryGeolocationPermissionState(async () => ({ state: "denied" }) as PermissionStatus);
  assert.equal(denied, "denied");
  const granted = await queryGeolocationPermissionState(async () => ({ state: "granted" }) as PermissionStatus);
  assert.equal(granted, "granted");
  const prompt = await queryGeolocationPermissionState(async () => ({ state: "prompt" }) as PermissionStatus);
  assert.equal(prompt, "prompt");
  const unsupported = await queryGeolocationPermissionState(null);
  assert.equal(unsupported, "unsupported");

  // Clock page source guards
  const fs = await import("node:fs");
  const path = await import("node:path");
  const page = fs.readFileSync(path.join(process.cwd(), "src/educlock/EduClockStaffClockPage.tsx"), "utf8");
  assert.ok(page.includes("Retry Location"), "Retry Location button");
  assert.ok(page.includes("Location Help"), "Location Help button");
  assert.ok(page.includes("visibilitychange"), "foreground re-check");
  assert.ok(page.includes("pageshow"), "pageshow re-check");
  assert.ok(page.includes("captureStaffGeolocation"), "geo only via capture helper");
  assert.ok(!/useEffect\([^\)]*captureStaffGeolocation/.test(page), "no auto capture on mount");
  assert.ok(page.includes("onClockIn"), "explicit clock in");
  assert.ok(page.includes("onClockOut"), "explicit clock out");

  console.log("educlockLocationPermissionHelp.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
