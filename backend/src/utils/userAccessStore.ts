import fs from "fs";
import path from "path";

import { prisma } from "../prisma";
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
  updatedAt?: string | null;
  updatedBy?: string | null;
  roleChangedAt?: string | null;
};

export type SetUserAccessOptions = {
  updatedBy?: string;
};

let legacyImportDone = false;

function rowToMeta(row: {
  schoolId: string;
  firstName: string;
  surname: string;
  appRole: string;
  permissions: unknown;
  lastLoginAt: Date | null;
  updatedAt?: Date;
  updatedBy?: string | null;
  roleChangedAt?: Date | null;
}): UserAccessMeta {
  return {
    schoolId: row.schoolId,
    firstName: row.firstName,
    surname: row.surname,
    appRole: row.appRole,
    permissions: mergePermissions(row.permissions as PermissionMap),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy ?? null,
    roleChangedAt: row.roleChangedAt?.toISOString() ?? null,
  };
}

/** Persist exact permission map; role templates apply only when no permissions supplied. */
function normalizePermissionsForSave(appRole: string, permissions: PermissionMap): PermissionMap {
  if (appRole === "Owner") return permissionsForRole("Owner");
  return mergePermissions(permissions);
}

async function importLegacyJsonOnce(): Promise<number> {
  if (legacyImportDone) return 0;
  legacyImportDone = true;

  if (!fs.existsSync(ACCESS_FILE)) return 0;

  try {
    const parsed = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8")) as {
      users?: Record<string, UserAccessMeta>;
    };
    const users = parsed?.users;
    if (!users || typeof users !== "object") return 0;

    let imported = 0;
    for (const [userId, meta] of Object.entries(users)) {
      const existing = await prisma.userRbacMeta.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (existing) continue;

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) continue;

      const appRole = String(meta.appRole || "Viewer");
      const permissions = normalizePermissionsForSave(
        appRole,
        meta.permissions || permissionsForRole(appRole)
      );

      await prisma.userRbacMeta.create({
        data: {
          userId,
          schoolId: meta.schoolId,
          firstName: meta.firstName || "",
          surname: meta.surname || "",
          appRole,
          permissions: permissions as object,
          lastLoginAt: meta.lastLoginAt ? new Date(meta.lastLoginAt) : null,
        },
      });
      imported += 1;
    }

    if (imported > 0) {
      console.log(
        `[userAccess] Imported ${imported} missing RBAC record(s) from legacy user-access.json into PostgreSQL`
      );
    }
    return imported;
  } catch (error) {
    console.error("[userAccess] Legacy JSON import failed:", error);
    return 0;
  }
}

export async function getUserAccessMeta(userId: string): Promise<UserAccessMeta | null> {
  await importLegacyJsonOnce();
  const row = await prisma.userRbacMeta.findUnique({ where: { userId } });
  return row ? rowToMeta(row) : null;
}

export async function setUserAccessMeta(
  userId: string,
  meta: UserAccessMeta,
  options?: SetUserAccessOptions
): Promise<void> {
  const appRole = String(meta.appRole || "Viewer");
  const permissions = normalizePermissionsForSave(appRole, meta.permissions);

  const existing = await prisma.userRbacMeta.findUnique({
    where: { userId },
    select: { appRole: true },
  });

  const roleChanged = existing ? existing.appRole !== appRole : true;
  const now = new Date();

  await prisma.userRbacMeta.upsert({
    where: { userId },
    create: {
      userId,
      schoolId: meta.schoolId,
      firstName: meta.firstName || "",
      surname: meta.surname || "",
      appRole,
      permissions: permissions as object,
      lastLoginAt: meta.lastLoginAt ? new Date(meta.lastLoginAt) : null,
      updatedBy: options?.updatedBy ?? null,
      roleChangedAt: roleChanged ? now : null,
    },
    update: {
      schoolId: meta.schoolId,
      firstName: meta.firstName || "",
      surname: meta.surname || "",
      appRole,
      permissions: permissions as object,
      ...(meta.lastLoginAt ? { lastLoginAt: new Date(meta.lastLoginAt) } : {}),
      ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
      ...(roleChanged ? { roleChangedAt: now } : {}),
    },
  });

  console.log(
    `[userAccess] saved userId=${userId} appRole=${appRole} schoolId=${meta.schoolId} roleChanged=${roleChanged}`
  );
}

export async function deleteUserAccessMeta(userId: string): Promise<void> {
  await prisma.userRbacMeta.deleteMany({ where: { userId } });
}

export async function listAccessMetaForSchool(
  schoolId: string
): Promise<Record<string, UserAccessMeta>> {
  await importLegacyJsonOnce();
  const rows = await prisma.userRbacMeta.findMany({ where: { schoolId } });
  const out: Record<string, UserAccessMeta> = {};
  for (const row of rows) {
    out[row.userId] = rowToMeta(row);
  }
  return out;
}

/** One-shot migration helper for ops scripts. Imports JSON rows missing from PostgreSQL only. */
export async function migrateLegacyJsonToPostgres(): Promise<{
  imported: number;
  skipped: number;
  postgresCount: number;
}> {
  legacyImportDone = false;

  if (!fs.existsSync(ACCESS_FILE)) {
    const postgresCount = await prisma.userRbacMeta.count();
    return { imported: 0, skipped: 0, postgresCount };
  }

  const parsed = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8")) as {
    users?: Record<string, UserAccessMeta>;
  };
  const users = parsed?.users || {};
  let imported = 0;
  let skipped = 0;

  for (const [userId, meta] of Object.entries(users)) {
    const existing = await prisma.userRbacMeta.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      skipped += 1;
      continue;
    }

    const appRole = String(meta.appRole || "Viewer");
    const permissions = normalizePermissionsForSave(
      appRole,
      meta.permissions || permissionsForRole(appRole)
    );

    await prisma.userRbacMeta.create({
      data: {
        userId,
        schoolId: meta.schoolId,
        firstName: meta.firstName || "",
        surname: meta.surname || "",
        appRole,
        permissions: permissions as object,
        lastLoginAt: meta.lastLoginAt ? new Date(meta.lastLoginAt) : null,
      },
    });
    imported += 1;
  }

  legacyImportDone = true;
  const postgresCount = await prisma.userRbacMeta.count();
  return { imported, skipped, postgresCount };
}
