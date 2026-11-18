/**
 * Phase 1 — durable artifact dual-root + restart recovery (local only).
 * Run: npx tsx src/services/migration/core/migrationPersistentArtifacts.unit.test.ts
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ensureMigrationArtifactWriteDir,
  getMigrationArtifactLegacyDir,
  getMigrationArtifactWriteDir,
  listMigrationArtifactIds,
  readMigrationArtifactJson,
  resolveMigrationArtifactReadPath,
  setMigrationArtifactRootsForTests,
  writeMigrationArtifactJson,
} from "./migrationPersistentArtifacts";

function withTempRoots(fn: (roots: { dataRoot: string; storageRoot: string }) => void): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-mig-artifacts-"));
  const dataRoot = path.join(base, "data");
  const storageRoot = path.join(base, "storage");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  setMigrationArtifactRootsForTests({ dataRoot, storageRoot });
  try {
    fn({ dataRoot, storageRoot });
  } finally {
    setMigrationArtifactRootsForTests(null);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function testWritesPreferPersistentData(): void {
  withTempRoots(({ dataRoot, storageRoot }) => {
    const written = writeMigrationArtifactJson("sessions", "school_test_a", {
      schoolId: "school_test_a",
      step: "upload",
    });
    assert.ok(written.startsWith(path.join(dataRoot, "migration-sessions")));
    assert.ok(!written.includes(path.join(storageRoot, "migration-sessions")));
    const read = readMigrationArtifactJson<{ schoolId: string }>("sessions", "school_test_a");
    assert.strictEqual(read?.schoolId, "school_test_a");
  });
  console.log("✓ writes prefer data/ (persistent disk)");
}

function testLegacyStorageStillReadableWithoutMove(): void {
  withTempRoots(({ dataRoot, storageRoot }) => {
    const legacyDir = path.join(storageRoot, "migration-stages");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, "stage_legacy_1.json");
    fs.writeFileSync(
      legacyFile,
      JSON.stringify({ stageId: "stage_legacy_1", preserved: true }),
      "utf8"
    );

    const resolved = resolveMigrationArtifactReadPath("stages", "stage_legacy_1");
    assert.strictEqual(resolved, legacyFile);

    // New write must not delete or overwrite the legacy file
    writeMigrationArtifactJson("stages", "stage_new_1", { stageId: "stage_new_1" });
    assert.ok(fs.existsSync(legacyFile), "legacy artifact must remain untouched");
    assert.ok(
      fs.existsSync(path.join(dataRoot, "migration-stages", "stage_new_1.json")),
      "new artifact under data/"
    );
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(legacyFile, "utf8")),
      { stageId: "stage_legacy_1", preserved: true }
    );
  });
  console.log("✓ legacy storage/ readable; existing records untouched");
}

function testRestartRecoveryPrefersDataThenLegacy(): void {
  withTempRoots(({ dataRoot, storageRoot }) => {
    writeMigrationArtifactJson("orchestrator", "run_restart_1", {
      runId: "run_restart_1",
      status: "MIGRATING",
    });
    // Simulate process restart by clearing any in-memory assumption and re-reading
    setMigrationArtifactRootsForTests({ dataRoot, storageRoot });
    const afterRestart = readMigrationArtifactJson<{ status: string }>(
      "orchestrator",
      "run_restart_1"
    );
    assert.strictEqual(afterRestart?.status, "MIGRATING");

    // Data wins over legacy when both exist
    const legacyDir = getMigrationArtifactLegacyDir("orchestrator");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "run_both.json"),
      JSON.stringify({ runId: "run_both", source: "legacy" }),
      "utf8"
    );
    writeMigrationArtifactJson("orchestrator", "run_both", {
      runId: "run_both",
      source: "data",
    });
    const preferred = readMigrationArtifactJson<{ source: string }>("orchestrator", "run_both");
    assert.strictEqual(preferred?.source, "data");
    assert.ok(
      fs.existsSync(path.join(legacyDir, "run_both.json")),
      "legacy twin must not be deleted"
    );
  });
  console.log("✓ restart recovery + data-over-legacy preference");
}

function testListMergesBothRoots(): void {
  withTempRoots(() => {
    writeMigrationArtifactJson("sessions", "a", { id: "a" });
    const legacy = getMigrationArtifactLegacyDir("sessions");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "b.json"), JSON.stringify({ id: "b" }), "utf8");
    const ids = listMigrationArtifactIds("sessions");
    assert.deepStrictEqual(ids, ["a", "b"]);
    assert.ok(getMigrationArtifactWriteDir("sessions").includes("migration-sessions"));
    ensureMigrationArtifactWriteDir("sessions");
  });
  console.log("✓ list merges data/ + storage/ ids");
}

function main(): void {
  testWritesPreferPersistentData();
  testLegacyStorageStillReadableWithoutMove();
  testRestartRecoveryPrefersDataThenLegacy();
  testListMergesBothRoots();
  console.log("\nAll migrationPersistentArtifacts unit tests passed.");
}

main();
