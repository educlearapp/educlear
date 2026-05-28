import fs from "fs";
import path from "path";

/** Raw untouched uploads — never overwrite originals. */
export function getUniversalMigrationStagingDir(): string {
  const backendCwd = process.cwd();
  const underBackend = path.join(backendCwd, "storage", "migration-staging");
  if (fs.existsSync(path.join(backendCwd, "storage"))) {
    return underBackend;
  }
  return path.join(backendCwd, "..", "storage", "migration-staging");
}

export function ensureUniversalMigrationStagingDir(): string {
  const dir = getUniversalMigrationStagingDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
