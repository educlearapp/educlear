import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { MigrationProjectManifest, MigrationStagedFileRecord } from "./migrationTypes";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

export function getMigrationStagingRoot(): string {
  return STAGING_ROOT;
}

export function ensureMigrationStagingRoot(): string {
  if (!fs.existsSync(STAGING_ROOT)) {
    fs.mkdirSync(STAGING_ROOT, { recursive: true });
  }
  return STAGING_ROOT;
}

export function migrationProjectRoot(schoolId: string, projectId: string): string {
  return path.join(STAGING_ROOT, schoolId, projectId);
}

export function migrationProjectUploadsDir(schoolId: string, projectId: string): string {
  return path.join(migrationProjectRoot(schoolId, projectId), "uploads");
}

export function migrationProjectAuditsDir(schoolId: string, projectId: string): string {
  return path.join(migrationProjectRoot(schoolId, projectId), "audits");
}

export function migrationSchoolBackupsDir(schoolId: string): string {
  return path.join(STAGING_ROOT, schoolId, "backups");
}

export function migrationProjectManifestPath(schoolId: string, projectId: string): string {
  return path.join(migrationProjectRoot(schoolId, projectId), "manifest.json");
}

/** Allowed read roots for staged migration files (universal + project staging). */
export function getAllowedMigrationReadRoots(): string[] {
  const roots = [
    path.resolve(STAGING_ROOT),
    path.resolve(process.cwd(), "storage", "migration-staging"),
    path.resolve(process.cwd(), "..", "storage", "migration-staging"),
  ];
  return [...new Set(roots)];
}

export function resolveSafeMigrationReadPath(filePath: string): string {
  const resolved = path.resolve(String(filePath || ""));
  const allowed = getAllowedMigrationReadRoots();
  if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new Error("Migration file path is outside allowed staging directories");
  }
  return resolved;
}

export function loadMigrationProjectManifest(
  schoolId: string,
  projectId: string
): MigrationProjectManifest | null {
  const manifestPath = migrationProjectManifestPath(schoolId, projectId);
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as MigrationProjectManifest;
}

export function saveMigrationProjectManifest(manifest: MigrationProjectManifest): void {
  const dir = migrationProjectRoot(manifest.schoolId, manifest.projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(migrationProjectUploadsDir(manifest.schoolId, manifest.projectId), {
    recursive: true,
  });
  fs.mkdirSync(migrationProjectAuditsDir(manifest.schoolId, manifest.projectId), {
    recursive: true,
  });
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    migrationProjectManifestPath(manifest.schoolId, manifest.projectId),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

export function storeUploadedFile(
  schoolId: string,
  projectId: string,
  originalFilename: string,
  tempPath: string
): string {
  const uploadsDir = migrationProjectUploadsDir(schoolId, projectId);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const safeName = String(originalFilename || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
  let dest = path.join(uploadsDir, safeName);
  if (fs.existsSync(dest)) {
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    dest = path.join(uploadsDir, `${base}-${Date.now()}${ext}`);
  }
  fs.renameSync(tempPath, dest);
  return dest;
}

export function extractZipToUploads(
  schoolId: string,
  projectId: string,
  zipPath: string
): string[] {
  const uploadsDir = migrationProjectUploadsDir(schoolId, projectId);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const resolved = resolveSafeMigrationReadPath(zipPath);
  execSync(`unzip -q -o ${JSON.stringify(resolved)} -d ${JSON.stringify(uploadsDir)}`, {
    stdio: "pipe",
  });
  const extracted: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(csv|xls|xlsx)$/i.test(entry.name)) extracted.push(full);
    }
  };
  walk(uploadsDir);
  return extracted;
}

export function appendFilesToManifest(
  manifest: MigrationProjectManifest,
  files: MigrationStagedFileRecord[]
): MigrationProjectManifest {
  const byId = new Map(manifest.files.map((f) => [f.fileId, f]));
  for (const f of files) byId.set(f.fileId, f);
  return { ...manifest, files: [...byId.values()] };
}
