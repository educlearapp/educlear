/**
 * Staging-only read-only safety diagnostics.
 * Fail-closed outside staging runtime. Super Admin JWT required.
 * No secrets, no writes, no outbound communication.
 */
import { Router, type NextFunction, type Request, type Response } from "express";

import type { SuperAdminRequest } from "../middleware/requireSuperAdmin";
import { isStagingRuntime } from "../services/runtime";
import {
  isOutboundEmailDisabled,
  isOutboundSmsDisabled,
} from "../utils/outboundSafety";

const router = Router();

/** 404 when not a positive staging runtime (do not advertise the diagnostic). */
export function requireStagingRuntime(req: Request, res: Response, next: NextFunction) {
  if (!isStagingRuntime()) {
    return res.status(404).json({ error: "Not found" });
  }
  return next();
}

export type StagingOutboundStatusResponse = {
  outboundSmsDisabled: boolean;
  outboundEmailDisabled: boolean;
};

/** Boolean kill-switch snapshot only — never env values or credentials. */
export function buildStagingOutboundStatusResponse(): StagingOutboundStatusResponse {
  return {
    outboundSmsDisabled: isOutboundSmsDisabled(),
    outboundEmailDisabled: isOutboundEmailDisabled(),
  };
}

/**
 * GET /api/staging-safety/outbound-status
 * Staging runtime + Super Admin only.
 */
router.get("/outbound-status", (_req: SuperAdminRequest, res) => {
  return res.status(200).json(buildStagingOutboundStatusResponse());
});

export default router;
