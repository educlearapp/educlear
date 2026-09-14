import { Router } from "express";

import type { SuperAdminRequest } from "../middleware/requireSuperAdmin";
import { listSuperAdminSchools } from "../services/superAdmin/listSuperAdminSchools";
import {
  resetSuperAdminSchoolPassword,
  SuperAdminSchoolPasswordResetError,
} from "../services/superAdmin/resetSuperAdminSchoolPassword";
import { updateSuperAdminSchool } from "../services/superAdmin/updateSuperAdminSchool";
import { updateSchoolLifecycle } from "../services/superAdmin/updateSchoolLifecycle";
import {
  SchoolLifecycleError,
  resolveLifecycleTargetSchoolId,
} from "../services/superAdmin/schoolLifecycle";
import {
  assertCoreNotDisabledInPatchBody,
  SchoolModuleEntitlementError,
  updateSchoolModuleEntitlements,
} from "../services/schoolModuleEntitlements";

const router = Router();

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new SchoolModuleEntitlementError("Module entitlement flags must be booleans", 400);
}

function extractModuleEntitlementPatch(body: unknown): {
  accounting?: boolean;
  payroll?: boolean;
} | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const nested =
    record.moduleEntitlements && typeof record.moduleEntitlements === "object"
      ? (record.moduleEntitlements as Record<string, unknown>)
      : null;

  const accountingRaw =
    nested && Object.prototype.hasOwnProperty.call(nested, "ACCOUNTING")
      ? nested.ACCOUNTING
      : nested && Object.prototype.hasOwnProperty.call(nested, "accounting")
        ? nested.accounting
        : Object.prototype.hasOwnProperty.call(record, "accounting")
          ? record.accounting
          : undefined;
  const payrollRaw =
    nested && Object.prototype.hasOwnProperty.call(nested, "PAYROLL")
      ? nested.PAYROLL
      : nested && Object.prototype.hasOwnProperty.call(nested, "payroll")
        ? nested.payroll
        : Object.prototype.hasOwnProperty.call(record, "payroll")
          ? record.payroll
          : undefined;

  const accounting = parseOptionalBoolean(accountingRaw);
  const payroll = parseOptionalBoolean(payrollRaw);
  if (accounting === undefined && payroll === undefined) return null;
  return { accounting, payroll };
}

/** GET /api/super-admin/schools — platform school monitoring (super-admin JWT only). */
router.get("/", async (_req: SuperAdminRequest, res) => {
  try {
    const result = await listSuperAdminSchools();
    return res.json(result);
  } catch (error: unknown) {
    console.error("[super-admin/schools]", error);
    const message = error instanceof Error ? error.message : "Failed to load schools";
    return res.status(500).json({ error: message });
  }
});

/**
 * PATCH /api/super-admin/schools/:schoolId
 * lifecycle and/or subscription package and/or ACCOUNTING|PAYROLL module entitlements
 * (super-admin JWT only). CORE cannot be disabled. FINANCE is not a product module.
 */
router.patch("/:schoolId", async (req: SuperAdminRequest, res) => {
  try {
    assertCoreNotDisabledInPatchBody(req.body);

    const schoolId = resolveLifecycleTargetSchoolId(req.params.schoolId, req.body?.schoolId);
    const hasLifecycle =
      req.body != null && Object.prototype.hasOwnProperty.call(req.body, "lifecycleStatus");
    const modulePatch = extractModuleEntitlementPatch(req.body);

    let moduleEntitlements = null as Awaited<
      ReturnType<typeof updateSchoolModuleEntitlements>
    > | null;
    if (modulePatch) {
      moduleEntitlements = await updateSchoolModuleEntitlements({
        schoolId,
        ...(modulePatch.accounting !== undefined
          ? { accounting: modulePatch.accounting }
          : {}),
        ...(modulePatch.payroll !== undefined ? { payroll: modulePatch.payroll } : {}),
        actor: req.superAdmin,
      });
    }

    if (hasLifecycle) {
      const result = await updateSchoolLifecycle({
        schoolId,
        lifecycleStatus: req.body.lifecycleStatus,
        actor: req.superAdmin,
      });
      const packageRaw = req.body?.package as "Starter" | "Unlimited" | undefined;
      if (packageRaw) {
        await updateSuperAdminSchool({ schoolId, package: packageRaw });
      }
      return res.json({
        ...result,
        ...(moduleEntitlements ? { moduleEntitlements } : {}),
      });
    }

    const statusRaw = req.body?.status as "Active" | "Trial" | "Suspended" | undefined;
    const packageRaw = req.body?.package as "Starter" | "Unlimited" | undefined;
    const hasPackageOrStatus = Boolean(statusRaw || packageRaw);

    if (hasPackageOrStatus) {
      await updateSuperAdminSchool({
        schoolId,
        status: statusRaw,
        package: packageRaw,
      });
    } else if (!moduleEntitlements) {
      throw new Error("No changes provided");
    }

    return res.json({
      success: true,
      ...(moduleEntitlements ? { moduleEntitlements } : {}),
    });
  } catch (error: unknown) {
    console.error("[super-admin/schools] PATCH", error);
    if (error instanceof SchoolLifecycleError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    if (error instanceof SchoolModuleEntitlementError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    const message = error instanceof Error ? error.message : "Failed to update school";
    return res.status(400).json({ success: false, error: message });
  }
});

/** POST /api/super-admin/schools/:schoolId/reset-password — owner login hash only. */
router.post("/:schoolId/reset-password", async (req: SuperAdminRequest, res) => {
  try {
    const schoolId = String(req.params.schoolId || "").trim();
    const result = await resetSuperAdminSchoolPassword({
      schoolId,
      claimedSchoolId: String(req.body?.schoolId || "").trim(),
      newPassword: String(req.body?.newPassword ?? req.body?.password ?? ""),
      confirmPassword: String(req.body?.confirmPassword ?? ""),
    });
    return res.json({
      success: true,
      schoolId: result.schoolId,
      schoolName: result.schoolName,
      ownerEmail: result.ownerEmail,
      message: `Password reset for ${result.schoolName}. The school owner can sign in with the new password.`,
    });
  } catch (error: unknown) {
    if (error instanceof SuperAdminSchoolPasswordResetError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error("[super-admin/schools] POST reset-password", error);
    const message = error instanceof Error ? error.message : "Failed to reset password";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
