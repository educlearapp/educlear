"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuthDiagnostics = requireAuthDiagnostics;
const superAdmin_1 = require("../utils/superAdmin");
const staffJwt_1 = require("../utils/staffJwt");
/**
 * Protects GET /api/auth/diagnostics/:email — platform super-admin JWT or
 * X-Auth-Diagnostics-Key matching AUTH_DIAGNOSTICS_SECRET.
 */
function requireAuthDiagnostics(req, res, next) {
    const secret = String(process.env.AUTH_DIAGNOSTICS_SECRET || "").trim();
    const headerKey = String(req.headers["x-auth-diagnostics-key"] || "").trim();
    if (secret && headerKey && headerKey === secret) {
        return next();
    }
    const payload = (0, staffJwt_1.verifyStaffJwt)(req.headers.authorization);
    if (payload?.email && (0, superAdmin_1.isPlatformSuperAdminEmail)(payload.email)) {
        return next();
    }
    return res.status(403).json({
        error: "Auth diagnostics require super-admin JWT or X-Auth-Diagnostics-Key",
    });
}
