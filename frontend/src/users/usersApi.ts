import { API_URL } from "../api";
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

async function parseJson(response: Response) {
  const text = await response.text();
  let data: unknown = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        const plain = text
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        if (response.status === 404) {
          throw new Error(
            plain ||
              "Users API not found (404). Rebuild and restart the backend: cd backend && npm run build && npm run dev"
          );
        }
        throw new Error(plain || `Server returned non-JSON response (${response.status})`);
      }
      throw new Error("Invalid server response (expected JSON)");
    }
  }

  if (!response.ok) {
    throw new Error(errorFromBody(data, response.status));
  }

  if (data && typeof data === "object" && (data as { success?: boolean }).success === false) {
    throw new Error(errorFromBody(data, response.status));
  }

  return data as Record<string, unknown>;
}

export async function fetchSchoolUsers(schoolId: string): Promise<SchoolUser[]> {
  const params = new URLSearchParams({ schoolId });
  const data = await parseJson(await fetch(`${API_URL}/api/users?${params.toString()}`));
  const users = Array.isArray(data.users) ? (data.users as SchoolUser[]) : [];
  for (const user of users) {
    logRbacLoad(user);
  }
  return users;
}

export async function createSchoolUser(payload: Record<string, unknown>): Promise<SchoolUser> {
  const data = await parseJson(
    await fetch(`${API_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return data.user as SchoolUser;
}

export async function updateSchoolUser(id: string, payload: Record<string, unknown>): Promise<SchoolUser> {
  const data = await parseJson(
    await fetch(`${API_URL}/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return data.user as SchoolUser;
}

export async function patchUserStatus(id: string, status: "Active" | "Disabled"): Promise<SchoolUser> {
  const data = await parseJson(
    await fetch(`${API_URL}/api/users/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
  );
  return data.user as SchoolUser;
}

export async function patchUserPermissions(
  id: string,
  payload: { appRole: string; permissions: PermissionMap }
): Promise<SchoolUser> {
  const data = await parseJson(
    await fetch(`${API_URL}/api/users/${id}/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  const user = data.user as SchoolUser;
  logRbacSave(user);
  return user;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await parseJson(
    await fetch(`${API_URL}/api/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
  );
}
