/**
 * Acceptance-with-pending-payment gate, enrolment fee warnings, application PDF,
 * ZIP pack integrity and combined printable PDF — no DB.
 * Run: npx tsx src/services/admissions/admissions.acceptancePrinting.unit.test.ts
 */
import assert from "assert";
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";

import { PDFDocument as PdfLibDocument } from "pdf-lib";
import PDFKitDocument from "pdfkit";

import {
  formatAnswerValue,
  installContinuationHeader,
  paymentSummaryLines,
  pdfSafeText,
  renderApplicationPdf,
  sortDocumentsForPrint,
  applicationFileBase,
  type ApplicationPdfModel,
} from "./admissionsApplicationPdfService";
import {
  buildCombinedPrintablePdf,
  buildManifestCsv,
  createApplicationPackZipStream,
  winAnsiSafe,
  type PackDocument,
} from "./admissionsDocumentPackService";
import { admissionFeeEnrolmentWarning } from "./admissionsPaymentWarnings";
import type { StaffApplicationDetail } from "./staffAdmissionsReadService";
import {
  financialAgreementAllowsAcceptance,
  paymentAllowsAcceptance,
  PAYMENT_PENDING_ACCEPTANCE_WARNING,
} from "./staffAdmissionsWorkflowService";

const ALL_PAYMENT = [
  "NOT_REQUIRED",
  "AWAITING_PAYMENT",
  "PROOF_UPLOADED",
  "UNDER_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "WAIVED",
];

function testPaymentGate() {
  assert.strictEqual(
    PAYMENT_PENDING_ACCEPTANCE_WARNING,
    "Payment verification pending. Proof of payment has been uploaded, but receipt of funds has not yet been verified. Accepting this application does not confirm payment."
  );
  for (const status of ALL_PAYMENT) {
    for (const ack of [false, true]) {
      const r = paymentAllowsAcceptance({
        requirePaymentVerifiedBeforeAccept: true,
        feeRequired: status !== "NOT_REQUIRED",
        paymentStatus: status,
        acknowledgePaymentPending: ack,
      });
      const expectOk =
        status === "NOT_REQUIRED" ||
        status === "VERIFIED" ||
        status === "WAIVED" ||
        (status === "PROOF_UPLOADED" && ack);
      assert.strictEqual(r.ok, expectOk, `${status} ack=${ack}`);
      if (status === "PROOF_UPLOADED" && !ack) {
        assert.strictEqual(r.code, "PAYMENT_PENDING_ACKNOWLEDGEMENT_REQUIRED");
        assert.strictEqual(r.message, PAYMENT_PENDING_ACCEPTANCE_WARNING);
      }
      if (["AWAITING_PAYMENT", "UNDER_VERIFICATION", "REJECTED"].includes(status)) {
        assert.strictEqual(r.code, "PAYMENT_NOT_VERIFIED", status);
      }
      assert.strictEqual(Boolean(r.paymentPending), status === "PROOF_UPLOADED" && ack, `pending ${status}`);
    }
  }
  // Non-boolean truthy acknowledgement must not pass.
  assert.strictEqual(
    paymentAllowsAcceptance({
      requirePaymentVerifiedBeforeAccept: true,
      feeRequired: true,
      paymentStatus: "PROOF_UPLOADED",
      acknowledgePaymentPending: "yes" as unknown as boolean,
    }).ok,
    false
  );
  // School setting off keeps the legacy behaviour.
  for (const status of ALL_PAYMENT) {
    assert.strictEqual(
      paymentAllowsAcceptance({ requirePaymentVerifiedBeforeAccept: false, feeRequired: true, paymentStatus: status }).ok,
      true
    );
  }
}

