import { EduClearPackageCode } from "@prisma/client";

import { prisma } from "../prisma";

type PackageSeed = {
  code: EduClearPackageCode;
  name: string;
  monthlyPriceCents: number;
  learnerLimit: number | null;
  payrollStaffLimit: number | null;
  mostPopular: boolean;
  description: string;
};

/**
 * LEGACY capacity packages only (historical SchoolSubscription / PayFast ITN).
 * New-sale commercial SKUs live in educlearCommercialPackages.ts (modular bits).
 * Do not expose STARTER/UNLIMITED as new modular purchase choices in UI.
 */
const PACKAGE_SEEDS: PackageSeed[] = [
  {
    code: "STARTER",
    name: "Starter",
    monthlyPriceCents: 150_000,
    learnerLimit: 100,
    payrollStaffLimit: 15,
    mostPopular: false,
    description:
      "Legacy capacity package (historical compatibility). Not offered for new modular sales.",
  },
  {
    code: "UNLIMITED",
    name: "Unlimited",
    monthlyPriceCents: 200_000,
    learnerLimit: null,
    payrollStaffLimit: null,
    mostPopular: true,
    description:
      "Legacy capacity package (historical compatibility). Not offered for new modular sales.",
  },
];

export async function ensureEduClearPackages(): Promise<string[]> {
  const ensured: string[] = [];

  for (const seed of PACKAGE_SEEDS) {
    const row = await prisma.eduClearPackage.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        name: seed.name,
        monthlyPriceCents: seed.monthlyPriceCents,
        learnerLimit: seed.learnerLimit,
        payrollStaffLimit: seed.payrollStaffLimit,
        mostPopular: seed.mostPopular,
        description: seed.description,
        isActive: true,
      },
      update: {
        name: seed.name,
        monthlyPriceCents: seed.monthlyPriceCents,
        learnerLimit: seed.learnerLimit,
        payrollStaffLimit: seed.payrollStaffLimit,
        mostPopular: seed.mostPopular,
        description: seed.description,
        isActive: true,
      },
      select: { code: true },
    });

    ensured.push(row.code);
  }

  return ensured;
}
