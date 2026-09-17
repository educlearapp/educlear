/**
 * Path-scoped JSON body size limit for public Online Admissions only.
 *
 * Must be mounted BEFORE the global express.json({ limit: "12mb" }) so the
 * tighter parser actually consumes public OA JSON bodies.
 */
import express, { type ErrorRequestHandler, type RequestHandler } from "express";

/** 256 KiB — measured realistic completed OA payload ~3 KiB; rich stress ~46 KiB. */
export const PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES = 256 * 1024;

const jsonParser = express.json({ limit: PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES });

function isEntityTooLarge(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; statusCode?: number; type?: string };
  return (
    e.status === 413 ||
    e.statusCode === 413 ||
    e.type === "entity.too.large"
  );
}

/**
 * Parse JSON for /api/public/admissions* with a tight limit.
 * Oversized bodies → 413 BODY_TOO_LARGE (never fall through to the 12 MiB parser).
 */
export const publicAdmissionsJsonParser: RequestHandler = (req, res, next) => {
  jsonParser(req, res, (err) => {
    if (err && isEntityTooLarge(err)) {
      res.status(413).json({
        success: false,
        error: "Request body too large",
        code: "BODY_TOO_LARGE",
      });
      return;
    }
    next(err);
  });
};

/** Optional Express error middleware if the parser is composed differently. */
export const publicAdmissionsJsonLimitErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  next
) => {
  if (isEntityTooLarge(err)) {
    res.status(413).json({
      success: false,
      error: "Request body too large",
      code: "BODY_TOO_LARGE",
    });
    return;
  }
  next(err);
};
