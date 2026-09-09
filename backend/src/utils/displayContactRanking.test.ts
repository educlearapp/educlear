/**
 * Shared display contact ranking regression.
 * Run: npx tsx src/utils/displayContactRanking.test.ts
 */
import assert from "assert";
import {
  pickAlternateContact,
  rankDisplayParentsForLearner,
  scoreDisplayContact,
} from "./displayContactRanking";

assert.equal(scoreDisplayContact({ isPrimary: true }), 12); // +10 primary +2 billing default
assert.equal(scoreDisplayContact({ isPayingPerson: true }), 8); // +6 paying +2 billing default
assert.equal(scoreDisplayContact({ communicationBilling: false }), 0);
assert.equal(scoreDisplayContact({ communicationBilling: true }), 2);
assert.equal(
  scoreDisplayContact({ isPrimary: true, isPayingPerson: true, communicationBilling: true }),
  18
);
console.log("✓ scoring weights match Outstanding Accounts (+10/+6/+2)");

assert.equal(pickAlternateContact({ workNo: "011", homeNo: "022" }), "011");
assert.equal(pickAlternateContact({ workNo: "", homeNo: "022" }), "022");
assert.equal(pickAlternateContact({ workNo: null, homeNo: null }), null);
console.log("✓ alternate workNo → homeNo");

const winner = rankDisplayParentsForLearner([
  {
    id: "p-pay",
    firstName: "Pay",
    surname: "Person",
    isPrimary: false,
    isPayingPerson: true,
    communicationBilling: true,
  },
  {
    id: "p-pri",
    firstName: "Primary",
    surname: "Guardian",
    isPrimary: true,
    isPayingPerson: false,
    communicationBilling: true,
  },
]);
assert.equal(winner?.id, "p-pri");
assert.ok((winner?.score || 0) > 6);
console.log("✓ isPrimary beats isPayingPerson");

console.log("\nAll displayContactRanking tests passed.");
