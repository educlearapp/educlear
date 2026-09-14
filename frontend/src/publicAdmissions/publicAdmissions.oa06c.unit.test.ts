/**
 * OA-06C — public admissions draft create / form / save / resume unit + source guards.
 * Run: npx --yes tsx src/publicAdmissions/publicAdmissions.oa06c.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applicantSessionStorageKey,
  clearApplicantSession,
  readApplicantSession,
  writeApplicantSession,
} from "./applicantSession";
import {
  buildUpdateDraftBody,
  createEmptyDraftForm,
  emptyGuardianRow,
  hasClientErrors,
  hydrateDraftFormFromApplication,
  setPayingGuardian,
  setPrimaryGuardian,
  validateDraftFormClient,
} from "./draftFormState";
import type {
  ApplicantApplicationView,
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
    branding: { logoUrl: null, primaryColor: "#0f4c5c" },
    enabled: true,
    acceptingApplications: true,
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade R", "Grade 1"],
    admissionFeeRequired: true,
    admissionFeeAmount: "350.00",
    currency: "ZAR",
    proofOfPaymentRequired: true,
    paymentVerificationRequired: false,
    requirePaymentVerifiedBeforeAccept: false,
    admissionContactEmail: "admissions@demo.example",
    admissionContactPhone: null,
    requiredDocuments: [],
    applicationQuestions: [],
    privacyNoticeVersion: null,
    declarationText: null,
    ...overrides,
  };
}

function baseApplication(
  overrides: Partial<ApplicantApplicationView> = {}
): ApplicantApplicationView {
  return {
    publicAccessId: "acc_public_123",
    status: "DRAFT",
    statusReason: null,
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    applicationNumber: null,
    feeRequired: true,
    feeAmount: "350.00",
    feeCurrency: "ZAR",
    feeSnapshotAt: null,
    declaredExistingSibling: false,
    declaredSiblingLearnerName: null,
    declaredSiblingAdmissionNo: null,
    declaredExistingFamily: false,
    privacyAcceptedAt: null,
    declarationsAcceptedAt: null,
    privacyNoticeVersion: null,
    submittedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    learner: {
      firstName: "Anele",
      lastName: "Dlamini",
      nickname: null,
      birthDate: "2018-05-01",
      gender: "Female",
      idNumber: "1805010000000",
      homeLanguage: "isiZulu",
      citizenship: "South African",
      homeAddress: "12 Oak Street",
      allergies: null,
      medicalAlert: null,
      previousSchoolName: "Sunshine Pre-Primary",
      notes: null,
    },
    guardians: [
      {
        id: "g1",
        title: null,
        firstName: "Thandi",
        surname: "Dlamini",
        relationship: "Mother",
        idNumber: null,
        cellNo: "0820000001",
        email: "thandi@example.com",
        homeAddress: "12 Oak Street",
        employer: null,
        isPrimary: true,
        isPayingPerson: true,
        sortOrder: 0,
      },
    ],
    answers: [],
    feeRecord: null,
    ...overrides,
  };
}

// --- Landing remains non-mutating ---
const landingSrc = read("publicAdmissions/PublicAdmissionsLandingPage.tsx");
assert.ok(
  !/createPublicDraftApplication|\/applications["'`]/.test(landingSrc),
  "1. landing remains non-mutating"
);
assert.ok(
  /\/admissions\/\$\{encodeURIComponent\(publicSlug\)\}\/apply/.test(landingSrc),
  "2. Start Application navigates to apply route"
);

const applySrc = read("publicAdmissions/PublicAdmissionsApplyPage.tsx");
assert.ok(/createPublicDraftApplication/.test(applySrc), "draft create wired on apply page");
assert.ok(/pa-begin-draft/.test(applySrc), "explicit Begin Application action");
assert.ok(/createInFlight/.test(applySrc), "3. draft POST guarded against duplicate in-flight");
assert.ok(/writeApplicantSession/.test(applySrc), "4/5. captures publicAccessId + token via session write");
assert.ok(!/>\s*\{accessToken\}\s*</.test(applySrc), "6. token not rendered as JSX text");
assert.ok(!/\{session\.accessToken\}/.test(applySrc), "6. session token not rendered");
assert.ok(!/searchParams|URLSearchParams|location\.hash/.test(applySrc), "7. no URL token plumbing");
assert.ok(!/\bstaffAuthHeaders\s*\(/.test(applySrc), "8. no staff auth headers on apply page");
assert.ok(!/\/submit/.test(applySrc), "21. no submit endpoint");
assert.ok(
  !/\/documents|payment-proof|\/payment["'`]/.test(applySrc) ||
    /PublicAdmissionsDocumentsStep/.test(applySrc),
  "21b. apply page does not inline document/payment endpoints (docs step owns documents)"
);

const apiSrc = read("publicAdmissions/publicAdmissionsApi.ts");
assert.ok(
  /method:\s*"POST"[\s\S]*\/applications`/.test(apiSrc) ||
    /\/applications`[\s\S]*method:\s*"POST"/.test(apiSrc),
  "draft create uses POST applications"
);
assert.ok(
  /X-Admissions-Access-Token/.test(apiSrc),
  "applicant token transport uses X-Admissions-Access-Token"
);
assert.ok(!/\bstaffAuthHeaders\s*\(/.test(apiSrc), "API client never uses staffAuthHeaders");
assert.ok(
  /method:\s*"PATCH"/.test(apiSrc) && /\/applications\/\$\{encodeURIComponent\(accessId\)\}`/.test(apiSrc),
  "18. PATCH draft through public endpoint"
);
assert.ok(!/\/api\/admissions\//.test(apiSrc), "does not call staff /api/admissions/*");
// Submit helper exists for OA-06E; OA-06C apply bootstrap must not auto-call it
assert.ok(
  !/submitPublicApplication/.test(applySrc),
  "OA-06C apply page does not call submit helper directly"
);

// --- Form helpers ---
const empty = createEmptyDraftForm(baseConfig());
assert.equal(empty.intakeYear, 2027, "11. intake year from config");
assert.equal(empty.guardians.length, 1);
assert.equal(empty.guardians[0].isPrimary, true);
assert.equal(empty.guardians[0].isPayingPerson, true);

const hydrated = hydrateDraftFormFromApplication(baseApplication(), baseConfig());
assert.equal(hydrated.learner.firstName, "Anele", "9. learner hydrate");
assert.equal(hydrated.learner.lastName, "Dlamini");
assert.equal(hydrated.learner.homeAddress, "12 Oak Street", "16. address hydrate");
assert.equal(hydrated.requestedGrade, "Grade 1");
assert.equal(hydrated.guardians[0].cellNo, "0820000001", "15. guardian contact");
assert.equal(hydrated.guardians[0].email, "thandi@example.com");

hydrated.learner.firstName = "Updated";
assert.equal(hydrated.learner.firstName, "Updated", "9. learner edit");

const grades = baseConfig().acceptedGrades;
assert.ok(grades.includes("Grade R") && grades.includes("Grade 1"), "10. grades from acceptedGrades");

let guardians = [
  emptyGuardianRow({ isPrimary: true, isPayingPerson: false }),
  emptyGuardianRow({ isPrimary: false, isPayingPerson: true }),
];
assert.equal(guardians.length, 2, "12. guardian add");
guardians = guardians.slice(0, 1);
assert.equal(guardians.length, 1, "12. guardian remove");

guardians = [
  emptyGuardianRow({ isPrimary: true, isPayingPerson: true }),
  emptyGuardianRow({ isPrimary: false, isPayingPerson: false }),
];
guardians = setPrimaryGuardian(guardians, guardians[1].clientKey);
assert.equal(guardians.filter((g) => g.isPrimary).length, 1, "13. single primary");
assert.equal(guardians[1].isPrimary, true);
guardians = setPayingGuardian(guardians, guardians[0].clientKey);
assert.equal(guardians.filter((g) => g.isPayingPerson).length, 1, "14. single payer");
assert.equal(guardians[0].isPayingPerson, true);

const invalid = validateDraftFormClient(createEmptyDraftForm(baseConfig()), grades);
assert.ok(hasClientErrors(invalid), "17. required UI validation");
assert.ok(invalid.learnerFirstName);
assert.ok(invalid.requestedGrade);

const validForm = hydrateDraftFormFromApplication(baseApplication(), baseConfig());
assert.ok(!hasClientErrors(validateDraftFormClient(validForm, grades)));

const patchBody = buildUpdateDraftBody(validForm);
assert.equal(patchBody.intakeYear, 2027);
assert.equal(patchBody.requestedGrade, "Grade 1");
assert.equal(patchBody.learner?.firstName, "Anele");
assert.equal(patchBody.guardians?.[0]?.isPrimary, true);
assert.ok(!("schoolId" in patchBody), "no client schoolId authority");

// Save UX copy / sequencing
assert.ok(/Saving…/.test(applySrc) && /Saved/.test(applySrc), "19. save status copy");
assert.ok(
  /setSaveState\("saved"\)/.test(applySrc) &&
    /await updatePublicDraftApplication/.test(applySrc),
  "19. Saved only after successful PATCH await"
);
assert.ok(
  /could not save your progress/i.test(applySrc) && /still on this screen/.test(applySrc),
  "20. save failure retains entries messaging"
);

// --- Session / resume ---
const memory = new Map<string, string>();
const originalLocalStorage = globalThis.localStorage;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => {
      memory.set(k, String(v));
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  },
});

try {
  const keyA = applicantSessionStorageKey("school-a");
  const keyB = applicantSessionStorageKey("school-b");
  assert.notEqual(keyA, keyB, "25. sessions namespaced by slug");

  writeApplicantSession({
    publicSlug: "school-a",
    publicAccessId: "acc_a",
    accessToken: "token_secret_a",
    accessTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  writeApplicantSession({
    publicSlug: "school-b",
    publicAccessId: "acc_b",
    accessToken: "token_secret_b",
    accessTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  });

  const sessionA = readApplicantSession("school-a");
  const sessionB = readApplicantSession("school-b");
  assert.equal(sessionA?.publicAccessId, "acc_a");
  assert.equal(sessionB?.publicAccessId, "acc_b");
  assert.notEqual(sessionA?.accessToken, sessionB?.accessToken, "25. no cross-slug reuse");

  // Expired session clears
  writeApplicantSession({
    publicSlug: "school-a",
    publicAccessId: "acc_expired",
    accessToken: "token_expired",
    accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(readApplicantSession("school-a"), null, "26. expired token clears stale session");

  clearApplicantSession("school-b");
  assert.equal(readApplicantSession("school-b"), null);
} finally {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
}

assert.ok(/readApplicantSession/.test(applySrc), "23. resume reads local session");
assert.ok(/fetchPublicDraftApplication/.test(applySrc), "23. resume GETs application");
assert.ok(
  /if \(session\)[\s\S]*fetchPublicDraftApplication[\s\S]*return/.test(applySrc) ||
    /loading_resume/.test(applySrc),
  "24. resume path does not fall through to create"
);
assert.ok(/session_invalid/.test(applySrc), "26. invalid token UX phase");
assert.ok(/pa-start-new-application/.test(applySrc), "27. start new after stale session");

// Stale/invalid resume GET must clear session and stop — never auto-POST a replacement draft
const resumeFailBlock = applySrc.match(
  /fetchPublicDraftApplication\([\s\S]*?catch\s*\{([\s\S]*?)\}\s*return;/
);
assert.ok(resumeFailBlock, "resume GET failure catch block present");
assert.ok(
  /clearApplicantSession\(slug\)/.test(resumeFailBlock![1]),
  "stale GET clears local session"
);
assert.ok(
  /setPhase\("session_invalid"\)/.test(resumeFailBlock![1]),
  "stale GET shows session_invalid"
);
assert.ok(
  !/createPublicDraftApplication/.test(resumeFailBlock![1]),
  "stale GET failure does NOT automatically POST replacement draft"
);
assert.ok(
  /handleStartNewAfterStale[\s\S]*setPhase\("need_start"\)/.test(applySrc),
  "Start New Application only moves to need_start (explicit Begin still required for POST)"
);
assert.ok(
  !/session_invalid[\s\S]{0,800}createPublicDraftApplication/.test(applySrc) ||
    /handleBeginApplication[\s\S]*createPublicDraftApplication/.test(applySrc),
  "create remains behind explicit Begin Application"
);

assert.ok(/ADMISSIONS_CLOSED|Applications are no longer open/.test(applySrc), "closed race UX");

// Token never in route path pattern
const appPublicSrc = read("publicAdmissions/PublicAdmissionsApp.tsx");
assert.ok(
  !/accessToken|:token/.test(appPublicSrc),
  "7. routes do not include token segment"
);

// Security: no staff JWT, no schoolId authority from client draft body builder
assert.ok(!/schoolId/.test(JSON.stringify(patchBody)));
assert.ok(!/Bearer\s+\$\{/.test(apiSrc), "does not template staff Bearer");

// Apply page must not render token strings from session into attributes carelessly
assert.ok(!/value=\{accessToken\}/.test(applySrc));
assert.ok(!/children=\{accessToken\}/.test(applySrc));

const sessionSrc = read("publicAdmissions/applicantSession.ts");
assert.ok(/educlear\.publicAdmissions\.applicantSession\./.test(sessionSrc), "admissions-specific key");
assert.ok(!/parentPortal|ParentPortal|staffAuthHeaders/.test(sessionSrc), "not mixed with portal/staff auth");

console.log("✓ OA-06C public admissions draft unit tests passed");
