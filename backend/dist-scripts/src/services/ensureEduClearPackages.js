"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEduClearPackages = ensureEduClearPackages;
const prisma_1 = require("../prisma");
const PACKAGE_SEEDS = [
    {
        code: "STARTER",
        name: "Starter",
        monthlyPriceCents: 150000,
        learnerLimit: 100,
        payrollStaffLimit: 15,
        mostPopular: false,
        description: "Includes all core EduClear modules.",
    },
    {
        code: "UNLIMITED",
        name: "Unlimited",
        monthlyPriceCents: 200000,
        learnerLimit: null,
        payrollStaffLimit: null,
        mostPopular: true,
        description: "Includes all EduClear modules with unlimited learners and payroll staff.",
    },
];
async function ensureEduClearPackages() {
    const ensured = [];
    for (const seed of PACKAGE_SEEDS) {
        const row = await prisma_1.prisma.eduClearPackage.upsert({
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
