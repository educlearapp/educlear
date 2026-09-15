import { Router } from "express";
import { EduClearPackageCode, SchoolSubscriptionStatus } from "@prisma/client";

import {
  requireSchoolSubscriptionAdmin,
  type SchoolSubscriptionAdminRequest,
} from "../middleware/requireSchoolSubscriptionAdmin";
import { prisma } from "../prisma";
import {
  TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
  activateSchoolSubscriptionTestMode,
} from "../services/activateTestSubscription";
import { ensureEduClearPackages } from "../services/ensureEduClearPackages";
import { listNewSaleCommercialPackages } from "../services/educlearCommercialPackages";
import { isModularPayfastCheckoutEnabled } from "../services/modularPayfastCheckout";
import {
  resolveSchoolCommercialPackageReadOnly,
  serializeCommercialPackage,
} from "../services/resolveSchoolCommercialPackage";
import { authorizeSchoolSubscriptionStatusAccess } from "../services/subscriptionStatusAuth";
import {
  isPayFastConfigured,
} from "../services/payfastService";
import { isProductionRuntime } from "../services/runtime";
import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { normalizeStaffEmail } from "../utils/staffJwt";

const router = Router();

const packageSelect = {
  id: true,
  code: true,
  name: true,
  monthlyPriceCents: true,
  learnerLimit: true,
  payrollStaffLimit: true,
  mostPopular: true,
  description: true,
  isActive: true,
} as const;

type PackageRow = {
  monthlyPriceCents: number;
};

function formatPriceLabel(monthlyPriceCents: number): string {
  const monthlyPriceZar = monthlyPriceCents / 100;
  return `R${Math.round(monthlyPriceZar).toLocaleString("en-ZA")} / month`;
}

function serializePackage<T extends PackageRow>(pkg: T) {
  const monthlyPriceCents = Number(pkg.monthlyPriceCents);
  const monthlyPriceZar = monthlyPriceCents / 100;
  return {
    ...pkg,
    monthlyPriceCents,
    monthlyPriceZar,
    priceLabel: formatPriceLabel(monthlyPriceCents),
  };
}

function isActiveSubscriptionStatus(status: SchoolSubscriptionStatus): boolean {
  return status === "ACTIVE";
}

function parsePackageCode(raw: unknown): EduClearPackageCode | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (normalized === "STARTER" || normalized === "UNLIMITED") {
    return normalized as EduClearPackageCode;
  }
  return null;
}

function isSubscriptionTestModeAllowed(): boolean {
  if (isPayFastConfigured()) return false;
  if (isProductionRuntime()) return false;
  return true;
}

router.get("/config", (_req, res) => {
  // School-facing: high-level state only — never leak PAYFAST_* env var names.
  return res.json({
    success: true,
    payfastConfigured: isPayFastConfigured(),
    paymentsConfigured: isPayFastConfigured(),
    testModeAvailable: isSubscriptionTestModeAllowed(),
    // Boolean only — never expose ENABLE_MODULAR_PAYFAST_CHECKOUT env name.
    modularCheckoutAvailable: isModularPayfastCheckoutEnabled(),
  });
});

router.get("/packages", async (_req, res) => {
  try {
    // New-sale catalogue = modular commercial packages (not STARTER/UNLIMITED).
    const packages = listNewSaleCommercialPackages().map((pkg) => {
      const commercial = serializeCommercialPackage(pkg);
      return {
        ...commercial,
        id: `commercial:${pkg.code}`,
        mostPopular: pkg.code === "FULL_UNLIMITED",
        isActive: true,
        learnerLimit: pkg.learnerLimit,
        payrollStaffLimit: null,
        priceLabel: commercial.priceLabelMonthly,
      };
    });

    return res.json({
      success: true,
      packages,
      catalogue: "modular",
    });
  } catch (error) {
    console.error("[subscriptions] GET /packages failed:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch packages" });
  }
});

