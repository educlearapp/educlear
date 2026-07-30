/**
 * EduClock Build 4 Checkpoint 3 — staff geolocation helper tests (no browser / no DB writes).
 * Run: npx --yes tsx src/educlock/educlockStaffGeolocation.test.ts
 */
import assert from "node:assert/strict";
import {
  EDUCLOCK_GEO_OPTIONS,
  buildClockPayloadFromCapture,
  buildClockPayloadFromGeoFailure,
  captureStaffGeolocation,
  formatClockSuccessMessage,
  mapGeolocationPositionError,
  resolveClockErrorMessage,
  sanitizeClockGpsBody,
  unsupportedGeolocationFailure,
} from "./educlockStaffGeolocation";

function mockPositionError(code: number): GeolocationPositionError {
  return {
    code,
    message: "mock",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

async function main() {
  assert.equal(EDUCLOCK_GEO_OPTIONS.enableHighAccuracy, true);
  assert.equal(EDUCLOCK_GEO_OPTIONS.timeout, 15_000);
  assert.equal(EDUCLOCK_GEO_OPTIONS.maximumAge, 0);

  // 17 unsupported
  const unsupported = await captureStaffGeolocation(undefined);
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) {
    assert.equal(unsupported.failure.permissionState, "unavailable");
    assert.equal(unsupported.failure.locationError, "UNAVAILABLE");
  }

  // 1/4 — location only via getCurrentPosition mock (simulates tap-triggered call)
  let geoCalls = 0;
  const okCapture = await captureStaffGeolocation((success) => {
    geoCalls += 1;
    success(
      {
        coords: {
          latitude: -26.2041,
          longitude: 28.0473,
          accuracy: 4.5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON() {
            return {};
          },
        },
        timestamp: Date.now(),
        toJSON() {
          return {};
        },
      } as GeolocationPosition,
      EDUCLOCK_GEO_OPTIONS
    );
  });
  assert.equal(geoCalls, 1);
  assert.equal(okCapture.ok, true);
  if (okCapture.ok) {
    const payload = buildClockPayloadFromCapture(okCapture.location);
    // 5-8
    assert.equal(payload.latitude, -26.2041);
    assert.equal(payload.longitude, 28.0473);
    assert.equal(payload.accuracyMetres, 4.5);
    assert.ok(payload.capturedAtClient);
    assert.equal(payload.permissionState, "granted");
    // 10-13 authority fields absent
    assert.equal("schoolId" in payload, false);
    assert.equal("employeeId" in payload, false);
    assert.equal("entranceId" in payload, false);
    assert.equal("distanceMetres" in payload, false);
  }

  // Repeated taps: one request per captureStaffGeolocation call (page guards separately)
  await captureStaffGeolocation((success, _err, _opts) => {
    geoCalls += 1;
    success(
      {
        coords: {
          latitude: 1,
          longitude: 2,
          accuracy: 3,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON() {
            return {};
          },
        },
        timestamp: 1,
        toJSON() {
          return {};
        },
      } as GeolocationPosition
    );
  });
  assert.equal(geoCalls, 2);

  // 14-16 browser errors → audit payloads without fabricated coordinates
  const denied = mapGeolocationPositionError(mockPositionError(1));
  assert.equal(denied.permissionState, "denied");
  const deniedPayload = buildClockPayloadFromGeoFailure(denied);
  assert.equal(deniedPayload.permissionState, "denied");
  assert.equal(deniedPayload.locationError, "PERMISSION_DENIED");
  assert.equal(deniedPayload.latitude, undefined);
  assert.equal(deniedPayload.longitude, undefined);

  const unavailable = mapGeolocationPositionError(mockPositionError(2));
  assert.equal(unavailable.locationError, "UNAVAILABLE");
  const timeout = mapGeolocationPositionError(mockPositionError(3));
  assert.equal(timeout.locationError, "TIMEOUT");

  // Capture path for denied
  const deniedCap = await captureStaffGeolocation((_s, error) => {
    error(mockPositionError(1));
  });
  assert.equal(deniedCap.ok, false);

  // 18-20 message resolution for backend codes (staff-facing)
  assert.match(
    resolveClockErrorMessage({ backendMessage: "We could not get an accurate enough location. Move into an open area and try again." }),
    /accurate enough location/i
  );
  assert.match(
    resolveClockErrorMessage({ backendMessage: "You are outside the permitted school clocking area." }),
    /outside the permitted/i
  );
  assert.match(
    resolveClockErrorMessage({ backendMessage: "No EduClock entrance has been configured. Contact the school owner." }),
    /No EduClock entrance/i
  );

  // Geo failure message preferred over backend when present
  assert.equal(
    resolveClockErrorMessage({
      backendMessage: "backend",
      geoFailure: unsupportedGeolocationFailure(),
    }),
    unsupportedGeolocationFailure().staffMessage
  );

  // Success formatting without inventing entrance when absent
  const successNoEntrance = formatClockSuccessMessage({
    action: "in",
    backendMessage: "Clocked in successfully at 08:00.",
    schoolLocalTimeDisplay: "08:00",
  });
  assert.match(successNoEntrance, /Clocked in/);
  assert.equal(successNoEntrance.includes("Entrance:"), false);

  const successWithEntrance = formatClockSuccessMessage({
    action: "out",
    backendMessage: "Clocked out successfully at 09:00.",
    schoolLocalTimeDisplay: "09:00",
    matchedEntranceName: "Main Gate",
    campusName: "Main Campus",
  });
  assert.match(successWithEntrance, /Main Gate/);
  assert.match(successWithEntrance, /Main Campus/);

  // 10-13 authority fields stripped
  const sanitized = sanitizeClockGpsBody({
    latitude: 1,
    longitude: 2,
    accuracyMetres: 3,
    schoolId: "x",
    employeeId: "y",
    entranceId: "z",
    distanceMetres: 99,
    insideGeofence: true,
    matchedEntranceId: "m",
  });
  assert.equal(sanitized.latitude, 1);
  assert.equal(sanitized.schoolId, undefined);
  assert.equal(sanitized.employeeId, undefined);
  assert.equal(sanitized.entranceId, undefined);
  assert.equal(sanitized.distanceMetres, undefined);

  console.log("✓ EduClock staff geolocation helper tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
