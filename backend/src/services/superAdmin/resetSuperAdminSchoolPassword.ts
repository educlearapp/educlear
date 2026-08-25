import { UserRole } from "@prisma/client";

import { prisma } from "../../prisma";
import { hashAuthPassword } from "../authCredentials";

export const SUPER_ADMIN_SCHOOL_PASSWORD_MIN_LENGTH = 8;

export class SuperAdminSchoolPasswordResetError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SuperAdminSchoolPasswordResetError";
    this.statusCode = statusCode;
  }
}

type OwnerCandidate = {
  id: string;
  schoolId: string;
  email: string;
  roleRef: { isOwner: boolean } | null;
  rbacMeta: { appRole: string } | null;
};

function isOwnerUser(user: OwnerCandidate): boolean {
  if (user.roleRef?.isOwner) return true;
  return String(user.rbacMeta?.appRole || "").trim() === "Owner";
}

function pickOwnerUser(users: OwnerCandidate[]): OwnerCandidate | null {
  if (!users.length) return null;
  return users.find(isOwnerUser) ?? users[0];
}

export type ResetSuperAdminSchoolPasswordInput = {
  schoolId: string;
  claimedSchoolId?: string;
  newPassword: string;
  confirmPassword: string;
};

export type ResetSuperAdminSchoolPasswordResult = {
  schoolId: string;
  schoolName: string;
  ownerEmail: string;
};

/**
 * Reset the canonical school-login User.passwordHash for one school.
 * Does not change email, role, package, status, learners, or finance.
 */
type PasswordResetDb = {
  school: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; name: true };
    }) => Promise<{ id: string; name: string } | null>;
  };
  user: {
    findMany: (args: unknown) => Promise<OwnerCandidate[]>;
    updateMany: (args: {
      where: { id: string; schoolId: string };
      data: { passwordHash: string };
    }) => Promise<{ count: number }>;
  };
};

export async function resetSuperAdminSchoolPassword(
  input: ResetSuperAdminSchoolPasswordInput,
  db: PasswordResetDb = prisma as unknown as PasswordResetDb
): Promise<ResetSuperAdminSchoolPasswordResult> {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new SuperAdminSchoolPasswordResetError("schoolId is required", 400);
  }

  const claimed = String(input.claimedSchoolId || "").trim();
  if (!claimed) {
    throw new SuperAdminSchoolPasswordResetError("schoolId is required", 400);
  }
  if (claimed !== schoolId) {
    throw new SuperAdminSchoolPasswordResetError("schoolId does not match the target school", 400);
  }

  const newPassword = String(input.newPassword ?? "");
  const confirmPassword = String(input.confirmPassword ?? "");
  if (!newPassword || newPassword.length < SUPER_ADMIN_SCHOOL_PASSWORD_MIN_LENGTH) {
    throw new SuperAdminSchoolPasswordResetError(
      `New password must be at least ${SUPER_ADMIN_SCHOOL_PASSWORD_MIN_LENGTH} characters`,
      400
    );
  }
  if (newPassword !== confirmPassword) {
    throw new SuperAdminSchoolPasswordResetError("Passwords do not match", 400);
  }

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) {
    throw new SuperAdminSchoolPasswordResetError("School not found", 404);
  }

  const candidates = (await db.user.findMany({
    where: {
      schoolId,
      isActive: true,
      OR: [
        { roleRef: { isOwner: true } },
        { rbacMeta: { appRole: "Owner" } },
        { role: UserRole.SCHOOL_ADMIN },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: {
      id: true,
      schoolId: true,
      email: true,
      roleRef: { select: { isOwner: true } },
      rbacMeta: { select: { appRole: true } },
    },
  })) as OwnerCandidate[];

  const owner = pickOwnerUser(candidates);
  if (!owner || owner.schoolId !== schoolId) {
    throw new SuperAdminSchoolPasswordResetError(
      "No school login user found for this school",
      404
    );
  }

  const passwordHash = await hashAuthPassword(newPassword);
  const updated = await db.user.updateMany({
    where: { id: owner.id, schoolId },
    data: { passwordHash },
  });
  if (updated.count !== 1) {
    throw new SuperAdminSchoolPasswordResetError(
      "School login password was not updated",
      409
    );
  }

  console.log("[super-admin/schools] password reset", {
    schoolId: school.id,
    userId: owner.id,
  });

  return {
    schoolId: school.id,
    schoolName: school.name,
    ownerEmail: owner.email,
  };
}
