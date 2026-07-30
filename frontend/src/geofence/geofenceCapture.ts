/**
 * Owner corner-capture helpers for the Geofence Engine (Save Each Corner).
 * Shared client rules — server remains the authority on final save.
 */

export const GEOFENCE_POLYGON_MIN_VERTICES = 3;
export const GEOFENCE_CORNER_MIN_SEPARATION_METRES = 2;
export const GEOFENCE_CORNER_ACCURACY_WARN_METRES = 20;

export type DraftCorner = {
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
  capturedAt: string;
  id: string;
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isAccuracyWarning(accuracyMetres: number | null | undefined): boolean {
  if (accuracyMetres == null || !Number.isFinite(accuracyMetres)) return true;
  return accuracyMetres > GEOFENCE_CORNER_ACCURACY_WARN_METRES;
}

export type GpsSignalTier = "excellent" | "good" | "weak" | "poor" | "unknown";

export type GpsSignalStatus = {
  tier: GpsSignalTier;
  label: string;
  rangeLabel: string;
  color: string;
  emoji: string;
  tip: string | null;
};

/** Owner-friendly GPS signal tiers for the Save Each Corner status card. */
export function resolveGpsSignalStatus(
  accuracyMetres: number | null | undefined
): GpsSignalStatus {
  if (accuracyMetres == null || !Number.isFinite(accuracyMetres)) {
    return {
      tier: "unknown",
      label: "Waiting",
      rangeLabel: "Signal not ready",
      color: "#94a3b8",
      emoji: "⚪",
      tip: "Move into an open area or wait a few seconds for a stronger GPS signal.",
    };
  }
  if (accuracyMetres <= 5) {
    return {
      tier: "excellent",
      label: "Excellent",
      rangeLabel: "0–5 m",
      color: "#22c55e",
      emoji: "🟢",
      tip: null,
    };
  }
  if (accuracyMetres <= 10) {
    return {
      tier: "good",
      label: "Good",
      rangeLabel: "5–10 m",
      color: "#eab308",
      emoji: "🟡",
      tip: null,
    };
  }
  if (accuracyMetres <= 20) {
    return {
      tier: "weak",
      label: "Weak",
      rangeLabel: "10–20 m",
      color: "#f97316",
      emoji: "🟠",
      tip: "Move into an open area or wait a few seconds for a stronger GPS signal.",
    };
  }
  return {
    tier: "poor",
    label: "Poor",
    rangeLabel: "20+ m",
    color: "#ef4444",
    emoji: "🔴",
    tip: "Move into an open area or wait a few seconds for a stronger GPS signal.",
  };
}

export function canAddCorner(
  corners: DraftCorner[],
  next: { latitude: number; longitude: number }
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(next.latitude) || next.latitude < -90 || next.latitude > 90) {
    return { ok: false, error: "Invalid latitude from GPS." };
  }
  if (!Number.isFinite(next.longitude) || next.longitude < -180 || next.longitude > 180) {
    return { ok: false, error: "Invalid longitude from GPS." };
  }
  if (corners.length > 0) {
    const prev = corners[corners.length - 1];
    const dist = haversineMetres(prev.latitude, prev.longitude, next.latitude, next.longitude);
    if (dist < GEOFENCE_CORNER_MIN_SEPARATION_METRES) {
      return {
        ok: false,
        error: `Too close to the previous corner (${dist.toFixed(1)} m). Move at least ${GEOFENCE_CORNER_MIN_SEPARATION_METRES} m away.`,
      };
    }
  }
  return { ok: true };
}

export function canFinishBoundary(corners: DraftCorner[]): { ok: true } | { ok: false; error: string } {
  if (corners.length < GEOFENCE_POLYGON_MIN_VERTICES) {
    return {
      ok: false,
      error: "Save at least 3 corners before completing the campus boundary.",
    };
  }
  return { ok: true };
}

/** Visual progress rows for Campus Boundary checklist (min 3 + continue hint). */
export function buildBoundaryProgressRows(cornerCount: number): Array<{
  key: string;
  label: string;
  done: boolean;
}> {
  const min = GEOFENCE_POLYGON_MIN_VERTICES;
  const rows: Array<{ key: string; label: string; done: boolean }> = [];
  const shown = Math.max(min, cornerCount);
  for (let i = 1; i <= shown; i++) {
    rows.push({
      key: `corner-${i}`,
      label: `Corner ${i}`,
      done: i <= cornerCount,
    });
  }
  if (cornerCount < min) {
    rows.push({
      key: "continue",
      label: "Continue until complete",
      done: false,
    });
  } else {
    rows.push({
      key: "ready",
      label: "Ready to complete",
      done: true,
    });
  }
  return rows;
}
