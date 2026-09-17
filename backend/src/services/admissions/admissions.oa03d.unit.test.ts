/**
 * OA-03D unit tests — file validation (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03d.unit.test.ts
 */
import assert from "assert";
import path from "path";

import {
  ADMISSIONS_MAX_UPLOAD_BYTES,
  detectAdmissionsMimeFromBuffer,
  sanitizeOriginalFileName,
  validateAdmissionsUploadBuffer,
} from "./admissionsFileValidation";
import {
  buildAdmissionsStorageKey,
  isAllowedDocumentType,
  resolveAdmissionsStorageRoot,
} from "./admissionsDocumentService";

function minimalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
}

function minimalJpeg(): Buffer {
  // SOI + APP0 stub + EOI
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
}

function minimalPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

function main() {
  assert.strictEqual(detectAdmissionsMimeFromBuffer(minimalPdf()), "application/pdf");
  assert.strictEqual(detectAdmissionsMimeFromBuffer(minimalJpeg()), "image/jpeg");
  assert.strictEqual(detectAdmissionsMimeFromBuffer(minimalPng()), "image/png");
  assert.strictEqual(detectAdmissionsMimeFromBuffer(Buffer.from("MZ\x90\x00")), null);
  assert.strictEqual(detectAdmissionsMimeFromBuffer(Buffer.from("PK\x03\x04")), null);
  assert.strictEqual(detectAdmissionsMimeFromBuffer(Buffer.from("<script>")), null);

  const pdfOk = validateAdmissionsUploadBuffer({
    buffer: minimalPdf(),
    originalFileName: "../../../etc/passwd.pdf",
    claimedMime: "application/pdf",
  });
  assert.strictEqual(pdfOk.contentType, "application/pdf");
  assert.strictEqual(pdfOk.storageExt, ".pdf");
  assert.ok(!pdfOk.originalFileName.includes(".."));
  assert.ok(!pdfOk.originalFileName.includes("/"));

  const jpegOk = validateAdmissionsUploadBuffer({
    buffer: minimalJpeg(),
    originalFileName: "photo.JPG",
    claimedMime: "image/jpeg",
  });
  assert.strictEqual(jpegOk.contentType, "image/jpeg");

  const pngOk = validateAdmissionsUploadBuffer({
    buffer: minimalPng(),
    originalFileName: "scan.png",
    claimedMime: "image/png",
  });
  assert.strictEqual(pngOk.contentType, "image/png");

  assert.throws(
    () =>
      validateAdmissionsUploadBuffer({
        buffer: Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff]),
          Buffer.alloc(ADMISSIONS_MAX_UPLOAD_BYTES),
        ]),
        originalFileName: "big.jpg",
      }),
    (err: any) => err.code === "FILE_TOO_LARGE"
  );

  // Oversize with JPEG magic still rejected by size first — use PDF header + pad
  const huge = Buffer.concat([minimalPdf(), Buffer.alloc(ADMISSIONS_MAX_UPLOAD_BYTES)]);
  assert.throws(
    () => validateAdmissionsUploadBuffer({ buffer: huge, originalFileName: "huge.pdf" }),
    (err: any) => err.code === "FILE_TOO_LARGE"
  );

  assert.throws(
    () =>
      validateAdmissionsUploadBuffer({
        buffer: Buffer.from("MZ executable"),
        originalFileName: "malware.exe",
      }),
    (err: any) => err.code === "INVALID_FILE_TYPE"
  );

  assert.throws(
    () =>
      validateAdmissionsUploadBuffer({
        buffer: Buffer.from("PK\x03\x04zip"),
        originalFileName: "archive.zip",
      }),
    (err: any) => err.code === "INVALID_FILE_TYPE"
  );

  // Extension mismatch: PDF bytes labeled .jpg
  assert.throws(
    () =>
      validateAdmissionsUploadBuffer({
        buffer: minimalPdf(),
        originalFileName: "fake.jpg",
      }),
    (err: any) => err.code === "EXTENSION_MISMATCH"
  );

  // Client MIME mismatch vs magic bytes
  assert.throws(
    () =>
      validateAdmissionsUploadBuffer({
        buffer: minimalPdf(),
        originalFileName: "doc.pdf",
        claimedMime: "image/png",
      }),
    (err: any) => err.code === "MIME_MISMATCH"
  );

  const sanitized = sanitizeOriginalFileName("../../evil\0name<script>.pdf");
  assert.ok(!sanitized.includes(".."));
  assert.ok(!sanitized.includes("\0"));
  assert.ok(!sanitized.includes("<"));

  assert.ok(isAllowedDocumentType("birth_certificate", { requiredDocuments: [] }));
  assert.ok(
    isAllowedDocumentType("custom_form", {
      requiredDocuments: [{ key: "custom_form", label: "Custom" }],
    })
  );
  assert.strictEqual(isAllowedDocumentType("unknown_type", { requiredDocuments: [] }), false);
  assert.strictEqual(isAllowedDocumentType("proof_of_payment", { requiredDocuments: [] }), true);

  const root = resolveAdmissionsStorageRoot("/tmp/educlear-backend");
  assert.strictEqual(root, path.join("/tmp/educlear-backend", "data", "admissions"));

  const key = buildAdmissionsStorageKey({
    schoolId: "schoolA",
    applicationId: "appB",
    storageExt: ".pdf",
  });
  assert.ok(key.storageKey.startsWith("schoolA/appB/"));
  assert.ok(key.storageKey.endsWith(".pdf"));
  assert.ok(!key.storageKey.includes(".."));
  assert.ok(key.absolutePath.includes(path.join("data", "admissions")));

  console.log("OA-03D unit tests passed");
}

main();
