/**
 * Source-agnostic Statements list/summary: Express Invoice names, Kid-e-Sys codes,
 * SA-SAMS numeric exclusion, school isolation.
 * Run: npx tsx src/billing/statementSourceAgnostic.test.ts
 */
import {
  filterKidESysBillingRows,
  getBillingRows,
  isKidESysAccountRef,
  isStatementBillingAccountRef,
  mapApiStatementRowToBillingAccountRow,
  normalizeKidESysAccountRef,
  normalizeStatementAccountRef,
} from "./billingLedger";
import { calculateBillingSummary } from "./billingCalculations";
import {
  clearSchoolBillingDisplayCache,
  writeStatementApiAccounts,
} from "./kidesysTransactionHistory";

const EXPRESS_SCHOOL = "school-express-migrated";
const DA_SILVA_SCHOOL = "cmpideqeq0000108xb6ouv9zi";
const MAGICAL_SCHOOL = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function expressApiRows() {
  return [
    {
      accountNo: "ABAYE TUMO ASHANAFY",
      familyAccountId: "fa-abay",
      accountHolder: "ABAYE TUMO ASHANAFY",
      name: "Ashanafy",
      surname: "Abaye",
      memberLearnerIds: ["learner-abay"],
      memberNames: ["Ashanafy Abaye"],
      balance: 1500,
      status: "Recently Owing",
      lastInvoice: 1500,
      lastInvoiceDate: "2026-01-15",
      lastInvoiceLabel: "Invoice · Express History · non-posting",
      lastPayment: 0,
      lastPaymentDate: "",
    },
    {
      accountNo: "CREDIT FAMILY",
      familyAccountId: "fa-credit",
      accountHolder: "CREDIT FAMILY",
      name: "Credit",
      surname: "Family",
      memberLearnerIds: ["learner-credit"],
      memberNames: ["Credit Family"],
      balance: -462.1,
      status: "Over Paid",
      lastInvoice: 0,
      lastInvoiceDate: "",
      lastPayment: 500,
      lastPaymentDate: "2026-02-01",
    },
    {
      accountNo: "PAID UP FAMILY",
      familyAccountId: "fa-paid",
      accountHolder: "PAID UP FAMILY",
      name: "Paid",
      surname: "Up",
      memberLearnerIds: [],
      memberNames: [],
      balance: 0,
      status: "Paid Up",
      lastInvoice: 0,
      lastPayment: 0,
    },
    {
      accountNo: "1234567",
      familyAccountId: "fa-sasams",
      balance: 9999,
      status: "Recently Owing",
    },
    {
      accountNo: "KID-MISSING-1",
      balance: 50,
      status: "Recently Owing",
    },
    {
      accountNo: "-",
      balance: 10,
      status: "Recently Owing",
    },
  ];
}

function daSilvaApiRows() {
  return [
    {
      accountNo: "ALI002",
      familyAccountId: "fa-ali",
      name: "Ali",
      surname: "Learner",
      balance: 4000,
      status: "Recently Owing",
      lastInvoice: 3000,
      lastInvoiceDate: "2026-07-01",
      lastPayment: 1000,
      lastPaymentDate: "2026-06-15",
    },
    {
      accountNo: "DUP001",
      familyAccountId: "fa-dup",
      name: "Dup",
      surname: "Learner",
      balance: -12200,
      status: "Over Paid",
      lastInvoice: 0,
      lastPayment: 12200,
      lastPaymentDate: "2026-05-01",
    },
  ];
}

function magicalApiRows() {
  return [
    {
      accountNo: "MBB001",
      familyAccountId: "fa-mbb",
      name: "Magical",
      surname: "Child",
      balance: 2100,
      status: "Recently Owing",
      lastInvoice: 2100,
      lastInvoiceDate: "2026-03-01",
      lastPayment: 0,
    },
    {
      accountNo: "MBB002",
      familyAccountId: "fa-mbb2",
      name: "Second",
      surname: "Child",
      balance: 0,
      status: "Paid Up",
    },
  ];
}

function testIdentityHelpers() {
  assert(isKidESysAccountRef("ALI002"), "Kid-e-Sys ALI002 still recognised");
  assert(!isKidESysAccountRef("ABAYE TUMO ASHANAFY"), "Express name is not Kid-e-Sys");
  assert(isStatementBillingAccountRef("ABAYE TUMO ASHANAFY"), "Express name is statement-eligible");
  assert(isStatementBillingAccountRef("ALI002"), "Kid-e-Sys remains statement-eligible");
  assert(isStatementBillingAccountRef("MBB001"), "Magical Kid-e-Sys remains statement-eligible");
  assert(!isStatementBillingAccountRef("1234567"), "SA-SAMS numeric is not statement-eligible");
  assert(!isStatementBillingAccountRef("-"), "placeholder dash excluded");
  assert(!isStatementBillingAccountRef("KID-MISSING-1"), "KID-MISSING excluded");
  assert(normalizeKidESysAccountRef("ABAYE TUMO ASHANAFY") === "", "Kid-e-Sys normalizer still blanks Express names");
  assert(
    normalizeStatementAccountRef("ABAYE TUMO ASHANAFY") === "ABAYE TUMO ASHANAFY",
    "statement normalizer preserves Express names"
  );
  assert(normalizeStatementAccountRef("ali002") === "ALI002", "statement normalizer still uppercases Kid-e-Sys");
  console.log("✓ identity helpers: source-agnostic vs Kid-e-Sys");
}

