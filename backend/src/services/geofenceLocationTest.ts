/**
 * Owner Location Test Mode — read-only simulation.
 * Never creates EduClockEvent, EduClockGpsAttempt, attendance, or payroll records.
 * Current real clock rule remains entrance-radius based; polygon flag stays informational.
 *
 * Accuracy / radius thresholds must stay aligned with educlockGpsValidation.ts
 * (imported constants avoided here to prevent circular load with EduClockError).
 */
import {
  haversineDistanceMetres,
  isValidLatitude,
  isValidLongitude,
  roundDistanceMetresForStorage,
} from "../utils/educlockGpsDistance";
import { isPointInsidePolygon } from "./geofenceGeometry";
import { isGeofencePolygonValidationEnabled } from "./geofencePolygonValidationFlag";

/** Keep in sync with EDUCLOCK_GPS_* in educlockGpsValidation.ts */
const GPS_MAX_ACCURACY_METRES = 20;
const GPS_DEFAULT_RADIUS_METRES = 5;
const GPS_MIN_RADIUS_METRES = 1;
const GPS_MAX_RADIUS_METRES = 25;

export type LocationTestEntrance = {
  id: string;
  name: string;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMetres: number | null;
};

export type OwnerLocationSimulationInput = {
  campusId: string;
  campusName: string;
  campusActive: boolean;
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  boundaryRing: Array<{ latitude: number; longitude: number }> | null;
  entrances: LocationTestEntrance[];
  /** Injected for tests; production uses the env flag helper. */
  polygonRuleEnabled?: boolean;
};

export type OwnerLocationSimulationResult = {
  campusId: string;
  campusName: string;
  campusActive: boolean;
  campusBoundaryAvailable: boolean;
  isInsideCampusBoundary: boolean | null;
  nearestActiveEntranceId: string | null;
  nearestActiveEntranceName: string | null;
  nearestEntranceName: string | null;
  distanceToNearestEntranceMetres: number | null;
  entranceRadiusMetres: number | null;
  isWithinEntranceRadius: boolean | null;
  reportedAccuracyMetres: number;
  accuracyAcceptedByCurrentClockRule: boolean;
  currentEntranceRuleWouldAccept: boolean;
  polygonRuleEnabled: boolean;
  futurePolygonAwareRuleWouldAccept: boolean | null;
  simulatedOverallResult: {
    currentClockRule: "ACCEPTED" | "REJECTED";
    futurePolygonAwareRule: "ACCEPTED" | "REJECTED" | "NOT_EVALUABLE";
    polygonEnforcement: "NOT_ENABLED" | "ENABLED";
  };
  rejectionReason: string | null;
  rejectionCode:
    | "INACTIVE_CAMPUS"
    | "GPS_ACCURACY_TOO_LOW"
    | "GPS_ACCURACY_INVALID"
    | "NO_ACTIVE_ENTRANCE"
    | "NO_GPS_READY_ENTRANCE"
    | "OUTSIDE_ENTRANCE_RADIUS"
    | "INVALID_COORDINATES"
    | null;
  activeEntranceCount: number;
  gpsReadyEntranceCount: number;
  simulationOnly: true;
  recordsCreated: {
    eduClockEvent: 0;
    eduClockGpsAttempt: 0;
    attendance: 0;
    payroll: 0;
  };
};

function normalizeRadius(raw: number | null | undefined): number {
  let radius = raw == null || !Number.isFinite(Number(raw)) ? GPS_DEFAULT_RADIUS_METRES : Number(raw);
  return Math.min(
    GPS_MAX_RADIUS_METRES,
    Math.max(GPS_MIN_RADIUS_METRES, Math.floor(radius))
  );
}

function isGpsReadyEntrance(e: LocationTestEntrance): boolean {
  if (!e.isActive) return false;
  if (e.latitude == null || e.longitude == null) return false;
  if (!isValidLatitude(e.latitude) || !isValidLongitude(e.longitude)) return false;
  return true;
}

/**
 * Pure owner location simulation (no DB, no writes).
 */
