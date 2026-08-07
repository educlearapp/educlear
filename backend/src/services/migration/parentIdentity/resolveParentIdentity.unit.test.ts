/**
 * Migration parent identity resolver — regression fixtures from LIVE audit patterns.
 * Run: npx ts-node --transpile-only src/services/migration/parentIdentity/resolveParentIdentity.unit.test.ts
 */
import assert from "assert";
import {
  MigrationParentIdentitySession,
  firstNamesCompatible,
  normalizeParentCellphone,
  normalizeParentEmail,
  resolveParentIdentity,
  type ExistingParentCandidate,
  type IncomingParentIdentity,
} from "./index";

function incoming(
  partial: Partial<IncomingParentIdentity> & Pick<IncomingParentIdentity, "firstName" | "surname">
): IncomingParentIdentity {
  return {
    sourceSystem: "SA-SAMS",
    ...partial,
  };
}

function candidate(partial: ExistingParentCandidate): ExistingParentCandidate {
  return partial;
}

function test1SurnameVariantStrongCorroboration() {
  const existing = candidate({
    id: "p-katudi-1",
    firstName: "Katudi",
    surname: "MANKGANE",
    cellNo: "0823301241",
    email: "katudigodfrey.kg@gmail.com",
    idNumber: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Katudi",
      surname: "MANKUANE",
      cellNo: "0823301241",
      email: "KATUDIGODFREY.KG@GMAIL.COM",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.strictEqual(decision.parentId, "p-katudi-1");
  assert.ok(decision.reasons.includes("SURNAME_DIFFERENCE_IGNORED"));
  assert.ok(decision.reasons.includes("NORMALIZED_EMAIL_MATCH"));
  console.log("✓ TEST 1 surname variant + cell + email → REUSE (no duplicate)");
}

function test2EmailCase() {
  const existing = candidate({
    id: "p-email",
    firstName: "Melita",
    surname: "DIKGALE",
    email: "parent@example.com",
    cellNo: "0821111111",
    idNumber: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Melita",
      surname: "Dikgale",
      email: "PARENT@EXAMPLE.COM",
      cellNo: "0821111111",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.ok(decision.reasons.includes("EMAIL_CASE_NORMALIZED") || decision.reasons.includes("NORMALIZED_EMAIL_MATCH"));
  console.log("✓ TEST 2 email case normalization → REUSE");
}

function test3CellphoneFormatting() {
  assert.strictEqual(normalizeParentCellphone("082 123 4567"), "0821234567");
  assert.strictEqual(normalizeParentCellphone("+27 82 123 4567"), "0821234567");
  const existing = candidate({
    id: "p-cell",
    firstName: "Vincent",
    surname: "BUYS",
    cellNo: "0821234567",
    email: "v@example.com",
    idNumber: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Vincent",
      surname: "Buys",
      cellNo: "+27 82 123 4567",
      email: "v@example.com",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.ok(decision.reasons.includes("NORMALIZED_CELLPHONE_MATCH"));
  console.log("✓ TEST 3 cellphone formatting → REUSE");
}

function test4ExactSaIdDifferentSurnameNoOverwriteSignal() {
  const existing = candidate({
    id: "p-id",
    firstName: "Moshiane",
    surname: "MANKGANE",
    idNumber: "8806130531082",
    cellNo: "0662206541",
    email: "reakgopela@gmail.com",
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Moshiane",
      surname: "MANKUANE",
      idNumber: "8806130531082",
      cellNo: "0662206541",
      email: "REAKGOPELA@GMAIL.COM",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.strictEqual(decision.parentId, "p-id");
  assert.ok(decision.reasons.includes("EXACT_IDENTITY_NUMBER"));
  assert.ok(decision.reasons.includes("SURNAME_DIFFERENCE_IGNORED"));
  // Caller must not overwrite surname — resolver only returns reuse id.
  console.log("✓ TEST 4 exact SA ID + different surname → REUSE (surname not required)");
}

function test5SharedCellDifferentIds() {
  const existing = candidate({
    id: "p-a",
    firstName: "Amal",
    surname: "SERGE",
    cellNo: "0710000001",
    idNumber: "8001015009087",
    email: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Amal",
      surname: "SERGE",
      cellNo: "0710000001",
      idNumber: "9001015009087",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "CONFLICT");
  assert.ok(decision.conflictReasons.includes("CONFLICTING_IDENTITY_NUMBERS"));
  console.log("✓ TEST 5 shared cell + different SA IDs → CONFLICT");
}

function test6SharedEmailAloneNotEnough() {
  const existing = candidate({
    id: "p-email-only",
    firstName: "ParentA",
    surname: "One",
    email: "family@example.com",
    cellNo: "0821111111",
    idNumber: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "ParentB",
      surname: "Two",
      email: "family@example.com",
      cellNo: "0832222222",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REVIEW_REQUIRED");
  assert.ok(decision.reasons.includes("SINGLE_CONTACT_ONLY") || decision.reasons.includes("NORMALIZED_EMAIL_MATCH"));
  console.log("✓ TEST 6 shared email alone → REVIEW_REQUIRED (no auto-merge)");
}

function test7MultipleSiblingsSameParent() {
  const session = new MigrationParentIdentitySession();
  const candidates: ExistingParentCandidate[] = [];
  const base = {
    firstName: "Edwin",
    surname: "Kgasoane",
    cellNo: "0830000005",
    email: "e@example.com",
    idNumber: "7903015009083",
    sourceSystem: "KID-E-SYS" as const,
  };

  // First learner creates
  const d1 = session.resolve(
    incoming({ ...base, sourceParentId: "1848", learnerLabel: "Child1" }),
    candidates
  );
  assert.strictEqual(d1.decision, "CREATE_NEW");
  candidates.push({
    id: "p-edwin",
    firstName: base.firstName,
    surname: base.surname,
    cellNo: base.cellNo,
    email: base.email,
    idNumber: base.idNumber,
  });
  session.rememberSourceMapping(
    incoming({ ...base, sourceParentId: "1848" }),
    "p-edwin"
  );

  // Second + third learners reuse via source id and/or exact ID
  const d2 = session.resolve(
    incoming({ ...base, sourceParentId: "1848", learnerLabel: "Child2", surname: "KGASOANE" }),
    candidates
  );
  assert.strictEqual(d2.decision, "REUSE_EXISTING");
  assert.strictEqual(d2.parentId, "p-edwin");

  const d3 = session.resolve(
    incoming({
      ...base,
      sourceParentId: "9999", // different source id but same SA ID
      learnerLabel: "Child3",
      surname: "KGASOANE",
    }),
    candidates
  );
  assert.strictEqual(d3.decision, "REUSE_EXISTING");
  assert.strictEqual(d3.parentId, "p-edwin");
  console.log("✓ TEST 7 multiple siblings → one Parent reused (not 3 rows)");
}

function test8KidEsysDifferentParentIdStrongEvidence() {
  const existing = candidate({
    id: "p-moshiane",
    firstName: "MOSHIANE MAKGETHWA",
    surname: "MANKGANE",
    cellNo: "0662206541",
    email: "REAKGOPELA@GMAIL.COM",
    idNumber: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "MOSHIANE",
      surname: "MANKGANE",
      cellNo: "0662206541",
      email: "reakgopela@gmail.com",
      sourceSystem: "KID-E-SYS",
      sourceParentId: "2916", // different from whatever created existing
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.ok(firstNamesCompatible("MOSHIANE MAKGETHWA", "MOSHIANE"));
  console.log("✓ TEST 8 different Kid-e-Sys parent_id + strong contact → REUSE");
}

function test9AmbiguousCellOnly() {
  const existing = candidate({
    id: "p-amb",
    firstName: "Puseletso",
    surname: "Kgasoane",
    cellNo: "0780000051",
    email: null,
    idNumber: null,
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Puseletso",
      surname: "KGSOANE",
      cellNo: "0780000051",
      email: null,
      idNumber: null,
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REVIEW_REQUIRED");
  console.log("✓ TEST 9 same first+cell, surname differs, no ID/email → REVIEW_REQUIRED");
}

function test10StrongConflictTwoIds() {
  const existing = candidate({
    id: "p-c1",
    firstName: "Mihloti",
    surname: "MDUMELA",
    cellNo: "0829999999",
    email: "x@example.com",
    idNumber: "8501015009087",
  });
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Mihbo",
      surname: "MDUMELA",
      cellNo: "0829999999",
      email: "x@example.com",
      idNumber: "8601015009087",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "CONFLICT");
  console.log("✓ TEST 10 contact overlap + different SA IDs → CONFLICT");
}

function test11SourcePreservationContract() {
  // Resolver reuses but does not mutate candidate surname — preservation is caller's duty.
  const existing = candidate({
    id: "p-preserve",
    firstName: "Katudi",
    surname: "MANKUANE",
    cellNo: "0823301241",
    email: "k@example.com",
    idNumber: "8309015009083",
  });
  const before = { ...existing };
  const decision = resolveParentIdentity({
    incoming: incoming({
      firstName: "Katudi",
      surname: "MANKGANE",
      cellNo: "0823301241",
      email: "k@example.com",
      idNumber: "8309015009083",
    }),
    candidates: [existing],
  });
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.strictEqual(existing.surname, before.surname);
  assert.strictEqual(existing.surname, "MANKUANE");
  console.log("✓ TEST 11 reuse does not mutate candidate surname (source preservation)");
}

function test12CrossSourceIdWins() {
  const session = new MigrationParentIdentitySession();
  const candidates: ExistingParentCandidate[] = [
    {
      id: "p-from-kid",
      firstName: "Moshiane",
      surname: "MANKGANE",
      cellNo: "0662206541",
      email: "reakgopela@gmail.com",
      idNumber: null,
      familyAccountId: "fa-1",
    },
  ];
  // SA-SAMS later with same ID + different surname — must reuse despite familyAccountId set
  const decision = session.resolve(
    incoming({
      firstName: "Moshiane",
      surname: "MANKUANE",
      idNumber: "8806130531082",
      cellNo: "0662206541",
      email: "REAKGOPELA@GMAIL.COM",
      sourceSystem: "SA-SAMS",
    }),
    candidates
  );
  // No ID on existing yet — strong corroboration should still reuse
  assert.strictEqual(decision.decision, "REUSE_EXISTING");
  assert.strictEqual(decision.parentId, "p-from-kid");

  // After ID filled on existing, exact ID path
  candidates[0]!.idNumber = "8806130531082";
  const d2 = resolveParentIdentity({
    incoming: incoming({
      firstName: "Moshiane",
      surname: "OTHERSPELLING",
      idNumber: "8806130531082",
      sourceSystem: "SA-SAMS",
    }),
    candidates,
  });
  assert.strictEqual(d2.decision, "REUSE_EXISTING");
  assert.ok(d2.reasons.includes("EXACT_IDENTITY_NUMBER"));
  console.log("✓ TEST 12 cross-source: Kid-e-Sys then SA-SAMS ID/spelling → REUSE, no surname overwrite");
}

function testNormalizeEmail() {
  assert.strictEqual(normalizeParentEmail("  A@B.COM "), "a@b.com");
  assert.strictEqual(normalizeParentEmail(""), null);
}

function main() {
  testNormalizeEmail();
  test1SurnameVariantStrongCorroboration();
  test2EmailCase();
  test3CellphoneFormatting();
  test4ExactSaIdDifferentSurnameNoOverwriteSignal();
  test5SharedCellDifferentIds();
  test6SharedEmailAloneNotEnough();
  test7MultipleSiblingsSameParent();
  test8KidEsysDifferentParentIdStrongEvidence();
  test9AmbiguousCellOnly();
  test10StrongConflictTwoIds();
  test11SourcePreservationContract();
  test12CrossSourceIdWins();
  console.log("\nALL resolveParentIdentity unit tests passed");
}

main();
