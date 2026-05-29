"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationApplyError = void 0;
exports.applyMigrationStage = applyMigrationStage;
const prisma_1 = require("../../../prisma");
const classroomNormalization_1 = require("../../../utils/classroomNormalization");
const parentPortalService_1 = require("../../parentPortalService");
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const migrationStageStore_1 = require("../staging/migrationStageStore");
const postMigrationLedgerTransactions_1 = require("./postMigrationLedgerTransactions");
const linkMigrationLearnersToFamilyAccounts_1 = require("./linkMigrationLearnersToFamilyAccounts");
const MigrationTargetField_1 = require("../types/MigrationTargetField");
const buildMigrationStage_1 = require("../staging/buildMigrationStage");
const parsers_1 = require("../../daSilvaMigration/parsers");
const computeMigrationApplyPreview_1 = require("./computeMigrationApplyPreview");
const parseStagedMigrationFile_1 = require("./parseStagedMigrationFile");
const MIGRATION_APPLY_TX_OPTIONS = { maxWait: 30000, timeout: 180000 };
const LEARNER_FIELDS = new Set(MigrationTargetField_1.LEARNER_TARGET_FIELDS);
const PARENT_FIELDS = new Set(MigrationTargetField_1.PARENT_TARGET_FIELDS);
const BILLING_FIELDS = new Set(MigrationTargetField_1.BILLING_TARGET_FIELDS);
const TRANSACTION_FIELDS = new Set(MigrationTargetField_1.TRANSACTION_TARGET_FIELDS);
function emptyCounts() {
    return {
        learners: 0,
        parents: 0,
        employees: 0,
        billingAccounts: 0,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
    };
}
function cleanString(v) {
    return String(v ?? "").trim();
}
function buildTargetToSource(mappings) {
    const map = new Map();
    for (const m of mappings) {
        const target = String(m.targetField || "").trim();
        const source = String(m.sourceColumn || "").trim();
        if (target && source)
            map.set(target, source);
    }
    return map;
}
function mapRawRecord(raw, targetToSource) {
    const out = {};
    for (const [target, sourceCol] of targetToSource) {
        const value = cleanString(raw[sourceCol]);
        if (value)
            out[target] = value;
    }
    return out;
}
function splitPersonName(fullOrSingle) {
    const trimmed = cleanString(fullOrSingle);
    if (!trimmed)
        return { firstName: "", lastName: "" };
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1)
        return { firstName: parts[0], lastName: "" };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
