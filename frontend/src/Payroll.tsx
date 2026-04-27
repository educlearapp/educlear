import { useCallback, useEffect, useState } from "react";
import jsPDF from "jspdf";

import { useSchoolId } from "./useSchoolId";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

type Employee = {
  id: string;
  employeeNumber?: string | null;
  firstName: string;
  lastName: string;
  fullName?: string | null;
  email?: string | null;
  idNumber?: string | null;
  taxNumber?: string | null;
  basicSalary: number | string;
  physicalAddress?: string | null;
  bankName?: string | null;
  bankAccountHolder?: string | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  jobTitle?: string | null;
  employeePension?: number | string | null;
  employeeMedicalAid?: number | string | null;
  employerMedicalAid?: number | string | null;
  overtimeHours?: number | string | null;
  overtimeRate?: number | string | null;
};

type PayrollResult = {
  employeeId: string;
  employeeName: string;
  employeeNumber?: string | null;
  idNumber?: string | null;
  jobTitle?: string | null;
  basicSalary: number;
  overtimeHours: number;
  overtimeRate: number;
  overtimePay: number;
  medicalAidEmployee?: number;
  medicalAidEmployer?: number;
  pension: number;
  grossEarnings: number;
  paye: number;
  uif: number;
  deductions: number;
  net: number;
};

type SchoolPayrollInfo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  /** When enabled by API, headings may use `primaryColor`; default payslips stay neutral */
  brandingEnabled?: boolean | null;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function num(v: unknown, fallback = 0): number {
  const n = Number(v === undefined || v === null || v === "" ? fallback : v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtMoney(v: number): string {
  return `R ${num(v).toFixed(2)}`;
}

function safeText(s: string | null | undefined, fallback = "Not captured"): string {
  const t = String(s ?? "").trim();
  return t.length ? t : fallback;
}

function payrollEmployeeNumber(
  emp: Employee | undefined
): string {
  // Payslip rule: employee number is manual only (no fallbacks).
  return safeText(emp?.employeeNumber, "Not captured");
}

function payrollIdNumber(emp: Employee | undefined): string {
  // Payslip rule: ID number is a normal captured field (no fallbacks).
  return safeText(emp?.idNumber, "Not captured");
}

function bookkeeperEmployeeId(emp: Employee | undefined, payrollRow: PayrollResult): string {
  // Bookkeeper report rule for "Employee ID":
  // a) employee.employeeNumber
  // b) employee.idNumber
  // c) "Not captured"
  const empNo = String(emp?.employeeNumber ?? "").trim();
  if (empNo) return empNo;
  const idNo = String(emp?.idNumber ?? payrollRow.idNumber ?? "").trim();
  if (idNo) return idNo;
  return "Not captured";
}

function sanitizeFilePart(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, 80);
}

async function loadImageDataUrl(url: string): Promise<{ data: string; format: "PNG" | "JPEG" | "WEBP" } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || "";
    let format: "PNG" | "JPEG" | "WEBP" = "PNG";
    if (mime.includes("jpeg") || mime.includes("jpg")) format = "JPEG";
    else if (mime.includes("webp")) format = "WEBP";
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(blob);
    });
    return { data, format };
  } catch {
    return null;
  }
}

/** Keeps payslip on one page when labels wrap (e.g. long addresses). */
function splitTextLimited(doc: jsPDF, text: string, maxWidth: number, maxLines: number): string[] {
  const lines = doc.splitTextToSize(text, maxWidth);
  if (lines.length <= maxLines) return lines;
  return lines.slice(0, maxLines);
}

const NEUTRAL_HEADING_RGB: [number, number, number] = [33, 33, 33];
const LABEL_MUTED_RGB: [number, number, number] = [118, 118, 118];

/** Returns vertical span used (compact rows). Values slightly bold; labels muted. */
function drawEmployeeDetailCell(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  startY: number,
  maxW: number,
  maxLines: number
): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(LABEL_MUTED_RGB[0], LABEL_MUTED_RGB[1], LABEL_MUTED_RGB[2]);
  doc.text(label, x, startY + 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.7);
  doc.setTextColor(48, 48, 48);
  const lines = splitTextLimited(doc, value, maxW, maxLines);
  doc.text(lines, x, startY + 5.2);
  doc.setFont("helvetica", "normal");
  return 5.2 + lines.length * 3.15 + 1.35;
}

