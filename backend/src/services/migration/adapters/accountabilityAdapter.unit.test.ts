/**
 * AccountAbility stub — no invented mappings before export samples.
 * Run: npx tsx src/services/migration/adapters/accountabilityAdapter.unit.test.ts
 */

import assert from "assert";
import { getMigrationAdapterForSystem } from "../core/resolveMigrationAdapter";
import {
  ACCOUNTABILITY_UNSUPPORTED_REASON,
  accountabilityAdapter,
} from "./accountabilityAdapter";
import { MIGRATION_ADAPTERS } from "./index";

async function main(): Promise<void> {
  assert.ok(
    MIGRATION_ADAPTERS.some((a) => a.source === "accountability"),
    "accountability registered in adapter list"
  );
  assert.strictEqual(getMigrationAdapterForSystem("accountability")?.source, "accountability");

  assert.strictEqual(await accountabilityAdapter.detect(["anything.xls"]), false);

  const parsed = (await accountabilityAdapter.parse(["x.xls"])) as {
    supported: boolean;
    reason: string;
  };
  assert.strictEqual(parsed.supported, false);
  assert.ok(parsed.reason.includes("samples"));

  const mapped = (await accountabilityAdapter.map(null)) as {
    supported: boolean;
    flaggedForReview: unknown[];
  };
  assert.strictEqual(mapped.supported, false);
  assert.ok(Array.isArray(mapped.flaggedForReview) && mapped.flaggedForReview.length > 0);

  const validated = (await accountabilityAdapter.validate(null)) as {
    canProceed: boolean;
  };
  assert.strictEqual(validated.canProceed, false);

  await assert.rejects(
    () => accountabilityAdapter.stage(null),
    (e: Error) => e.message === ACCOUNTABILITY_UNSUPPORTED_REASON
  );

  console.log("✓ AccountAbility stub refuses detect/parse/map/stage without samples");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