function testFinancialGate() {
  const good = (kind: string) => ({
    kind,
    contentSha256: "abc",
    typedSignerName: "A Parent",
    signatureFileKey: "s/k.png",
  });
  assert.strictEqual(financialAgreementAllowsAcceptance({ financialAgreementRequired: false, acceptances: [] }).ok, true);
  assert.strictEqual(
    financialAgreementAllowsAcceptance({
      financialAgreementRequired: true,
      acceptances: [good("FINANCIAL_POLICY"), good("FINANCIAL_DECLARATION")],
    }).ok,
    true
  );
  const missing = financialAgreementAllowsAcceptance({
    financialAgreementRequired: true,
    acceptances: [good("FINANCIAL_POLICY")],
  });
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.missingKinds, ["FINANCIAL_DECLARATION"]);
  assert.strictEqual(
    financialAgreementAllowsAcceptance({
      financialAgreementRequired: true,
      acceptances: [good("FINANCIAL_POLICY"), { ...good("FINANCIAL_DECLARATION"), typedSignerName: " " }],
    }).ok,
    false
  );
  assert.strictEqual(
    financialAgreementAllowsAcceptance({
      financialAgreementRequired: true,
      acceptances: [good("FINANCIAL_POLICY"), { ...good("FINANCIAL_DECLARATION"), signatureFileKey: null }],
    }).ok,
    false
  );
}

function testEnrolmentWarnings() {
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: false, paymentStatus: "AWAITING_PAYMENT" }), null);
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: "VERIFIED" }), null);
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: "WAIVED" }), null);
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: "PROOF_UPLOADED" })?.code, "ADMISSION_FEE_VERIFICATION_PENDING");
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: "UNDER_VERIFICATION" })?.code, "ADMISSION_FEE_VERIFICATION_PENDING");
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: "REJECTED" })?.code, "ADMISSION_FEE_PROOF_REJECTED");
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: "AWAITING_PAYMENT" })?.code, "ADMISSION_FEE_OUTSTANDING");
  assert.strictEqual(admissionFeeEnrolmentWarning({ feeRequired: true, paymentStatus: null })?.code, "ADMISSION_FEE_OUTSTANDING");
}

function baseDetail(overrides: Partial<StaffApplicationDetail> = {}): StaffApplicationDetail {
  const now = "2026-10-01T08:00:00.000Z";
  return {
    id: "app_fixture_000001",
    publicAccessId: "pub",
    applicationNumber: "APP-2027-900001",
    status: "UNDER_REVIEW",
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    lastApplicantActivityAt: now,
    feeRequired: true,
    feeAmount: "1600.00",
    feeCurrency: "ZAR",
    feeSnapshotAt: now,
    declaredExistingSibling: false,
    declaredSiblingLearnerName: null,
    declaredSiblingAdmissionNo: null,
    declaredExistingFamily: false,
    privacyAcceptedAt: now,
    declarationsAcceptedAt: now,
    privacyNoticeVersion: "v1",
    financialAgreement: { required: false, notRequiredMessage: "Not required.", signatureAvailable: false, acceptances: [] },
    statusReason: null,
    promotedLearnerId: null,
    promotedFamilyAccountId: null,
    promotedLearner: null,
    postEnrolment: null,
    learner: {
      firstName: "Fixture",
      lastName: "Learner",
      nickname: null,
      birthDate: "2020-02-02T00:00:00.000Z",
      gender: null,
      idNumber: null,
      homeLanguage: "English",
      citizenship: "South African",
      homeAddress: null,
      allergies: null,
      medicalAlert: null,
      previousSchoolName: null,
      notes: null,
    },
    guardians: [],
    answers: [],
    documents: [],
    documentCompleteness: {
      requiredDocumentTypes: [],
      uploadedDocumentTypes: [],
      missingDocumentTypes: [],
      unresolvedConditionTypes: [],
      documentsComplete: true,
    },
    payment: {
      required: true,
      amount: "1600.00",
      currency: "ZAR",
      paymentStatus: "PROOF_UPLOADED",
      paymentReference: "APP-2027-900001",
      proofUploaded: true,
      proofDocument: null,
      verifiedAt: null,
      verifiedByUserId: null,
      waivedAt: null,
      waivedByUserId: null,
      rejectedAt: null,
      rejectionReason: null,
      waiveReason: null,
    },
    paymentHistory: [],
    statusHistory: [],
    auditTimeline: [],
    staffNotes: null,
    ...overrides,
  };
}

