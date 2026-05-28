import fs from "fs";
import path from "path";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import { ALL_MIGRATION_TARGET_FIELDS } from "../types/MigrationTargetField";
import type { MigrationFileCategory } from "../types/MigrationFile";
import type {
  MigrationAdapterReadinessTemplate,
  MigrationRequiredField,
  MigrationRequiredFile,
} from "../types/MigrationAdapterReadinessTemplate";
import { MIGRATION_ADAPTER_READINESS_SEED } from "./migrationAdapterReadinessSeed";

const READINESS_DIR = path.join(process.cwd(), "storage", "migration-adapter-readiness");

/** Prevents re-entrant seeding when saveReadinessTemplate calls getReadinessTemplate before the first file is written. */
let readinessSeedInProgress = false;

const FILE_CATEGORIES: MigrationFileCategory[] = [
  "learners",
  "parents",
  "billing",
  "transactions",
  "staff",
  "historical",
  "unknown",
];

function ensureReadinessDir(): void {
  if (!fs.existsSync(READINESS_DIR)) {
    fs.mkdirSync(READINESS_DIR, { recursive: true });
  }
}

function sanitizeSystemId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function readinessFilePath(systemId: string): string {
  const safe = sanitizeSystemId(systemId);
  if (!safe) throw new Error("Invalid system id");
  const resolved = path.resolve(READINESS_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(READINESS_DIR) + path.sep)) {
    throw new Error("Invalid readiness path");
  }
  return resolved;
}

function isFileCategory(value: string): value is MigrationFileCategory {
  return (FILE_CATEGORIES as string[]).includes(value);
}

function isTargetField(value: string): value is MigrationTargetField {
  return (ALL_MIGRATION_TARGET_FIELDS as string[]).includes(value);
}

function parseRequiredFile(raw: unknown): MigrationRequiredFile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<MigrationRequiredFile>;
  const fileKey = String(o.fileKey || "").trim();
  const label = String(o.label || "").trim();
  const category = String(o.category || "").trim();
  if (!fileKey || !label || !isFileCategory(category)) return null;

  const acceptedTypes = Array.isArray(o.acceptedTypes)
    ? o.acceptedTypes.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    fileKey,
    label,
    description: String(o.description || "").trim(),
    required: Boolean(o.required),
    acceptedTypes,
    category,
  };
}

function parseRequiredField(raw: unknown): MigrationRequiredField | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<MigrationRequiredField>;
  const fieldKey = String(o.fieldKey || "").trim();
  const label = String(o.label || "").trim();
  const targetField = String(o.targetField || "").trim();
  const category = String(o.category || "").trim();
  if (!fieldKey || !label || !isTargetField(targetField) || !isFileCategory(category)) return null;

  const aliases = Array.isArray(o.aliases)
    ? o.aliases.map((a) => String(a || "").trim()).filter(Boolean)
    : [];

  return {
    fieldKey,
    label,
    targetField,
    required: Boolean(o.required),
    category,
    aliases,
  };
}

