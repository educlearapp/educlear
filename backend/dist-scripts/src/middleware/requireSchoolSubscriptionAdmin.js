"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSchoolSubscriptionAdmin = requireSchoolSubscriptionAdmin;
const superAdmin_1 = require("../utils/superAdmin");
const staffJwt_1 = require("../utils/staffJwt");
/** School owner (SCHOOL_ADMIN) or platform super admin via JWT from /auth/login. */
function requireSchoolSubscriptionAdmin(req, res, next) {
    const payload = (0, staffJwt_1.verifyStaffJwt)(req.headers.authorization);
    if (!payload?.userId || !payload?.schoolId) {
        return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const email = (0, staffJwt_1.normalizeStaffEmail)(payload.email);
    const isSuperAdmin = (0, superAdmin_1.isPlatformSuperAdminEmail)(email);
    const role = String(payload.role || "").trim().toUpperCase();
    if (!isSuperAdmin && role !== "SCHOOL_ADMIN") {
        return res.status(403).json({
            success: false,
            error: "School owner or super admin access required",
        });
    }
    req.schoolAuth = payload;
    return next();
}
