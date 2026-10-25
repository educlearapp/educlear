/**
 * Run: npx tsx src/utils/authenticatedBlobDownload.unit.test.ts
 */
import assert from "assert";
import {
  authorisedAttachments,
  downloadAuthenticatedBlob,
  triggerBlobFileSave,
} from "./authenticatedBlobDownload";

assert.deepEqual(authorisedAttachments(null), []);
assert.deepEqual(authorisedAttachments([]), []);
assert.equal(
  authorisedAttachments([
    { name: "a.pdf", downloadPath: "/api/parent-portal/notices/1/attachments/0" },
    { name: "bad", url: "/uploads/teacher-app/x.pdf" },
    { name: "bad2", downloadPath: "/uploads/teacher-app/x.pdf" },
    { name: "ok", downloadPath: "/api/teacher-app/homework/2/attachments/1" },
    { name: "empty", downloadPath: "" },
    { name: "rel", downloadPath: "api/parent-portal/x" },
  ]).length,
  2
);

// Multiple authorised attachments preserved in order
const multi = authorisedAttachments([
  { name: "one.pdf", downloadPath: "/api/parent-portal/homework/h1/attachments/0" },
  { name: "two.pdf", downloadPath: "/api/parent-portal/homework/h1/attachments/1" },
]);
assert.equal(multi.length, 2);
assert.equal(multi[0].name, "one.pdf");
assert.equal(multi[1].name, "two.pdf");

async function main() {
  await assert.rejects(
    () =>
      downloadAuthenticatedBlob("/uploads/teacher-app/x.pdf", "x.pdf", {
        mode: "parent",
        token: "t",
        apiBase: "http://localhost",
      }),
    /Public upload URLs/
  );

  await assert.rejects(
    () =>
      downloadAuthenticatedBlob("", "x.pdf", {
        mode: "parent",
        token: "t",
        apiBase: "http://localhost",
      }),
    /Download unavailable/
  );

  await assert.rejects(
    () =>
      downloadAuthenticatedBlob("/not-api/file", "x.pdf", {
        mode: "parent",
        token: "t",
        apiBase: "http://localhost",
      }),
    /Invalid download path/
  );

  // triggerBlobFileSave must not throw when DOM exists — skip in plain node
  if (typeof document !== "undefined") {
    triggerBlobFileSave(new Blob(["ok"]), "test.txt");
  }

  console.log("authenticatedBlobDownload.unit.test: PASS");
}

void main();
