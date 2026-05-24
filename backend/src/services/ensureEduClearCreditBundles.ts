import { EduClearCreditBundleCode } from "@prisma/client";

import { prisma } from "../prisma";

type CreditBundleSeed = {
  code: EduClearCreditBundleCode;
  name: string;
  smsCredits: number;
  priceCents: number;
  mostPopular: boolean;
  description: string;
};

const CREDIT_BUNDLE_SEEDS: CreditBundleSeed[] = [
  {
    code: "FOUNDATION",
    name: "Foundation",
    smsCredits: 250,
    priceCents: 7_500,
    mostPopular: false,
    description: "250 SMS credits — once-off purchase.",
  },
  {
    code: "GROWTH",
    name: "Growth",
    smsCredits: 500,
    priceCents: 15_000,
    mostPopular: false,
    description: "500 SMS credits — once-off purchase.",
  },
  {
    code: "PROFESSIONAL",
    name: "Professional",
    smsCredits: 1_000,
    priceCents: 30_000,
    mostPopular: false,
    description: "1,000 SMS credits — once-off purchase.",
  },
  {
    code: "ELITE",
    name: "Elite",
    smsCredits: 2_500,
    priceCents: 75_000,
    mostPopular: true,
    description: "2,500 SMS credits — once-off purchase.",
  },
];

export async function ensureEduClearCreditBundles(): Promise<string[]> {
  const ensured: string[] = [];

  for (const seed of CREDIT_BUNDLE_SEEDS) {
    const row = await prisma.eduClearCreditBundle.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        name: seed.name,
        smsCredits: seed.smsCredits,
        priceCents: seed.priceCents,
        mostPopular: seed.mostPopular,
        description: seed.description,
        isActive: true,
      },
      update: {
        name: seed.name,
        smsCredits: seed.smsCredits,
        priceCents: seed.priceCents,
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
