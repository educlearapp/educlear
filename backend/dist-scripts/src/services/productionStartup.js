"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProductionStartup = runProductionStartup;
const activateDaSilvaSubscription_1 = require("./activateDaSilvaSubscription");
const ensureDaSilvaAcademyProduction_1 = require("./ensureDaSilvaAcademyProduction");
const ensureEduClearPackages_1 = require("./ensureEduClearPackages");
const prismaMigrationRecovery_1 = require("./prismaMigrationRecovery");
const prisma_1 = require("../prisma");
const daSilvaSchoolResolve_1 = require("./daSilvaSchoolResolve");
const runtime_1 = require("./runtime");
/**
 * Production boot tasks before HTTP listen: migrations, package seeds, Da Silva ensure + activation.
 */
async function runProductionStartup() {
    console.log("[startup] Running migration recovery");
    await (0, prismaMigrationRecovery_1.runPrismaMigrateDeployWithRecovery)();
    try {
        const codes = await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
        console.log(`[startup] EduClear packages ensured: ${codes.join(", ")}`);
    }
    catch (error) {
        console.error("[startup] ensureEduClearPackages failed:", error);
    }
    if (!(0, runtime_1.isProductionOrGoLive)()) {
        return;
    }
    try {
        await (0, daSilvaSchoolResolve_1.refreshDaSilvaSchoolIdCache)();
    }
    catch (error) {
        console.error("[startup] Da Silva school id cache failed:", error);
    }
    console.log("[startup] Da Silva school ensure/import starting");
    try {
        await (0, ensureDaSilvaAcademyProduction_1.ensureDaSilvaAcademyProduction)();
    }
    catch (error) {
        console.error("[startup] Da Silva school ensure/import failed:", error);
    }
    const resolvedSchoolId = (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)();
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: resolvedSchoolId },
        select: { id: true },
    });
    if (!school) {
        console.error(`[startup] Da Silva subscription activation skipped — school not found: ${resolvedSchoolId}`);
        return;
    }
    console.log("[startup] Da Silva school ensured/imported");
    console.log("[startup] Da Silva subscription activation starting");
    try {
        await (0, activateDaSilvaSubscription_1.ensureDaSilvaAcademySubscription)();
        console.log("[startup] Da Silva subscription ACTIVE");
    }
    catch (error) {
        console.error("[startup] Da Silva subscription activation failed:", error);
    }
}
