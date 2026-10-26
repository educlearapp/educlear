/**
 * Shared Communications Centre access helper for announcements / events / documents.
 * Requires communications.* — Teacher Inbox / teacher-app messaging stay on teachers.view.
 */
import {
  hasCommunicationsPermission,
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
  return hasCommunicationsPermission(user, action);
}

export function actionFromHttpMethod(method: string): PermissionAction {
  const m = String(method || "GET").toUpperCase();
  if (m === "DELETE") return "delete";
  if (m === "POST") return "create";
  if (m === "PUT" || m === "PATCH") return "edit";
  return "view";
}

/** Lifecycle verbs → Communications RBAC action (view never authorises publish/send). */
export function communicationsActionForLifecycle(
  verb: "publish" | "republish" | "unpublish" | "cancel" | "archive"
): PermissionAction {
  if (verb === "publish" || verb === "republish") return "send";
  if (verb === "archive") return "delete";
  return "edit";
}
