/**
 * Staff auth for Communication Centre APIs (/api/communication*).
 * JWT → DB User → communications.* permission. Client schoolId is never authority.
 *
 * Teacher Inbox (/api/teacher-inbox) is intentionally NOT gated here.
 */
import type { NextFunction, Request, Response } from "express";

import { loadStaffSchoolAuth, type StaffSchoolAuth } from "./requireOwnerSchoolAccess";
import { evaluateCommunicationsAuth } from "../utils/evaluateCommunicationsAuth";
import type { PermissionAction } from "../utils/userPermissions";

export type CommunicationsAuthRequest = Request & {
  communicationsAuth?: StaffSchoolAuth;
};

export { evaluateCommunicationsAuth };

export function requireCommunicationsAuth(requireAction: PermissionAction) {
  return async (req: CommunicationsAuthRequest, res: Response, next: NextFunction) => {
    try {
      const auth = await loadStaffSchoolAuth(req.headers.authorization);
      const requestSchoolId = String(
        (req.query.schoolId as string) || (req.body && req.body.schoolId) || ""
      ).trim();
      const decision = evaluateCommunicationsAuth({
        auth,
        requireAction,
        requestSchoolId,
      });
      if (!decision.allowed) {
        return res.status(decision.status).json({
          success: false,
          error: decision.error,
          code: decision.code,
        });
      }
      req.communicationsAuth = { ...auth!, ...decision.auth } as StaffSchoolAuth;
      return next();
    } catch (err) {
      console.error("requireCommunicationsAuth failed", err);
      return res.status(500).json({ success: false, error: "Authentication failed" });
    }
  };
}
