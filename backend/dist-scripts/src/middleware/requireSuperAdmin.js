"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = requireSuperAdmin;
const superAdmin_1 = require("../utils/superAdmin");
const staffJwt_1 = require("../utils/staffJwt");
/** Requires a valid staff JWT whose email is listed in SUPER_ADMIN_EMAILS. */
function requireSuperAdmin(req, res, next) {
    const payload = (0, staffJwt_1.verifyStaffJwt)(req.headers.authorization);
    if (!payload) {
        return res.status(401).json({ error: "Authentication required" });
    }
    const email = (0, staffJwt_1.normalizeStaffEmail)(payload.email);
    if (!(0, superAdmin_1.isPlatformSuperAdminEmail)(email)) {
        return res.status(403).json({ error: "Super admin access required" });
    }
    req.superAdmin = { ...payload, email };
    return next();
}
