/**
 * Financial agreement integration tests against local Postgres only.
 * Run: npx ts-node --transpile-only src/services/admissions/financialAgreement.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs";
import zlib from "zlib";
import { PrismaClient } from "@prisma/client";

import { createDraftApplication, updateDraftApplication } from "./draftApplicationService";
import {
  hashLegalBody,
  listActiveLegalDocuments,
  openStaffFinancialSignature,
  publishLegalDocument,
  removePrivateSignatureFiles,
  signFinancialAgreement,
} from "./financialAgreementService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";
import { getStaffApplicationDetail } from "./staffAdmissionsReadService";
import { submitApplication } from "./submitApplicationService";
import { resolveAdmissionsStorageRoot } from "./admissionsDocumentService";

const prisma = new PrismaClient();

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = raw.match(/@([^:/?]+)/)?.[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing integration test on non-local host: ${host}`);
  }
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function inkPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 0, 0, 0, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function blankPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function makeSchool(suffix: string) {
  const school = await prisma.school.create({ data: { name: `FA Test ${suffix}` } });
  const slug = `fa-${suffix}-${Date.now().toString(36)}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1"],
      admissionFeeRequired: false,
      currency: "ZAR",
    },
  });
  return { school, slug };
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const ids = apps.map((app) => app.id);
  const signatures = ids.length
    ? await prisma.admissionFinancialAcceptance.findMany({
        where: { schoolId },
        select: { signatureFileKey: true },
      })
    : [];
  if (ids.length) {
    await prisma.admissionFinancialAcceptance.deleteMany({ where: { schoolId } });
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionDocument.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.schoolAdmissionsLegalDocument.deleteMany({ where: { schoolId } });
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.admissionAuditEvent.deleteMany({ where: { schoolId, applicationId: null } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  await removePrivateSignatureFiles(signatures.map((row) => row.signatureFileKey));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof PublicAdmissionsError);
    return err.code;
  }
  throw new Error("expected rejection");
}

async function main() {
  assertLocal();
  const created: string[] = [];
  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    created.push(a.school.id, b.school.id);

    const first = await publishLegalDocument(prisma, a.school.id, {
      kind: "FINANCIAL_POLICY",
      versionLabel: "2027.1",
      title: "Policy",
      body: "Line one\r\nLine two",
    });
    assert.strictEqual(first.contentSha256, hashLegalBody("Line one\nLine two"));
    const second = await publishLegalDocument(prisma, a.school.id, {
      kind: "FINANCIAL_POLICY",
      versionLabel: "2027.2",
      title: "Policy",
      body: "Line one\nLine two revised",
    });
    const storedFirst = await prisma.schoolAdmissionsLegalDocument.findUniqueOrThrow({
      where: { id: first.id },
    });
    assert.strictEqual(storedFirst.body, "Line one\nLine two");
    assert.ok(storedFirst.supersededAt);
    assert.strictEqual(second.body, "Line one\nLine two revised");
    const active = await listActiveLegalDocuments(prisma, a.school.id);
    assert.strictEqual(active.filter((row) => row.kind === "FINANCIAL_POLICY").length, 1);
    await assert.rejects(() =>
      prisma.schoolAdmissionsLegalDocument.create({
        data: {
          schoolId: a.school.id,
          kind: "FINANCIAL_POLICY",
          versionLabel: "dup",
          title: "Dup",
          body: "Dup",
          contentSha256: "abc",
          publishedAt: new Date(),
        },
      })
    );

    await publishLegalDocument(prisma, a.school.id, {
      kind: "FINANCIAL_DECLARATION",
      versionLabel: "2027.1",
      title: "Declaration",
      body: "I agree to the fees.",
    });
    await publishLegalDocument(prisma, b.school.id, {
      kind: "FINANCIAL_POLICY",
      versionLabel: "B",
      title: "Other policy",
      body: "Other school text",
    });
    const visibleToA = await listActiveLegalDocuments(prisma, a.school.id);
    assert.ok(visibleToA.every((row) => !row.body.includes("Other school")));
    assert.strictEqual(visibleToA.length, 2);

    const createdDraft = await createDraftApplication(prisma, a.slug, {
      intakeYear: 2027,
      requestedGrade: "Grade 1",
      learner: { firstName: "Anele", lastName: "Dlamini", birthDate: "2018-04-01" },
      guardians: [
        {
          firstName: "Mary",
          surname: "Jane",
          cellNo: "0820000000",
          idNumber: "8001015009087",
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
    });
    const token = createdDraft.accessToken;
    const accessId = createdDraft.application.publicAccessId;
    const appId = (
      await prisma.admissionApplication.findFirstOrThrow({
        where: { publicAccessId: accessId, schoolId: a.school.id },
      })
    ).id;

    async function reload() {
      return prisma.admissionApplication.findFirstOrThrow({
        where: { id: appId, schoolId: a.school.id },
        include: { guardians: true },
      });
    }

    let app = await reload();
    assert.strictEqual(
      await codeOf(
        signFinancialAgreement(prisma, {
          schoolId: a.school.id,
          applicationId: app.id,
          status: app.status,
          guardians: app.guardians,
          policyAccepted: "true",
          declarationAccepted: "true",
          typedSignerName: "Mary Jane",
          signaturePng: Buffer.alloc(0),
          strokeCount: 1,
        })
      ),
      "SIGNATURE_REQUIRED"
    );
    assert.strictEqual(
      await codeOf(
        signFinancialAgreement(prisma, {
          schoolId: a.school.id,
          applicationId: app.id,
          status: app.status,
          guardians: app.guardians,
          policyAccepted: "true",
          declarationAccepted: "true",
          typedSignerName: "Mary Jane",
          signaturePng: blankPng(),
          strokeCount: 1,
        })
      ),
      "SIGNATURE_BLANK"
    );
    assert.strictEqual(
      await codeOf(
        signFinancialAgreement(prisma, {
          schoolId: a.school.id,
          applicationId: app.id,
          status: app.status,
          guardians: app.guardians,
          policyAccepted: "true",
          declarationAccepted: "true",
          typedSignerName: "Someone Else",
          signaturePng: inkPng(),
          strokeCount: 2,
        })
      ),
      "SIGNER_NAME_MISMATCH"
    );
    assert.strictEqual(
      await codeOf(
        signFinancialAgreement(prisma, {
          schoolId: a.school.id,
          applicationId: app.id,
          status: app.status,
          guardians: app.guardians.map((guardian) => ({ ...guardian, isPayingPerson: false })),
          policyAccepted: "true",
          declarationAccepted: "true",
          typedSignerName: "Mary Jane",
          signaturePng: inkPng(),
          strokeCount: 1,
        })
      ),
      "PAYING_GUARDIAN_REQUIRED"
    );
    assert.strictEqual(
      await codeOf(
        signFinancialAgreement(prisma, {
          schoolId: a.school.id,
          applicationId: app.id,
          status: app.status,
          guardians: [
            ...app.guardians,
            { ...app.guardians[0], id: "other", isPayingPerson: true },
          ],
          policyAccepted: "true",
          declarationAccepted: "true",
          typedSignerName: "Mary Jane",
          signaturePng: inkPng(),
          strokeCount: 1,
        })
      ),
      "PAYING_GUARDIAN_REQUIRED"
    );

    await signFinancialAgreement(prisma, {
      schoolId: a.school.id,
      applicationId: app.id,
      status: app.status,
      guardians: app.guardians,
      policyAccepted: "true",
      declarationAccepted: "true",
      typedSignerName: "mary  jane",
      signaturePng: inkPng(),
      strokeCount: 1,
    });
    let rows = await prisma.admissionFinancialAcceptance.findMany({
      where: { schoolId: a.school.id, applicationId: app.id },
    });
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(new Set(rows.map((row) => row.signatureFileKey)).size, 1);
    assert.ok(!rows[0].signatureFileKey.includes("http"));
    assert.ok(rows[0].signatureFileKey.startsWith(`${a.school.id}/${app.id}/`));
    const absolute = `${resolveAdmissionsStorageRoot()}/${rows[0].signatureFileKey}`;
    assert.ok(fs.existsSync(absolute));
    assert.strictEqual(await prisma.admissionDocument.count({ where: { applicationId: app.id } }), 0);
    const audit = await prisma.admissionAuditEvent.findFirstOrThrow({
      where: { applicationId: app.id, eventType: "FINANCIAL_AGREEMENT_SIGNED" },
    });
    const metadata = JSON.stringify(audit.metadataJson);
    assert.match(metadata, /FINANCIAL_POLICY/);
    assert.ok(!metadata.includes("signature"));
    assert.ok(!metadata.includes("8001015009087"));
    assert.strictEqual(
      await openStaffFinancialSignature(prisma, b.school.id, app.id),
      null
    );
    const staff = await getStaffApplicationDetail(prisma, a.school.id, app.id);
    assert.strictEqual(staff.financialAgreement.required, false);
    assert.match(
      String(staff.financialAgreement.notRequiredMessage),
      /not required when this application was submitted/
    );
    await assert.rejects(() => getStaffApplicationDetail(prisma, b.school.id, app.id));

    await publishLegalDocument(prisma, a.school.id, {
      kind: "FINANCIAL_POLICY",
      versionLabel: "2027.3",
      title: "Policy",
      body: "Republished policy text",
    });
    await updateDraftApplication(prisma, a.slug, accessId, token, {
      privacyAccepted: true,
      declarationsAccepted: true,
    });
    assert.strictEqual(
      await codeOf(submitApplication(prisma, a.slug, accessId, token)),
      "VALIDATION_FAILED"
    );

    app = await reload();
    await signFinancialAgreement(prisma, {
      schoolId: a.school.id,
      applicationId: app.id,
      status: "DRAFT",
      guardians: app.guardians,
      policyAccepted: true,
      declarationAccepted: true,
      typedSignerName: "Mary Jane",
      signaturePng: inkPng(),
      strokeCount: 3,
    });
    rows = await prisma.admissionFinancialAcceptance.findMany({ where: { applicationId: app.id } });
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((row) => row.contentSha256));

    await updateDraftApplication(prisma, a.slug, accessId, token, {
      guardians: [
        {
          firstName: "Mary",
          surname: "Smith",
          cellNo: "0820000000",
          idNumber: "8001015009087",
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
    });
    assert.strictEqual(
      await prisma.admissionFinancialAcceptance.count({ where: { applicationId: app.id } }),
      0
    );

    app = await reload();
    await signFinancialAgreement(prisma, {
      schoolId: a.school.id,
      applicationId: app.id,
      status: "DRAFT",
      guardians: app.guardians,
      policyAccepted: true,
      declarationAccepted: true,
      typedSignerName: "Mary Smith",
      signaturePng: inkPng(),
      strokeCount: 1,
    });
    await updateDraftApplication(prisma, a.slug, accessId, token, {
      guardians: [
        {
          firstName: "Mary",
          surname: "Smith",
          cellNo: "0820000000",
          idNumber: "9001015009088",
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
    });
    assert.strictEqual(
      await prisma.admissionFinancialAcceptance.count({ where: { applicationId: app.id } }),
      0
    );

    app = await reload();
    await signFinancialAgreement(prisma, {
      schoolId: a.school.id,
      applicationId: app.id,
      status: "DRAFT",
      guardians: app.guardians,
      policyAccepted: true,
      declarationAccepted: true,
      typedSignerName: "Mary Smith",
      signaturePng: inkPng(),
      strokeCount: 1,
    });
    const submitted = await submitApplication(prisma, a.slug, accessId, token);
    assert.strictEqual(submitted.application.status, "SUBMITTED");
    const submittedRow = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: app.id } });
    assert.strictEqual(submittedRow.financialAgreementRequired, true);
    const signedDetail = await getStaffApplicationDetail(prisma, a.school.id, app.id);
    assert.strictEqual(signedDetail.financialAgreement.required, true);
    assert.strictEqual(signedDetail.financialAgreement.acceptances.length, 2);
    assert.ok(signedDetail.financialAgreement.acceptances.some((row) => row.body.includes("Republished")));
    assert.strictEqual(signedDetail.financialAgreement.signatureAvailable, true);
    const staffFile = await openStaffFinancialSignature(prisma, a.school.id, app.id);
    assert.ok(staffFile?.absolutePath);

    const historical = await createDraftApplication(prisma, b.slug, {
      intakeYear: 2027,
      requestedGrade: "Grade 1",
      learner: { firstName: "Old", lastName: "Application", birthDate: "2017-01-01" },
      guardians: [
        {
          firstName: "Pat",
          surname: "Lee",
          email: "pat@example.com",
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
    });
    await updateDraftApplication(prisma, b.slug, historical.application.publicAccessId, historical.accessToken, {
      privacyAccepted: true,
      declarationsAccepted: true,
    });
    const historicalSubmitted = await submitApplication(
      prisma,
      b.slug,
      historical.application.publicAccessId,
      historical.accessToken
    );
    assert.strictEqual(historicalSubmitted.application.status, "SUBMITTED");
    const historicalRow = await prisma.admissionApplication.findFirstOrThrow({
      where: { publicAccessId: historical.application.publicAccessId },
    });
    assert.strictEqual(historicalRow.financialAgreementRequired, false);
    const again = await submitApplication(
      prisma,
      b.slug,
      historical.application.publicAccessId,
      historical.accessToken
    );
    assert.strictEqual(again.application.status, "SUBMITTED");
    const unchanged = await prisma.admissionApplication.findUniqueOrThrow({
      where: { id: historicalRow.id },
    });
    assert.strictEqual(unchanged.financialAgreementRequired, false);
    assert.strictEqual(
      await prisma.admissionFinancialAcceptance.count({ where: { applicationId: historicalRow.id } }),
      0
    );

    console.log("financial agreement integration tests passed");
  } finally {
    for (const schoolId of created) {
      await cleanupSchool(schoolId).catch((err) => {
        console.error("cleanup failed", schoolId, err);
      });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
