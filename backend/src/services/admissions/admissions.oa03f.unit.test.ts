/**
 * OA-03F unit tests — completeness, filters, auth, serialization (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03f.unit.test.ts
 */
import assert from "assert";

import { evaluateAdmissionsSettingsAuth } from "../../middleware/requireAdmissionsSettingsAuth";
import { permissionsForRole } from "../../utils/userPermissions";
import {
  assertNoSensitiveAdmissionsFields,
  buildStaffApplicationsWhere,
  deriveConfiguredDocumentCompleteness,
  deriveDocumentCompleteness,
  parseRequiredDocumentTypes,
  StaffAdmissionsError,
} from "./staffAdmissionsReadService";

function auth(schoolId: string, appRole: string, permissions = permissionsForRole(appRole)) {
  return {
    userId: "u1",
    schoolId,
    email: "a@ex.com",
    role: "SCHOOL_ADMIN",
    appRole,
    authorizedSchoolId: schoolId,
    permissions,
  };
}

function main() {
  // Document completeness
  assert.deepStrictEqual(
    parseRequiredDocumentTypes([
      { key: "birth_certificate", required: true },
      { key: "optional_form", required: false },
      { key: "proof_of_payment", required: true },
      { key: "  ", required: true },
    ]),
    ["birth_certificate"]
  );

  const complete = deriveDocumentCompleteness({
    requiredDocumentTypes: ["birth_certificate", "parent_id"],
    activeDocumentTypes: ["parent_id", "birth_certificate", "supporting_document"],
  });
  assert.strictEqual(complete.documentsComplete, true);
  assert.deepStrictEqual(complete.missingDocumentTypes, []);

  const incomplete = deriveDocumentCompleteness({
    requiredDocumentTypes: ["birth_certificate", "parent_id"],
    activeDocumentTypes: ["parent_id"],
  });
  assert.strictEqual(incomplete.documentsComplete, false);
  assert.deepStrictEqual(incomplete.missingDocumentTypes, ["birth_certificate"]);

  const conditionalDocuments = [
    {
      key: "permanent_residence_permit",
      label: "Permanent residence permit",
      required: true,
      condition: { type: "learner_citizenship_not_south_african" },
    },
  ];
  assert.strictEqual(
    deriveConfiguredDocumentCompleteness({
      requiredDocuments: conditionalDocuments,
      activeDocumentTypes: [],
      learnerCitizenship: "South African",
    }).documentsComplete,
    true
  );
  assert.deepStrictEqual(
    deriveConfiguredDocumentCompleteness({
      requiredDocuments: conditionalDocuments,
      activeDocumentTypes: [],
      learnerCitizenship: "Zimbabwean",
    }).missingDocumentTypes,
    ["permanent_residence_permit"]
  );
  assert.deepStrictEqual(
    deriveConfiguredDocumentCompleteness({
      requiredDocuments: conditionalDocuments,
      activeDocumentTypes: [],
      learnerCitizenship: "",
    }).unresolvedConditionTypes,
    ["permanent_residence_permit"]
  );

  // Filters
  const whereBase = buildStaffApplicationsWhere("school-a", {});
  assert.strictEqual(whereBase.schoolId, "school-a");
  assert.deepStrictEqual(whereBase.status, { not: "DRAFT" });

  const whereDrafts = buildStaffApplicationsWhere("school-a", { includeDrafts: true });
  assert.strictEqual(whereDrafts.status, undefined);

  const whereStatus = buildStaffApplicationsWhere("school-a", { status: "SUBMITTED,UNDER_REVIEW" });
  assert.deepStrictEqual(whereStatus.status, { in: ["SUBMITTED", "UNDER_REVIEW"] });

  const wherePay = buildStaffApplicationsWhere("school-a", { paymentStatus: "AWAITING_PAYMENT" });
  assert.deepStrictEqual(wherePay.feeRecord, {
    is: { paymentStatus: { in: ["AWAITING_PAYMENT"] } },
  });

  const whereSearch = buildStaffApplicationsWhere("school-a", { q: "APP-2027" });
  assert.ok(Array.isArray(whereSearch.OR));

  const whereGrade = buildStaffApplicationsWhere("school-a", {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
  });
  assert.strictEqual(whereGrade.requestedGrade, "Grade 1");
  assert.strictEqual(whereGrade.intakeYear, 2027);

  assert.throws(
    () => buildStaffApplicationsWhere("school-a", { status: "NOT_A_STATUS" }),
    (err: unknown) => err instanceof StaffAdmissionsError && err.code === "INVALID_STATUS"
  );

  // Auth reuse — admissions.view required
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: null,
      requireAction: "view",
    });
    assert.strictEqual(d.allowed, false);
    if (!d.allowed) assert.strictEqual(d.status, 401);
  }
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Teacher"),
      requireAction: "view",
    });
    assert.strictEqual(d.allowed, false);
    if (!d.allowed) assert.strictEqual(d.code, "ADMISSIONS_FORBIDDEN");
  }
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Finance"),
      requireAction: "view",
    });
    assert.strictEqual(d.allowed, true);
  }
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Admin"),
      requireAction: "view",
      requestSchoolId: "school-b",
    });
    assert.strictEqual(d.allowed, false);
    if (!d.allowed) assert.strictEqual(d.code, "SCHOOL_MISMATCH");
  }

  // Sensitive field guard
  assert.doesNotThrow(() =>
    assertNoSensitiveAdmissionsFields({
      id: "x",
      applicationNumber: "APP-2027-000001",
      documents: [{ id: "d1", originalFileName: "a.pdf" }],
    })
  );
  assert.throws(() =>
    assertNoSensitiveAdmissionsFields({ accessTokenHash: "abc" })
  );
  assert.throws(() =>
    assertNoSensitiveAdmissionsFields({ storageKey: "school/app/file.pdf" })
  );

  console.log("OA-03F unit tests passed");
}

main();