function testPaymentSummary() {
  const label = (rows: Array<[string, string]>, key: string) => rows.find((r) => r[0] === key)?.[1] || "";
  const pending = paymentSummaryLines(baseDetail());
  const fee = label(pending, "Admission fee due").replace(/\s/g, "");
  assert.ok(fee === "R1600,00" || fee === "R1,600.00", `fee shown as ${fee}`);
  assert.ok(label(pending, "Proof of payment uploaded").startsWith("Yes"));
  assert.ok(label(pending, "Payment verification").startsWith("NOT VERIFIED"));

  const verified = paymentSummaryLines(
    baseDetail({ payment: { ...baseDetail().payment!, paymentStatus: "VERIFIED", verifiedAt: "2026-10-02T09:00:00.000Z" } })
  );
  assert.ok(label(verified, "Payment verification").startsWith("Verified"));

  const awaiting = paymentSummaryLines(
    baseDetail({ payment: { ...baseDetail().payment!, paymentStatus: "AWAITING_PAYMENT", proofUploaded: false } })
  );
  assert.strictEqual(label(awaiting, "Proof of payment uploaded"), "No");
  assert.ok(label(awaiting, "Payment verification").startsWith("NOT PAID"));

  const rejected = paymentSummaryLines(
    baseDetail({ payment: { ...baseDetail().payment!, paymentStatus: "REJECTED", rejectionReason: "Unreadable" } })
  );
  assert.ok(label(rejected, "Payment verification").includes("Fee outstanding"));

  const waived = paymentSummaryLines(baseDetail({ payment: { ...baseDetail().payment!, paymentStatus: "WAIVED" } }));
  assert.ok(label(waived, "Payment verification").includes("not a payment"));

  const free = paymentSummaryLines(baseDetail({ feeRequired: false, payment: { ...baseDetail().payment!, required: false, paymentStatus: "NOT_REQUIRED" } }));
  assert.deepStrictEqual(free, [["Admission fee", "Not required"]]);

  assert.strictEqual(formatAnswerValue(null), "Not provided");
  assert.strictEqual(formatAnswerValue("  "), "Not provided");
  assert.strictEqual(formatAnswerValue(true), "Yes");
  assert.strictEqual(formatAnswerValue(["a", "b"]), "a, b");
}

function model(detail: StaffApplicationDetail): ApplicationPdfModel {
  return {
    generatedAt: new Date("2026-10-14T10:00:00.000Z"),
    school: {
      name: "Fixture Academy",
      address: "1 Fixture Road\nTestville",
      postalAddress: null,
      phone: "010 000 0000",
      cellNo: null,
      email: "office@example.test",
      logo: null,
    },
    detail,
    medicalIncluded: false,
    acceptedAt: null,
    acceptedByName: null,
    declinedAt: null,
    acceptedWithPaymentPending: false,
    actorNames: {},
    signatureImages: [],
    checklist: [{ label: "Birth certificate", status: "Uploaded", required: true }],
    documents: [],
  };
}

async function testContinuationKeepsTextStyle() {
  const doc = new PDFKitDocument({ size: "A4", margins: { top: 50, bottom: 40, left: 40, right: 40 } });
  doc.on("data", () => undefined);
  let headers = 0;
  installContinuationHeader(doc, () => { headers += 1; }, "School · Admission application APP-1 (continued)", 500);
  const state = () => {
    const d = doc as unknown as { _font: { name: string }; _fontSize: number; _fillColor: unknown[] };
    return { font: d._font.name, size: d._fontSize, fill: d._fillColor[0] };
  };
  const fontsSeenOnContinuation: string[] = [];
  doc.on("pageAdded", () => fontsSeenOnContinuation.push(state().font));

  doc.font("Helvetica").fontSize(9).fillColor("#111827");
  const terms = Array.from({ length: 160 }, (_, i) => `Clause ${i + 1}. Fees are payable monthly in advance.`).join("\n");
  doc.text(terms, 40, 60, { width: 500 });
  assert.ok(headers >= 2, `text should flow across pages, got ${headers} page breaks`);
  assert.deepStrictEqual(state(), { font: "Helvetica", size: 9, fill: "#111827" }, "regular terms text after page break");
  assert.ok(fontsSeenOnContinuation.every((f) => f === "Helvetica"), `continued text font: ${fontsSeenOnContinuation}`);

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#6b7280");
  doc.addPage();
  assert.deepStrictEqual(state(), { font: "Helvetica-Bold", size: 11, fill: "#6b7280" }, "bold style also preserved");
  doc.end();
}

