import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { readSchoolBillingPlans } from "../../utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../../utils/billingLedgerStore";
import { normalizeSaPhone } from "../parentPortalService";
import {
  buildDaSilvaLearnerParseAudit,
  parseDaSilvaLearnersFromSasams,
  type DaSilvaLearnerParseAudit,
} from "../daSilvaMigration/daSilvaMigrationService";
import {
  buildSasamsLearnerProfileWriteData,
  countProfileFieldsWritten,
  mergeProfileWriteCounts,
} from "../daSilvaMigration/sasamsLearnerProfileWrite";
import {
  auditParentMatches,
  buildLearnerMatchIndexes,
  matchParentToLearner,
  type DbLearnerForParentMatch,
} from "../daSilvaMigration/daSilvaParentLearnerMatching";
import { resolveDaSilvaSasamsPaths } from "../daSilvaMigration/daSilvaMigrationStrategy";
import {
  isSasamsHrStaffRegister,
  mergeSasamsLearnerSources,
  parseSasamsClassListDirectory,
  parseSasamsLearnerRegister,
  parseSasamsParentLearnerLinks,
  parseSasamsParentRegister,
  parseSasamsParentSources,
  type SasamsParsedParent,
} from "../daSilvaMigration/sasamsParsers";

export type SasamsIngestPaths = {
  classListDir: string;
  learnerRegister: string;
  parentRegister: string;
  parentLearnerLinks: string;
};

export type SasamsSchoolDryRun = {
  passed: boolean;
  classListFiles: number;
  learnersDetected: number;
  classroomsDetected: number;
  parentsDetected: number;
  parentLinksDetected: number;
  missingLearnerId: number;
  missingDob: number;
  missingGender: number;
  unmatchedParentLinks: number;
  duplicateParentMatches: number;
  errors: string[];
  learnerParseAudit: DaSilvaLearnerParseAudit;
};

export type SasamsSchoolImportResult = {
  learnersImported: number;
  classroomsImported: number;
  parentsImported: number;
  parentLinksImported: number;
  missingLearnerId: number;
  missingDob: number;
  missingGender: number;
  dobWritten: number;
  genderWritten: number;
  idNumbersWritten: number;
  homeLanguageWritten: number;
  citizenshipWritten: number;
  profilesPopulated: boolean;
  parentsPopulated: boolean;
  auditPass: boolean;
  dryRun?: SasamsSchoolDryRun;
};

function pathExists(p: string): boolean {
  return fs.existsSync(p);
}

function firstExistingFileOptional(candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (pathExists(c)) return c;
  }
  return undefined;
}

function resolveParentLearnerLinksPath(sasamsDir: string): string {
  const direct = firstExistingFileOptional([
    path.join(sasamsDir, "parent_learner_links.xls"),
    path.join(sasamsDir, "parent_learner_links.xlsx"),
  ]);
  if (direct) return direct;

  if (!pathExists(sasamsDir)) {
    return path.join(sasamsDir, "parent_learner_links.xls");
  }

  const matches = fs
    .readdirSync(sasamsDir)
    .filter((f) => /parent_learner_links/i.test(f) && /\.xls(x)?$/i.test(f));
  if (matches.length === 1) return path.join(sasamsDir, matches[0]);
  if (matches.length > 1) {
    throw new Error(
      `Multiple parent_learner_links files in ${sasamsDir}: ${matches.join(", ")}`
    );
  }
  return path.join(sasamsDir, "parent_learner_links.xls");
}

/** Resolve SA-SAMS file paths from a Desktop folder or `.../sasams` directory. */
export function resolveSasamsIngestPaths(sourceRoot: string): SasamsIngestPaths {
  const base = sourceRoot.trim();
  const sasamsDir = pathExists(path.join(base, "sasams")) ? path.join(base, "sasams") : base;
  const core = resolveDaSilvaSasamsPaths(base);
  return {
    classListDir: core.classListDir,
    learnerRegister: core.learnerRegister,
    parentRegister: core.parentRegister,
    parentLearnerLinks: resolveParentLearnerLinksPath(sasamsDir),
  };
}

