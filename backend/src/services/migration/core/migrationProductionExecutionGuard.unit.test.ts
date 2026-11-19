/**
 * Phase 1 — production / protected-school / exact-school-id migration write guard.
 * Run: npx tsx src/services/migration/core/migrationProductionExecutionGuard.unit.test.ts
 */

import assert from "assert";
import {
  ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV,
  CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV,
  CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV,
  MIGRATION_PRODUCTION_GUARD_BLOCKED,
  MIGRATION_PROTECTED_SCHOOL_BLOCKED,
  MIGRATION_SCHOOL_ID_GUARD_BLOCKED,
  PROTECTED_DA_SILVA_SCHOOL_ID,
  PROTECTED_FLY_EAGLE_SCHOOL_ID,
  assertMigrationWriteAllowed,
  isInvalidAuthorisedMigrationSchoolIdConfig,
  requireMigrationWriteAllowed,
} from "./migrationProductionExecutionGuard";

const SYNTHETIC = "cm_synthetic_ok_school_001";
const OTHER = "cm_other_school_002";

function withEnv(patch: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function testDisposableSchoolAllowedLocally(): void {
  withEnv(
    {
      NODE_ENV: "test",
      RENDER: undefined,
      RENDER_SERVICE_ID: undefined,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: undefined,
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: undefined,
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: "synthetic-school-phase1",
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, true);
    }
  );
  console.log("✓ disposable school allowed locally");
}

function testProtectedSchoolsBlockedByDefault(): void {
  withEnv(
    {
      NODE_ENV: "test",
      RENDER: undefined,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      for (const schoolId of [PROTECTED_DA_SILVA_SCHOOL_ID, PROTECTED_FLY_EAGLE_SCHOOL_ID]) {
        const result = assertMigrationWriteAllowed({
          targetSchoolId: schoolId,
          operation: "Complete Migration",
        });
        assert.strictEqual(result.ok, false);
        if (!result.ok) {
          assert.strictEqual(result.code, MIGRATION_PROTECTED_SCHOOL_BLOCKED);
          assert.ok(result.message.includes(MIGRATION_PROTECTED_SCHOOL_BLOCKED));
        }
        assert.throws(
          () =>
            requireMigrationWriteAllowed({
              targetSchoolId: schoolId,
              operation: "Apply Migration",
            }),
          /MIGRATION_PROTECTED_SCHOOL_BLOCKED/
        );
      }
    }
  );
  console.log("✓ Da Silva + Fly Eagle blocked without explicit allow");
}

function testProductionMissingConfirmBlocked(): void {
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: undefined,
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: SYNTHETIC,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: SYNTHETIC,
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.code, MIGRATION_PRODUCTION_GUARD_BLOCKED);
      }
    }
  );
  console.log("✓ missing global confirmation → BLOCKED");
}

function testProductionMissingSchoolIdBlocked(): void {
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: undefined,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: SYNTHETIC,
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.code, MIGRATION_SCHOOL_ID_GUARD_BLOCKED);
        assert.ok(result.message.includes(CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV));
      }
    }
  );
  console.log("✓ missing exact-school ID → BLOCKED");
}

function testProductionWrongSchoolBlocked(): void {
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: SYNTHETIC,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: OTHER,
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.code, MIGRATION_SCHOOL_ID_GUARD_BLOCKED);
        assert.ok(result.message.includes(OTHER));
      }
    }
  );
  console.log("✓ wrong destination school → BLOCKED");
}

function testProductionCorrectSchoolAllowed(): void {
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: SYNTHETIC,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: SYNTHETIC,
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, true);
    }
  );
  console.log("✓ correct destination school with both controls → ALLOWED");
}

function testProtectedStillBlockedEvenWithConfirmAndSchoolId(): void {
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: PROTECTED_DA_SILVA_SCHOOL_ID,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const da = assertMigrationWriteAllowed({
        targetSchoolId: PROTECTED_DA_SILVA_SCHOOL_ID,
        operation: "Complete Migration",
      });
      assert.strictEqual(da.ok, false);
      if (!da.ok) assert.strictEqual(da.code, MIGRATION_PROTECTED_SCHOOL_BLOCKED);
    }
  );
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: PROTECTED_FLY_EAGLE_SCHOOL_ID,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const fe = assertMigrationWriteAllowed({
        targetSchoolId: PROTECTED_FLY_EAGLE_SCHOOL_ID,
        operation: "Apply Migration",
      });
      assert.strictEqual(fe.ok, false);
      if (!fe.ok) assert.strictEqual(fe.code, MIGRATION_PROTECTED_SCHOOL_BLOCKED);
    }
  );
  console.log("✓ protected Da Silva / Fly Eagle → BLOCKED (allow override still required)");
}

function testWildcardAndEmptySchoolIdConfigFailClosed(): void {
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig(undefined), true);
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig(""), true);
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig("   "), true);
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig("*"), true);
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig("cm_*"), true);
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig("a,b"), true);
  assert.strictEqual(isInvalidAuthorisedMigrationSchoolIdConfig(SYNTHETIC), false);

  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: "*",
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: SYNTHETIC,
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.strictEqual(result.code, MIGRATION_SCHOOL_ID_GUARD_BLOCKED);
    }
  );
  console.log("✓ wildcard / empty school-id config → fail-closed BLOCKED");
}

function testEmptyDestinationBlocked(): void {
  const result = assertMigrationWriteAllowed({
    targetSchoolId: "",
    operation: "Complete Migration",
  });
  assert.strictEqual(result.ok, false);
  console.log("✓ empty destination school blocked");
}

function testDirectApiBypassAttemptsBlocked(): void {
  withEnv(
    {
      NODE_ENV: "production",
      RENDER: "true",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
      [CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV]: SYNTHETIC,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      for (const operation of [
        "Apply Migration",
        "Post Migration Ledger Transaction",
        "Apply Parent/Family Migration",
        "Apply Academic Migration",
        "Legacy Migration Import",
        "Apply Migration Top-up Payments",
      ]) {
        assert.throws(
          () =>
            requireMigrationWriteAllowed({
              targetSchoolId: OTHER,
              operation,
            }),
          /MIGRATION_SCHOOL_ID_GUARD_BLOCKED/
        );
        requireMigrationWriteAllowed({
          targetSchoolId: SYNTHETIC,
          operation,
        });
      }
    }
  );
  console.log("✓ direct API-style bypass attempts for wrong school → BLOCKED");
}

function main(): void {
  testDisposableSchoolAllowedLocally();
  testProtectedSchoolsBlockedByDefault();
  testProductionMissingConfirmBlocked();
  testProductionMissingSchoolIdBlocked();
  testProductionWrongSchoolBlocked();
  testProductionCorrectSchoolAllowed();
  testProtectedStillBlockedEvenWithConfirmAndSchoolId();
  testWildcardAndEmptySchoolIdConfigFailClosed();
  testEmptyDestinationBlocked();
  testDirectApiBypassAttemptsBlocked();
  console.log("\nAll migrationProductionExecutionGuard unit tests passed.");
}

main();
