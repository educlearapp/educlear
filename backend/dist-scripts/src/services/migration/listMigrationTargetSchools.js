"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMigrationTargetSchools = listMigrationTargetSchools;
const activateDaSilvaSubscription_1 = require("../activateDaSilvaSubscription");
const daSilvaSchoolResolve_1 = require("../daSilvaSchoolResolve");
const prisma_1 = require("../../prisma");
/**
 * Ensures Da Silva Academy exists as a migration target when the row was removed by hard delete.
 * Does not import learners or billing — school shell only.
 */
async function ensureDaSilvaSchoolRow() {
    try {
        const byId = await prisma_1.prisma.school.findUnique({
            where: { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
            select: { id: true },
        });
        if (byId) {
            (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(byId.id);
            return { id: byId.id, created: false };
        }
        const byEmail = await prisma_1.prisma.school.findFirst({
            where: { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
            select: { id: true },
        });
        if (byEmail) {
            await prisma_1.prisma.school.update({
                where: { id: byEmail.id },
                data: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME, email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
            });
            (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(byEmail.id);
            return { id: byEmail.id, created: false };
        }
        const byName = await prisma_1.prisma.school.findFirst({
            where: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
            select: { id: true },
        });
        if (byName) {
            (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(byName.id);
            return { id: byName.id, created: false };
        }
        await prisma_1.prisma.school.create({
            data: {
                id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID,
                name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME,
                email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL,
            },
        });
        (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID);
        return { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID, created: true };
    }
    catch (error) {
        console.error("[listMigrationTargetSchools] ensure Da Silva school failed:", error);
        return null;
    }
}
/** All Prisma School rows for migration target picker — alphabetical, no platform-only filter. */
async function listMigrationTargetSchools() {
    const daSilva = await ensureDaSilvaSchoolRow();
    await (0, daSilvaSchoolResolve_1.refreshDaSilvaSchoolIdCache)().catch(() => { });
    const rows = await prisma_1.prisma.school.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    const schools = rows.map((row) => ({
        id: row.id,
        name: row.name,
    }));
    const schoolIds = schools.map((s) => s.id);
    const schoolNames = schools.map((s) => s.name);
    return {
        schools,
        debug: {
            total: schools.length,
            schoolIds,
            schoolNames,
            ensuredDaSilva: daSilva !== null,
            daSilvaCreated: daSilva?.created ?? false,
            daSilvaSchoolId: daSilva?.id ?? null,
        },
    };
}
