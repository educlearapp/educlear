/**
 * Lightweight Leaflet map for Geofence Engine owner capture.
 * Live position + growing polygon preview for owner boundary / entrance setup.
 * Never centres on a hard-coded city.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import { createOwnerGeofenceMap, fitMapToRealPoints } from "./ownerGeofenceMap";

export type MapCorner = {
  id: string;
  latitude: number;
  longitude: number;
};

export type MapLivePosition = {
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
} | null;

type Props = {
  corners: MapCorner[];
  live: MapLivePosition;
  /** When set, map fills parent height instead of fixed px. */
  fill?: boolean;
  height?: number | string;
  /** Bump to animate the newest corner marker. */
  animateCornerKey?: string | null;
};

const DEFAULT_ZOOM = 17;
const GOLD = "#c9a227";
const YOU = "#3b82f6";

export default function GeofenceLiveMap({
  corners,
  live,
  fill = false,
  height = 320,
  animateCornerKey = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const hasRealViewRef = useRef(false);
  const lastAnimatedRef = useRef<string | null>(null);

  const hasGeometry = corners.length > 0 || Boolean(live);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!hasGeometry) return;

    const map = createOwnerGeofenceMap(containerRef.current);
    const layers = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layers;

    const resize = () => map.invalidateSize();
    setTimeout(resize, 50);
    setTimeout(resize, 250);
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      hasRealViewRef.current = false;
    };
  }, [hasGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = window.setTimeout(() => map.invalidateSize(), 40);
    return () => window.clearTimeout(t);
  }, [fill, height, corners.length]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layerRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    const latLngs: L.LatLngExpression[] = corners.map((c) => [c.latitude, c.longitude]);

    if (corners.length > 0 && live) {
      const last = corners[corners.length - 1];
      L.polyline(
        [
          [last.latitude, last.longitude],
          [live.latitude, live.longitude],
        ],
        {
          color: GOLD,
          weight: 2,
          opacity: 0.55,
          dashArray: "6 8",
        }
      ).addTo(layers);
    }

    if (latLngs.length >= 2) {
      L.polyline(latLngs, { color: GOLD, weight: 4, opacity: 0.98 }).addTo(layers);
    }
    if (latLngs.length >= 3) {
      L.polygon(latLngs, {
        color: GOLD,
        weight: 2,
        fillColor: GOLD,
        fillOpacity: 0.22,
      }).addTo(layers);
    }

    corners.forEach((c, i) => {
      const isNewest =
        animateCornerKey != null &&
        c.id === animateCornerKey &&
        lastAnimatedRef.current !== animateCornerKey;
      const marker = L.circleMarker([c.latitude, c.longitude], {
        radius: isNewest ? 12 : 8,
        color: "#111827",
        weight: 2,
        fillColor: GOLD,
        fillOpacity: 1,
        className: isNewest ? "geofence-corner-pulse" : undefined,
      })
        .bindTooltip(`Corner ${i + 1}`, { permanent: false, direction: "top" })
        .addTo(layers);

      if (isNewest) {
        lastAnimatedRef.current = animateCornerKey;
        window.setTimeout(() => {
          marker.setRadius(8);
        }, 700);
      }
    });

    if (live) {
      L.circleMarker([live.latitude, live.longitude], {
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: YOU,
        fillOpacity: 1,
      })
        .bindTooltip("You are here", { permanent: false, direction: "top" })
        .addTo(layers);

      if (live.accuracyMetres != null && Number.isFinite(live.accuracyMetres)) {
        L.circle([live.latitude, live.longitude], {
          radius: Math.max(1, live.accuracyMetres),
          color: YOU,
          weight: 1,
          fillColor: YOU,
          fillOpacity: 0.1,
        }).addTo(layers);
      }
    }

    if (live) {
      const focus = [live.latitude, live.longitude] as L.LatLngExpression;
      if (!hasRealViewRef.current) {
        map.setView(focus, DEFAULT_ZOOM, { animate: true });
        hasRealViewRef.current = true;
      } else {
        map.panTo(focus, { animate: true, duration: 0.35 });
      }
    } else if (latLngs.length > 0 && !hasRealViewRef.current) {
      fitMapToRealPoints(map, latLngs, { maxZoom: DEFAULT_ZOOM, animate: false });
      hasRealViewRef.current = true;
    }

    map.invalidateSize();
  }, [corners, live, animateCornerKey]);

  if (!hasGeometry) {
    return (
      <div
        data-testid="live-map-waiting"
        className="geofence-live-map"
        style={{
          width: "100%",
          height: fill ? "100%" : height,
          minHeight: fill ? 240 : undefined,
          borderRadius: fill ? 0 : 16,
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
      className="geofence-live-map"
      style={{
        width: "100%",
        height: fill ? "100%" : height,
        minHeight: fill ? 0 : undefined,
        borderRadius: fill ? 0 : 16,
        overflow: "hidden",
        border: fill ? "none" : "1px solid rgba(201,162,39,0.35)",
        background: "#0a0a0a",
        boxShadow: fill ? "none" : "0 8px 28px rgba(0,0,0,0.35)",
      }}
    />
  );
}
