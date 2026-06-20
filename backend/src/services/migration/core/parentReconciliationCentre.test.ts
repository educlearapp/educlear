import assert from "assert";
import {
  buildParentReconciliationSuggestionsForParents,
  type ParentForReconciliation,
} from "./parentReconciliationCentre";

function parent(input: Partial<ParentForReconciliation> & { id: string }): ParentForReconciliation {
  return {
    firstName: "Parent",
    surname: "Guardian",
    relationship: "Parent",
    cellNo: "",
    email: null,
    links: [],
    ...input,
  };
}

function testSuggestsLikelyDuplicateWithoutResolvingIdentity(): void {
  const parents = [
    parent({
      id: "p1",
      firstName: "Maria",
      surname: "Smith",
      relationship: "Mother",
      cellNo: "072 123 4567",
      email: "maria@example.com",
    }),
    parent({
      id: "p2",
      firstName: "M",
      surname: "Smith",
      relationship: "Mother",
      cellNo: "0721234567",
      email: "MARIA@example.com",
    }),
  ];

  const suggestions = buildParentReconciliationSuggestionsForParents({
    parents,
    batchParentIds: new Set(["p1", "p2"]),
  });

  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].status, "suggested");
  assert.deepStrictEqual(suggestions[0].matchSignals, [
    "same_cellphone",
    "same_email",
    "same_relationship",
    "similar_names",
  ]);
  assert.strictEqual(suggestions[0].action, "review_merge_or_ignore");
}

function testDifferentRelationshipIsNotSuggested(): void {
  const parents = [
    parent({
      id: "p1",
      firstName: "Alex",
      surname: "Parent",
      relationship: "Mother",
      cellNo: "0711111111",
      email: "family@example.com",
    }),
    parent({
      id: "p2",
      firstName: "Alex",
      surname: "Parent",
      relationship: "Father",
      cellNo: "0711111111",
      email: "family@example.com",
    }),
  ];

  const suggestions = buildParentReconciliationSuggestionsForParents({
    parents,
    batchParentIds: new Set(["p1", "p2"]),
  });

  assert.strictEqual(suggestions.length, 0);
}

testSuggestsLikelyDuplicateWithoutResolvingIdentity();
testDifferentRelationshipIsNotSuggested();
console.log("parentReconciliationCentre.test.ts: ok");
