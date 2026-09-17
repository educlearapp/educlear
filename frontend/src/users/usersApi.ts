import { apiFetch, ApiError } from "../api";
import type { PermissionMap, SchoolUser } from "./permissions";

function countGrantedPermissions(permissions: PermissionMap | undefined): number {
  if (!permissions) return 0;
  let count = 0;
  for (const mod of Object.values(permissions)) {
    if (!mod) continue;
    for (const allowed of Object.values(mod)) {
      if (allowed) count += 1;
    }
  }
  return count;
}

function logRbacLoad(user: SchoolUser) {
  console.log(
    `[rbacLoad] userId=${user.id} role=${user.appRole} permissionsCount=${countGrantedPermissions(user.permissions)}`
  );
}

function logRbacSave(user: SchoolUser) {
  console.log(
    `[rbacSave] userId=${user.id} role=${user.appRole} permissionsCount=${countGrantedPermissions(user.permissions)}`
  );
}

function errorFromBody(data: unknown, status: number) {
  if (data && typeof data === "object") {
    const row = data as Record<string, unknown>;
    if (row.error) return String(row.error);
    if (row.message) return String(row.message);
  }
  return `Request failed (${status})`;
}

async function apiJson(path: string, options?: Parameters<typeof apiFetch>[1]) {
  try {
    const data = await apiFetch(path, options);
    if (data && typeof data === "object" && (data as { success?: boolean }).success === false) {
      throw new Error(errorFromBody(data, 200));
    }
    return data as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        const plain =
          typeof err.data === "string"
            ? err.data
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 200)
            : "";
        throw new Error(
          plain ||
            "Users API not found (404). Rebuild and restart the backend: cd backend && npm run build && npm run dev"
        );
      }
      throw new Error(errorFromBody(err.data, err.status) || err.message);
    }
    throw err;
  }
}

export async function fetchSchoolUsers(schoolId: string): Promise<SchoolUser[]> {
  const params = new URLSearchParams({ schoolId });
  const data = await apiJson(`/api/users?${params.toString()}`);
  const users = Array.isArray(data.users) ? (data.users as SchoolUser[]) : [];
  for (const user of users) {
    logRbacLoad(user);
  }
  return users;
}

export async function createSchoolUser(payload: Record<string, unknown>): Promise<SchoolUser> {
  const data = await apiJson("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.user as SchoolUser;
}

export async function updateSchoolUser(id: string, payload: Record<string, unknown>): Promise<SchoolUser> {
  const data = await apiJson(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return data.user as SchoolUser;
}

export async function patchUserStatus(id: string, status: "Active" | "Disabled"): Promise<SchoolUser> {
  const data = await apiJson(`/api/users/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return data.user as SchoolUser;
}

export async function patchUserPermissions(
  id: string,
  payload: { appRole: string; permissions: PermissionMap }
): Promise<SchoolUser> {
  const data = await apiJson(`/api/users/${id}/permissions`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  const user = data.user as SchoolUser;
  logRbacSave(user);
  return user;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await apiJson(`/api/users/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}
