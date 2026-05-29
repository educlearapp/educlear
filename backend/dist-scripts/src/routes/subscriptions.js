"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requireSchoolSubscriptionAdmin_1 = require("../middleware/requireSchoolSubscriptionAdmin");
const prisma_1 = require("../prisma");
const activateDaSilvaSubscription_1 = require("../services/activateDaSilvaSubscription");
const activateTestSubscription_1 = require("../services/activateTestSubscription");
const ensureEduClearPackages_1 = require("../services/ensureEduClearPackages");
const daSilvaSchoolResolve_1 = require("../services/daSilvaSchoolResolve");
const payfastService_1 = require("../services/payfastService");
const runtime_1 = require("../services/runtime");
const superAdmin_1 = require("../utils/superAdmin");
const staffJwt_1 = require("../utils/staffJwt");
const router = (0, express_1.Router)();
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
};
function formatPriceLabel(monthlyPriceCents) {
    const monthlyPriceZar = monthlyPriceCents / 100;
    return `R${Math.round(monthlyPriceZar).toLocaleString("en-ZA")} / month`;
}
function serializePackage(pkg) {
    const monthlyPriceCents = Number(pkg.monthlyPriceCents);
    const monthlyPriceZar = monthlyPriceCents / 100;
    return {
        ...pkg,
        monthlyPriceCents,
        monthlyPriceZar,
        priceLabel: formatPriceLabel(monthlyPriceCents),
    };
}
function isActiveSubscriptionStatus(status) {
    return status === "ACTIVE";
}
function parsePackageCode(raw) {
    const normalized = String(raw || "").trim().toUpperCase();
    if (normalized === "STARTER" || normalized === "UNLIMITED") {
        return normalized;
    }
    return null;
}
function isSubscriptionTestModeAllowed() {
    if ((0, payfastService_1.isPayFastConfigured)())
        return false;
    if ((0, runtime_1.isProductionRuntime)())
        return false;
    return true;
}
router.get("/config", (_req, res) => {
    const missing = (0, payfastService_1.getMissingPayFastEnvVars)();
    return res.json({
        success: true,
        payfastConfigured: missing.length === 0,
        missingPayFastEnv: missing,
        testModeAvailable: isSubscriptionTestModeAllowed(),
    });
});
router.get("/packages", async (_req, res) => {
    try {
        await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
        const packages = await prisma_1.prisma.eduClearPackage.findMany({
            where: { isActive: true },
            select: packageSelect,
            orderBy: [{ monthlyPriceCents: "asc" }, { code: "asc" }],
        });
        return res.json({
            success: true,
            packages: packages.map((pkg) => serializePackage(pkg)),
        });
    }
    catch (error) {
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
        const school = await prisma_1.prisma.school.findUnique({
            where: { id: schoolId },
            select: { id: true, name: true },
        });
        if (!school) {
            return res.status(404).json({ success: false, error: "School not found" });
        }
        let daSilvaLiveActivated = false;
        await (0, daSilvaSchoolResolve_1.refreshDaSilvaSchoolIdCache)();
        if ((0, runtime_1.isProductionOrGoLive)() && (0, daSilvaSchoolResolve_1.isDaSilvaSchoolId)(schoolId)) {
            try {
                await (0, activateDaSilvaSubscription_1.ensureDaSilvaAcademySubscription)(schoolId);
                daSilvaLiveActivated = true;
                console.log("[subscription-status] Da Silva live activation ensured ACTIVE, dashboardUnlocked=true");
            }
            catch (activationError) {
                console.error("[subscription-status] Da Silva live activation failed:", activationError);
            }
        }
        const subscription = await prisma_1.prisma.schoolSubscription.findUnique({
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
    }
    catch (error) {
        console.error("[subscriptions] GET /school/:schoolId/status failed:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch subscription status" });
    }
});
router.post("/test-activate", requireSchoolSubscriptionAdmin_1.requireSchoolSubscriptionAdmin, async (req, res) => {
    const authedReq = req;
    try {
        if (!isSubscriptionTestModeAllowed()) {
            const message = (0, payfastService_1.isPayFastConfigured)()
                ? "PayFast is configured. Complete checkout to activate your subscription."
                : "Test mode activation is not available on production hosts.";
            return res.status(403).json({ success: false, error: message });
        }
        const auth = authedReq.schoolAuth;
        const schoolId = String(auth.schoolId || "").trim();
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing school on session" });
        }
        const packageCode = parsePackageCode(req.body?.packageCode);
        const result = await (0, activateTestSubscription_1.activateSchoolSubscriptionTestMode)({
            schoolId,
            packageCode,
            activatedByUserId: auth.userId,
            activationSource: activateTestSubscription_1.TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
        });
        const email = (0, staffJwt_1.normalizeStaffEmail)(auth.email);
        console.log("[subscriptions] POST /test-activate", {
            schoolId,
            userId: auth.userId,
            superAdmin: (0, superAdmin_1.isPlatformSuperAdminEmail)(email),
            packageCode: result.package.code,
            source: activateTestSubscription_1.TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
        });
        return res.json({
            success: true,
            schoolId,
            dashboardUnlocked: true,
            isActive: true,
            activationSource: activateTestSubscription_1.TEST_SUBSCRIPTION_ACTIVATION_SOURCE,
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
    }
    catch (error) {
        console.error("[subscriptions] POST /test-activate failed:", error);
        const message = error instanceof Error ? error.message : "Failed to activate test subscription";
        return res.status(500).json({ success: false, error: message });
    }
});
exports.default = router;
