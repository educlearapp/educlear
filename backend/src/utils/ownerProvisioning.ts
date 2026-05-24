/**
 * Distinguishes school owners created via POST /auth/register-school
 * from migration/repair scripts (ensure-da-silva-owner, school-data-cleanup).
 */

/** Full name written only by ensure-da-silva-owner / school-data-cleanup — not register-school. */
export const SCRIPT_PROVISIONED_OWNER_FULL_NAME = "Da Silva Academy Owner";

export type OwnerProvisioningSchool = {
  email: string | null;
};

export type OwnerProvisioningUser = {
  email: string;
  fullName: string | null;
};

export function normalizeOwnerEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export function isScriptProvisionedOwner(
  user: OwnerProvisioningUser,
  school: OwnerProvisioningSchool
): boolean {
  const fullName = String(user.fullName || "").trim();
  if (fullName === SCRIPT_PROVISIONED_OWNER_FULL_NAME) return true;
  const schoolEmail = normalizeOwnerEmail(school.email || "");
  const userEmail = normalizeOwnerEmail(user.email);
  return !schoolEmail && fullName.toLowerCase().includes("owner");
}

export function isRegistrationProvisionedOwner(
  user: OwnerProvisioningUser,
  school: OwnerProvisioningSchool
): boolean {
  const schoolEmail = normalizeOwnerEmail(school.email || "");
  const userEmail = normalizeOwnerEmail(user.email);
  return Boolean(schoolEmail && schoolEmail === userEmail && !isScriptProvisionedOwner(user, school));
}

export function describeOwnerProvisioning(
  user: OwnerProvisioningUser,
  school: OwnerProvisioningSchool
): "registration" | "script" | "unknown" {
  if (isRegistrationProvisionedOwner(user, school)) return "registration";
  if (isScriptProvisionedOwner(user, school)) return "script";
  return "unknown";
}
