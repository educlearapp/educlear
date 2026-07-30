/**
 * Shared Leaflet bootstrap for owner geofence maps.
 * Never centres on a hard-coded city (e.g. Johannesburg / Carlton).
 * Call fitBounds / setView only with real GPS, boundary, or entrance coordinates.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export function createOwnerGeofenceMap(container: HTMLElement): L.Map {
  // Intentionally no setView / no default lat-lng — Leaflet allows deferred view.
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

export function fitMapToRealPoints(
  map: L.Map,
  points: L.LatLngExpression[],
  options?: { maxZoom?: number; animate?: boolean; padding?: number }
): boolean {
  if (!points.length) return false;
  if (points.length === 1) {
    map.setView(points[0], options?.maxZoom ?? 18, {
      animate: options?.animate ?? true,
    });
    return true;
  }
  map.fitBounds(L.latLngBounds(points), {
    padding: [options?.padding ?? 36, options?.padding ?? 36],
    maxZoom: options?.maxZoom ?? 18,
    animate: options?.animate ?? true,
  });
  return true;
}

/** Known Phase 2C preview / fixture coordinate — must never appear as a live map default. */
export const FORBIDDEN_DEFAULT_MAP_CENTER = {
  latitude: -26.2041,
  longitude: 28.0473,
  label: "Carlton / Johannesburg hard-coded default",
} as const;
