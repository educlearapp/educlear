"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_BILLING_DATA_SCHOOL_ID = void 0;
exports.registerDaSilvaSchoolId = registerDaSilvaSchoolId;
exports.isDaSilvaSchoolId = isDaSilvaSchoolId;
exports.resolveSchoolJsonStoreKey = resolveSchoolJsonStoreKey;
exports.refreshDaSilvaSchoolIdCache = refreshDaSilvaSchoolIdCache;
const activateDaSilvaSubscription_1 = require("./activateDaSilvaSubscription");
const prisma_1 = require("../prisma");
/** Canonical key for Kid-e-Sys JSON billing files (ledger, plans, history). */
exports.DA_SILVA_BILLING_DATA_SCHOOL_ID = activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
const daSilvaSchoolIds = new Set([activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID]);
function registerDaSilvaSchoolId(id) {
    const key = String(id || "").trim();
    if (key)
        daSilvaSchoolIds.add(key);
}
function isDaSilvaSchoolId(schoolId) {
    const key = String(schoolId || "").trim();
    if (!key)
        return false;
    if (daSilvaSchoolIds.has(key))
        return true;
    const fromEnv = String(process.env.DA_SILVA_SCHOOL_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return fromEnv.includes(key);
}
/**
 * Maps a live Da Silva school row id to the canonical JSON data bucket when needed.
 */
function resolveSchoolJsonStoreKey(schoolId, all, hasContent) {
    const key = String(schoolId || "").trim();
    if (!key)
        return key;
    if (hasContent(all[key]))
        return key;
    const canonical = exports.DA_SILVA_BILLING_DATA_SCHOOL_ID;
    if (key !== canonical &&
        isDaSilvaSchoolId(key) &&
        hasContent(all[canonical])) {
        return canonical;
    }
    // Live school row id may not be registered yet; use canonical when it is the only bucket.
    if (key !== canonical && hasContent(all[canonical])) {
        const populated = Object.keys(all).filter((k) => hasContent(all[k]));
        if (populated.length === 1 && populated[0] === canonical) {
            return canonical;
        }
    }
    return key;
}
/** Load every Prisma school row that belongs to Da Silva Academy (name / owner email / canonical id). */
async function refreshDaSilvaSchoolIdCache() {
    daSilvaSchoolIds.clear();
    daSilvaSchoolIds.add(activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID);
    daSilvaSchoolIds.add((0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)());
    for (const id of String(process.env.DA_SILVA_SCHOOL_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        daSilvaSchoolIds.add(id);
    }
    const schools = await prisma_1.prisma.school.findMany({
        where: {
            OR: [
                { id: activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID },
                { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
                { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
            ],
        },
        select: { id: true },
    });
    for (const row of schools) {
        daSilvaSchoolIds.add(row.id);
        registerDaSilvaSchoolId(row.id);
    }
    return Array.from(daSilvaSchoolIds);
}