async function testPdfRendering() {
  const short = await renderApplicationPdf(model(baseDetail()));
  assert.ok(short.subarray(0, 5).toString("latin1").startsWith("%PDF"));
  const shortDoc = await PdfLibDocument.load(short);
  assert.ok(shortDoc.getPageCount() >= 1);
  assert.strictEqual(shortDoc.getPage(0).getSize().width.toFixed(0), "595");

  // Long application: many guardians, answers and a long policy body must flow across pages.
  const longBody = Array.from({ length: 220 }, (_, i) => `Clause ${i + 1}. Fees are payable monthly in advance and the responsible person accepts liability for all amounts due.`).join("\n");
  const long = baseDetail({
    status: "ACCEPTED",
    guardians: Array.from({ length: 4 }, (_, i) => ({
      id: `g${i}`,
      title: "Ms",
      firstName: `Guardian${i}`,
      surname: "Fixture",
      relationship: "Mother",
      idNumber: null,
      cellNo: "0820000000",
      email: `g${i}@example.test`,
      homeAddress: "A very long residential address line that must wrap within the value column without clipping, Suburb, City, Province, 0000",
      employer: null,
      isPrimary: i === 0,
      isPayingPerson: i === 0,
      sortOrder: i,
    })),
    answers: Array.from({ length: 30 }, (_, i) => ({
      questionKey: `q${i}`,
      questionLabelSnapshot: `Question ${i + 1}: Please describe in detail anything the school should know`,
      valueJson: "An answer that is deliberately long enough to wrap across more than one line in the PDF value column. ".repeat(3),
    })),
    financialAgreement: {
      required: true,
      notRequiredMessage: null,
      signatureAvailable: false,
      acceptances: [
        {
          kind: "FINANCIAL_POLICY",
          title: "Financial policy",
          version: "2027.1",
          body: longBody,
          contentSha256: "f".repeat(64),
          signerFullName: "Guardian0 Fixture",
          typedSignerName: "Guardian0 Fixture",
          acceptedAt: "2026-10-01T08:00:00.000Z",
          signedAt: "2026-10-01T08:00:00.000Z",
        },
      ],
    },
  });
  const longModel = { ...model(long), acceptedWithPaymentPending: true, acceptedAt: "2026-10-03T08:00:00.000Z", acceptedByName: "Admin Fixture" };
  const longPdf = await renderApplicationPdf(longModel);
  const longDoc = await PdfLibDocument.load(longPdf);
  assert.ok(longDoc.getPageCount() >= 5, `multi-page expected, got ${longDoc.getPageCount()}`);
  for (const p of longDoc.getPages()) {
    assert.strictEqual(Math.round(p.getSize().height), 842, "every page A4");
  }

  assert.strictEqual(applicationFileBase({ applicationNumber: "APP-2027-000001", id: "x" }), "APP-2027-000001");
  assert.strictEqual(applicationFileBase({ applicationNumber: null, id: "cabcdefgh12345678" }), "application-12345678");
  assert.strictEqual(applicationFileBase({ applicationNumber: '../"evil"/x', id: "x" }), ".._evil_x");
}

