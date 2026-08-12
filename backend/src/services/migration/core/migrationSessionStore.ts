import fs from "fs";
import path from "path";
import type { MigrationFile } from "../types/MigrationFile";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type {
  MigrationFileColumnMappings,
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "../types/MigrationValidation";
import type { MigrationStage } from "../types/MigrationStage";
import type { MigrationSourceSystem } from "../migrationTypes";
import type { ParentIdentityResolution } from "../parentIdentity/parentIdentityTypes";
import { resolveSafeMigrationReadPath } from "../migrationProjectPaths";
import { deleteStage } from "../staging";

const SESSIONS_DIR = path.join(process.cwd(), "storage", "migration-sessions");

export type PersistentParentIdentityResolutions = {
  stageId: string;
  migrationRunId: string;
  targetSchoolId: string;
  resolutions: ParentIdentityResolution[];
  updatedAt: string;
};

export type PersistentMigrationSession = {
  schoolId: string;
  createdAt: string;
  updatedAt: string;
  sourceSystem: MigrationSourceSystem | string;
  uploadedFiles: MigrationFile[];
  previews: MigrationFilePreview[];
  mappingSuggestions: unknown[];
  mappingOverrides: Record<string, Record<string, string>>;
  validationSummary: MigrationValidationSummary | null;
  validationIssues: MigrationValidationIssue[];
  validationMode: "preview" | "full";
  cutoverDate: string;
  dryRunStage: MigrationStage | null;
  /** Operator parent-identity resolutions bound to stage + school. */
  parentIdentityResolutions?: PersistentParentIdentityResolutions | null;
  /** Phase 1E source-analysis artifact id (stage/school bound in analysis file). */
  sourceAnalysisId?: string | null;
  /** Phase 1F compiled migration plan id. */
  compiledPlanId?: string | null;
};

export type PersistentMigrationSessionPatch = Partial<
  Omit<PersistentMigrationSession, "schoolId" | "createdAt" | "updatedAt">
>;

function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sanitizeSchoolId(schoolId: string): string | null {
  const trimmed = String(schoolId || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function sessionPath(schoolId: string): string {
  const safe = sanitizeSchoolId(schoolId);
  if (!safe) throw new Error("Invalid school id");
  const resolved = path.resolve(SESSIONS_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(SESSIONS_DIR) + path.sep)) {
    throw new Error("Invalid migration session path");
  }
  return resolved;
}

function emptySession(schoolId: string): PersistentMigrationSession {
  const now = new Date().toISOString();
  return {
    schoolId,
    createdAt: now,
    updatedAt: now,
    sourceSystem: "generic-excel-csv",
    uploadedFiles: [],
    previews: [],
    mappingSuggestions: [],
    mappingOverrides: {},
    validationSummary: null,
    validationIssues: [],
    validationMode: "preview",
    cutoverDate: "",
    dryRunStage: null,
    parentIdentityResolutions: null,
    sourceAnalysisId: null,
    compiledPlanId: null,
  };
}

function normalizeParentIdentityResolutions(
  raw: unknown
): PersistentParentIdentityResolutions | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<PersistentParentIdentityResolutions>;
  const stageId = String(value.stageId || "").trim();
  const migrationRunId = String(value.migrationRunId || stageId).trim();
  const targetSchoolId = String(value.targetSchoolId || "").trim();
  if (!stageId || !targetSchoolId) return null;
  const resolutions = Array.isArray(value.resolutions)
    ? value.resolutions
        .map((r) => ({
          itemKey: String((r as ParentIdentityResolution)?.itemKey || "").trim(),
          kind: String((r as ParentIdentityResolution)?.kind || "").trim() as ParentIdentityResolution["kind"],
          existingParentId:
            (r as ParentIdentityResolution)?.existingParentId == null
              ? null
              : String((r as ParentIdentityResolution).existingParentId).trim(),
          note:
            (r as ParentIdentityResolution)?.note == null
              ? null
              : String((r as ParentIdentityResolution).note).trim(),
        }))
        .filter(
          (r) =>
            r.itemKey &&
            (r.kind === "LINK_TO_EXISTING_PARENT" ||
              r.kind === "CREATE_AS_NEW_PARENT" ||
              r.kind === "SKIP_HOLD")
        )
    : [];
  return {
    stageId,
    migrationRunId,
    targetSchoolId,
    resolutions,
    updatedAt: String(value.updatedAt || new Date().toISOString()),
  };
}

/** Return resolutions only when bound stage + school match; otherwise empty (stale). */
export function getBoundParentIdentityResolutions(
  session: PersistentMigrationSession | null | undefined,
  opts: { stageId: string; targetSchoolId: string; migrationRunId?: string }
): ParentIdentityResolution[] {
  const bound = session?.parentIdentityResolutions;
  if (!bound) return [];
  const stageId = String(opts.stageId || "").trim();
  const schoolId = String(opts.targetSchoolId || "").trim();
  const runId = String(opts.migrationRunId || stageId).trim();
  if (!stageId || !schoolId) return [];
  if (bound.stageId !== stageId) return [];
  if (bound.targetSchoolId !== schoolId) return [];
  if (bound.migrationRunId && bound.migrationRunId !== runId && bound.migrationRunId !== stageId) {
    return [];
  }
  return Array.isArray(bound.resolutions) ? bound.resolutions : [];
}

function normalizeSession(raw: unknown, schoolId: string): PersistentMigrationSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<PersistentMigrationSession>;
  return {
    ...emptySession(schoolId),
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || new Date().toISOString()),
    sourceSystem: String(value.sourceSystem || "generic-excel-csv"),
    uploadedFiles: Array.isArray(value.uploadedFiles) ? value.uploadedFiles : [],
    previews: Array.isArray(value.previews) ? value.previews : [],
    mappingSuggestions: Array.isArray(value.mappingSuggestions) ? value.mappingSuggestions : [],
    mappingOverrides:
      value.mappingOverrides && typeof value.mappingOverrides === "object"
        ? value.mappingOverrides
        : {},
    validationSummary:
      value.validationSummary && typeof value.validationSummary === "object"
        ? value.validationSummary
        : null,
    validationIssues: Array.isArray(value.validationIssues) ? value.validationIssues : [],
    validationMode: value.validationMode === "full" ? "full" : "preview",
    cutoverDate: String(value.cutoverDate || ""),
    dryRunStage:
      value.dryRunStage && typeof value.dryRunStage === "object" ? value.dryRunStage : null,
    parentIdentityResolutions: normalizeParentIdentityResolutions(value.parentIdentityResolutions),
    sourceAnalysisId: String(value.sourceAnalysisId || "").trim() || null,
    compiledPlanId: String(value.compiledPlanId || "").trim() || null,
  };
}

