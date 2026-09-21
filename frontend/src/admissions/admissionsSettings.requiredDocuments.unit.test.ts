import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  newDocumentRequirement,
  requiredDocumentValidation,
} from "../schoolSettings/admissionsRequiredDocuments";
import type { AdmissionsRequiredDocument } from "./admissionsSettingsApi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsSource = fs.readFileSync(
  path.join(__dirname, "../schoolSettings/components/AdmissionsSettingsTab.tsx"),
  "utf8"
);

const added = newDocumentRequirement(0);
assert.equal(added.required, false);
assert.equal(added.allowMultiple, false);
assert.equal(added.maxCount, 1);
assert.equal(added.condition, null);

const valid: AdmissionsRequiredDocument[] = [
  {
    key: "birth_certificate",
    label: "Certified copy of learner’s birth certificate",
    required: true,
    allowMultiple: false,
    maxCount: 1,
    condition: null,
  },
  {
    key: "parent_id",
    label: "Certified copy of parent/guardian ID documents",
    required: true,
    allowMultiple: true,
    maxCount: 4,
    condition: null,
  },
  {
    key: "permanent_residence_permit",
    label: "Copy of permanent residence permit",
    required: true,
    allowMultiple: false,
    maxCount: 1,
    condition: { type: "learner_citizenship_not_south_african" },
  },
];
assert.equal(requiredDocumentValidation(valid), null);
assert.match(
  requiredDocumentValidation([...valid, { ...valid[0] }]) || "",
  /Duplicate document key/
);
assert.match(
  requiredDocumentValidation([{ ...valid[0], key: "../unsafe" }]) || "",
  /lowercase letters/
);
assert.match(
  requiredDocumentValidation([{ ...valid[0], key: "proof_of_payment" }]) || "",
  /separate payment flow/
);
assert.match(
  requiredDocumentValidation([
    { ...valid[1], maxCount: 21 },
  ]) || "",
  /between 1 and 20/
);

assert.match(settingsSource, /requiredDocuments:\s*draft\.requiredDocuments/);
assert.match(
  settingsSource,
  /draft\.requiredDocuments\.length === 0[\s\S]*No supporting document requirements have been configured yet\./
);

function buttonBlock(label: string): string {
  const blocks = settingsSource.match(/<button[\s\S]*?<\/button>/g) || [];
  const block = blocks.find((item) => item.includes(label));
  assert.ok(block, `missing ${label} button`);
  return block;
}

const addButton = buttonBlock("Add document requirement");
const removeButton = buttonBlock("Remove requirement");
assert.match(addButton, /className="school-settings-btn school-settings-btn--outline"/);
assert.match(removeButton, /className="school-settings-btn school-settings-btn--outline"/);
assert.match(settingsSource, /learner_citizenship_not_south_african/);
assert.match(settingsSource, /active or pending application/);
assert.ok(!/proof_of_payment",\s*"Proof/.test(settingsSource));

console.log("✓ admissions required-documents settings editor validation and round-trip guards");
