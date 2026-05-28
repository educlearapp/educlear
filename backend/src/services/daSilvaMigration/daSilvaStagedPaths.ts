import fs from "fs";
import path from "path";
import {
  assertDaSilvaMigrationManifestReady,
  loadStagingUploadManifest,
  stagingUploadManifestPath,
} from "./daSilvaUploadManifest";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

export const DA_SILVA_CONTACT_LIST_MISSING_MESSAGE =
  "Kid-e-Sys contact list was not uploaded. Please upload 04 Contact List into the Contact List slot.";

const DA_SILVA_CONTACT_LIST_UPLOAD_FIELDS = new Set([
  "contactList",
  "contact_list",
  "contactListFile",
  "kidEsyContactList",
  "kideesysContactList",
]);

export type DaSilvaStagedUploadSlots = {
  classListDir: string;
  learnerRegister: string;
  parentLearnerLinks: string;
  parentRegister: string;
  contactList: string;
  employeeContactList: string;
  billingPlan: string;
  ageAnalysis: string;
  transactions: string;
};

export type DaSilvaStagedUploadStatus = {
  classListFiles: number;
  learnerRegister: boolean;
  parentLearnerLinks: boolean;
  parentRegister: boolean;
  contactList: boolean;
  employeeContactList: boolean;
  billingPlan: boolean;
  ageAnalysis: boolean;
  transactions: boolean;
  manifestPath: string | null;
  manifestReady: boolean;
  manifestErrors: string[];
};

export function daSilvaUploadRoot(schoolId: string, projectId: string): string {
  return path.join(STAGING_ROOT, schoolId, projectId, "uploads");
}

export function resolveDaSilvaStagedPaths(
  schoolId: string,
  projectId: string
): DaSilvaStagedUploadSlots {
  const root = daSilvaUploadRoot(schoolId, projectId);
  return {
    classListDir: path.join(root, "sasams", "class_lists"),
    learnerRegister: path.join(root, "sasams", "learner_register.xls"),
    parentLearnerLinks: path.join(root, "sasams", "parent_learner_links.xls"),
    parentRegister: path.join(root, "sasams", "parent_register.xls"),
    contactList: path.join(root, "kideesys", "contact_list.xls"),
    employeeContactList: path.join(root, "kideesys", "employee_contact_list.xls"),
    billingPlan: path.join(root, "kideesys", "billing_plan_summary.xls"),
    ageAnalysis: path.join(root, "kideesys", "age_analysis.xls"),
    transactions: path.join(root, "kideesys", "transaction_list.xls"),
  };
}

function isClassListSpreadsheetName(name: string): boolean {
  return /\.xlsx?$/i.test(name);
}

/** SA-SAMS class-list multipart field names (DaSilvaMigrationPanel uses `classListFiles`). */
export function isDaSilvaClassListUploadField(fieldName: string): boolean {
  const field = fieldName.trim();
  if (field === "classListFiles" || field === "classListFile" || field === "classLists") {
    return true;
  }
  return /^classListFiles\[\d*\]$/i.test(field);
}

/** Kid-e-Sys contact list multipart field names (Da Silva upload wizard). */
export function isDaSilvaContactListUploadField(fieldName: string): boolean {
  return DA_SILVA_CONTACT_LIST_UPLOAD_FIELDS.has(fieldName.trim());
}

function isDaSilvaContactListOriginalName(originalName: string): boolean {
  const name = String(originalName || "").trim().toLowerCase();
  if (!name) return false;
  if (name.includes("employee_contact") || name.includes("employee contact")) return false;
  if (name.includes("contact_list") || name.includes("04_contact")) return true;
  return name.includes("contact");
}

export function pickDaSilvaContactListUpload(
  grouped: Record<string, Express.Multer.File[]>,
  allFiles: Express.Multer.File[] | undefined
): Express.Multer.File | undefined {
  for (const field of DA_SILVA_CONTACT_LIST_UPLOAD_FIELDS) {
    const file = grouped[field]?.[0];
    if (file) return file;
  }
  for (const file of allFiles || []) {
    if (isDaSilvaContactListUploadField(String(file.fieldname || ""))) return file;
    const original = String(file.originalname || file.filename || "");
    if (isDaSilvaContactListOriginalName(original)) return file;
  }
  return undefined;
}

export function saveDaSilvaContactListUpload(
  contactListPath: string,
  file: { path: string }
): void {
  fs.mkdirSync(path.dirname(contactListPath), { recursive: true });
  fs.copyFileSync(file.path, contactListPath);
}

