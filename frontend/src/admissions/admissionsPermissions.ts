import { getSchoolSessionUser, type SchoolSessionUser } from "../auth/schoolSession";
import { hasPermission } from "../users/permissions";

function isOwnerOrAdmin(user: SchoolSessionUser | null): boolean {
  const role = String(user?.appRole || "").trim();
  return role === "Owner" || role === "Admin";
}

export function canViewAdmissionsStaff(user = getSchoolSessionUser()): boolean {
  return hasPermission(user, "admissions", "view");
}

export function canEditAdmissionsWorkflow(user = getSchoolSessionUser()): boolean {
  return hasPermission(user, "admissions", "edit");
}

export function canManageAdmissionsDecisions(user = getSchoolSessionUser()): boolean {
  return hasPermission(user, "admissions", "manage") && isOwnerOrAdmin(user);
}

/** Conversion requires manage + learners.create + Owner/Admin (Finance fails). */
export function canConvertAdmissionApplication(user = getSchoolSessionUser()): boolean {
  if (!hasPermission(user, "admissions", "manage")) return false;
  if (!hasPermission(user, "learners", "create")) return false;
  return isOwnerOrAdmin(user);
}
