/**
 * Run: npx tsx src/services/secureUploadAccess.unit.test.ts
 */
import assert from "assert";
import {
  safeUploadBasename,
  basenameFromPrefixedUrl,
  redactAttachmentUrls,
  attachmentAtIndex,
} from "./secureUploadAccess";

assert.equal(safeUploadBasename("a-1.pdf"), "a-1.pdf");
assert.equal(safeUploadBasename("../x"), null);
assert.equal(safeUploadBasename("a/b"), null);

assert.equal(
  basenameFromPrefixedUrl("http://h/uploads/parent-messages/a-1.pdf", "/uploads/parent-messages/"),
  "a-1.pdf"
);

const redacted = redactAttachmentUrls(
  [{ name: "n", url: "http://h/uploads/parent-messages/a-1.pdf" }],
  { downloadBasePath: "/api/x/attachments", publicPrefix: "/uploads/parent-messages/" }
) as Array<{ url: null; downloadPath: string }>;
assert.equal(redacted[0].url, null);
assert.ok(redacted[0].downloadPath.endsWith("/0"));

assert.ok(attachmentAtIndex([{ name: "n", url: "/uploads/parent-messages/a-1.pdf" }], 0));
assert.equal(attachmentAtIndex([{ name: "n", url: "x" }], 9), null);
assert.equal(attachmentAtIndex([{ name: "n", url: "x" }], -1), null);

console.log("secureUploadAccess.unit.test: PASS");
