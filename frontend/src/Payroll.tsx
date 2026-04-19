import { useCallback, useEffect, useState } from "react";
import jsPDF from "jspdf";

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
  logoUrl: string | null;
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

export default function Payroll() {
  const [schoolId, setSchoolId] = useState("");
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

  const fetchSchoolInfo = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const response = await fetch(`http://localhost:3000/api/payroll/school/${sid}`);
      if (!response.ok) {
        setSchoolInfo(null);
        return;
      }
      const data = await response.json();
      setSchoolInfo(data);
    } catch {
      setSchoolInfo(null);
    }
  }, []);

  const generatePayslip = useCallback(
    async (result: PayrollResult) => {
      const emp = employees.find((e) => e.id === result.employeeId);
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 16;
      let y = margin;

      const m = lastPayrollMonth ?? new Date().getMonth() + 1;
      const yrr = lastPayrollYear ?? new Date().getFullYear();
      const periodLabel = `${MONTH_NAMES[Math.min(12, Math.max(1, m)) - 1]} ${yrr}`;

      let logoBottom = y;
      if (schoolInfo?.logoUrl) {
        const loaded = await loadImageDataUrl(schoolInfo.logoUrl);
        if (loaded) {
          try {
            const lw = 42;
            const lh = 14;
            doc.addImage(loaded.data, loaded.format, margin, y, lw, lh);
            logoBottom = y + lh + 2;
          } catch {
            /* ignore logo errors */
          }
        }
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      const headerX = Math.min(margin + 48, pageW - margin - 60);
      doc.text(safeText(schoolInfo?.name, "Employer"), headerX, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      let hy = y + 9;
      if (schoolInfo?.email) {
        doc.text(`Email: ${schoolInfo.email}`, headerX, hy);
        hy += 4;
      }
      if (schoolInfo?.phone) {
        doc.text(`Phone: ${schoolInfo.phone}`, headerX, hy);
        hy += 4;
      }
      doc.text("Address: Not captured", headerX, hy);

      y = Math.max(logoBottom, hy + 2);

      doc.setDrawColor(200);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Payslip", margin, y);
      y += 7;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Pay period: ${periodLabel}`, margin, y);
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Employee details", margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const fullName = safeText(emp?.fullName || result.employeeName);
      const rows: [string, string][] = [
        ["Full name", fullName],
        ["Employee number", safeText(emp?.employeeNumber ?? result.employeeNumber)],
        ["ID number", safeText(emp?.idNumber)],
        ["Tax number", safeText(emp?.taxNumber)],
        ["Job title", safeText(emp?.jobTitle ?? result.jobTitle)],
        ["Physical address", safeText(emp?.physicalAddress)],
        ["Bank name", safeText(emp?.bankName)],
        ["Account holder", safeText(emp?.bankAccountHolder)],
        ["Account number", safeText(emp?.bankAccountNumber)],
        ["Branch code", safeText(emp?.bankBranchCode)],
      ];
      const labelW = 48;
      for (const [label, val] of rows) {
        doc.setFont("helvetica", "bold");
        doc.text(`${label}:`, margin, y);
        doc.setFont("helvetica", "normal");
        const lines = doc.splitTextToSize(val, pageW - margin * 2 - labelW - 4);
        doc.text(lines, margin + labelW, y);
        y += Math.max(5, lines.length * 4.2);
      }
      y += 4;

      const empMed = num(result.medicalAidEmployee);
      const emplMed = num(result.medicalAidEmployer);
      const otPay = num(result.overtimePay);
      const basic = num(result.basicSalary);
      const gross = num(result.grossEarnings);
      const paye = num(result.paye);
      const uif = num(result.uif);
      const pension = num(result.pension);
      const totDed = num(result.deductions);
      const net = num(result.net);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Earnings", margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const earnRows: [string, number][] = [
        ["Basic salary", basic],
        ["Overtime pay", otPay],
      ];
      if (emplMed > 0) {
        earnRows.push(["Medical aid (employer contribution)", emplMed]);
      }
      const earnXAmt = pageW - margin - 32;
      for (const [lab, amt] of earnRows) {
        doc.text(lab, margin, y);
        doc.text(fmtMoney(amt), earnXAmt, y, { align: "right" });
        y += 5;
      }
      doc.setDrawColor(180);
      doc.line(margin, y + 1, pageW - margin, y + 1);
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.text("Gross earnings", margin, y);
      doc.text(fmtMoney(gross), earnXAmt, y, { align: "right" });
      y += 10;

      doc.text("Deductions", margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      const dedRows: [string, number][] = [
        ["PAYE", paye],
        ["UIF", uif],
        ["Pension", pension],
      ];
      if (empMed > 0) {
        dedRows.push(["Medical aid (employee)", empMed]);
      }
      for (const [lab, amt] of dedRows) {
        doc.text(lab, margin, y);
        doc.text(fmtMoney(amt), earnXAmt, y, { align: "right" });
        y += 5;
      }
      doc.setDrawColor(180);
      doc.line(margin, y + 1, pageW - margin, y + 1);
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.text("Total deductions", margin, y);
      doc.text(fmtMoney(totDed), earnXAmt, y, { align: "right" });
      y += 12;

      doc.setFillColor(241, 245, 249);
      doc.rect(margin, y - 5, pageW - 2 * margin, 14, "F");
      doc.setFontSize(12);
      doc.text("Net pay", margin + 3, y + 3);
      doc.text(fmtMoney(net), pageW - margin - 3, y + 3, { align: "right" });

      const fileBase = `${sanitizeFilePart(result.employeeName)}-Payslip-${yrr}-${String(m).padStart(2, "0")}`;
      doc.save(`${fileBase}.pdf`);
    },
    [employees, schoolInfo, lastPayrollMonth, lastPayrollYear]
  );

  useEffect(() => {
    const savedSchoolId = localStorage.getItem("schoolId") || "";
    setSchoolId(savedSchoolId);
    if (savedSchoolId) {
      fetchEmployees(savedSchoolId);
      fetchSchoolInfo(savedSchoolId);
    }
  }, [fetchSchoolInfo]);

  async function fetchEmployees(currentSchoolId: string) {
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:3000/api/payroll/employees/${currentSchoolId}`);
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
      const response = await fetch("http://localhost:3000/api/payroll/employee", {
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
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const response = await fetch("http://localhost:3000/api/payroll/run", {
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
            <form onSubmit={handleAddEmployee} style={{ display: "grid", gap: "14px" }}>
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
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
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
              <div
                style={{
                  marginTop: "24px",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "16px",
                  padding: "24px",
                }}
              >
                <h2 style={{ marginTop: 0 }}>Payroll Results</h2>

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

                <div style={{ display: "grid", gap: "12px" }}>
                  {payrollResults.map((item) => (
                    <div
                      key={item.employeeId}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        padding: "16px",
                        background: "#f8fafc",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: "18px" }}>{item.employeeName}</div>
                      {item.employeeNumber ? (
                        <div style={{ marginTop: "4px", color: "#475569", fontSize: "14px" }}>
                          Employee no. {item.employeeNumber}
                        </div>
                      ) : null}
                      {item.jobTitle ? (
                        <div style={{ marginTop: "2px", color: "#475569", fontSize: "14px" }}>{item.jobTitle}</div>
                      ) : null}

                      <div style={{ marginTop: "12px", display: "grid", gap: "4px", color: "#334155", fontSize: "14px" }}>
                        <div>Gross earnings: {fmtMoney(item.grossEarnings)}</div>
                        <div>Basic salary: {fmtMoney(item.basicSalary)}</div>
                        <div>Overtime hours: {num(item.overtimeHours).toFixed(2)}</div>
                        <div>Overtime rate: {fmtMoney(item.overtimeRate)}</div>
                        <div>Overtime pay: {fmtMoney(item.overtimePay)}</div>
                        <div>Medical aid (employee): {fmtMoney(num(item.medicalAidEmployee))}</div>
                        <div>Medical aid (employer): {fmtMoney(num(item.medicalAidEmployer))}</div>
                        <div>Pension: {fmtMoney(item.pension)}</div>
                        <div>PAYE: {fmtMoney(item.paye)}</div>
                        <div>UIF: {fmtMoney(item.uif)}</div>
                        <div style={{ fontWeight: 600 }}>Total deductions: {fmtMoney(item.deductions)}</div>
                        <div style={{ marginTop: "6px", fontWeight: 700, color: "#0f172a", fontSize: "16px" }}>
                          Net pay: {fmtMoney(item.net)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void generatePayslip(item)}
                        style={{
                          marginTop: "12px",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "none",
                          background: "#111827",
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        Download Payslip
                      </button>
                    </div>
                  ))}
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
                    {employee.employeeNumber ? (
                      <div style={{ color: "#475569", marginTop: "4px", fontSize: "14px" }}>
                        Employee no. {employee.employeeNumber}
                      </div>
                    ) : null}
                    {employee.jobTitle ? (
                      <div style={{ color: "#475569", marginTop: "2px", fontSize: "14px" }}>{employee.jobTitle}</div>
                    ) : null}
                    <div style={{ color: "#475569", marginTop: "6px" }}>{employee.email || "No email"}</div>
                    <div style={{ color: "#475569", marginTop: "6px" }}>
                      Address: {employee.physicalAddress?.trim() ? employee.physicalAddress : "Not captured"}
                    </div>
                    <div style={{ color: "#475569", marginTop: "6px" }}>
                      ID Number: {employee.idNumber || "Not captured"}
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
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  fontSize: "15px",
  outline: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: "10px",
  border: "none",
  background: "#0f172a",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: "10px",
  border: "1px solid #0f172a",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
};
