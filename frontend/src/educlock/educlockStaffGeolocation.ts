/**
 * EduClock Build 4 Checkpoint 3 — staff mobile geolocation helpers.
 * Location is requested only on Clock In / Clock Out tap (never on page load).
 */

export const EDUCLOCK_GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

export type EduClockGeoPermissionState =
  | "granted"
  | "denied"
  | "unavailable"
  | "timeout";

export type EduClockLocationErrorCode =
  | "PERMISSION_DENIED"
  | "UNAVAILABLE"
  | "TIMEOUT";

export type EduClockCapturedLocation = {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  capturedAtClient: string;
  permissionState: "granted";
};

export type EduClockGeoFailure = {
  permissionState: Exclude<EduClockGeoPermissionState, "granted">;
  locationError: EduClockLocationErrorCode;
  staffMessage: string;
};

/** Payload fields allowed for clock endpoints (never authority fields). */
export type EduClockClockGpsPayload = {
  latitude?: number;
  longitude?: number;
  accuracyMetres?: number;
  capturedAtClient?: string;
  permissionState?: EduClockGeoPermissionState;
  locationError?: EduClockLocationErrorCode;
};

export const EDUCLOCK_GEO_STAFF_MESSAGES = {
  PERMISSION_DENIED:
    "Location permission is required to clock in or out. Enable location access and try again.",
  POSITION_UNAVAILABLE:
    "We could not access your location. Check location services and try again.",
  TIMEOUT: "Your location request timed out. Move into an open area and try again.",
  UNSUPPORTED:
    "Location is unavailable on this device or browser. Try another browser or enable location services.",
} as const;

export function mapGeolocationPositionError(err: GeolocationPositionError): EduClockGeoFailure {
  // Browser codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  if (err.code === 1) {
    return {
      permissionState: "denied",
      locationError: "PERMISSION_DENIED",
      staffMessage: EDUCLOCK_GEO_STAFF_MESSAGES.PERMISSION_DENIED,
    };
  }
  if (err.code === 3) {
    return {
      permissionState: "timeout",
      locationError: "TIMEOUT",
      staffMessage: EDUCLOCK_GEO_STAFF_MESSAGES.TIMEOUT,
    };
  }
  return {
    permissionState: "unavailable",
    locationError: "UNAVAILABLE",
    staffMessage: EDUCLOCK_GEO_STAFF_MESSAGES.POSITION_UNAVAILABLE,
  };
}

export function unsupportedGeolocationFailure(): EduClockGeoFailure {
  return {
    permissionState: "unavailable",
    locationError: "UNAVAILABLE",
    staffMessage: EDUCLOCK_GEO_STAFF_MESSAGES.UNSUPPORTED,
  };
}

export function buildClockPayloadFromCapture(
  capture: EduClockCapturedLocation
): EduClockClockGpsPayload {
  return {
    latitude: capture.latitude,
    longitude: capture.longitude,
    accuracyMetres: capture.accuracyMetres,
    capturedAtClient: capture.capturedAtClient,
    permissionState: "granted",
  };
}

export function buildClockPayloadFromGeoFailure(
  failure: EduClockGeoFailure
): EduClockClockGpsPayload {
  // No fabricated coordinates — backend audits via permissionState / locationError.
  return {
    permissionState: failure.permissionState,
    locationError: failure.locationError,
  };
}

export function captureStaffGeolocation(
  getCurrentPosition?: Geolocation["getCurrentPosition"] | null
): Promise<{ ok: true; location: EduClockCapturedLocation } | { ok: false; failure: EduClockGeoFailure }> {
  const getter =
    getCurrentPosition ||
    (typeof navigator !== "undefined" && navigator.geolocation
      ? navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
      : null);

  if (!getter) {
    return Promise.resolve({ ok: false, failure: unsupportedGeolocationFailure() });
  }

  return new Promise((resolve) => {
    getter(
      (pos) => {
        const coords = pos.coords;
        const accuracy = Number(coords.accuracy);
        resolve({
          ok: true,
          location: {
            latitude: Number(coords.latitude),
            longitude: Number(coords.longitude),
            accuracyMetres: Number.isFinite(accuracy) ? accuracy : Number.NaN,
            capturedAtClient: new Date().toISOString(),
            permissionState: "granted",
          },
        });
      },
      (err) => {
        resolve({ ok: false, failure: mapGeolocationPositionError(err) });
      },
      EDUCLOCK_GEO_OPTIONS
    );
  });
}

/** Prefer staff-facing browser message for geo failures; otherwise backend message. */
export function resolveClockErrorMessage(input: {
  backendMessage?: string;
  geoFailure?: EduClockGeoFailure | null;
}): string {
  if (input.geoFailure?.staffMessage) return input.geoFailure.staffMessage;
  if (input.backendMessage) return input.backendMessage;
  return "Clock action failed. Please try again.";
}

export function sanitizeClockGpsBody(gps?: Record<string, unknown>): Record<string, unknown> {
  const body = { ...(gps || {}) };
  // Never send authority fields from the client.
  delete body.schoolId;
  delete body.employeeId;
  delete body.userId;
  delete body.entranceId;
  delete body.distanceMetres;
  delete body.insideGeofence;
  delete body.matchedEntranceId;
  delete body.occurredAt;
  delete body.occurredAtUtc;
  delete body.timestamp;
  return body;
}

export function formatClockSuccessMessage(input: {
  action: "in" | "out";
  backendMessage?: string;
  schoolLocalTimeDisplay?: string | null;
  matchedEntranceName?: string | null;
  campusName?: string | null;
}): string {
  const base =
    input.backendMessage ||
    (input.action === "in" ? "Clocked in successfully." : "Clocked out successfully.");
  const bits: string[] = [base];
  if (input.schoolLocalTimeDisplay) {
    bits.push(`Server time ${input.schoolLocalTimeDisplay}`);
  }
  if (input.matchedEntranceName) {
    const place = input.campusName
      ? `${input.matchedEntranceName} (${input.campusName})`
      : input.matchedEntranceName;
    bits.push(`Entrance: ${place}`);
  }
  return bits.join(" · ");
}
