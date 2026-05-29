"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLatestDaSilvaStagingProject = resolveLatestDaSilvaStagingProject;
exports.repairDaSilvaSasamsLearners = repairDaSilvaSasamsLearners;
exports.repairDaSilvaSasamsParents = repairDaSilvaSasamsParents;
exports.repairDaSilvaKideesysBilling = repairDaSilvaKideesysBilling;
exports.auditDaSilvaRepair = auditDaSilvaRepair;
exports.runDaSilvaCurrentDbRepair = runDaSilvaCurrentDbRepair;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const learnerGender_1 = require("../../utils/learnerGender");
const kidesysTransactionHistoryStore_1 = require("../../utils/kidesysTransactionHistoryStore");
const daSilvaTransactionHistory_1 = require("./daSilvaTransactionHistory");
const billingLedgerStore_1 = require("../../utils/billingLedgerStore");
const parentPortalService_1 = require("../parentPortalService");
const statementAccounts_1 = require("../statementAccounts");
const billingLedgerRelink_1 = require("../billingLedgerRelink");
const relinkDaSilvaLearnerBilling_1 = require("./relinkDaSilvaLearnerBilling");
const daSilvaParentLearnerMatching_1 = require("./daSilvaParentLearnerMatching");
const daSilvaMigrationService_1 = require("./daSilvaMigrationService");
const sasamsParsers_1 = require("./sasamsParsers");
const parsers_1 = require("./parsers");
const daSilvaStagedPaths_1 = require("./daSilvaStagedPaths");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function hasText(value) {
    return Boolean(String(value ?? "").trim());
}
function pickString(incoming, existing) {
    const inc = String(incoming ?? "").trim();
    if (!inc)
        return undefined;
    const cur = String(existing ?? "").trim();
    if (cur === inc)
        return undefined;
    return inc;
}
function pickDate(incoming, existing) {
    if (!incoming)
        return undefined;
    if (existing && incoming.getTime() === existing.getTime())
        return undefined;
    return incoming;
}
async function findLearnerIdForRow(schoolId, row, manifestLearnerId) {
    if (manifestLearnerId) {
        const hit = await prisma_1.prisma.learner.findFirst({
            where: { id: manifestLearnerId, schoolId },
            select: { id: true },
        });
        if (hit)
            return hit.id;
    }
    if (row.admissionNo) {
        const byAdm = await prisma_1.prisma.learner.findUnique({
            where: { schoolId_admissionNo: { schoolId, admissionNo: row.admissionNo } },
            select: { id: true },
        });
        if (byAdm)
            return byAdm.id;
    }
    const byName = await prisma_1.prisma.learner.findFirst({
        where: {
            schoolId,
            firstName: row.firstName,
            lastName: row.lastName,
            className: row.canonicalClassName || null,
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
    });
    return byName?.id || null;
}
function resolveLatestDaSilvaStagingProject(schoolId) {
    const root = path_1.default.join(STAGING_ROOT, schoolId);
    if (!fs_1.default.existsSync(root)) {
        throw new Error(`No migration staging folder for school ${schoolId}`);
    }
    const manifests = fs_1.default
        .readdirSync(root)
        .filter((f) => f.endsWith(".manifest.json") &&
        f.startsWith("dasilva-") &&
        !f.includes("kideesys-csv"))
        .map((file) => ({
        file,
        mtime: fs_1.default.statSync(path_1.default.join(root, file)).mtimeMs,
    }))
        .sort((a, b) => b.mtime - a.mtime);
    if (!manifests.length) {
        throw new Error("No Da Silva manifest in staging — upload SA-SAMS + Kid-e-Sys files first");
    }
    const manifestPath = path_1.default.join(root, manifests[0].file);
    let projectId = manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf8"));
        if (hasText(raw.projectId))
            projectId = String(raw.projectId).trim();
    }
    catch {
        /* use filename-derived project id */
    }
    return { projectId, manifestPath };
}
async function repairDaSilvaSasamsLearners(opts) {
    const staged = (0, daSilvaStagedPaths_1.resolveDaSilvaStagedPaths)(opts.schoolId, opts.projectId);
    const sasamsPaths = {
        classListDir: staged.classListDir,
        learnerRegister: staged.learnerRegister,
        parentRegister: staged.parentRegister,
    };
    if (!fs_1.default.existsSync(sasamsPaths.classListDir)) {
        throw new Error(`Missing SA-SAMS class lists: ${sasamsPaths.classListDir}`);
    }
    const rows = (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)(sasamsPaths);
    const manifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(opts.schoolId, opts.projectId);
    const matchKeyToLearnerId = manifest?.matchKeyToLearnerId || {};
    const result = {
        sourceRows: rows.length,
        matched: 0,
        updated: 0,
        created: 0,
        skippedBlankOverwrite: 0,
        unmatched: [],
    };
    for (const row of rows) {
        const learnerId = await findLearnerIdForRow(opts.schoolId, row, matchKeyToLearnerId[row.matchKey]);
        if (!learnerId) {
            result.unmatched.push({ matchKey: row.matchKey, fullName: row.fullName });
            continue;
        }
        result.matched += 1;
        if (!opts.apply)
            continue;
        const existing = await prisma_1.prisma.learner.findUnique({
            where: { id: learnerId },
            select: {
                firstName: true,
                lastName: true,
                birthDate: true,
                gender: true,
                idNumber: true,
                homeLanguage: true,
                citizenship: true,
                grade: true,
                className: true,
                admissionNo: true,
                enrollmentStatus: true,
            },
        });
        if (!existing)
            continue;
        const genderNorm = (0, learnerGender_1.normalizeLearnerGender)(row.gender) || row.gender;
        const data = {};
        const firstName = pickString(row.firstName, existing.firstName);
        const lastName = pickString(row.lastName, existing.lastName);
        if (firstName)
            data.firstName = firstName;
        if (lastName)
            data.lastName = lastName;
        const grade = pickString(row.grade, existing.grade);
        if (grade)
            data.grade = grade;
        const className = pickString(row.canonicalClassName, existing.className);
        if (className)
            data.className = className;
        const idNumber = pickString(row.idNumber, existing.idNumber);
        if (idNumber)
            data.idNumber = idNumber;
        const homeLanguage = pickString(row.homeLanguage, existing.homeLanguage);
        if (homeLanguage)
            data.homeLanguage = homeLanguage;
        const citizenship = pickString(row.citizenship, existing.citizenship);
        if (citizenship)
            data.citizenship = citizenship;
        const gender = pickString(genderNorm, existing.gender);
        if (gender)
            data.gender = gender;
        const birthDate = pickDate(row.birthDate, existing.birthDate);
        if (birthDate)
            data.birthDate = birthDate;
        if (row.admissionNo) {
            const admissionNo = pickString(row.admissionNo, existing.admissionNo);
            if (admissionNo)
                data.admissionNo = admissionNo;
        }
        if (!hasText(existing.enrollmentStatus)) {
            data.enrollmentStatus = "ACTIVE";
        }
        if (!Object.keys(data).length) {
            result.skippedBlankOverwrite += 1;
            continue;
        }
        await prisma_1.prisma.learner.update({ where: { id: learnerId }, data });
        result.updated += 1;
    }
    return result;
}
async function repairDaSilvaSasamsParents(opts) {
    const staged = (0, daSilvaStagedPaths_1.resolveDaSilvaStagedPaths)(opts.schoolId, opts.projectId);
    const parentRegister = staged.parentRegister;
    const parentLearnerLinks = staged.parentLearnerLinks;
    if (!fs_1.default.existsSync(parentRegister) && !fs_1.default.existsSync(parentLearnerLinks)) {
        throw new Error("Missing SA-SAMS parent_register.xls or parent_learner_links.xls");
    }
    const sasamsParents = (0, sasamsParsers_1.parseSasamsParentSources)(parentRegister, parentLearnerLinks);
    const dbLearners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: opts.schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
            admissionNo: true,
            idNumber: true,
        },
    });
    const indexes = (0, daSilvaParentLearnerMatching_1.buildLearnerMatchIndexes)(dbLearners);
    const learnersById = new Map(dbLearners.map((l) => [l.id, l]));
    const parentAudit = (0, daSilvaParentLearnerMatching_1.auditParentMatches)(sasamsParents, dbLearners);
    const result = {
        sourceRows: sasamsParents.length,
        matchedLinks: 0,
        parentsCreated: 0,
        parentsUpdated: 0,
        linksUpserted: 0,
        unmatchedParents: parentAudit.unmatchedParents.length,
    };
    for (const parentRow of sasamsParents) {
        const match = (0, daSilvaParentLearnerMatching_1.matchParentToLearner)(parentRow, indexes, learnersById);
        if (!match.learnerId || match.ambiguous)
            continue;
        result.matchedLinks += 1;
        if (!opts.apply)
            continue;
        const phone = (0, parentPortalService_1.normalizeSaPhone)(parentRow.cellNo || parentRow.homeNo || "");
        const cellNo = phone?.localCell || String(parentRow.cellNo || "").trim() || "0000000000";
        const existingParent = await prisma_1.prisma.parent.findFirst({
            where: {
                schoolId: opts.schoolId,
                firstName: parentRow.firstName,
                surname: parentRow.surname,
                cellNo,
            },
            select: {
                id: true,
                firstName: true,
                surname: true,
                cellNo: true,
                email: true,
                idNumber: true,
                relationship: true,
                workNo: true,
                homeNo: true,
            },
        });
        let parentId = existingParent?.id;
        if (parentId && existingParent) {
            const data = {};
            const firstName = pickString(parentRow.firstName, existingParent.firstName);
            const surname = pickString(parentRow.surname, existingParent.surname);
            const email = pickString(parentRow.email, existingParent.email);
            const idNumber = pickString(parentRow.idNumber, existingParent.idNumber);
            const relationship = pickString(parentRow.relation, existingParent.relationship);
            const workNo = pickString(parentRow.workNo, existingParent.workNo);
            const homeNo = pickString(parentRow.homeNo, existingParent.homeNo);
            if (firstName)
                data.firstName = firstName;
            if (surname)
                data.surname = surname;
            if (email)
                data.email = email;
            if (idNumber)
                data.idNumber = idNumber;
            if (relationship)
                data.relationship = relationship;
            if (workNo)
                data.workNo = workNo;
            if (homeNo)
                data.homeNo = homeNo;
            if (Object.keys(data).length) {
                await prisma_1.prisma.parent.update({ where: { id: parentId }, data });
                result.parentsUpdated += 1;
            }
        }
        else {
            const created = await prisma_1.prisma.parent.create({
                data: {
                    schoolId: opts.schoolId,
                    familyAccountId: null,
                    firstName: parentRow.firstName,
                    surname: parentRow.surname,
                    cellNo,
                    email: hasText(parentRow.email) ? parentRow.email : null,
                    idNumber: parentRow.idNumber,
                    relationship: parentRow.relation,
                    workNo: parentRow.workNo || null,
                    homeNo: parentRow.homeNo || null,
                    outstandingAmount: 0,
                },
                select: { id: true },
            });
            parentId = created.id;
            result.parentsCreated += 1;
        }
        await prisma_1.prisma.parentLearnerLink.upsert({
            where: { parentId_learnerId: { parentId, learnerId: match.learnerId } },
            create: {
                schoolId: opts.schoolId,
                parentId,
                learnerId: match.learnerId,
                relation: parentRow.relation,
                isPrimary: true,
            },
            update: {
                relation: hasText(parentRow.relation) ? parentRow.relation : undefined,
            },
        });
        result.linksUpserted += 1;
    }
    return result;
}
async function repairDaSilvaKideesysBilling(opts) {
    const staged = (0, daSilvaStagedPaths_1.resolveDaSilvaStagedPaths)(opts.schoolId, opts.projectId);
    const transactionsPath = staged.transactions;
    let historyWritten = false;
    let historyEntries = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(opts.schoolId).length;
    if (opts.apply && fs_1.default.existsSync(transactionsPath)) {
        const parsed = (0, parsers_1.parseTransactionListFile)(transactionsPath);
        const entries = (0, daSilvaTransactionHistory_1.buildHistoryEntriesFromTransactions)(opts.schoolId, parsed);
        if (entries.length > 0) {
            (0, kidesysTransactionHistoryStore_1.writeSchoolKidesysHistory)(opts.schoolId, entries);
            historyWritten = true;
            historyEntries = entries.length;
        }
    }
    let reconcileMode = opts.apply ? "skipped" : "dry-run";
    if (opts.apply) {
        const latest = (0, relinkDaSilvaLearnerBilling_1.findLatestDaSilvaStagingBundle)(opts.schoolId);
        const bundle = latest?.bundle && Array.isArray(latest.bundle.learners) ? latest.bundle : null;
        if (bundle && latest?.projectId) {
            const manifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(opts.schoolId, latest.projectId) ||
                (0, daSilvaMigrationService_1.loadDaSilvaManifest)(opts.schoolId, opts.projectId) || {
                projectId: latest.projectId,
                schoolId: opts.schoolId,
                importedAt: new Date().toISOString(),
                learnerIds: [],
                parentIds: [],
                linkIds: [],
                classroomIds: [],
                employeeIds: [],
                ledgerEntryIds: [],
                matchKeyToLearnerId: {},
                accountToLearnerId: {},
                phasesCompleted: [],
            };
            const matchKeyToLearnerId = new Map(Object.entries(manifest.matchKeyToLearnerId || {}));
            const accountToLearnerId = new Map(Object.entries(manifest.accountToLearnerId || {}));
            await (0, relinkDaSilvaLearnerBilling_1.relinkDaSilvaLearnerBillingFromBundle)({
                schoolId: opts.schoolId,
                bundle,
                manifest,
                matchKeyToLearnerId,
                accountToLearnerId,
            });
            reconcileMode = "bundle-relink";
        }
        else {
            await (0, relinkDaSilvaLearnerBilling_1.relinkSchoolLearnersToFamilyAccountsByDb)(opts.schoolId);
            reconcileMode = "db-relink";
        }
        await (0, billingLedgerRelink_1.relinkSchoolBillingLedger)(opts.schoolId);
    }
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(opts.schoolId);
    const accounts = await (0, statementAccounts_1.buildAccountsFromLearners)(opts.schoolId, ledger);
    const accountsWithLastInvoice = accounts.filter((r) => Number(r.lastInvoice) > 0 ||
        hasText(r.lastInvoiceLabel) ||
        hasText(r.lastInvoiceDate)).length;
    const accountsWithLastPayment = accounts.filter((r) => Number(r.lastPayment) > 0 || hasText(r.lastPaymentDate)).length;
    return {
        historyEntries,
        historyWritten,
        reconcileMode,
        ledgerInvoices: ledger.filter((e) => e.type === "invoice").length,
        ledgerPayments: ledger.filter((e) => e.type === "payment").length,
        statementAccounts: accounts.length,
        accountsWithLastInvoice,
        accountsWithLastPayment,
    };
}
async function auditDaSilvaRepair(schoolId, sasamsRepair) {
    const totalLearners = await prisma_1.prisma.learner.count({ where: { schoolId } });
    const withDob = await prisma_1.prisma.learner.count({
        where: { schoolId, birthDate: { not: null } },
    });
    const withGender = await prisma_1.prisma.learner.count({
        where: { schoolId, gender: { not: null } },
    });
    const withClass = await prisma_1.prisma.learner.count({
        where: { schoolId, className: { not: null } },
    });
    const withHl = await prisma_1.prisma.learner.count({
        where: { schoolId, homeLanguage: { not: null } },
    });
    const parents = await prisma_1.prisma.parent.count({ where: { schoolId } });
    const links = await prisma_1.prisma.parentLearnerLink.count({ where: { schoolId } });
    const sample = await prisma_1.prisma.learner.findFirst({
        where: { schoolId, birthDate: { not: null }, gender: { not: null } },
        include: {
            familyAccount: true,
            links: { include: { parent: true } },
        },
        orderBy: { createdAt: "desc" },
    });
    let profilesShowing = false;
    if (sample) {
        profilesShowing =
            hasText(sample.firstName) &&
                hasText(sample.lastName) &&
                hasText(sample.className) &&
                (hasText(sample.gender) || hasText(sample.idNumber));
    }
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const accounts = await (0, statementAccounts_1.buildAccountsFromLearners)(schoolId, ledger);
    const invoicesShowing = ledger.some((e) => e.type === "invoice");
    const paymentsShowing = ledger.some((e) => e.type === "payment");
    const statementsShowing = accounts.length > 0 &&
        accounts.some((r) => Number(r.lastInvoice) > 0 ||
            Number(r.lastPayment) > 0 ||
            hasText(r.lastInvoiceLabel));
    const sasamsCohort = Math.max(sasamsRepair?.matched || 0, sasamsRepair?.sourceRows || 0);
    const sasamsUnmatched = sasamsRepair?.unmatched.length || 0;
    const learnerFillRate = sasamsCohort > 0 ? withDob / sasamsCohort : totalLearners > 0 ? withDob / totalLearners : 0;
    const auditPass = profilesShowing &&
        statementsShowing &&
        (invoicesShowing || paymentsShowing) &&
        sasamsCohort > 0 &&
        sasamsUnmatched === 0 &&
        withDob >= Math.floor(sasamsCohort * 0.9) &&
        links >= Math.min(parents, sasamsCohort);
    return {
        learnersRepaired: totalLearners,
        parentsRepaired: parents,
        profilesShowing,
        invoicesShowing,
        paymentsShowing,
        statementsShowing,
        auditPass,
        details: {
            totalLearners,
            withDob,
            withGender,
            withClass,
            withHomeLanguage: withHl,
            parentLinks: links,
            statementAccounts: accounts.length,
            learnerFillRate: Math.round(learnerFillRate * 1000) / 10,
            sasamsCohort,
            sasamsUnmatched,
        },
    };
}
async function runDaSilvaCurrentDbRepair(opts) {
    const resolvedProjectId = opts.projectId
        ? opts.projectId
        : resolveLatestDaSilvaStagingProject(opts.schoolId).projectId;
    const learners = await repairDaSilvaSasamsLearners({
        schoolId: opts.schoolId,
        projectId: resolvedProjectId,
        apply: opts.apply,
    });
    const parents = await repairDaSilvaSasamsParents({
        schoolId: opts.schoolId,
        projectId: resolvedProjectId,
        apply: opts.apply,
    });
    const billing = await repairDaSilvaKideesysBilling({
        schoolId: opts.schoolId,
        projectId: resolvedProjectId,
        apply: opts.apply,
    });
    const audit = await auditDaSilvaRepair(opts.schoolId, learners);
    return {
        projectId: resolvedProjectId,
        learners,
        parents,
        billing,
        audit,
    };
}
