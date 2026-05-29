"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS = exports.LEARNER_PRODUCTION_SELECT = void 0;
exports.isPrismaMissingColumnError = isPrismaMissingColumnError;
exports.probePublicTableColumns = probePublicTableColumns;
exports.getDaSilvaLearnerSchemaCaps = getDaSilvaLearnerSchemaCaps;
exports.deriveLearnerDisplayStatus = deriveLearnerDisplayStatus;
exports.fetchSampleLearnersSafe = fetchSampleLearnersSafe;
exports.countParentLearnerLinksSafe = countParentLearnerLinksSafe;
exports.countFamilyAccountsWithLearnersSafe = countFamilyAccountsWithLearnersSafe;
const LEARNER_OPTIONAL_COLUMNS = ["enrollmentStatus"];
exports.LEARNER_PRODUCTION_SELECT = {
    id: true,
    firstName: true,
    lastName: true,
    className: true,
    admissionNo: true,
    familyAccountId: true,
    schoolId: true,
    createdAt: true,
};
exports.DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS = "Enrolled";
function isPrismaMissingColumnError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2022");
}
async function probePublicTableColumns(prisma, tableName) {
    const rows = await prisma.$queryRaw `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `;
    return new Set(rows.map((r) => r.column_name));
}
async function getDaSilvaLearnerSchemaCaps(prisma) {
    const cols = await probePublicTableColumns(prisma, "Learner");
    const notes = [];
    for (const name of LEARNER_OPTIONAL_COLUMNS) {
        if (!cols.has(name)) {
            notes.push(`Learner.${name} not available in schema`);
        }
    }
    return {
        enrollmentStatus: cols.has("enrollmentStatus"),
        notes,
    };
}
function deriveLearnerDisplayStatus(caps, enrollmentStatus) {
    if (!caps.enrollmentStatus) {
        return exports.DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS;
    }
    const upper = String(enrollmentStatus || "ACTIVE").toUpperCase();
    if (upper === "HISTORICAL")
        return "Historical";
    return exports.DEFAULT_MIGRATION_LEARNER_DISPLAY_STATUS;
}
async function fetchSampleLearnersSafe(prisma, schoolId, caps, take = 10) {
    const orderBy = { lastName: "asc" };
    const where = { schoolId };
    const baseSelect = {
        ...exports.LEARNER_PRODUCTION_SELECT,
        ...(caps.enrollmentStatus ? { enrollmentStatus: true } : {}),
    };
    const attempts = [
        {
            label: "with familyAccount and links",
            select: {
                ...baseSelect,
                familyAccount: { select: { accountRef: true } },
                links: { select: { parentId: true } },
            },
        },
        {
            label: "with familyAccount only",
            select: {
                ...baseSelect,
                familyAccount: { select: { accountRef: true } },
            },
        },
        {
            label: "learner fields only",
            select: baseSelect,
        },
    ];
    let lastError;
    for (const attempt of attempts) {
        try {
            const rows = (await prisma.learner.findMany({
                where,
                take,
                orderBy,
                select: attempt.select,
            }));
            const relationsNote = attempt.label === "learner fields only"
                ? "familyAccount/links not available in schema"
                : null;
            return rows.map((l) => ({
                id: l.id,
                firstName: l.firstName,
                lastName: l.lastName,
                className: l.className,
                admissionNo: l.admissionNo,
                familyAccountId: l.familyAccountId,
                schoolId: l.schoolId,
                createdAt: l.createdAt,
                displayStatus: deriveLearnerDisplayStatus(caps, l.enrollmentStatus),
                accountRef: l.familyAccount?.accountRef ?? null,
                parentLinkCount: l.links ? l.links.length : relationsNote ? null : 0,
                relationsNote,
            }));
        }
        catch (error) {
            lastError = error;
            if (!isPrismaMissingColumnError(error))
                throw error;
        }
    }
    throw lastError;
}
async function countParentLearnerLinksSafe(prisma, schoolId) {
    try {
        const count = await prisma.parentLearnerLink.count({ where: { schoolId } });
        return { count, note: null };
    }
    catch (error) {
        if (!isPrismaMissingColumnError(error))
            throw error;
        return { count: 0, note: "ParentLearnerLink not available in schema" };
    }
}
async function countFamilyAccountsWithLearnersSafe(prisma, schoolId) {
    try {
        const count = await prisma.familyAccount.count({
            where: { schoolId, learners: { some: {} } },
        });
        return { count, note: null };
    }
    catch (error) {
        if (!isPrismaMissingColumnError(error))
            throw error;
        return { count: 0, note: "FamilyAccount.learners relation not available in schema" };
    }
}
