/**
 * Phase 1M — Migration source set manifest + content fingerprint.
 * Logical source identity (not temp paths / upload timestamps).
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { MigrationDomainId } from "./OrchestratorTypes";

export const MIGRATION_SOURCE_MANIFEST_VERSION = "1M.1" as const;

export type SourceManifestFile = {
  fileId: string;
  filename: string;
  category: string;
  /** Content fingerprint from filename + headers + sample row hash (stable). */
  contentFingerprint: string;
  headerFingerprint: string;
  detectedDomains: MigrationDomainId[];
  rowCount: number;
  size: number;
  status: "ACTIVE" | "REPLACED" | "REMOVED";
  addedAt: string;
  updatedAt: string;
};

export type MigrationSourceManifest = {
  manifestId: string;
  version: typeof MIGRATION_SOURCE_MANIFEST_VERSION;
  targetSchoolId: string;
  stageId: string | null;
  generatedAt: string;
  updatedAt: string;
  /** Deterministic fingerprint of all ACTIVE files' content fingerprints. */
  sourceSetFingerprint: string;
  files: SourceManifestFile[];
};

const ROOT = path.join(process.cwd(), "storage", "migration-source-manifests");

function ensureDir(): void {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function sanitize(id: string): string | null {
  const t = String(id || "").trim();
  if (!t || t.includes("..") || t.includes("/") || t.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(t)) return null;
  return t;
}

export function headerFingerprint(filename: string, columns: string[]): string {
  const payload = `${filename}|${columns.map((c) => String(c).trim()).join("\u0001")}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export function contentFingerprint(input: {
  filename: string;
  columns: string[];
  sampleRows?: Record<string, string>[];
  rowCount?: number;
  size?: number;
}): string {
  const sample = (input.sampleRows || [])
    .slice(0, 5)
    .map((r) =>
      Object.keys(r)
        .sort()
        .map((k) => `${k}=${String(r[k] ?? "").trim()}`)
        .join("|")
    )
    .join("\n");
  const payload = [
    String(input.filename || "").trim().toLowerCase(),
    input.columns.map((c) => c.trim()).join("\u0001"),
    String(input.rowCount ?? ""),
    String(input.size ?? ""),
    sample,
  ].join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function computeSourceSetFingerprint(files: SourceManifestFile[]): string {
  const active = files
    .filter((f) => f.status === "ACTIVE")
    .map((f) => `${f.filename.toLowerCase()}::${f.contentFingerprint}`)
    .sort();
  return createHash("sha256").update(active.join("\n")).digest("hex").slice(0, 32);
}

export function detectDomainsFromColumns(columns: string[]): MigrationDomainId[] {
  const joined = columns.join("|").toLowerCase();
  const domains: MigrationDomainId[] = ["CORE"];
  if (/mother|father|guardian|parent|cellphone|mobile|email/.test(joined)) {
    domains.push("PARENTS_FAMILIES");
  }
  if (/grade|class|subject|classroom|homeroom|register/.test(joined)) {
    domains.push("ACADEMIC");
  }
  if (/balance|account|invoice|payment|opening|amount|debit|credit/.test(joined)) {
    domains.push("FINANCE", "STATEMENTS", "FEE_CHECK");
  }
  return domains;
}

/**
 * Dependency matrix: which domains become stale when a file's domains change.
 */
export const SOURCE_CHANGE_STALE_MATRIX: Record<
  MigrationDomainId,
  MigrationDomainId[]
> = {
  CORE: ["CORE", "PARENTS_FAMILIES", "ACADEMIC"],
  PARENTS_FAMILIES: ["PARENTS_FAMILIES"],
  ACADEMIC: ["ACADEMIC"],
  FINANCE: ["FINANCE", "STATEMENTS", "FEE_CHECK"],
  STATEMENTS: ["STATEMENTS", "FEE_CHECK"],
  FEE_CHECK: ["FEE_CHECK"],
};

export function domainsStaleFromFileDomains(
  fileDomains: MigrationDomainId[]
): MigrationDomainId[] {
  const out = new Set<MigrationDomainId>();
  for (const d of fileDomains) {
    for (const s of SOURCE_CHANGE_STALE_MATRIX[d] || [d]) out.add(s);
  }
  return [...out];
}

function writeJson(id: string, data: unknown): void {
  ensureDir();
  const safe = sanitize(id);
  if (!safe) throw new Error("Invalid manifest id");
  const fp = path.join(ROOT, `${safe}.json`);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function readJson(id: string): MigrationSourceManifest | null {
  try {
    const safe = sanitize(id);
    if (!safe) return null;
    const fp = path.join(ROOT, `${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationSourceManifest;
  } catch {
    return null;
  }
}

export function saveSourceManifest(
  manifest: MigrationSourceManifest
): MigrationSourceManifest {
  const next = {
    ...manifest,
    sourceSetFingerprint: computeSourceSetFingerprint(manifest.files),
    updatedAt: new Date().toISOString(),
  };
  writeJson(next.manifestId, next);
  writeJson(`school_${next.targetSchoolId}`, next);
  if (next.stageId) writeJson(`stage_${next.stageId}`, next);
  return next;
}

export function getSourceManifestBySchool(
  schoolId: string
): MigrationSourceManifest | null {
  return readJson(`school_${schoolId}`);
}

export function getSourceManifestByStage(
  stageId: string
): MigrationSourceManifest | null {
  return readJson(`stage_${stageId}`);
}
