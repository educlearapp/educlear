"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.relinkDaSilvaLearnerBillingFromBundle = relinkDaSilvaLearnerBillingFromBundle;
exports.relinkSchoolLearnersToFamilyAccountsByDb = relinkSchoolLearnersToFamilyAccountsByDb;
exports.findLatestDaSilvaStagingBundle = findLatestDaSilvaStagingBundle;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const billingLedgerStore_1 = require("../../utils/billingLedgerStore");
const classroomNormalization_1 = require("../../utils/classroomNormalization");
function normName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
function seedAccountLearnerSeqFromExisting(existing) {
    const accountLearnerSeq = new Map();
    for (const row of existing) {
        const adm = String(row.admissionNo || "").trim();
        if (!adm)
            continue;
        const dash = adm.indexOf("-");
        if (dash === -1) {
            accountLearnerSeq.set(adm, Math.max(accountLearnerSeq.get(adm) || 0, 1));
            continue;
        }
        const base = adm.slice(0, dash);
        const seq = Number.parseInt(adm.slice(dash + 1), 10);
        if (base && Number.isFinite(seq)) {
            accountLearnerSeq.set(base, Math.max(accountLearnerSeq.get(base) || 0, seq));
        }
    }
    return accountLearnerSeq;
}
function peekNextAdmissionNo(accountNo, accountLearnerSeq) {
    const trimmed = String(accountNo || "").trim();
    if (!trimmed)
        return null;
    const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
    return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}
function allocateAdmissionNo(accountNo, accountLearnerSeq) {
    const trimmed = String(accountNo || "").trim();
    if (!trimmed)
        return null;
    const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
    accountLearnerSeq.set(trimmed, seq);
    return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}
