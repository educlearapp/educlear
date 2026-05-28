import fs from "fs";
import path from "path";
import { daSilvaUploadRoot } from "./daSilvaStagedPaths";

/** Upload manifest — canonical staged file paths for a Da Silva migration project. */
export type DaSilvaStagingUploadManifest = {
  schoolId: string;
  projectId: string;
  uploadedAt: string;
  sasams: {
    classLists: string[];
    learnerRegister: string | null;
    parentLearnerLinks: string | null;
    parentRegister: string | null;
  };
  kideesys: {
    billingPlanSummary: string | null;
    ageAnalysis: string | null;
    transactionList: string | null;
    contactList: string | null;
    employeeContactList: string | null;
  };
  filesSaved: string[];
};

export type DaSilvaManifestReadyResult = {
  ready: boolean;
  errors: string[];
};

const MIN_CLASS_LIST_FILES = 20;

const SLOT_FRIENDLY: Record<string, string> = {
  "sasams.classLists": "SA-SAMS class list files (at least 20 .xls/.xlsx in class lists folder)",
  "sasams.learnerRegister": "SA-SAMS Learner Register — upload learner_register.xls",
  "sasams.parentLearnerLinks": "SA-SAMS Parent Learner Links — upload parent_learner_links.xls",
  "sasams.parentRegister": "SA-SAMS Parent Register — upload parent_register.xls",
  "kideesys.billingPlanSummary": "Kid-e-Sys Billing Plan Summary — upload billing plan summary",
  "kideesys.ageAnalysis": "Kid-e-Sys Age Analysis — upload account list / age analysis",
  "kideesys.transactionList": "Kid-e-Sys Transaction List — upload 01 Transaction List",
  "kideesys.contactList":
    "Missing Kid-e-Sys Contact List. Please upload 04 Contact List into Contact List slot.",
  "kideesys.employeeContactList":
    "Missing Kid-e-Sys Employee Contact List. Please upload 06 Employees into Employee Contact List slot.",
};

export function stagingUploadManifestPath(schoolId: string, projectId: string): string {
  return path.join(daSilvaUploadRoot(schoolId, projectId), "manifest.json");
}

function isSpreadsheetName(name: string): boolean {
  return /\.xlsx?$/i.test(name);
}

function fileStatOk(filePath: string): { exists: boolean; readable: boolean; size: number } {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, readable: false, size: 0 };
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 1) {
      return { exists: true, readable: false, size: stat.size };
    }
    fs.accessSync(filePath, fs.constants.R_OK);
    fs.readFileSync(filePath, { flag: "r" });
    return { exists: true, readable: true, size: stat.size };
  } catch {
    return { exists: true, readable: false, size: 0 };
  }
}

function checkFile(
  filePath: string | null | undefined,
  slotKey: string,
  errors: string[]
): filePath is string {
  const label = SLOT_FRIENDLY[slotKey] || slotKey;
  if (!filePath) {
    errors.push(label);
    return false;
  }
  const stat = fileStatOk(filePath);
  if (!stat.exists) {
    errors.push(label);
    return false;
  }
  if (!stat.readable) {
    errors.push(`${label} (file exists but is not readable)`);
    return false;
  }
  return true;
}

/** Strict gate: every required staged file must exist and be readable. Never throws ENOENT. */
export function assertDaSilvaMigrationManifestReady(
  manifest: DaSilvaStagingUploadManifest | null | undefined
): DaSilvaManifestReadyResult {
  const errors: string[] = [];
  if (!manifest) {
    return {
      ready: false,
      errors: ["Upload manifest not found. Upload all required files to staging first."],
    };
  }

  const classLists = (manifest.sasams?.classLists || []).filter(Boolean);
  if (classLists.length < MIN_CLASS_LIST_FILES) {
    errors.push(
      SLOT_FRIENDLY["sasams.classLists"] +
        ` (found ${classLists.length}, need at least ${MIN_CLASS_LIST_FILES})`
    );
  } else {
    let readableClassLists = 0;
    for (const filePath of classLists) {
      const stat = fileStatOk(filePath);
      if (stat.exists && stat.readable && isSpreadsheetName(path.basename(filePath))) {
        readableClassLists += 1;
      }
    }
    if (readableClassLists < MIN_CLASS_LIST_FILES) {
      errors.push(
        `${readableClassLists} of ${classLists.length} class list file(s) are readable spreadsheets (need ${MIN_CLASS_LIST_FILES})`
      );
    }
  }

  checkFile(manifest.sasams?.learnerRegister, "sasams.learnerRegister", errors);
  checkFile(manifest.sasams?.parentLearnerLinks, "sasams.parentLearnerLinks", errors);
  checkFile(manifest.sasams?.parentRegister, "sasams.parentRegister", errors);
  checkFile(manifest.kideesys?.billingPlanSummary, "kideesys.billingPlanSummary", errors);
  checkFile(manifest.kideesys?.ageAnalysis, "kideesys.ageAnalysis", errors);
  checkFile(manifest.kideesys?.transactionList, "kideesys.transactionList", errors);
  checkFile(manifest.kideesys?.contactList, "kideesys.contactList", errors);
  checkFile(manifest.kideesys?.employeeContactList, "kideesys.employeeContactList", errors);

  return { ready: errors.length === 0, errors };
}

