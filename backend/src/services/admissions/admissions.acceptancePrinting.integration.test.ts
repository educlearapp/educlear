/**
 * Acceptance with pending payment + printing/download routes (local educlear DB only).
 * Isolated fixture schools; never touches real schools. Cleans up rows and stored files.
 * Run: npx tsx src/services/admissions/admissions.acceptancePrinting.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import express from "express";
import fs from "fs/promises";
import http from "http";
import jwt from "jsonwebtoken";
import path from "path";
import zlib from "zlib";

import { PDFDocument as PdfLibDocument } from "pdf-lib";
import { PrismaClient } from "@prisma/client";

import admissionsRoutes from "../../routes/admissions";
import { STAFF_JWT_SECRET } from "../../utils/staffJwt";
import { permissionsForRole } from "../../utils/userPermissions";
import { getConversionPreflight } from "./admissionsConversionService";
import { resolveAdmissionsStorageRoot, uploadApplicantDocument, uploadProofOfPayment } from "./admissionsDocumentService";
import { createDraftApplication, updateDraftApplication } from "./draftApplicationService";
import { submitApplication } from "./submitApplicationService";
import {
  PAYMENT_PENDING_ACCEPTANCE_WARNING,
  rejectAdmissionApplication,
  rejectAdmissionProofOfPayment,
  requestApplicationInfo,
  startApplicationReview,
  verifyAdmissionPayment,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";

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

async function realPdf(pages: number): Promise<Buffer> {
  const d = await PdfLibDocument.create();
  for (let i = 0; i < pages; i += 1) d.addPage([595.28, 841.89]);
  return Buffer.from(await d.save());
}

function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0x99);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, "EOCD present");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < total; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    assert.strictEqual(zlib.crc32(data) >>> 0, crc, `CRC ${name}`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function makeSchool(suffix: string) {
  const stamp = Date.now().toString(36);
  const school = await prisma.school.create({ data: { name: `OAPRINT ${suffix} ${stamp}` } });
  const slug = `oaprint-${suffix}-${stamp}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: true,
      defaultAdmissionFeeAmount: "1600.00" as any,
      currency: "ZAR",
      requirePaymentVerifiedBeforeAccept: true,
      requiredDocuments: [
        { key: "birth_certificate", label: "Birth certificate", required: true },
        { key: "parent_id", label: "Parent ID", required: true },
      ],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
      bankName: "Test Bank",
      accountHolder: "School",
      accountNumber: "123456789",
      branchCode: "250655",
    },
  });
  const mkUser = (tag: string, role: "SCHOOL_ADMIN" | "FINANCE") =>
    prisma.user.create({
      data: {
        schoolId: school.id,
        email: `oaprint-${tag}-${suffix}-${stamp}@example.com`,
        passwordHash: "x",
        role,
        isActive: true,
        fullName: `Fixture ${tag}`,
      },
    });
  const admin = await mkUser("admin", "SCHOOL_ADMIN");
  const finance = await mkUser("fin", "FINANCE");
  const viewer = await mkUser("view", "FINANCE");
  await prisma.userRbacMeta.create({
    data: { userId: admin.id, schoolId: school.id, appRole: "Admin", permissions: permissionsForRole("Admin") as any },
  });
  await prisma.userRbacMeta.create({
    data: { userId: finance.id, schoolId: school.id, appRole: "Finance", permissions: permissionsForRole("Finance") as any },
  });
  await prisma.userRbacMeta.create({
    data: {
      userId: viewer.id,
      schoolId: school.id,
      appRole: "Custom",
      permissions: { admissions: { view: true } },
    },
  });
  return { school, slug, admin, finance, viewer };
}

function token(user: { id: string; schoolId: string | null; email: string; role: string }) {
  return jwt.sign(
    { userId: user.id, schoolId: user.schoolId, email: user.email, role: user.role },
    STAFF_JWT_SECRET
  );
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({ where: { schoolId }, select: { id: true } });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionFeeRecord.updateMany({ where: { applicationId: { in: ids } }, data: { latestProofDocumentId: null } });
    await prisma.admissionDocument.updateMany({ where: { applicationId: { in: ids } }, data: { replacedByDocumentId: null } });
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
  await prisma.admissionAuditEvent.deleteMany({ where: { schoolId } });
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.userRbacMeta.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oaprint-" } } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  const dir = path.join(resolveAdmissionsStorageRoot(), schoolId);
  if (dir.includes(`${path.sep}admissions${path.sep}`) && schoolId.length > 10) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function submitWithDocs(slug: string, opts: { pop?: boolean } = {}) {
  const draft = await createDraftApplication(prisma, slug, {
    requestedGrade: "Grade 1",
    learner: { firstName: "", lastName: "" },
  });
  await updateDraftApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: { firstName: "Fixture", lastName: "Learner", birthDate: "2020-05-01", homeAddress: "1 Fixture St", idNumber: "0000000000000" },
    guardians: [
      {
        firstName: "Fixture",
        surname: "Guardian",
        cellNo: "0820000000",
        email: "guardian@example.test",
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "1 Fixture St",
      },
    ],
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Fixture answer" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
  await submitApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken);
  const accessId = draft.application.publicAccessId;
  const tok = draft.accessToken;
  await uploadApplicantDocument(prisma, slug, accessId, tok, {
    documentType: "birth_certificate",
    buffer: await realPdf(2),
    originalFileName: "birth.pdf",
    claimedMime: "application/pdf",
  });
  await uploadApplicantDocument(prisma, slug, accessId, tok, {
    documentType: "parent_id",
    buffer: makePng(60, 40),
    originalFileName: "parent-id.png",
    claimedMime: "image/png",
  });
  if (opts.pop) {
    await uploadProofOfPayment(prisma, slug, accessId, tok, {
      buffer: minimalPdf(),
      originalFileName: "pop.pdf",
      claimedMime: "application/pdf",
    });
  }
  const row = await prisma.admissionApplication.findFirstOrThrow({ where: { publicAccessId: accessId } });
  return { appId: row.id, applicationNumber: row.applicationNumber! };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/admissions", admissionsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}/api/admissions`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];
  const server = await startServer();
  const call = async (method: "GET" | "POST", url: string, tok: string | null, body?: unknown) => {
    const res = await fetch(`${server.base}${url}`, {
      method,
      headers: {
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf, json: () => JSON.parse(buf.toString("utf8")) };
  };

  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    schoolIds.push(a.school.id, b.school.id);
    const adminTok = token(a.admin);
    const financeTok = token(a.finance);
    const viewerTok = token(a.viewer);
    const adminBTok = token(b.admin);
    const adminActor: StaffWorkflowActor = {
      userId: a.admin.id,
      schoolId: a.school.id,
      appRole: "Admin",
      hasAdmissionsEdit: true,
      hasAdmissionsManage: true,
    };
    const financeActor: StaffWorkflowActor = { ...adminActor, userId: a.finance.id, appRole: "Finance", hasAdmissionsManage: false };

    // ---------- Acceptance with PROOF_UPLOADED ----------
    const pending = await submitWithDocs(a.slug, { pop: true });
    await startApplicationReview(prisma, adminActor, pending.appId);

    const noAck = await call("POST", `/applications/${pending.appId}/accept`, adminTok, {});
    assert.strictEqual(noAck.res.status, 409);
    assert.strictEqual(noAck.json().code, "PAYMENT_PENDING_ACKNOWLEDGEMENT_REQUIRED");
    assert.strictEqual(noAck.json().error, PAYMENT_PENDING_ACCEPTANCE_WARNING);

    const stringAck = await call("POST", `/applications/${pending.appId}/accept`, adminTok, { acknowledgePaymentPending: "true" });
    assert.strictEqual(stringAck.res.status, 409, "only boolean true acknowledges");

    const financeAccept = await call("POST", `/applications/${pending.appId}/accept`, financeTok, { acknowledgePaymentPending: true });
    assert.strictEqual(financeAccept.res.status, 403, "Finance cannot accept");
    const viewerAccept = await call("POST", `/applications/${pending.appId}/accept`, viewerTok, { acknowledgePaymentPending: true });
    assert.strictEqual(viewerAccept.res.status, 403, "view-only cannot accept");
    const crossAccept = await call("POST", `/applications/${pending.appId}/accept`, adminBTok, { acknowledgePaymentPending: true });
    assert.strictEqual(crossAccept.res.status, 404, "cross-school accept blocked");

    const feeBefore = await prisma.admissionFeeRecord.findUniqueOrThrow({ where: { applicationId: pending.appId } });
    const payHistBefore = await prisma.admissionPaymentHistory.count({ where: { applicationId: pending.appId } });
    const canonicalBefore = {
      learners: await prisma.learner.count({ where: { schoolId: a.school.id } }),
      parents: await prisma.parent.count({ where: { schoolId: a.school.id } }),
      families: await prisma.familyAccount.count({ where: { schoolId: a.school.id } }),
    };

    // Concurrent duplicate acceptance — exactly one status change.
    const [acc1, acc2] = await Promise.all([
      call("POST", `/applications/${pending.appId}/accept`, adminTok, { acknowledgePaymentPending: true }),
      call("POST", `/applications/${pending.appId}/accept`, adminTok, { acknowledgePaymentPending: true }),
    ]);
    assert.strictEqual(acc1.res.status, 200);
    assert.strictEqual(acc2.res.status, 200);
    assert.deepStrictEqual([acc1.json().idempotent, acc2.json().idempotent].sort(), [false, true]);
    const accepted = acc1.json().application;
    assert.strictEqual(accepted.status, "ACCEPTED");
    assert.strictEqual(accepted.payment.paymentStatus, "PROOF_UPLOADED");
    assert.strictEqual(
      await prisma.admissionStatusHistory.count({ where: { applicationId: pending.appId, toStatus: "ACCEPTED" } }),
      1
    );
    const repeatNoAck = await call("POST", `/applications/${pending.appId}/accept`, adminTok, {});
    assert.strictEqual(repeatNoAck.res.status, 200, "repeat accept is idempotent");
    assert.strictEqual(repeatNoAck.json().idempotent, true);

    const feeAfter = await prisma.admissionFeeRecord.findUniqueOrThrow({ where: { applicationId: pending.appId } });
    assert.deepStrictEqual(
      { s: feeAfter.paymentStatus, amt: feeAfter.amount?.toFixed(2), v: feeAfter.verifiedAt, vb: feeAfter.verifiedByUserId, p: feeAfter.latestProofDocumentId, u: feeAfter.updatedAt.getTime() },
      { s: feeBefore.paymentStatus, amt: "1600.00", v: null, vb: null, p: feeBefore.latestProofDocumentId, u: feeBefore.updatedAt.getTime() },
      "fee record untouched by acceptance"
    );
    assert.strictEqual(await prisma.admissionPaymentHistory.count({ where: { applicationId: pending.appId } }), payHistBefore);
    assert.deepStrictEqual(
      {
        learners: await prisma.learner.count({ where: { schoolId: a.school.id } }),
        parents: await prisma.parent.count({ where: { schoolId: a.school.id } }),
        families: await prisma.familyAccount.count({ where: { schoolId: a.school.id } }),
      },
      canonicalBefore,
      "no learner / parent / family account created"
    );
    const appRow = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: pending.appId } });
    assert.strictEqual(appRow.acceptedByUserId, a.admin.id);
    assert.ok(appRow.acceptedAt);
    assert.strictEqual(appRow.promotedLearnerId, null);
    const acceptedEvent = await prisma.admissionAuditEvent.findFirstOrThrow({
      where: { applicationId: pending.appId, eventType: "APPLICATION_ACCEPTED" },
    });
    const meta = acceptedEvent.metadataJson as Record<string, unknown>;
    assert.strictEqual(meta.paymentVerificationPending, true);
    assert.strictEqual(meta.paymentPendingAcknowledged, true);
    assert.strictEqual(meta.paymentStatusAtAcceptance, "PROOF_UPLOADED");

    // Enrolment: warning only (owner decision), never a blocker.
    const preflight = await getConversionPreflight(
      prisma,
      { userId: a.admin.id, schoolId: a.school.id, appRole: "Admin", hasAdmissionsManage: true, hasLearnersCreate: true },
      pending.appId
    );
    assert.ok(preflight.warnings.some((w) => w.code === "ADMISSION_FEE_VERIFICATION_PENDING"));
    assert.ok(!preflight.blockers.some((w) => w.code.startsWith("ADMISSION_FEE")));

    // ---------- Downloads (read-only; audited) ----------
    const statusSnapshot = async (id: string) => {
      const r = await prisma.admissionApplication.findUniqueOrThrow({ where: { id }, select: { status: true, updatedAt: true } });
      const f = await prisma.admissionFeeRecord.findUniqueOrThrow({ where: { applicationId: id }, select: { paymentStatus: true, updatedAt: true } });
      return { s: r.status, u: r.updatedAt.getTime(), ps: f.paymentStatus, fu: f.updatedAt.getTime() };
    };
    const before = await statusSnapshot(pending.appId);

    const pdf = await call("GET", `/applications/${pending.appId}/application.pdf`, adminTok);
    assert.strictEqual(pdf.res.status, 200);
    assert.strictEqual(pdf.res.headers.get("content-type"), "application/pdf");
    assert.strictEqual(pdf.res.headers.get("cache-control"), "no-store");
    assert.ok(pdf.res.headers.get("content-disposition")!.includes(`${pending.applicationNumber}_application.pdf`));
    assert.ok(pdf.buf.subarray(0, 5).toString("latin1") === "%PDF-");
    const appPages = (await PdfLibDocument.load(pdf.buf)).getPageCount();

    assert.strictEqual((await call("GET", `/applications/${pending.appId}/application.pdf`, financeTok)).res.status, 200, "edit may print");
    const viewerPdf = await call("GET", `/applications/${pending.appId}/application.pdf`, viewerTok);
    assert.strictEqual(viewerPdf.res.status, 403, "view-only may not print full application");
    assert.strictEqual((await call("GET", `/applications/${pending.appId}/application.pdf`, null)).res.status, 401);
    assert.strictEqual((await call("GET", `/applications/${pending.appId}/application.pdf`, adminBTok)).res.status, 404, "cross-school PDF");
    for (const v of ["documents.zip", "application-pack.zip", "application-combined.pdf"]) {
      assert.strictEqual((await call("GET", `/applications/${pending.appId}/${v}`, viewerTok)).res.status, 403, `viewer ${v}`);
      assert.strictEqual((await call("GET", `/applications/${pending.appId}/${v}`, adminBTok)).res.status, 404, `cross-school ${v}`);
    }

    const combined = await call("GET", `/applications/${pending.appId}/application-combined.pdf`, adminTok);
    assert.strictEqual(combined.res.status, 200);
    const combinedPages = (await PdfLibDocument.load(combined.buf)).getPageCount();
    // app + contents + birth (2 pages) + parent ID image (1); minimal POP PDF has no pages -> listed only
    assert.strictEqual(combinedPages, appPages + 1 + 2 + 1);

    const docsZip = await call("GET", `/applications/${pending.appId}/documents.zip`, adminTok);
    assert.strictEqual(docsZip.res.status, 200);
    assert.strictEqual(docsZip.res.headers.get("content-type"), "application/zip");
    const docsEntries = readZip(docsZip.buf);
    assert.ok(Array.from(docsEntries.keys()).every((n) => n.startsWith(`${pending.applicationNumber}/`)));
    assert.ok(!Array.from(docsEntries.keys()).some((n) => n.endsWith("_application.pdf")));
    assert.strictEqual(Array.from(docsEntries.keys()).filter((n) => n.includes("/documents/")).length, 3);

    const packZip = await call("GET", `/applications/${pending.appId}/application-pack.zip`, financeTok);
    assert.strictEqual(packZip.res.status, 200);
    const packEntries = readZip(packZip.buf);
    assert.ok(packEntries.has(`${pending.applicationNumber}/${pending.applicationNumber}_application.pdf`));
    const manifest = packEntries.get(`${pending.applicationNumber}/manifest.csv`)!.toString("utf8");
    assert.ok(manifest.includes("Birth certificate") && manifest.includes("Proof of payment"));
    assert.ok(!manifest.includes("data/admissions") && !manifest.includes(a.school.id), "no storage paths");

    // Single document: view permission retained; audited as view vs download.
    const docRow = await prisma.admissionDocument.findFirstOrThrow({
      where: { applicationId: pending.appId, documentType: "parent_id", deletedAt: null },
    });
    const viewDoc = await call("GET", `/applications/${pending.appId}/documents/${docRow.id}/download?disposition=inline`, viewerTok);
    assert.strictEqual(viewDoc.res.status, 200);
    assert.ok(viewDoc.res.headers.get("content-disposition")!.startsWith("inline"));
    assert.strictEqual(viewDoc.res.headers.get("x-content-type-options"), "nosniff");
    const dlDoc = await call("GET", `/applications/${pending.appId}/documents/${docRow.id}/download`, viewerTok);
    assert.strictEqual(dlDoc.res.status, 200);
    assert.ok(dlDoc.res.headers.get("content-disposition")!.startsWith("attachment"));
    assert.ok(dlDoc.buf.equals(makePng(60, 40)), "original bytes");
    assert.strictEqual(
      (await call("GET", `/applications/${pending.appId}/documents/${docRow.id}/download`, adminBTok)).res.status,
      404,
      "cross-school document"
    );

    // Missing stored file: pack still builds; manifest records it.
    const birth = await prisma.admissionDocument.findFirstOrThrow({
      where: { applicationId: pending.appId, documentType: "birth_certificate", deletedAt: null },
    });
    await fs.rm(path.join(resolveAdmissionsStorageRoot(), ...birth.storageKey.split("/")));
    const packMissing = await call("GET", `/applications/${pending.appId}/application-pack.zip`, adminTok);
    assert.strictEqual(packMissing.res.status, 200);
    const missingEntries = readZip(packMissing.buf);
    assert.ok(!Array.from(missingEntries.keys()).some((n) => n.includes("birth_certificate")));
    assert.ok(missingEntries.get(`${pending.applicationNumber}/manifest.csv`)!.toString("utf8").includes("missing — stored file unavailable"));
    const missingCombined = await call("GET", `/applications/${pending.appId}/application-combined.pdf`, adminTok);
    assert.strictEqual(missingCombined.res.status, 200);

    // Downloads never change application or payment state.
    assert.deepStrictEqual(await statusSnapshot(pending.appId), before);

    const events = await prisma.admissionAuditEvent.findMany({
      where: { applicationId: pending.appId, eventType: { in: [
        "APPLICATION_PDF_GENERATED",
        "APPLICATION_COMBINED_PDF_GENERATED",
        "APPLICATION_DOCUMENTS_ZIP_DOWNLOADED",
        "APPLICATION_PACK_DOWNLOADED",
        "DOCUMENT_VIEWED",
        "DOCUMENT_DOWNLOADED",
      ] } },
    });
    const types = new Set(events.map((e) => e.eventType));
    for (const t of ["APPLICATION_PDF_GENERATED", "APPLICATION_COMBINED_PDF_GENERATED", "APPLICATION_DOCUMENTS_ZIP_DOWNLOADED", "APPLICATION_PACK_DOWNLOADED", "DOCUMENT_VIEWED", "DOCUMENT_DOWNLOADED"]) {
      assert.ok(types.has(t), `audit ${t}`);
    }
    const metaJson = JSON.stringify(events.map((e) => e.metadataJson));
    assert.ok(!metaJson.includes("@") && !metaJson.includes("0000000000000") && !metaJson.includes("data/admissions"), "no PII/paths in audit metadata");
    // Forbidden attempts are not audited as downloads.
    assert.ok(events.every((e) => e.actorUserId !== b.admin.id));

    // Payment can still be verified after acceptance.
    const verified = await verifyAdmissionPayment(prisma, financeActor, pending.appId);
    assert.strictEqual(verified.application.payment?.paymentStatus, "VERIFIED");
    assert.strictEqual(verified.application.status, "ACCEPTED");

    // ---------- Other payment states keep their safeguards ----------
    const awaiting = await submitWithDocs(a.slug);
    await startApplicationReview(prisma, adminActor, awaiting.appId);
    const awaitingRes = await call("POST", `/applications/${awaiting.appId}/accept`, adminTok, { acknowledgePaymentPending: true });
    assert.strictEqual(awaitingRes.res.status, 409);
    assert.strictEqual(awaitingRes.json().code, "PAYMENT_NOT_VERIFIED");

    const popRejected = await submitWithDocs(a.slug, { pop: true });
    await startApplicationReview(prisma, adminActor, popRejected.appId);
    await rejectAdmissionProofOfPayment(prisma, financeActor, popRejected.appId, { reason: "Unreadable" });
    const rejRes = await call("POST", `/applications/${popRejected.appId}/accept`, adminTok, { acknowledgePaymentPending: true });
    assert.strictEqual(rejRes.res.status, 409);
    assert.strictEqual(rejRes.json().code, "PAYMENT_NOT_VERIFIED");

    const faApp = await submitWithDocs(a.slug, { pop: true });
    await startApplicationReview(prisma, adminActor, faApp.appId);
    await prisma.admissionApplication.update({ where: { id: faApp.appId }, data: { financialAgreementRequired: true } });
    const faRes = await call("POST", `/applications/${faApp.appId}/accept`, adminTok, { acknowledgePaymentPending: true });
    assert.strictEqual(faRes.res.status, 400);
    assert.strictEqual(faRes.json().code, "FINANCIAL_AGREEMENT_INCOMPLETE");

    // ---------- Application statuses ----------
    const submittedOnly = await submitWithDocs(a.slug, { pop: true });
    const subRes = await call("POST", `/applications/${submittedOnly.appId}/accept`, adminTok, { acknowledgePaymentPending: true });
    assert.strictEqual(subRes.res.status, 409, "SUBMITTED cannot be accepted");

    const infoReq = await submitWithDocs(a.slug, { pop: true });
    await requestApplicationInfo(prisma, adminActor, infoReq.appId, { message: "Need more" });
    const infoRes = await call("POST", `/applications/${infoReq.appId}/accept`, adminTok, { acknowledgePaymentPending: true });
    assert.strictEqual(infoRes.res.status, 409, "INFO_REQUESTED cannot be accepted");

    const declined = await submitWithDocs(a.slug, { pop: true });
    await startApplicationReview(prisma, adminActor, declined.appId);
    await rejectAdmissionApplication(prisma, adminActor, declined.appId, { reason: "Fixture decline" });
    const decRes = await call("POST", `/applications/${declined.appId}/accept`, adminTok, { acknowledgePaymentPending: true });
    assert.strictEqual(decRes.res.status, 409, "DECLINED cannot be reopened");
    assert.strictEqual((await prisma.admissionApplication.findUniqueOrThrow({ where: { id: declined.appId } })).status, "DECLINED");
    // Declined application can still be printed without changing it.
    const decBefore = await statusSnapshot(declined.appId);
    assert.strictEqual((await call("GET", `/applications/${declined.appId}/application.pdf`, adminTok)).res.status, 200);
    assert.deepStrictEqual(await statusSnapshot(declined.appId), decBefore);

    // Verified-payment acceptance unchanged (no acknowledgement needed).
    const verifiedApp = await submitWithDocs(a.slug, { pop: true });
    await startApplicationReview(prisma, adminActor, verifiedApp.appId);
    await verifyAdmissionPayment(prisma, financeActor, verifiedApp.appId);
    const verRes = await call("POST", `/applications/${verifiedApp.appId}/accept`, adminTok, {});
    assert.strictEqual(verRes.res.status, 200);
    assert.strictEqual(verRes.json().application.status, "ACCEPTED");
    const verMeta = (await prisma.admissionAuditEvent.findFirstOrThrow({
      where: { applicationId: verifiedApp.appId, eventType: "APPLICATION_ACCEPTED" },
    })).metadataJson as Record<string, unknown>;
    assert.strictEqual(verMeta.paymentVerificationPending, false);

    console.log("Acceptance/printing integration tests passed");
  } finally {
    await server.close();
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