function admissionBase(admissionNo) {
    const adm = String(admissionNo || "").trim();
    if (!adm)
        return "";
    const dash = adm.indexOf("-");
    return dash === -1 ? adm : adm.slice(0, dash);
}
async function findExistingLearnerIdForImportRow(opts) {
    if (opts.admissionNo) {
        const byAdm = await prisma_1.prisma.learner.findUnique({
            where: {
                schoolId_admissionNo: {
                    schoolId: opts.schoolId,
                    admissionNo: opts.admissionNo,
                },
            },
            select: { id: true },
        });
        if (byAdm)
            return byAdm.id;
    }
    const byName = await prisma_1.prisma.learner.findFirst({
        where: {
            schoolId: opts.schoolId,
            firstName: opts.firstName,
            lastName: opts.lastName,
            className: opts.className || null,
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
    });
    return byName?.id || null;
}
/**
 * Ensures every staged learner is linked to the correct FamilyAccount and admissionNo,
 * and rebuilds accountToLearnerId for ledger backfill. Safe to run after a skipped "learners" phase.
 */
async function relinkDaSilvaLearnerBillingFromBundle(opts) {
    const { schoolId, bundle } = opts;
    const accountToFamilyId = new Map();
    let familyAccountsEnsured = 0;
    let learnersUpdated = 0;
    const accountFamilyNames = new Map();
    for (const row of bundle.learners) {
        const accountNo = String(row.accountNo || "").trim();
        if (!accountNo)
            continue;
        if (!accountFamilyNames.has(accountNo)) {
            accountFamilyNames.set(accountNo, row.lastName || row.fullName);
        }
    }
    for (const [accountNo, familyName] of accountFamilyNames) {
        const fa = await prisma_1.prisma.familyAccount.upsert({
            where: { accountRef: accountNo },
            create: { schoolId, accountRef: accountNo, familyName },
            update: {},
            select: { id: true },
        });
        accountToFamilyId.set(accountNo, fa.id);
        familyAccountsEnsured += 1;
    }
    const existingAdmissionRows = await prisma_1.prisma.learner.findMany({
        where: { schoolId, admissionNo: { not: null } },
        select: { admissionNo: true },
    });
    const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);
    for (const row of bundle.learners) {
        const accountNo = String(row.accountNo || "").trim();
        const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;
        const isHistorical = row.enrollmentTier === "HISTORICAL";
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(row.className);
        const canonicalClassName = isHistorical ? null : row.canonicalClassName;
        let learnerId = opts.manifest.matchKeyToLearnerId?.[row.matchKey] ||
            opts.matchKeyToLearnerId.get(row.matchKey) ||
            null;
        if (!learnerId) {
            const plannedAdmissionNo = accountNo ? peekNextAdmissionNo(accountNo, accountLearnerSeq) : null;
            learnerId = await findExistingLearnerIdForImportRow({
                schoolId,
                firstName: row.firstName,
                lastName: row.lastName,
                className: canonicalClassName || "",
                admissionNo: plannedAdmissionNo,
            });
            if (!learnerId && accountNo) {
                const byBaseAccount = await prisma_1.prisma.learner.findUnique({
                    where: {
                        schoolId_admissionNo: { schoolId, admissionNo: accountNo },
                    },
                    select: { id: true },
                });
                learnerId = byBaseAccount?.id || null;
            }
        }
        if (!learnerId)
            continue;
        const current = await prisma_1.prisma.learner.findUnique({
            where: { id: learnerId },
            select: { familyAccountId: true, admissionNo: true, firstName: true, lastName: true },
        });
        const admissionNo = current?.admissionNo ||
            (accountNo ? allocateAdmissionNo(accountNo, accountLearnerSeq) : null);
        const needsUpdate = current?.familyAccountId !== familyAccountId ||
            !current?.admissionNo ||
            !String(current.firstName || "").trim() ||
            !String(current.lastName || "").trim();
        if (needsUpdate) {
            const updateData = {
                familyAccountId,
                admissionNo,
                firstName: row.firstName || current?.firstName || "",
                lastName: row.lastName || current?.lastName || "",
                grade: isHistorical
                    ? "Historical"
                    : norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
                className: canonicalClassName,
            };
            if (!opts.omitEnrollmentStatus) {
                updateData.enrollmentStatus = isHistorical ? "HISTORICAL" : "ACTIVE";
            }
            await prisma_1.prisma.learner.update({
                where: { id: learnerId },
                data: updateData,
            });
            learnersUpdated += 1;
        }
        opts.matchKeyToLearnerId.set(row.matchKey, learnerId);
        if (accountNo && !opts.accountToLearnerId.has(accountNo)) {
            opts.accountToLearnerId.set(accountNo, learnerId);
        }
    }
    const accountToLearnerId = Object.fromEntries(opts.accountToLearnerId);
    const ledgerRowsBackfilled = (0, billingLedgerStore_1.backfillLedgerLearnerIds)(schoolId, accountToLearnerId);
    return {
        learnersUpdated,
        familyAccountsEnsured,
        accountToLearnerId,
        ledgerRowsBackfilled,
    };
}
/** DB-only repair when staging bundle is unavailable. */
async function relinkSchoolLearnersToFamilyAccountsByDb(schoolId) {
    const familyAccounts = await prisma_1.prisma.familyAccount.findMany({
        where: { schoolId },
        select: { id: true, accountRef: true, familyName: true },
    });
    const familyByRef = new Map(familyAccounts.map((fa) => [fa.accountRef, fa]));
    const learners = await prisma_1.prisma.learner.findMany({
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
    const accountToLearnerId = {};
    for (const learner of learners) {
        const admBase = admissionBase(learner.admissionNo);
        let targetFa = learner.familyAccountId
            ? familyAccounts.find((fa) => fa.id === learner.familyAccountId)
            : null;
        if (!targetFa && admBase) {
            targetFa = familyByRef.get(admBase) || null;
        }
        if (!targetFa) {
            const surname = normName(learner.lastName);
            const matches = familyAccounts.filter((fa) => normName(fa.familyName) === surname);
            if (matches.length === 1)
                targetFa = matches[0];
        }
        if (!targetFa)
            continue;
        const accountRef = targetFa.accountRef;
        if (!accountToLearnerId[accountRef]) {
            accountToLearnerId[accountRef] = learner.id;
        }
        const nextAdmission = learner.admissionNo ||
            (accountToLearnerId[accountRef] === learner.id
                ? accountRef
                : `${accountRef}-${learner.id.slice(-4)}`);
        if (learner.familyAccountId !== targetFa.id || !learner.admissionNo) {
            await prisma_1.prisma.learner.update({
                where: { id: learner.id },
                data: {
                    familyAccountId: targetFa.id,
                    admissionNo: nextAdmission,
                },
            });
            learnersLinked += 1;
        }
    }
    const parents = await prisma_1.prisma.parent.findMany({
        where: { schoolId, familyAccountId: null },
        select: { id: true, surname: true, links: { select: { learner: { select: { familyAccountId: true } } } } },
    });
    let parentsLinked = 0;
    for (const parent of parents) {
        const learnerFamilyId = parent.links.find((l) => l.learner?.familyAccountId)?.learner?.familyAccountId || null;
        if (!learnerFamilyId)
            continue;
        await prisma_1.prisma.parent.update({
            where: { id: parent.id },
            data: { familyAccountId: learnerFamilyId },
        });
        parentsLinked += 1;
    }
    const ledgerRowsBackfilled = (0, billingLedgerStore_1.backfillLedgerLearnerIds)(schoolId, accountToLearnerId);
    return { learnersLinked, parentsLinked, ledgerRowsBackfilled };
}
function findLatestDaSilvaStagingBundle(schoolId) {
    const dir = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
    if (!fs_1.default.existsSync(dir))
        return null;
    const files = fs_1.default
        .readdirSync(dir)
        .filter((f) => f.startsWith("dasilva-") && f.endsWith(".json"))
        .map((f) => ({
        file: f,
        mtime: fs_1.default.statSync(path_1.default.join(dir, f)).mtimeMs,
    }))
        .sort((a, b) => b.mtime - a.mtime);
    if (!files.length)
        return null;
    const projectId = files[0].file.replace(/^dasilva-/, "").replace(/\.json$/, "");
    const raw = fs_1.default.readFileSync(path_1.default.join(dir, files[0].file), "utf8");
    return { projectId, bundle: JSON.parse(raw) };
}
