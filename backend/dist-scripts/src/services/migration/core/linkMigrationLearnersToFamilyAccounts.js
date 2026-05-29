"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.linkMigrationLearnersToFamilyAccounts = linkMigrationLearnersToFamilyAccounts;
const prisma_1 = require("../../../prisma");
function admissionBase(admissionNo) {
    const adm = String(admissionNo || "").trim();
    if (!adm)
        return "";
    const dash = adm.indexOf("-");
    return dash === -1 ? adm : adm.slice(0, dash);
}
function normName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
/**
 * After migration apply creates learners and billing accounts separately,
 * connect learners to FamilyAccount rows by admissionNo / surname / account ref.
 */
async function linkMigrationLearnersToFamilyAccounts(schoolId, tx) {
    const client = tx || prisma_1.prisma;
    const familyAccounts = await client.familyAccount.findMany({
        where: { schoolId },
        select: { id: true, accountRef: true, familyName: true },
    });
    const familyByRef = new Map(familyAccounts.map((fa) => [fa.accountRef, fa]));
    const learners = await client.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            familyAccountId: true,
        },
    });
    let learnersLinked = 0;
    for (const learner of learners) {
        if (learner.familyAccountId)
            continue;
        const admBase = admissionBase(learner.admissionNo);
        let targetFa = admBase ? familyByRef.get(admBase) : undefined;
        if (!targetFa) {
            const surname = normName(learner.lastName);
            const matches = familyAccounts.filter((fa) => normName(fa.familyName) === surname);
            if (matches.length === 1)
                targetFa = matches[0];
        }
        if (!targetFa)
            continue;
        await client.learner.update({
            where: { id: learner.id },
            data: {
                familyAccountId: targetFa.id,
                admissionNo: learner.admissionNo || targetFa.accountRef,
            },
        });
        learnersLinked += 1;
    }
    const parents = await client.parent.findMany({
        where: { schoolId, familyAccountId: null },
        select: {
            id: true,
            links: { select: { learner: { select: { familyAccountId: true } } } },
        },
    });
    let parentsLinked = 0;
    for (const parent of parents) {
        const learnerFamilyId = parent.links.find((l) => l.learner?.familyAccountId)?.learner?.familyAccountId || null;
        if (!learnerFamilyId)
            continue;
        await client.parent.update({
            where: { id: parent.id },
            data: { familyAccountId: learnerFamilyId },
        });
        parentsLinked += 1;
    }
    return { learnersLinked, parentsLinked };
}
