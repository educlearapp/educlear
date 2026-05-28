import { Router } from "express";
import { EduClearPackageCode, SchoolSubscriptionStatus } from "@prisma/client";

import {
  requireSchoolSubscriptionAdmin,
  type SchoolSubscriptionAdminRequest,
} from "../middleware/requireSchoolSubscriptionAdmin";
import { prisma } from "../prisma";
import { ensureDaSilvaAcademySubscription } from "../services/activateDaSilvaSubscription";
import {
  TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
  activateSchoolSubscriptionTestMode,
} from "../services/activateTestSubscription";
import { ensureEduClearPackages } from "../services/ensureEduClearPackages";
import { isDaSilvaSchoolId, refreshDaSilvaSchoolIdCache } from "../services/daSilvaSchoolResolve";
import {
  getMissingPayFastEnvVars,
  isPayFastConfigured,
} from "../services/payfastService";
import { isProductionRuntime, isProductionOrGoLive } from "../services/runtime";
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
  const missing = getMissingPayFastEnvVars();
  return res.json({
    success: true,
    payfastConfigured: missing.length === 0,
    missingPayFastEnv: missing,
    testModeAvailable: isSubscriptionTestModeAllowed(),
  });
});

router.get("/packages", async (_req, res) => {
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
    });
  } catch (error) {
    console.error("[subscriptions] GET /packages failed:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch packages" });
  }
});

router.get("/school/:schoolId/status", async (req, res) => {
  try {
    const schoolId = String(req.params.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });

    if (!school) {
      return res.status(404).json({ success: false, error: "School not found" });
    }

    let daSilvaLiveActivated = false;
    await refreshDaSilvaSchoolIdCache();
    if (isProductionOrGoLive() && isDaSilvaSchoolId(schoolId)) {
      try {
        await ensureDaSilvaAcademySubscription(schoolId);
        daSilvaLiveActivated = true;
        console.log(
          "[subscription-status] Da Silva live activation ensured ACTIVE, dashboardUnlocked=true"
        );
      } catch (activationError) {
        console.error(
          "[subscription-status] Da Silva live activation failed:",
          activationError
        );
      }
    }

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

    const isActive = subscription
      ? isActiveSubscriptionStatus(subscription.status)
      : false;
    const dashboardUnlocked = isActive || daSilvaLiveActivated;

    return res.json({
      success: true,
      schoolId: school.id,
      schoolName: school.name,
      hasSubscription: Boolean(subscription),
      isActive,
      dashboardUnlocked,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            packageCode: subscription.packageCode,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            activatedAt: subscription.activatedAt,
            activationSource: subscription.activationSource,
            cancelledAt: subscription.cancelledAt,
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt,
            package: serializePackage(subscription.package),
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
