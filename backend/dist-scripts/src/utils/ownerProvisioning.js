"use strict";
/**
 * Distinguishes school owners created via POST /auth/register-school
 * from migration/repair scripts (ensure-da-silva-owner, school-data-cleanup).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCRIPT_PROVISIONED_OWNER_FULL_NAME = void 0;
exports.normalizeOwnerEmail = normalizeOwnerEmail;
exports.isScriptProvisionedOwner = isScriptProvisionedOwner;
exports.isRegistrationProvisionedOwner = isRegistrationProvisionedOwner;
exports.describeOwnerProvisioning = describeOwnerProvisioning;
/** Full name written only by ensure-da-silva-owner / school-data-cleanup — not register-school. */
exports.SCRIPT_PROVISIONED_OWNER_FULL_NAME = "Da Silva Academy Owner";
function normalizeOwnerEmail(email) {
    return String(email || "").trim().toLowerCase();
}
function isScriptProvisionedOwner(user, school) {
    const fullName = String(user.fullName || "").trim();
    if (fullName === exports.SCRIPT_PROVISIONED_OWNER_FULL_NAME)
        return true;
    const schoolEmail = normalizeOwnerEmail(school.email || "");
    const userEmail = normalizeOwnerEmail(user.email);
    return !schoolEmail && fullName.toLowerCase().includes("owner");
}
function isRegistrationProvisionedOwner(user, school) {
    const schoolEmail = normalizeOwnerEmail(school.email || "");
    const userEmail = normalizeOwnerEmail(user.email);
    return Boolean(schoolEmail && schoolEmail === userEmail && !isScriptProvisionedOwner(user, school));
}
function describeOwnerProvisioning(user, school) {
    if (isRegistrationProvisionedOwner(user, school))
        return "registration";
    if (isScriptProvisionedOwner(user, school))
        return "script";
    return "unknown";
}
