/**
 * Shared Geofence Engine HTTP API.
 * Mounted at /api/geofences — school-scoped; not EduClock-only.
 *
 * Current permission gate: educlock.manage (Owner has all permissions).
 * Future modules can widen this without forking GPS storage.
 */
import { Router } from "express";
import { GeofenceZoneType } from "@prisma/client";

import {
  loadStaffSchoolAuth,
  type StaffSchoolAuth,
} from "../middleware/requireOwnerSchoolAccess";
import {
  GeofenceError,
  getGeofenceZone,
  listGeofenceZones,
  updateGeofenceZone,
  upsertCampusBoundaryPolygon,
  evaluateCampusBoundaryContainment,
  getActiveCampusBoundaryForMap,
  testOwnerLocation,
} from "../services/geofenceService";
import { isGeofencePolygonValidationEnabled } from "../services/geofencePolygonValidationFlag";
import { hasPermission, resolveStoredPermissions } from "../utils/userPermissions";

const router = Router();

type GeofenceRequest = {
  headers: { authorization?: string };
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
};

async function requireGeofenceManage(req: GeofenceRequest): Promise<StaffSchoolAuth> {
  const auth = await loadStaffSchoolAuth(req.headers.authorization);
  if (!auth) {
    throw new GeofenceError("GEOFENCE_FORBIDDEN", 401, "Authentication required");
  }
  if (auth.authorizedSchoolId !== auth.schoolId) {
    throw new GeofenceError("GEOFENCE_FORBIDDEN", 403, "School scope mismatch");
  }
  const permissionUser = {
    appRole: auth.appRole,
    isActive: true,
    permissions: resolveStoredPermissions(auth.appRole, auth.permissions),
  };
  // EduClock owners configure campus boundaries today; reuse educclock.manage until
  // a dedicated geofence.manage permission is introduced for other products.
  if (!hasPermission(permissionUser, "educlock", "manage")) {
    throw new GeofenceError(
      "GEOFENCE_FORBIDDEN",
      403,
      "Geofence management requires educlock.manage permission"
    );
  }
  const claimed = String(
    req.body?.schoolId || req.query?.schoolId || req.params?.schoolId || ""
  ).trim();
  if (claimed && claimed !== auth.schoolId) {
    throw new GeofenceError("GEOFENCE_FORBIDDEN", 403, "School scope mismatch");
  }
  return auth;
}

