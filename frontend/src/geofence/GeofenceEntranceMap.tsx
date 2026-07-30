/**
 * Entrance setup map — boundary, existing entrances, you-are-here, draggable new pin.
 * Never centres on a hard-coded city.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import { createOwnerGeofenceMap, fitMapToRealPoints } from "./ownerGeofenceMap";

export type EntranceMapPoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

type Props = {
  boundary: Array<{ latitude: number; longitude: number }>;
  existingEntrances: EntranceMapPoint[];
  live: { latitude: number; longitude: number; accuracyMetres: number | null } | null;
  marker: { latitude: number; longitude: number } | null;
  onMarkerMove: (lat: number, lng: number) => void;
  height?: number | string;
  fill?: boolean;
};

const GOLD = "#c9a227";
const YOU = "#3b82f6";
const EXISTING = "#a3a3a3";
const NEW = "#f59e0b";

export default function GeofenceEntranceMap({
  boundary,
  existingEntrances,
  live,
  marker,
  onMarkerMove,
  height = 280,
  fill = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const dragMarkerRef = useRef<L.Marker | null>(null);
  const hasRealViewRef = useRef(false);
  const onMoveRef = useRef(onMarkerMove);
  onMoveRef.current = onMarkerMove;

  const hasGeometry =
    boundary.length >= 3 || existingEntrances.length > 0 || Boolean(live) || Boolean(marker);

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
      dragMarkerRef.current = null;
      hasRealViewRef.current = false;
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

    for (const e of existingEntrances) {
      L.circleMarker([e.latitude, e.longitude], {
        radius: 7,
        color: "#111",
        weight: 1,
        fillColor: EXISTING,
        fillOpacity: 1,
      })
        .bindTooltip(e.name, { direction: "top" })
        .addTo(layers);
    }

    if (live) {
      L.circleMarker([live.latitude, live.longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: YOU,
        fillOpacity: 1,
      })
        .bindTooltip("You are here", { direction: "top" })
        .addTo(layers);
      if (live.accuracyMetres != null && Number.isFinite(live.accuracyMetres)) {
        L.circle([live.latitude, live.longitude], {
          radius: Math.max(1, live.accuracyMetres),
          color: YOU,
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(layers);
      }
    }

    if (marker) {
      if (dragMarkerRef.current) {
        dragMarkerRef.current.remove();
        dragMarkerRef.current = null;
      }
      const icon = L.divIcon({
        className: "geofence-new-entrance-marker",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:${NEW};border:2px solid #111;box-shadow:0 0 0 3px rgba(245,158,11,0.35)"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const m = L.marker([marker.latitude, marker.longitude], {
        draggable: true,
        icon,
      })
        .bindTooltip("New entrance (drag to adjust)", { permanent: false })
        .addTo(map);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        onMoveRef.current(ll.lat, ll.lng);
      });
      dragMarkerRef.current = m;
    } else if (dragMarkerRef.current) {
      dragMarkerRef.current.remove();
      dragMarkerRef.current = null;
    }

    const points: L.LatLngExpression[] = [];
    for (const p of boundary) points.push([p.latitude, p.longitude]);
    for (const e of existingEntrances) points.push([e.latitude, e.longitude]);
    if (live) points.push([live.latitude, live.longitude]);
    if (marker) points.push([marker.latitude, marker.longitude]);

    if (live || marker) {
      const focus = marker
        ? ([marker.latitude, marker.longitude] as L.LatLngExpression)
        : ([live!.latitude, live!.longitude] as L.LatLngExpression);
      if (!hasRealViewRef.current) {
        map.setView(focus, 18, { animate: true });
        hasRealViewRef.current = true;
      } else {
        map.panTo(focus, { animate: true, duration: 0.3 });
      }
    } else if (points.length > 0 && !hasRealViewRef.current) {
      fitMapToRealPoints(map, points, { maxZoom: 18, animate: false });
      hasRealViewRef.current = true;
    }

    map.invalidateSize();
  }, [boundary, existingEntrances, live, marker]);

  if (!hasGeometry) {
    return (
      <div
        data-testid="entrance-map-waiting"
        style={{
          width: "100%",
          height: fill ? "100%" : height,
          minHeight: fill ? 240 : undefined,
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
        Waiting for your location…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
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