function parseTemplateFile(raw: string, fileId: string): MigrationAdapterReadinessTemplate | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationAdapterReadinessTemplate>;
    if (!parsed || typeof parsed !== "object") return null;

    const systemId = String(parsed.systemId || fileId).trim();
    const systemName = String(parsed.systemName || "").trim();
    if (!systemId || !systemName) return null;

    const requiredFiles = Array.isArray(parsed.requiredFiles)
      ? parsed.requiredFiles.map(parseRequiredFile).filter((f): f is MigrationRequiredFile => f !== null)
      : [];

    const requiredFields = Array.isArray(parsed.requiredFields)
      ? parsed.requiredFields.map(parseRequiredField).filter((f): f is MigrationRequiredField => f !== null)
      : [];

    const optionalFields = Array.isArray(parsed.optionalFields)
      ? parsed.optionalFields.map(parseRequiredField).filter((f): f is MigrationRequiredField => f !== null)
      : [];

    return {
      templateId: String(parsed.templateId || `readiness-${systemId}`).trim(),
      systemId,
      systemName,
      version: String(parsed.version || "1.0.0").trim(),
      requiredFiles,
      requiredFields,
      optionalFields,
      notes: String(parsed.notes || "").trim(),
      lastReviewedAt: String(parsed.lastReviewedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function seedMigrationAdapterReadinessIfEmpty(): number {
  if (readinessSeedInProgress) return 0;
  ensureReadinessDir();
  const hasTemplates = fs
    .readdirSync(READINESS_DIR, { withFileTypes: true })
    .some((e) => e.isFile() && e.name.endsWith(".json"));
  if (hasTemplates) return 0;

  readinessSeedInProgress = true;
  try {
    let written = 0;
    for (const template of MIGRATION_ADAPTER_READINESS_SEED) {
      saveReadinessTemplate(template);
      written += 1;
    }
    return written;
  } finally {
    readinessSeedInProgress = false;
  }
}

export function listReadinessTemplates(): MigrationAdapterReadinessTemplate[] {
  ensureReadinessDir();
  seedMigrationAdapterReadinessIfEmpty();

  const entries = fs.readdirSync(READINESS_DIR, { withFileTypes: true });
  const templates: MigrationAdapterReadinessTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fileId = entry.name.replace(/\.json$/i, "");
    try {
      const raw = fs.readFileSync(path.join(READINESS_DIR, entry.name), "utf8");
      const template = parseTemplateFile(raw, fileId);
      if (template) templates.push(template);
    } catch {
      // Skip corrupt files
    }
  }

  return templates.sort((a, b) => a.systemName.localeCompare(b.systemName));
}

export function getReadinessTemplate(systemId: string): MigrationAdapterReadinessTemplate | null {
  ensureReadinessDir();
  seedMigrationAdapterReadinessIfEmpty();

  const safeId = sanitizeSystemId(systemId);
  if (!safeId) return null;
  const filePath = readinessFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseTemplateFile(raw, safeId);
  } catch {
    return null;
  }
}

export function saveReadinessTemplate(
  input: MigrationAdapterReadinessTemplate
): MigrationAdapterReadinessTemplate {
  ensureReadinessDir();

  const systemIdRaw = String(input.systemId || "").trim();
  const systemName = String(input.systemName || "").trim();
  if (!systemName) throw new Error("systemName is required");

  const systemId = sanitizeSystemId(systemIdRaw);
  if (!systemId) throw new Error("Valid systemId is required");

  const requiredFiles = Array.isArray(input.requiredFiles)
    ? input.requiredFiles.map(parseRequiredFile).filter((f): f is MigrationRequiredFile => f !== null)
    : [];

  const requiredFields = Array.isArray(input.requiredFields)
    ? input.requiredFields.map(parseRequiredField).filter((f): f is MigrationRequiredField => f !== null)
    : [];

  const optionalFields = Array.isArray(input.optionalFields)
    ? input.optionalFields.map(parseRequiredField).filter((f): f is MigrationRequiredField => f !== null)
    : [];

  const existing = getReadinessTemplate(systemId);

  const template: MigrationAdapterReadinessTemplate = {
    templateId: String(input.templateId || `readiness-${systemId}`).trim(),
    systemId,
    systemName,
    version: String(input.version || existing?.version || "1.0.0").trim(),
    requiredFiles,
    requiredFields,
    optionalFields,
    notes: String(input.notes || "").trim(),
    lastReviewedAt: String(input.lastReviewedAt || existing?.lastReviewedAt || new Date().toISOString()),
  };

  const filePath = readinessFilePath(systemId);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(template, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);

  return template;
}

export function deleteReadinessTemplate(systemId: string): boolean {
  ensureReadinessDir();
  const safeId = sanitizeSystemId(systemId);
  if (!safeId) return false;
  const filePath = readinessFilePath(safeId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
