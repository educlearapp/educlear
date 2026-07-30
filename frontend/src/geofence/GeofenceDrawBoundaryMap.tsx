/**
 * Draw Campus Boundary map — custom Leaflet interaction (no leaflet-draw).
 * Modes: navigate (pan/zoom only) | drawing (tap adds points) | editing (drag / insert / remove).
 * Never centres on a hard-coded city.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import { createOwnerGeofenceMap, fitMapToRealPoints } from "./ownerGeofenceMap";
import {
  GEOFENCE_CLOSE_TO_START_METRES,
  GEOFENCE_POLYGON_MIN_VERTICES,
  haversineMetres,
  type DrawEntranceOverlay,
  type DrawPoint,
} from "./geofenceDrawBoundary";

export type DrawMapMode = "navigate" | "drawing" | "editing";

type Props = {
  points: DrawPoint[];
  closed: boolean;
  mode: DrawMapMode;
  savedBoundary: Array<{ latitude: number; longitude: number }>;
  entrances: DrawEntranceOverlay[];
  live: { latitude: number; longitude: number } | null;
  fill?: boolean;
  height?: number | string;
  onAddPoint: (lat: number, lng: number) => void;
  onMovePoint: (id: string, lat: number, lng: number) => void;
  onInsertPoint: (afterIndex: number, lat: number, lng: number) => void;
  onRemovePoint: (id: string) => void;
  onCloseAtStart: () => void;
  onLocateDone?: () => void;
  locateToken?: number;
};

const GOLD = "#c9a227";
const START = "#22c55e";
const ENTRANCE_IN = "#38bdf8";
const ENTRANCE_OUT = "#f97316";
const YOU = "#3b82f6";

export default function GeofenceDrawBoundaryMap({
  points,
  closed,
  mode,
  savedBoundary,
  entrances,
  live,
  fill = true,
  height = "100%",
  onAddPoint,
  onMovePoint,
  onInsertPoint,
  onRemovePoint,
  onCloseAtStart,
  onLocateDone,
  locateToken = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayersRef = useRef<L.LayerGroup | null>(null);
  const draftLayersRef = useRef<L.LayerGroup | null>(null);
  const hasRealViewRef = useRef(false);
  const modeRef = useRef(mode);
  const pointsRef = useRef(points);
  const closedRef = useRef(closed);
  const handlersRef = useRef({
    onAddPoint,
    onMovePoint,
    onInsertPoint,
    onRemovePoint,
    onCloseAtStart,
  });

  modeRef.current = mode;
  pointsRef.current = points;
  closedRef.current = closed;
  handlersRef.current = {
    onAddPoint,
    onMovePoint,
    onInsertPoint,
    onRemovePoint,
    onCloseAtStart,
  };

  const hasAnchor =
    points.length > 0 ||
    savedBoundary.length >= 3 ||
    entrances.length > 0 ||
    Boolean(live);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!hasAnchor) return;

    const map = createOwnerGeofenceMap(containerRef.current);
    baseLayersRef.current = L.layerGroup().addTo(map);
    draftLayersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (modeRef.current !== "drawing") return;
      const pts = pointsRef.current;
      if (pts.length >= GEOFENCE_POLYGON_MIN_VERTICES && !closedRef.current) {
        const first = pts[0];
        const dist = haversineMetres(
          first.latitude,
          first.longitude,
          e.latlng.lat,
          e.latlng.lng
        );
        if (dist <= GEOFENCE_CLOSE_TO_START_METRES) {
          handlersRef.current.onCloseAtStart();
          return;
        }
      }
      handlersRef.current.onAddPoint(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", onClick);

    const resize = () => map.invalidateSize();
    setTimeout(resize, 50);
    setTimeout(resize, 250);
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      map.off("click", onClick);
      map.remove();
      mapRef.current = null;
      baseLayersRef.current = null;
      draftLayersRef.current = null;
      hasRealViewRef.current = false;
    };
  }, [hasAnchor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor =
      mode === "drawing" ? "crosshair" : mode === "editing" ? "default" : "";
  }, [mode]);

  // Base: saved boundary + entrances + optional live
  useEffect(() => {
    const map = mapRef.current;
    const layers = baseLayersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    if (savedBoundary.length >= 3) {
      L.polygon(
        savedBoundary.map((p) => [p.latitude, p.longitude] as L.LatLngExpression),
        {
          color: "#64748b",
          weight: 2,
          dashArray: "6 8",
          fillColor: "#64748b",
          fillOpacity: 0.08,
        }
      )
        .bindTooltip("Saved boundary (not replaced until you save)", { sticky: true })
        .addTo(layers);
    }

    for (const e of entrances) {
      const ring =
        points.length >= 3
          ? points
          : savedBoundary.length >= 3
            ? savedBoundary
            : null;
      let fillColor = ENTRANCE_IN;
      if (ring) {
        // Cheap client PIP for colour only — authoritative advisory happens in review panel.
        let inside = false;
        const x = e.longitude;
        const y = e.latitude;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i].longitude;
          const yi = ring[i].latitude;
          const xj = ring[j].longitude;
          const yj = ring[j].latitude;
          const intersect =
            yi > y !== yj > y &&
            x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
          if (intersect) inside = !inside;
        }
        fillColor = inside ? ENTRANCE_IN : ENTRANCE_OUT;
      }
      L.circle([e.latitude, e.longitude], {
        radius: Math.max(1, e.allowedRadiusMetres),
        color: fillColor,
        weight: 1,
        fillColor,
        fillOpacity: 0.12,
      }).addTo(layers);
      L.circleMarker([e.latitude, e.longitude], {
        radius: 7,
        color: "#111",
        weight: 1,
        fillColor,
        fillOpacity: 1,
      })
        .bindTooltip(
          `${e.name}${e.entranceTypeLabel ? ` · ${e.entranceTypeLabel}` : ""}`,
          { direction: "top" }
        )
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
    }

    if (!hasRealViewRef.current) {
      const fitPts: L.LatLngExpression[] = [];
      if (points.length > 0) {
        for (const p of points) fitPts.push([p.latitude, p.longitude]);
      } else if (savedBoundary.length >= 3) {
        for (const p of savedBoundary) fitPts.push([p.latitude, p.longitude]);
      } else if (entrances.length > 0) {
        for (const e of entrances) fitPts.push([e.latitude, e.longitude]);
      } else if (live) {
        fitPts.push([live.latitude, live.longitude]);
      }
      if (fitPts.length > 0) {
        fitMapToRealPoints(map, fitPts, { maxZoom: 18, animate: false });
        hasRealViewRef.current = true;
      }
    }
    map.invalidateSize();
  }, [savedBoundary, entrances, live, points]);

  // Draft polygon / markers
  useEffect(() => {
    const map = mapRef.current;
    const layers = draftLayersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    const latLngs: L.LatLngExpression[] = points.map((p) => [p.latitude, p.longitude]);

    if (latLngs.length >= 2) {
      L.polyline(latLngs, { color: GOLD, weight: 4, opacity: 0.95 }).addTo(layers);
    }
    if (closed && latLngs.length >= 3) {
      L.polygon(latLngs, {
        color: GOLD,
        weight: 2,
        fillColor: GOLD,
        fillOpacity: 0.22,
      }).addTo(layers);
    } else if (!closed && latLngs.length >= 1) {
      // Hint line back toward start when enough points
      if (latLngs.length >= 2) {
        L.polyline([latLngs[latLngs.length - 1], latLngs[0]], {
          color: GOLD,
          weight: 2,
          opacity: 0.35,
          dashArray: "4 8",
        }).addTo(layers);
      }
    }

    points.forEach((p, i) => {
      const isStart = i === 0;
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: isStart ? 11 : 8,
        color: "#111827",
        weight: 2,
        fillColor: isStart ? START : GOLD,
        fillOpacity: 1,
      });

      // Leaflet circleMarker is not natively draggable — use a DivIcon marker when editing.
      if (mode === "editing") {
        const dragMarker = L.marker([p.latitude, p.longitude], {
          draggable: true,
          icon: L.divIcon({
            className: "geofence-draw-vertex",
            html: `<div style="width:${isStart ? 18 : 14}px;height:${isStart ? 18 : 14}px;border-radius:50%;background:${isStart ? START : GOLD};border:2px solid #111;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
            iconSize: [isStart ? 18 : 14, isStart ? 18 : 14],
            iconAnchor: [isStart ? 9 : 7, isStart ? 9 : 7],
          }),
        })
          .bindTooltip(isStart ? "Start · drag to move · tap to remove" : `Point ${i + 1} · drag · tap to remove`, {
            direction: "top",
          })
          .addTo(layers);
        dragMarker.on("dragend", () => {
          const ll = dragMarker.getLatLng();
          handlersRef.current.onMovePoint(p.id, ll.lat, ll.lng);
        });
        dragMarker.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (pointsRef.current.length <= GEOFENCE_POLYGON_MIN_VERTICES && closedRef.current) {
            window.alert("A closed boundary needs at least 3 points. Remove is blocked.");
            return;
          }
          const ok = window.confirm(`Remove point ${i + 1}?`);
          if (ok) handlersRef.current.onRemovePoint(p.id);
        });
      } else {
        marker
          .bindTooltip(isStart ? "Start" : `Point ${i + 1}`, { direction: "top" })
          .addTo(layers);
      }
    });

    // Mid-edge insert handles while editing a closed (or 2+ point) shape
    if (mode === "editing" && points.length >= 2) {
      const edgeCount = closed ? points.length : points.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const midLat = (a.latitude + b.latitude) / 2;
        const midLng = (a.longitude + b.longitude) / 2;
        const insertIdx = i;
        L.marker([midLat, midLng], {
          icon: L.divIcon({
            className: "geofence-draw-mid",
            html: `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid ${GOLD};opacity:.9"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
        })
          .bindTooltip("Add point here", { direction: "top" })
          .on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            handlersRef.current.onInsertPoint(insertIdx, midLat, midLng);
          })
          .addTo(layers);
      }
    }

    map.invalidateSize();
  }, [points, closed, mode]);

  // Locate School — fit without forcing zoom fights while drawing
  useEffect(() => {
    if (!locateToken) return;
    const map = mapRef.current;
    if (!map) return;
    const fitPts: L.LatLngExpression[] = [];
    if (points.length > 0) {
      for (const p of points) fitPts.push([p.latitude, p.longitude]);
    } else if (savedBoundary.length >= 3) {
      for (const p of savedBoundary) fitPts.push([p.latitude, p.longitude]);
    } else if (entrances.length > 0) {
      for (const e of entrances) fitPts.push([e.latitude, e.longitude]);
    } else if (live) {
      fitPts.push([live.latitude, live.longitude]);
    }
    if (fitPts.length > 0) {
      fitMapToRealPoints(map, fitPts, { maxZoom: 18, animate: true });
      hasRealViewRef.current = true;
      onLocateDone?.();
    }
  }, [locateToken, points, savedBoundary, entrances, live, onLocateDone]);

  if (!hasAnchor) {
    return (
      <div
        data-testid="draw-map-waiting"
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
        Waiting for campus location… Use Locate School after granting location, or add an entrance
        first.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="geofence-draw-boundary-map"
      data-mode={mode}
      style={{
        width: "100%",
        height: fill ? "100%" : height,
        minHeight: fill ? 0 : undefined,
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    />
  );
}
