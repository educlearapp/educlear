import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MigrationMappingTemplate } from "../types/MigrationMappingTemplate";

const TEMPLATES_DIR = path.join(process.cwd(), "storage", "migration-templates");

function ensureTemplatesDir(): void {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

/** Safe filename segment — rejects path traversal and invalid ids. */
function sanitizeTemplateId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function templateFilePath(id: string): string {
  const safe = sanitizeTemplateId(id);
  if (!safe) throw new Error("Invalid template id");
  const resolved = path.resolve(TEMPLATES_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(TEMPLATES_DIR) + path.sep)) {
    throw new Error("Invalid template path");
  }
  return resolved;
}

function parseTemplateFile(raw: string, fileId: string): MigrationMappingTemplate | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationMappingTemplate>;
    if (!parsed || typeof parsed !== "object") return null;
    const id = String(parsed.id || fileId).trim();
    const name = String(parsed.name || "").trim();
    const sourceSystem = String(parsed.sourceSystem || "").trim();
    if (!id || !name || !sourceSystem) return null;

    const mappings = Array.isArray(parsed.mappings)
      ? parsed.mappings
          .map((m) => ({
            sourceColumn: String((m as { sourceColumn?: string }).sourceColumn || "").trim(),
            targetField: String((m as { targetField?: string }).targetField || "").trim(),
          }))
          .filter((m) => m.sourceColumn && m.targetField)
      : [];

    return {
      id,
      name,
      sourceSystem,
      description: String(parsed.description || "").trim(),
      mappings,
      createdAt: String(parsed.createdAt || new Date().toISOString()),
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function listTemplates(): MigrationMappingTemplate[] {
  ensureTemplatesDir();
  const entries = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
  const templates: MigrationMappingTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fileId = entry.name.replace(/\.json$/i, "");
    try {
      const raw = fs.readFileSync(path.join(TEMPLATES_DIR, entry.name), "utf8");
      const template = parseTemplateFile(raw, fileId);
      if (template) templates.push(template);
    } catch {
      // Skip corrupt files — do not crash list
    }
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export function getTemplate(id: string): MigrationMappingTemplate | null {
  ensureTemplatesDir();
  const safeId = sanitizeTemplateId(id);
  if (!safeId) return null;
  const filePath = templateFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseTemplateFile(raw, safeId);
  } catch {
    return null;
  }
}

export function saveTemplate(input: {
  id?: string;
  name: string;
  sourceSystem: string;
  description?: string;
  mappings: MigrationMappingTemplate["mappings"];
  createdAt?: string;
  updatedAt?: string;
}): MigrationMappingTemplate {
  ensureTemplatesDir();

  const name = String(input.name || "").trim();
  const sourceSystem = String(input.sourceSystem || "").trim();
  if (!name) throw new Error("Template name is required");
  if (!sourceSystem) throw new Error("Source system is required");

  const requestedId = String(input.id || "").trim();
  const id = requestedId ? sanitizeTemplateId(requestedId) : null;
  const templateId = id ?? randomUUID();

  const mappings = Array.isArray(input.mappings)
    ? input.mappings
        .map((m) => ({
          sourceColumn: String(m.sourceColumn || "").trim(),
          targetField: String(m.targetField || "").trim(),
        }))
        .filter((m) => m.sourceColumn && m.targetField)
    : [];

  const existing = requestedId && id ? getTemplate(id) : null;
  const now = new Date().toISOString();

  const template: MigrationMappingTemplate = {
    id: templateId,
    name,
    sourceSystem,
    description: String(input.description || "").trim(),
    mappings,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };

  const filePath = templateFilePath(templateId);
  if (!existing && fs.existsSync(filePath)) {
    throw new Error("Template id already exists");
  }

  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(template, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);

  return template;
}

export function deleteTemplate(id: string): boolean {
  ensureTemplatesDir();
  const safeId = sanitizeTemplateId(id);
  if (!safeId) return false;
  const filePath = templateFilePath(safeId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
