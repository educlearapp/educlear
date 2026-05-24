import { Router } from "express";
import { SchoolSubscriptionStatus } from "@prisma/client";

import { prisma } from "../prisma";
import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  ensureDaSilvaAcademySubscription,
} from "../services/activateDaSilvaSubscription";
import { ensureEduClearPackages } from "../services/ensureEduClearPackages";
import { isProductionRuntime } from "../services/runtime";

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
    if (isProductionRuntime() && schoolId === DA_SILVA_ACADEMY_SCHOOL_ID) {
      try {
        await ensureDaSilvaAcademySubscription();
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

export default router;
