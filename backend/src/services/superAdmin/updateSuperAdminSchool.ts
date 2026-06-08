import { EduClearPackageCode, SchoolSubscriptionStatus } from "@prisma/client";

import { prisma } from "../../prisma";
import { ensureEduClearPackages } from "../ensureEduClearPackages";
import { addOneCalendarMonth } from "../payfastService";

export type SuperAdminUpdateSchoolInput = {
  schoolId: string;
  status?: "Active" | "Trial" | "Suspended";
  package?: "Starter" | "Unlimited";
};

function parsePackageCode(label: unknown): EduClearPackageCode | null {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "starter") return "STARTER";
  if (normalized === "unlimited") return "UNLIMITED";
  return null;
}

function statusToSubscriptionStatus(
  status: SuperAdminUpdateSchoolInput["status"]
): SchoolSubscriptionStatus | null {
  if (!status) return null;
  switch (status) {
    case "Active":
      return SchoolSubscriptionStatus.ACTIVE;
    case "Suspended":
      return SchoolSubscriptionStatus.SUSPENDED;
    case "Trial":
    default:
      return SchoolSubscriptionStatus.PENDING_PAYMENT;
  }
}

export async function updateSuperAdminSchool(input: SuperAdminUpdateSchoolInput) {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new Error("Missing schoolId");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const patchStatus = statusToSubscriptionStatus(input.status);
  const patchPackageCode = parsePackageCode(input.package);

  if (!patchStatus && !patchPackageCode) {
    throw new Error("No changes provided");
  }

  await ensureEduClearPackages();

  const existing = await prisma.schoolSubscription.findUnique({
    where: { schoolId },
    select: { id: true, status: true, packageCode: true },
  });

  const targetPackageCode =
    patchPackageCode ?? existing?.packageCode ?? ("STARTER" as EduClearPackageCode);
  const pkg = await prisma.eduClearPackage.findUnique({
    where: { code: targetPackageCode },
    select: { id: true, code: true },
  });
  if (!pkg) throw new Error(`Package not found for ${targetPackageCode}`);

  const targetStatus =
    patchStatus ?? existing?.status ?? SchoolSubscriptionStatus.PENDING_PAYMENT;

  const activating =
    targetStatus === SchoolSubscriptionStatus.ACTIVE &&
    existing?.status !== SchoolSubscriptionStatus.ACTIVE;
  const activatedAt = activating ? new Date() : undefined;
  const periodFields =
    activating && activatedAt
      ? {
          currentPeriodStart: new Date(
            activatedAt.getFullYear(),
            activatedAt.getMonth(),
            activatedAt.getDate()
          ),
          currentPeriodEnd: addOneCalendarMonth(
            new Date(activatedAt.getFullYear(), activatedAt.getMonth(), activatedAt.getDate())
          ),
          activatedAt,
          cancelledAt: null,
        }
      : {};

  await prisma.schoolSubscription.upsert({
    where: { schoolId },
    create: {
      schoolId,
      packageId: pkg.id,
      packageCode: pkg.code,
      status: targetStatus,
      activationSource: "super_admin_manual",
      ...periodFields,
    },
    update: {
      packageId: pkg.id,
      packageCode: pkg.code,
      status: targetStatus,
      ...periodFields,
    },
  });

  return { success: true };
}