function testMapperPreservesExpressAndHistory() {
  const mapped = mapApiStatementRowToBillingAccountRow(expressApiRows()[0]);
  assert(mapped.accountNo === "ABAYE TUMO ASHANAFY", "mapper keeps Express accountNo");
  assert(mapped.balance === 1500, "mapper keeps Express balance");
  assert(mapped.lastInvoiceDate === "2026-01-15", "mapper keeps last invoice date");
  assert(String(mapped.lastInvoice).includes("1,500") || mapped.lastInvoice !== "No invoices", "mapper keeps invoice history");
  const credit = mapApiStatementRowToBillingAccountRow(expressApiRows()[1]);
  assert(credit.balance === -462.1, "negative credit balance preserved");
  const sasams = mapApiStatementRowToBillingAccountRow(expressApiRows()[3]);
  assert(sasams.accountNo === "-", "SA-SAMS numeric maps to placeholder");
  const kidesys = mapApiStatementRowToBillingAccountRow(daSilvaApiRows()[0]);
  assert(kidesys.accountNo === "ALI002", "Kid-e-Sys mapper unchanged");
  console.log("✓ mapper preserves Express refs, history, and negative balances");
}

function testStatementListAndTotals() {
  clearSchoolBillingDisplayCache(EXPRESS_SCHOOL);
  writeStatementApiAccounts(EXPRESS_SCHOOL, expressApiRows());
  const rows = getBillingRows([], EXPRESS_SCHOOL);
  const refs = rows.map((r) => r.accountNo).sort();
  assert(refs.length === 3, `Express list should be 3 eligible accounts, got ${refs.length}`);
  assert(refs.includes("ABAYE TUMO ASHANAFY"), "Express owing account in list");
  assert(refs.includes("CREDIT FAMILY"), "Express credit account in list");
  assert(refs.includes("PAID UP FAMILY"), "Express zero-balance account in list");
  assert(!refs.includes("1234567"), "SA-SAMS numeric excluded from list");
  assert(!refs.includes("-"), "placeholders excluded from list");

  const summary = calculateBillingSummary(rows);
  assert(summary.accountsCount === 3, "summary accounts = 3");
  assert(round2(summary.totalOutstanding) === 1037.9, `net ${summary.totalOutstanding} !== 1037.90`);
  assert(round2(summary.recentlyOwing) === 1500, "owing section R1,500");
  assert(round2(summary.overPaid) === -462.1, "credits remain negative");
  assert(round2(summary.badDebt) === 0, "no bad debt in fixture");
  const owing = rows.filter((r) => r.balance > 0);
  const credits = rows.filter((r) => r.balance < 0);
  assert(owing.length === 1 && owing[0].balance === 1500, "owing count/amount");
  assert(credits.length === 1 && credits[0].balance === -462.1, "credit count/amount stays negative");

  const kidesysOnly = filterKidESysBillingRows(rows);
  assert(kidesysOnly.length === 0, "invoice-run Kid-e-Sys filter still excludes Express names");
  console.log("✓ Express statement list, totals, owing, credits, history");
}

function testDaSilvaAndMagicalUnchanged() {
  clearSchoolBillingDisplayCache(DA_SILVA_SCHOOL);
  clearSchoolBillingDisplayCache(MAGICAL_SCHOOL);
  writeStatementApiAccounts(DA_SILVA_SCHOOL, daSilvaApiRows());
  writeStatementApiAccounts(MAGICAL_SCHOOL, magicalApiRows());

  const daSilva = getBillingRows([], DA_SILVA_SCHOOL);
  const magical = getBillingRows([], MAGICAL_SCHOOL);
  assert(daSilva.map((r) => r.accountNo).sort().join(",") === "ALI002,DUP001", "Da Silva Kid-e-Sys list unchanged");
  assert(magical.map((r) => r.accountNo).sort().join(",") === "MBB001,MBB002", "Magical Kid-e-Sys list unchanged");
  const daSummary = calculateBillingSummary(daSilva);
  assert(daSummary.accountsCount === 2, "Da Silva summary still counts Kid-e-Sys");
  assert(round2(daSummary.totalOutstanding) === -8200, "Da Silva net includes negative DUP001");
  assert(round2(daSummary.overPaid) === -12200, "Da Silva credit remains negative");
  const magSummary = calculateBillingSummary(magical);
  assert(magSummary.accountsCount === 2, "Magical summary still counts Kid-e-Sys");
  assert(round2(magSummary.recentlyOwing) === 2100, "Magical owing unchanged");
  console.log("✓ Da Silva and Magical Kid-e-Sys statement regression");
}

function testSchoolIsolation() {
  clearSchoolBillingDisplayCache(EXPRESS_SCHOOL);
  clearSchoolBillingDisplayCache(DA_SILVA_SCHOOL);
  writeStatementApiAccounts(EXPRESS_SCHOOL, expressApiRows());
  writeStatementApiAccounts(DA_SILVA_SCHOOL, daSilvaApiRows());

  const express = getBillingRows([], EXPRESS_SCHOOL);
  const daSilva = getBillingRows([], DA_SILVA_SCHOOL);
  assert(express.every((r) => !isKidESysAccountRef(r.accountNo)), "Express school has no Kid-e-Sys refs leaked in");
  assert(daSilva.every((r) => isKidESysAccountRef(r.accountNo)), "Da Silva school stays Kid-e-Sys only");
  assert(!express.some((r) => r.accountNo === "ALI002"), "Da Silva accounts do not appear on Express school");
  assert(!daSilva.some((r) => r.accountNo === "ABAYE TUMO ASHANAFY"), "Express accounts do not appear on Da Silva");
  console.log("✓ school isolation");
}

function run() {
  testIdentityHelpers();
  testMapperPreservesExpressAndHistory();
  testStatementListAndTotals();
  testDaSilvaAndMagicalUnchanged();
  testSchoolIsolation();
  console.log("\nAll statementSourceAgnostic tests passed.");
}

run();
