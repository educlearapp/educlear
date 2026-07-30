/**
 * Shared Geofence Engine API client (not EduClock-only).
 */
import { apiFetch } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";

export type GeofenceZoneType =
  | "CAMPUS_BOUNDARY"
  | "ENTRANCE"
  | "STAFF_ENTRANCE"
  | "VISITOR_ENTRANCE"
  | "FOUNDATION_PHASE"
  | "HIGH_SCHOOL"
  | "TRANSPORT"
  | "ASSEMBLY_POINT"
  | "EXCLUSION_ZONE"
  | "CUSTOM";

export type GeofenceVertexRow = {
  id: string;
  sequence: number;
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
  capturedAt: string | null;
};

export type GeofenceZoneRow = {
  id: string;
  schoolId: string;
  name: string;
  type: GeofenceZoneType;
  active: boolean;
  geometryKind: "POLYGON" | "POINT";
  geometry: unknown;
  metadata: unknown;
  campusId: string | null;
  createdAt: string;
  updatedAt: string;
  vertices: GeofenceVertexRow[];
  vertexCount: number;
  polygonValidationEnabled: boolean;
};

export type GeofenceCornerPayload = {
  latitude: number;
  longitude: number;
  accuracyMetres?: number | null;
  capturedAt?: string | null;
};

export async function fetchGeofenceStatus(): Promise<{
  schoolId: string;
  polygonValidationEnabled: boolean;
  note?: string;
}> {
  return apiFetch("/api/geofences/status", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{ schoolId: string; polygonValidationEnabled: boolean; note?: string }>;
}

export async function fetchGeofenceZones(filters?: {
  type?: GeofenceZoneType;
  campusId?: string;
  activeOnly?: boolean;
}): Promise<{ schoolId: string; polygonValidationEnabled: boolean; zones: GeofenceZoneRow[] }> {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.campusId) params.set("campusId", filters.campusId);
  if (filters?.activeOnly) params.set("activeOnly", "true");
  const qs = params.toString();
  return apiFetch(`/api/geofences/zones${qs ? `?${qs}` : ""}`, {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{
    schoolId: string;
    polygonValidationEnabled: boolean;
    zones: GeofenceZoneRow[];
  }>;
}

export async function saveCampusBoundaryPolygon(input: {
  campusId: string;
  name?: string;
  vertices: GeofenceCornerPayload[];
  metadata?: Record<string, unknown>;
}): Promise<{
  zone: GeofenceZoneRow;
  polygonValidationEnabled: boolean;
  clockBehaviourUnchanged: boolean;
  message: string;
}> {
  return apiFetch("/api/geofences/campus-boundaries", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<{
    zone: GeofenceZoneRow;
    polygonValidationEnabled: boolean;
    clockBehaviourUnchanged: boolean;
    message: string;
  }>;
}

export async function fetchCampusBoundaryZone(campusId: string): Promise<{
  zone: GeofenceZoneRow | null;
  polygonValidationEnabled: boolean;
}> {
  return apiFetch(`/api/geofences/campus-boundaries/${encodeURIComponent(campusId)}`, {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{ zone: GeofenceZoneRow | null; polygonValidationEnabled: boolean }>;
}

export async function checkCampusBoundaryContainment(input: {
  campusId: string;
  latitude: number;
  longitude: number;
}): Promise<{
  status: "NO_BOUNDARY" | "INSIDE" | "OUTSIDE";
  zoneId?: string;
  advisoryOnly?: boolean;
}> {
  return apiFetch("/api/geofences/containment-check", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<{
    status: "NO_BOUNDARY" | "INSIDE" | "OUTSIDE";
    zoneId?: string;
    advisoryOnly?: boolean;
  }>;
}

export type OwnerLocationTestResult = {
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
  rejectionCode: string | null;
  activeEntranceCount: number;
  gpsReadyEntranceCount: number;
  simulationOnly: true;
  recordsCreated: {
    eduClockEvent: 0;
    eduClockGpsAttempt: 0;
    attendance: 0;
    payroll: 0;
  };
  map: {
    boundary: Array<{ latitude: number; longitude: number }>;
    entrances: Array<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      allowedRadiusMetres: number | null;
      isNearest: boolean;
    }>;
    current: { latitude: number; longitude: number; accuracyMetres: number };
  };
  note?: string;
};

/** Read-only owner simulation — never creates clock or GPS-attempt records. */
export async function testOwnerLocation(input: {
  campusId: string;
  latitude: number;
  longitude: number;
  accuracyMetres: number;
}): Promise<OwnerLocationTestResult> {
  return apiFetch("/api/geofences/test-location", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<OwnerLocationTestResult>;
}