function canonicalClassroomName(className: string): string {
  const norm = normalizeClassroomInput(className);
  return norm.classroomName || className;
}

function learnerNotesFromAdmissionDate(admissionDate: Date | null | undefined): string | null {
  if (!admissionDate) return null;
  const iso = admissionDate.toISOString().slice(0, 10);
  return `Enrolment date: ${iso}`;
}

async function findExistingLearnerId(opts: {
  schoolId: string;
  firstName: string;
  lastName: string;
  className: string;
  admissionNo: string | null;
}): Promise<string | null> {
  if (opts.admissionNo) {
    const byAdm = await prisma.learner.findUnique({
      where: {
        schoolId_admissionNo: {
          schoolId: opts.schoolId,
          admissionNo: opts.admissionNo,
        },
      },
      select: { id: true },
    });
    if (byAdm) return byAdm.id;
  }
  const byName = await prisma.learner.findFirst({
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

function validateClassroomsFromFiles(classListDir: string): {
  passed: boolean;
  classrooms: number;
  classListFiles: number;
  errors: string[];
} {
  const errors: string[] = [];
  if (!pathExists(classListDir)) {
    errors.push(`Class list folder not found: ${classListDir}`);
    return { passed: false, classrooms: 0, classListFiles: 0, errors };
  }

  const { classrooms, learners } = parseSasamsClassListDirectory(classListDir);
  const rows = classrooms.map((c) => ({
    canonicalName: canonicalClassroomName(c.className),
    sourceFile: c.sourceFile,
    learnerCount: learners.filter(
      (l) => canonicalClassroomName(l.className) === canonicalClassroomName(c.className)
    ).length,
  }));

  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const norm = normalizeClassroomInput(row.canonicalName);
    const key = norm.matchKey || row.canonicalName.toLowerCase();
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }

  const duplicates = [...byKey.entries()].filter(([, list]) => list.length > 1);
  if (duplicates.length) {
    errors.push(
      `Duplicate classrooms: ${duplicates
        .map(([, list]) => `${list[0].canonicalName} (${list.map((r) => r.sourceFile).join(", ")})`)
        .join("; ")}`
    );
  }

  const empty = rows.filter((r) => r.learnerCount === 0);
  if (empty.length) {
    errors.push(`Empty class files (0 learners): ${empty.map((r) => r.sourceFile).join(", ")}`);
  }

  if (learners.length === 0) {
    errors.push("No learners parsed from SA-SAMS class lists");
  }
  if (rows.length === 0) {
    errors.push("No classrooms parsed from SA-SAMS class lists");
  }

  return {
    passed: errors.length === 0,
    classrooms: new Set(rows.map((r) => r.canonicalName)).size,
    classListFiles: rows.length,
    errors,
  };
}

export function dryRunSasamsSchoolImport(paths: SasamsIngestPaths): SasamsSchoolDryRun {
  const errors: string[] = [];

  const classroomCheck = validateClassroomsFromFiles(paths.classListDir);
  errors.push(...classroomCheck.errors);

  if (!pathExists(paths.learnerRegister)) {
    errors.push(`SA-SAMS learner register not found: ${paths.learnerRegister}`);
  }
  if (!pathExists(paths.parentRegister)) {
    errors.push(`SA-SAMS parent register not found: ${paths.parentRegister}`);
  }
  if (!pathExists(paths.parentLearnerLinks)) {
    errors.push(`SA-SAMS parent_learner_links not found: ${paths.parentLearnerLinks}`);
  }
  const parentRegisterIsHrStaff =
    pathExists(paths.parentRegister) && isSasamsHrStaffRegister(paths.parentRegister);

  const auditHolder: { audit: DaSilvaLearnerParseAudit } = {
    audit: {
      classListParsed: 0,
      registerParsed: 0,
      mergedTotal: 0,
      enrichedFromRegister: 0,
      registerOnlySkipped: 0,
      missingDob: 0,
      missingGender: 0,
      missingId: 0,
      perClassroomCounts: [],
    },
  };

  if (pathExists(paths.learnerRegister) && classroomCheck.passed) {
    parseDaSilvaLearnersFromSasams(
      {
        classListDir: paths.classListDir,
        learnerRegister: paths.learnerRegister,
        parentRegister: paths.parentRegister,
      },
      auditHolder
    );
  } else {
    const { learners } = parseSasamsClassListDirectory(paths.classListDir);
    auditHolder.audit = buildDaSilvaLearnerParseAudit(learners, learners, {
      classListParsed: learners.length,
      registerParsed: 0,
      mergedTotal: learners.length,
      enrichedFromRegister: 0,
      registerOnlySkipped: 0,
    });
  }

  const registerCount =
    pathExists(paths.parentRegister) && !parentRegisterIsHrStaff
      ? parseSasamsParentRegister(paths.parentRegister).length
      : 0;
  const linksCount = pathExists(paths.parentLearnerLinks)
    ? parseSasamsParentLearnerLinks(paths.parentLearnerLinks).length
    : 0;
  const combinedParents = pathExists(paths.parentRegister)
    ? parseSasamsParentSources(paths.parentRegister, paths.parentLearnerLinks)
    : [];

  const stagingLearners: DbLearnerForParentMatch[] = parseDaSilvaLearnersFromSasams({
    classListDir: paths.classListDir,
    learnerRegister: paths.learnerRegister,
    parentRegister: paths.parentRegister,
  }).map((r) => ({
    id: r.matchKey,
    firstName: r.firstName,
    lastName: r.lastName,
    className: r.canonicalClassName,
    admissionNo: r.admissionNo,
    idNumber: r.idNumber,
  }));

  let unmatchedParentLinks = 0;
  let duplicateParentMatches = 0;
  if (combinedParents.length > 0) {
    if (stagingLearners.length === 0) {
      errors.push("No parsed learners available to match parent links");
    } else {
      const parentAudit = auditParentMatches(combinedParents, stagingLearners);
      unmatchedParentLinks = parentAudit.unmatchedParents.length;
      duplicateParentMatches = parentAudit.duplicateMatches.length;
      if (duplicateParentMatches > 0) {
        errors.push(`${duplicateParentMatches} parent row(s) have ambiguous learner matches`);
      }
      if (unmatchedParentLinks > 0) {
        errors.push(`${unmatchedParentLinks} parent link row(s) could not be matched to learners`);
      }
    }
  } else if (!pathExists(paths.parentLearnerLinks)) {
    errors.push("No parent rows parsed — parent_learner_links file is required");
  } else {
    errors.push("No parent rows parsed from parent_learner_links");
  }

  const parentsDetected = new Set(
    combinedParents.map((p) => `${p.firstName}|${p.surname}|${p.cellNo}|${p.idNumber || ""}`)
  ).size;

  const passed = errors.length === 0;

  return {
    passed,
    classListFiles: classroomCheck.classListFiles,
    learnersDetected: auditHolder.audit.mergedTotal,
    classroomsDetected: classroomCheck.classrooms,
    parentsDetected,
    parentLinksDetected: combinedParents.length,
    missingLearnerId: auditHolder.audit.missingId,
    missingDob: auditHolder.audit.missingDob,
    missingGender: auditHolder.audit.missingGender,
    unmatchedParentLinks,
    duplicateParentMatches,
    errors,
    learnerParseAudit: auditHolder.audit,
  };
}

async function assertSchoolReadyForSasamsImport(schoolId: string): Promise<void> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  if (readSchoolLedger(schoolId).length > 0) {
    throw new Error("BLOCKED: billing ledger already has entries — SA-SAMS import is profile-only");
  }
  if (Object.keys(readSchoolBillingPlans(schoolId)).length > 0) {
    throw new Error("BLOCKED: learner billing plans already exist — run Kid-e-Sys billing separately");
  }
}

async function auditImportedSchool(schoolId: string, dryRun: SasamsSchoolDryRun): Promise<{
  profilesPopulated: boolean;
  parentsPopulated: boolean;
  auditPass: boolean;
}> {
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
      gender: true,
      idNumber: true,
      birthDate: true,
      homeLanguage: true,
      citizenship: true,
    },
  });

  const parents = await prisma.parent.findMany({
    where: { schoolId },
    select: {
      firstName: true,
      surname: true,
      cellNo: true,
      email: true,
      idNumber: true,
      familyAccountId: true,
    },
  });

  const ledgerCount = readSchoolLedger(schoolId).length;
  const planCount = Object.keys(readSchoolBillingPlans(schoolId)).length;
  const familyAccounts = await prisma.familyAccount.count({ where: { schoolId } });

  const profilesPopulated =
    learners.length === dryRun.learnersDetected &&
    learners.every((l) => l.firstName && l.lastName && l.className && l.grade) &&
    learners.filter((l) => !l.gender).length === dryRun.missingGender &&
    learners.filter((l) => !l.birthDate).length === dryRun.missingDob &&
    learners.filter((l) => !l.idNumber).length === dryRun.missingLearnerId;

  const parentsPopulated =
    parents.length > 0 &&
    parents.every((p) => p.firstName && p.surname && p.cellNo) &&
    parents.every((p) => p.familyAccountId == null);

  const auditPass =
    dryRun.passed &&
    profilesPopulated &&
    parentsPopulated &&
    ledgerCount === 0 &&
    planCount === 0 &&
    familyAccounts === 0;

  return { profilesPopulated, parentsPopulated, auditPass };
}