export function getMigrationSession(schoolId: string): PersistentMigrationSession | null {
  const safe = sanitizeSchoolId(schoolId);
  if (!safe) return null;
  ensureSessionsDir();
  const filePath = sessionPath(safe);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeSession(JSON.parse(fs.readFileSync(filePath, "utf8")), safe);
  } catch {
    return null;
  }
}

export function saveMigrationSession(
  schoolId: string,
  patch: PersistentMigrationSessionPatch
): PersistentMigrationSession {
  const safe = sanitizeSchoolId(schoolId);
  if (!safe) throw new Error("Invalid school id");
  ensureSessionsDir();
  const existing = getMigrationSession(safe) ?? emptySession(safe);
  const next: PersistentMigrationSession = {
    ...existing,
    ...patch,
    schoolId: safe,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const filePath = sessionPath(safe);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
  return next;
}

function deleteUploadedFiles(session: PersistentMigrationSession): void {
  for (const file of session.uploadedFiles) {
    const rawPath = String(file.path || "").trim();
    if (!rawPath) continue;
    try {
      const safePath = resolveSafeMigrationReadPath(rawPath);
      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        fs.unlinkSync(safePath);
      }
    } catch {
      // Ignore paths that are no longer present or no longer allowed.
    }
  }
}

export function clearMigrationSession(schoolId: string): boolean {
  const safe = sanitizeSchoolId(schoolId);
  if (!safe) return false;
  ensureSessionsDir();
  const existing = getMigrationSession(safe);
  if (existing) {
    deleteUploadedFiles(existing);
    if (existing.dryRunStage?.stageId) {
      deleteStage(existing.dryRunStage.stageId);
    }
  }
  const filePath = sessionPath(safe);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
