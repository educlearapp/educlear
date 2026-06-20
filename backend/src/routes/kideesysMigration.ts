import { Router } from "express";
import { migrationErrorHandler } from "./migration";

const router = Router();

function jsonError(res: import("express").Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

router.use((_req, res) =>
  jsonError(
    res,
    410,
    "Legacy Kid-e-Sys migration routes are disabled. Use Universal Migration upload, preview, full validation, staging, and apply."
  )
);

export { migrationErrorHandler as kideesysMigrationErrorHandler };
export default router;
