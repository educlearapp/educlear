import assert from "node:assert/strict";

import {
  deriveRequiredDocumentCompleteness,
  evaluateRequiredDocumentApplicability,
  parseRequiredDocumentConfig,
  RequiredDocumentConfigError,
  resolveCitizenship,
} from "./requiredDocumentConfig";

function main() {
  assert.deepEqual(parseRequiredDocumentConfig([]), []);
  assert.deepEqual(parseRequiredDocumentConfig(null), []);

  const legacy = parseRequiredDocumentConfig([
    { key: "birth_certificate", label: "Birth certificate", required: true },
  ]);
  assert.deepEqual(legacy, [
    {
      key: "birth_certificate",
      label: "Birth certificate",
      required: true,
      allowMultiple: false,
      maxCount: 1,
      condition: null,
    },
  ]);

  assert.throws(
    () =>
      parseRequiredDocumentConfig(
        [
          { key: "parent_id", label: "Parent ID", required: true },
          { key: "parent_id", label: "Duplicate", required: true },
        ],
        { strict: true }
      ),
    RequiredDocumentConfigError
  );
  assert.throws(
    () =>
      parseRequiredDocumentConfig(
        [{ key: "../unsafe", label: "Unsafe", required: true }],
        { strict: true }
      ),
    RequiredDocumentConfigError
  );
  assert.throws(
    () =>
      parseRequiredDocumentConfig(
        [{ key: "proof_of_payment", label: "Proof", required: true }],
        { strict: true }
      ),
    RequiredDocumentConfigError
  );

  const configured = parseRequiredDocumentConfig(
    [
      {
        key: "parent_id",
        label: "Parent IDs",
        required: true,
        allowMultiple: true,
        maxCount: 3,
      },
      {
        key: "permanent_residence_permit",
        label: "Permanent residence permit",
        required: true,
        condition: { type: "learner_citizenship_not_south_african" },
      },
    ],
    { strict: true }
  );
  assert.equal(configured[0]?.allowMultiple, true);
  assert.equal(configured[0]?.maxCount, 3);

  for (const value of ["South African", "South Africa", "ZA", "ZAF", "RSA"]) {
    assert.equal(resolveCitizenship(value), "south_african", value);
  }
  assert.equal(resolveCitizenship("Zimbabwean"), "non_south_african");
  assert.equal(resolveCitizenship(""), "unresolved");
  assert.equal(evaluateRequiredDocumentApplicability(configured[1]!, "ZA"), "not_applicable");
  assert.equal(evaluateRequiredDocumentApplicability(configured[1]!, "Zimbabwean"), "applicable");
  assert.equal(evaluateRequiredDocumentApplicability(configured[1]!, ""), "unresolved");

  const southAfrican = deriveRequiredDocumentCompleteness({
    requirements: configured,
    activeDocumentTypes: ["parent_id", "parent_id"],
    learnerCitizenship: "South African",
  });
  assert.equal(southAfrican.documentsComplete, true);
  assert.deepEqual(southAfrican.missingDocumentTypes, []);

  const nonSouthAfrican = deriveRequiredDocumentCompleteness({
    requirements: configured,
    activeDocumentTypes: ["parent_id"],
    learnerCitizenship: "Zimbabwean",
  });
  assert.equal(nonSouthAfrican.documentsComplete, false);
  assert.deepEqual(nonSouthAfrican.missingDocumentTypes, ["permanent_residence_permit"]);

  const unresolved = deriveRequiredDocumentCompleteness({
    requirements: configured,
    activeDocumentTypes: ["parent_id"],
    learnerCitizenship: "",
  });
  assert.equal(unresolved.documentsComplete, false);
  assert.deepEqual(unresolved.unresolvedConditionTypes, ["permanent_residence_permit"]);

  const daSilvaTarget = parseRequiredDocumentConfig(
    [
      {
        key: "birth_certificate",
        label: "Certified copy of learner’s birth certificate",
        required: true,
      },
      {
        key: "parent_id",
        label: "Certified copy of parent/guardian ID documents",
        required: true,
        allowMultiple: true,
      },
      {
        key: "previous_school_report",
        label: "Latest school report",
        required: true,
      },
      {
        key: "proof_of_residence",
        label: "Proof of residential address",
        required: true,
      },
      {
        key: "permanent_residence_permit",
        label: "Copy of permanent residence permit",
        required: true,
        condition: { type: "learner_citizenship_not_south_african" },
      },
      {
        key: "previous_school_testimonial",
        label: "Testimonial from previous school",
        required: true,
      },
      {
        key: "previous_school_statement",
        label: "Latest school statement from previous school",
        required: true,
      },
    ],
    { strict: true }
  );
  assert.equal(daSilvaTarget.length, 7);
  assert.equal(daSilvaTarget.find((item) => item.key === "parent_id")?.allowMultiple, true);

  console.log("✓ required document config parsing, conditions, and completeness");
}

main();
