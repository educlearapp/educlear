import fs from "fs";
import path from "path";
import {
  getMigrationDataRoot,
  getMigrationLegacyStorageRoot,
  getPersistentAndLegacyMigrationStagingRoots,
} from "./migrationPersistentArtifacts";

/** Raw untouched uploads — never overwrite originals. Writes prefer persistent data/. */
export function getUniversalMigrationStagingDir(): string {
  return path.join(getMigrationDataRoot(), "migration-staging");
}

export function ensureUniversalMigrationStagingDir(): string {
  const dir = getUniversalMigrationStagingDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** All roots where staged source files may already exist (data + legacy storage). */
export function getUniversalMigrationStagingReadRoots(): string[] {
  const roots = [
    getUniversalMigrationStagingDir(),
    path.join(getMigrationLegacyStorageRoot(), "migration-staging"),
    ...getPersistentAndLegacyMigrationStagingRoots(),
  ];
  return [...new Set(roots.map((r) => path.resolve(r)))];
}