function sendGeofenceError(res: any, err: unknown) {
  if (err instanceof GeofenceError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("[geofences]", err);
  return res.status(500).json({ error: "GEOFENCE_INTERNAL", message: "Internal geofence error" });
}

router.get("/status", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    return res.json({
      schoolId: auth.schoolId,
      engine: "geofence",
      polygonValidationEnabled: isGeofencePolygonValidationEnabled(),
      note:
        "Polygon validation is disabled for clock-in until owner approval. Entrance GPS unchanged.",
    });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

router.get("/zones", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const typeRaw = String(req.query?.type || "").trim();
    const campusId = String(req.query?.campusId || "").trim() || undefined;
    const activeOnly = String(req.query?.activeOnly || "").trim() === "true";
    let type: GeofenceZoneType | undefined;
    if (typeRaw) {
      if (!(Object.values(GeofenceZoneType) as string[]).includes(typeRaw)) {
        throw new GeofenceError("GEOFENCE_INVALID", 400, `Unknown zone type: ${typeRaw}`);
      }
      type = typeRaw as GeofenceZoneType;
    }
    const result = await listGeofenceZones(auth.schoolId, { type, campusId, activeOnly });
    return res.json(result);
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

router.get("/zones/:zoneId", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const zone = await getGeofenceZone(auth.schoolId, String(req.params.zoneId));
    return res.json({ zone });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

router.patch("/zones/:zoneId", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const body = (req.body || {}) as Record<string, unknown>;
    const zone = await updateGeofenceZone({
      schoolId: auth.schoolId,
      zoneId: String(req.params.zoneId),
      actorUserId: auth.userId,
      name: body.name === undefined ? undefined : String(body.name),
      active: body.active === undefined ? undefined : Boolean(body.active),
      metadata:
        body.metadata === undefined
          ? undefined
          : body.metadata && typeof body.metadata === "object"
            ? (body.metadata as Record<string, unknown>)
            : null,
    });
    return res.json({ zone });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

/**
 * Active campus boundary polygon for map overlays (owner setup).
 * GET /api/geofences/campus-boundaries/:campusId
 */
router.get("/campus-boundaries/:campusId", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const zone = await getActiveCampusBoundaryForMap({
      schoolId: auth.schoolId,
      campusId: String(req.params.campusId || ""),
    });
    return res.json({
      zone,
      polygonValidationEnabled: isGeofencePolygonValidationEnabled(),
    });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

/**
 * Server-side point-in-polygon advisory check (does not trust the client).
 * POST /api/geofences/containment-check
 * Body: { campusId, latitude, longitude }
 */
router.post("/containment-check", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const body = (req.body || {}) as Record<string, unknown>;
    const campusId = String(body.campusId || "").trim();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!campusId) throw new GeofenceError("GEOFENCE_INVALID", 400, "campusId is required.");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new GeofenceError("GEOFENCE_INVALID", 400, "latitude and longitude are required.");
    }
    const containment = await evaluateCampusBoundaryContainment({
      schoolId: auth.schoolId,
      campusId,
      latitude,
      longitude,
    });
    return res.json({
      ...containment,
      polygonValidationEnabled: isGeofencePolygonValidationEnabled(),
      advisoryOnly: true,
      note: "Staff clock-in still uses entrance GPS radius until polygon validation is approved.",
    });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

/**
 * Owner Location Test Mode — read-only simulation (no clock / GPS-attempt writes).
 * POST /api/geofences/test-location
 * Body: { campusId, latitude, longitude, accuracyMetres }
 * schoolId is taken from the authenticated session only.
 */
router.post("/test-location", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const body = (req.body || {}) as Record<string, unknown>;
    const campusId = String(body.campusId || "").trim();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const accuracyMetres = Number(body.accuracyMetres);
    if (!campusId) throw new GeofenceError("GEOFENCE_INVALID", 400, "campusId is required.");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new GeofenceError("GEOFENCE_INVALID", 400, "latitude and longitude are required.");
    }
    if (!Number.isFinite(accuracyMetres)) {
      throw new GeofenceError("GEOFENCE_INVALID", 400, "accuracyMetres is required.");
    }
    // Never trust a client-supplied schoolId for the simulation target.
    const result = await testOwnerLocation({
      schoolId: auth.schoolId,
      campusId,
      latitude,
      longitude,
      accuracyMetres,
    });
    return res.json({
      ...result,
      schoolId: auth.schoolId,
      advisoryOnly: true,
      note: "Simulation only. No clock-in, GPS attempt, attendance, or payroll record was created.",
    });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

/**
 * Save / replace campus boundary polygon (Save Each Corner finish).
 * POST /api/geofences/campus-boundaries
 */
router.post("/campus-boundaries", async (req, res) => {
  try {
    const auth = await requireGeofenceManage(req as GeofenceRequest);
    const body = (req.body || {}) as Record<string, unknown>;
    const campusId = String(body.campusId || "").trim();
    if (!campusId) {
      throw new GeofenceError("GEOFENCE_INVALID", 400, "campusId is required.");
    }
    const rawVertices = Array.isArray(body.vertices) ? body.vertices : [];
    const vertices = rawVertices.map((item: any) => ({
      latitude: Number(item?.latitude),
      longitude: Number(item?.longitude),
      accuracyMetres:
        item?.accuracyMetres == null || item?.accuracyMetres === ""
          ? null
          : Number(item.accuracyMetres),
      capturedAt: item?.capturedAt ? String(item.capturedAt) : null,
    }));

    const zone = await upsertCampusBoundaryPolygon({
      schoolId: auth.schoolId,
      actorUserId: auth.userId,
      campusId,
      name: body.name == null ? null : String(body.name),
      vertices,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : null,
    });

    return res.status(201).json({
      zone,
      polygonValidationEnabled: isGeofencePolygonValidationEnabled(),
      clockBehaviourUnchanged: true,
      message:
        "Campus boundary saved. Staff clock-in still uses entrance GPS only until polygon validation is approved.",
    });
  } catch (err) {
    return sendGeofenceError(res, err);
  }
});

export default router;