export async function importSasamsSchoolData(opts: {
  schoolId: string;
  paths: SasamsIngestPaths;
  dryRunOnly?: boolean;
  allowExistingLearners?: boolean;
}): Promise<SasamsSchoolImportResult> {
  const dryRun = dryRunSasamsSchoolImport(opts.paths);

  if (opts.dryRunOnly) {
    return {
      learnersImported: 0,
      classroomsImported: 0,
      parentsImported: 0,
      parentLinksImported: 0,
      missingLearnerId: dryRun.missingLearnerId,
      missingDob: dryRun.missingDob,
      missingGender: dryRun.missingGender,
      dobWritten: 0,
      genderWritten: 0,
      idNumbersWritten: 0,
      homeLanguageWritten: 0,
      citizenshipWritten: 0,
      profilesPopulated: false,
      parentsPopulated: false,
      auditPass: dryRun.passed,
      dryRun,
    };
  }

  if (!dryRun.passed) {
    throw new Error(`SA-SAMS validation failed: ${dryRun.errors.join("; ")}`);
  }

  await assertSchoolReadyForSasamsImport(opts.schoolId);

  const existingLearners = await prisma.learner.count({ where: { schoolId: opts.schoolId } });
  const existingParents = await prisma.parent.count({ where: { schoolId: opts.schoolId } });
  if (!opts.allowExistingLearners && (existingLearners > 0 || existingParents > 0)) {
    throw new Error(
      `BLOCKED: school already has ${existingLearners} learner(s) and ${existingParents} parent(s). Run school-data-cleanup.ts --apply first.`
    );
  }

  const { classrooms } = parseSasamsClassListDirectory(opts.paths.classListDir);
  const classroomRows = classrooms.map((c) => ({
    canonicalName: canonicalClassroomName(c.className),
  }));

  const seenClassrooms = new Set<string>();
  for (const row of classroomRows) {
    if (seenClassrooms.has(row.canonicalName)) continue;
    seenClassrooms.add(row.canonicalName);
    await prisma.classroom.upsert({
      where: { schoolId_name: { schoolId: opts.schoolId, name: row.canonicalName } },
      create: { schoolId: opts.schoolId, name: row.canonicalName },
      update: {},
    });
  }
  const classroomsImported = seenClassrooms.size;

  const dbClassroomNames = new Set(
    (
      await prisma.classroom.findMany({
        where: { schoolId: opts.schoolId },
        select: { name: true },
      })
    ).map((c) => c.name)
  );

  const auditHolder: { audit: DaSilvaLearnerParseAudit } = {
    audit: {
      classListParsed: 0,
      registerParsed: 0,
      mergedTotal: 0,
      enrichedFromRegister: 0,
      registerOnlySkipped: 0,
      missingDob: 0,
      missingGender: 0,
      missingId: 0,
      perClassroomCounts: [],
    },
  };

  const learnerRows = parseDaSilvaLearnersFromSasams(
    {
      classListDir: opts.paths.classListDir,
      learnerRegister: opts.paths.learnerRegister,
      parentRegister: opts.paths.parentRegister,
    },
    auditHolder
  );

  const { learners: classListLearners } = parseSasamsClassListDirectory(opts.paths.classListDir);
  const registerLearners = parseSasamsLearnerRegister(opts.paths.learnerRegister);
  const mergedForDates = mergeSasamsLearnerSources(classListLearners, registerLearners, {
    classListParsed: classListLearners.length,
    registerParsed: registerLearners.length,
    mergedTotal: 0,
    enrichedFromRegister: 0,
    registerOnlySkipped: 0,
  });
  const admissionByMatchKey = new Map(
    mergedForDates.map((l) => [l.matchKey, l.admissionDate] as const)
  );

  let fieldWrites = {
    dobWritten: 0,
    genderWritten: 0,
    idNumbersWritten: 0,
    homeLanguageWritten: 0,
    citizenshipWritten: 0,
  };

  for (const row of learnerRows) {
    if (!dbClassroomNames.has(row.canonicalClassName)) {
      throw new Error(`Classroom "${row.canonicalClassName}" missing after classroom import`);
    }

    const norm = normalizeClassroomInput(row.canonicalClassName);
    const notes = learnerNotesFromAdmissionDate(admissionByMatchKey.get(row.matchKey) ?? null);

    let learnerId = await findExistingLearnerId({
      schoolId: opts.schoolId,
      firstName: row.firstName,
      lastName: row.lastName,
      className: row.canonicalClassName,
      admissionNo: row.admissionNo,
    });

    const learnerData = {
      schoolId: opts.schoolId,
      firstName: row.firstName,
      lastName: row.lastName,
      grade: row.grade || norm.gradeLabel || "",
      className: row.canonicalClassName,
      notes,
      enrollmentStatus: "ACTIVE" as const,
      totalFee: 0,
      tuitionFee: 0,
    };

    if (learnerId) {
      const existing = await prisma.learner.findUnique({
        where: { id: learnerId },
        select: {
          admissionNo: true,
          idNumber: true,
          birthDate: true,
          gender: true,
          homeLanguage: true,
          citizenship: true,
        },
      });
      const profileData = buildSasamsLearnerProfileWriteData(
        {
          admissionNo: row.admissionNo,
          idNumber: row.idNumber,
          birthDate: row.birthDate,
          gender: row.gender,
          homeLanguage: row.homeLanguage,
          citizenship: row.citizenship,
        },
        existing || undefined
      );
      fieldWrites = mergeProfileWriteCounts(fieldWrites, countProfileFieldsWritten(profileData));
      await prisma.learner.update({
        where: { id: learnerId },
        data: { ...learnerData, ...profileData },
      });
    } else {
      const profileData = buildSasamsLearnerProfileWriteData({
        admissionNo: row.admissionNo,
        idNumber: row.idNumber,
        birthDate: row.birthDate,
        gender: row.gender,
        homeLanguage: row.homeLanguage,
        citizenship: row.citizenship,
      });
      fieldWrites = mergeProfileWriteCounts(fieldWrites, countProfileFieldsWritten(profileData));
      const created = await prisma.learner.create({ data: { ...learnerData, ...profileData } });
      learnerId = created.id;
    }

  }

  const learnersImported = await prisma.learner.count({ where: { schoolId: opts.schoolId } });

  const dbLearners = await prisma.learner.findMany({
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
  const learnersById = new Map(dbLearners.map((l) => [l.id, l]));
  const indexes = buildLearnerMatchIndexes(dbLearners);

  const sasamsParents = parseSasamsParentSources(
    opts.paths.parentRegister,
    opts.paths.parentLearnerLinks
  );

  const parentIds = new Set<string>();
  let parentLinksImported = 0;

  for (const parentRow of sasamsParents) {
    const match = matchParentToLearner(parentRow, indexes, learnersById);
    if (!match.learnerId || match.ambiguous) continue;

    const parentId = await upsertSasamsParent(opts.schoolId, parentRow);
    parentIds.add(parentId);

    await prisma.parentLearnerLink.upsert({
      where: { parentId_learnerId: { parentId, learnerId: match.learnerId } },
      create: {
        schoolId: opts.schoolId,
        parentId,
        learnerId: match.learnerId,
        relation: parentRow.relation,
        isPrimary: true,
      },
      update: { relation: parentRow.relation },
    });
    parentLinksImported += 1;
  }

  const postAudit = await auditImportedSchool(opts.schoolId, dryRun);

  return {
    learnersImported,
    classroomsImported,
    parentsImported: parentIds.size,
    parentLinksImported,
    missingLearnerId: dryRun.missingLearnerId,
    missingDob: dryRun.missingDob,
    missingGender: dryRun.missingGender,
    dobWritten: fieldWrites.dobWritten,
    genderWritten: fieldWrites.genderWritten,
    idNumbersWritten: fieldWrites.idNumbersWritten,
    homeLanguageWritten: fieldWrites.homeLanguageWritten,
    citizenshipWritten: fieldWrites.citizenshipWritten,
    profilesPopulated: postAudit.profilesPopulated,
    parentsPopulated: postAudit.parentsPopulated,
    auditPass: postAudit.auditPass,
    dryRun,
  };
}

async function upsertSasamsParent(schoolId: string, parentRow: SasamsParsedParent): Promise<string> {
  const digitsOnly = (value: string | null | undefined): string =>
    String(value || "").replace(/\D/g, "");
  const cleanedIdDigits = digitsOnly(parentRow.idNumber);
  const cleanedIdNumber = cleanedIdDigits.length >= 13 ? cleanedIdDigits.slice(0, 13) : null;

  const phone = normalizeSaPhone(parentRow.cellNo || parentRow.homeNo || "");
  const cellNo = phone?.localCell || parentRow.cellNo || "0000000000";

  if (cleanedIdNumber) {
    const byId = await prisma.parent.findFirst({
      where: { schoolId, idNumber: cleanedIdNumber, familyAccountId: null },
      select: { id: true },
    });
    if (byId) {
      await prisma.parent.update({
        where: { id: byId.id },
        data: {
          email: parentRow.email || undefined,
          cellNo: cellNo && cellNo !== "0000000000" ? cellNo : undefined,
          idNumber: cleanedIdNumber,
          relationship: parentRow.relation,
          workNo: parentRow.workNo || undefined,
          homeNo: parentRow.homeNo || undefined,
          outstandingAmount: 0,
        },
      });
      return byId.id;
    }
  }

  if (parentRow.email) {
    const byEmail = await prisma.parent.findFirst({
      where: { schoolId, email: parentRow.email, familyAccountId: null },
      select: { id: true },
    });
    if (byEmail) {
      await prisma.parent.update({
        where: { id: byEmail.id },
        data: {
          idNumber: cleanedIdNumber || undefined,
          cellNo: cellNo && cellNo !== "0000000000" ? cellNo : undefined,
          relationship: parentRow.relation,
          workNo: parentRow.workNo || undefined,
          homeNo: parentRow.homeNo || undefined,
          outstandingAmount: 0,
        },
      });
      return byEmail.id;
    }
  }

  const existingParent = await prisma.parent.findFirst({
    where: {
      schoolId,
      firstName: parentRow.firstName,
      surname: parentRow.surname,
      cellNo,
      familyAccountId: null,
    },
    select: { id: true },
  });

  if (existingParent) {
    await prisma.parent.update({
      where: { id: existingParent.id },
      data: {
        email: parentRow.email || null,
        idNumber: cleanedIdNumber,
        relationship: parentRow.relation,
        workNo: parentRow.workNo || null,
        homeNo: parentRow.homeNo || null,
        outstandingAmount: 0,
      },
    });
    return existingParent.id;
  }

  const created = await prisma.parent.create({
    data: {
      schoolId,
      familyAccountId: null,
      firstName: parentRow.firstName,
      surname: parentRow.surname,
      cellNo,
      email: parentRow.email || null,
      idNumber: cleanedIdNumber,
      relationship: parentRow.relation,
      workNo: parentRow.workNo || null,
      homeNo: parentRow.homeNo || null,
      outstandingAmount: 0,
    },
    select: { id: true },
  });
  return created.id;
}
