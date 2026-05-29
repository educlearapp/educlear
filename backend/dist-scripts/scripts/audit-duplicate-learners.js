"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Audit duplicate learners for a school (read-only).
 * Usage: npx tsx scripts/audit-duplicate-learners.ts [schoolId]
 */
const client_1 = require("@prisma/client");
const schoolId = process.argv[2] || "cmpideqeq0000108xb6ouv9zi";
const prisma = new client_1.PrismaClient();
function norm(s) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}
async function main() {
    const learners = await prisma.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
            admissionNo: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    });
    const byNameClass = new Map();
    for (const l of learners) {
        const key = norm(`${l.firstName}|${l.lastName}|${l.className || ""}`);
        const arr = byNameClass.get(key) || [];
        arr.push(l);
        byNameClass.set(key, arr);
    }
    const dupes = [...byNameClass.entries()].filter(([, arr]) => arr.length > 1);
    const extraRows = dupes.reduce((s, [, a]) => s + a.length - 1, 0);
    const byNameOnly = new Map();
    for (const l of learners) {
        const key = norm(`${l.firstName}|${l.lastName}`);
        const arr = byNameOnly.get(key) || [];
        arr.push(l);
        byNameOnly.set(key, arr);
    }
    const nameDupes = [...byNameOnly.entries()].filter(([, arr]) => arr.length > 1);
    const adrien = learners.filter((l) => norm(l.firstName).includes("adrien") && norm(l.lastName).includes("silva"));
    console.log(JSON.stringify({
        schoolId,
        totalLearners: learners.length,
        duplicateNameClassGroups: dupes.length,
        extraDuplicateRows: extraRows,
        duplicateNameOnlyGroups: nameDupes.length,
        extraNameOnlyRows: nameDupes.reduce((s, [, a]) => s + a.length - 1, 0),
        adrienSilva: adrien,
        sampleNameDuplicates: nameDupes.slice(0, 8).map(([key, arr]) => ({
            key,
            count: arr.length,
            learners: arr.map((l) => ({
                id: l.id,
                className: l.className,
                admissionNo: l.admissionNo,
                createdAt: l.createdAt,
            })),
        })),
        sampleDuplicates: dupes.slice(0, 5).map(([key, arr]) => ({
            key,
            count: arr.length,
            learners: arr.map((l) => ({
                id: l.id,
                admissionNo: l.admissionNo,
                createdAt: l.createdAt,
            })),
        })),
    }, null, 2));
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