/** Historical STARTER/UNLIMITED capacity rows — not new-sale. */
router.get("/packages/legacy", async (_req, res) => {
  try {
    await ensureEduClearPackages();
    const packages = await prisma.eduClearPackage.findMany({
      where: { isActive: true },
      select: packageSelect,
      orderBy: [{ monthlyPriceCents: "asc" }, { code: "asc" }],
    });

    return res.json({
      success: true,
      packages: packages.map((pkg) => serializePackage(pkg)),
      catalogue: "legacy-capacity",
    });
  } catch (error) {
    console.error("[subscriptions] GET /packages/legacy failed:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch legacy packages" });
  }
});

router.get("/school/:schoolId/status", async (req, res) => {
  try {
    const schoolId = String(req.params.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const access = await authorizeSchoolSubscriptionStatusAccess({
      authHeader: req.headers.authorization,
      requestSchoolId: schoolId,
    });
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        error: access.error,
        code: access.code,
      });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });

    if (!school) {
      return res.status(404).json({ success: false, error: "School not found" });
    }

    // Read-only GET: no Da Silva ensure/write and no entitlement row creation.
    // Missing entitlement rows resolve fail-open Full via read-only snapshot.
    const subscription = await prisma.schoolSubscription.findUnique({
      where: { schoolId },
      select: {
        id: true,
        status: true,
        packageCode: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        activatedAt: true,
        activationSource: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
        package: {
          select: packageSelect,
        },
      },
    });

    const { moduleEntitlements, commercialPackage, bits } =
      await resolveSchoolCommercialPackageReadOnly(schoolId);

    const isActive = subscription
      ? isActiveSubscriptionStatus(subscription.status)
      : false;
    const dashboardUnlocked = isActive;

    return res.json({
      success: true,
      schoolId: school.id,
      schoolName: school.name,
      hasSubscription: Boolean(subscription),
      isActive,
      dashboardUnlocked,
      moduleEntitlements,
      commercialPackage,
      commercialBits: bits,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            /** @deprecated Legacy capacity code — not commercial package. */
            packageCode: subscription.packageCode,
            legacyCapacityPackageCode: subscription.packageCode,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            activatedAt: subscription.activatedAt,
            activationSource: subscription.activationSource,
            cancelledAt: subscription.cancelledAt,
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt,
            package: serializePackage(subscription.package),
            legacyCapacityPackage: serializePackage(subscription.package),
          }
        : null,
    });
  } catch (error) {
    console.error("[subscriptions] GET /school/:schoolId/status failed:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch subscription status" });
  }
});

router.post("/test-activate", requireSchoolSubscriptionAdmin, async (req, res) => {
  const authedReq = req as SchoolSubscriptionAdminRequest;
  try {
    if (!isSubscriptionTestModeAllowed()) {
      const message = isPayFastConfigured()
        ? "PayFast is configured. Complete checkout to activate your subscription."
        : "Test mode activation is not available on production hosts.";
      return res.status(403).json({ success: false, error: message });
    }

    const auth = authedReq.schoolAuth!;
    const schoolId = String(auth.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing school on session" });
    }

    const packageCode = parsePackageCode(req.body?.packageCode);
    const result = await activateSchoolSubscriptionTestMode({
      schoolId,
      packageCode,
      activatedByUserId: auth.userId,
      activationSource: TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
    });

    const email = normalizeStaffEmail(auth.email);
    console.log("[subscriptions] POST /test-activate", {
      schoolId,
      userId: auth.userId,
      superAdmin: isPlatformSuperAdminEmail(email),
      packageCode: result.package.code,
      source: TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
    });

    return res.json({
      success: true,
      schoolId,
      dashboardUnlocked: true,
      isActive: true,
      activationSource: TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
      subscription: {
        id: result.subscription.id,
        status: result.subscription.status,
        packageCode: result.subscription.packageCode,
        activationSource: result.subscription.activationSource,
        activatedAt: result.subscription.activatedAt,
        currentPeriodStart: result.subscription.currentPeriodStart,
        currentPeriodEnd: result.subscription.currentPeriodEnd,
        package: serializePackage(result.package),
      },
    });
  } catch (error) {
    console.error("[subscriptions] POST /test-activate failed:", error);
    const message = error instanceof Error ? error.message : "Failed to activate test subscription";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