function testSortAndManifest() {
  const sorted = sortDocumentsForPrint(
    [
      { documentType: "proof_of_payment", uploadedAt: "2026-01-01" },
      { documentType: "zzz_other", uploadedAt: "2026-01-01" },
      { documentType: "parent_id", uploadedAt: "2026-01-02" },
      { documentType: "birth_certificate", uploadedAt: "2026-01-03" },
      { documentType: "parent_id", uploadedAt: "2026-01-01" },
    ],
    ["birth_certificate", "parent_id"]
  ).map((d) => `${d.documentType}@${d.uploadedAt}`);
  assert.deepStrictEqual(sorted, [
    "birth_certificate@2026-01-03",
    "parent_id@2026-01-01",
    "parent_id@2026-01-02",
    "zzz_other@2026-01-01",
    "proof_of_payment@2026-01-01",
  ]);

  const csv = buildManifestCsv({
    applicationRef: "APP-1",
    generatedAt: new Date("2026-10-14T10:00:00Z"),
    includesApplicationPdf: "APP-1_application.pdf",
    documents: [
      packDoc({ originalFileName: "=HYPERLINK(\"x\")", absolutePath: null }),
    ],
  });
  assert.ok(csv.includes("missing — stored file unavailable"));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), "formula injection neutralised");
  assert.ok(csv.includes("APP-1_application.pdf"));
}

function packDoc(overrides: Partial<PackDocument>): PackDocument {
  return {
    id: "d1",
    documentType: "birth_certificate",
    label: "Birth certificate",
    originalFileName: "birth.pdf",
    contentType: "application/pdf",
    byteSize: 10,
    uploadedAt: new Date("2026-10-01T08:00:00Z"),
    uploadedBy: "APPLICANT",
    packFileName: "documents/01_birth_certificate.pdf",
    absolutePath: null,
    ...overrides,
  };
}

/** Minimal ZIP reader: walks the central directory and verifies every entry's CRC-32. */
function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
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
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, "central header");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    assert.strictEqual(buf.readUInt32LE(localOff), 0x04034b50, "local header");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    assert.strictEqual(zlib.crc32(data) >>> 0, crc, `CRC ${name}`);
    assert.ok(!name.includes("..") && !name.startsWith("/"), "safe entry name");
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

function makePng(width: number, height: number): Buffer {
  const crcTable = (b: Buffer) => zlib.crc32(b) >>> 0;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcTable(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3, 0xcc);
  row[0] = 0;
  const rawData = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rawData)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function makePdf(pages: number): Promise<Buffer> {
  const d = await PdfLibDocument.create();
  for (let i = 0; i < pages; i += 1) d.addPage([595.28, 841.89]);
  return Buffer.from(await d.save());
}