function learnerNamesFromMapped(mapped) {
    const first = cleanString(mapped.firstName);
    const last = cleanString(mapped.lastName);
    if (first || last)
        return { firstName: first, lastName: last };
    return splitPersonName(cleanString(mapped.fullName));
}
function parentNamesFromMapped(mapped) {
    const explicitFirst = cleanString(mapped.parentFirstName);
    const explicitSurname = cleanString(mapped.parentSurname);
    if (explicitFirst || explicitSurname) {
        return {
            firstName: explicitFirst || "Parent",
            surname: explicitSurname || "Guardian",
        };
    }
    const fromName = splitPersonName(cleanString(mapped.parentName));
    return {
        firstName: fromName.firstName || "Parent",
        surname: fromName.lastName || "Guardian",
    };
}
/** Kid-e-Sys contact_list: fall back to Work/Home when Cell No is empty. */
function enrichParentMappedFromContactList(mapped, raw) {
    if (cleanString(mapped.parentPhone))
        return mapped;
    const work = cleanString(raw["Work No"]);
    const home = cleanString(raw["Home No"]);
    if (work)
        return { ...mapped, parentPhone: work };
    if (home)
        return { ...mapped, parentPhone: home };
    return mapped;
}
async function findLearnerIdForParentLink(tx, schoolId, mapped) {
    const names = learnerNamesFromMapped(mapped);
    if (!names.firstName && !names.lastName)
        return null;
    const idNumber = cleanString(mapped.idNumber) || null;
    const classNorm = (0, classroomNormalization_1.normalizeClassroomInput)(cleanString(mapped.classroom), cleanString(mapped.grade));
    const canonicalClass = classNorm.classroomName || null;
    const existing = await tx.learner.findFirst({
        where: {
            schoolId,
            ...(idNumber
                ? { idNumber }
                : {
                    firstName: names.firstName,
                    lastName: names.lastName || names.firstName,
                    className: canonicalClass,
                }),
        },
        select: { id: true },
    });
    return existing?.id ?? null;
}
async function ensureParentLearnerLink(tx, schoolId, parentId, learnerId, mapped, report, plan, rowNumber, createdCounts, skippedCounts) {
    const existing = await tx.parentLearnerLink.findUnique({
        where: { parentId_learnerId: { parentId, learnerId } },
        select: { id: true },
    });
    if (existing) {
        pushReport(report, {
            entityType: "parentLearnerLink",
            sourceFileId: plan.fileId,
            sourceFilename: plan.filename,
            rowNumber,
            status: "skipped",
            message: "Parent–learner link already exists",
            recordId: existing.id,
        });
        bumpCount(skippedCounts, "parentLearnerLink");
        return;
    }
    const link = await tx.parentLearnerLink.create({
        data: {
            schoolId,
            parentId,
            learnerId,
            relation: cleanString(mapped.relationship) || null,
            isPrimary: true,
        },
        select: { id: true },
    });
    pushReport(report, {
        entityType: "parentLearnerLink",
        sourceFileId: plan.fileId,
        sourceFilename: plan.filename,
        rowNumber,
        status: "created",
        message: "Parent–learner link created",
        recordId: link.id,
    });
    bumpCount(createdCounts, "parentLearnerLink");
}
function fileEntityKinds(mappings) {
    const kinds = new Set();
    for (const m of mappings) {
        const cat = (0, buildMigrationStage_1.migrationTargetCategory)(String(m.targetField || ""));
        if (cat === "learner" || cat === "parent" || cat === "billing" || cat === "transaction") {
            kinds.add(cat);
        }
    }
    return kinds;
}
function hasTargetsInSet(mappings, allowed) {
    for (const m of mappings) {
        if (allowed.has(String(m.targetField || "").trim()))
            return true;
    }
    return false;
}
function buildFilePlans(stage) {
    const byFileId = new Map(stage.mappings.map((m) => [m.fileId, m]));
    const plans = [];
    for (const file of stage.files) {
        const pathValue = cleanString(file.path);
        if (!pathValue) {
            throw new Error(`Dry run "${stage.stageId}" is missing on-disk file path for "${file.filename}". Re-create the dry run from Upload Area while source files are still on the server.`);
        }
        const category = String(file.category || "").trim();
        const resolvedPath = (0, parseStagedMigrationFile_1.resolveSafeMigrationFilePath)(pathValue);
        if (category === "staff") {
            plans.push({
                fileId: file.fileId,
                filename: file.filename,
                path: resolvedPath,
                category,
                mappings: byFileId.get(file.fileId)?.mappings ?? [],
                entityKinds: new Set(),
                kidESysStaffImport: true,
            });
            continue;
        }
        const fileMappings = byFileId.get(file.fileId);
        if (!fileMappings?.mappings?.length)
            continue;
        const kinds = fileEntityKinds(fileMappings.mappings);
        if (kinds.size === 0)
            continue;
        plans.push({
            fileId: file.fileId,
            filename: file.filename,
            path: resolvedPath,
            category,
            mappings: fileMappings.mappings,
            entityKinds: kinds,
        });
    }
    if (plans.length === 0) {
        throw new Error("No import files with valid paths found on this dry run stage");
    }
    return plans;
}
function employeeDuplicateKey(emp) {
    const full = cleanString(emp.fullName).toLowerCase();
    if (full)
        return `name:${full}`;
    return `name:${cleanString(emp.firstName).toLowerCase()}|${cleanString(emp.lastName).toLowerCase()}`;
}
function pushReport(report, row) {
    report.push(row);
}
function bumpCount(bucket, entity) {
    switch (entity) {
        case "learner":
            bucket.learners += 1;
            break;
        case "parent":
            bucket.parents += 1;
            break;
        case "employee":
            bucket.employees += 1;
            break;
        case "billingAccount":
            bucket.billingAccounts += 1;
            break;
        case "transaction":
            bucket.transactions += 1;
            break;
        case "classroom":
            bucket.classrooms += 1;
            break;
        case "parentLearnerLink":
            bucket.parentLearnerLinks += 1;
            break;
        default:
            break;
    }
}
function learnerDuplicateKey(mapped) {
    const idNumber = cleanString(mapped.idNumber);
    if (idNumber)
        return `id:${idNumber.toLowerCase()}`;
    const names = learnerNamesFromMapped(mapped);
    const classroom = cleanString(mapped.classroom);
    const classNorm = (0, classroomNormalization_1.normalizeClassroomInput)(classroom, cleanString(mapped.grade));
    const classLabel = classNorm.classroomName || classroom;
    return `name:${names.firstName.toLowerCase()}|${names.lastName.toLowerCase()}|${classLabel.toLowerCase()}`;
}
function parentDuplicateKey(mapped) {
    const idNumber = cleanString(mapped.parentIdNumber);
    if (idNumber)
        return `id:${idNumber.toLowerCase()}`;
    const phone = cleanString(mapped.parentPhone);
    const email = cleanString(mapped.parentEmail).toLowerCase();
    const name = cleanString(mapped.parentName).toLowerCase();
    if (phone)
        return `phone:${phone.replace(/\D/g, "")}`;
    if (email)
        return `email:${email}`;
    if (name)
        return `name:${name}`;
    const names = parentNamesFromMapped(mapped);
    if (names.firstName && names.surname) {
        return `name:${names.firstName.toLowerCase()}|${names.surname.toLowerCase()}`;
    }
    return "";
}
function billingDuplicateKey(mapped) {
    const account = cleanString(mapped.accountNumber);
    return account ? `acct:${account.toLowerCase()}` : "";
}
function emptyTransactionOutcomes() {
    return {
        posted: 0,
        historicalNotApplied: 0,
        blocked: 0,
        unmatched: 0,
        duplicateSkipped: 0,
    };
}
function stageHasTransactionFiles(stage) {
    return stage.stagedCounts.transactions > 0;
}
function validateTransactionApplyGate(stage, proceedWithEligibleActiveOnly) {
    if (!stageHasTransactionFiles(stage))
        return;
    if (!cleanString(stage.cutoverDate)) {
        throw new MigrationApplyError("Cutover date is required before applying transaction files. Set cutover date on the dry run and re-stage.");
    }
    const readiness = stage.transactionReadiness;
    const blocked = readiness?.blockedTransactions ?? 0;
    const unmatched = readiness?.unmatchedTransactions ?? 0;
    if ((blocked > 0 || unmatched > 0) && !proceedWithEligibleActiveOnly) {
        throw new MigrationApplyError(`Transaction apply blocked: ${blocked} blocked and ${unmatched} unmatched transaction(s) in dry run. ` +
            "Tick “Proceed with eligible active transactions only” in the readiness checklist, or fix mappings before apply.");
    }
}
class MigrationApplyError extends Error {
    constructor(message, result) {
        super(message);
        this.result = result;
        this.name = "MigrationApplyError";
    }
}
exports.MigrationApplyError = MigrationApplyError;
async function applyMigrationStage(input) {
    const stageId = cleanString(input.stageId);
    const targetSchoolId = cleanString(input.targetSchoolId);
    const confirmationText = cleanString(input.confirmationText);
    if (!stageId)
        throw new MigrationApplyError("stageId is required");
    if (!targetSchoolId)
        throw new MigrationApplyError("targetSchoolId is required");
    if (!confirmationText)
        throw new MigrationApplyError("confirmationText is required");
    const stage = (0, migrationStageStore_1.getStage)(stageId);
    if (!stage)
        throw new MigrationApplyError("Dry run stage not found");
    if (!stage.canApply) {
        throw new MigrationApplyError("Dry run cannot be applied (canApply is false)");
    }
    if (stage.validationSummary.errors > 0) {
        throw new MigrationApplyError(`Dry run has ${stage.validationSummary.errors} validation error(s) — fix before applying`);
    }
    if (!stage.validationSummary.canProceed) {
        throw new MigrationApplyError("Dry run validation did not pass (canProceed is false)");
    }
    if (stage.validationSummary.mode !== "full") {
        throw new MigrationApplyError("Dry run was not validated against full uploaded files — re-stage after full-file validation");
    }
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: targetSchoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new MigrationApplyError("Target school not found");
    const expectedPhrase = cleanString(school.name);
    if (confirmationText.trim().toLowerCase() !== expectedPhrase.trim().toLowerCase()) {
        throw new MigrationApplyError(`Confirmation phrase must match the target school name exactly (${expectedPhrase})`);
    }
    const filePlans = buildFilePlans(stage);
    const proceedWithEligibleActiveOnly = Boolean(input.proceedWithEligibleActiveOnly);
    validateTransactionApplyGate(stage, proceedWithEligibleActiveOnly);
    const applyExpectations = await (0, computeMigrationApplyPreview_1.computeMigrationApplyPreview)(stage, targetSchoolId);
    try {
        (0, computeMigrationApplyPreview_1.assertLearnerCreateGuard)(applyExpectations);
    }
    catch (guardError) {
        const message = guardError instanceof Error ? guardError.message : "Learner create guard failed";
        throw new MigrationApplyError(message, { applyExpectations });
    }
    const batch = (0, migrationImportBatchStore_1.createMigrationImportBatch)({
        stageId: stage.stageId,
        targetSchoolId: school.id,
        targetSchoolName: school.name,
        sourceSystem: stage.sourceSystem,
        status: "applying",
        stagedCounts: stage.stagedCounts,
    });
    const createdCounts = emptyCounts();
    const skippedCounts = emptyCounts();
    const failedCounts = emptyCounts();
    const transactionOutcomes = emptyTransactionOutcomes();
    const report = [];
    const baseResult = () => ({
        batchId: batch.batchId,
        stageId: stage.stageId,
        targetSchoolId: school.id,
        targetSchoolName: school.name,
        appliedAt: new Date().toISOString(),
        success: false,
        createdCounts: { ...createdCounts },
        skippedCounts: { ...skippedCounts },
        failedCounts: { ...failedCounts },
        transactionOutcomes: { ...transactionOutcomes },
        report: [...report],
        applyExpectations,
    });
    try {
        const parsedFiles = [];
        for (const plan of filePlans) {
            if (plan.kidESysStaffImport)
                continue;
            const rows = await (0, parseStagedMigrationFile_1.parseStagedMigrationFile)(plan.path, plan.filename, stage.sourceSystem);
            parsedFiles.push({
                plan,
                rows,
                targetToSource: buildTargetToSource(plan.mappings),
            });
        }
        const seenLearners = new Set();
        const seenParents = new Set();
        const seenBilling = new Set();
        const seenEmployees = new Set();
        const seenClassrooms = new Set();
        const seenLedgerDuplicateKeys = new Set();
        const rowsByFileId = new Map();
        for (const { plan, rows } of parsedFiles) {
            rowsByFileId.set(plan.fileId, rows);
        }
        await prisma_1.prisma.$transaction(async (tx) => {
            const learnerIndex = await (0, postMigrationLedgerTransactions_1.buildApplyLearnerMatchIndex)(tx, targetSchoolId, stage, rowsByFileId);
            for (const plan of filePlans) {
                if (!plan.kidESysStaffImport)
                    continue;
                const employees = (0, parsers_1.parseEmployeesFile)(plan.path);
                for (let i = 0; i < employees.length; i++) {
                    const emp = employees[i];
                    const rowNumber = i + 1;
                    const dupKey = employeeDuplicateKey(emp);
                    if (!dupKey || dupKey === "name:|") {
                        pushReport(report, {
                            entityType: "employee",
                            sourceFileId: plan.fileId,
                            sourceFilename: plan.filename,
                            rowNumber,
                            status: "failed",
                            message: "Staff row missing name",
                        });
                        bumpCount(failedCounts, "employee");
                        continue;
                    }
                    if (seenEmployees.has(dupKey)) {
                        pushReport(report, {
                            entityType: "employee",
                            sourceFileId: plan.fileId,
                            sourceFilename: plan.filename,
                            rowNumber,
                            status: "skipped",
                            message: "Duplicate staff member in import batch",
                            key: dupKey,
                        });
                        bumpCount(skippedCounts, "employee");
                        continue;
                    }
                    const existing = await tx.employee.findFirst({
                        where: {
                            schoolId: targetSchoolId,
                            OR: [
                                { fullName: emp.fullName },
                                {
                                    AND: [{ firstName: emp.firstName }, { lastName: emp.lastName }],
                                },
                            ],
                        },
                        select: { id: true },
                    });
                    if (existing) {
                        seenEmployees.add(dupKey);
                        pushReport(report, {
                            entityType: "employee",
                            sourceFileId: plan.fileId,
                            sourceFilename: plan.filename,
                            rowNumber,
                            status: "skipped",
                            message: "Staff member already exists for this school",
                            key: dupKey,
                            recordId: existing.id,
                        });
                        bumpCount(skippedCounts, "employee");
                        continue;
                    }
                    const created = await tx.employee.create({
                        data: {
                            schoolId: targetSchoolId,
                            firstName: emp.firstName,
                            lastName: emp.lastName,
                            fullName: emp.fullName,
                            mobileNumber: emp.mobileNumber || null,
                            email: emp.email || null,
                            physicalAddress: emp.physicalAddress || null,
                        },
                        select: { id: true },
                    });
                    seenEmployees.add(dupKey);
                    pushReport(report, {
                        entityType: "employee",
                        sourceFileId: plan.fileId,
                        sourceFilename: plan.filename,
                        rowNumber,
                        status: "created",
                        message: "Staff member created",
                        key: dupKey,
                        recordId: created.id,
                    });
                    bumpCount(createdCounts, "employee");
                }
            }
            for (const { plan, rows, targetToSource } of parsedFiles) {
                const applyLearners = plan.category === "learners" &&
                    plan.entityKinds.has("learner") &&
                    hasTargetsInSet(plan.mappings, LEARNER_FIELDS);
                const applyParents = plan.category === "parents" &&
                    plan.entityKinds.has("parent") &&
                    hasTargetsInSet(plan.mappings, PARENT_FIELDS);
                const applyBilling = plan.category === "billing" &&
                    plan.entityKinds.has("billing") &&
                    hasTargetsInSet(plan.mappings, BILLING_FIELDS);
                const applyParentLinks = plan.category === "parents" && hasTargetsInSet(plan.mappings, LEARNER_FIELDS);
                const applyTransactions = plan.entityKinds.has("transaction") && hasTargetsInSet(plan.mappings, TRANSACTION_FIELDS);
                for (let i = 0; i < rows.length; i++) {
                    const rowNumber = i + 1;
                    let mapped = mapRawRecord(rows[i], targetToSource);
                    if (applyParents) {
                        mapped = enrichParentMappedFromContactList(mapped, rows[i]);
                    }
                    if (applyTransactions) {
                        continue;
                    }
                    let familyAccountId = null;
                    if (applyBilling) {
                        const accountNumber = cleanString(mapped.accountNumber);
                        if (!accountNumber) {
                            pushReport(report, {
                                entityType: "billingAccount",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "failed",
                                message: "Missing accountNumber for billing row",
                            });
                            bumpCount(failedCounts, "billingAccount");
                        }
                        else {
                            const dupKey = billingDuplicateKey(mapped);
                            if (seenBilling.has(dupKey)) {
                                pushReport(report, {
                                    entityType: "billingAccount",
                                    sourceFileId: plan.fileId,
                                    sourceFilename: plan.filename,
                                    rowNumber,
                                    status: "skipped",
                                    message: "Duplicate billing account in import batch",
                                    key: dupKey,
                                });
                                bumpCount(skippedCounts, "billingAccount");
                            }
                            else {
                                const existing = await tx.familyAccount.findFirst({
                                    where: { schoolId: targetSchoolId, accountRef: accountNumber },
                                    select: { id: true },
                                });
                                if (existing) {
                                    familyAccountId = existing.id;
                                    seenBilling.add(dupKey);
                                    pushReport(report, {
                                        entityType: "billingAccount",
                                        sourceFileId: plan.fileId,
                                        sourceFilename: plan.filename,
                                        rowNumber,
                                        status: "skipped",
                                        message: "Billing account already exists for this school",
                                        key: dupKey,
                                        recordId: existing.id,
                                    });
                                    bumpCount(skippedCounts, "billingAccount");
                                }
                                else {
                                    const accountName = cleanString(mapped.accountName) ||
                                        cleanString(mapped.billingPlan) ||
                                        accountNumber;
                                    const created = await tx.familyAccount.create({
                                        data: {
                                            schoolId: targetSchoolId,
                                            accountRef: accountNumber,
                                            familyName: accountName,
                                        },
                                        select: { id: true },
                                    });
                                    familyAccountId = created.id;
                                    seenBilling.add(dupKey);
                                    pushReport(report, {
                                        entityType: "billingAccount",
                                        sourceFileId: plan.fileId,
                                        sourceFilename: plan.filename,
                                        rowNumber,
                                        status: "created",
                                        message: "Family billing account created",
                                        key: dupKey,
                                        recordId: created.id,
                                    });
                                    bumpCount(createdCounts, "billingAccount");
                                }
                            }
                        }
                    }
                    let parentId = null;
                    if (applyParents) {
                        const parentKey = parentDuplicateKey(mapped);
                        if (!parentKey) {
                            pushReport(report, {
                                entityType: "parent",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "failed",
                                message: "Parent row missing phone, email, or name",
                            });
                            bumpCount(failedCounts, "parent");
                        }
                        else if (seenParents.has(parentKey)) {
                            pushReport(report, {
                                entityType: "parent",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "skipped",
                                message: "Duplicate parent in import batch",
                                key: parentKey,
                            });
                            bumpCount(skippedCounts, "parent");
                        }
                        else {
                            const names = parentNamesFromMapped(mapped);
                            const mobile = cleanString(mapped.parentPhone);
                            const email = cleanString(mapped.parentEmail) || null;
                            const parentIdNumber = cleanString(mapped.parentIdNumber) ||
                                null;
                            const phone = mobile ? (0, parentPortalService_1.normalizeSaPhone)(mobile) : null;
                            const orClause = [];
                            if (parentIdNumber)
                                orClause.push({ idNumber: parentIdNumber });
                            if (email)
                                orClause.push({ email });
                            if (phone) {
                                orClause.push({ cellNo: mobile }, { cellNo: phone.localCell }, { cellNo: phone.internationalCell });
                            }
                            if (!orClause.length && parentKey.startsWith("name:")) {
                                orClause.push({
                                    firstName: names.firstName,
                                    surname: names.surname,
                                });
                            }
                            const existing = orClause.length
                                ? await tx.parent.findFirst({
                                    where: { schoolId: targetSchoolId, OR: orClause },
                                    select: { id: true },
                                })
                                : null;
                            if (existing) {
                                parentId = existing.id;
                                seenParents.add(parentKey);
                                pushReport(report, {
                                    entityType: "parent",
                                    sourceFileId: plan.fileId,
                                    sourceFilename: plan.filename,
                                    rowNumber,
                                    status: "skipped",
                                    message: "Parent already exists for this school",
                                    key: parentKey,
                                    recordId: existing.id,
                                });
                                bumpCount(skippedCounts, "parent");
                            }
                            else {
                                const workPhone = cleanString(mapped.parentWorkPhone);
                                const created = await tx.parent.create({
                                    data: {
                                        schoolId: targetSchoolId,
                                        familyAccountId,
                                        firstName: names.firstName,
                                        surname: names.surname,
                                        cellNo: mobile || phone?.localCell || "",
                                        email,
                                        idNumber: parentIdNumber,
                                        relationship: cleanString(mapped.relationship) || null,
                                        homeAddress: cleanString(mapped.address) || null,
                                        workNo: workPhone || null,
                                        notes: cleanString(mapped.parentNotes) ||
                                            null,
                                    },
                                    select: { id: true },
                                });
                                parentId = created.id;
                                seenParents.add(parentKey);
                                pushReport(report, {
                                    entityType: "parent",
                                    sourceFileId: plan.fileId,
                                    sourceFilename: plan.filename,
                                    rowNumber,
                                    status: "created",
                                    message: "Parent created",
                                    key: parentKey,
                                    recordId: created.id,
                                });
                                bumpCount(createdCounts, "parent");
                            }
                        }
                        if (applyParentLinks && parentId) {
                            const learnerId = await findLearnerIdForParentLink(tx, targetSchoolId, mapped);
                            if (learnerId) {
                                await ensureParentLearnerLink(tx, targetSchoolId, parentId, learnerId, mapped, report, plan, rowNumber, createdCounts, skippedCounts);
                            }
                            else {
                                pushReport(report, {
                                    entityType: "parentLearnerLink",
                                    sourceFileId: plan.fileId,
                                    sourceFilename: plan.filename,
                                    rowNumber,
                                    status: "failed",
                                    message: "Learner not found for parent link (learner must exist from class list import)",
                                });
                                bumpCount(failedCounts, "parentLearnerLink");
                            }
                        }
                    }
                    if (applyLearners) {
                        const names = learnerNamesFromMapped(mapped);
                        if (!names.firstName && !names.lastName) {
                            pushReport(report, {
                                entityType: "learner",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "failed",
                                message: "Learner row missing name",
                            });
                            bumpCount(failedCounts, "learner");
                            continue;
                        }
                        const dupKey = learnerDuplicateKey(mapped);
                        if (seenLearners.has(dupKey)) {
                            pushReport(report, {
                                entityType: "learner",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "skipped",
                                message: "Duplicate learner in import batch",
                                key: dupKey,
                            });
                            bumpCount(skippedCounts, "learner");
                            continue;
                        }
                        const classNorm = (0, classroomNormalization_1.normalizeClassroomInput)(cleanString(mapped.classroom), cleanString(mapped.grade));
                        const canonicalClass = classNorm.classroomName || null;
                        if (canonicalClass && !seenClassrooms.has(canonicalClass)) {
                            const classroom = await tx.classroom.upsert({
                                where: {
                                    schoolId_name: { schoolId: targetSchoolId, name: canonicalClass },
                                },
                                create: {
                                    schoolId: targetSchoolId,
                                    name: canonicalClass,
                                    teacherName: "",
                                    teacherEmail: "",
                                },
                                update: {},
                                select: { id: true },
                            });
                            seenClassrooms.add(canonicalClass);
                            pushReport(report, {
                                entityType: "classroom",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "created",
                                message: "Classroom ensured",
                                key: canonicalClass,
                                recordId: classroom.id,
                            });
                            bumpCount(createdCounts, "classroom");
                        }
                        const idNumber = cleanString(mapped.idNumber) || null;
                        const existingByDup = await tx.learner.findFirst({
                            where: {
                                schoolId: targetSchoolId,
                                ...(idNumber
                                    ? { idNumber }
                                    : {
                                        firstName: names.firstName,
                                        lastName: names.lastName,
                                        className: canonicalClass,
                                    }),
                            },
                            select: { id: true },
                        });
                        const existing = existingByDup;
                        if (existing) {
                            seenLearners.add(dupKey);
                            pushReport(report, {
                                entityType: "learner",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "skipped",
                                message: "Learner already exists for this school",
                                key: dupKey,
                                recordId: existing.id,
                            });
                            bumpCount(skippedCounts, "learner");
                            if (parentId) {
                                const link = await tx.parentLearnerLink.upsert({
                                    where: {
                                        parentId_learnerId: { parentId, learnerId: existing.id },
                                    },
                                    create: {
                                        schoolId: targetSchoolId,
                                        parentId,
                                        learnerId: existing.id,
                                        relation: cleanString(mapped.relationship) || null,
                                        isPrimary: true,
                                    },
                                    update: {},
                                    select: { id: true },
                                });
                                pushReport(report, {
                                    entityType: "parentLearnerLink",
                                    sourceFileId: plan.fileId,
                                    sourceFilename: plan.filename,
                                    rowNumber,
                                    status: "created",
                                    message: "Parent–learner link ensured",
                                    recordId: link.id,
                                });
                                bumpCount(createdCounts, "parentLearnerLink");
                            }
                            continue;
                        }
                        const birthRaw = cleanString(mapped.dateOfBirth);
                        const birthDate = birthRaw ? new Date(birthRaw) : null;
                        const accountNumber = cleanString(mapped.accountNumber);
                        let learnerFamilyAccountId = familyAccountId;
                        if (accountNumber && !learnerFamilyAccountId) {
                            const existingFa = await tx.familyAccount.findFirst({
                                where: { schoolId: targetSchoolId, accountRef: accountNumber },
                                select: { id: true },
                            });
                            if (existingFa) {
                                learnerFamilyAccountId = existingFa.id;
                            }
                        }
                        const created = await tx.learner.create({
                            data: {
                                schoolId: targetSchoolId,
                                familyAccountId: learnerFamilyAccountId,
                                firstName: names.firstName,
                                lastName: names.lastName || names.firstName,
                                nickname: cleanString(mapped.nickname) || null,
                                grade: cleanString(mapped.grade) || classNorm.gradeLabel || "",
                                className: canonicalClass,
                                idNumber,
                                admissionNo: cleanString(mapped.learnerNumber) || accountNumber || null,
                                gender: cleanString(mapped.gender) || null,
                                birthDate: birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate : null,
                                homeLanguage: cleanString(mapped.homeLanguage) ||
                                    null,
                                citizenship: cleanString(mapped.citizenship) ||
                                    null,
                            },
                            select: { id: true },
                        });
                        seenLearners.add(dupKey);
                        pushReport(report, {
                            entityType: "learner",
                            sourceFileId: plan.fileId,
                            sourceFilename: plan.filename,
                            rowNumber,
                            status: "created",
                            message: "Learner created",
                            key: dupKey,
                            recordId: created.id,
                        });
                        bumpCount(createdCounts, "learner");
                        if (parentId) {
                            const link = await tx.parentLearnerLink.create({
                                data: {
                                    schoolId: targetSchoolId,
                                    parentId,
                                    learnerId: created.id,
                                    relation: cleanString(mapped.relationship) || null,
                                    isPrimary: true,
                                },
                                select: { id: true },
                            });
                            pushReport(report, {
                                entityType: "parentLearnerLink",
                                sourceFileId: plan.fileId,
                                sourceFilename: plan.filename,
                                rowNumber,
                                status: "created",
                                message: "Parent–learner link created",
                                recordId: link.id,
                            });
                            bumpCount(createdCounts, "parentLearnerLink");
                        }
                    }
                }
            }
            const linkResult = await (0, linkMigrationLearnersToFamilyAccounts_1.linkMigrationLearnersToFamilyAccounts)(targetSchoolId, tx);
            if (linkResult.learnersLinked > 0 || linkResult.parentsLinked > 0) {
                pushReport(report, {
                    entityType: "learner",
                    sourceFileId: stage.stageId,
                    sourceFilename: "post-apply-link",
                    rowNumber: 0,
                    status: "created",
                    message: `Linked ${linkResult.learnersLinked} learner(s) and ${linkResult.parentsLinked} parent(s) to family accounts`,
                });
            }
            const ledgerCtx = {
                tx,
                schoolId: targetSchoolId,
                cutoverDate: stage.cutoverDate,
                learnerIndex,
                seenDuplicateKeys: seenLedgerDuplicateKeys,
                report,
                createdCounts,
                skippedCounts,
                failedCounts,
                transactionOutcomes,
            };
            for (const { plan, rows, targetToSource } of parsedFiles) {
                const applyTransactions = plan.entityKinds.has("transaction") && hasTargetsInSet(plan.mappings, TRANSACTION_FIELDS);
                if (!applyTransactions)
                    continue;
                for (let i = 0; i < rows.length; i++) {
                    const rowNumber = i + 1;
                    const mapped = mapRawRecord(rows[i], targetToSource);
                    await (0, postMigrationLedgerTransactions_1.postSingleMigrationLedgerTransaction)(ledgerCtx, {
                        mapped,
                        sourceFileId: plan.fileId,
                        sourceFilename: plan.filename,
                        rowNumber,
                    });
                }
            }
        }, MIGRATION_APPLY_TX_OPTIONS);
        const result = {
            ...baseResult(),
            success: true,
            createdCounts: { ...createdCounts },
            skippedCounts: { ...skippedCounts },
            failedCounts: { ...failedCounts },
            transactionOutcomes: { ...transactionOutcomes },
            report,
            applyExpectations,
        };
        (0, migrationImportBatchStore_1.updateImportBatch)(batch.batchId, {
            status: "completed",
            completedAt: result.appliedAt,
            result,
            createdCounts: result.createdCounts,
            skippedCounts: result.skippedCounts,
            failedCounts: result.failedCounts,
            reportRows: result.report,
        });
        return result;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Apply failed";
        const failedResult = {
            ...baseResult(),
            success: false,
            error: message,
        };
        (0, migrationImportBatchStore_1.updateImportBatch)(batch.batchId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            result: failedResult,
            createdCounts: failedResult.createdCounts,
            skippedCounts: failedResult.skippedCounts,
            failedCounts: failedResult.failedCounts,
            reportRows: failedResult.report,
        });
        throw new MigrationApplyError(message, failedResult);
    }
}
