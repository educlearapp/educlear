import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
import {
  DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
  DA_SILVA_BILLING_MATCH_MIN_MATCHED,
  DA_SILVA_BILLING_MATCH_MIN_RATIO,
} from "./daSilvaMigrationStrategy";
import {
  DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
  DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
} from "./daSilvaConstants";
import {
  auditParentMatches,
  type DbLearnerForParentMatch,
} from "./daSilvaParentLearnerMatching";
import { matchKideesysBillingAccountsWithSecondPass } from "./daSilvaKideesysBillingMatch";
import {
  parseAgeAnalysisFile,
  parseAgeAnalysisFileWithAudit,
  parseBillingPlanFile,
  parseContactListFile,
  parseTransactionListFile,
} from "./parsers";
import { formatKideesysBillingReconciliationReportText } from "./daSilvaKideesysBillingReconciliationReport";
import {
  pathsFromStagingUploadManifest,
  requireStagingUploadManifest,
  type DaSilvaManifestResolvedPaths,
} from "./daSilvaUploadManifest";
import {
  buildDaSilvaLearnerParseAudit,
  parseDaSilvaLearnersFromSasams,
  validateDaSilvaBillingStaging,
  validateDaSilvaClassroomsFromKidESys,
  type DaSilvaLearnerParseAudit,
  type DaSilvaClassroomValidation,
} from "./daSilvaMigrationService";
import {
  detectSasamsClassListHeaders,
  parseSasamsClassListDirectory,
  isSasamsHrStaffRegister,
  parseSasamsParentLearnerLinks,
  parseSasamsParentRegister,
  parseSasamsParentSources,
  sasamsLearnersToParsedLearners,
} from "./sasamsParsers";
import { buildLearnerMatchKey } from "./parsers";

export type DaSilvaSasamsClassesLearnersPreview = {
  success: boolean;
  passed: boolean;
  headerDetection: ReturnType<typeof detectSasamsClassListHeaders>;
  classroomValidation: DaSilvaClassroomValidation;
  learnerParseAudit: DaSilvaLearnerParseAudit;
  learnersPerClass: Array<{ classroomName: string; count: number }>;
  sasamsClassListLearners: number;
  expectedSasamsLearners: number;
  crecheSupplementExpected: number;
  finalLearnersExpected: number;
  totalLearners: number;
  missingId: number;
  missingDob: number;
  missingGender: number;
  classListFilesFound: string[];
  debug: {
    classListFilesFound: number;
    learnersParsedPerClass: Array<{ classroomName: string; count: number }>;
    missingDob: number;
    missingId: number;
    missingGender: number;
  };
  errors: string[];
};

export type DaSilvaSasamsParentsLinksPreview = {
  success: boolean;
  passed: boolean;
  parentRegisterRows: number;
  parentLinksRows: number;
  combinedParentRows: number;
  matchedLinks: number;
  unmatchedParents: number;
  duplicateMatches: number;
  expectedParentLinks: number;
  sampleUnmatched: Array<{
    parentFirstName: string;
    parentSurname: string;
    learnerName: string | null;
    learnerAdmissionNo: string | null;
    learnerClassName: string | null;
  }>;
  debug: {
    parentLinkRowsParsed: number;
    parentRegisterRowsParsed: number;
    parentLinksMatched: number;
    parentLinksUnmatched: number;
    sampleUnmatched: DaSilvaSasamsParentsLinksPreview["sampleUnmatched"];
  };
  errors: string[];
};

export type DaSilvaKideesysBillingMatchPreview = {
  success: boolean;
  passed: boolean;
  totalAccounts: number;
  matchedAccounts: number;
  unmatchedAccounts: number;
  matchRatio: number;
  minRatioRequired: number;
  maxUnmatchedAllowed: number;
  sampleUnmatched: Array<{ accountNo: string; fullName: string }>;
  debug: {
    billingAccountsParsed: number;
    billingAccountsMatched: number;
    billingAccountsUnmatched: number;
    firstPassMatched?: number;
    secondPassAutoMatched?: number;
    manualReviewRequired?: number;
    reconciliationReportPath?: string;
    sampleUnmatched: Array<{ accountNo: string; fullName: string }>;
  };
  errors: string[];
};

export type DaSilvaBillingImportPreview = {
  success: boolean;
  passed: boolean;
  stagingValidation: ReturnType<typeof validateDaSilvaBillingStaging>;
  transactionRowCount: number;
  transactionParseErrors: string[];
  errors: string[];
};

function sasamsPathsFromManifest(staged: DaSilvaManifestResolvedPaths) {
  return {
    classListDir: staged.classListDir,
    learnerRegister: staged.learnerRegister,
    parentRegister: staged.parentRegister,
  };
}

