import { EduClearPackageCode, SchoolSubscriptionStatus } from "@prisma/client";

import { prisma } from "../../prisma";

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

  const subscription = await prisma.schoolSubscription.findUnique({
    where: { schoolId },
    select: { id: true },
  });
  if (!subscription) {
    throw new Error("School subscription record not found");
  }

  let packageUpdate:
    | { packageId: string; packageCode: EduClearPackageCode }
    | null = null;
  if (patchPackageCode) {
    const pkg = await prisma.eduClearPackage.findUnique({
      where: { code: patchPackageCode },
      select: { id: true, code: true },
    });
    if (!pkg) throw new Error(`Package not found for ${patchPackageCode}`);
    packageUpdate = { packageId: pkg.id, packageCode: pkg.code };
  }

  await prisma.schoolSubscription.update({
    where: { schoolId },
    data: {
      ...(patchStatus ? { status: patchStatus } : {}),
      ...(packageUpdate ? packageUpdate : {}),
    },
  });

  return { success: true };
}

