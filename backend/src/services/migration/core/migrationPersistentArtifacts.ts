/**
 * Dual-root migration artifact storage (Phase 1 safe hardening).
 *
 * WRITE: always to process.cwd()/data/migration-<key>/ (Render persistent disk).
 * READ:  data/ first, then legacy storage/migration-<key>/ (no blind moves/deletes).
 *
 * Existing storage/ artifacts remain readable and untouched.
 */

import fs from "fs";
import path from "path";

/** Overridable roots for unit tests (never used in production paths). */
let rootsOverride: { dataRoot: string; storageRoot: string } | null = null;

export function setMigrationArtifactRootsForTests(
  roots: { dataRoot: string; storageRoot: string } | null
): void {
  rootsOverride = roots;
}

export function getMigrationDataRoot(): string {
  return rootsOverride?.dataRoot ?? path.join(process.cwd(), "data");
}

export function getMigrationLegacyStorageRoot(): string {
  return rootsOverride?.storageRoot ?? path.join(process.cwd(), "storage");
}

/** Artifact folder name without the `migration-` prefix, e.g. "sessions" → migration-sessions. */
export function migrationArtifactDirName(artifactKey: string): string {
  const key = String(artifactKey || "").trim().replace(/^migration-/, "");
  if (!key || !/^[a-z0-9-]+$/i.test(key)) {
    throw new Error(`Invalid migration artifact key: ${artifactKey}`);
  }
  return `migration-${key}`;
}

export function getMigrationArtifactWriteDir(artifactKey: string): string {
  return path.join(getMigrationDataRoot(), migrationArtifactDirName(artifactKey));
}

export function getMigrationArtifactLegacyDir(artifactKey: string): string {
  return path.join(getMigrationLegacyStorageRoot(), migrationArtifactDirName(artifactKey));
}

export function ensureMigrationArtifactWriteDir(artifactKey: string): string {
  const dir = getMigrationArtifactWriteDir(artifactKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeArtifactId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function assertInsideDir(resolved: string, dir: string): void {
  const root = path.resolve(dir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Invalid migration artifact path");
  }
}

/** Absolute path for a NEW write (always under data/). */
export function migrationArtifactWritePath(artifactKey: string, id: string): string {
  const safe = sanitizeArtifactId(id);
  if (!safe) throw new Error("Invalid migration artifact id");
  const dir = ensureMigrationArtifactWriteDir(artifactKey);
  const resolved = path.resolve(dir, `${safe}.json`);
  assertInsideDir(resolved, dir);
  return resolved;
}

/**
 * Resolve existing artifact for read: prefer data/, fall back to legacy storage/.
 * Does not create directories. Does not move or delete legacy files.
 */
export function resolveMigrationArtifactReadPath(
  artifactKey: string,
  id: string
): string | null {
  const safe = sanitizeArtifactId(id);
  if (!safe) return null;
  const primaryDir = getMigrationArtifactWriteDir(artifactKey);
  const legacyDir = getMigrationArtifactLegacyDir(artifactKey);
  const primary = path.resolve(primaryDir, `${safe}.json`);
  const legacy = path.resolve(legacyDir, `${safe}.json`);
  try {
    assertInsideDir(primary, primaryDir);
  } catch {
    return null;
  }
  if (fs.existsSync(primary)) return primary;
  try {
    assertInsideDir(legacy, legacyDir);
  } catch {
    return null;
  }
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

export function writeMigrationArtifactJson(
  artifactKey: string,
  id: string,
  data: unknown
): string {
  const fp = migrationArtifactWritePath(artifactKey, id);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, fp);
  return fp;
}

export function readMigrationArtifactJson<T>(
  artifactKey: string,
  id: string
): T | null {
  try {
    const fp = resolveMigrationArtifactReadPath(artifactKey, id);
    if (!fp) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
  } catch {
    return null;
  }
}

/** List basenames (without .json) from data/ and legacy storage/, preferring data on collision. */
export function listMigrationArtifactIds(artifactKey: string): string[] {
  const ids = new Map<string, true>();
  const collect = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json") || name.includes(".tmp")) continue;
      const id = name.slice(0, -".json".length);
      if (sanitizeArtifactId(id)) ids.set(id, true);
    }
  };
  collect(getMigrationArtifactWriteDir(artifactKey));
  collect(getMigrationArtifactLegacyDir(artifactKey));
  return [...ids.keys()].sort();
}

/** True if artifact exists in data/ or legacy storage/ (never creates or moves). */
export function migrationArtifactExists(artifactKey: string, id: string): boolean {
  return resolveMigrationArtifactReadPath(artifactKey, id) != null;
}

/**
 * Resolve nested artifact under a subdirectory (e.g. plans/stage_x).
 * Prefer data/, then legacy storage/. Never moves or deletes.
 */
export function resolveNestedMigrationArtifactReadPath(
  artifactKey: string,
  subDir: string,
  id: string
): string | null {
  const safe = sanitizeArtifactId(id);
  const sub = String(subDir || "").trim().replace(/\\/g, "/");
  if (!safe || !sub || sub.includes("..") || sub.startsWith("/") || sub.includes("//")) {
    return null;
  }
  for (const root of [
    getMigrationArtifactWriteDir(artifactKey),
    getMigrationArtifactLegacyDir(artifactKey),
  ]) {
    const dir = path.join(root, sub);
    const fp = path.resolve(dir, `${safe}.json`);
    try {
      assertInsideDir(fp, dir);
    } catch {
      continue;
    }
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

/** Allowed roots for reading staged source files (persistent + legacy). */
export function getPersistentAndLegacyMigrationStagingRoots(): string[] {
  const roots = [
    path.resolve(getMigrationDataRoot(), "migration-staging"),
    path.resolve(getMigrationLegacyStorageRoot(), "migration-staging"),
    path.resolve(process.cwd(), "uploads", "migration-staging"),
    path.resolve(process.cwd(), "..", "storage", "migration-staging"),
  ];
  return [...new Set(roots)];
}
