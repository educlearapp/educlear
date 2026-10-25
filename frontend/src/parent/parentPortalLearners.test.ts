/**
 * Parent Portal multi-child linking, selection, isolation & billing scope.
 * Run: npx tsx src/parent/parentPortalLearners.test.ts
 */
import assert from "assert";
import {
  formatOutstandingBalanceLabel,
  listSelectableLearners,
  normalizeLinkedLearners,
  parseBillingBalance,
  resolveFamilyBillingLearnerIds,
  resolveSelectedLearnerId,
  type MeLearnerRow,
  type ParentPortalLearner,
  type ParentPortalLinkRow,
} from "./parentPortalLearners";

function learner(
  id: string,
  opts: Partial<ParentPortalLearner> & { firstName?: string; lastName?: string } = {}
): ParentPortalLearner {
  return {
    id,
    firstName: opts.firstName || `Child-${id}`,
    lastName: opts.lastName || "Test",
    grade: opts.grade || "Grade 1",
    className: opts.className ?? "A",
    admissionNo: opts.admissionNo ?? null,
    familyAccountId: opts.familyAccountId ?? null,
    familyAccount: opts.familyAccount ?? null,
    schoolId: opts.schoolId ?? "school-a",
  };
}

function meRow(id: string, opts: Partial<ParentPortalLearner> = {}): MeLearnerRow {
  return {
    linkId: `link-${id}`,
    relation: "Mother",
    isPrimary: true,
    learner: learner(id, opts),
  };
}

function assertIds(rows: ParentPortalLinkRow[], expected: string[]) {
  assert.deepStrictEqual(
    rows.map((r) => r.learner.id),
    expected,
    `expected learner ids ${expected.join(",")} got ${rows.map((r) => r.learner.id).join(",")}`
  );
}

// ——— 1 linked learner ———
{
  const rows = normalizeLinkedLearners([meRow("L1")], null);
  assert.equal(listSelectableLearners(rows).length, 1);
  assert.equal(resolveSelectedLearnerId("", rows, "L1"), "L1");
  assert.equal(resolveSelectedLearnerId("L1", rows, null), "L1");
}

// ——— 2 linked learners ———
{
  const rows = normalizeLinkedLearners([meRow("L1"), meRow("L2")], null);
  assertIds(rows, ["L1", "L2"]);
  assert.equal(resolveSelectedLearnerId("", rows, null), "L1");
  assert.equal(resolveSelectedLearnerId("L2", rows, null), "L2");
  assert.equal(resolveSelectedLearnerId("L1", rows, "L2"), "L1", "keep current when still linked");
}

// ——— 3 linked learners ———
{
  const rows = normalizeLinkedLearners([meRow("A"), meRow("B"), meRow("C")], [{ id: "A" } as any]);
  assertIds(rows, ["A", "B", "C"]);
  assert.equal(rows.length, 3, "/me wins; do not truncate to dashboard slice");
}

// ——— 4+ linked learners ———
{
  const me = ["W", "X", "Y", "Z", "V"].map((id) => meRow(id));
  const rows = normalizeLinkedLearners(me, null);
  assert.equal(rows.length, 5, "no artificial cap on linked children");
  assertIds(rows, ["W", "X", "Y", "Z", "V"]);
  for (const id of ["W", "X", "Y", "Z", "V"]) {
    assert.equal(resolveSelectedLearnerId(id, rows, null), id);
  }
}

// ——— Switching learners ———
{
  const rows = normalizeLinkedLearners([meRow("L1"), meRow("L2"), meRow("L3")], null);
  let selected = resolveSelectedLearnerId("", rows, null);
  assert.equal(selected, "L1");
  selected = resolveSelectedLearnerId("L2", rows, null);
  assert.equal(selected, "L2");
  selected = resolveSelectedLearnerId("L3", rows, null);
  assert.equal(selected, "L3");
}

// ——— Stale link: selected id no longer in /me ———
{
  const rows = normalizeLinkedLearners([meRow("L1"), meRow("L2")], null);
  const next = resolveSelectedLearnerId("STALE-GONE", rows, null);
  assert.equal(next, "L1", "stale selection falls back to first linked learner");
}

// ——— Stale / broken rows dropped ———
{
  const rows = normalizeLinkedLearners(
    [
      meRow("L1"),
      { linkId: "bad", relation: null, learner: { id: "", firstName: "X", lastName: "Y", grade: "1", className: null } },
      { linkId: "missing", relation: null } as MeLearnerRow,
    ],
    null
  );
  assertIds(rows, ["L1"]);
}

// ——— Dashboard fallback when session empty ———
{
  const rows = normalizeLinkedLearners(null, [
    learner("D1", { firstName: "Dash" }),
    learner("D2", { firstName: "Board" }),
  ]);
  assertIds(rows, ["D1", "D2"]);
}

