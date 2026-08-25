/**
 * Invoice-run posting refs: Express names when no Kid-e-Sys official list,
 * Kid-e-Sys-only when snapshots exist. No Prisma / production writes.
 * Run: npx tsx src/services/officialBillingAccountRef.invoiceRun.test.ts
 */
import {
  normaliseInvoiceRunPostingAccountRef,
  normaliseOfficialBillingAccountRef,
} from "./officialBillingAccountRef";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runTests() {
  const empty = new Set<string>();
  const daSilvaOfficial = new Set(["ALI002", "DUP001"]);

  assert(normaliseOfficialBillingAccountRef("ALI002") === "ALI002", "Kid-e-Sys kept");
  assert(normaliseOfficialBillingAccountRef("ABAYE TUMO ASHANAFY") === "", "Express not Kid-e-Sys");
  assert(normaliseOfficialBillingAccountRef("26006") === "", "accession not Kid-e-Sys");

  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", empty) === "ABAYE TUMO ASHANAFY",
    "Express name allowed when no official Kid-e-Sys list"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ali002", empty) === "ALI002",
    "Kid-e-Sys still allowed with empty official list"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("26006", empty) === "",
    "unlinked accession / SA-SAMS numeric must not post"
  );
  assert(normaliseInvoiceRunPostingAccountRef("1234567", empty) === "", "numeric admission excluded");
  assert(normaliseInvoiceRunPostingAccountRef("-", empty) === "", "placeholder excluded");

  assert(
    normaliseInvoiceRunPostingAccountRef("ABAYE TUMO ASHANAFY", daSilvaOfficial) === "",
    "Da Silva official list must not accept Express names"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("ALI002", daSilvaOfficial) === "ALI002",
    "Da Silva Kid-e-Sys ref still posts"
  );
  assert(
    normaliseInvoiceRunPostingAccountRef("RAM021", daSilvaOfficial) === "RAM021",
    "normalise still returns Kid-e-Sys shape; membership is asserted separately"
  );

  console.log("officialBillingAccountRef.invoiceRun.test.ts — PASS");
}

runTests();
