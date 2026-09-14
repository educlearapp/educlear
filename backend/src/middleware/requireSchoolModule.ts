/**
 * Tenant product-module entitlement gate (EduClear Core Phase 5B).
 *
 * Rule: school owns module AND existing RBAC still applies separately.
 * Missing entitlement rows fail-open (enabled) per Phase 1 rollout policy.
 *
 * CORE Billing must never be gated via ACCOUNTING.
 * Banking requires CORE and/or ACCOUNTING (see requireAnySchoolModule / banking policy).
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
    /** When using requireAnySchoolModule — modules that satisfied the gate. */
    matchedModules?: ProductModuleKey[];
  };
};

const GATABLE_MODULES = new Set<ProductModuleKey>([
  ProductModule.CORE,
  ProductModule.ACCOUNTING,
  ProductModule.PAYROLL,
]);

function normalizeModuleKey(module: ProductModuleKey | string): ProductModuleKey {
  return String(module || "")
    .trim()
    .toUpperCase() as ProductModuleKey;
}

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
      matchedModules?: ProductModuleKey[];
    }
  | {
      allowed: false;
      status: 401 | 403 | 400;
      error: string;
      code: string;
      module?: ProductModuleKey;
      modules?: ProductModuleKey[];
    };

function denyModuleJson(
  res: Response,
  decision: Extract<SchoolModuleGateDecision, { allowed: false }>
) {
  return res.status(decision.status).json({
    success: false,
    error: decision.error,
    message: decision.error,
    code: decision.code,
    ...(decision.module ? { module: decision.module } : {}),
    ...(decision.modules ? { modules: decision.modules } : {}),
  });
}

export async function evaluateSchoolModuleGate(input: {
  authHeader: string | undefined;
  requestSchoolId?: string;
  module: ProductModuleKey | string;
}): Promise<SchoolModuleGateDecision> {
  const moduleKey = normalizeModuleKey(input.module);

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
    matchedModules: [moduleKey],
  };
}

/**
 * Staff JWT + school binding + at least one of the listed modules enabled.
 * Used for Employees (CORE || PAYROLL) and Banking (CORE || ACCOUNTING).
 */
export async function evaluateAnySchoolModuleGate(input: {
  authHeader: string | undefined;
  requestSchoolId?: string;
  modules: Array<ProductModuleKey | string>;
}): Promise<SchoolModuleGateDecision> {
  const modules = input.modules
    .map((m) => normalizeModuleKey(m))
    .filter((m) => GATABLE_MODULES.has(m));

  if (!modules.length) {
    return {
      allowed: false,
      status: 400,
      error: "No valid modules provided for entitlement gate",
      code: "INVALID_MODULE",
    };
  }

  const auth = await loadStaffSchoolAuth(input.authHeader);
  if (!auth) {
    return {
      allowed: false,
      status: 401,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
      modules,
    };
  }

  const authorizedSchoolId = String(auth.authorizedSchoolId || "").trim();
  if (!authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Missing school authorization",
      code: "MISSING_SCHOOL",
      modules,
    };
  }

  const requestSchoolId = String(input.requestSchoolId || "").trim();
  if (requestSchoolId && requestSchoolId !== authorizedSchoolId) {
    return {
      allowed: false,
      status: 403,
      error: "Request schoolId does not match authenticated school",
      code: "SCHOOL_MISMATCH",
      modules,
    };
  }

  const matched: ProductModuleKey[] = [];
  for (const moduleKey of modules) {
    if (await isSchoolModuleEnabled(authorizedSchoolId, moduleKey)) {
      matched.push(moduleKey);
    }
  }

  if (!matched.length) {
    const label = modules.join(" or ");
    return {
      allowed: false,
      status: 403,
      error: `None of the required modules (${label}) are enabled for this school`,
      code: MODULE_NOT_ENTITLED,
      modules,
      module: modules[0],
    };
  }

  return {
    allowed: true,
    authorizedSchoolId,
    userId: auth.userId,
    module: matched[0],
    matchedModules: matched,
  };
}

/**
 * Express middleware factory for a single commercial module (CORE | ACCOUNTING | PAYROLL).
 * Does not replace RBAC — mount alongside existing permission checks.
 */
export function requireSchoolModule(
  module: ProductModuleKey | "CORE" | "ACCOUNTING" | "PAYROLL"
) {
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
      return denyModuleJson(res, decision);
    }

    req.schoolModuleAuth = {
      userId: decision.userId,
      authorizedSchoolId: decision.authorizedSchoolId,
      module: decision.module,
      matchedModules: decision.matchedModules,
    };
    return next();
  };
}

/**
 * Express middleware: allow when ANY of the listed modules is enabled.
 */
export function requireAnySchoolModule(
  modules: Array<ProductModuleKey | "CORE" | "ACCOUNTING" | "PAYROLL">
) {
  return async function anySchoolModuleMiddleware(
    req: SchoolModuleGateRequest,
    res: Response,
    next: NextFunction
  ) {
    const decision = await evaluateAnySchoolModuleGate({
      authHeader: req.headers.authorization,
      requestSchoolId: extractRequestSchoolId(req),
      modules,
    });

    if (!decision.allowed) {
      return denyModuleJson(res, decision);
    }

    req.schoolModuleAuth = {
      userId: decision.userId,
      authorizedSchoolId: decision.authorizedSchoolId,
      module: decision.module,
      matchedModules: decision.matchedModules,
    };
    return next();
  };
}

/** Imperative check for handlers that already resolved schoolId (staff or public/parent). */
export async function assertSchoolModuleEntitled(
  schoolId: string,
  module: ProductModuleKey | "CORE" | "ACCOUNTING" | "PAYROLL"
): Promise<SchoolModuleGateDecision> {
  const moduleKey = normalizeModuleKey(module);
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
    matchedModules: [moduleKey],
  };
}

/** Imperative OR-check for already-resolved schoolId. */
export async function assertAnySchoolModuleEntitled(
  schoolId: string,
  modules: Array<ProductModuleKey | "CORE" | "ACCOUNTING" | "PAYROLL">
): Promise<SchoolModuleGateDecision> {
  const moduleKeys = modules
    .map((m) => normalizeModuleKey(m))
    .filter((m) => GATABLE_MODULES.has(m));
  const id = String(schoolId || "").trim();
  if (!id) {
    return {
      allowed: false,
      status: 400,
      error: "Missing schoolId",
      code: "MISSING_SCHOOL",
      modules: moduleKeys,
    };
  }
  if (!moduleKeys.length) {
    return {
      allowed: false,
      status: 400,
      error: "No valid modules provided for entitlement gate",
      code: "INVALID_MODULE",
    };
  }
  const matched: ProductModuleKey[] = [];
  for (const moduleKey of moduleKeys) {
    if (await isSchoolModuleEnabled(id, moduleKey)) matched.push(moduleKey);
  }
  if (!matched.length) {
    return {
      allowed: false,
      status: 403,
      error: `None of the required modules (${moduleKeys.join(" or ")}) are enabled for this school`,
      code: MODULE_NOT_ENTITLED,
      modules: moduleKeys,
      module: moduleKeys[0],
    };
  }
  return {
    allowed: true,
    authorizedSchoolId: id,
    userId: "",
    module: matched[0],
    matchedModules: matched,
  };
}
