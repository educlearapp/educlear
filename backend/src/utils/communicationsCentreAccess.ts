/**
 * Shared Communications Centre access helper for announcements / events / documents.
 * Staff with communications.* are allowed; teachers keep class-scoped workflows via teachers.view.
 */
import {
  hasCommunicationsPermission,
  hasPermission,
  resolveStoredPermissions,
  type PermissionAction,
  type PermissionMap,
} from "./userPermissions";

export function allowCommunicationsCentreActor(
  gate: { auth: { appRole: string; permissions?: PermissionMap | null | unknown } },
  action: PermissionAction
): boolean {
  const permissions = resolveStoredPermissions(
    gate.auth.appRole,
    (gate.auth.permissions || null) as PermissionMap | null
  );
  const user = { appRole: gate.auth.appRole, isActive: true, permissions };
  if (hasCommunicationsPermission(user, action)) return true;
  if (action === "view" || action === "create" || action === "edit" || action === "send") {
    return hasPermission(user, "teachers", "view");
  }
  return false;
}

export function actionFromHttpMethod(method: string): PermissionAction {
  const m = String(method || "GET").toUpperCase();
  if (m === "DELETE") return "delete";
  if (m === "POST") return "create";
  if (m === "PUT" || m === "PATCH") return "edit";
  return "view";
}
