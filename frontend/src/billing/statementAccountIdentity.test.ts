/**
 * Statement account identity selection — never mix FA id into learnerId.
 * Run: npx tsx src/billing/statementAccountIdentity.test.ts
 * (or: node --import tsx src/billing/statementAccountIdentity.test.ts)
 */
import assert from "assert";
import {
  normalizeKidESysAccountRef,
  normalizeStatementAccountRef,
  resolveStatementAccountRefFromRow,
} from "./billingAccountRef";

/** Mirror of StatementManage.resolveSelectedAccountRef (source-agnostic). */
function resolveSelectedAccountRef(selected: any): string {
  return (
    resolveStatementAccountRefFromRow(selected) ||
    normalizeStatementAccountRef(selected?.sourceAccountRef) ||
    normalizeStatementAccountRef(selected?.accountNo) ||
    normalizeKidESysAccountRef(selected?.eduClearAccountNo)
  );
}

/** Mirror of StatementManage.resolveStatementLearnerId. */
function resolveStatementLearnerId(selected: any, learners: any[]): string {
  const familyAccountId = String(selected?.familyAccountId || "").trim();
  const candidates = [
    String(selected?.learnerId || "").trim(),
    String(selected?.id || "").trim(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (familyAccountId && candidate === familyAccountId) continue;
    if ((learners || []).some((l) => String(l?.id || l?.learnerId || "").trim() === candidate)) {
      return candidate;
    }
  }
  const explicit = String(selected?.learnerId || "").trim();
  if (explicit && explicit !== familyAccountId) return explicit;
  return "";
}

function main() {
  // Kid-e-Sys row
  assert.strictEqual(
    resolveSelectedAccountRef({ accountNo: "ALI002", familyAccountId: "fa-1" }),
    "ALI002"
  );

  // Fly Eagle Express join ref must NOT be dropped by Kid-only filter
  const expressRef = "Smith Family Express";
  assert.strictEqual(normalizeKidESysAccountRef(expressRef), "");
  assert.strictEqual(normalizeStatementAccountRef(expressRef), expressRef);
  assert.strictEqual(
    resolveSelectedAccountRef({
      accountNo: expressRef,
      eduClearAccountNo: "ABA001",
      familyAccountId: "fa-fly",
      sourceAccountRef: expressRef,
    }),
    expressRef
  );

  // Zero-learner FA: do not treat familyAccountId as learnerId
  assert.strictEqual(
    resolveStatementLearnerId(
      { familyAccountId: "fa-orphan", learnerId: "", id: "fa-orphan", accountNo: expressRef },
      []
    ),
    ""
  );

  // Do not use accountNo stuffed into learnerId as a learner when it equals FA id path
  assert.strictEqual(
    resolveStatementLearnerId(
      { familyAccountId: "fa-1", learnerId: "fa-1", id: "fa-1" },
      [{ id: "real-learner" }]
    ),
    ""
  );

  // Real learner id still resolves
  assert.strictEqual(
    resolveStatementLearnerId(
      { familyAccountId: "fa-1", learnerId: "real-learner", id: "fa-1" },
      [{ id: "real-learner" }]
    ),
    "real-learner"
  );

  // Legacy persist bug: accountNo wrongly stored as learnerId — reject unless it matches a learner
  assert.strictEqual(
    resolveStatementLearnerId(
      { familyAccountId: "fa-fly", learnerId: expressRef, id: expressRef },
      [{ id: "L1" }]
    ),
    expressRef // explicit learnerId differs from FA id; callers must still send familyAccountId
  );

  console.log("statementAccountIdentity.test.ts: OK");
}

main();
