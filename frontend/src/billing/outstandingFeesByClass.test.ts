/**
 * Outstanding Fees by class — grouping, reconciliation, Excel and PDF exports.
 * Run: npx tsx --tsconfig tsconfig.json src/billing/outstandingFeesByClass.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { formatMoney } from "./billingLedger";
import { filterOutstandingAccounts, summarizeFilteredOutstanding } from "./outstandingAccountsFilters";
import {
  ALL_CLASSES_VALUE,
  MULTIPLE_CLASSES_LABEL,
  MULTIPLE_CLASSES_VALUE,
  UNASSIGNED_LABEL,
  UNASSIGNED_VALUE,
  accountClassGroupValue,
  buildClassSelectOptions,
  buildOutstandingClassView,
  buildOutstandingFeesFileName,
  groupOutstandingByClass,
  reconcileClassView,
} from "./outstandingFeesByClass";
import {
  buildOutstandingFeesWorkbook,
  safeSheetName,
  type OutstandingFeesExportRow,
} from "./buildOutstandingFeesExcel";
import { buildOutstandingFeesPdf } from "./buildOutstandingFeesPdf";

const here = dirname(fileURLToPath(import.meta.url));

type Row = OutstandingFeesExportRow & {
  accountRef: string;
  familyAccountId: string | null;
  grades: string[];
  classes: string[];
  primaryCellphone: string | null;
  alternateContact: string | null;
  email: string | null;
};

function row(partial: Partial<Row>): Row {
  return {
    familyAccountId: partial.accountRef || "FA",
    accountRef: "ACC",
    accountNumber: partial.accountRef || "ACC",
    learnerNames: ["Learner"],
    memberLearnerIds: ["L"],
    grades: [],
    classes: [],
    classLabels: [],
    outstandingBalance: 100,
    parentGuardianName: "Parent",
    primaryCellphone: "0820000000",
    alternateContact: null,
    email: "parent@example.com",
    daysOverdue: 30,
    ...partial,
  };
}

/** Server order (highest balance first) — grouping must preserve it inside each class. */
const ROWS: Row[] = [
  // Two learners from one family, same class → one account, counted once.
  row({ accountRef: "SAME", learnerNames: ["Ann Smith", "Ben Smith"], memberLearnerIds: ["L1", "L2"], classLabels: ["Grade 1A"], outstandingBalance: 5000.5 }),
  // Two learners from one family, different classes → Multiple classes, counted once.
  row({ accountRef: "SPLIT", learnerNames: ["Cat Jones", "Dan Jones"], memberLearnerIds: ["L3", "L4"], classLabels: ["Grade 1A", "Grade 10B"], outstandingBalance: 4200.25 }),
  row({ accountRef: "TENB", learnerNames: ["Eve Ten"], memberLearnerIds: ["L5"], classLabels: ["Grade 10B"], outstandingBalance: 3000 }),
  row({ accountRef: "TWOA", learnerNames: ["Fay Two"], memberLearnerIds: ["L6"], classLabels: ["Grade 2A"], outstandingBalance: 1999.99, daysOverdue: null }),
  // No current class.
  row({ accountRef: "NOCLS", learnerNames: ["Gus None"], memberLearnerIds: ["L7"], classLabels: [], outstandingBalance: 750.01 }),
  row({ accountRef: "ONEA2", learnerNames: ["Hal Smith"], memberLearnerIds: ["L8"], classLabels: ["Grade 1A"], outstandingBalance: 0.01 }),
];

const META = { schoolName: "EduClear Test School", generatedAt: new Date(2026, 9, 11, 9, 30) };

const cents = (n: number) => Math.round(n * 100);

function testAllClassesGrouping() {
  const groups = groupOutstandingByClass(ROWS);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Grade 1A", "Grade 2A", "Grade 10B", MULTIPLE_CLASSES_LABEL, UNASSIGNED_LABEL],
    "natural class order, then Multiple classes, then Unassigned"
  );
  const g1a = groups[0];
  assert.deepEqual(g1a.rows.map((r) => r.accountRef), ["SAME", "ONEA2"], "existing row order preserved");
  assert.equal(g1a.outstandingAccountCount, 2);
  assert.equal(g1a.learnersAffected, 3);
  assert.equal(cents(g1a.totalOutstanding), cents(5000.51));
  assert.equal(accountClassGroupValue(ROWS[1]), MULTIPLE_CLASSES_VALUE);
  assert.equal(accountClassGroupValue(ROWS[4]), UNASSIGNED_VALUE);
  console.log("✓ 1/3/6/7/8 All Classes groups correctly; class totals; family same/different class; no class");
}

