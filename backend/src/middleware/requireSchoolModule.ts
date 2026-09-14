/**
 * Tenant product-module entitlement gate (EduClear Core Phase 2).
 *
 * Rule: school owns module AND existing RBAC still applies separately.
 * Missing entitlement rows fail-open (enabled) per Phase 1 rollout policy.
 *
 * CORE Billing must never be gated via ACCOUNTING.
 */
import type { NextFunction, Request, Response } from "express";
import { ProductModule } from "@prisma/client";

import {
  isSchoolModuleEnabled,
  type ProductModuleKey,
} from "../services/schoolModuleEntitlements";
import { loadStaffSchoolAuth } from "./requireOwnerSchoolAccess";

export const MODULE_NOT_ENTITLED = "MODULE_NOT_ENTITLED" as const;

export type SchoolModuleGateRequest = Request & {
  schoolModuleAuth?: {
    userId: string;
    authorizedSchoolId: string;
    module: ProductModuleKey;
  };
};

const GATABLE_MODULES = new Set<ProductModuleKey>([
  ProductModule.ACCOUNTING,
  ProductModule.PAYROLL,
]);

function extractRequestSchoolId(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const params = (req.params ?? {}) as Record<string, unknown>;
  return String(
    body.schoolId ||
      query.schoolId ||
      params.schoolId ||
      body.school_id ||
      query.school_id ||
      ""
  ).trim();
}

export type SchoolModuleGateDecision =
  | {
      allowed: true;
      authorizedSchoolId: string;
      userId: string;
      module: ProductModuleKey;
    }
  | {
      allowed: false;
      status: 401 | 403 | 400;
      error: string;
      code: string;
      module?: ProductModuleKey;
    };

export async function evaluateSchoolModuleGate(input: {
  authHeader: string | undefined;
  requestSchoolId?: string;
  module: ProductModuleKey | string;
}): Promise<SchoolModuleGateDecision> {
  const moduleKey = String(input.module || "")
    .trim()
    .toUpperCase() as ProductModuleKey;

  if (!GATABLE_MODULES.has(moduleKey)) {
    return {
      allowed: false,
      status: 400,
      error: `Module ${moduleKey} cannot be enforced via requireSchoolModule`,
      code: "INVALID_MODULE",
      module: moduleKey,
    };
  }

  const auth = await loadStaffSchoolAuth(input.authHeader);
  if (!auth) {
    return {
      allowed: false,
      status: 401,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
      module: moduleKey,
    };
  }

  const authorizedSchoolId = String(auth.authorizedSchoolId || "").trim();
  if (!authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Missing school authorization",
      code: "MISSING_SCHOOL",
      module: moduleKey,
    };
  }

  const requestSchoolId = String(input.requestSchoolId || "").trim();
  if (requestSchoolId && requestSchoolId !== authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Request schoolId does not match authenticated school",
      code: "SCHOOL_MISMATCH",
      module: moduleKey,
    };
  }

  const enabled = await isSchoolModuleEnabled(authorizedSchoolId, moduleKey);
  if (!enabled) {
    return {
      allowed: false,
      status: 403,
      error: `${moduleKey} module is not enabled for this school`,
      code: MODULE_NOT_ENTITLED,
      module: moduleKey,
    };
  }

  return {
    allowed: true,
    authorizedSchoolId,
    userId: auth.userId,
    module: moduleKey,
  };
}

/**
 * Express middleware factory. Use for ACCOUNTING or PAYROLL only.
 * Does not replace RBAC — mount alongside existing permission checks.
 */
export function requireSchoolModule(module: ProductModuleKey | "ACCOUNTING" | "PAYROLL") {
  return async function schoolModuleMiddleware(
    req: SchoolModuleGateRequest,
    res: Response,
    next: NextFunction
  ) {
    const decision = await evaluateSchoolModuleGate({
      authHeader: req.headers.authorization,
      requestSchoolId: extractRequestSchoolId(req),
      module,
    });

    if (!decision.allowed) {
      return res.status(decision.status).json({
        success: false,
        error: decision.error,
        message: decision.error,
        code: decision.code,
        ...(decision.module ? { module: decision.module } : {}),
      });
    }

    req.schoolModuleAuth = {
      userId: decision.userId,
      authorizedSchoolId: decision.authorizedSchoolId,
      module: decision.module,
    };
    return next();
  };
}

/** Imperative check for handlers that already resolved schoolId from JWT. */
export async function assertSchoolModuleEntitled(
  schoolId: string,
  module: ProductModuleKey | "ACCOUNTING" | "PAYROLL"
): Promise<SchoolModuleGateDecision> {
  const moduleKey = String(module || "")
    .trim()
    .toUpperCase() as ProductModuleKey;
  if (!GATABLE_MODULES.has(moduleKey)) {
    return {
      allowed: false,
      status: 400,
      error: `Module ${moduleKey} cannot be enforced via assertSchoolModuleEntitled`,
      code: "INVALID_MODULE",
      module: moduleKey,
    };
  }
  const id = String(schoolId || "").trim();
  if (!id) {
    return {
      allowed: false,
      status: 400,
      error: "Missing schoolId",
      code: "MISSING_SCHOOL",
      module: moduleKey,
    };
  }
  const enabled = await isSchoolModuleEnabled(id, moduleKey);
  if (!enabled) {
    return {
      allowed: false,
      status: 403,
      error: `${moduleKey} module is not enabled for this school`,
      code: MODULE_NOT_ENTITLED,
      module: moduleKey,
    };
  }
  return {
    allowed: true,
    authorizedSchoolId: id,
    userId: "",
    module: moduleKey,
  };
}
