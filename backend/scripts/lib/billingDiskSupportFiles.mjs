/**
 * Billing JSON on persistent disk: critical vs support files.
 * Critical files (ledger, age analysis) are never touched by repair.
 */
import fs from "fs";
import path from "path";

export const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

/** Never modified by repair — Phase-1 seed only with explicit confirm. */
export const CRITICAL_DATA_FILES = [
  "billing-ledger.json",
  "family-account-age-analysis.json",
];

/** Safe to create/copy when missing on mounted disk. */
export const SUPPORT_DATA_FILES = [
  "kidesys-transaction-history.json",
  "payment-allocations.json",
  "family-account-audit.json",
  "learner-billing-plans.json",
  "banking-imports.json",
  "user-access.json",
  "legal-document-history.json",
  "communication-store.json",
];

export function getTemplateDir(backendRoot) {
  return path.join(backendRoot, "storage", "billing-disk-support-templates");
}

export function getDataDir(backendRoot) {
  return path.join(backendRoot, "data");
}

export function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function emptyDefaultForSupportFile(filename) {
  switch (filename) {
    case "kidesys-transaction-history.json":
      return { [DA_SILVA_SCHOOL_ID]: [] };
    case "payment-allocations.json":
      return { [DA_SILVA_SCHOOL_ID]: {} };
    case "family-account-audit.json":
      return {};
    case "learner-billing-plans.json":
      return { [DA_SILVA_SCHOOL_ID]: {} };
    case "banking-imports.json":
      return { imports: [], postedFingerprints: {} };
    case "user-access.json":
      return { users: {} };
    case "legal-document-history.json":
      return [];
    case "communication-store.json":
      return { schools: {} };
    default:
      return {};
  }
}

function copyFileAtomic(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(sourcePath, tmp);
  fs.renameSync(tmp, targetPath);
}

/**
 * Create or copy missing support JSON on disk. Never touches critical billing files.
 */
export function repairMissingSupportFiles(backendRoot, options = {}) {
  const overwrite = Boolean(options.overwrite);
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : getDataDir(backendRoot);
  const templateDir = getTemplateDir(backendRoot);
  const created = [];
  const skipped = [];

  fs.mkdirSync(dataDir, { recursive: true });

  for (const file of SUPPORT_DATA_FILES) {
    const targetPath = path.join(dataDir, file);
    if (fs.existsSync(targetPath) && !overwrite) {
      skipped.push(file);
      continue;
    }

    const templatePath = path.join(templateDir, file);
    if (fs.existsSync(templatePath)) {
      copyFileAtomic(templatePath, targetPath);
      created.push({ file, source: "template", path: targetPath });
      continue;
    }

    const repoSource = path.join(getDataDir(backendRoot), file);
    if (fs.existsSync(repoSource) && path.resolve(repoSource) !== path.resolve(targetPath)) {
      try {
        copyFileAtomic(repoSource, targetPath);
        created.push({ file, source: "repo-data", path: targetPath });
        continue;
      } catch {
        /* fall through to empty default */
      }
    }

    writeJsonAtomic(targetPath, emptyDefaultForSupportFile(file));
    created.push({ file, source: "empty-default", path: targetPath });
  }

  return { dataDir, templateDir, created, skipped };
}

/** Phase-1 seed: copy all support files onto disk (overwrite support only). */
export function seedSupportFilesToDisk(backendRoot, targetDir) {
  return repairMissingSupportFiles(backendRoot, {
    dataDir: targetDir,
    overwrite: true,
  });
}

export function stageSupportTemplatesFromRepoData(backendRoot) {
  const sourceDir = getDataDir(backendRoot);
  const templateDir = getTemplateDir(backendRoot);
  fs.mkdirSync(templateDir, { recursive: true });
  const staged = [];
  const missing = [];

  for (const file of SUPPORT_DATA_FILES) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(templateDir, file);
    if (!fs.existsSync(sourcePath)) {
      missing.push(file);
      writeJsonAtomic(targetPath, emptyDefaultForSupportFile(file));
      staged.push({ file, source: "empty-default" });
      continue;
    }
    copyFileAtomic(sourcePath, targetPath);
    staged.push({ file, source: "repo-data", bytes: fs.statSync(targetPath).size });
  }

  return { templateDir, staged, missing };
}

export function countSchoolArrayEntries(parsed, schoolId = DA_SILVA_SCHOOL_ID) {
  const payload = parsed?.[schoolId];
  return Array.isArray(payload) ? payload.length : 0;
}

export function countSchoolObjectKeys(parsed, schoolId = DA_SILVA_SCHOOL_ID) {
  const payload = parsed?.[schoolId];
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload).length
    : 0;
}