function testNoDoubleCountingAndReconciliation() {
  const before = summarizeFilteredOutstanding(ROWS);
  const view = buildOutstandingClassView(ROWS, ALL_CLASSES_VALUE);
  const seen = new Map<string, number>();
  for (const g of view.groups) for (const r of g.rows) seen.set(r.accountRef, (seen.get(r.accountRef) || 0) + 1);
  assert.equal(seen.size, ROWS.length);
  assert.ok([...seen.values()].every((n) => n === 1), "every FamilyAccount appears in exactly one group");
  const sumOfClassTotals = view.groups.reduce((s, g) => s + cents(g.totalOutstanding), 0);
  assert.equal(sumOfClassTotals, cents(before.totalOutstanding), "Σ class totals == pre-existing total");
  assert.equal(cents(view.totals.totalOutstanding), cents(before.totalOutstanding), "grand total == pre-existing total");
  assert.equal(view.totals.outstandingAccountCount, before.outstandingAccountCount);
  assert.equal(view.totals.learnersAffected, before.learnersAffected);
  assert.equal(reconcileClassView(view, before).ok, true);
  const broken = { ...view, groups: view.groups.slice(1) };
  assert.equal(reconcileClassView(broken, before).ok, false, "reconciliation detects a missing class");
  console.log("✓ 4/5/19 grand total reconciles to pre-existing total; no FamilyAccount double-counted");
}

function testSpecificClassAndShared() {
  const view = buildOutstandingClassView(ROWS, "Grade 1A");
  assert.equal(view.isAllClasses, false);
  assert.equal(view.groups.length, 1);
  assert.deepEqual(view.groups[0].rows.map((r) => r.accountRef), ["SAME", "ONEA2"]);
  assert.deepEqual(view.sharedRows.map((r) => r.accountRef), ["SPLIT"], "multi-class family listed as shared");
  assert.equal(cents(view.totals.totalOutstanding), cents(5000.51), "shared balance excluded from class total");
  const tenB = buildOutstandingClassView(ROWS, "Grade 10B");
  assert.deepEqual(tenB.groups[0].rows.map((r) => r.accountRef), ["TENB"]);
  assert.deepEqual(tenB.sharedRows.map((r) => r.accountRef), ["SPLIT"]);
  const multi = buildOutstandingClassView(ROWS, MULTIPLE_CLASSES_VALUE);
  assert.deepEqual(multi.groups[0].rows.map((r) => r.accountRef), ["SPLIT"]);
  assert.equal(multi.sharedRows.length, 0);
  console.log("✓ 2 specific class filter shows only that class; shared accounts excluded from its total");
}

function testEmptyClassAndOptions() {
  const view = buildOutstandingClassView(ROWS, "Grade 3C");
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].rows.length, 0);
  assert.equal(view.totals.totalOutstanding, 0);
  assert.equal(view.totals.outstandingAccountCount, 0);
  const options = buildClassSelectOptions(["Grade 3C", "Grade 2A"], ROWS);
  assert.deepEqual(
    options.map((o) => o.label),
    ["All Classes", "Grade 1A", "Grade 2A", "Grade 3C", "Grade 10B", MULTIPLE_CLASSES_LABEL, UNASSIGNED_LABEL]
  );
  assert.equal(groupOutstandingByClass(ROWS).some((g) => g.label === "Grade 3C"), false, "empty class not a section in All Classes");
  console.log("✓ 9 empty class selectable with R0.00 total; options include empty classes");
}

function testRenameUsesCurrentLabels() {
  // API supplies canonical current classroom names; a rename changes the label, not the money.
  const renamed = ROWS.map((r) =>
    r.accountRef === "TWOA" ? { ...r, classLabels: ["Grade 2 Alpha"], classes: ["Grade 2A"] } : r
  );
  const groups = groupOutstandingByClass(renamed);
  assert.ok(groups.some((g) => g.label === "Grade 2 Alpha"));
  assert.ok(!groups.some((g) => g.label === "Grade 2A"), "raw stored label ignored when canonical label present");
  assert.equal(cents(summarizeFilteredOutstanding(renamed).totalOutstanding), cents(summarizeFilteredOutstanding(ROWS).totalOutstanding));
  // Older backend without classLabels falls back to raw class labels.
  const legacy = { ...ROWS[0], classLabels: undefined, classes: ["Grade 1A"] };
  assert.equal(accountClassGroupValue(legacy), "Grade 1A");
  console.log("✓ 10 classroom rename/current membership via canonical labels");
}