function learnersForParentPreview(
  staged: DaSilvaManifestResolvedPaths,
  schoolId?: string
): Promise<DbLearnerForParentMatch[]> {
  return (async () => {
    if (schoolId) {
      const db = await prisma.learner.findMany({
        where: { schoolId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          className: true,
          admissionNo: true,
          idNumber: true,
        },
      });
      if (db.length > 0) return db;
    }
    const rows = parseDaSilvaLearnersFromSasams(sasamsPathsFromManifest(staged));
    return rows.map((r) => ({
      id: r.matchKey,
      firstName: r.firstName,
      lastName: r.lastName,
      className: r.canonicalClassName,
      admissionNo: r.admissionNo,
      idNumber: r.idNumber,
    }));
  })();
}

/** Parent link rows expected from parent_learner_links.xls (Da Silva Academy). */
export { DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT } from "./daSilvaConstants";

export async function previewDaSilvaSasamsClassesLearners(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaSasamsClassesLearnersPreview> {
  const uploadManifest = requireStagingUploadManifest(opts.schoolId, opts.projectId);
  const staged = pathsFromStagingUploadManifest(uploadManifest);
  const errors: string[] = [];

  const classListFilesFound = staged.classListFiles
    .map((p) => path.basename(p))
    .sort();

  const { classrooms, learners: parsedClassListLearners } = parseSasamsClassListDirectory(
    staged.classListDir
  );
  const perClassCountsMap = new Map<string, number>();
  for (const learner of parsedClassListLearners) {
    const name = learner.canonicalClassName || learner.className;
    perClassCountsMap.set(name, (perClassCountsMap.get(name) || 0) + 1);
  }
  const perClassCounts = Array.from(perClassCountsMap.entries())
    .map(([classroomName, count]) => ({ classroomName, count }))
    .sort((a, b) => a.classroomName.localeCompare(b.classroomName));

  console.log("[sasams-preview]", {
    classListFiles: classListFilesFound.length,
    parsedLearners: parsedClassListLearners.length,
    classrooms: classrooms.length,
    perClassCounts,
  });

  const headerDetection = detectSasamsClassListHeaders(staged.classListDir);
  if (!headerDetection.files.length) {
    errors.push("No class list files with detectable SA-SAMS headers");
  }
  if (parsedClassListLearners.length === 0) {
    errors.push("No learners parsed from staged SA-SAMS class lists");
  }

  const classroomValidation = validateDaSilvaClassroomsFromKidESys(staged.classListDir);
  errors.push(...classroomValidation.errors);

  let learnerParseAudit: DaSilvaLearnerParseAudit = {
    classListParsed: parsedClassListLearners.length,
    registerParsed: 0,
    mergedTotal: 0,
    enrichedFromRegister: 0,
    registerOnlySkipped: 0,
    missingDob: 0,
    missingGender: 0,
    missingId: 0,
    perClassroomCounts: [],
  };

  if (fs.existsSync(staged.learnerRegister)) {
    const auditHolder = { audit: learnerParseAudit };
    parseDaSilvaLearnersFromSasams(
      {
        ...sasamsPathsFromManifest(staged),
        learnerRegister: staged.learnerRegister,
      },
      auditHolder
    );
    learnerParseAudit = auditHolder.audit;
  } else {
    learnerParseAudit = buildDaSilvaLearnerParseAudit(
      parsedClassListLearners,
      parsedClassListLearners,
      {
        classListParsed: parsedClassListLearners.length,
        registerParsed: 0,
        mergedTotal: parsedClassListLearners.length,
        enrichedFromRegister: 0,
        registerOnlySkipped: 0,
      }
    );
    errors.push("learner_register.xls not uploaded — ID/DOB/gender enrichment unavailable");
  }

  const sasamsCount = learnerParseAudit.classListParsed;
  if (sasamsCount !== DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
    errors.push(
      `Expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS class-list learners, parsed ${sasamsCount}`
    );
  }

  if (fs.existsSync(staged.learnerRegister)) {
    if (learnerParseAudit.missingDob > 0) {
      errors.push(
        `DOB missing on ${learnerParseAudit.missingDob}/${learnerParseAudit.mergedTotal} learners after register merge (expected 0)`
      );
    }
    if (learnerParseAudit.missingGender > 0) {
      errors.push(
        `Gender missing on ${learnerParseAudit.missingGender}/${learnerParseAudit.mergedTotal} learners after register merge (expected 0)`
      );
    }
  }

  const passed =
    errors.length === 0 &&
    sasamsCount === DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT &&
    parsedClassListLearners.length === DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT &&
    (!fs.existsSync(staged.learnerRegister) ||
      (learnerParseAudit.missingDob === 0 && learnerParseAudit.missingGender === 0));

  return {
    success: true,
    passed,
    headerDetection,
    classroomValidation,
    learnerParseAudit,
    learnersPerClass: learnerParseAudit.perClassroomCounts,
    sasamsClassListLearners: sasamsCount,
    expectedSasamsLearners: DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
    crecheSupplementExpected: DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
    finalLearnersExpected: DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
    totalLearners: learnerParseAudit.mergedTotal,
    missingId: learnerParseAudit.missingId,
    missingDob: learnerParseAudit.missingDob,
    missingGender: learnerParseAudit.missingGender,
    classListFilesFound,
    debug: {
      classListFilesFound: classListFilesFound.length,
      learnersParsedPerClass: perClassCounts,
      missingDob: learnerParseAudit.missingDob,
      missingId: learnerParseAudit.missingId,
      missingGender: learnerParseAudit.missingGender,
    },
    errors,
  };
}

export async function previewDaSilvaSasamsParentsLinks(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaSasamsParentsLinksPreview> {
  const uploadManifest = requireStagingUploadManifest(opts.schoolId, opts.projectId);
  const staged = pathsFromStagingUploadManifest(uploadManifest);
  const errors: string[] = [];

  const parentRegisterPath = staged.parentRegister;
  const parentLearnerLinksPath = staged.parentLearnerLinks;
  const registerCount =
    !isSasamsHrStaffRegister(parentRegisterPath)
      ? parseSasamsParentRegister(parentRegisterPath).length
      : 0;
  const linksCount = parseSasamsParentLearnerLinks(parentLearnerLinksPath).length;
  const combined = parseSasamsParentSources(parentRegisterPath, parentLearnerLinksPath);

  const learners = await learnersForParentPreview(staged, opts.schoolId);
  if (!learners.length) {
    errors.push("No learners available for parent matching — upload class lists or import learners");
  }

  const audit = auditParentMatches(combined, learners);
  const matchedLinks = audit.rows.filter((r) => r.matched).length;

  if (combined.length === 0) {
    errors.push("No parent link rows parsed from parent_register or parent_learner_links");
  }
  if (matchedLinks === 0 && combined.length > 0) {
    errors.push("Parent link matches = 0 — check parent_learner_links.xls parsing");
  }
  if (audit.unmatchedParents.length > DA_SILVA_BILLING_MATCH_MAX_UNMATCHED) {
    errors.push(
      `${audit.unmatchedParents.length} parent row(s) could not be matched to learners (max ${DA_SILVA_BILLING_MATCH_MAX_UNMATCHED})`
    );
  }
  if (audit.duplicateMatches.length > 0) {
    errors.push(`${audit.duplicateMatches.length} parent row(s) have ambiguous learner matches`);
  }

  const sampleUnmatched = audit.unmatchedParents.slice(0, 12).map((r) => ({
    parentFirstName: r.parentFirstName,
    parentSurname: r.parentSurname,
    learnerName: r.learnerName,
    learnerAdmissionNo: r.learnerAdmissionNo,
    learnerClassName: r.learnerClassName,
  }));

  const passed = errors.length === 0 && matchedLinks > 0;

  return {
    success: true,
    passed,
    parentRegisterRows: registerCount,
    parentLinksRows: linksCount,
    combinedParentRows: combined.length,
    matchedLinks,
    unmatchedParents: audit.unmatchedParents.length,
    duplicateMatches: audit.duplicateMatches.length,
    expectedParentLinks: DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
    sampleUnmatched,
    debug: {
      parentLinkRowsParsed: linksCount,
      parentRegisterRowsParsed: registerCount,
      parentLinksMatched: matchedLinks,
      parentLinksUnmatched: audit.unmatchedParents.length,
      sampleUnmatched,
    },
    errors,
  };
}

export async function previewDaSilvaKideesysBillingMatch(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaKideesysBillingMatchPreview> {
  const uploadManifest = requireStagingUploadManifest(opts.schoolId, opts.projectId);
  const staged = pathsFromStagingUploadManifest(uploadManifest);
  const errors: string[] = [];
  const ageParsed = parseAgeAnalysisFileWithAudit(staged.ageAnalysis);
  if (!ageParsed.accounts.length) {
    errors.push("Age analysis parser produced 0 accounts");
  }
  if (ageParsed.audit.headerRowIndex === null) {
    errors.push("Age analysis parser could not detect header row");
  }
  const accounts = ageParsed.accounts;
  const { learners: sasamsClassLearners } = parseSasamsClassListDirectory(staged.classListDir);
  const classListLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);

  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: opts.schoolId },
    select: { id: true, firstName: true, lastName: true, className: true, admissionNo: true, idNumber: true },
  });

  const dbForMatch =
    dbLearners.length > 0
      ? dbLearners.map((l) => ({
          id: l.id,
          firstName: l.firstName,
          lastName: l.lastName,
          className: l.className,
          matchKey: buildLearnerMatchKey(`${l.firstName} ${l.lastName}`, l.className || ""),
          idNumber: l.idNumber,
          admissionNo: l.admissionNo,
        }))
      : parseDaSilvaLearnersFromSasams(sasamsPathsFromManifest(staged)).map((r) => ({
          id: r.matchKey,
          firstName: r.firstName,
          lastName: r.lastName,
          className: r.canonicalClassName,
          matchKey: r.matchKey,
          idNumber: r.idNumber,
          admissionNo: r.admissionNo,
        }));

  if (!dbForMatch.length) {
    errors.push("No learners for billing match — complete SA-SAMS learner preview first");
  }

  const billingPlanItems = parseBillingPlanFile(staged.billingPlan);
  const transactions = parseTransactionListFile(staged.transactions);
  const contacts = parseContactListFile(staged.contactList);

  const { audit, report } = matchKideesysBillingAccountsWithSecondPass({
    accounts,
    dbLearners: dbForMatch,
    classListLearners,
    mergedFamilyAccountNos: [],
    billingPlanItems,
    transactions,
    contacts,
  });

  const matchedAccounts = audit.matched.filter((r) => r.learnerId).length;
  const unmatchedAccounts = audit.unmatchedAccounts.length;
  const totalAccounts = accounts.length;
  const matchRatio = totalAccounts > 0 ? matchedAccounts / totalAccounts : 0;

  const sampleUnmatched = audit.unmatchedAccounts.slice(0, 12).map((r) => ({
    accountNo: r.accountNo,
    fullName: r.fullName,
  }));

  if (matchedAccounts < DA_SILVA_BILLING_MATCH_MIN_MATCHED) {
    errors.push(
      `Billing match too low: ${matchedAccounts}/${totalAccounts} (need at least ${DA_SILVA_BILLING_MATCH_MIN_MATCHED}); review reconciliation report`
    );
  }
  const reportPath = path.join(process.cwd(), "kideesys-billing-reconciliation-report.txt");
  fs.writeFileSync(
    reportPath,
    formatKideesysBillingReconciliationReportText(report, opts.schoolId)
  );

  const passed = errors.length === 0;

  console.log("[billing-match-preview]", {
    totalAccounts,
    matchedAccounts,
    firstPassMatched: report.firstPassMatched,
    secondPassAutoMatched: report.secondPassAutoMatched,
    unmatchedAccounts,
    manualReview: report.manualReviewRequired.length,
    matchRatio,
    reconciliationReport: reportPath,
    sampleUnmatched: sampleUnmatched.slice(0, 5),
  });

  return {
    success: true,
    passed,
    totalAccounts,
    matchedAccounts,
    unmatchedAccounts,
    matchRatio,
    minRatioRequired: DA_SILVA_BILLING_MATCH_MIN_RATIO,
    maxUnmatchedAllowed: DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
    sampleUnmatched,
    debug: {
      billingAccountsParsed: totalAccounts,
      billingAccountsMatched: matchedAccounts,
      billingAccountsUnmatched: unmatchedAccounts,
      firstPassMatched: report.firstPassMatched,
      secondPassAutoMatched: report.secondPassAutoMatched,
      manualReviewRequired: report.manualReviewRequired.length,
      reconciliationReportPath: reportPath,
      sampleUnmatched,
    },
    errors,
  };
}

export async function previewDaSilvaBillingImport(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaBillingImportPreview> {
  const uploadManifest = requireStagingUploadManifest(opts.schoolId, opts.projectId);
  const staged = pathsFromStagingUploadManifest(uploadManifest);
  const errors: string[] = [];
  const transactionParseErrors: string[] = [];
  let transactionRowCount = 0;

  try {
    const txns = parseTransactionListFile(staged.transactions);
    transactionRowCount = txns.length;
    if (transactionRowCount < 1) {
      transactionParseErrors.push("Transaction list parsed 0 rows");
    }
  } catch (e: unknown) {
    transactionParseErrors.push(e instanceof Error ? e.message : "Failed to parse transaction list");
  }

  const stagingValidation = validateDaSilvaBillingStaging({
    classListDir: staged.classListDir,
    billingPlan: staged.billingPlan,
    ageAnalysis: staged.ageAnalysis,
  });

  errors.push(...stagingValidation.errors);
  errors.push(...transactionParseErrors);

  const passed = errors.length === 0 && stagingValidation.passed;

  return {
    success: true,
    passed,
    stagingValidation,
    transactionRowCount,
    transactionParseErrors,
    errors,
  };
}
