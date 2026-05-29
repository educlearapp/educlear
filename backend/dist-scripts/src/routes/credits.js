"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const ensureEduClearCreditBundles_1 = require("../services/ensureEduClearCreditBundles");
const router = (0, express_1.Router)();
const bundleSelect = {
    id: true,
    code: true,
    name: true,
    smsCredits: true,
    priceCents: true,
    mostPopular: true,
    description: true,
    isActive: true,
};
router.get("/bundles", async (_req, res) => {
    try {
        await (0, ensureEduClearCreditBundles_1.ensureEduClearCreditBundles)();
        const bundles = await prisma_1.prisma.eduClearCreditBundle.findMany({
            where: { isActive: true },
            select: bundleSelect,
            orderBy: [{ priceCents: "asc" }, { code: "asc" }],
        });
        return res.json({
            success: true,
            bundles: bundles.map((bundle) => ({
                ...bundle,
                priceZar: bundle.priceCents / 100,
            })),
        });
    }
    catch (error) {
        console.error("[credits] GET /bundles failed:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch credit bundles" });
    }
});
exports.default = router;
