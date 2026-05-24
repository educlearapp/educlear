import { Router } from "express";

import { prisma } from "../prisma";
import { ensureEduClearCreditBundles } from "../services/ensureEduClearCreditBundles";

const router = Router();

const bundleSelect = {
  id: true,
  code: true,
  name: true,
  smsCredits: true,
  priceCents: true,
  mostPopular: true,
  description: true,
  isActive: true,
} as const;

router.get("/bundles", async (_req, res) => {
  try {
    await ensureEduClearCreditBundles();

    const bundles = await prisma.eduClearCreditBundle.findMany({
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
  } catch (error) {
    console.error("[credits] GET /bundles failed:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch credit bundles" });
  }
});

export default router;