async function testZipAndCombined() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "educlear-pack-test-"));
  try {
    const pdfPath = path.join(dir, "a.pdf");
    const pngPath = path.join(dir, "b.png");
    const bigPngPath = path.join(dir, "c.png");
    const brokenPath = path.join(dir, "d.pdf");
    const otherPath = path.join(dir, "e.bin");
    await fs.writeFile(pdfPath, await makePdf(2));
    await fs.writeFile(pngPath, makePng(40, 30));
    await fs.writeFile(bigPngPath, makePng(1800, 2600));
    await fs.writeFile(brokenPath, Buffer.from("%PDF-1.4\nnot really a pdf\n%%EOF\n"));
    await fs.writeFile(otherPath, Buffer.from("opaque"));
    const docs: PackDocument[] = [
      packDoc({ id: "1", absolutePath: pdfPath, packFileName: "documents/01_birth_certificate.pdf" }),
      packDoc({ id: "2", documentType: "parent_id", label: "Parent ID", contentType: "image/png", originalFileName: "id.png", absolutePath: pngPath, packFileName: "documents/02_parent_id.png" }),
      packDoc({ id: "3", documentType: "report", label: "School report", contentType: "image/png", originalFileName: "report.png", absolutePath: bigPngPath, packFileName: "documents/03_report.png" }),
      packDoc({ id: "4", documentType: "transfer", label: "Transfer letter", originalFileName: "broken.pdf", absolutePath: brokenPath, packFileName: "documents/04_transfer.pdf" }),
      packDoc({ id: "5", documentType: "misc", label: "Other", contentType: "application/octet-stream", originalFileName: "x.bin", absolutePath: otherPath, packFileName: "documents/05_misc.bin" }),
      packDoc({ id: "6", documentType: "missing", label: "Missing file", originalFileName: "gone.pdf", absolutePath: null, packFileName: "documents/06_missing.pdf" }),
    ];

    const appPdf = await renderApplicationPdf(model(baseDetail()));
    const zipBuf = await streamToBuffer(
      createApplicationPackZipStream({
        applicationRef: "APP-2027-900001",
        generatedAt: new Date("2026-10-14T10:00:00Z"),
        applicationPdf: appPdf,
        documents: docs,
      })
    );
    const entries = readZip(zipBuf);
    const names = Array.from(entries.keys()).sort();
    assert.deepStrictEqual(names, [
      "APP-2027-900001/APP-2027-900001_application.pdf",
      "APP-2027-900001/documents/01_birth_certificate.pdf",
      "APP-2027-900001/documents/02_parent_id.png",
      "APP-2027-900001/documents/03_report.png",
      "APP-2027-900001/documents/04_transfer.pdf",
      "APP-2027-900001/documents/05_misc.bin",
      "APP-2027-900001/manifest.csv",
    ]);
    assert.ok(entries.get("APP-2027-900001/documents/02_parent_id.png")!.equals(await fs.readFile(pngPath)), "original bytes preserved");
    const manifest = entries.get("APP-2027-900001/manifest.csv")!.toString("utf8");
    assert.ok(manifest.includes("gone.pdf") && manifest.includes("missing — stored file unavailable"), "missing listed");
    assert.ok(!manifest.includes(dir), "no storage paths in manifest");

    // Documents-only ZIP (no application PDF)
    const docsOnly = readZip(
      await streamToBuffer(
        createApplicationPackZipStream({ applicationRef: "APP-X", generatedAt: new Date(), applicationPdf: null, documents: docs.slice(0, 1) })
      )
    );
    assert.deepStrictEqual(Array.from(docsOnly.keys()).sort(), ["APP-X/documents/01_birth_certificate.pdf", "APP-X/manifest.csv"]);

    // Combined printable PDF
    const appPages = (await PdfLibDocument.load(appPdf)).getPageCount();
    const combined = await buildCombinedPrintablePdf({
      applicationRef: "APP-2027-900001",
      schoolName: "Fixture Academy",
      applicationPdf: appPdf,
      documents: docs,
    });
    const combinedDoc = await PdfLibDocument.load(combined.buffer);
    // app + contents + 2 (pdf) + 1 (png) + 1 (big png)
    assert.strictEqual(combinedDoc.getPageCount(), appPages + 1 + 2 + 1 + 1);
    const byLabel = new Map(combined.outcomes.map((o) => [o.label, o]));
    assert.strictEqual(byLabel.get("Birth certificate")!.merged, true);
    assert.strictEqual(byLabel.get("Birth certificate")!.startPage, appPages + 2);
    assert.strictEqual(byLabel.get("Parent ID")!.merged, true);
    assert.strictEqual(byLabel.get("School report")!.merged, true);
    assert.strictEqual(byLabel.get("Transfer letter")!.merged, false);
    assert.strictEqual(byLabel.get("Other")!.merged, false);
    assert.strictEqual(byLabel.get("Missing file")!.merged, false);
    assert.strictEqual(combined.outcomes.length, docs.length, "every document accounted for");
    // Large image scaled down to fit A4, never upscaled; page stays A4.
    const bigPage = combinedDoc.getPage(byLabel.get("School report")!.startPage! - 1);
    assert.strictEqual(Math.round(bigPage.getSize().width), 595);

    assert.strictEqual(winAnsiSafe("Ndlovu – café ✓ 漢"), "Ndlovu – café ? ?");
    assert.strictEqual(pdfSafeText("Şahin Łukasz → 😀\r\nNext"), "Sahin ?ukasz ? ?\nNext");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  testPaymentGate();
  testFinancialGate();
  testEnrolmentWarnings();
  testPaymentSummary();
  await testContinuationKeepsTextStyle();
  await testPdfRendering();
  testSortAndManifest();
  await testZipAndCombined();
  console.log("Acceptance/printing unit tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