function testFiltersComposeWithClass() {
  const filtered = filterOutstandingAccounts(ROWS, {
    search: "smith",
    grade: "all",
    className: "all",
    balanceRange: "all",
    daysOverdue: "all",
  });
  const view = buildOutstandingClassView(filtered, ALL_CLASSES_VALUE);
  assert.deepEqual(view.groups.map((g) => g.label), ["Grade 1A"]);
  assert.equal(reconcileClassView(view, summarizeFilteredOutstanding(filtered)).ok, true);
  console.log("✓ search filter + class grouping compose (what you see = what is exported)");
}

function readSheet(wb: XLSX.WorkBook, name: string): (string | number)[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true, defval: "" }) as (string | number)[][];
}

function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return XLSX.read(buf, { type: "buffer" });
}

function testExcelSelectedClass() {
  const view = buildOutstandingClassView(ROWS, "Grade 1A");
  const wb = roundTrip(buildOutstandingFeesWorkbook(view, META));
  assert.deepEqual(wb.SheetNames, ["Grade 1A"]);
  const rows = readSheet(wb, "Grade 1A");
  const flat = rows.map((r) => r.join("|"));
  assert.ok(flat.some((l) => l.startsWith("Class|Grade 1A")));
  const header = rows.findIndex((r) => r[0] === "Class" && r[1] === "Learner(s)");
  const total = rows.find((r) => r[0] === "Class Total")!;
  assert.equal(cents(Number(total[5])), cents(view.groups[0].totalOutstanding), "Excel Class Total == screen");
  const detail = rows.slice(header + 1, rows.indexOf(total));
  assert.deepEqual(detail.map((r) => r[2]), ["SAME", "ONEA2"], "only the selected class in the class table");
  assert.ok(!flat.some((l) => l.includes("0820000000") || l.includes("parent@example.com")), "no phone/email exported");
  assert.ok(flat.some((l) => l.includes("Also linked to this class")), "shared block present");
  const sharedTotal = rows.find((r) => r[0] === "Shared (not in Class Total)")!;
  assert.equal(cents(Number(sharedTotal[5])), cents(4200.25));
  const moneyCell = wb.Sheets["Grade 1A"][XLSX.utils.encode_cell({ r: rows.indexOf(total), c: 5 })];
  assert.equal(moneyCell.t, "n", "money stored as number");
  console.log("✓ 11 Excel export matches displayed class (no contact PII)");
}

function testExcelAllClassesWorkbook() {
  const view = buildOutstandingClassView(ROWS, ALL_CLASSES_VALUE);
  const wb = roundTrip(buildOutstandingFeesWorkbook(view, META));
  assert.deepEqual(wb.SheetNames, ["Summary", "Grade 1A", "Grade 2A", "Grade 10B", "Multiple classes", "Unassigned"]);
  const summary = readSheet(wb, "Summary");
  const head = summary.findIndex((r) => r[0] === "Class" && r[3] === "Outstanding Total");
  const classRows = summary.slice(head + 1).filter((r) => r[0] && r[0] !== "Grand Total");
  assert.deepEqual(
    classRows.map((r) => [r[0], cents(Number(r[3]))]),
    view.groups.map((g) => [g.label, cents(g.totalOutstanding)])
  );
  const grand = summary.find((r) => r[0] === "Grand Total")!;
  assert.equal(cents(Number(grand[3])), cents(summarizeFilteredOutstanding(ROWS).totalOutstanding));
  assert.equal(Number(grand[1]), ROWS.length);
  for (const g of view.groups) {
    const sheetName = wb.SheetNames[view.groups.indexOf(g) + 1];
    const total = readSheet(wb, sheetName).find((r) => r[0] === "Class Total")!;
    assert.equal(cents(Number(total[5])), cents(g.totalOutstanding));
  }
  console.log("✓ 12 All Classes workbook: Summary + one sheet per class, Grand Total reconciles");
}

