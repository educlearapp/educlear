/**
 * OA-03F integration tests — staff inbox/detail (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03f.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs/promises";
import { PrismaClient } from "@prisma/client";

import { uploadApplicantDocument, uploadProofOfPayment } from "./admissionsDocumentService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { submitApplication } from "./submitApplicationService";
import {
  assertNoSensitiveAdmissionsFields,
  getStaffApplicationDetail,
  listStaffApplications,
  openStaffApplicationDocumentForDownload,
  StaffAdmissionsError,
} from "./staffAdmissionsReadService";

const prisma = new PrismaClient();

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

function minimalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
}

async function makeSchool(suffix: string, opts?: { fee?: boolean }) {
  const school = await prisma.school.create({ data: { name: `OA03F ${suffix}` } });
  const slug = `oa03f-${suffix}-${Date.now().toString(36)}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: Boolean(opts?.fee),
      defaultAdmissionFeeAmount: opts?.fee ? ("1600.00" as any) : null,
      currency: "ZAR",
      requiredDocuments: [
        { key: "birth_certificate", label: "Birth certificate", required: true },
        { key: "parent_id", label: "Parent ID", required: true },
        { key: "optional_form", label: "Optional", required: false },
      ],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
      bankName: opts?.fee ? "Test Bank" : null,
      accountHolder: opts?.fee ? "School" : null,
      accountNumber: opts?.fee ? "123456789" : null,
      branchCode: opts?.fee ? "250655" : null,
    },
  });
  return { school, slug };
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionFeeRecord.updateMany({
      where: { applicationId: { in: ids } },
      data: { latestProofDocumentId: null },
    });
    await prisma.admissionDocument.updateMany({
      where: { applicationId: { in: ids } },
      data: { replacedByDocumentId: null },
    });
    await prisma.admissionDocument.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  // Users created for notes
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa03f-" } } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

async function completeDraft(
  slug: string,
  publicAccessId: string,
  token: string,
  opts?: { grade?: string; firstName?: string; lastName?: string; guardianSurname?: string }
) {
  return updateDraftApplication(prisma, slug, publicAccessId, token, {
    requestedGrade: opts?.grade || "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: opts?.firstName || "Thabo",
      lastName: opts?.lastName || "Molefe",
      birthDate: "2018-05-01",
      homeAddress: "1 Test St",
      allergies: "DETAIL_ONLY_PEANUTS",
      medicalAlert: "DETAIL_ONLY_ASTHMA",
    },
    guardians: [
      {
        firstName: "Lerato",
        surname: opts?.guardianSurname || "Molefe",
        cellNo: "0821111111",
        email: "lerato@example.com",
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "1 Test St",
      },
    ],
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Great school" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
}

async function submitReady(
  slug: string,
  opts?: { grade?: string; firstName?: string; lastName?: string; guardianSurname?: string }
) {
  const draft = await createDraftApplication(prisma, slug, {
    requestedGrade: opts?.grade || "Grade 1",
    learner: { firstName: "", lastName: "" },
  });
  await completeDraft(slug, draft.application.publicAccessId, draft.accessToken, opts);
  const submitted = await submitApplication(
    prisma,
    slug,
    draft.application.publicAccessId,
    draft.accessToken
  );
  const row = await prisma.admissionApplication.findFirstOrThrow({
    where: { publicAccessId: draft.application.publicAccessId },
  });
  return { ...draft, submitted, appId: row.id, token: draft.accessToken, accessId: draft.application.publicAccessId };
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];

  try {
    const a = await makeSchool("a", { fee: true });
    const b = await makeSchool("b", { fee: true });
    schoolIds.push(a.school.id, b.school.id);

    const app1 = await submitReady(a.slug, {
      grade: "Grade 1",
      firstName: "Thabo",
      lastName: "Molefe",
      guardianSurname: "Molefe",
    });
    const app2 = await submitReady(a.slug, {
      grade: "Grade 2",
      firstName: "Anele",
      lastName: "Dlamini",
      guardianSurname: "Dlamini",
    });
    // Draft should be excluded by default
    await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "Drafty", lastName: "Kid" },
    });

    // Cross-school application
    const otherSchool = await submitReady(b.slug, {
      firstName: "Other",
      lastName: "School",
    });

    // Upload one required doc on app1 (still incomplete)
    await uploadApplicantDocument(prisma, a.slug, app1.accessId, app1.token, {
      documentType: "birth_certificate",
      buffer: minimalPdf(),
      originalFileName: "birth.pdf",
      claimedMime: "application/pdf",
    });

    // List own school — excludes drafts and other school
    const listed = await listStaffApplications(prisma, a.school.id, { page: 1, pageSize: 20 });
    assert.strictEqual(listed.total, 2);
    assert.strictEqual(listed.items.length, 2);
    assert.ok(listed.items.every((i) => i.status !== "DRAFT"));
    assert.ok(listed.items.every((i) => i.id === app1.appId || i.id === app2.appId));
    assertNoSensitiveAdmissionsFields(listed);

    // List items must not include medical free text
    const listJson = JSON.stringify(listed);
    assert.ok(!listJson.includes("DETAIL_ONLY_PEANUTS"));
    assert.ok(!listJson.includes("DETAIL_ONLY_ASTHMA"));
    assert.ok(!listJson.includes("accessTokenHash"));
    assert.ok(!listJson.includes("storageKey"));

    // Order: latest submitted first
    assert.ok(
      new Date(listed.items[0].submittedAt || 0).getTime() >=
        new Date(listed.items[1].submittedAt || 0).getTime()
    );

    // Status filter
    const byStatus = await listStaffApplications(prisma, a.school.id, {
      status: "SUBMITTED",
    });
    assert.strictEqual(byStatus.total, 2);

    // Payment status filter
    const awaiting = await listStaffApplications(prisma, a.school.id, {
      paymentStatus: "AWAITING_PAYMENT",
    });
    assert.ok(awaiting.total >= 1);
    assert.ok(awaiting.items.every((i) => i.paymentStatus === "AWAITING_PAYMENT"));

    // Grade / intake
    const grade2 = await listStaffApplications(prisma, a.school.id, {
      requestedGrade: "Grade 2",
      intakeYear: 2027,
    });
    assert.strictEqual(grade2.total, 1);
    assert.strictEqual(grade2.items[0].id, app2.appId);

    // Search application number
    const byNumber = await listStaffApplications(prisma, a.school.id, {
      q: app1.submitted.application.applicationNumber!,
    });
    assert.strictEqual(byNumber.total, 1);
    assert.strictEqual(byNumber.items[0].id, app1.appId);

    // Learner search
    const byLearner = await listStaffApplications(prisma, a.school.id, { q: "Anele" });
    assert.strictEqual(byLearner.total, 1);
    assert.strictEqual(byLearner.items[0].learnerFirstName, "Anele");

    // Guardian search
    const byGuardian = await listStaffApplications(prisma, a.school.id, { q: "Dlamini" });
    assert.strictEqual(byGuardian.total, 1);

    // Pagination
    const page1 = await listStaffApplications(prisma, a.school.id, { page: 1, pageSize: 5 });
    assert.strictEqual(page1.page, 1);
    assert.strictEqual(page1.pageSize, 5);
    assert.strictEqual(page1.total, 2);

    // Document completeness on list
    const incompleteRow = listed.items.find((i) => i.id === app1.appId)!;
    assert.strictEqual(incompleteRow.documentsComplete, false);
    assert.ok(incompleteRow.missingDocumentCount >= 1);

    // Seed staff note for visibility tests
    const staffUser = await prisma.user.create({
      data: {
        schoolId: a.school.id,
        email: `oa03f-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "SCHOOL_ADMIN",
        isActive: true,
      },
    });
    await prisma.admissionStaffNote.create({
      data: {
        schoolId: a.school.id,
        applicationId: app1.appId,
        authorUserId: staffUser.id,
        body: "Staff review note",
      },
    });

    // Baseline detail (incomplete docs, awaiting payment)
    const detailBase = await getStaffApplicationDetail(prisma, a.school.id, app1.appId, {
      includeMedicalDetails: true,
      includeStaffNotes: true,
    });
    assert.strictEqual(detailBase.id, app1.appId);
    assert.strictEqual(detailBase.guardians.length, 1);
    assert.ok(detailBase.answers.length >= 1);
    assert.strictEqual(detailBase.documentCompleteness.documentsComplete, false);
    assert.ok(detailBase.documentCompleteness.missingDocumentTypes.includes("parent_id"));
    assert.ok(detailBase.documentCompleteness.uploadedDocumentTypes.includes("birth_certificate"));
    assert.strictEqual(detailBase.payment?.paymentStatus, "AWAITING_PAYMENT");
    assert.strictEqual(detailBase.payment?.amount, "1600.00");
    assert.ok(detailBase.statusHistory.length >= 1);
    assert.ok(detailBase.auditTimeline.length >= 1);

    // Detail — Finance-level (edit, no manage): no medical, notes allowed
    const detailFinance = await getStaffApplicationDetail(prisma, a.school.id, app1.appId, {
      includeStaffNotes: true,
      includeMedicalDetails: false,
    });
    assert.strictEqual(detailFinance.learner?.firstName, "Thabo");
    assert.strictEqual(detailFinance.learner?.allergies, null);
    assert.strictEqual(detailFinance.learner?.medicalAlert, null);
    assert.strictEqual(detailFinance.learner?.notes, null);
    assert.ok(detailFinance.staffNotes);
    assert.ok(!JSON.stringify(detailFinance).includes("DETAIL_ONLY_PEANUTS"));

    // includeStaffNotes client wish without capability → still null
    const notesDenied = await getStaffApplicationDetail(prisma, a.school.id, app1.appId, {
      includeStaffNotes: false,
      includeMedicalDetails: false,
    });
    assert.strictEqual(notesDenied.staffNotes, null);

    // Admin/manage-level: medical + notes
    const detailAdmin = await getStaffApplicationDetail(prisma, a.school.id, app1.appId, {
      includeStaffNotes: true,
      includeMedicalDetails: true,
    });
    assert.strictEqual(detailAdmin.learner?.allergies, "DETAIL_ONLY_PEANUTS");
    assert.strictEqual(detailAdmin.learner?.medicalAlert, "DETAIL_ONLY_ASTHMA");
    assert.ok(detailAdmin.staffNotes);
    assert.strictEqual(detailAdmin.staffNotes!.length, 1);
    assert.strictEqual(detailAdmin.staffNotes![0].body, "Staff review note");
    assertNoSensitiveAdmissionsFields(detailAdmin);
    assert.ok(!JSON.stringify(detailAdmin).includes("storageKey"));
    assert.ok(!JSON.stringify(detailAdmin).includes("accessTokenHash"));

    // Complete remaining required doc
    await uploadApplicantDocument(prisma, a.slug, app1.accessId, app1.token, {
      documentType: "parent_id",
      buffer: minimalPdf(),
      originalFileName: "id.pdf",
      claimedMime: "application/pdf",
    });
    const completeDetail = await getStaffApplicationDetail(prisma, a.school.id, app1.appId, {
      includeMedicalDetails: true,
    });
    assert.strictEqual(completeDetail.documentCompleteness.documentsComplete, true);

    const birthDoc = completeDetail.documents.find((d) => d.documentType === "birth_certificate");
    assert.ok(birthDoc);

    // Staff download own-school document
    const opened = await openStaffApplicationDocumentForDownload(
      prisma,
      a.school.id,
      app1.appId,
      birthDoc!.id
    );
    assert.ok(opened.absolutePath.includes("data/admissions"));
    assert.strictEqual(opened.contentType, "application/pdf");
    const bytes = await fs.readFile(opened.absolutePath);
    assert.ok(bytes.length > 0);
    assert.ok(!(opened as any).storageKey);

    // POP download
    await uploadProofOfPayment(prisma, a.slug, app1.accessId, app1.token, {
      buffer: minimalPdf(),
      originalFileName: "pop.pdf",
      claimedMime: "application/pdf",
    });
    const withPop = await getStaffApplicationDetail(prisma, a.school.id, app1.appId);
    assert.strictEqual(withPop.payment?.paymentStatus, "PROOF_UPLOADED");
    assert.strictEqual(withPop.payment?.proofUploaded, true);
    assert.ok(withPop.payment?.proofDocument);
    assert.ok(!(withPop.payment!.proofDocument as any).storageKey);
    const popOpened = await openStaffApplicationDocumentForDownload(
      prisma,
      a.school.id,
      app1.appId,
      withPop.payment!.proofDocument!.id
    );
    assert.strictEqual(popOpened.contentType, "application/pdf");

    // Soft-deleted / replaced document inaccessible
    const replaced = await uploadApplicantDocument(prisma, a.slug, app1.accessId, app1.token, {
      documentType: "birth_certificate",
      buffer: minimalPdf(),
      originalFileName: "birth-v2.pdf",
      claimedMime: "application/pdf",
    });
    await assert.rejects(
      () =>
        openStaffApplicationDocumentForDownload(prisma, a.school.id, app1.appId, birthDoc!.id),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );
    const activeBirth = await openStaffApplicationDocumentForDownload(
      prisma,
      a.school.id,
      app1.appId,
      replaced.id
    );
    assert.ok(activeBirth.absolutePath);

    // Document from Application B cannot be accessed through Application A
    const app2Doc = await uploadApplicantDocument(prisma, a.slug, app2.accessId, app2.token, {
      documentType: "birth_certificate",
      buffer: minimalPdf(),
      originalFileName: "other.pdf",
      claimedMime: "application/pdf",
    });
    await assert.rejects(
      () =>
        openStaffApplicationDocumentForDownload(prisma, a.school.id, app1.appId, app2Doc.id),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );

    // Cross-school document blocked
    await assert.rejects(
      () =>
        openStaffApplicationDocumentForDownload(prisma, b.school.id, app1.appId, replaced.id),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );
    await assert.rejects(
      () =>
        openStaffApplicationDocumentForDownload(
          prisma,
          a.school.id,
          otherSchool.appId,
          replaced.id
        ),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );

    // Auth: unauthenticated / no permission covered in unit via evaluateAdmissionsSettingsAuth

    // Cross-school detail blocked
    await assert.rejects(
      () => getStaffApplicationDetail(prisma, a.school.id, otherSchool.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );
    await assert.rejects(
      () => getStaffApplicationDetail(prisma, b.school.id, app1.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );

    // List isolation
    const listB = await listStaffApplications(prisma, b.school.id, {});
    assert.ok(listB.items.every((i) => i.id === otherSchool.appId));
    assert.ok(!listB.items.some((i) => i.id === app1.appId));

    // Read-only: calling list/detail must not create learners/parents
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.parent.count({ where: { schoolId: a.school.id } }), 0);

    // Fee snapshot fields present on list
    const feeRow = (await listStaffApplications(prisma, a.school.id, { q: "Thabo" })).items[0];
    assert.strictEqual(feeRow.feeAmount, "1600.00");
    assert.strictEqual(feeRow.feeCurrency, "ZAR");
    assert.strictEqual(feeRow.proofUploaded, true);

    console.log("OA-03F integration tests passed");
  } finally {
    for (const id of schoolIds) {
      await cleanupSchool(id);
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
