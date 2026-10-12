import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { register } from "node:module";
import { join } from "path";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, context, next) {" +
        " if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };" +
        " if (url.endsWith('.png') || url.endsWith('.jpg')) return { format: 'module', source: 'export default ' + JSON.stringify(url), shortCircuit: true };" +
        " return next(url, context); }"
    )
);

const FE = "/Users/tony-/Development/educlear/frontend/src";
const OUT = "/Users/tony-/Development/educlear/design-references/payslip-previews";
const { calculatePayroll } = await import(`${FE}/Payroll.tsx`);
const { buildPayslipPdf } = await import(`${FE}/payroll/buildPayslipPdf.ts`);
const { DA_SILVA_SCHOOL_ID, FLY_EAGLE_SCHOOL_ID } = await import(`${FE}/payroll/payslipLetterheads.ts`);

function png(file: string) {
  const buf = readFileSync(join(FE, "assets/letterheads", file));
  return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "PNG" as const };
}

function jpeg(file: string) {
  const buf = readFileSync(join(FE, "assets/letterheads", file));
  let i = 2;
  while (i < buf.length && !(buf[i] === 0xff && buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc3)) i += 2 + buf.readUInt16BE(i + 2);
  return { dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`, width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: "JPEG" as const };
}

const LABEL = "SAMPLE — NOT VALID FOR PAYMENT";
const PERIOD = "October 2026";

const samples = [
  {
    file: "fly-eagle-payslip-SAMPLE.pdf",
    schoolId: FLY_EAGLE_SCHOOL_ID,
    emp: { id: "s1", employeeNumber: "SAMPLE-FE-001", firstName: "Thandiwe Precious", lastName: "Sample-Mokoena (Fictitious)", email: null, idNumber: "SAMPLE ID", taxNumber: "SAMPLE TAX", basicSalary: 16800, jobTitle: "Grade 2 Teacher (Sample)", employeePension: 840, employeeMedicalAid: 950, employerMedicalAid: 1100 },
    adj: { overtimeHours: 4, overtimeRate: 140, bonus: 0, extraDeduction: 150, allowances: 900 },
  },
  {
    file: "da-silva-payslip-SAMPLE.pdf",
    schoolId: DA_SILVA_SCHOOL_ID,
    emp: { id: "s2", employeeNumber: "SAMPLE-DS-001", firstName: "Johannes Pieter", lastName: "Sample-van der Merwe (Fictitious)", email: null, idNumber: "SAMPLE ID", taxNumber: "SAMPLE TAX", basicSalary: 21500, jobTitle: "Senior Mathematics Teacher (Sample)", employeePension: 1075, employeeMedicalAid: 1350, employerMedicalAid: 1600 },
    adj: { overtimeHours: 0, overtimeRate: 0, bonus: 750, extraDeduction: 0, allowances: 1250 },
  },
];

mkdirSync(OUT, { recursive: true });
const images = {
  "da-silva": { crest: png("da-silva-crest.png"), heading: png("da-silva-heading.png") },
  "fly-eagle": { crest: jpeg("fly-eagle-crest.jpg") },
};
for (const s of samples) {
  const row = calculatePayroll(s.emp, s.adj);
  const { doc, letterheadId, imagesDrawn } = buildPayslipPdf(row, { period: PERIOD, schoolId: s.schoolId, images, sampleLabel: LABEL });
  writeFileSync(join(OUT, s.file), Buffer.from(doc.output("arraybuffer")));
  console.log(s.file, letterheadId, "pages", doc.getNumberOfPages(), "images", imagesDrawn.join(","), "gross", row.gross.toFixed(2), "ded", row.deductions.toFixed(2), "net", row.net.toFixed(2));
}
