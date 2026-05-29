"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireMigrationAccess = requireMigrationAccess;
const migrationAccess_1 = require("../utils/migrationAccess");
const staffJwt_1 = require("../utils/staffJwt");
/** Platform super admin or school owner/admin roles — not teachers/parents. */
function requireMigrationAccess(req, res, next) {
    const payload = (0, staffJwt_1.verifyStaffJwt)(req.headers.authorization);
    if (!payload?.userId || !payload?.schoolId) {
        return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
        });
    }
    const ctx = {
        userId: payload.userId,
        schoolId: payload.schoolId,
        email: (0, staffJwt_1.normalizeStaffEmail)(payload.email),
        role: payload.role,
    };
    if (!(0, migrationAccess_1.canAccessMigration)(ctx)) {
        const debug = (0, migrationAccess_1.migrationAccessDeniedDebug)(ctx);
        return res.status(403).json({
            success: false,
            error: "Migration access denied",
            code: "MIGRATION_ACCESS_DENIED",
            debug,
        });
    }
    req.migrationAuth = payload;
    return next();
}