function testSafeSheetNames() {
  const used = new Set<string>(["summary"]);
  assert.equal(safeSheetName("Summary", used), "Summary (2)");
  assert.equal(safeSheetName("Grade 1/A: [Morning]*?", used), "Grade 1 A Morning");
  const long = safeSheetName("A very long classroom name that exceeds the limit", used);
  assert.ok(long.length <= 31);
  const long2 = safeSheetName("A very long classroom name that exceeds the limit", used);
  assert.ok(long2.length <= 31 && long2 !== long && long2.endsWith("(2)"));
  assert.equal(safeSheetName("'quoted'", used), "quoted");
  assert.equal(safeSheetName("   ", used), "Sheet");
  assert.equal(safeSheetName("History", used), "History (class)");
  assert.equal(safeSheetName("grade 1 a morning", used), "grade 1 a morning (2)", "case-insensitive uniqueness");
  console.log("✓ 13 Excel sheet names safe (length, chars, duplicates, reserved)");
}

function testPdfSelectedClass() {
  const view = buildOutstandingClassView(ROWS, "Grade 1A");
  const { doc, lines } = buildOutstandingFeesPdf(view, META);
  assert.ok(lines.includes("EduClear"));
  assert.ok(lines.includes("EduClear Test School"));
  assert.ok(lines.includes("Outstanding Fees Report"));
  assert.ok(lines.includes("Class: Grade 1A"));
  assert.ok(lines.includes("Class Total: Grade 1A"));
  assert.ok(lines.includes(formatMoney(view.groups[0].totalOutstanding)), "PDF class total == screen");
  assert.ok(!lines.includes("Grade 10B") && !lines.includes("Class Total: Grade 10B"), "other classes not exported");
  assert.ok(!lines.some((l) => l.includes("Eve Ten")), "learners from other classes not exported");
  assert.ok(lines.some((l) => l.includes("Also linked to this class")));
  assert.ok(!lines.includes("GRAND TOTAL"));
  assert.ok(!lines.some((l) => l.includes("0820000000") || l.includes("parent@example.com")));
  assert.ok(lines.includes(`Page 1 of ${doc.getNumberOfPages()}`));
  assert.ok(String(doc.output()).startsWith("%PDF-"));
  console.log("✓ 14 PDF selected-class export");
}

function testPdfAllClassesAndTotals() {
  const many: Row[] = [];
  for (let i = 0; i < 140; i++) {
    many.push(row({
      accountRef: `ACC${i}`,
      learnerNames: [`Learner Number ${i}`],
      memberLearnerIds: [`M${i}`],
      classLabels: [`Grade ${(i % 4) + 1}A`],
      outstandingBalance: 100 + i * 1.11,
    }));
  }
  const rows = [...ROWS, ...many];
  const view = buildOutstandingClassView(rows, ALL_CLASSES_VALUE);
  const { doc, lines } = buildOutstandingFeesPdf(view, META);
  const pages = doc.getNumberOfPages();
  assert.ok(pages > 1, "multi-page report");
  for (let p = 1; p <= pages; p++) assert.ok(lines.includes(`Page ${p} of ${pages}`), `page number ${p}`);
  for (const g of view.groups) {
    const idx = lines.indexOf(`Class Total: ${g.label}`);
    assert.ok(idx >= 0, `section total for ${g.label}`);
    assert.equal(lines[idx + 1], formatMoney(g.totalOutstanding), `PDF total for ${g.label} == screen`);
  }
  const summaryIdx = lines.indexOf("Summary by class");
  assert.ok(summaryIdx >= 0, "PDF summary by class present");
  for (const g of view.groups) {
    const i = lines.indexOf(g.label, summaryIdx);
    assert.equal(lines[i + 3], formatMoney(g.totalOutstanding), `PDF summary row for ${g.label}`);
  }
  const gIdx = lines.indexOf("GRAND TOTAL");
  assert.ok(gIdx > summaryIdx);
  assert.equal(lines[gIdx + 1], formatMoney(summarizeFilteredOutstanding(rows).totalOutstanding));
  assert.ok(lines.filter((l) => l === "Learner(s)").length > view.groups.length, "table header repeated on page breaks");
  assert.ok(lines.some((l) => l.endsWith("(continued)")));
  console.log("✓ 15/16 PDF All Classes export; class + grand totals equal screen totals; headers repeat");
}

