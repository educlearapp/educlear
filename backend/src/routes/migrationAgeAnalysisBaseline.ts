import { Router } from "express";

import type { MigrationAccessRequest } from "../middleware/requireMigrationAccess";
import { assertMigrationSchoolScope, resolveMigrationSchoolId } from "./migrationCentreAuth";
import { refreshAgeAnalysisBaseline } from "../services/migrationCentre/ageAnalysisBaselineRefreshService";

const router = Router();

function jsonError(res: import("express").Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

router.post("/refresh", async (req, res) => {
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId = resolveMigrationSchoolId(migrationReq, req.body?.schoolId);
    const importedAt = String(req.body?.importedAt || "").trim();
    const snapshots = Array.isArray(req.body?.snapshots) ? req.body.snapshots : [];

    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;
    if (!importedAt) return jsonError(res, 400, "importedAt required");
    if (!snapshots.length) return jsonError(res, 400, "snapshots required");

    const result = await refreshAgeAnalysisBaseline({ schoolId, importedAt, snapshots });
    return res.json(result);
  } catch (e: unknown) {
    console.error("[migration/age-analysis-baseline] refresh", e);
    const message = e instanceof Error ? e.message : "Baseline refresh failed";
    return jsonError(res, 400, message);
  }
});

export default router;
