/**
 * Owner Location Test map — boundary, entrances, nearest highlight, radius, you-are-here line.
 * Never centres on a hard-coded city. Empty until real boundary / entrance / GPS points exist.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import { createOwnerGeofenceMap, fitMapToRealPoints } from "./ownerGeofenceMap";

export type LocationTestMapEntrance = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  allowedRadiusMetres?: number | null;
  isNearest?: boolean;
};

type Props = {
  boundary: Array<{ latitude: number; longitude: number }>;
  entrances: LocationTestMapEntrance[];
  /** Real GPS only — never pass preview/mock coordinates in live owner sessions. */
  current: { latitude: number; longitude: number; accuracyMetres: number | null } | null;
  nearestEntranceId: string | null;
  entranceRadiusMetres: number | null;
  height?: number | string;
  fill?: boolean;
  waitingLabel?: string;
};

const GOLD = "#c9a227";
const YOU = "#3b82f6";
const NEAREST = "#f59e0b";
const OTHER = "#a3a3a3";

export default function GeofenceLocationTestMap({
  boundary,
  entrances,
  current,
  nearestEntranceId,
  entranceRadiusMetres,
  height = 280,
  fill = false,
  waitingLabel = "Waiting for your location…",
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const hasRealViewRef = useRef(false);
  const lastGpsKeyRef = useRef<string | null>(null);

  const hasGeometry = boundary.length >= 3 || entrances.length > 0 || Boolean(current);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!hasGeometry) return;

    const map = createOwnerGeofenceMap(containerRef.current);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resize = () => map.invalidateSize();
    setTimeout(resize, 50);
    setTimeout(resize, 250);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      hasRealViewRef.current = false;
      lastGpsKeyRef.current = null;
    };
  }, [hasGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    if (boundary.length >= 3) {
      const ring = boundary.map((p) => [p.latitude, p.longitude] as L.LatLngExpression);
      L.polygon(ring, {
        color: GOLD,
        weight: 2,
        fillColor: GOLD,
        fillOpacity: 0.12,
      })
        .bindTooltip("Campus boundary", { sticky: true })
        .addTo(layers);
    }

    const nearest =
      entrances.find((e) => e.id === nearestEntranceId) ||
      entrances.find((e) => e.isNearest) ||
      null;

    for (const e of entrances) {
      const isNear = nearest && e.id === nearest.id;
      L.circleMarker([e.latitude, e.longitude], {
        radius: isNear ? 9 : 7,
        color: "#111",
        weight: isNear ? 2 : 1,
        fillColor: isNear ? NEAREST : OTHER,
        fillOpacity: 1,
      })
        .bindTooltip(isNear ? `${e.name} (nearest)` : e.name, { direction: "top" })
        .addTo(layers);
    }

    if (nearest && entranceRadiusMetres != null && Number.isFinite(entranceRadiusMetres)) {
      L.circle([nearest.latitude, nearest.longitude], {
        radius: Math.max(1, entranceRadiusMetres),
        color: NEAREST,
        weight: 2,
        dashArray: "4 6",
        fillColor: NEAREST,
        fillOpacity: 0.08,
      })
        .bindTooltip(`Allowed radius ${entranceRadiusMetres} m`, { sticky: true })
        .addTo(layers);
    }

    if (current) {
      L.circleMarker([current.latitude, current.longitude], {
        radius: 9,
        color: "#fff",
        weight: 2,
        fillColor: YOU,
        fillOpacity: 1,
      })
        .bindTooltip("You are here", { direction: "top" })
        .addTo(layers);
      if (current.accuracyMetres != null && Number.isFinite(current.accuracyMetres)) {
        L.circle([current.latitude, current.longitude], {
          radius: Math.max(1, current.accuracyMetres),
          color: YOU,
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(layers);
      }
      if (nearest) {
        L.polyline(
          [
            [current.latitude, current.longitude],
            [nearest.latitude, nearest.longitude],
          ],
          { color: GOLD, weight: 2, dashArray: "6 8" }
        ).addTo(layers);
      }
    }

    const points: L.LatLngExpression[] = [];
    for (const p of boundary) points.push([p.latitude, p.longitude]);
    for (const e of entrances) points.push([e.latitude, e.longitude]);
    if (current) points.push([current.latitude, current.longitude]);

    if (current) {
      const gpsKey = `${current.latitude.toFixed(6)},${current.longitude.toFixed(6)}`;
      if (lastGpsKeyRef.current !== gpsKey) {
        map.setView([current.latitude, current.longitude], 18, { animate: true });
        lastGpsKeyRef.current = gpsKey;
        hasRealViewRef.current = true;
      } else {
        map.panTo([current.latitude, current.longitude], { animate: true, duration: 0.25 });
      }
    } else if (points.length > 0 && !hasRealViewRef.current) {
      fitMapToRealPoints(map, points, { maxZoom: 18, animate: false });
      hasRealViewRef.current = true;
    }

    map.invalidateSize();
  }, [boundary, entrances, current, nearestEntranceId, entranceRadiusMetres]);

  if (!hasGeometry) {
    return (
      <div
        data-testid="location-test-map-waiting"
        style={{
          width: "100%",
          height: fill ? "100%" : height,
          minHeight: fill ? 240 : undefined,
          borderRadius: fill ? 0 : 16,
          overflow: "hidden",
          border: fill ? "none" : "1px solid rgba(201,162,39,0.35)",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#a3a3a3",
          fontWeight: 700,
          fontSize: 14,
          textAlign: "center",
          padding: 24,
        }}
      >
        {waitingLabel}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="location-test-map"
      style={{
        width: "100%",
        height: fill ? "100%" : height,
        minHeight: fill ? 0 : undefined,
        borderRadius: fill ? 0 : 16,
        overflow: "hidden",
        border: fill ? "none" : "1px solid rgba(201,162,39,0.35)",
        background: "#0a0a0a",
      }}
    />
  );
}
