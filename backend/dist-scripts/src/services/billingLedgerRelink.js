"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAccountToLearnerIdMap = buildAccountToLearnerIdMap;
exports.relinkSchoolBillingLedger = relinkSchoolBillingLedger;
const prisma_1 = require("../prisma");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
function admissionBase(admissionNo) {
    const adm = String(admissionNo || "").trim();
    if (!adm)
        return "";
    const dash = adm.indexOf("-");
    return dash === -1 ? adm : adm.slice(0, dash);
}
function registerAccountKey(map, accountKey, learnerId) {
    const key = String(accountKey || "").trim();
    if (!key || key === "-" || map[key])
        return;
    map[key] = learnerId;
}
/** Map billing account refs (family ref, admission, base) → current learner id. */
async function buildAccountToLearnerIdMap(schoolId) {
    const sid = String(schoolId || "").trim();
    if (!sid)
        return {};
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: sid },
        select: {
            id: true,
            admissionNo: true,
            familyAccount: { select: { accountRef: true } },
        },
        orderBy: { createdAt: "asc" },
    });
    const map = {};
    for (const learner of learners) {
        const accountRef = (0, learnerIdentity_1.resolveLearnerAccountNo)(learner);
        if (accountRef && accountRef !== "-") {
            registerAccountKey(map, accountRef, learner.id);
        }
        const adm = String(learner.admissionNo || "").trim();
        if (adm) {
            registerAccountKey(map, adm, learner.id);
            registerAccountKey(map, admissionBase(adm), learner.id);
        }
    }
    return map;
}
/**
 * Re-attach ledger rows to current learners by accountNo / admission (idempotent).
 * Safe to run on every statements/payments read.
 */
async function relinkSchoolBillingLedger(schoolId) {
    const sid = String(schoolId || "").trim();
    if (!sid)
        return { ledgerRowsUpdated: 0 };
    const accountToLearnerId = await buildAccountToLearnerIdMap(sid);
    const ledgerRowsUpdated = (0, billingLedgerStore_1.relinkLedgerLearnerIds)(sid, accountToLearnerId);
    return { ledgerRowsUpdated };
}
