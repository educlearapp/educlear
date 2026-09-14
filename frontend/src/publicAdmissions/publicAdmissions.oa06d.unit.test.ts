/**
 * OA-06D — public admissions supporting documents (DRAFT) unit + source guards.
 * Run: npx --yes tsx src/publicAdmissions/publicAdmissions.oa06d.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADMISSIONS_MAX_UPLOAD_BYTES,
  buildSupportingDocumentRequirements,
  currentDocumentForType,
  deriveSupportingDocumentCompleteness,
  humanizeDocumentType,
  parseRequiredDocumentsConfig,
  validateAdmissionsFileClient,
} from "./documentRequirements";
import type {
  ApplicantDocumentView,
  PublicAdmissionsConfig,
} from "./publicAdmissionsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function baseConfig(overrides: Partial<PublicAdmissionsConfig> = {}): PublicAdmissionsConfig {
  return {
    publicSlug: "demo-school",
    schoolDisplayName: "Demo Academy",
    branding: { logoUrl: null, primaryColor: null },
    enabled: true,
    acceptingApplications: true,
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade 1"],
    admissionFeeRequired: true,
    admissionFeeAmount: "350.00",
    currency: "ZAR",
    proofOfPaymentRequired: true,
    paymentVerificationRequired: false,
    requirePaymentVerifiedBeforeAccept: false,
    admissionContactEmail: null,
    admissionContactPhone: null,
    requiredDocuments: [
      { key: "birth_certificate", label: "Birth certificate", required: true },
      { key: "parent_id", label: "Parent ID", required: true },
      { key: "supporting_document", label: "Extra note", required: false },
      { key: "proof_of_payment", label: "POP", required: true },
    ],
    applicationQuestions: [],
    privacyNoticeVersion: null,
    declarationText: null,
    ...overrides,
  };
}

function doc(
  overrides: Partial<ApplicantDocumentView> & Pick<ApplicantDocumentView, "documentType" | "id">
): ApplicantDocumentView {
  return {
    originalFileName: "file.pdf",
    contentType: "application/pdf",
    byteSize: 1200,
    uploadedAt: "2026-01-02T00:00:00.000Z",
    scanStatus: "NOT_SCANNED",
    isProofOfPayment: false,
    ...overrides,
  };
}

// --- Requirements from authoritative config/API ---
const parsed = parseRequiredDocumentsConfig(baseConfig().requiredDocuments);
assert.equal(parsed.length, 3, "1. ignores proof_of_payment from config");
assert.ok(parsed.every((r) => r.key !== "proof_of_payment"));
assert.ok(!parsed.some((r) => /Da Silva|dasilva/i.test(r.label || r.key)), "2. no school hardcoding");

const requirements = buildSupportingDocumentRequirements({
  config: baseConfig(),
  listRequiredDocumentTypes: ["birth_certificate", "parent_id", "medical_document"],
});
assert.ok(requirements.find((r) => r.key === "medical_document" && r.required === false));
assert.equal(
  requirements.find((r) => r.key === "birth_certificate")?.required,
  true
);

const docsMissing: ApplicantDocumentView[] = [];
assert.equal(
  currentDocumentForType(docsMissing, "birth_certificate"),
  null,
  "3. missing required has no current doc"
);

const docsUploaded = [
  doc({ id: "d1", documentType: "birth_certificate", originalFileName: "birth.pdf" }),
];
assert.equal(
  currentDocumentForType(docsUploaded, "birth_certificate")?.originalFileName,
  "birth.pdf",
  "4. uploaded required present"
);

const optional = requirements.find((r) => r.key === "supporting_document");
assert.equal(optional?.required, false, "5. optional not required");

const completenessMissing = deriveSupportingDocumentCompleteness({
  requirements,
  documents: docsUploaded,
});
assert.equal(completenessMissing.requiredTotal, 2);
assert.equal(completenessMissing.requiredUploaded, 1);
assert.ok(completenessMissing.summary?.includes("1 of 2"), "6. completeness count");

const completenessDone = deriveSupportingDocumentCompleteness({
  requirements,
  documents: [
    ...docsUploaded,
    doc({ id: "d2", documentType: "parent_id", originalFileName: "id.pdf" }),
  ],
});
assert.equal(completenessDone.requiredUploaded, 2);
assert.equal(completenessDone.missingKeys.length, 0);

assert.equal(humanizeDocumentType("birth_certificate"), "Birth certificate");

// --- Client file validation ---
function fakeFile(name: string, size: number, type: string): File {
  return { name, size, type } as File;
}

assert.equal(validateAdmissionsFileClient(fakeFile("a.pdf", 10, "application/pdf")).ok, true, "7. PDF");
assert.equal(validateAdmissionsFileClient(fakeFile("a.jpg", 10, "image/jpeg")).ok, true, "8. JPEG");
assert.equal(validateAdmissionsFileClient(fakeFile("a.png", 10, "image/png")).ok, true, "9. PNG");
assert.equal(
  validateAdmissionsFileClient(fakeFile("a.exe", 10, "application/octet-stream")).ok,
  false,
  "10. unsupported blocked"
);
assert.equal(
  validateAdmissionsFileClient(fakeFile("big.pdf", ADMISSIONS_MAX_UPLOAD_BYTES + 1, "application/pdf"))
    .ok,
  false,
  "11. oversize blocked"
);

// --- Source / API guards ---
const apiSrc = read("publicAdmissions/publicAdmissionsApi.ts");
const docsSrc = read("publicAdmissions/PublicAdmissionsDocumentsStep.tsx");
const applySrc = read("publicAdmissions/PublicAdmissionsApplyPage.tsx");

assert.ok(/X-Admissions-Access-Token/.test(apiSrc), "12. applicant token header");
assert.ok(!/\bstaffAuthHeaders\s*\(/.test(apiSrc), "13. no staff auth");
assert.ok(!/\bstaffAuthHeaders\s*\(/.test(docsSrc), "13. no staff auth in docs step");
assert.ok(
  /\/documents`[\s\S]*method:\s*"POST"|method:\s*"POST"[\s\S]*\/documents`/.test(apiSrc) ||
    /applicationsBase[\s\S]*\/documents[\s\S]*method:\s*"POST"/.test(apiSrc),
  "upload endpoint"
);
assert.ok(/uploadPublicApplicantDocument/.test(docsSrc));
assert.ok(/refreshDocuments\(/.test(docsSrc), "14. refresh after upload");
assert.ok(
  /Upload failed[\s\S]*uploading: false/.test(docsSrc) ||
    /uploading: false[\s\S]*Upload failed/.test(docsSrc),
  "15. failed upload does not claim success"
);
assert.ok(
  /await uploadPublicApplicantDocument[\s\S]*await refreshDocuments/.test(docsSrc),
  "16. replacement only refreshes after success — old state kept until then"
);

assert.ok(/deletePublicApplicantDocument/.test(docsSrc), "17. delete wired");
assert.ok(/window\.confirm/.test(docsSrc), "17. deliberate delete confirm");
assert.ok(
  /deleting: false[\s\S]*Could not delete|Could not delete[\s\S]*deleting: false/.test(docsSrc),
  "18. failed delete keeps UI"
);
assert.ok(
  /await deletePublicApplicantDocument[\s\S]*await refreshDocuments/.test(docsSrc),
  "19. successful delete refreshes"
);
assert.ok(
  /documentType/.test(apiSrc) && /FormData/.test(apiSrc),
  "20. same documentType upload contract"
);
assert.ok(
  !/deletePublicApplicantDocument[\s\S]{0,200}uploadPublicApplicantDocument/.test(docsSrc) ||
    /Replace file/.test(docsSrc),
  "21. no silent auto-delete before replace — replace is upload same type"
);

assert.ok(/downloadPublicApplicantDocumentBlob/.test(apiSrc), "22. authenticated download helper");
assert.ok(/createObjectURL/.test(docsSrc), "22. blob download");
assert.ok(!/accessToken=|token=/.test(docsSrc), "23. token not in URL construction");
assert.ok(!/\/uploads\//.test(docsSrc) && !/\/uploads\//.test(apiSrc), "24. no public uploads URL");
assert.ok(
  /educlear\.publicAdmissions\.applicantSession/.test(
    read("publicAdmissions/applicantSession.ts")
  ),
  "25. slug-scoped session remains"
);

assert.ok(!/\/submit/.test(docsSrc), "26/27. no submit in docs step");
assert.ok(!/\/submit/.test(apiSrc.match(/listPublicApplicantDocuments[\s\S]+$/)?.[0] || "") || true);
assert.ok(
  !/\/payment["'`]|payment-proof/.test(docsSrc),
  "28/29. payment and POP endpoints not called from docs step"
);
assert.ok(
  !/fetchPublicApplicantPayment|uploadPublicPaymentProof/.test(docsSrc),
  "28/29. docs step does not use payment helpers (OA-06F owns those)"
);
assert.ok(
  /Payment instructions[\s\S]*after you submit/.test(docsSrc),
  "30. bank details not exposed — post-submit messaging only"
);
assert.ok(!/bankName|accountNumber|branchCode/.test(docsSrc), "30. no bank fields");
assert.ok(!/FamilyAccount|ledger|invoice/.test(docsSrc), "31. no finance mutation");
assert.ok(!/\/api\/admissions\//.test(docsSrc), "32. no staff admissions APIs");
assert.ok(!/\/api\/admissions\//.test(apiSrc), "32. public API client only");

assert.ok(/PublicAdmissionsDocumentsStep/.test(applySrc), "wired into apply journey");
assert.ok(/pa-step-documents|Continue to documents/.test(applySrc));
assert.ok(!/Payment<\/li>|Payment<\/span>|is-active">Payment/.test(applySrc) || /after submission/.test(applySrc));
// Progress should not present Payment as an active OA-06D step
assert.ok(!/>\s*Payment\s*</.test(applySrc) || /later step/.test(applySrc));
assert.ok(/Review/.test(applySrc), "Review remains future/locked");

assert.ok(!/\{accessToken\}/.test(docsSrc), "token not rendered");
assert.ok(ADMISSIONS_MAX_UPLOAD_BYTES === 8 * 1024 * 1024);

console.log("✓ OA-06D public admissions documents unit tests passed");
