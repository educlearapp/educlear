"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_CSV_TEMPLATE = void 0;
exports.buildFieldMappings = buildFieldMappings;
exports.mapRawRow = mapRawRow;
exports.validateMigrationRows = validateMigrationRows;
exports.saveMigrationStaging = saveMigrationStaging;
exports.loadMigrationStaging = loadMigrationStaging;
exports.commitMigrationImport = commitMigrationImport;
exports.rollbackMigrationImport = rollbackMigrationImport;
exports.repairSchoolClassroomNames = repairSchoolClassroomNames;
exports.createProjectId = createProjectId;
exports.buildConfirmToken = buildConfirmToken;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../prisma");
const classroomNormalization_1 = require("../utils/classroomNormalization");
const parentPortalService_1 = require("./parentPortalService");
const staffJwt_1 = require("../utils/staffJwt");
const parentPortalService_2 = require("./parentPortalService");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function stagingPath(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, `${projectId}.json`);
}
function manifestPath(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, `${projectId}.manifest.json`);
}
function ensureDir(dir) {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
}
const MIGRATION_TX_OPTIONS = { maxWait: 30000, timeout: 120000 };
const MIGRATION_LINK_BATCH_SIZE = 50;
function writeImportManifest(manifest) {
    ensureDir(path_1.default.join(STAGING_ROOT, manifest.schoolId));
    fs_1.default.writeFileSync(manifestPath(manifest.schoolId, manifest.projectId), JSON.stringify(manifest, null, 2));
}
function learnerLabel(row) {
    return `Row ${row.rowIndex}: ${row.firstName} ${row.lastName}`.trim();
}
function learnerDedupeKey(row, classNorm) {
    const adm = String(row.admissionNo || "").trim().toLowerCase();
    if (adm)
        return `adm:${adm}`;
    const idn = String(row.idNumber || "").trim().toLowerCase();
    if (idn)
        return `id:${idn}`;
    const name = `${row.firstName}|${row.lastName}|${row.grade}|${classNorm.matchKey}`
        .toLowerCase()
        .replace(/\s+/g, " ");
    return `name:${name}`;
}
const FIELD_ALIASES = {
    firstName: ["firstname", "first name", "name", "learner first name"],
    lastName: ["lastname", "last name", "surname", "learner surname"],
    grade: ["grade", "year", "phase"],
    className: ["class", "classname", "class name", "classroom", "register class"],
    admissionNo: ["admission", "admissionno", "admission no", "account", "account no"],
    idNumber: ["idnumber", "id number", "id no", "learner id"],
    parentFirstName: ["parent first name", "parentfirstname", "guardian first name"],
    parentSurname: ["parent surname", "parentsurname", "guardian surname"],
    parentMobile: ["parent mobile", "parent cell", "cell", "mobile", "cellno", "cell no"],
    parentEmail: ["parent email", "parentemail", "guardian email"],
    teacherName: ["teacher", "teacher name", "class teacher"],
    teacherEmail: ["teacher email", "teacheremail", "class teacher email"],
};
function buildFieldMappings(headers) {
    const normalizedHeaders = headers.map((h) => ({
        raw: h,
        key: h.trim().toLowerCase().replace(/\s+/g, " "),
    }));
    const mappings = [];
    for (const [eduField, aliases] of Object.entries(FIELD_ALIASES)) {
        const match = normalizedHeaders.find((h) => aliases.some((a) => h.key === a || h.key.includes(a)));
        mappings.push({
            id: eduField,
            sourceField: match?.raw || "",
            eduClearField: eduField,
            status: match ? "mapped" : "missing",
            notes: match ? "Auto-mapped from header" : "Not found in file — map manually if required",
        });
    }
    return mappings;
}
function mapRawRow(raw, rowIndex, mappings) {
    const headerToField = new Map();
    for (const m of mappings) {
        if (m.sourceField && m.status === "mapped") {
            headerToField.set(m.sourceField.trim().toLowerCase(), m.eduClearField);
        }
    }
    const values = {};
    for (const [header, value] of Object.entries(raw)) {
        const field = headerToField.get(header.trim().toLowerCase());
        if (field)
            values[field] = String(value ?? "").trim();
    }
    return {
        rowIndex,
        firstName: values.firstName || "",
        lastName: values.lastName || "",
        grade: values.grade || "",
        className: values.className || "",
        admissionNo: values.admissionNo,
        idNumber: values.idNumber,
        parentFirstName: values.parentFirstName,
        parentSurname: values.parentSurname,
        parentMobile: values.parentMobile,
        parentEmail: values.parentEmail,
        relation: values.relation,
        teacherName: values.teacherName,
        teacherEmail: values.teacherEmail,
    };
}
async function validateMigrationRows(opts) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error("School not found");
    const issues = [];
    let issueSeq = 0;
    const addIssue = (partial) => {
        issues.push({
            id: `issue-${++issueSeq}`,
            status: "open",
            ...partial,
        });
    };
    const mappings = opts.headers?.length ? buildFieldMappings(opts.headers) : [];
    const existingLearners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: opts.schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            grade: true,
            className: true,
            admissionNo: true,
            idNumber: true,
        },
    });
    const existingClassrooms = await prisma_1.prisma.classroom.findMany({
        where: { schoolId: opts.schoolId },
        select: { id: true, name: true, teacherEmail: true, teacherName: true },
    });
    const classroomKeyInDb = new Map();
    for (const c of existingClassrooms) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(c.name);
        const key = norm.matchKey || c.name.toLowerCase();
        if (key && !classroomKeyInDb.has(key)) {
            classroomKeyInDb.set(key, { name: c.name, id: c.id });
        }
    }
    const importLearnerKeys = new Map();
    const classRows = [];
    const teacherByClassKey = new Map();
    const missingParents = [];
    for (const row of opts.rows) {
        if (!row.firstName || !row.lastName) {
            addIssue({
                issue: "Learner missing first or last name",
                severity: "error",
                record: learnerLabel(row),
                suggestedFix: "Provide firstName and lastName for every learner row",
                category: "learner",
            });
        }
        if (!row.grade) {
            addIssue({
                issue: "Learner missing grade",
                severity: "warning",
                record: learnerLabel(row),
                suggestedFix: "Add grade column or infer from class name (e.g. 8A → Grade 8)",
                category: "learner",
            });
        }
        const classNorm = (0, classroomNormalization_1.normalizeClassroomInput)(row.className, row.grade);
        if (classNorm.needsConfirmation) {
            addIssue({
                issue: "Classroom name needs confirmation.",
                severity: "warning",
                record: `${learnerLabel(row)} — class "${row.className}"`,
                suggestedFix: "Confirm normalized class name in preview before import, or fix the source label",
                category: "normalization",
            });
        }
        if (!classNorm.classroomName) {
            addIssue({
                issue: "Learner missing class",
                severity: "warning",
                record: learnerLabel(row),
                suggestedFix: "Add className (e.g. 8A or Grade 8 / 8A)",
                category: "classroom",
            });
        }
        else {
            classRows.push({ raw: row.className, gradeHint: row.grade, rowIndex: row.rowIndex });
        }
        const dedupeKey = learnerDedupeKey(row, classNorm);
        const rowsForKey = importLearnerKeys.get(dedupeKey) || [];
        rowsForKey.push(row.rowIndex);
        importLearnerKeys.set(dedupeKey, rowsForKey);
        const hasParent = String(row.parentMobile || "").trim() ||
            String(row.parentIdNumber || "").trim() ||
            (String(row.parentFirstName || "").trim() && String(row.parentSurname || "").trim());
        if (!hasParent) {
            missingParents.push({ rowIndex: row.rowIndex, learnerLabel: learnerLabel(row) });
        }
        if (classNorm.matchKey) {
            const tEmail = (0, staffJwt_1.normalizeStaffEmail)(row.teacherEmail || "");
            const tName = String(row.teacherName || "").trim();
            if (tEmail || tName) {
                const bucket = teacherByClassKey.get(classNorm.matchKey) ||
                    new Map();
                const tKey = `${tEmail}|${tName}`;
                const prev = bucket.get(tKey) || { name: tName, email: tEmail, rowCount: 0 };
                prev.rowCount += 1;
                bucket.set(tKey, prev);
                teacherByClassKey.set(classNorm.matchKey, bucket);
            }
        }
        for (const ex of existingLearners) {
            const adm = String(row.admissionNo || "").trim();
            if (adm && ex.admissionNo && adm === ex.admissionNo) {
                addIssue({
                    issue: "Learner already exists (admission/account no)",
                    severity: "error",
                    record: `${learnerLabel(row)} → existing ${ex.firstName} ${ex.lastName}`,
                    suggestedFix: "Skip row or remove duplicate from import file",
                    category: "duplicate",
                });
            }
            const idn = String(row.idNumber || "").trim();
            if (idn && ex.idNumber && idn === ex.idNumber) {
                addIssue({
                    issue: "Learner already exists (ID number)",
                    severity: "error",
                    record: `${learnerLabel(row)} → existing ${ex.firstName} ${ex.lastName}`,
                    suggestedFix: "Skip row or verify ID number",
                    category: "duplicate",
                });
            }
        }
    }
    const duplicateLearners = [...importLearnerKeys.entries()]
        .filter(([, indexes]) => indexes.length > 1)
        .map(([key, rowIndexes]) => ({
        key,
        label: key.startsWith("adm:")
            ? `Account ${key.slice(4)}`
            : key.startsWith("id:")
                ? `ID ${key.slice(3)}`
                : "Duplicate name/grade/class in file",
        rowIndexes,
    }));
    for (const dup of duplicateLearners) {
        addIssue({
            issue: "Duplicate learner in import file",
            severity: "error",
            record: `Rows ${dup.rowIndexes.join(", ")}`,
            suggestedFix: "Remove duplicate rows before import",
            category: "duplicate",
        });
    }
    const classGroups = (0, classroomNormalization_1.groupClassroomsByMatchKey)(classRows.map((r) => ({ raw: r.raw, gradeHint: r.gradeHint })));
    const duplicateClassrooms = [...classGroups.entries()]
        .filter(([, g]) => g.rawLabels.length > 1)
        .map(([matchKey, g]) => ({
        matchKey,
        canonicalName: g.canonical.classroomName,
        variants: g.rawLabels,
        learnerRows: g.items.length,
    }));
    for (const dup of duplicateClassrooms) {
        addIssue({
            issue: "Multiple class labels map to same classroom",
            severity: "warning",
            record: `${dup.canonicalName}: ${dup.variants.join(" | ")}`,
            suggestedFix: "Will normalize to one classroom on import — verify variants are intentional",
            category: "normalization",
        });
    }
    for (const [matchKey, g] of classGroups) {
        const existing = classroomKeyInDb.get(matchKey);
        if (existing && existing.name !== g.canonical.classroomName) {
            addIssue({
                issue: "Import class conflicts with existing classroom name",
                severity: "warning",
                record: `File → "${g.canonical.classroomName}", DB → "${existing.name}"`,
                suggestedFix: "Run classroom repair after import or align source labels to existing classroom name",
                category: "classroom",
            });
        }
    }
    const teacherAssignmentWarnings = [...teacherByClassKey.entries()]
        .map(([matchKey, teachers]) => {
        const group = classGroups.get(matchKey);
        const teacherList = [...teachers.values()];
        if (teacherList.length <= 1)
            return null;
        return {
            matchKey,
            canonicalName: group?.canonical.classroomName || matchKey,
            teachers: teacherList,
        };
    })
        .filter(Boolean);
    for (const warn of teacherAssignmentWarnings) {
        addIssue({
            issue: "Conflicting teacher assignments for same class",
            severity: "warning",
            record: `${warn.canonicalName}: ${warn.teachers.map((t) => t.email || t.name).join(", ")}`,
            suggestedFix: "Use one teacher email per class in source file; first row wins on import",
            category: "teacher",
        });
    }
    for (const mp of missingParents) {
        addIssue({
            issue: "Learner has no parent/guardian contact in import",
            severity: "warning",
            record: mp.learnerLabel,
            suggestedFix: "Add parent mobile or ID; parent portal links require a parent record",
            category: "parent",
        });
    }
    const normalizationPreview = [];
    const previewRawSeen = new Set();
    for (const classRow of classRows) {
        const originalName = cleanString(classRow.raw);
        if (!originalName)
            continue;
        const dedupeRaw = originalName.toLowerCase();
        if (previewRawSeen.has(dedupeRaw))
            continue;
        previewRawSeen.add(dedupeRaw);
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(originalName, classRow.gradeHint);
        const group = classGroups.get(norm.matchKey || norm.classroomName.toLowerCase());
        const teachers = norm.matchKey ? teacherByClassKey.get(norm.matchKey) : undefined;
        const teacherList = teachers ? [...teachers.values()] : [];
        const primary = teacherList[0];
        const learnerCount = opts.rows.filter((r) => cleanString(r.className).toLowerCase() === dedupeRaw).length;
        const rowWarnings = [...norm.warnings];
        if (group && group.rawLabels.length > 1) {
            const others = group.rawLabels.filter((l) => l.toLowerCase() !== dedupeRaw);
            if (others.length) {
                rowWarnings.push(`Resolves with same classroom as: ${others.join(" | ")}`);
            }
        }
        if (teacherList.length > 1) {
            rowWarnings.push(`Multiple teachers (${teacherList.length}) — first assignment used on import`);
        }
        if (norm.needsConfirmation && !rowWarnings.includes("Classroom name needs confirmation.")) {
            rowWarnings.push("Classroom name needs confirmation.");
        }
        normalizationPreview.push({
            matchKey: norm.matchKey,
            originalName,
            canonicalName: norm.classroomName,
            normalizedName: norm.classroomName,
            rawLabels: group?.rawLabels.length ? group.rawLabels : [originalName],
            detectedGrade: norm.gradeLabel,
            detectedClassLetter: norm.classLetter,
            detectedYear: norm.importYear,
            importYear: norm.importYear,
            learnerCount,
            teacherEmail: primary?.email || "",
            teacherName: primary?.name || "",
            warnings: rowWarnings,
            needsConfirmation: norm.needsConfirmation || (group?.needsConfirmation ?? false),
            warning: rowWarnings[0],
        });
    }
    normalizationPreview.sort((a, b) => a.originalName.localeCompare(b.originalName));
    const blockingErrorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    return {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        schoolName: school.name,
        source: opts.source,
        rowCount: opts.rows.length,
        learnerCount: opts.rows.length,
        parentLinkCount: opts.rows.filter((r) => r.parentMobile ||
            r.parentIdNumber ||
            (r.parentFirstName && r.parentSurname)).length,
        classroomGroupCount: classGroups.size,
        duplicateClassrooms,
        duplicateLearners,
        missingParents,
        teacherAssignmentWarnings,
        normalizationPreview,
        issues,
        mappings,
        canImport: blockingErrorCount === 0 && opts.rows.length > 0,
        blockingErrorCount,
        warningCount,
    };
}
async function saveMigrationStaging(bundle) {
    const dir = path_1.default.join(STAGING_ROOT, bundle.schoolId);
    ensureDir(dir);
    fs_1.default.writeFileSync(stagingPath(bundle.schoolId, bundle.projectId), JSON.stringify(bundle, null, 2));
}
function loadMigrationStaging(schoolId, projectId) {
    const file = stagingPath(schoolId, projectId);
    if (!fs_1.default.existsSync(file))
        return null;
    return JSON.parse(fs_1.default.readFileSync(file, "utf-8"));
}
function cleanString(v) {
    return String(v ?? "").trim();
}
async function findOrCreateParentInTx(tx, schoolId, row) {
    const mobile = cleanString(row.parentMobile);
    const idNumber = cleanString(row.parentIdNumber);
    const firstName = cleanString(row.parentFirstName) || "Parent";
    const surname = cleanString(row.parentSurname) || "Guardian";
    if (!mobile && !idNumber)
        return { parentId: null, created: false };
    const phone = mobile ? (0, parentPortalService_1.normalizeSaPhone)(mobile) : null;
    const orClause = [];
    if (idNumber)
        orClause.push({ idNumber });
    if (phone) {
        orClause.push({ cellNo: mobile }, { cellNo: phone.localCell }, { cellNo: phone.internationalCell });
    }
    const existing = orClause.length
        ? await tx.parent.findFirst({
            where: { schoolId, OR: orClause },
            select: { id: true },
        })
        : null;
    if (existing)
        return { parentId: existing.id, created: false };
    const created = await tx.parent.create({
        data: {
            schoolId,
            firstName,
            surname,
            cellNo: mobile || phone?.localCell || "",
            email: cleanString(row.parentEmail) || null,
            idNumber: idNumber || null,
            relationship: cleanString(row.relation) || null,
        },
        select: { id: true },
    });
    return { parentId: created.id, created: true };
}
async function commitMigrationImport(opts) {
    const staging = loadMigrationStaging(opts.schoolId, opts.projectId);
    if (!staging)
        throw new Error("Staging not found — run Import to Staging first");
    if (!staging.validation.canImport) {
        throw new Error("Validation has blocking errors — fix issues before final import");
    }
    const expectedToken = `${opts.projectId}:${staging.validation.blockingErrorCount}:${staging.rows.length}`;
    if (opts.confirmToken !== expectedToken) {
        throw new Error("Confirm token mismatch — re-run validation preview before import");
    }
    const manifest = {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        importedAt: new Date().toISOString(),
        learnerIds: [],
        parentIds: [],
        linkIds: [],
        classroomIds: [],
        threadIds: [],
        renamedClassrooms: [],
    };
    const classTeacherByKey = new Map();
    for (const preview of staging.validation.normalizationPreview) {
        classTeacherByKey.set(preview.matchKey, {
            name: preview.teacherName,
            email: preview.teacherEmail,
            canonical: (0, classroomNormalization_1.normalizeClassroomInput)(preview.canonicalName),
        });
    }
    const pendingLinks = [];
    await prisma_1.prisma.$transaction(async (tx) => {
        for (const row of staging.rows) {
            const classNorm = (0, classroomNormalization_1.normalizeClassroomInput)(row.className, row.grade);
            const canonicalClass = classNorm.classroomName || null;
            const teacherMeta = classNorm.matchKey
                ? classTeacherByKey.get(classNorm.matchKey)
                : undefined;
            let classroomId = null;
            if (canonicalClass && classNorm.matchKey) {
                const teacherEmail = (0, staffJwt_1.normalizeStaffEmail)(row.teacherEmail || teacherMeta?.email || "");
                const teacherName = cleanString(row.teacherName || teacherMeta?.name || "");
                const classroom = await tx.classroom.upsert({
                    where: {
                        schoolId_name: { schoolId: opts.schoolId, name: canonicalClass },
                    },
                    create: {
                        schoolId: opts.schoolId,
                        name: canonicalClass,
                        teacherName,
                        teacherEmail,
                    },
                    update: {
                        ...(teacherName ? { teacherName } : {}),
                        ...(teacherEmail ? { teacherEmail } : {}),
                    },
                });
                if (!manifest.classroomIds.includes(classroom.id)) {
                    manifest.classroomIds.push(classroom.id);
                }
                classroomId = classroom.id;
            }
            const learnerSurname = cleanString(row.lastName);
            const accountNo = cleanString(row.admissionNo);
            let familyAccountId = null;
            if (accountNo) {
                const existingFa = await tx.familyAccount.findFirst({
                    where: { schoolId: opts.schoolId, accountRef: accountNo },
                    select: { id: true },
                });
                if (existingFa) {
                    familyAccountId = existingFa.id;
                }
                else {
                    const fa = await tx.familyAccount.create({
                        data: {
                            schoolId: opts.schoolId,
                            accountRef: accountNo,
                            familyName: learnerSurname,
                        },
                    });
                    familyAccountId = fa.id;
                }
            }
            else {
                const fa = await tx.familyAccount.create({
                    data: {
                        schoolId: opts.schoolId,
                        accountRef: `MIG-${opts.projectId.slice(0, 8)}-${row.rowIndex}`,
                        familyName: learnerSurname,
                    },
                });
                familyAccountId = fa.id;
            }
            const learnerFields = {
                familyAccountId,
                firstName: cleanString(row.firstName),
                lastName: learnerSurname,
                grade: cleanString(row.grade) || classNorm.gradeLabel || "",
                className: canonicalClass,
                idNumber: cleanString(row.idNumber) || null,
                birthDate: row.birthDate ? new Date(row.birthDate) : null,
                gender: cleanString(row.gender) || null,
            };
            let learner;
            if (accountNo) {
                const existingLearner = await tx.learner.findFirst({
                    where: { schoolId: opts.schoolId, admissionNo: accountNo },
                    select: { id: true },
                });
                if (existingLearner) {
                    learner = await tx.learner.update({
                        where: { id: existingLearner.id },
                        data: learnerFields,
                    });
                    console.log(`updated existing learner admissionNo ${accountNo}`);
                }
                else {
                    learner = await tx.learner.create({
                        data: {
                            schoolId: opts.schoolId,
                            admissionNo: accountNo,
                            ...learnerFields,
                        },
                    });
                    console.log(`created learner admissionNo ${accountNo}`);
                }
            }
            else {
                const existingByName = await tx.learner.findFirst({
                    where: {
                        schoolId: opts.schoolId,
                        firstName: learnerFields.firstName,
                        lastName: learnerFields.lastName,
                        className: canonicalClass || null,
                    },
                    select: { id: true },
                });
                if (existingByName) {
                    learner = await tx.learner.update({
                        where: { id: existingByName.id },
                        data: learnerFields,
                    });
                    console.log(`updated existing learner (name/class) ${learnerFields.firstName} ${learnerFields.lastName}`);
                }
                else {
                    learner = await tx.learner.create({
                        data: {
                            schoolId: opts.schoolId,
                            admissionNo: null,
                            ...learnerFields,
                        },
                    });
                }
            }
            manifest.learnerIds.push(learner.id);
            const { parentId, created } = await findOrCreateParentInTx(tx, opts.schoolId, row);
            if (parentId) {
                if (created && !manifest.parentIds.includes(parentId)) {
                    manifest.parentIds.push(parentId);
                }
                pendingLinks.push({
                    parentId,
                    learnerId: learner.id,
                    relation: cleanString(row.relation) || null,
                    classroomId,
                    teacherName: cleanString(row.teacherName || teacherMeta?.name || "") || "Class Teacher",
                    teacherEmail: (0, staffJwt_1.normalizeStaffEmail)(row.teacherEmail || teacherMeta?.email || ""),
                });
            }
        }
    }, MIGRATION_TX_OPTIONS);
    // Persist core records before links — learners survive a link-phase timeout.
    writeImportManifest(manifest);
    for (let i = 0; i < pendingLinks.length; i += MIGRATION_LINK_BATCH_SIZE) {
        const batch = pendingLinks.slice(i, i + MIGRATION_LINK_BATCH_SIZE);
        await prisma_1.prisma.$transaction(async (tx) => {
            for (const pending of batch) {
                const link = await tx.parentLearnerLink.upsert({
                    where: {
                        parentId_learnerId: { parentId: pending.parentId, learnerId: pending.learnerId },
                    },
                    create: {
                        schoolId: opts.schoolId,
                        parentId: pending.parentId,
                        learnerId: pending.learnerId,
                        relation: pending.relation,
                        isPrimary: true,
                    },
                    update: {},
                });
                manifest.linkIds.push(link.id);
                if (pending.classroomId) {
                    const thread = await tx.parentTeacherThread.upsert({
                        where: {
                            schoolId_parentId_learnerId: {
                                schoolId: opts.schoolId,
                                parentId: pending.parentId,
                                learnerId: pending.learnerId,
                            },
                        },
                        create: {
                            schoolId: opts.schoolId,
                            parentId: pending.parentId,
                            learnerId: pending.learnerId,
                            classroomId: pending.classroomId,
                            teacherName: pending.teacherName,
                            teacherEmail: pending.teacherEmail,
                        },
                        update: { classroomId: pending.classroomId },
                    });
                    manifest.threadIds.push(thread.id);
                }
            }
        }, MIGRATION_TX_OPTIONS);
        writeImportManifest(manifest);
    }
    for (const classroomId of manifest.classroomIds) {
        await (0, parentPortalService_2.syncParentThreadsForClassroom)(opts.schoolId, classroomId);
    }
    writeImportManifest(manifest);
    return {
        success: true,
        imported: {
            learners: manifest.learnerIds.length,
            parents: manifest.parentIds.length,
            links: manifest.linkIds.length,
            classrooms: manifest.classroomIds.length,
        },
        manifest,
    };
}
async function rollbackMigrationImport(opts) {
    const file = manifestPath(opts.schoolId, opts.projectId);
    if (!fs_1.default.existsSync(file)) {
        throw new Error("No import manifest found for this project — nothing to roll back");
    }
    const manifest = JSON.parse(fs_1.default.readFileSync(file, "utf-8"));
    const removed = {
        threads: 0,
        links: 0,
        learners: 0,
        parents: 0,
        classrooms: 0,
    };
    await prisma_1.prisma.$transaction(async (tx) => {
        if (manifest.threadIds.length) {
            const r = await tx.parentTeacherThread.deleteMany({
                where: { id: { in: manifest.threadIds }, schoolId: opts.schoolId },
            });
            removed.threads = r.count;
        }
        if (manifest.linkIds.length) {
            const r = await tx.parentLearnerLink.deleteMany({
                where: { id: { in: manifest.linkIds }, schoolId: opts.schoolId },
            });
            removed.links = r.count;
        }
        if (manifest.learnerIds.length) {
            const r = await tx.learner.deleteMany({
                where: { id: { in: manifest.learnerIds }, schoolId: opts.schoolId },
            });
            removed.learners = r.count;
        }
        if (manifest.parentIds.length) {
            const r = await tx.parent.deleteMany({
                where: { id: { in: manifest.parentIds }, schoolId: opts.schoolId },
            });
            removed.parents = r.count;
        }
        if (manifest.classroomIds.length) {
            const r = await tx.classroom.deleteMany({
                where: { id: { in: manifest.classroomIds }, schoolId: opts.schoolId },
            });
            removed.classrooms = r.count;
        }
    }, MIGRATION_TX_OPTIONS);
    fs_1.default.unlinkSync(file);
    return { success: true, removed };
}
/** Normalize existing learner className + classroom records for a school (safe repair). */
async function repairSchoolClassroomNames(schoolId) {
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId, className: { not: null } },
        select: { id: true, className: true, grade: true },
    });
    let learnersUpdated = 0;
    const canonicalByKey = new Map();
    for (const l of learners) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(String(l.className || ""), l.grade);
        if (!norm.classroomName || norm.classroomName === l.className)
            continue;
        canonicalByKey.set(norm.matchKey, norm.classroomName);
        await prisma_1.prisma.learner.update({
            where: { id: l.id },
            data: { className: norm.classroomName },
        });
        learnersUpdated += 1;
    }
    const classrooms = await prisma_1.prisma.classroom.findMany({
        where: { schoolId },
        select: { id: true, name: true },
    });
    let classroomsMerged = 0;
    const classroomByKey = new Map();
    for (const c of classrooms) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(c.name);
        const key = norm.matchKey || c.name.toLowerCase();
        const canonical = canonicalByKey.get(key) || norm.classroomName;
        if (!canonical)
            continue;
        const existing = classroomByKey.get(key);
        if (!existing) {
            if (c.name !== canonical) {
                await prisma_1.prisma.classroom.update({
                    where: { id: c.id },
                    data: { name: canonical },
                });
                classroomsMerged += 1;
            }
            classroomByKey.set(key, { id: c.id, name: canonical });
            continue;
        }
        if (existing.id !== c.id) {
            await prisma_1.prisma.learner.updateMany({
                where: { schoolId, className: c.name },
                data: { className: existing.name },
            });
            await prisma_1.prisma.parentTeacherThread.updateMany({
                where: { schoolId, classroomId: c.id },
                data: { classroomId: existing.id },
            });
            await prisma_1.prisma.classroom.delete({ where: { id: c.id } });
            classroomsMerged += 1;
        }
    }
    let threadsSynced = 0;
    for (const { id } of classroomByKey.values()) {
        const r = await (0, parentPortalService_2.syncParentThreadsForClassroom)(schoolId, id);
        threadsSynced += r.updated;
    }
    return { learnersUpdated, classroomsMerged, threadsSynced };
}
function createProjectId() {
    return `mig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function buildConfirmToken(projectId, report) {
    return `${projectId}:${report.blockingErrorCount}:${report.rowCount}`;
}
exports.MIGRATION_CSV_TEMPLATE = [
    "firstName,lastName,grade,className,admissionNo,idNumber,parentFirstName,parentSurname,parentMobile,parentEmail,teacherName,teacherEmail",
    "Jane,Doe,8,8A,ACC001,0801015009080,Mary,Doe,0821234567,mary@example.com,Mr Smith,teacher@school.co.za",
].join("\n");
