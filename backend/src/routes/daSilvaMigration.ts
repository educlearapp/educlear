import { Router } from "express";

const router = Router();

router.all("*", (_req, res) => {
  return res.status(410).json({
    error:
      "Legacy school-specific migration routes are disabled. Use Universal Migration upload, preview, full validation, staging, and apply.",
  });
});

export default router;
