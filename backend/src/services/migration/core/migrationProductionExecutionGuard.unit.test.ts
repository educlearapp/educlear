/**
 * Phase 1 — production / protected-school migration write guard.
 * Run: npx tsx src/services/migration/core/migrationProductionExecutionGuard.unit.test.ts
 */

import assert from "assert";
import {
  ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV,
  CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV,
  MIGRATION_PRODUCTION_GUARD_BLOCKED,
  MIGRATION_PROTECTED_SCHOOL_BLOCKED,
  PROTECTED_DA_SILVA_SCHOOL_ID,
  PROTECTED_FLY_EAGLE_SCHOOL_ID,
  assertMigrationWriteAllowed,
  requireMigrationWriteAllowed,
} from "./migrationProductionExecutionGuard";

function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void
): void {
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

function testProductionRequiresConfirmation(): void {
  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: undefined,
      [ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV]: undefined,
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: "synthetic-school-phase1",
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.code, MIGRATION_PRODUCTION_GUARD_BLOCKED);
      }
    }
  );

  withEnv(
    {
      NODE_ENV: "production",
      [CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV]: "true",
    },
    () => {
      const result = assertMigrationWriteAllowed({
        targetSchoolId: "synthetic-school-phase1",
        operation: "Complete Migration",
      });
      assert.strictEqual(result.ok, true);
    }
  );
  console.log("✓ production requires CONFIRM_PRODUCTION_MIGRATION_WRITE");
}

function testIncorrectDestinationStillNeedsSchoolId(): void {
  const result = assertMigrationWriteAllowed({
    targetSchoolId: "",
    operation: "Complete Migration",
  });
  assert.strictEqual(result.ok, false);
  console.log("✓ empty destination school blocked");
}

function main(): void {
  testDisposableSchoolAllowedLocally();
  testProtectedSchoolsBlockedByDefault();
  testProductionRequiresConfirmation();
  testIncorrectDestinationStillNeedsSchoolId();
  console.log("\nAll migrationProductionExecutionGuard unit tests passed.");
}

main();
