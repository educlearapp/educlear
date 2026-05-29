"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEduClearCreditBundles = ensureEduClearCreditBundles;
const prisma_1 = require("../prisma");
const CREDIT_BUNDLE_SEEDS = [
    {
        code: "FOUNDATION",
        name: "Foundation",
        smsCredits: 250,
        priceCents: 7500,
        mostPopular: false,
        description: "250 SMS credits — once-off purchase.",
    },
    {
        code: "GROWTH",
        name: "Growth",
        smsCredits: 500,
        priceCents: 15000,
        mostPopular: false,
        description: "500 SMS credits — once-off purchase.",
    },
    {
        code: "PROFESSIONAL",
        name: "Professional",
        smsCredits: 1000,
        priceCents: 30000,
        mostPopular: false,
        description: "1,000 SMS credits — once-off purchase.",
    },
    {
        code: "ELITE",
        name: "Elite",
        smsCredits: 2500,
        priceCents: 75000,
        mostPopular: true,
        description: "2,500 SMS credits — once-off purchase.",
    },
];
async function ensureEduClearCreditBundles() {
    const ensured = [];
    for (const seed of CREDIT_BUNDLE_SEEDS) {
        const row = await prisma_1.prisma.eduClearCreditBundle.upsert({
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
