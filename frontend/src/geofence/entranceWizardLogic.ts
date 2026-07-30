/**
 * Owner Add Entrance wizard helpers (client).
 * Server remains authority for duplicate names, radius, and boundary containment.
 */
import { resolveGpsSignalStatus, type GpsSignalStatus } from "./geofenceCapture";

export const ENTRANCE_WIZARD_RADIUS_DEFAULT = 10;
export const ENTRANCE_RADIUS_MIN = 1;
export const ENTRANCE_RADIUS_MAX = 25;
export const ENTRANCE_NAME_MAX = 80;

export const ENTRANCE_TYPE_OPTIONS = [
  { code: "MAIN_GATE", label: "Main Gate" },
  { code: "HIGH_SCHOOL", label: "High School Entrance" },
  { code: "FOUNDATION_PHASE", label: "Foundation Phase Entrance" },
  { code: "STAFF", label: "Staff Entrance" },
  { code: "TRANSPORT", label: "Transport Entrance" },
  { code: "VISITOR", label: "Visitor Entrance" },
  { code: "OTHER", label: "Other" },
] as const;

export type EntranceTypeCode = (typeof ENTRANCE_TYPE_OPTIONS)[number]["code"];

export type EntranceWizardStep = 1 | 2 | 3;

export function validateEntranceDetails(input: {
  name: string;
  entranceType: EntranceTypeCode | "";
  customTypeLabel: string;
  allowedRadiusMetres: string;
}): { ok: true } | { ok: false; error: string } {
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, error: "Entrance name is required." };
  if (name.length > ENTRANCE_NAME_MAX) {
    return { ok: false, error: `Entrance name must be at most ${ENTRANCE_NAME_MAX} characters.` };
  }
  if (!input.entranceType) return { ok: false, error: "Choose an entrance type." };
  if (input.entranceType === "OTHER" && !String(input.customTypeLabel || "").trim()) {
    return { ok: false, error: "Enter a label for Other entrance type." };
  }
  const radiusRaw = String(input.allowedRadiusMetres || "").trim();
  if (!radiusRaw) return { ok: false, error: "Clock-in radius is required (1–25 metres)." };
  const radius = Number(radiusRaw);
  if (!Number.isFinite(radius) || !Number.isInteger(radius)) {
    return { ok: false, error: "Clock-in radius must be a whole number between 1 and 25." };
  }
  if (radius < ENTRANCE_RADIUS_MIN || radius > ENTRANCE_RADIUS_MAX) {
    return { ok: false, error: "Clock-in radius must be between 1 and 25 metres." };
  }
  return { ok: true };
}

export function validateEntranceLocation(input: {
  latitude: number | null;
  longitude: number | null;
}): { ok: true } | { ok: false; error: string } {
  if (input.latitude == null || input.longitude == null) {
    return { ok: false, error: "Capture your location before continuing." };
  }
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    return { ok: false, error: "Location latitude is invalid. Try again." };
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    return { ok: false, error: "Location longitude is invalid. Try again." };
  }
  return { ok: true };
}

export function gpsStatusForEntrance(accuracyMetres: number | null | undefined): GpsSignalStatus {
  return resolveGpsSignalStatus(accuracyMetres);
}

/** Ray casting — matches backend advisory check (client preview only). */
export function isPointInsidePolygonClient(
  point: { latitude: number; longitude: number },
  ring: Array<{ latitude: number; longitude: number }>
): boolean {
  if (!ring || ring.length < 3) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude;
    const yi = ring[i].latitude;
    const xj = ring[j].longitude;
    const yj = ring[j].latitude;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function boundaryStatusLabel(
  status: "NO_BOUNDARY" | "INSIDE" | "OUTSIDE" | null | undefined
): string {
  if (status === "INSIDE") return "Inside campus boundary";
  if (status === "OUTSIDE") return "Outside campus boundary";
  if (status === "NO_BOUNDARY") return "No campus boundary saved yet";
  return "Boundary status unknown";
}