/** Returns filePath when present on disk; otherwise throws with a friendly message (never raw ENOENT). */
export function requireDaSilvaStagedFile(
  filePath: string,
  friendlyMessage: string
): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(friendlyMessage);
  }
  return filePath;
}

export function saveDaSilvaClassListUploads(
  classListDir: string,
  files: Array<{ path: string; originalname?: string; filename?: string }>
): string[] {
  fs.mkdirSync(classListDir, { recursive: true });
  const saved: string[] = [];
  for (const file of files) {
    const base = path.basename(String(file.originalname || file.filename || "").trim());
    if (!base || !isClassListSpreadsheetName(base)) continue;
    const dest = path.join(classListDir, base);
    fs.copyFileSync(file.path, dest);
    saved.push(base);
  }
  return saved.sort((a, b) => a.localeCompare(b));
}

export function readDaSilvaStagedUploadStatus(
  schoolId: string,
  projectId: string
): DaSilvaStagedUploadStatus {
  const paths = resolveDaSilvaStagedPaths(schoolId, projectId);
  let classListFiles = 0;
  if (fs.existsSync(paths.classListDir)) {
    classListFiles = fs
      .readdirSync(paths.classListDir)
      .filter((f) => isClassListSpreadsheetName(f)).length;
  }

  const manifestPath = stagingUploadManifestPath(schoolId, projectId);
  const manifest = loadStagingUploadManifest(schoolId, projectId);
  const gate = assertDaSilvaMigrationManifestReady(manifest);

  return {
    classListFiles,
    learnerRegister: fs.existsSync(paths.learnerRegister),
    parentLearnerLinks: fs.existsSync(paths.parentLearnerLinks),
    parentRegister: fs.existsSync(paths.parentRegister),
    contactList: fs.existsSync(paths.contactList),
    employeeContactList: fs.existsSync(paths.employeeContactList),
    billingPlan: fs.existsSync(paths.billingPlan),
    ageAnalysis: fs.existsSync(paths.ageAnalysis),
    transactions: fs.existsSync(paths.transactions),
    manifestPath: fs.existsSync(manifestPath) ? manifestPath : null,
    manifestReady: gate.ready,
    manifestErrors: gate.errors,
  };
}

export function assertDaSilvaStagedSlot(
  schoolId: string,
  projectId: string,
  slot: keyof DaSilvaStagedUploadStatus
): void {
  const status = readDaSilvaStagedUploadStatus(schoolId, projectId);
  if (slot === "classListFiles") {
    if (status.classListFiles < 1) {
      throw new Error("Upload SA-SAMS class list files first");
    }
    return;
  }
  if (slot === "manifestPath" || slot === "manifestReady" || slot === "manifestErrors") {
    if (!status.manifestReady) {
      throw new Error(status.manifestErrors.join("; ") || "Upload manifest is not ready");
    }
    return;
  }
  if (!status[slot]) {
    if (slot === "contactList") {
      throw new Error(DA_SILVA_CONTACT_LIST_MISSING_MESSAGE);
    }
    const labels: Record<
      Exclude<
        keyof DaSilvaStagedUploadStatus,
        "classListFiles" | "manifestPath" | "manifestReady" | "manifestErrors"
      >,
      string
    > = {
      learnerRegister: "SA-SAMS learner_register.xls",
      parentLearnerLinks: "SA-SAMS parent_learner_links.xls",
      parentRegister: "SA-SAMS parent_register.xls",
      contactList: DA_SILVA_CONTACT_LIST_MISSING_MESSAGE,
      employeeContactList:
        "Missing Kid-e-Sys Employee Contact List. Please upload 06 Employees into Employee Contact List slot.",
      billingPlan: "Kid-e-Sys billing plan summary",
      ageAnalysis: "Kid-e-Sys age analysis",
      transactions: "Kid-e-Sys transaction list",
    };
    throw new Error(`Missing staged upload: ${labels[slot]}`);
  }
}

export function ensureDaSilvaStagingDirs(schoolId: string, projectId: string): DaSilvaStagedUploadSlots {
  const paths = resolveDaSilvaStagedPaths(schoolId, projectId);
  fs.mkdirSync(paths.classListDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.learnerRegister), { recursive: true });
  fs.mkdirSync(path.dirname(paths.billingPlan), { recursive: true });
  return paths;
}
