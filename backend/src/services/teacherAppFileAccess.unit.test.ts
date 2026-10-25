/**
 * Teacher-app file path hardening helpers.
 * Run: npx tsx src/services/teacherAppFileAccess.unit.test.ts
 */
import assert from "assert";
import {
  safeTeacherAppBasename,
  basenameFromTeacherAppFileUrl,
  internalTeacherAppFileUrl,
  publicParentDocumentDto,
  redactTeacherAppAttachmentUrls,
} from "./teacherAppFileAccess";

assert.equal(safeTeacherAppBasename("1792-123.pdf"), "1792-123.pdf");
assert.equal(safeTeacherAppBasename("../etc/passwd"), null);
assert.equal(safeTeacherAppBasename("a/b.pdf"), null);
assert.equal(safeTeacherAppBasename(".."), null);
assert.equal(safeTeacherAppBasename(""), null);

assert.equal(
  basenameFromTeacherAppFileUrl("http://127.0.0.1:3000/uploads/teacher-app/1792-1.pdf"),
  "1792-1.pdf"
);
assert.equal(basenameFromTeacherAppFileUrl("/uploads/teacher-app/1792-1.pdf"), "1792-1.pdf");
assert.equal(basenameFromTeacherAppFileUrl("/uploads/teacher-app/../x.pdf"), null);

assert.equal(internalTeacherAppFileUrl("1792-1.pdf"), "/uploads/teacher-app/1792-1.pdf");

const dto = publicParentDocumentDto(
  {
    id: "doc1",
    title: "T",
    fileUrl: "/uploads/teacher-app/x.pdf",
    fileName: "x.pdf",
  },
  { audience: "parent" }
);
assert.equal(dto.fileUrl, null);
assert.ok(String(dto.downloadPath).includes("/api/parent-portal/documents/doc1/file"));
assert.equal("fileUrl" in dto && dto.fileUrl === null, true);

const redacted = redactTeacherAppAttachmentUrls(
  [{ name: "a.pdf", url: "http://host/uploads/teacher-app/a-1.pdf", mimeType: "application/pdf" }],
  { downloadBasePath: "/api/teacher-app/homework/h1/attachments" }
) as Array<{ url: null; downloadPath: string }>;
assert.equal(redacted[0].url, null);
assert.ok(redacted[0].downloadPath.endsWith("/0"));

console.log("teacherAppFileAccess.unit.test: PASS");
