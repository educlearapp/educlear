/**
 * Run: npx tsx src/services/statementRecipientEmail.test.ts
 */
import {
  isValidStatementRecipientEmail,
  normalizeStatementRecipientEmail,
} from "./statementRecipientEmail";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function expectOk(raw: string, email: string) {
  const result = normalizeStatementRecipientEmail(raw);
  assert(result.ok, `expected ok for ${JSON.stringify(raw)}`);
  if (result.ok) assert(result.email === email, `expected ${email}, got ${result.ok ? result.email : ""}`);
}

function expectFail(raw: string, reasonPart: string) {
  const result = normalizeStatementRecipientEmail(raw);
  assert(!result.ok, `expected fail for ${JSON.stringify(raw)}`);
  if (!result.ok) {
    assert(
      result.reason.toLowerCase().includes(reasonPart.toLowerCase()),
      `expected reason containing ${reasonPart}, got ${result.reason}`
    );
  }
}

function main() {
  expectOk("parent@example.com", "parent@example.com");
  expectOk("  Parent.Name+tag@Example.COM  ", "parent.name+tag@example.com");
  expectOk("Jane Parent <jane.parent@school.org>", "jane.parent@school.org");
  expectOk("<wrapped@school.org>", "wrapped@school.org");

  expectFail("", "missing");
  expectFail("   ", "missing");
  expectFail("not-an-email", "@");
  expectFail("a@b", "invalid");
  expectFail("one@x.com,two@x.com", "multiple");
  expectFail("one@x.com;two@x.com", "multiple");
  expectFail("user name@example.com", "whitespace");
  // Production VUS001 class of failure: stray '>' inside otherwise email-shaped value
  expectFail("username>@gmail.com", "angle-bracket");
  expectFail("username@gmail.com>", "angle-bracket");
  expectFail("Name<user@example.com>", "angle-bracket"); // missing space before <
  expectFail("<<user@example.com>>", "angle-bracket");

  assert(isValidStatementRecipientEmail("ok@example.com"), "helper true");
  assert(!isValidStatementRecipientEmail("bad>@example.com"), "helper false");

  console.log("statementRecipientEmail.test.ts: OK");
}

main();