function testMultiClassFamilyOwnerExample() {
  const family = row({ accountRef: "FAM35", learnerNames: ["Kid 3A", "Kid 5B"], memberLearnerIds: ["K1", "K2"], classLabels: ["Grade 3A", "Grade 5B"], outstandingBalance: 5000 });
  const a3 = row({ accountRef: "A3", memberLearnerIds: ["X1"], classLabels: ["Grade 3A"], outstandingBalance: 1000 });
  const b5 = row({ accountRef: "B5", memberLearnerIds: ["X2"], classLabels: ["Grade 5B"], outstandingBalance: 200 });
  const rows = [family, a3, b5];

  const all = buildOutstandingClassView(rows, ALL_CLASSES_VALUE);
  const where = all.groups.filter((g) => g.rows.includes(family)).map((g) => g.label);
  assert.deepEqual(where, [MULTIPLE_CLASSES_LABEL], "family appears once, under Multiple classes");
  assert.equal(all.groups.find((g) => g.label === "Grade 3A")!.totalOutstanding, 1000, "not counted in Grade 3A");
  assert.equal(all.groups.find((g) => g.label === "Grade 5B")!.totalOutstanding, 200, "not counted in Grade 5B");
  assert.equal(all.groups.find((g) => g.label === MULTIPLE_CLASSES_LABEL)!.totalOutstanding, 5000);
  assert.equal(all.totals.totalOutstanding, 6200, "R5,000 counted exactly once in grand total");

  for (const [cls, own] of [["Grade 3A", 1000], ["Grade 5B", 200]] as const) {
    const v = buildOutstandingClassView(rows, cls);
    assert.deepEqual(v.sharedRows, [family], `${cls}: family under "Also linked to this class"`);
    assert.equal(v.totals.totalOutstanding, own, `${cls}: R5,000 excluded from Class Total`);
    assert.equal(v.groups[0].totalOutstanding, own);
    const { lines } = buildOutstandingFeesPdf(v, META);
    assert.equal(lines[lines.indexOf(`Class Total: ${cls}`) + 1], formatMoney(own), `${cls}: PDF class total`);
    const wb = roundTrip(buildOutstandingFeesWorkbook(v, META));
    const sheet = readSheet(wb, wb.SheetNames[0]);
    assert.equal(Number(sheet.find((r) => r[0] === "Class Total")![5]), own, `${cls}: Excel class total`);
  }
  console.log("✓ owner example: R5,000 family (3A + 5B) counted once; excluded from 3A and 5B Class Totals");
}

function testFilenames() {
  const date = new Date(2026, 9, 11);
  assert.equal(
    buildOutstandingFeesFileName({ schoolName: "Da Silva Academy", selectionLabel: "All Classes", date, extension: "xlsx" }),
    "Outstanding-Fees-Da-Silva-Academy-All-Classes-2026-10-11.xlsx"
  );
  assert.equal(
    buildOutstandingFeesFileName({ schoolName: "École / St. Mary's <x>", selectionLabel: "Grade 1/A: *Morning*", date, extension: "pdf" }),
    "Outstanding-Fees-Ecole-St-Mary-s-x-Grade-1-A-Morning-2026-10-11.pdf"
  );
  const weird = buildOutstandingFeesFileName({ schoolName: "../..", selectionLabel: "", date, extension: "pdf" });
  assert.equal(weird, "Outstanding-Fees-School-All-Classes-2026-10-11.pdf");
  assert.ok(!/[\\/:*?"<>|]/.test(weird));
  console.log("✓ 17 export filenames sanitised");
}

function testExportsReuseAuthorisedDataOnly() {
  for (const file of ["buildOutstandingFeesExcel.ts", "buildOutstandingFeesPdf.ts", "outstandingFeesByClass.ts"]) {
    const src = readFileSync(join(here, file), "utf8");
    assert.ok(!/\bfetch\(|API_URL|schoolId/.test(src), `${file} must not fetch or take a schoolId`);
  }
  const page = readFileSync(join(here, "OutstandingAccountsReport.tsx"), "utf8");
  assert.equal((page.match(/\/api\/outstanding-accounts/g) || []).length, 1, "single authorised API request");
  assert.ok(page.includes("downloadOutstandingFeesExcel(classView"));
  assert.ok(page.includes("downloadOutstandingFeesPdf(classView"));
  console.log("✓ 18 exports built only from the one authorised, school-scoped API response");
}

testAllClassesGrouping();
testNoDoubleCountingAndReconciliation();
testSpecificClassAndShared();
testEmptyClassAndOptions();
testRenameUsesCurrentLabels();
testFiltersComposeWithClass();
testExcelSelectedClass();
testExcelAllClassesWorkbook();
testSafeSheetNames();
testPdfSelectedClass();
testPdfAllClassesAndTotals();
testMultiClassFamilyOwnerExample();
testFilenames();
testExportsReuseAuthorisedDataOnly();
console.log("\nAll outstandingFeesByClass tests passed.");
