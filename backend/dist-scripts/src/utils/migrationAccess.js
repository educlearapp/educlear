"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_ALLOWED_ROLES = void 0;
exports.normalizeMigrationRole = normalizeMigrationRole;
exports.isMigrationAllowedRole = isMigrationAllowedRole;
exports.canAccessMigration = canAccessMigration;
exports.migrationAccessDeniedDebug = migrationAccessDeniedDebug;
const superAdmin_1 = require("./superAdmin");
/** Roles allowed to use Migration Center (JWT `role` string, case-insensitive). */
exports.MIGRATION_ALLOWED_ROLES = new Set([
    "SUPER_ADMIN",
    "OWNER",
    "SCHOOL_OWNER",
    "SCHOOL_ADMIN",
    "PLATFORM_ADMIN",
]);
function normalizeMigrationRole(role) {
    return String(role || "").trim().toUpperCase();
}
function isMigrationAllowedRole(role) {
    return exports.MIGRATION_ALLOWED_ROLES.has(normalizeMigrationRole(role));
}
function canAccessMigration(ctx) {
    const email = (0, superAdmin_1.normalizeSuperAdminEmail)(ctx.email);
    if ((0, superAdmin_1.isPlatformSuperAdminEmail)(email))
        return true;
    return isMigrationAllowedRole(ctx.role);
}
function migrationAccessDeniedDebug(ctx) {
    const role = normalizeMigrationRole(ctx.role);
    const email = (0, superAdmin_1.normalizeSuperAdminEmail)(ctx.email);
    let missingPermission = "migration_center";
    if ((0, superAdmin_1.isPlatformSuperAdminEmail)(email)) {
        missingPermission = "none";
    }
    else if (!role) {
        missingPermission = "role_missing";
    }
    else if (!isMigrationAllowedRole(role)) {
        missingPermission = `role_${role.toLowerCase()}_not_permitted`;
    }
    return {
        userId: ctx.userId ? String(ctx.userId) : null,
        role: role || null,
        schoolId: ctx.schoolId ? String(ctx.schoolId) : null,
        missingPermission,
    };
}
