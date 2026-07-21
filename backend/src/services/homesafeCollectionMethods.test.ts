/**
 * HomeSafe expanded collection-method unit tests (no DB).
 * Run: node dist/services/homesafeCollectionMethods.test.js
 */
import {
  collectionMethodLabel,
  normalizeHomeSafeCollectionMethod,
  HOMESAFE_COLLECTION_METHODS,
} from "./homesafeService";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function main() {
  const values = HOMESAFE_COLLECTION_METHODS as readonly string[];
  for (const expected of [
    "PARENT",
    "UNCLE",
    "SIBLING",
    "GRANDPARENT",
    "BOLT",
    "SCHOOL_TRANSPORT",
    "TAXI",
    "OTHER",
  ]) {
    assert(values.includes(expected), `missing selectable ${expected}`);
    assert(normalizeHomeSafeCollectionMethod(expected) === expected, `normalize ${expected}`);
  }
  assert(!values.includes("TRANSPORT"), "TRANSPORT must not be offered in new UI list");
  assert(normalizeHomeSafeCollectionMethod("TRANSPORT") === "TRANSPORT", "legacy TRANSPORT accepted");
  assert(collectionMethodLabel("TRANSPORT") === "Transport", "legacy label");
  assert(collectionMethodLabel("BOLT") === "Bolt", "Bolt label");
  assert(collectionMethodLabel("TAXI") === "Taxi", "Taxi label");
  assert(collectionMethodLabel("SCHOOL_TRANSPORT") === "School Transport", "School Transport label");
  assert(normalizeHomeSafeCollectionMethod("NEIGHBOUR") === null, "unknown rejected");
  console.log("homesafeCollectionMethods.test.ts: OK");
}

main();