// ——— /me preferred over incomplete dashboard ———
{
  const rows = normalizeLinkedLearners([meRow("L1"), meRow("L2"), meRow("L3")], [
    learner("L1"),
  ]);
  assertIds(rows, ["L1", "L2", "L3"]);
}

// ——— Deduplicate duplicate link rows ———
{
  const rows = normalizeLinkedLearners([meRow("L1"), meRow("L1"), meRow("L2")], null);
  assertIds(rows, ["L1", "L2"]);
}

// ——— Cross-school isolation in family billing scope ———
{
  const rows = normalizeLinkedLearners(
    [
      meRow("L1", {
        schoolId: "school-a",
        familyAccountId: "fa-1",
        familyAccount: { id: "fa-1", accountRef: "FAM001" },
      }),
      meRow("L2", {
        schoolId: "school-a",
        familyAccountId: "fa-1",
        familyAccount: { id: "fa-1", accountRef: "FAM001" },
      }),
      meRow("L-OTHER", {
        schoolId: "school-b",
        familyAccountId: "fa-1",
        familyAccount: { id: "fa-1", accountRef: "FAM001" },
      }),
    ],
    null
  );
  const scope = resolveFamilyBillingLearnerIds(rows, "L1", { expectedSchoolId: "school-a" });
  assert.deepStrictEqual(scope.learnerIds.sort(), ["L1", "L2"]);
  assert.ok(!scope.learnerIds.includes("L-OTHER"), "cross-school learner excluded from billing scope");
  assert.equal(scope.accountRef, "FAM001");
}

// ——— Family billing: same familyAccountId groups siblings ———
{
  const rows = normalizeLinkedLearners(
    [
      meRow("A", {
        familyAccountId: "fa",
        familyAccount: { id: "fa", accountRef: "REF-A" },
      }),
      meRow("B", {
        familyAccountId: "fa",
        familyAccount: { id: "fa", accountRef: "REF-A" },
      }),
      meRow("C", {
        familyAccountId: "other",
        familyAccount: { id: "other", accountRef: "REF-C" },
      }),
    ],
    null
  );
  const scopeA = resolveFamilyBillingLearnerIds(rows, "A");
  assert.deepStrictEqual(scopeA.learnerIds.sort(), ["A", "B"]);
  const scopeC = resolveFamilyBillingLearnerIds(rows, "C");
  assert.deepStrictEqual(scopeC.learnerIds, ["C"]);
}

// ——— Family billing: accountRef grouping when no familyAccountId ———
{
  const rows = normalizeLinkedLearners(
    [
      meRow("P1", { familyAccount: { id: "", accountRef: "SHARED" } }),
      meRow("P2", { familyAccount: { id: "", accountRef: "SHARED" } }),
      meRow("P3", { familyAccount: { id: "", accountRef: "OTHER" } }),
    ],
    null
  );
  // familyAccountId empty string → treat as no family id; use accountRef
  const scope = resolveFamilyBillingLearnerIds(rows, "P1");
  assert.deepStrictEqual(scope.learnerIds.sort(), ["P1", "P2"]);
}

// ——— Family billing: no family → anchor only ———
{
  const rows = normalizeLinkedLearners([meRow("SOLO"), meRow("OTHER")], null);
  const scope = resolveFamilyBillingLearnerIds(rows, "SOLO");
  assert.deepStrictEqual(scope.learnerIds, ["SOLO"]);
}

// ——— Family billing: invalid anchor with multi-child → empty (do not invent) ———
{
  const rows = normalizeLinkedLearners([meRow("L1"), meRow("L2")], null);
  const scope = resolveFamilyBillingLearnerIds(rows, "MISSING");
  assert.deepStrictEqual(scope.learnerIds, []);
  assert.equal(scope.accountRef, "");
}

// ——— Balance label: never invent R0.00 for failed/pending ———
{
  assert.equal(formatOutstandingBalanceLabel(null, true), "Loading…");
  assert.equal(formatOutstandingBalanceLabel(null, false), "—");
  assert.equal(formatOutstandingBalanceLabel({ balance: Number.NaN }, false), "—");
  assert.match(formatOutstandingBalanceLabel({ balance: 0 }, false), /^R 0[,.]00$/);
  assert.ok(formatOutstandingBalanceLabel({ balance: 12200 }, false).includes("12"));
  assert.equal(parseBillingBalance(undefined), null);
  assert.equal(parseBillingBalance("x"), null);
  assert.equal(parseBillingBalance(0), 0);
  assert.equal(parseBillingBalance("450.5"), 450.5);
}

// ——— Auto-select when single child ———
{
  const rows = normalizeLinkedLearners([meRow("ONLY")], null);
  assert.equal(resolveSelectedLearnerId("", rows, null), "ONLY");
  assert.equal(resolveSelectedLearnerId("", rows, "ONLY"), "ONLY");
}

console.log("parentPortalLearners.test: PASS");
