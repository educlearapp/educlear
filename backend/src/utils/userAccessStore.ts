import fs from "fs";
import path from "path";

import type { AppRole, PermissionMap } from "./userPermissions";
import { mergePermissions, permissionsForRole } from "./userPermissions";

const ACCESS_FILE = path.join(process.cwd(), "data", "user-access.json");

export type UserAccessMeta = {
  schoolId: string;
  firstName: string;
  surname: string;
  appRole: AppRole | string;
  permissions: PermissionMap;
  lastLoginAt: string | null;
};

type AccessStore = {
  users: Record<string, UserAccessMeta>;
};

function ensureStore() {
  const dir = path.dirname(ACCESS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ACCESS_FILE)) {
    fs.writeFileSync(ACCESS_FILE, JSON.stringify({ users: {} }, null, 2), "utf8");
  }
}

function readStore(): AccessStore {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.users) {
      return { users: parsed.users as Record<string, UserAccessMeta> };
    }
  } catch {
  }
  return { users: {} };
}

function writeStore(store: AccessStore) {
  ensureStore();
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function getUserAccessMeta(userId: string): UserAccessMeta | null {
  const store = readStore();
  return store.users[userId] || null;
}

export function setUserAccessMeta(userId: string, meta: UserAccessMeta) {
  const store = readStore();
  const appRole = String(meta.appRole || "Viewer");
  const permissions =
    appRole === "Owner"
      ? permissionsForRole("Owner")
      : appRole === "Custom"
        ? mergePermissions(meta.permissions)
        : permissionsForRole(appRole, meta.permissions);

  store.users[userId] = {
    ...meta,
    appRole,
    permissions,
  };
  writeStore(store);
}

export function deleteUserAccessMeta(userId: string) {
  const store = readStore();
  delete store.users[userId];
  writeStore(store);
}

export function listAccessMetaForSchool(schoolId: string): Record<string, UserAccessMeta> {
  const store = readStore();
  const out: Record<string, UserAccessMeta> = {};
  for (const [userId, meta] of Object.entries(store.users)) {
    if (meta.schoolId === schoolId) out[userId] = meta;
  }
  return out;
}
