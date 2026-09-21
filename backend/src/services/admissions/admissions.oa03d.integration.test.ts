/**
 * OA-03D integration tests — document + POP upload (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03d.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

import {
  deleteApplicantDocument,
  listApplicantDocuments,
  openApplicantDocumentForDownload,
  resolveAdmissionsStorageRoot,
  uploadApplicantDocument,
  uploadProofOfPayment,
} from "./admissionsDocumentService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { PublicAdmissionsError } from "./publicAdmissionsConfig";
import { submitApplication } from "./submitApplicationService";
import { ADMISSIONS_MAX_UPLOAD_BYTES } from "./admissionsFileValidation";

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

function minimalJpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
}

function minimalPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

async function makeSchool(suffix: string, opts?: { fee?: boolean }) {
  const school = await prisma.school.create({ data: { name: `OA03D ${suffix}` } });
  const slug = `oa03d-${suffix}-${Date.now().toString(36)}`;
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
        {
          key: "parent_id",
          label: "Parent IDs",
          required: true,
          allowMultiple: true,
          maxCount: 2,
        },
        { key: "custom_school_form", label: "School form", required: false },
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
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  await fs.rm(path.join(resolveAdmissionsStorageRoot(), schoolId), { recursive: true, force: true });
}

async function completeDraft(slug: string, publicAccessId: string, token: string) {
  return updateDraftApplication(prisma, slug, publicAccessId, token, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: "Thabo",
      lastName: "Molefe",
      birthDate: "2018-05-01",
      homeAddress: "1 Test St",
    },
    guardians: [
      {
        firstName: "Lerato",
        surname: "Molefe",
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

async function main() {
  assertLocal();
  const schoolIds: string[] = [];

  try {
    const a = await makeSchool("a", { fee: true });
    const b = await makeSchool("b", { fee: true });
    schoolIds.push(a.school.id, b.school.id);

    const draftA = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "", lastName: "" },
    });
    const accessA = draftA.application.publicAccessId;
    const tokenA = draftA.accessToken;

    // Valid PDF upload while DRAFT
    const pdfDoc = await uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
      documentType: "birth_certificate",
      buffer: minimalPdf(),
      originalFileName: "../../../evil.pdf",
      claimedMime: "application/pdf",
    });
    assert.strictEqual(pdfDoc.documentType, "birth_certificate");
    assert.strictEqual(pdfDoc.contentType, "application/pdf");
    assert.ok(!pdfDoc.originalFileName.includes(".."));
    assert.ok(!(pdfDoc as any).storageKey);
    assert.ok(!(pdfDoc as any).storageProvider);

    const jpegDoc = await uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
      documentType: "parent_id",
      buffer: minimalJpeg(),
      originalFileName: "id.jpg",
      claimedMime: "image/jpeg",
    });
    assert.strictEqual(jpegDoc.contentType, "image/jpeg");
    const secondParentId = await uploadApplicantDocument(
      prisma,
      a.slug,
      accessA,
      tokenA,
      {
        documentType: "parent_id",
        buffer: minimalJpeg(),
        originalFileName: "second-id.jpg",
        claimedMime: "image/jpeg",
      }
    );
    const multipleParentIds = await listApplicantDocuments(
      prisma,
      a.slug,
      accessA,
      tokenA
    );
    assert.strictEqual(
      multipleParentIds.documents.filter((d) => d.documentType === "parent_id").length,
      2
    );
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
          documentType: "parent_id",
          buffer: minimalJpeg(),
          originalFileName: "third-id.jpg",
          claimedMime: "image/jpeg",
        }),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "DOCUMENT_LIMIT_REACHED"
    );

    const pngDoc = await uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
      documentType: "custom_school_form",
      buffer: minimalPng(),
      originalFileName: "form.png",
      claimedMime: "image/png",
    });
    assert.strictEqual(pngDoc.contentType, "image/png");

    // Oversize
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
          documentType: "supporting_document",
          buffer: Buffer.concat([minimalPdf(), Buffer.alloc(ADMISSIONS_MAX_UPLOAD_BYTES)]),
          originalFileName: "huge.pdf",
        }),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "FILE_TOO_LARGE"
    );

    // Unsafe type
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
          documentType: "supporting_document",
          buffer: Buffer.from("MZ\x90\x00fake"),
          originalFileName: "run.exe",
        }),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "INVALID_FILE_TYPE"
    );

    // Invalid token
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, accessA, "not-a-valid-token", {
          documentType: "supporting_document",
          buffer: minimalPdf(),
          originalFileName: "x.pdf",
        }),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    // Replace same slot — one active
    const replaced = await uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
      documentType: "birth_certificate",
      buffer: minimalPdf(),
      originalFileName: "birth-v2.pdf",
      claimedMime: "application/pdf",
    });
    assert.notStrictEqual(replaced.id, pdfDoc.id);
    const listed = await listApplicantDocuments(prisma, a.slug, accessA, tokenA);
    const birthActive = listed.documents.filter((d) => d.documentType === "birth_certificate");
    assert.strictEqual(birthActive.length, 1);
    assert.strictEqual(birthActive[0].id, replaced.id);
    assert.ok(listed.requiredDocumentTypes.includes("birth_certificate"));

    const softDeleted = await prisma.admissionDocument.findUnique({ where: { id: pdfDoc.id } });
    assert.ok(softDeleted?.deletedAt);
    assert.strictEqual(softDeleted?.replacedByDocumentId, replaced.id);

    // Cross-application isolation
    const draftA2 = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 2",
      learner: { firstName: "", lastName: "" },
    });
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, draftA2.application.publicAccessId, tokenA, {
          documentType: "supporting_document",
          buffer: minimalPdf(),
          originalFileName: "x.pdf",
        }),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    const listA2 = await listApplicantDocuments(
      prisma,
      a.slug,
      draftA2.application.publicAccessId,
      draftA2.accessToken
    );
    assert.strictEqual(listA2.documents.length, 0);

    // Cross-school isolation (generic 404)
    await assert.rejects(
      () =>
        listApplicantDocuments(prisma, b.slug, accessA, tokenA),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    // Complete + submit for POP
    await completeDraft(a.slug, accessA, tokenA);
    const submitted = await submitApplication(prisma, a.slug, accessA, tokenA);
    assert.ok(submitted.application.applicationNumber);
    assert.strictEqual(submitted.application.feeRecord?.paymentStatus, "AWAITING_PAYMENT");

    const appRow = await prisma.admissionApplication.findFirst({
      where: { publicAccessId: accessA },
    });
    assert.ok(appRow);

    // POP before submit was blocked for draftA2 (still draft) — already draft
    await assert.rejects(
      () =>
        uploadProofOfPayment(prisma, a.slug, draftA2.application.publicAccessId, draftA2.accessToken, {
          buffer: minimalPdf(),
          originalFileName: "pop.pdf",
        }),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "POP_REQUIRES_SUBMISSION"
    );

    // POP upload
    const pop = await uploadProofOfPayment(prisma, a.slug, accessA, tokenA, {
      buffer: minimalPdf(),
      originalFileName: "payment.pdf",
      claimedMime: "application/pdf",
    });
    assert.strictEqual(pop.paymentStatus, "PROOF_UPLOADED");
    assert.strictEqual(pop.document.documentType, "proof_of_payment");

    const fee = await prisma.admissionFeeRecord.findUnique({
      where: { applicationId: appRow!.id },
    });
    assert.strictEqual(fee?.paymentStatus, "PROOF_UPLOADED");
    assert.strictEqual(fee?.latestProofDocumentId, pop.document.id);
    assert.strictEqual(fee?.verifiedAt, null);
    assert.strictEqual(fee?.verifiedByUserId, null);

    const payHist = await prisma.admissionPaymentHistory.findMany({
      where: { applicationId: appRow!.id },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(payHist.some((h) => h.toStatus === "PROOF_UPLOADED" && h.actorType === "APPLICANT"));

    // Replace POP — still one active, not verified
    const pop2 = await uploadProofOfPayment(prisma, a.slug, accessA, tokenA, {
      buffer: minimalJpeg(),
      originalFileName: "payment.jpg",
      claimedMime: "image/jpeg",
    });
    assert.strictEqual(pop2.paymentStatus, "PROOF_UPLOADED");
    const fee2 = await prisma.admissionFeeRecord.findUnique({
      where: { applicationId: appRow!.id },
    });
    assert.strictEqual(fee2?.latestProofDocumentId, pop2.document.id);
    assert.strictEqual(fee2?.verifiedAt, null);
    const popActive = (await listApplicantDocuments(prisma, a.slug, accessA, tokenA)).documents.filter(
      (d) => d.documentType === "proof_of_payment"
    );
    assert.strictEqual(popActive.length, 1);

    // Download own document
    const opened = await openApplicantDocumentForDownload(
      prisma,
      a.slug,
      accessA,
      tokenA,
      pop2.document.id
    );
    assert.ok(opened.absolutePath.includes(path.join("data", "admissions")));
    const bytes = await fs.readFile(opened.absolutePath);
    assert.ok(bytes.length > 0);

    // Cross-app download blocked
    await assert.rejects(
      () =>
        openApplicantDocumentForDownload(
          prisma,
          a.slug,
          draftA2.application.publicAccessId,
          draftA2.accessToken,
          pop2.document.id
        ),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    // Delete supporting doc still allowed after submit
    await deleteApplicantDocument(prisma, a.slug, accessA, tokenA, jpegDoc.id);
    const afterDel = await listApplicantDocuments(prisma, a.slug, accessA, tokenA);
    assert.ok(!afterDel.documents.some((d) => d.id === jpegDoc.id));
    assert.ok(afterDel.documents.some((d) => d.id === secondParentId.id));

    // Audit events present
    const audits = await prisma.admissionAuditEvent.findMany({
      where: { applicationId: appRow!.id },
    });
    assert.ok(audits.some((e) => e.eventType === "DOCUMENT_UPLOADED"));
    assert.ok(audits.some((e) => e.eventType === "PROOF_OF_PAYMENT_UPLOADED"));

    // No Learner / Parent / FamilyAccount / billing side effects
    const learners = await prisma.learner.count({ where: { schoolId: a.school.id } });
    const parents = await prisma.parent.count({ where: { schoolId: a.school.id } });
    assert.strictEqual(learners, 0);
    assert.strictEqual(parents, 0);

    // Document rows never expose internal security fields via service view
    const raw = await prisma.admissionDocument.findFirst({
      where: { id: replaced.id },
    });
    assert.ok(raw?.storageKey);
    assert.strictEqual(raw?.uploadedBy, "APPLICANT");
    assert.strictEqual(raw?.scanStatus, "NOT_SCANNED");

    // Terminal block
    await prisma.admissionApplication.update({
      where: { id: appRow!.id },
      data: { status: "DECLINED" },
    });
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, accessA, tokenA, {
          documentType: "supporting_document",
          buffer: minimalPdf(),
          originalFileName: "late.pdf",
        }),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "APPLICATION_TERMINAL"
    );

    console.log("OA-03D integration tests passed");
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
