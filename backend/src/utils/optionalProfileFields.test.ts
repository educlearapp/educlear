/**
 * Optional profile field parsing (Parent DOB / Learner admission / allergies).
 * Run: npx tsx src/utils/optionalProfileFields.test.ts
 */
import assert from "assert";
import {
  OptionalProfileFieldError,
  parseEnrolmentDateFromNotes,
  parseOptionalDateOnlyField,
  parseOptionalTrimmedText,
  resolveAuthoritativeAdmissionDateYmd,
  ALLERGIES_MAX_LENGTH,
} from "./optionalProfileFields";

function testBlankToNull() {
  assert.equal(parseOptionalDateOnlyField("", "birthDate"), null);
  assert.equal(parseOptionalDateOnlyField("  ", "birthDate"), null);
  assert.equal(parseOptionalDateOnlyField(null, "birthDate"), null);
  console.log("✓ blank → null");
}

function testValidDate() {
  const d = parseOptionalDateOnlyField("2014-03-15", "birthDate");
  assert.ok(d instanceof Date);
  assert.equal(d!.toISOString().slice(0, 10), "2014-03-15");
  console.log("✓ valid date");
}

function testInvalidDate() {
  assert.throws(
    () => parseOptionalDateOnlyField("not-a-date", "birthDate"),
    OptionalProfileFieldError
  );
  console.log("✓ invalid date rejected");
}

function testNoCreatedAtFallback() {
  const fromColumn = resolveAuthoritativeAdmissionDateYmd({
    admissionDate: new Date("2020-01-10T00:00:00.000Z"),
    notes: "Enrolment date: 2019-01-01",
  });
  assert.equal(fromColumn, "2020-01-10");
  const fromNotes = resolveAuthoritativeAdmissionDateYmd({
    admissionDate: null,
    notes: "Enrolment date: 2018-06-01",
  });
  assert.equal(fromNotes, "2018-06-01");
  const none = resolveAuthoritativeAdmissionDateYmd({
    admissionDate: null,
    notes: "No date here",
  });
  assert.equal(none, null);
  console.log("✓ admissionDate preferred; notes transitional; never invent from createdAt");
}

function testNotesParserStrict() {
  assert.equal(parseEnrolmentDateFromNotes("Enrolment date: 2021-02-03"), "2021-02-03");
  assert.equal(parseEnrolmentDateFromNotes("Enrolment date: 99-99-99"), null);
  assert.equal(parseEnrolmentDateFromNotes(""), null);
  console.log("✓ notes enrolment date parser");
}

function testAllergiesTrimMax() {
  assert.equal(parseOptionalTrimmedText("  nuts  ", { maxLength: 100, fieldLabel: "allergies" }), "nuts");
  assert.equal(parseOptionalTrimmedText("", { maxLength: 100, fieldLabel: "allergies" }), null);
  assert.throws(
    () =>
      parseOptionalTrimmedText("x".repeat(ALLERGIES_MAX_LENGTH + 1), {
        maxLength: ALLERGIES_MAX_LENGTH,
        fieldLabel: "allergies",
      }),
    OptionalProfileFieldError
  );
  console.log("✓ allergies trim / max length");
}

testBlankToNull();
testValidDate();
testInvalidDate();
testNoCreatedAtFallback();
testNotesParserStrict();
testAllergiesTrimMax();
console.log("\nAll optionalProfileFields tests passed.");
