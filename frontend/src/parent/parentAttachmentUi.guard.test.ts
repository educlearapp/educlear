/**
 * Attachment UI — authenticated blob only; no public /uploads navigation.
 * Run: npx tsx src/parent/parentAttachmentUi.guard.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const portal = fs.readFileSync(path.join(here, "ParentPortalApp.tsx"), "utf8");
const parentList = fs.readFileSync(path.join(here, "ParentAttachmentList.tsx"), "utf8");
const blobHelper = fs.readFileSync(path.resolve(here, "../utils/authenticatedBlobDownload.ts"), "utf8");
const teacherList = fs.readFileSync(
  path.resolve(here, "../teacher-app/TeacherAttachmentList.tsx"),
  "utf8"
);
const teacherHw = fs.readFileSync(path.resolve(here, "../teacher-app/TeacherHomeworkPage.tsx"), "utf8");
const teacherNotices = fs.readFileSync(
  path.resolve(here, "../teacher-app/TeacherNoticesPage.tsx"),
  "utf8"
);

assert.ok(portal.includes("ParentAttachmentList"), "parent portal uses ParentAttachmentList");
assert.ok(portal.includes('label="Notice attachments"'), "notices show attachment controls");
assert.ok(portal.includes('label="Homework attachments"'), "homework shows attachment controls");
assert.ok(portal.includes('label="Message attachments"'), "messages show attachment controls");
assert.ok(!/href=\{[^}]*\/uploads\//.test(portal), "parent portal must not link to /uploads");
assert.ok(!/window\.location[^;]*\/uploads\//.test(portal), "parent portal must not navigate to /uploads");

assert.ok(parentList.includes("downloadAuthenticatedBlob"));
assert.ok(parentList.includes("authorisedAttachments"));
assert.ok(parentList.includes("Downloading…"));
assert.ok(parentList.includes('role="alert"') || parentList.includes("role=\"alert\""));
assert.ok(parentList.includes('role="status"') || parentList.includes("role=\"status\""));

assert.ok(blobHelper.includes('"/uploads/"'));
assert.ok(blobHelper.includes("Public upload URLs are not allowed"));
assert.ok(blobHelper.includes("triggerBlobFileSave"));
assert.ok(blobHelper.includes("1500"), "delayed revoke for Safari/PWA");

assert.ok(teacherList.includes("downloadAuthenticatedBlob"));
assert.ok(teacherHw.includes("TeacherAttachmentList"));
assert.ok(teacherNotices.includes("TeacherAttachmentList"));

console.log("parentAttachmentUi.guard.test: PASS");