async function buildPayslipPdf(params: {
  result: PayrollResult;
  employees: Employee[];
  schoolInfo: SchoolPayrollInfo | null;
  lastPayrollMonth: number | null;
  lastPayrollYear: number | null;
}): Promise<jsPDF> {
  const { result, employees, schoolInfo, lastPayrollMonth, lastPayrollYear } = params;
  const emp = employees.find((e) => e.id === result.employeeId);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  const innerW = pageW - 2 * margin;
  const hdrRgb = NEUTRAL_HEADING_RGB;
  const sectionGap = 8;

  const m = lastPayrollMonth ?? new Date().getMonth() + 1;
  const yrr = lastPayrollYear ?? new Date().getFullYear();
  const periodLabel = `${MONTH_NAMES[Math.min(12, Math.max(1, m)) - 1]} ${yrr}`;

  const schoolDisplayName = safeText(schoolInfo?.name, "School");
  const rawEmail = String(schoolInfo?.email ?? "").trim();
  const rawPhone = String(schoolInfo?.phone ?? "").trim();
  const rawAddr = String(schoolInfo?.address ?? "").trim();

  const logoW = 20;
  const logoH = 11;
  let logoData: { data: string; format: "PNG" | "JPEG" | "WEBP" } | null = null;
  if (schoolInfo?.logoUrl?.trim()) {
    logoData = await loadImageDataUrl(schoolInfo.logoUrl.trim());
  }

  const headerTop = margin;
  const leftTextMaxW = innerW * 0.52 - 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(28, 28, 28);
  const schoolLines = splitTextLimited(doc, schoolDisplayName, leftTextMaxW, 2);
  const schoolNameLineGap = 4.6;
  doc.text(schoolLines, margin, headerTop + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(95, 95, 95);
  let ly = headerTop + 4 + Math.max(0, schoolLines.length - 1) * schoolNameLineGap + 4;
  const lineStep = 4;
  if (rawEmail) {
    doc.text(rawEmail, margin, ly);
    ly += lineStep;
  }
  if (rawPhone) {
    doc.text(rawPhone, margin, ly);
    ly += lineStep;
  }
  if (rawAddr) {
    const addrLines = splitTextLimited(doc, rawAddr, leftTextMaxW, 3);
    doc.text(addrLines, margin, ly);
    ly += addrLines.length * lineStep;
  }
  if (!rawEmail && !rawPhone && !rawAddr) {
    doc.text("—", margin, ly);
    ly += lineStep;
  }
  const leftBottom = ly + 3;

  if (logoData) {
    try {
      doc.addImage(logoData.data, logoData.format, pageW - margin - logoW, headerTop, logoW, logoH);
    } catch {
      /* omit logo */
    }
  }

  const payslipBlockTop = headerTop;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(28, 28, 28);
  doc.text("PAYSLIP", pageW - margin, payslipBlockTop + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(92, 92, 92);
  doc.text(`Pay period: ${periodLabel}`, pageW - margin, payslipBlockTop + 12, { align: "right" });

  const rightBottom = payslipBlockTop + 15;
  const headerBottom = Math.max(leftBottom, rightBottom, logoData ? headerTop + logoH + 3 : headerTop + 15) + 4;

  doc.setDrawColor(175, 175, 175);
  doc.setLineWidth(0.15);
  doc.line(margin, headerBottom, pageW - margin, headerBottom);

  let y = headerBottom + 6;

  const empPad = 4;
  const empSectionTop = y;
  y += empPad;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(hdrRgb[0], hdrRgb[1], hdrRgb[2]);
  doc.text("Employee details", margin + empPad, y + 2);
  y += 7;

  const leftColX = margin + empPad + 2;
  const rightColX = margin + innerW / 2 + 2;
  const leftColW = innerW / 2 - empPad * 2 - 5;
  const rightColW = innerW / 2 - empPad * 2 - 5;

  const fullName = safeText(emp?.fullName || result.employeeName);
  const leftPairs: [string, string][] = [
    ["Full name", fullName],
    ["Employee number", payrollEmployeeNumber(emp)],
    ["ID number", payrollIdNumber(emp)],
    ["Tax number", safeText(emp?.taxNumber)],
    ["Job title", safeText(emp?.jobTitle ?? result.jobTitle)],
  ];
  const rightPairs: [string, string][] = [
    ["Physical address", safeText(emp?.physicalAddress)],
    ["Bank name", safeText(emp?.bankName)],
    ["Account holder", safeText(emp?.bankAccountHolder)],
    ["Account number", safeText(emp?.bankAccountNumber)],
    ["Branch code", safeText(emp?.bankBranchCode)],
  ];

  const pairCount = Math.max(leftPairs.length, rightPairs.length);
  for (let i = 0; i < pairCount; i++) {
    const rowTop = y;
    let leftH = 0;
    let rightH = 0;
    const lp = leftPairs[i];
    const rp = rightPairs[i];
    if (lp) {
      leftH = drawEmployeeDetailCell(doc, lp[0], lp[1], leftColX, rowTop, leftColW, lp[0] === "Physical address" ? 3 : 2);
    }
    if (rp) {
      rightH = drawEmployeeDetailCell(doc, rp[0], rp[1], rightColX, rowTop, rightColW, rp[0] === "Physical address" ? 3 : 2);
    }
    const rowH = Math.max(leftH, rightH, 10.5);
    if (i < pairCount - 1) {
      doc.setDrawColor(228, 228, 228);
      doc.setLineWidth(0.06);
      doc.line(margin + empPad + 2, rowTop + rowH - 0.6, pageW - margin - empPad - 2, rowTop + rowH - 0.6);
    }
    y = rowTop + rowH;
  }

  const empBoxBottom = y + empPad;
  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(0.25);
  doc.rect(margin, empSectionTop, innerW, empBoxBottom - empSectionTop, "S");
  y = empBoxBottom + sectionGap;

  const empMed = num(result.medicalAidEmployee ?? emp?.employeeMedicalAid);
  const emplMed = num(result.medicalAidEmployer ?? emp?.employerMedicalAid);
  const otPay = num(result.overtimePay);
  const basic = num(result.basicSalary ?? emp?.basicSalary);
  const payslipGross = Number((basic + otPay + emplMed).toFixed(2));
  const paye = num(result.paye);
  const uif = num(result.uif);
  const pension = num(result.pension);
  const totDed = num(result.deductions);
  const net = num(result.net);

  const amtRight = pageW - margin - 2;
  const earnRowH = 4.2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(hdrRgb[0], hdrRgb[1], hdrRgb[2]);
  doc.text("Earnings", margin + 2, y);
  doc.setDrawColor(195, 195, 195);
  doc.setLineWidth(0.1);
  doc.line(margin + 2, y + 1.2, pageW - margin - 2, y + 1.2);
  y += 6.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(40, 40, 40);
  const earnRows: [string, number][] = [
    ["Basic salary", basic],
    ["Overtime pay", otPay],
    ["Medical aid (employer contribution)", emplMed],
  ];
  for (let i = 0; i < earnRows.length; i++) {
    const [lab, amt] = earnRows[i];
    doc.text(lab, margin + 3, y);
    doc.text(fmtMoney(amt), amtRight, y, { align: "right" });
    y += earnRowH;
    if (i < earnRows.length - 1) {
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.05);
      doc.line(margin + 3, y - 0.3, pageW - margin - 3, y - 0.3);
    }
  }
  doc.setDrawColor(165, 165, 165);
  doc.setLineWidth(0.1);
  doc.line(margin + 3, y + 0.4, pageW - margin - 3, y + 0.4);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Gross earnings", margin + 3, y);
  doc.text(fmtMoney(payslipGross), amtRight, y, { align: "right" });
  y += 7 + (sectionGap - 6);

  doc.setTextColor(hdrRgb[0], hdrRgb[1], hdrRgb[2]);
  doc.text("Deductions", margin + 2, y);
  doc.setDrawColor(195, 195, 195);
  doc.line(margin + 2, y + 1.2, pageW - margin - 2, y + 1.2);
  y += 6.5;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  const dedRows: [string, number][] = [
    ["PAYE", paye],
    ["UIF", uif],
    ["Pension", pension],
    ["Medical aid (employee)", empMed],
  ];
  for (let i = 0; i < dedRows.length; i++) {
    const [lab, amt] = dedRows[i];
    doc.text(lab, margin + 3, y);
    doc.text(fmtMoney(amt), amtRight, y, { align: "right" });
    y += earnRowH;
    if (i < dedRows.length - 1) {
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.05);
      doc.line(margin + 3, y - 0.3, pageW - margin - 3, y - 0.3);
    }
  }
  doc.setDrawColor(165, 165, 165);
  doc.setLineWidth(0.1);
  doc.line(margin + 3, y + 0.4, pageW - margin - 3, y + 0.4);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Total deductions", margin + 3, y);
  doc.text(fmtMoney(totDed), amtRight, y, { align: "right" });
  y += 9;

  const netTop = y;
  const netBoxH = 14;
  doc.setFillColor(32, 32, 32);
  doc.rect(margin, netTop, innerW, netBoxH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("Net pay", margin + 3.5, netTop + netBoxH / 2 + 1.8);
  doc.text(fmtMoney(net), amtRight - 2, netTop + netBoxH / 2 + 1.8, { align: "right" });
  doc.setTextColor(0, 0, 0);

  const footerY = netTop + netBoxH + 6;
  doc.setFontSize(6.2);
  doc.setTextColor(165, 165, 165);
  doc.setFont("helvetica", "normal");
  doc.text("Payroll processed by EduClear", pageW / 2, footerY, { align: "center" });

  return doc;
}

function buildBookkeeperReportPdf(params: {
  schoolInfo: SchoolPayrollInfo | null;
  employees: Employee[];
  payrollResults: PayrollResult[];
  payrollSummary: { grossTotal: number; deductionsTotal: number; netTotal: number } | null;
  periodLabel: string;
}): jsPDF {
  const { schoolInfo, employees, payrollResults, payrollSummary, periodLabel } = params;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(28, 28, 28);
  doc.text("Payroll — Bookkeeper report", margin, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(66, 66, 66);
  doc.text(safeText(schoolInfo?.name, "School"), margin, y);
  y += 5;
  const schEmail = String(schoolInfo?.email ?? "").trim();
  const schPhone = String(schoolInfo?.phone ?? "").trim();
  const schAddr = String(schoolInfo?.address ?? "").trim();
  const companyLineStep = 4.6;
  if (schEmail) {
    doc.text(schEmail, margin, y);
    y += companyLineStep;
  }
  if (schPhone) {
    doc.text(schPhone, margin, y);
    y += companyLineStep;
  }
  if (schAddr) {
    const addrLines = doc.splitTextToSize(schAddr, pageW - 2 * margin);
    doc.text(addrLines, margin, y);
    y += addrLines.length * 4.2 + 3;
  }
  doc.setFontSize(8.5);
  doc.text(`Pay period: ${periodLabel}`, margin, y);
  y += 10;

  const gross = payrollSummary?.grossTotal ?? payrollResults.reduce((s, r) => s + num(r.grossEarnings), 0);
  const ded = payrollSummary?.deductionsTotal ?? payrollResults.reduce((s, r) => s + num(r.deductions), 0);
  const net = payrollSummary?.netTotal ?? payrollResults.reduce((s, r) => s + num(r.net), 0);

  const totalsGapBefore = 3;
  y += totalsGapBefore;
  const totalsBoxH = 19;
  doc.setFillColor(247, 247, 247);
  doc.setDrawColor(220, 220, 220);
  doc.rect(margin, y, pageW - 2 * margin, totalsBoxH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(40, 40, 40);
  doc.text(`Total gross earnings: ${fmtMoney(gross)}`, margin + 3.5, y + 5.5);
  doc.text(`Total deductions: ${fmtMoney(ded)}`, margin + 3.5, y + 11);
  doc.text(`Total net pay: ${fmtMoney(net)}`, margin + 3.5, y + 16.5);
  y += totalsBoxH + 6;

  const cols = [50, 19, 24, 25, 21, 17, 20, 23, 24, 26, 27];
  const headers = [
    "Employee name",
    "Employee ID",
    "Basic",
    "Gross",
    "PAYE",
    "UIF",
    "Pension",
    "Med (emp)",
    "Med (employer)",
    "Total deductions",
    "Net pay",
  ];

  const drawColumnHeaders = (headerY: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    doc.setTextColor(45, 45, 45);
    let hx = margin;
    for (let i = 0; i < headers.length; i++) {
      const cw = cols[i];
      if (i <= 1) doc.text(headers[i], hx, headerY, { maxWidth: cw });
      else doc.text(headers[i], hx + cw, headerY, { align: "right" });
      hx += cw;
    }
    const ruleY = headerY + 5.5;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(margin, ruleY, pageW - margin, ruleY);
    return ruleY + 5;
  };

  y = drawColumnHeaders(y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.1);
  doc.setTextColor(35, 35, 35);

  for (const row of payrollResults) {
    if (y > pageH - margin - 18) {
      doc.addPage();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(130, 130, 130);
      doc.text("(continued)", margin, margin + 3);
      y = drawColumnHeaders(margin + 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.1);
      doc.setTextColor(35, 35, 35);
    }
    const emp = employees.find((e) => e.id === row.employeeId);
    const empIdDisp = bookkeeperEmployeeId(emp, row);
    const cells: string[] = [
      row.employeeName,
      empIdDisp,
      fmtMoney(row.basicSalary),
      fmtMoney(row.grossEarnings),
      fmtMoney(row.paye),
      fmtMoney(row.uif),
      fmtMoney(row.pension),
      fmtMoney(row.medicalAidEmployee ?? 0),
      fmtMoney(row.medicalAidEmployer ?? 0),
      fmtMoney(row.deductions),
      fmtMoney(row.net),
    ];
    let rx = margin;
    let rowH = 5;
    for (let i = 0; i < cells.length; i++) {
      const cw = cols[i];
      const txt = cells[i];
      if (i === 0) {
        const lines = splitTextLimited(doc, txt, cw - 1, 2);
        doc.text(lines, rx, y);
        rowH = Math.max(rowH, lines.length * 3.85);
      } else if (i === 1) {
        doc.text(txt, rx, y, { maxWidth: cw });
        rowH = Math.max(rowH, 5);
      } else {
        doc.text(txt, rx + cw, y, { align: "right" });
      }
      rx += cw;
    }
    y += rowH + 1.1;
  }

  doc.setFontSize(6.5);
  doc.setTextColor(140, 140, 140);
  doc.text("Payroll processed by EduClear", pageW / 2, pageH - 6, { align: "center" });

  return doc;
}

function downloadBookkeeperReportPdf(params: {
  schoolInfo: SchoolPayrollInfo | null;
  employees: Employee[];
  payrollResults: PayrollResult[];
  payrollSummary: { grossTotal: number; deductionsTotal: number; netTotal: number } | null;
  periodLabel: string;
}): void {
  const doc = buildBookkeeperReportPdf(params);
  const schoolSlug = sanitizeFilePart(safeText(params.schoolInfo?.name, "school"));
  doc.save(`Payroll-Bookkeeper-${schoolSlug}-${sanitizeFilePart(params.periodLabel.replace(/\s+/g, "_"))}.pdf`);
}

export default function Payroll() {
  const schoolId = useSchoolId();
  const [schoolInfo, setSchoolInfo] = useState<SchoolPayrollInfo | null>(null);

  const [payrollResults, setPayrollResults] = useState<PayrollResult[]>([]);
  const [payrollSummary, setPayrollSummary] = useState<{
    grossTotal: number;
    deductionsTotal: number;
    netTotal: number;
  } | null>(null);
  const [lastPayrollMonth, setLastPayrollMonth] = useState<number | null>(null);
  const [lastPayrollYear, setLastPayrollYear] = useState<number | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [basicSalary, setBasicSalary] = useState("");

  const [physicalAddress, setPhysicalAddress] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankBranchCode, setBankBranchCode] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [pensionAmount, setPensionAmount] = useState("");
  const [medicalAidAmount, setMedicalAidAmount] = useState("");
  const [employerMedicalAidAmount, setEmployerMedicalAidAmount] = useState("");
  const [overtimeHoursField, setOvertimeHoursField] = useState("");
  const [overtimeRateField, setOvertimeRateField] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [payrollNotice, setPayrollNotice] = useState("");
  const [emailBusyId, setEmailBusyId] = useState<string | null>(null);
  const [bookkeeperBusy, setBookkeeperBusy] = useState(false);
  const [bookkeeperEmail, setBookkeeperEmail] = useState("");
  const [bookkeeperEmailBusy, setBookkeeperEmailBusy] = useState(false);

  const fetchSchoolInfo = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const response = await fetch(`${API_URL}/api/payroll/school/${sid}`);
      if (!response.ok) {
        setSchoolInfo(null);
        return;
      }
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        setSchoolInfo(null);
        return;
      }
      const d = data as Record<string, unknown>;
      const id = d.id != null ? String(d.id) : "";
      if (!id) {
        setSchoolInfo(null);
        return;
      }
      setSchoolInfo({
        id,
        name: String(d.name ?? ""),
        email: d.email == null ? null : String(d.email),
        phone: d.phone == null ? null : String(d.phone),
        address: d.address == null || d.address === "" ? null : String(d.address),
        logoUrl: d.logoUrl == null ? null : String(d.logoUrl),
        primaryColor: d.primaryColor == null ? null : String(d.primaryColor),
        brandingEnabled: d.brandingEnabled === true,
      });
    } catch {
      setSchoolInfo(null);
    }
  }, []);

  const generatePayslip = useCallback(
    async (result: PayrollResult) => {
      const doc = await buildPayslipPdf({
        result,
        employees,
        schoolInfo,
        lastPayrollMonth,
        lastPayrollYear,
      });
      const m = lastPayrollMonth ?? new Date().getMonth() + 1;
      const yrr = lastPayrollYear ?? new Date().getFullYear();
      const fileBase = `${sanitizeFilePart(result.employeeName)}-Payslip-${yrr}-${String(m).padStart(2, "0")}`;
      doc.save(`${fileBase}.pdf`);
    },
    [employees, schoolInfo, lastPayrollMonth, lastPayrollYear]
  );

  const emailPayslip = useCallback(
    async (result: PayrollResult) => {
      setPayrollNotice("");
      const emp = employees.find((e) => e.id === result.employeeId);
      const addr = String(emp?.email ?? "").trim();
      if (!addr) {
        setPayrollNotice("Email payslip: this employee has no email address on file. Add an email to the employee record, then try again.");
        return;
      }

      const m = lastPayrollMonth ?? new Date().getMonth() + 1;
      const yrr = lastPayrollYear ?? new Date().getFullYear();
      const periodLabel = `${MONTH_NAMES[Math.min(12, Math.max(1, m)) - 1]} ${yrr}`;
      const fileBase = `${sanitizeFilePart(result.employeeName)}-Payslip-${yrr}-${String(m).padStart(2, "0")}`;

      try {
        setEmailBusyId(result.employeeId);
        const doc = await buildPayslipPdf({
          result,
          employees,
          schoolInfo,
          lastPayrollMonth,
          lastPayrollYear,
        });
        const dataUri = doc.output("datauristring");
        const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : "";

        const response = await fetch(`${API_URL}/api/payroll/email-payslip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schoolId,
            employeeId: result.employeeId,
            pdfBase64: base64,
            fileName: `${fileBase}.pdf`,
            periodLabel,
            employeeName: result.employeeName,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setPayrollNotice(typeof data?.error === "string" ? data.error : "Could not send payslip email.");
          return;
        }
        if (typeof data?.message === "string") {
          setPayrollNotice(data.message);
        } else {
          setPayrollNotice(`Payslip emailed to ${addr}`);
        }
      } catch {
        setPayrollNotice("Could not send payslip email. Check your connection and try again.");
      } finally {
        setEmailBusyId(null);
      }
    },
    [employees, schoolInfo, lastPayrollMonth, lastPayrollYear, schoolId]
  );

  const handleDownloadBookkeeperReport = useCallback(() => {
    if (!payrollResults.length) return;
    const m = lastPayrollMonth ?? new Date().getMonth() + 1;
    const yrr = lastPayrollYear ?? new Date().getFullYear();
    const periodLabel = `${MONTH_NAMES[Math.min(12, Math.max(1, m)) - 1]} ${yrr}`;
    try {
      setBookkeeperBusy(true);
      setPayrollNotice("");
      downloadBookkeeperReportPdf({
        schoolInfo,
        employees,
        payrollResults,
        payrollSummary,
        periodLabel,
      });
      setPayrollNotice("Bookkeeper report downloaded.");
    } finally {
      setBookkeeperBusy(false);
    }
  }, [employees, payrollResults, payrollSummary, schoolInfo, lastPayrollMonth, lastPayrollYear]);

  const handleEmailBookkeeperReport = useCallback(async () => {
    if (!payrollResults.length || !schoolId) return;
    const to = bookkeeperEmail.trim();
    if (!to) {
      setPayrollNotice("Enter a bookkeeper email address.");
      return;
    }
    const m = lastPayrollMonth ?? new Date().getMonth() + 1;
    const yrr = lastPayrollYear ?? new Date().getFullYear();
    const periodLabel = `${MONTH_NAMES[Math.min(12, Math.max(1, m)) - 1]} ${yrr}`;
    const schoolSlug = sanitizeFilePart(safeText(schoolInfo?.name, "school"));
    const fileName = `Payroll-Bookkeeper-${schoolSlug}-${sanitizeFilePart(periodLabel.replace(/\s+/g, "_"))}.pdf`;
    setPayrollNotice("");
    try {
      setBookkeeperEmailBusy(true);
      const doc = buildBookkeeperReportPdf({
        schoolInfo,
        employees,
        payrollResults,
        payrollSummary,
        periodLabel,
      });
      const dataUri = doc.output("datauristring");
      const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : "";
      const response = await fetch(`${API_URL}/api/payroll/email-bookkeeper-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          bookkeeperEmail: to,
          pdfBase64: base64,
          fileName,
          periodLabel,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPayrollNotice(typeof data?.error === "string" ? data.error : "Could not email bookkeeper report.");
        return;
      }
      if (typeof data?.message === "string") {
        setPayrollNotice(data.message);
      } else {
        setPayrollNotice(`Bookkeeper report emailed to ${to}`);
      }
    } catch {
      setPayrollNotice("Could not email bookkeeper report. Check your connection and try again.");
    } finally {
      setBookkeeperEmailBusy(false);
    }
  }, [
    employees,
    payrollResults,
    payrollSummary,
    schoolInfo,
    schoolId,
    lastPayrollMonth,
    lastPayrollYear,
    bookkeeperEmail,
  ]);

  useEffect(() => {
    if (!schoolId) return;
    fetchEmployees(schoolId);
    fetchSchoolInfo(schoolId);
  }, [fetchSchoolInfo, schoolId]);

  async function fetchEmployees(currentSchoolId: string) {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/payroll/employees/${currentSchoolId}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setEmployees(data);
      } else {
        setEmployees([]);
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  function resetEmployeeForm() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setIdNumber("");
    setTaxNumber("");
    setBasicSalary("");
    setPhysicalAddress("");
    setBankName("");
    setBankAccountHolder("");
    setBankAccountNumber("");
    setBankBranchCode("");
    setEmployeeNumber("");
    setJobTitle("");
    setPensionAmount("");
    setMedicalAidAmount("");
    setEmployerMedicalAidAmount("");
    setOvertimeHoursField("");
    setOvertimeRateField("");
  }

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) {
      setMessage("No schoolId found in localStorage.");
      return;
    }

    try {
      setMessage("");
      const response = await fetch(`${API_URL}/api/payroll/employee`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schoolId,
          firstName,
          lastName,
          email,
          idNumber,
          taxNumber,
          basicSalary: num(basicSalary),
          physicalAddress,
          bankName,
          bankAccountHolder,
          bankAccountNumber,
          bankBranchCode,
          employeeNumber: employeeNumber || null,
          jobTitle: jobTitle || null,
          employeePension: num(pensionAmount),
          employeeMedicalAid: num(medicalAidAmount),
          employerMedicalAid: num(employerMedicalAidAmount),
          overtimeHours: num(overtimeHoursField),
          overtimeRate: num(overtimeRateField),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "Failed to add employee");
        return;
      }

      resetEmployeeForm();
      setMessage("Employee added successfully");
      fetchEmployees(schoolId);
    } catch (error) {
      console.error(error);
      setMessage("Failed to add employee");
    }
  }

  async function handleRunPayroll() {
    if (!schoolId) {
      setMessage("No schoolId found in localStorage.");
      return;
    }

    try {
      setMessage("");
      setPayrollNotice("");
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const response = await fetch(`${API_URL}/api/payroll/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schoolId,
          month,
          year,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data?.error || "Failed to run payroll");
        return;
      }

      setPayrollResults(Array.isArray(data.employees) ? data.employees : []);
      setPayrollSummary({
        grossTotal: num(data.grossTotal),
        deductionsTotal: num(data.deductionsTotal),
        netTotal: num(data.netTotal),
      });
      setLastPayrollMonth(month);
      setLastPayrollYear(year);

      setMessage(
        `Payroll Done ✅


Gross: R${data.grossTotal}


Deductions: R${data.deductionsTotal}


Net: R${data.netTotal}`
      );
    } catch (error) {
      console.error(error);
      setMessage("Failed to run payroll");
    }
  }

  return (
    <div style={{ padding: "32px", background: "#f8fafc", minHeight: "100vh" }}>
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "18px",
          padding: "32px",
          boxShadow: "0 8px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ margin: 0, fontSize: "32px" }}>Payroll</h1>
          <p style={{ marginTop: "8px", color: "#475569" }}>Add employees and run payroll for your school.</p>
          <p style={{ marginTop: "8px", color: "#0f172a", fontWeight: 600 }}>School ID: {schoolId || "Not found"}</p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Add Employee</h2>
            <div style={{ maxWidth: "600px", margin: "0 auto", width: "100%" }}>
              <form onSubmit={handleAddEmployee} style={{ display: "grid", gap: "8px" }}>
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={inputStyle}
                required
              />
              <input
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={inputStyle}
                required
              />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="ID Number"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Tax Number"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                style={inputStyle}
              />
              <textarea
                placeholder="Physical address"
                value={physicalAddress}
                onChange={(e) => setPhysicalAddress(e.target.value)}
                rows={2}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  fontFamily: "inherit",
                  minHeight: "72px",
                  height: "auto",
                }}
              />
              <input
                type="text"
                placeholder="Bank name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Bank account holder"
                value={bankAccountHolder}
                onChange={(e) => setBankAccountHolder(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Bank account number"
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Bank branch code"
                value={bankBranchCode}
                onChange={(e) => setBankBranchCode(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Employee number"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                placeholder="Job title / position"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                style={inputStyle}
              />
              <input
                type="number"
                placeholder="Basic salary"
                value={basicSalary}
                onChange={(e) => setBasicSalary(e.target.value)}
                style={inputStyle}
                required
              />
              <input
                type="number"
                placeholder="Pension amount (employee deduction)"
                value={pensionAmount}
                onChange={(e) => setPensionAmount(e.target.value)}
                style={inputStyle}
                min={0}
                step="0.01"
              />
              <input
                type="number"
                placeholder="Medical aid amount (employee deduction)"
                value={medicalAidAmount}
                onChange={(e) => setMedicalAidAmount(e.target.value)}
                style={inputStyle}
                min={0}
                step="0.01"
              />
              <input
                type="number"
                placeholder="Employer medical aid contribution (if any, adds to gross)"
                value={employerMedicalAidAmount}
                onChange={(e) => setEmployerMedicalAidAmount(e.target.value)}
                style={inputStyle}
                min={0}
                step="0.01"
              />
              <input
                type="number"
                placeholder="Overtime hours"
                value={overtimeHoursField}
                onChange={(e) => setOvertimeHoursField(e.target.value)}
                style={inputStyle}
                min={0}
                step="0.01"
              />
              <input
                type="number"
                placeholder="Overtime rate (per hour)"
                value={overtimeRateField}
                onChange={(e) => setOvertimeRateField(e.target.value)}
                style={inputStyle}
                min={0}
                step="0.01"
              />

              <button type="submit" style={primaryButtonStyle}>
                Save Employee
              </button>
            </form>
            </div>

            <button
              type="button"
              onClick={handleRunPayroll}
              style={{ ...secondaryButtonStyle, marginTop: "16px", width: "100%" }}
            >
              Run Payroll
            </button>

            {message && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "#f1f5f9",
                  color: "#0f172a",
                  whiteSpace: "pre-line",
                }}
              >
                {message}
              </div>
            )}

            {payrollResults.length > 0 && (
              <div style={payrollResultsSectionCard}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "#0f172a" }}>Payroll Results</h2>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <input
                      type="email"
                      placeholder="Bookkeeper email"
                      value={bookkeeperEmail}
                      onChange={(e) => setBookkeeperEmail(e.target.value)}
                      autoComplete="email"
                      style={{ ...inputStyle, minWidth: "200px", maxWidth: "280px", margin: 0 }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleEmailBookkeeperReport()}
                      disabled={bookkeeperEmailBusy}
                      style={bookkeeperEmailButtonStyle}
                    >
                      {bookkeeperEmailBusy ? "Sending…" : "Email Bookkeeper Report"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadBookkeeperReport}
                      disabled={bookkeeperBusy}
                      style={bookkeeperButtonStyle}
                    >
                      {bookkeeperBusy ? "Preparing…" : "Download Bookkeeper Report"}
                    </button>
                  </div>
                </div>

                {payrollNotice ? (
                  <div
                    style={{
                      marginBottom: "12px",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      color: "#334155",
                      fontSize: "14px",
                    }}
                  >
                    {payrollNotice}
                  </div>
                ) : null}

                {payrollSummary && (
                  <div
                    style={{
                      marginBottom: "20px",
                      padding: "14px 16px",
                      borderRadius: "12px",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      color: "#14532d",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "8px" }}>Payroll summary (total)</div>
                    <div>Gross earnings: {fmtMoney(payrollSummary.grossTotal)}</div>
                    <div>Total deductions: {fmtMoney(payrollSummary.deductionsTotal)}</div>
                    <div style={{ fontWeight: 700, marginTop: "4px" }}>
                      Net pay (all employees): {fmtMoney(payrollSummary.netTotal)}
                    </div>
                  </div>
                )}

                <div style={payrollResultsTableContainer}>
                  <style>{`
                    .payroll-results-table tbody tr:hover td {
                      background-color: #f1f5f9;
                    }
                  `}</style>
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <table
                      className="payroll-results-table"
                      style={{
                        width: "100%",
                        minWidth: "1020px",
                        borderCollapse: "separate",
                        borderSpacing: 0,
                        fontSize: "14px",
                        color: "#0f172a",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th style={{ ...payrollTh, textAlign: "left" }}>Employee name</th>
                          <th style={{ ...payrollTh, textAlign: "right" }}>Gross earnings</th>
                          <th style={{ ...payrollTh, textAlign: "right" }}>Basic salary</th>
                          <th style={{ ...payrollTh, textAlign: "right" }}>PAYE</th>
                          <th style={{ ...payrollTh, textAlign: "right" }}>UIF</th>
                          <th style={{ ...payrollTh, textAlign: "right" }}>Total deductions</th>
                          <th style={{ ...payrollTh, textAlign: "right" }}>Net pay</th>
                          <th style={{ ...payrollTh, textAlign: "center" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrollResults.map((item) => (
                          <tr key={item.employeeId}>
                            <td style={payrollTdName}>{item.employeeName}</td>
                            <td style={payrollTdMoney}>{fmtMoney(item.grossEarnings)}</td>
                            <td style={payrollTdMoney}>{fmtMoney(item.basicSalary)}</td>
                            <td style={payrollTdMoney}>{fmtMoney(item.paye)}</td>
                            <td style={payrollTdMoney}>{fmtMoney(item.uif)}</td>
                            <td style={{ ...payrollTdMoney, fontWeight: 600 }}>{fmtMoney(item.deductions)}</td>
                            <td style={payrollTdNet}>{fmtMoney(item.net)}</td>
                            <td style={payrollTdAction}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => void generatePayslip(item)}
                                  style={payslipDownloadButtonStyle}
                                >
                                  Download Payslip
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void emailPayslip(item)}
                                  disabled={emailBusyId === item.employeeId}
                                  style={payslipEmailButtonStyle}
                                >
                                  {emailBusyId === item.employeeId ? "Sending…" : "Email Payslip"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Employees</h2>
            {loading ? (
              <p>Loading employees...</p>
            ) : employees.length === 0 ? (
              <p>No payroll employees added yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "12px" }}>
                {employees.map((employee) => (
                  <div
                    key={employee.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      padding: "14px",
                      background: "#f8fafc",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {employee.fullName || `${employee.firstName} ${employee.lastName}`}
                    </div>
                    <div style={{ color: "#475569", marginTop: "4px", fontSize: "14px" }}>
                      Employee no. {safeText(employee.employeeNumber)}
                    </div>
                    {employee.jobTitle ? (
                      <div style={{ color: "#475569", marginTop: "2px", fontSize: "14px" }}>{employee.jobTitle}</div>
                    ) : null}
                    <div style={{ color: "#475569", marginTop: "6px" }}>{employee.email || "No email"}</div>
                    <div style={{ color: "#475569", marginTop: "6px" }}>
                      Address: {employee.physicalAddress?.trim() ? employee.physicalAddress : "Not captured"}
                    </div>
                    <div style={{ color: "#475569", marginTop: "6px" }}>
                      ID Number: {safeText(employee.idNumber)}
                    </div>
                    <div style={{ color: "#475569", marginTop: "6px" }}>
                      Tax Number: {employee.taxNumber || "Not captured"}
                    </div>
                    <div style={{ color: "#475569", marginTop: "8px", fontSize: "13px" }}>
                      Bank: {employee.bankName?.trim() ? employee.bankName : "Not captured"}
                    </div>
                    <div style={{ color: "#475569", marginTop: "4px", fontSize: "13px" }}>
                      Account holder: {employee.bankAccountHolder?.trim() ? employee.bankAccountHolder : "Not captured"}
                    </div>
                    <div style={{ color: "#475569", marginTop: "4px", fontSize: "13px" }}>
                      Account no.: {employee.bankAccountNumber?.trim() ? employee.bankAccountNumber : "Not captured"}
                    </div>
                    <div style={{ color: "#475569", marginTop: "4px", fontSize: "13px" }}>
                      Branch code: {employee.bankBranchCode?.trim() ? employee.bankBranchCode : "Not captured"}
                    </div>
                    <div style={{ color: "#0f172a", marginTop: "8px" }}>
                      Basic salary: {fmtMoney(num(employee.basicSalary))}
                    </div>
                    <div style={{ color: "#475569", marginTop: "4px", fontSize: "13px" }}>
                      Pension: {fmtMoney(num(employee.employeePension))} · Medical (employee):{" "}
                      {fmtMoney(num(employee.employeeMedicalAid))} · Medical (employer):{" "}
                      {fmtMoney(num(employee.employerMedicalAid))}
                    </div>
                    <div style={{ color: "#475569", marginTop: "4px", fontSize: "13px" }}>
                      Overtime: {num(employee.overtimeHours).toFixed(2)} h @ {fmtMoney(num(employee.overtimeRate))} / hr
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #e5e7eb",
  fontSize: "14px",
  lineHeight: 1.35,
  outline: "none",
  boxSizing: "border-box",
  minHeight: "40px",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "8px",
  border: "none",
  background: "#0f172a",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid #0f172a",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

/** Payroll results block — aligned with SchoolDashboard learner table cards */
const payrollResultsSectionCard: React.CSSProperties = {
  marginTop: "24px",
  background: "#ffffff",
  borderRadius: "18px",
  padding: "16px",
  border: "1px solid rgba(15, 23, 42, 0.06)",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
  overflow: "hidden",
};

const payrollResultsTableContainer: React.CSSProperties = {
  marginTop: "8px",
  background: "#ffffff",
  borderRadius: "12px",
  padding: "20px",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
};

const payrollTh: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
};

const payrollTdShared: React.CSSProperties = {
  padding: "14px 16px",
  verticalAlign: "middle",
  borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
  background: "#ffffff",
};

const payrollTdName: React.CSSProperties = {
  ...payrollTdShared,
  fontWeight: 600,
  color: "#0f172a",
};

const payrollTdMoney: React.CSSProperties = {
  ...payrollTdShared,
  textAlign: "right",
  color: "#475569",
  fontWeight: 500,
};

const payrollTdNet: React.CSSProperties = {
  ...payrollTdShared,
  textAlign: "right",
  fontWeight: 800,
  color: "#020617",
};

const payrollTdAction: React.CSSProperties = {
  ...payrollTdShared,
  textAlign: "center",
};

const payslipDownloadButtonStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: "8px",
  border: "none",
  background: "#0f172a",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  lineHeight: 1.25,
};

const payslipEmailButtonStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: "8px",
  border: "1px solid #0f172a",
  background: "#ffffff",
  color: "#0f172a",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  lineHeight: 1.25,
};

const bookkeeperEmailButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "none",
  background: "#0f172a",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const bookkeeperButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid #0f172a",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