export function writeStagingUploadManifest(manifest: DaSilvaStagingUploadManifest): string {
  const filePath = stagingUploadManifestPath(manifest.schoolId, manifest.projectId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf8");
  return filePath;
}

export function loadStagingUploadManifest(
  schoolId: string,
  projectId: string
): DaSilvaStagingUploadManifest | null {
  const filePath = stagingUploadManifestPath(schoolId, projectId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as DaSilvaStagingUploadManifest;
    return raw?.schoolId && raw?.projectId ? raw : null;
  } catch {
    return null;
  }
}

export function requireStagingUploadManifest(
  schoolId: string,
  projectId: string
): DaSilvaStagingUploadManifest {
  const manifest = loadStagingUploadManifest(schoolId, projectId);
  const gate = assertDaSilvaMigrationManifestReady(manifest);
  if (!gate.ready) {
    throw new Error(gate.errors.join("; "));
  }
  return manifest!;
}

/** Resolve manifest file paths to absolute paths under process.cwd() when relative. */
export function resolveManifestFilePath(filePath: string): string {
  if (!filePath) return filePath;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

export type DaSilvaManifestResolvedPaths = {
  classListDir: string;
  classListFiles: string[];
  learnerRegister: string;
  parentLearnerLinks: string;
  parentRegister: string;
  billingPlan: string;
  ageAnalysis: string;
  transactions: string;
  contactList: string;
  employeeContactList: string;
};

export function pathsFromStagingUploadManifest(
  manifest: DaSilvaStagingUploadManifest
): DaSilvaManifestResolvedPaths {
  const classListFiles = (manifest.sasams.classLists || []).map(resolveManifestFilePath);
  const classListDir =
    classListFiles.length > 0
      ? path.dirname(classListFiles[0]!)
      : path.join(daSilvaUploadRoot(manifest.schoolId, manifest.projectId), "sasams", "class_lists");

  return {
    classListDir,
    classListFiles,
    learnerRegister: resolveManifestFilePath(manifest.sasams.learnerRegister!),
    parentLearnerLinks: resolveManifestFilePath(manifest.sasams.parentLearnerLinks!),
    parentRegister: resolveManifestFilePath(manifest.sasams.parentRegister!),
    billingPlan: resolveManifestFilePath(manifest.kideesys.billingPlanSummary!),
    ageAnalysis: resolveManifestFilePath(manifest.kideesys.ageAnalysis!),
    transactions: resolveManifestFilePath(manifest.kideesys.transactionList!),
    contactList: resolveManifestFilePath(manifest.kideesys.contactList!),
    employeeContactList: resolveManifestFilePath(manifest.kideesys.employeeContactList!),
  };
}

export type DaSilvaManifestDebugSlot = {
  slot: string;
  path: string | null;
  exists: boolean;
  readable: boolean;
  size: number;
  basename: string | null;
};

export type DaSilvaManifestDebugReport = {
  schoolId: string;
  projectId: string;
  manifestPath: string;
  manifestExists: boolean;
  manifestReady: boolean;
  manifestErrors: string[];
  uploadedAt: string | null;
  classListsCount: number;
  classListFilenames: string[];
  filesSavedCount: number;
  slots: DaSilvaManifestDebugSlot[];
};

export function buildDaSilvaManifestDebugReport(
  schoolId: string,
  projectId: string
): DaSilvaManifestDebugReport {
  const manifestPath = stagingUploadManifestPath(schoolId, projectId);
  const manifestExists = fs.existsSync(manifestPath);
  const manifest = manifestExists ? loadStagingUploadManifest(schoolId, projectId) : null;
  const gate = assertDaSilvaMigrationManifestReady(manifest);

  const slotDefs: Array<{ slot: string; path: string | null }> = [
    { slot: "sasams.classLists", path: manifest?.sasams.classLists?.[0] ?? null },
    { slot: "sasams.learnerRegister", path: manifest?.sasams.learnerRegister ?? null },
    { slot: "sasams.parentLearnerLinks", path: manifest?.sasams.parentLearnerLinks ?? null },
    { slot: "sasams.parentRegister", path: manifest?.sasams.parentRegister ?? null },
    { slot: "kideesys.billingPlanSummary", path: manifest?.kideesys.billingPlanSummary ?? null },
    { slot: "kideesys.ageAnalysis", path: manifest?.kideesys.ageAnalysis ?? null },
    { slot: "kideesys.transactionList", path: manifest?.kideesys.transactionList ?? null },
    { slot: "kideesys.contactList", path: manifest?.kideesys.contactList ?? null },
    { slot: "kideesys.employeeContactList", path: manifest?.kideesys.employeeContactList ?? null },
  ];

  const classListPaths = (manifest?.sasams.classLists || []).map(resolveManifestFilePath);
  const classListFilenames = classListPaths.map((p) => path.basename(p));

  const slots: DaSilvaManifestDebugSlot[] = slotDefs.map(({ slot, path: filePath }) => {
    if (slot === "sasams.classLists") {
      const existing = classListPaths.filter((p) => fileStatOk(p).exists);
      const readable = classListPaths.filter((p) => fileStatOk(p).readable);
      return {
        slot,
        path: classListPaths[0] || null,
        exists: existing.length > 0,
        readable: readable.length >= MIN_CLASS_LIST_FILES,
        size: existing.reduce((sum, p) => sum + fileStatOk(p).size, 0),
        basename:
          classListFilenames.length > 0
            ? `${classListFilenames.length} files (${readable.length} readable)`
            : null,
      };
    }
    const resolved = filePath ? resolveManifestFilePath(filePath) : null;
    const stat = resolved ? fileStatOk(resolved) : { exists: false, readable: false, size: 0 };
    return {
      slot,
      path: resolved,
      exists: stat.exists,
      readable: stat.readable,
      size: stat.size,
      basename: resolved ? path.basename(resolved) : null,
    };
  });

  return {
    schoolId,
    projectId,
    manifestPath,
    manifestExists,
    manifestReady: gate.ready,
    manifestErrors: gate.errors,
    uploadedAt: manifest?.uploadedAt ?? null,
    classListsCount: classListPaths.length,
    classListFilenames,
    filesSavedCount: manifest?.filesSaved?.length ?? 0,
    slots,
  };
}

export function buildStagingUploadManifestFromDisk(
  schoolId: string,
  projectId: string,
  filesSaved: string[]
): DaSilvaStagingUploadManifest {
  const root = daSilvaUploadRoot(schoolId, projectId);
  const classListDir = path.join(root, "sasams", "class_lists");
  const classLists = fs.existsSync(classListDir)
    ? fs
        .readdirSync(classListDir)
        .filter(isSpreadsheetName)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => path.resolve(classListDir, name))
    : [];

  const abs = (rel: string) => path.resolve(root, rel);

  return {
    schoolId,
    projectId,
    uploadedAt: new Date().toISOString(),
    sasams: {
      classLists,
      learnerRegister: fs.existsSync(abs("sasams/learner_register.xls"))
        ? abs("sasams/learner_register.xls")
        : null,
      parentLearnerLinks: fs.existsSync(abs("sasams/parent_learner_links.xls"))
        ? abs("sasams/parent_learner_links.xls")
        : null,
      parentRegister: fs.existsSync(abs("sasams/parent_register.xls"))
        ? abs("sasams/parent_register.xls")
        : null,
    },
    kideesys: {
      billingPlanSummary: fs.existsSync(abs("kideesys/billing_plan_summary.xls"))
        ? abs("kideesys/billing_plan_summary.xls")
        : null,
      ageAnalysis: fs.existsSync(abs("kideesys/age_analysis.xls"))
        ? abs("kideesys/age_analysis.xls")
        : null,
      transactionList: fs.existsSync(abs("kideesys/transaction_list.xls"))
        ? abs("kideesys/transaction_list.xls")
        : null,
      contactList: fs.existsSync(abs("kideesys/contact_list.xls"))
        ? abs("kideesys/contact_list.xls")
        : null,
      employeeContactList: fs.existsSync(abs("kideesys/employee_contact_list.xls"))
        ? abs("kideesys/employee_contact_list.xls")
        : null,
    },
    filesSaved,
  };
}
