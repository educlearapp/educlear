/**
 * Payslip letterheads — school selection, tenant isolation, figures and layout.
 * Run: npx tsx --tsconfig tsconfig.json src/payroll/payslipPdf.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import { register } from "node:module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { PayslipPdfRow } from "./buildPayslipPdf";
import type { LetterheadImage } from "./payslipLetterheads";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, context, next) {" +
        " if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };" +
        " if (url.endsWith('.png') || url.endsWith('.jpg')) return { format: 'module', source: 'export default ' + JSON.stringify(url), shortCircuit: true };" +
        " return next(url, context); }"
    )
);

const { calculatePayroll } = await import("../Payroll");
const { buildPayslipPdf, payslipDeductionLines, payslipEarningsLines, payslipMoney } = await import("./buildPayslipPdf");
const { DA_SILVA_SCHOOL_ID, FLY_EAGLE_SCHOOL_ID, resolvePayslipLetterheadId } = await import("./payslipLetterheads");

const here = dirname(fileURLToPath(import.meta.url));
const OTHER_SCHOOL_ID = "cm-other-school-test";
const PERIOD = "October 2026";

function pngImage(file: string): LetterheadImage {
  const buf = readFileSync(join(here, "../assets/letterheads", file));
  return {
    dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    format: "PNG",
  };
}

function jpegImage(file: string): LetterheadImage {
  const buf = readFileSync(join(here, "../assets/letterheads", file));
  let i = 2;
  while (i < buf.length && !(buf[i] === 0xff && buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc3)) {
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return {
    dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
    width: buf.readUInt16BE(i + 7),
    height: buf.readUInt16BE(i + 5),
    format: "JPEG",
  };
}

const DA_SILVA_IMAGES = { crest: pngImage("da-silva-crest.png"), heading: pngImage("da-silva-heading.png") };
const FLY_EAGLE_IMAGES = { crest: jpegImage("fly-eagle-crest.jpg") };
const ALL_IMAGES = { "da-silva": DA_SILVA_IMAGES, "fly-eagle": FLY_EAGLE_IMAGES };

function sampleRow(overrides: Record<string, unknown> = {}, adj: Record<string, unknown> = {}): PayslipPdfRow {
  return calculatePayroll(
    {
      id: "emp-1",
      employeeNumber: "SAMPLE-0001",
      firstName: "Nomvula",
      lastName: "Sample-Fictitious",
      email: null,
      idNumber: "0000000000000",
      taxNumber: "0000000000",
      basicSalary: 18500,
      jobTitle: "Grade 3 Teacher",
      employeePension: 925,
      employeeMedicalAid: 1200,
      employerMedicalAid: 1500,
      ...overrides,
    } as never,
    { overtimeHours: 6, overtimeRate: 150, bonus: 500, extraDeduction: 250, allowances: 1250, ...adj } as never
  ) as unknown as PayslipPdfRow;
}

const cents = (n: number) => Math.round(n * 100);

function testLetterheadSelection() {
  assert.equal(resolvePayslipLetterheadId(FLY_EAGLE_SCHOOL_ID), "fly-eagle");
  assert.equal(resolvePayslipLetterheadId(DA_SILVA_SCHOOL_ID), "da-silva");
  assert.equal(resolvePayslipLetterheadId(` ${DA_SILVA_SCHOOL_ID} `), "da-silva");
  assert.equal(resolvePayslipLetterheadId(OTHER_SCHOOL_ID), null);
  assert.equal(resolvePayslipLetterheadId(""), null);
  assert.equal(resolvePayslipLetterheadId(null), null);
  assert.equal(resolvePayslipLetterheadId("constructor"), null, "no prototype-key lookups");
  console.log("✓ 1/2/9 letterhead selected only by the authorised school id");
}

function testFlyEagleBranding() {
  assert.deepEqual([FLY_EAGLE_IMAGES.crest.width, FLY_EAGLE_IMAGES.crest.height], [720, 706], "official logo dimensions read");
  const { lines, letterheadId, imagesDrawn } = buildPayslipPdf(sampleRow(), {
    period: PERIOD,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    images: ALL_IMAGES,
  });
  assert.equal(letterheadId, "fly-eagle");
  for (const s of [
    "FLY EAGLE PRIMARY SCHOOL",
    "Good foundation for good success",
    "EMIS: 600105392",
    "Reg. No: 2011/112924/07",
    "P.O. Box 960, Rustenburg, 0300",
    "13 Lucas Street, Rustenburg CBD",
    "Tel: (014) 008 5093 / 008 5199",
    "WhatsApp: 073 838 1975",
    "flyeagleschool@gmail.com",
    "www.flyeagleschool.co.za",
    "Facebook: Fly Eagle Primary School",
  ]) {
    assert.ok(lines.includes(s), `Fly Eagle letterhead shows "${s}"`);
  }
  assert.ok(!lines.some((l) => /Da Silva|Klopper|600105372|dasilvaacademy/i.test(l)), "no Da Silva details");
  assert.ok(!lines.includes("EduClear Payroll"), "standard header not used");
  assert.deepEqual(imagesDrawn, ["fly-eagle:crest"], "only the Fly Eagle crest drawn; Da Silva artwork never drawn");
  assert.ok(!lines.includes("OFFICIAL CREST") && !lines.includes("ARTWORK REQUIRED"), "official crest replaces the placeholder");

  const withoutArtwork = buildPayslipPdf(sampleRow(), { period: PERIOD, schoolId: FLY_EAGLE_SCHOOL_ID, images: { "da-silva": DA_SILVA_IMAGES } });
  assert.deepEqual(withoutArtwork.imagesDrawn, [], "Da Silva artwork never substituted for the Fly Eagle crest");
  assert.ok(withoutArtwork.lines.includes("OFFICIAL CREST"), "placeholder only if the crest cannot be loaded");
  console.log("✓ 1/3 Fly Eagle letterhead with official crest; no Da Silva details or artwork");
}

function testDaSilvaBranding() {
  const { lines, letterheadId, imagesDrawn } = buildPayslipPdf(sampleRow(), {
    period: PERIOD,
    schoolId: DA_SILVA_SCHOOL_ID,
    images: ALL_IMAGES,
  });
  assert.equal(letterheadId, "da-silva");
  for (const s of [
    "“Be proud”",
    "212 Klopper Street, Rustenburg, 0299  ·  EMIS: 600105372",
    "Tel: 014 592 5613  ·  Fax: (014) 592 5613  ·  dasilvaacademy@gmail.com",
  ]) {
    assert.ok(lines.includes(s), `Da Silva letterhead shows "${s}"`);
  }
  assert.deepEqual(imagesDrawn, ["da-silva:crest:watermark", "da-silva:crest", "da-silva:heading"], "watermark drawn first, then crest + heading");
  assert.ok(!lines.some((l) => /Fly Eagle|Lucas Street|600105392|flyeagle/i.test(l)), "no Fly Eagle details");
  console.log("✓ 2/3 Da Silva letterhead with crest, heading and watermark; no Fly Eagle details");
}

function testOtherSchoolsUnchanged() {
  const { lines, letterheadId, imagesDrawn } = buildPayslipPdf(sampleRow(), {
    period: PERIOD,
    schoolId: OTHER_SCHOOL_ID,
    images: ALL_IMAGES,
  });
  assert.equal(letterheadId, null);
  assert.deepEqual(lines.slice(0, 8), [
    "EduClear Payroll",
    "PAYSLIP",
    "Nomvula Sample-Fictitious",
    `Period: ${PERIOD}`,
    "Employee Number: SAMPLE-0001",
    "ID Number: 0000000000000",
    "Tax Number: 0000000000",
    "Position: Grade 3 Teacher",
  ]);
  assert.deepEqual(imagesDrawn, []);
  assert.ok(!lines.some((l) => /Fly Eagle|Da Silva|EMIS/i.test(l)));
  assert.equal(lines[lines.length - 1], "Payroll processed by EduClear");
  console.log("✓ 9 other schools keep the standard EduClear payslip");
}

function testFiguresMatchPayroll() {
  const row = sampleRow();
  const earnSum = payslipEarningsLines(row).reduce((s, [, v]) => s + cents(v), 0);
  assert.equal(earnSum, cents(row.gross), "earnings lines (incl. Allowances) reconcile to Gross Earnings");
  const dedSum = payslipDeductionLines(row).reduce((s, [, v]) => s + cents(v), 0);
  assert.equal(dedSum, cents(row.deductions), "deduction lines reconcile to Total Deductions");
  assert.equal(cents(row.net), cents(row.gross) - cents(row.deductions));
  assert.equal(row.allowances, 1250);

  const noAllowances = sampleRow({}, { allowances: 0 });
  assert.equal(cents(row.gross) - cents(noAllowances.gross), cents(1250), "allowances already part of gross (unchanged calc)");

  for (const schoolId of [FLY_EAGLE_SCHOOL_ID, DA_SILVA_SCHOOL_ID, OTHER_SCHOOL_ID]) {
    const { lines } = buildPayslipPdf(row, { period: PERIOD, schoolId, images: ALL_IMAGES });
    const pairs: Array<[string, number]> = [
      ...payslipEarningsLines(row),
      ["Gross Earnings", row.gross],
      ...payslipDeductionLines(row),
      ["Total Deductions", row.deductions],
      ["NET PAY", row.net],
    ];
    for (const [label, value] of pairs) {
      const i = lines.indexOf(label);
      assert.ok(i >= 0, `${schoolId}: ${label} shown`);
      assert.equal(lines[i + 1], payslipMoney(value).replace(/[\u202F\u2009\u2007]/g, "\u00A0"), `${schoolId}: ${label} amount`);
    }
  }
  console.log("✓ 4/6 PDF figures equal calculatePayroll output; earnings reconcile to gross");
}

function testLongNamesAndLargeFigures() {
  const row = sampleRow(
    {
      firstName: "Alexandra-Maria Nomathemba Christina",
      lastName: "Van der Westhuizen-Mokoena-Fictitious",
      jobTitle: "Head of Foundation Phase and Senior Mathematics Co-ordinator (Sample)",
    },
    { bonus: 1234567.89, extraDeduction: 98765.43 }
  );
  for (const schoolId of [FLY_EAGLE_SCHOOL_ID, DA_SILVA_SCHOOL_ID]) {
    const { doc, lines } = buildPayslipPdf(row, { period: PERIOD, schoolId, images: ALL_IMAGES });
    const nameLines = lines.filter((l) => /Alexandra|Westhuizen/.test(l));
    assert.ok(nameLines.length >= 2, `${schoolId}: long name wraps instead of clipping`);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    for (const l of nameLines) assert.ok(doc.getTextWidth(l) <= (210 - 32 - 8) / 2 - 6 + 0.01, `${schoolId}: wrapped name fits column`);
    assert.ok(lines.includes(payslipMoney(row.net).replace(/[\u202F\u2009\u2007]/g, "\u00A0")), `${schoolId}: large net pay shown`);
    assert.equal(doc.getNumberOfPages(), 1, `${schoolId}: fits one A4 page`);
    assert.ok(lines.includes("Page 1 of 1"));
  }
  console.log("✓ 8 long names wrap; large amounts and all deduction lines fit on one page");
}

function testSampleLabelOnlyWhenRequested() {
  const label = "SAMPLE — NOT VALID FOR PAYMENT";
  const normal = buildPayslipPdf(sampleRow(), { period: PERIOD, schoolId: DA_SILVA_SCHOOL_ID, images: { "da-silva": DA_SILVA_IMAGES } });
  assert.ok(!normal.lines.includes(label), "real payslips carry no sample label");
  const sample = buildPayslipPdf(sampleRow(), { period: PERIOD, schoolId: FLY_EAGLE_SCHOOL_ID, sampleLabel: label });
  assert.equal(sample.lines.filter((l) => l === label).length, 2, "sample label: watermark + top banner");
  assert.ok(String(sample.doc.output()).startsWith("%PDF-"));
  console.log("✓ sample label only on owner-review previews");
}

function testPayrollDownloadWiring() {
  const src = readFileSync(join(here, "../Payroll.tsx"), "utf8");
  assert.ok(src.includes("buildPayslipPdf(row, { period, schoolId, images })"), "download uses logged-in school id");
  assert.ok(src.includes("await loadPayslipLetterheadImages(schoolId)"), "artwork loaded for the logged-in school only");
  const assets = readFileSync(join(here, "payslipLetterheadAssets.ts"), "utf8");
  assert.ok(assets.includes("const id = resolvePayslipLetterheadId(schoolId)"));
  assert.ok(/return \{ \[id\]: images \}/.test(assets), "loader returns only the resolved school's artwork");
  console.log("✓ 3/5 payslip download wired to the authorised school; per-school artwork only");
}

testLetterheadSelection();
testFlyEagleBranding();
testDaSilvaBranding();
testOtherSchoolsUnchanged();
testFiguresMatchPayroll();
testLongNamesAndLargeFigures();
testSampleLabelOnlyWhenRequested();
testPayrollDownloadWiring();
console.log("\nAll payslip PDF tests passed.");
