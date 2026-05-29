"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Repair Da Silva learner ↔ family account ↔ parent ↔ parent-learner links
 * without re-running phase 1/2 or touching billing ledger / plans / history.
 *
 * Usage:
 *   KIDESYS_ROOT=/path/to/kideesys-export npx tsc
 *   node dist/scripts/repair-da-silva-parent-family-links.js              # dry-run (default)
 *   node dist/scripts/repair-da-silva-parent-family-links.js --apply
 *   node dist/scripts/repair-da-silva-parent-family-links.js [schoolId] [--apply]
 *
 * Or with tsx:
 *   npx tsx scripts/repair-da-silva-parent-family-links.ts [--apply]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const parentPortalService_1 = require("../src/services/parentPortalService");
const learnerBillingPlanStore_1 = require("../src/utils/learnerBillingPlanStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const prisma = new client_1.PrismaClient();
const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv
    .slice(2)
    .find((a) => a !== "--apply" && !a.startsWith("-") && !a.includes("/") && !a.includes(path_1.default.sep));
function normName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
function normClass(value) {
    return normName(String(value || "").trim());
}
function learnerMatchKey(firstName, lastName, className) {
    return `${normName(firstName)}|${normName(lastName)}|${normClass(className)}`;
}
function parentStagingKey(matchKey, parentIndex) {
    return `${matchKey}:${parentIndex}`;
}
function resolveKideesysRoot() {
    const fromEnv = String(process.env.KIDESYS_ROOT || "").trim();
    const fromArg = process.argv
        .slice(2)
        .find((a) => a !== "--apply" && !a.startsWith("-") && a.includes("/"));
    const root = fromEnv || fromArg || path_1.default.join(process.env.HOME || "", "Desktop");
    return path_1.default.resolve(root);
}
function buildIngestPaths(desktopRoot) {
    return {
        classListDir: path_1.default.join(desktopRoot, "05_class_list"),
        contactList: path_1.default.join(desktopRoot, "04_contact_list", "contact_list.xls"),
        ageAnalysis: path_1.default.join(desktopRoot, "02_account_list_age_analysis", "account_list_(age_analysis).xls"),
    };
}
function validateIngestPaths(paths) {
    for (const [label, filePath] of Object.entries(paths)) {
        if (!fs_1.default.existsSync(filePath)) {
            throw new Error(`Missing Kid-e-Sys ${label}: ${filePath}`);
        }
    }
}
async function resolveSchoolId() {
    const hint = String(schoolIdArg || (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)() || "").trim();
    const school = (hint
        ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
        : null) ||
        (await prisma.school.findFirst({
            where: { email: activateDaSilvaSubscription_1.DA_SILVA_OWNER_EMAIL },
            select: { id: true, name: true },
        })) ||
        (await prisma.school.findFirst({
            where: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
            select: { id: true, name: true },
        }));
    if (!school)
        throw new Error("Da Silva Academy school not found");
    (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(school.id);
    return school;
}
async function snapshotCounts(schoolId, unmatchedLearners = 0, unmatchedParents = 0) {
    const [learnersTotal, learnersWithFamilyAccountId, familyAccounts, parents, parentLearnerLinks, ledgerEntries, billingPlans,] = await Promise.all([
        prisma.learner.count({ where: { schoolId } }),
        prisma.learner.count({ where: { schoolId, familyAccountId: { not: null } } }),
        prisma.familyAccount.count({ where: { schoolId } }),
        prisma.parent.count({ where: { schoolId } }),
        prisma.parentLearnerLink.count({ where: { schoolId } }),
        Promise.resolve((0, billingLedgerStore_1.readSchoolLedger)(schoolId).length),
        Promise.resolve(Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).length),
    ]);
    return {
        learnersTotal,
        learnersWithFamilyAccountId,
        familyAccounts,
        parents,
        parentLearnerLinks,
        unmatchedLearners,
        unmatchedParents,
        ledgerEntries,
        billingPlans,
    };
}
function assertBillingUntouched(label, before, after) {
    const errors = [];
    if (before.ledgerEntries !== 0 || after.ledgerEntries !== 0) {
        errors.push(`${label}: ledgerEntries must remain 0 (before=${before.ledgerEntries}, after=${after.ledgerEntries})`);
    }
    if (before.billingPlans !== 0 || after.billingPlans !== 0) {
        errors.push(`${label}: billingPlans must remain 0 (before=${before.billingPlans}, after=${after.billingPlans})`);
    }
    return errors;
}
function buildDbLearnerIndex(rows) {
    const buckets = new Map();
    for (const row of rows) {
        const key = learnerMatchKey(row.firstName, row.lastName, row.className || "");
        const list = buckets.get(key) || [];
        list.push(row);
        buckets.set(key, list);
    }
    const index = new Map();
    for (const [key, list] of buckets) {
        list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        index.set(key, list[0].id);
    }
    return index;
}
function resolveLearnerIdForStagedRow(row, dbIndex) {
    const keys = [
        learnerMatchKey(row.firstName, row.lastName, row.canonicalClassName),
        learnerMatchKey(row.firstName, row.lastName, row.className),
    ];
    for (const key of keys) {
        const id = dbIndex.get(key);
        if (id)
            return id;
    }
    return null;
}
async function runRepair(opts) {
    const dbLearners = await prisma.learner.findMany({
        where: { schoolId: opts.schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
            familyAccountId: true,
            createdAt: true,
        },
    });
    const dbIndex = buildDbLearnerIndex(dbLearners);
    const unmatchedLearners = [];
    const unmatchedParentLinks = [];
    const matchKeyToLearnerId = new Map();
    for (const row of opts.staged) {
        const learnerId = resolveLearnerIdForStagedRow(row, dbIndex);
        if (!learnerId) {
            unmatchedLearners.push({
                matchKey: row.matchKey,
                fullName: row.fullName,
                className: row.className,
                canonicalClassName: row.canonicalClassName,
                accountNo: String(row.accountNo || "").trim(),
            });
            continue;
        }
        matchKeyToLearnerId.set(row.matchKey, learnerId);
    }
    const accountFamilyNames = new Map();
    for (const row of opts.staged) {
        const accountNo = String(row.accountNo || "").trim();
        if (!accountNo)
            continue;
        if (!accountFamilyNames.has(accountNo)) {
            accountFamilyNames.set(accountNo, row.lastName || row.fullName);
        }
    }
    let familyAccountsEnsured = 0;
    let learnersFamilyUpdated = 0;
    let parentsCreated = 0;
    let parentsReused = 0;
    let linksUpserted = 0;
    const accountToFamilyId = new Map();
    const ensureFamilyAccounts = async () => {
        for (const [accountNo, familyName] of accountFamilyNames) {
            if (opts.apply) {
                const fa = await prisma.familyAccount.upsert({
                    where: { accountRef: accountNo },
                    create: {
                        schoolId: opts.schoolId,
                        accountRef: accountNo,
                        familyName,
                    },
                    update: {},
                    select: { id: true },
                });
                accountToFamilyId.set(accountNo, fa.id);
            }
            familyAccountsEnsured += 1;
        }
    };
    if (opts.apply) {
        await ensureFamilyAccounts();
    }
    else {
        familyAccountsEnsured = accountFamilyNames.size;
    }
    for (const row of opts.staged) {
        const learnerId = matchKeyToLearnerId.get(row.matchKey);
        if (!learnerId)
            continue;
        const accountNo = String(row.accountNo || "").trim();
        if (!accountNo)
            continue;
        const targetFamilyAccountId = opts.apply ? accountToFamilyId.get(accountNo) || null : null;
        const current = dbLearners.find((l) => l.id === learnerId);
        if (opts.apply && targetFamilyAccountId) {
            if (current?.familyAccountId !== targetFamilyAccountId) {
                await prisma.learner.update({
                    where: { id: learnerId },
                    data: { familyAccountId: targetFamilyAccountId },
                });
                learnersFamilyUpdated += 1;
            }
        }
        else if (!opts.apply) {
            learnersFamilyUpdated += 1;
        }
    }
    const stagedParentIds = new Map();
    for (const row of opts.staged) {
        const accountNo = String(row.accountNo || "").trim();
        const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;
        for (let pi = 0; pi < row.parents.length; pi++) {
            const parent = row.parents[pi];
            const stageKey = parentStagingKey(row.matchKey, pi);
            if (!opts.apply) {
                const learnerId = matchKeyToLearnerId.get(row.matchKey);
                if (!learnerId) {
                    unmatchedParentLinks.push({
                        matchKey: row.matchKey,
                        learnerFullName: row.fullName,
                        parentName: `${parent.firstName} ${parent.surname}`.trim(),
                        relation: parent.relation,
                        reason: "Learner not matched in database",
                    });
                    continue;
                }
                linksUpserted += 1;
                continue;
            }
            const phone = (0, parentPortalService_1.normalizeSaPhone)(parent.cellNo || parent.homeNo || "");
            const cellNo = phone?.localCell || parent.cellNo || "";
            let parentId = stagedParentIds.get(stageKey);
            if (!parentId) {
                const existingParent = await prisma.parent.findFirst({
                    where: {
                        schoolId: opts.schoolId,
                        firstName: parent.firstName,
                        surname: parent.surname,
                        cellNo,
                        familyAccountId: familyAccountId ?? null,
                    },
                    select: { id: true },
                });
                if (existingParent?.id) {
                    parentId = existingParent.id;
                    parentsReused += 1;
                }
                else {
                    const created = await prisma.parent.create({
                        data: {
                            schoolId: opts.schoolId,
                            familyAccountId,
                            firstName: parent.firstName,
                            surname: parent.surname,
                            cellNo,
                            email: parent.email || null,
                            relationship: parent.relation,
                            workNo: parent.workNo || null,
                            homeNo: parent.homeNo || null,
                            outstandingAmount: 0,
                        },
                        select: { id: true },
                    });
                    parentId = created.id;
                    parentsCreated += 1;
                }
                stagedParentIds.set(stageKey, parentId);
            }
            const learnerId = matchKeyToLearnerId.get(row.matchKey);
            if (!learnerId) {
                unmatchedParentLinks.push({
                    matchKey: row.matchKey,
                    learnerFullName: row.fullName,
                    parentName: `${parent.firstName} ${parent.surname}`.trim(),
                    relation: parent.relation,
                    reason: "Learner not matched in database",
                });
                continue;
            }
            await prisma.parentLearnerLink.upsert({
                where: { parentId_learnerId: { parentId, learnerId } },
                create: {
                    schoolId: opts.schoolId,
                    parentId,
                    learnerId,
                    relation: parent.relation,
                    isPrimary: row.parents[0] === parent,
                },
                update: {},
            });
            linksUpserted += 1;
        }
    }
    return {
        unmatchedLearners,
        unmatchedParentLinks,
        planned: {
            familyAccountsEnsured,
            learnersFamilyUpdated,
            parentsCreated,
            parentsReused,
            linksUpserted,
        },
    };
}
async function main() {
    const kideesysRoot = resolveKideesysRoot();
    const paths = buildIngestPaths(kideesysRoot);
    validateIngestPaths(paths);
    const school = await resolveSchoolId();
    const schoolId = school.id;
    console.log("=== Da Silva parent / family linkage repair ===");
    console.log(`Mode: ${apply ? "APPLY" : "dry-run"}`);
    console.log(`School: ${school.name} (${schoolId})`);
    console.log(`Kid-e-Sys root: ${kideesysRoot}`);
    const before = await snapshotCounts(schoolId);
    if (before.ledgerEntries > 0) {
        throw new Error(`BLOCKED: school has ${before.ledgerEntries} ledger entries — this script does not touch billing`);
    }
    if (before.billingPlans > 0) {
        throw new Error(`BLOCKED: school has ${before.billingPlans} billing plans — this script does not touch billing`);
    }
    console.log("\n--- Before ---");
    console.log(JSON.stringify(before, null, 2));
    console.log("\nRebuilding staged learners from Kid-e-Sys export…");
    const staged = (0, daSilvaMigrationService_1.buildDaSilvaParentsStagedLearners)(paths);
    console.log(`Staged learners: ${staged.length} (expected ${daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT})`);
    if (staged.length !== daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT) {
        console.warn(`WARNING: staged learner count ${staged.length} ≠ expected ${daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT}`);
    }
    const repair = await runRepair({ schoolId, staged, apply });
    const after = await snapshotCounts(schoolId, repair.unmatchedLearners.length, repair.unmatchedParentLinks.length);
    const matchedWithAccount = staged.filter((row) => !repair.unmatchedLearners.some((u) => u.matchKey === row.matchKey) &&
        String(row.accountNo || "").trim()).length;
    const stagedParentSlots = staged.reduce((n, row) => n + row.parents.length, 0);
    const report = {
        mode: apply ? "apply" : "dry-run",
        schoolId,
        schoolName: school.name,
        kideesysRoot,
        ingestPaths: paths,
        stagedLearnerCount: staged.length,
        stagedParentSlots,
        matchedLearnersWithAccount: matchedWithAccount,
        before,
        after,
        planned: repair.planned,
        unmatchedLearners: repair.unmatchedLearners,
        unmatchedParentLinks: repair.unmatchedParentLinks,
        assertions: [],
    };
    if (!apply) {
        report.afterEstimate = {
            learnersTotal: before.learnersTotal,
            learnersWithFamilyAccountId: matchedWithAccount,
            familyAccounts: Math.max(before.familyAccounts, repair.planned.familyAccountsEnsured),
            parents: before.parents + repair.planned.parentsCreated,
            parentLearnerLinks: repair.planned.linksUpserted,
            unmatchedLearners: repair.unmatchedLearners.length,
            unmatchedParents: repair.unmatchedParentLinks.length,
            ledgerEntries: 0,
            billingPlans: 0,
        };
    }
    console.log("\n--- After ---");
    console.log(JSON.stringify(after, null, 2));
    console.log("\n--- Planned / applied ---");
    console.log(JSON.stringify(repair.planned, null, 2));
    if (repair.unmatchedLearners.length) {
        console.log(`\nUnmatched learners (${repair.unmatchedLearners.length}):`);
        for (const row of repair.unmatchedLearners.slice(0, 30)) {
            console.log(`  ${row.fullName} | class=${row.canonicalClassName || row.className} | account=${row.accountNo || "(none)"}`);
        }
        if (repair.unmatchedLearners.length > 30) {
            console.log(`  … and ${repair.unmatchedLearners.length - 30} more`);
        }
    }
    if (repair.unmatchedParentLinks.length) {
        console.log(`\nUnmatched parent links (${repair.unmatchedParentLinks.length}):`);
        for (const row of repair.unmatchedParentLinks.slice(0, 20)) {
            console.log(`  ${row.learnerFullName} ↔ ${row.parentName}: ${row.reason}`);
        }
    }
    const assertionErrors = assertBillingUntouched("billing guard", before, after);
    if (apply) {
        if (after.learnersWithFamilyAccountId !== daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT) {
            assertionErrors.push(`learnersWithFamilyAccountId expected ${daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT}, got ${after.learnersWithFamilyAccountId}`);
            const stillMissing = await prisma.learner.findMany({
                where: { schoolId, familyAccountId: null },
                select: { id: true, firstName: true, lastName: true, className: true, admissionNo: true },
                take: 50,
            });
            if (stillMissing.length) {
                report.learnersStillWithoutFamilyAccount = stillMissing;
                console.log("\nLearners still without familyAccountId:");
                for (const l of stillMissing.slice(0, 30)) {
                    console.log(`  ${l.firstName} ${l.lastName} | class=${l.className ?? ""} | admission=${l.admissionNo ?? ""}`);
                }
            }
        }
        if (after.parentLearnerLinks !== daSilvaMigrationService_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT) {
            assertionErrors.push(`parentLearnerLinks expected ${daSilvaMigrationService_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT}, got ${after.parentLearnerLinks}`);
            const stagedLinkSlots = staged.reduce((n, row) => n + row.parents.length, 0);
            const gap = daSilvaMigrationService_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT - after.parentLearnerLinks;
            report.parentLinkGap = {
                expected: daSilvaMigrationService_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
                actual: after.parentLearnerLinks,
                stagedSlots: stagedLinkSlots,
                unmatchedLearnerSlots: repair.unmatchedLearners.reduce((n, u) => n + (staged.find((s) => s.matchKey === u.matchKey)?.parents.length || 0), 0),
                unmatchedParentLinkRows: repair.unmatchedParentLinks.length,
                shortBy: gap,
            };
        }
    }
    else {
        console.log("\nDry run only. Re-run with --apply to persist repairs.");
        const wouldLinkAll = repair.unmatchedLearners.length === 0 &&
            repair.planned.linksUpserted ===
                staged.reduce((n, row) => n + row.parents.length, 0);
        console.log(`Would upsert ~${repair.planned.linksUpserted} parent-learner links (target ${daSilvaMigrationService_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT}); all learners matched: ${repair.unmatchedLearners.length === 0 && wouldLinkAll}`);
    }
    report.assertions = assertionErrors;
    const jsonPath = path_1.default.join(process.cwd(), "repair-da-silva-parent-family-links.json");
    fs_1.default.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${jsonPath}`);
    if (assertionErrors.length) {
        console.error("\nASSERTIONS FAILED:");
        for (const err of assertionErrors)
            console.error(`  - ${err}`);
        process.exit(1);
    }
    if (!apply) {
        process.exit(0);
    }
    console.log("\nRepair completed successfully.");
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