export function evaluateOwnerLocationSimulation(
  input: OwnerLocationSimulationInput
): OwnerLocationSimulationResult {
  const polygonRuleEnabled =
    input.polygonRuleEnabled !== undefined
      ? Boolean(input.polygonRuleEnabled)
      : isGeofencePolygonValidationEnabled();

  const base = {
    campusId: input.campusId,
    campusName: input.campusName,
    campusActive: input.campusActive,
    simulationOnly: true as const,
    recordsCreated: {
      eduClockEvent: 0 as const,
      eduClockGpsAttempt: 0 as const,
      attendance: 0 as const,
      payroll: 0 as const,
    },
    polygonRuleEnabled,
  };

  const finish = (
    partial: Omit<
      OwnerLocationSimulationResult,
      | "campusId"
      | "campusName"
      | "campusActive"
      | "simulationOnly"
      | "recordsCreated"
      | "polygonRuleEnabled"
      | "simulatedOverallResult"
      | "futurePolygonAwareRuleWouldAccept"
      | "nearestEntranceName"
    > & {
      futurePolygonAwareRuleWouldAccept?: boolean | null;
    }
  ): OwnerLocationSimulationResult => {
    const future =
      partial.futurePolygonAwareRuleWouldAccept !== undefined
        ? partial.futurePolygonAwareRuleWouldAccept
        : partial.campusBoundaryAvailable
          ? Boolean(partial.currentEntranceRuleWouldAccept && partial.isInsideCampusBoundary)
          : null;

    return {
      ...base,
      ...partial,
      nearestEntranceName: partial.nearestActiveEntranceName,
      futurePolygonAwareRuleWouldAccept: future,
      simulatedOverallResult: {
        currentClockRule: partial.currentEntranceRuleWouldAccept ? "ACCEPTED" : "REJECTED",
        futurePolygonAwareRule:
          future == null ? "NOT_EVALUABLE" : future ? "ACCEPTED" : "REJECTED",
        polygonEnforcement: polygonRuleEnabled ? "ENABLED" : "NOT_ENABLED",
      },
    };
  };

  if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) {
    return finish({
      campusBoundaryAvailable: false,
      isInsideCampusBoundary: null,
      nearestActiveEntranceId: null,
      nearestActiveEntranceName: null,
      distanceToNearestEntranceMetres: null,
      entranceRadiusMetres: null,
      isWithinEntranceRadius: null,
      reportedAccuracyMetres: input.accuracyMetres,
      accuracyAcceptedByCurrentClockRule: false,
      currentEntranceRuleWouldAccept: false,
      rejectionReason: "Location coordinates are invalid.",
      rejectionCode: "INVALID_COORDINATES",
      activeEntranceCount: 0,
      gpsReadyEntranceCount: 0,
      futurePolygonAwareRuleWouldAccept: null,
    });
  }

  const campusBoundaryAvailable = Boolean(
    input.boundaryRing && input.boundaryRing.length >= 3
  );
  const isInsideCampusBoundary = campusBoundaryAvailable
    ? isPointInsidePolygon(
        { latitude: input.latitude, longitude: input.longitude },
        input.boundaryRing!
      )
    : null;

  const activeEntrances = input.entrances.filter((e) => e.isActive);
  const gpsReady = input.entrances.filter(isGpsReadyEntrance);

  const accuracyOk =
    Number.isFinite(input.accuracyMetres) &&
    input.accuracyMetres > 0 &&
    input.accuracyMetres <= GPS_MAX_ACCURACY_METRES;

  let nearest: {
    id: string;
    name: string;
    distanceRaw: number;
    radius: number;
  } | null = null;

  for (const e of gpsReady) {
    const distanceRaw = haversineDistanceMetres(
      { latitude: input.latitude, longitude: input.longitude },
      { latitude: e.latitude!, longitude: e.longitude! }
    );
    const radius = normalizeRadius(e.allowedRadiusMetres);
    if (!nearest || distanceRaw < nearest.distanceRaw || (distanceRaw === nearest.distanceRaw && e.id < nearest.id)) {
      nearest = { id: e.id, name: e.name, distanceRaw, radius };
    }
  }

  const distanceRounded =
    nearest == null ? null : roundDistanceMetresForStorage(nearest.distanceRaw);
  const withinRadius =
    nearest == null ? null : nearest.distanceRaw <= nearest.radius;

  const sharedNearest = {
    campusBoundaryAvailable,
    isInsideCampusBoundary,
    nearestActiveEntranceId: nearest?.id ?? null,
    nearestActiveEntranceName: nearest?.name ?? null,
    distanceToNearestEntranceMetres: distanceRounded,
    entranceRadiusMetres: nearest?.radius ?? null,
    isWithinEntranceRadius: withinRadius,
    reportedAccuracyMetres: input.accuracyMetres,
    accuracyAcceptedByCurrentClockRule: accuracyOk,
    activeEntranceCount: activeEntrances.length,
    gpsReadyEntranceCount: gpsReady.length,
  };

  if (!Number.isFinite(input.accuracyMetres) || input.accuracyMetres <= 0) {
    return finish({
      ...sharedNearest,
      accuracyAcceptedByCurrentClockRule: false,
      currentEntranceRuleWouldAccept: false,
      rejectionReason: "Location accuracy is invalid.",
      rejectionCode: "GPS_ACCURACY_INVALID",
    });
  }

  if (!accuracyOk) {
    return finish({
      ...sharedNearest,
      currentEntranceRuleWouldAccept: false,
      rejectionReason: `GPS accuracy is ±${Math.round(input.accuracyMetres)} m. The current clock-in rule needs ±${GPS_MAX_ACCURACY_METRES} m or better.`,
      rejectionCode: "GPS_ACCURACY_TOO_LOW",
    });
  }

  if (!input.campusActive) {
    return finish({
      ...sharedNearest,
      currentEntranceRuleWouldAccept: false,
      rejectionReason: "This campus is inactive. Activate the campus before staff can clock in here.",
      rejectionCode: "INACTIVE_CAMPUS",
    });
  }

  if (activeEntrances.length === 0) {
    return finish({
      ...sharedNearest,
      currentEntranceRuleWouldAccept: false,
      rejectionReason: "No active entrances are configured for this campus.",
      rejectionCode: "NO_ACTIVE_ENTRANCE",
    });
  }

  if (gpsReady.length === 0) {
    return finish({
      ...sharedNearest,
      currentEntranceRuleWouldAccept: false,
      rejectionReason:
        "No GPS-ready entrances are configured. Add an active entrance with coordinates first.",
      rejectionCode: "NO_GPS_READY_ENTRANCE",
    });
  }

  if (!withinRadius || !nearest) {
    return finish({
      ...sharedNearest,
      currentEntranceRuleWouldAccept: false,
      rejectionReason: nearest
        ? `You are ${distanceRounded} m from ${nearest.name}. The allowed radius is ${nearest.radius} m.`
        : "You are outside the permitted school clocking area.",
      rejectionCode: "OUTSIDE_ENTRANCE_RADIUS",
    });
  }

  return finish({
    ...sharedNearest,
    currentEntranceRuleWouldAccept: true,
    rejectionReason: null,
    rejectionCode: null,
  });
}
