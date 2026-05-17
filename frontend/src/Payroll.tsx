import React, { useCallback, useEffect, useMemo, useState } from "react";



import jsPDF from "jspdf";



import { API_URL } from "./api";



import { useSchoolId } from "./useSchoolId";
import { ACCOUNTING_COA_UPDATED_EVENT } from "./accounting/accountingPayrollCoa";
import { repairPayrollCoaForSchool } from "./accounting/AccountingChartOfAccounts";
import { ACCOUNTING_JOURNALS_UPDATED_EVENT } from "./accounting/accountingJournalStorage";
import {
  ACCOUNTING_PAYROLL_UPDATED_EVENT,
  findPostedPayrollJournal,
  getPayrollRun,
  postPayrollRunToAccounting,
  reconcilePayrollRunWithJournal,
  upsertDraftPayrollRun,
  validatePayrollCoaForPosting,
} from "./accounting/accountingPayrollIntegration";



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



  jobTitle?: string | null;



  employeePension?: number | string | null;



  employeeMedicalAid?: number | string | null;



  employerMedicalAid?: number | string | null;



  overtimeHours?: number | string | null;



  overtimeRate?: number | string | null;



};



type PayrollAdjustment = {



  overtimeHours: number;



  overtimeRate: number;



  bonus: number;



  extraDeduction: number;



  allowances?: number;



  payeOverride?: number | null;



  uifOverride?: number | null;



  notes?: string;



};



type PayrollEditDraft = {



  basicSalary: string;



  overtimeHours: string;



  overtimeRate: string;



  bonus: string;



  extraDeduction: string;



  allowances: string;



  pension: string;



  medicalAid: string;



  payeOverride: string;



  uifOverride: string;



  notes: string;



};



type PayrollRow = {



  employeeId: string;



  employeeName: string;



  employeeNumber: string;



  email: string;



  idNumber: string;



  taxNumber: string;



  jobTitle: string;



  gross: number;



  deductions: number;



  net: number;



  paye: number;



  uif: number;



  pension: number;



  medicalAidEmployee: number;



  medicalAidEmployer: number;



  overtimePay: number;



  bonus: number;



  basicSalary: number;



  extraDeduction: number;



};



const MONTHS = [



  "January","February","March","April","May","June",



  "July","August","September","October","November","December"



];



function num(v: unknown): number {



  const n = Number(v ?? 0);



  return Number.isFinite(n) ? n : 0;



}



function money(v: unknown): string {



  return `R ${num(v).toLocaleString("en-ZA", {



    minimumFractionDigits: 2,



    maximumFractionDigits: 2,



  })}`;



}



function safe(v: unknown, fallback = "Not captured"): string {



  const s = String(v ?? "").trim();



  return s || fallback;



}



function employeeName(emp: Employee): string {



  return safe(



    emp.fullName || `${safe(emp.firstName, "")} ${safe(emp.lastName, "")}`.trim(),



    "Unnamed Employee"



  );



}



function employeeAllowances(emp: Employee): number {



  const row = emp as Employee & {



    fixedHousingAllowance?: number | string | null;



    fixedTransportAllowance?: number | string | null;



    fixedCellphoneAllowance?: number | string | null;



    fixedOtherAllowance?: number | string | null;



  };



  return (



    num(row.fixedHousingAllowance) +



    num(row.fixedTransportAllowance) +



    num(row.fixedCellphoneAllowance) +



    num(row.fixedOtherAllowance)



  );



}



/* SARS 2026/2027 */



function calculatePAYE(monthlyGross: number): number {



  const annual = monthlyGross * 12;



  let annualTax = 0;



  if (annual <= 245100) {



    annualTax = annual * 0.18;



  } else if (annual <= 383100) {



    annualTax = 44118 + (annual - 245100) * 0.26;



  } else if (annual <= 530200) {



    annualTax = 79998 + (annual - 383100) * 0.31;



  } else if (annual <= 695800) {



    annualTax = 125599 + (annual - 530200) * 0.36;



  } else if (annual <= 887000) {



    annualTax = 185215 + (annual - 695800) * 0.39;



  } else if (annual <= 1878600) {



    annualTax = 259783 + (annual - 887000) * 0.41;



  } else {



    annualTax = 666339 + (annual - 1878600) * 0.45;



  }



  const primaryRebate = 17820;



  return Math.max((annualTax - primaryRebate) / 12, 0);



}



function calculatePayroll(



  emp: Employee,



  adj: PayrollAdjustment



): PayrollRow {



  const basicSalary = num(emp.basicSalary);



  const overtimePay =



    num(adj.overtimeHours) * num(adj.overtimeRate);



  const bonus = num(adj.bonus);



  const allowances = num(adj.allowances);



  const pension = num(emp.employeePension);



  const medicalAidEmployee = num(emp.employeeMedicalAid);



  const medicalAidEmployer = num(emp.employerMedicalAid);



  const extraDeduction = num(adj.extraDeduction);



  const gross =



    basicSalary +



    overtimePay +



    bonus +



    allowances +



    medicalAidEmployer;



  let paye = calculatePAYE(gross);



  if (adj.payeOverride != null && Number.isFinite(Number(adj.payeOverride))) {



    paye = num(adj.payeOverride);



  }



  let uif = Math.min(gross * 0.01, 177.12);



  if (adj.uifOverride != null && Number.isFinite(Number(adj.uifOverride))) {



    uif = num(adj.uifOverride);



  }



  const deductions =



    paye +



    uif +



    pension +



    medicalAidEmployee +



    extraDeduction;



  const net = gross - deductions;



  return {



    employeeId: emp.id,



    employeeName: employeeName(emp),



    employeeNumber: safe(emp.employeeNumber),



    email: safe(emp.email, ""),



    idNumber: safe(emp.idNumber),



    taxNumber: safe(emp.taxNumber),



    jobTitle: safe(emp.jobTitle),



    gross,



    deductions,



    net,



    paye,



    uif,



    pension,



    medicalAidEmployee,



    medicalAidEmployer,



    overtimePay,



    bonus,



    basicSalary,



    extraDeduction,



  };



}



export default function Payroll() {



  const schoolId = useSchoolId();



  const [employees, setEmployees] = useState<Employee[]>([]);



  const [loading, setLoading] = useState(false);



  const [search, setSearch] = useState("");



  const [results, setResults] = useState<PayrollRow[]>([]);



  const [message, setMessage] = useState("");



  const [bookkeeperEmail, setBookkeeperEmail] = useState("");



  const [adjustments, setAdjustments] = useState<



    Record<string, PayrollAdjustment>



  >({});

  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);

  const [editDraft, setEditDraft] = useState<PayrollEditDraft | null>(null);

  const [currentPayrollRunId, setCurrentPayrollRunId] = useState("");
  const [accountingMessage, setAccountingMessage] = useState("");
  const [payImmediately, setPayImmediately] = useState(false);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [accountingSyncTick, setAccountingSyncTick] = useState(0);



  const period = `${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`;



  const loadEmployees = useCallback(async () => {



    if (!schoolId) return;



    try {



      setLoading(true);



      const response = await fetch(



        `${API_URL}/api/payroll/employees/${schoolId}`



      );



      const data = await response.json();



      if (Array.isArray(data)) {



        setEmployees(data);



      } else {



        setEmployees([]);



      }



    } catch {



      setEmployees([]);



    } finally {



      setLoading(false);



    }



  }, [schoolId]);



  useEffect(() => {



    loadEmployees();



  }, [loadEmployees]);



  const filteredEmployees = useMemo(() => {



    const q = search.toLowerCase();



    if (!q) return employees;



    return employees.filter((e) =>



      `${e.firstName} ${e.lastName} ${e.email ?? ""}`



        .toLowerCase()



        .includes(q)



    );



  }, [employees, search]);



  const totals = useMemo(() => {



    return {



      gross: results.reduce((s, r) => s + r.gross, 0),



      deductions: results.reduce((s, r) => s + r.deductions, 0),



      net: results.reduce((s, r) => s + r.net, 0),



    };



  }, [results]);



  function getAdjustment(id: string): PayrollAdjustment {



    return (



      adjustments[id] || {



        overtimeHours: 0,



        overtimeRate: 0,



        bonus: 0,



        extraDeduction: 0,



        allowances: 0,



      }



    );



  }



  const editingEmployee = useMemo(



    () => employees.find((e) => e.id === editingEmployeeId) || null,



    [employees, editingEmployeeId]



  );



  function buildPayrollRows(



    employeeList: Employee[],



    adjustmentMap: Record<string, PayrollAdjustment>



  ): PayrollRow[] {



    return employeeList.map((emp) =>



      calculatePayroll(emp, adjustmentMap[emp.id] || getAdjustment(emp.id))



    );



  }



  function syncResultsFromState(



    employeeList: Employee[],



    adjustmentMap: Record<string, PayrollAdjustment>



  ) {



    if (!results.length) return;



    const rows = buildPayrollRows(employeeList, adjustmentMap);



    setResults(rows);



    if (schoolId) {



      const draft = upsertDraftPayrollRun({



        schoolId,



        period,



        rows,



        payrollRunId: currentPayrollRunId || undefined,



      });



      setCurrentPayrollRunId(draft.payrollRunId);



    }



  }



  function openEditEmployee(emp: Employee) {



    const adj = getAdjustment(emp.id);



    setEditingEmployeeId(emp.id);



    setEditDraft({



      basicSalary: String(num(emp.basicSalary)),



      overtimeHours: String(adj.overtimeHours),



      overtimeRate: String(adj.overtimeRate || num(emp.overtimeRate)),



      bonus: String(adj.bonus),



      extraDeduction: String(adj.extraDeduction),



      allowances: String(num(adj.allowances) || employeeAllowances(emp)),



      pension: String(num(emp.employeePension)),



      medicalAid: String(num(emp.employeeMedicalAid)),



      payeOverride: adj.payeOverride != null ? String(adj.payeOverride) : "",



      uifOverride: adj.uifOverride != null ? String(adj.uifOverride) : "",



      notes: String(adj.notes || ""),



    });



  }



  function closeEditEmployee() {



    setEditingEmployeeId(null);



    setEditDraft(null);



  }



  function saveEditEmployee() {



    if (!editingEmployeeId || !editDraft) return;



    const id = editingEmployeeId;



    const payeOverrideRaw = editDraft.payeOverride.trim();



    const uifOverrideRaw = editDraft.uifOverride.trim();



    const nextEmployees = employees.map((emp) =>



      emp.id === id



        ? {



            ...emp,



            basicSalary: num(editDraft.basicSalary),



            employeePension: num(editDraft.pension),



            employeeMedicalAid: num(editDraft.medicalAid),



          }



        : emp



    );



    const nextAdjustments: Record<string, PayrollAdjustment> = {



      ...adjustments,



      [id]: {



        ...getAdjustment(id),



        overtimeHours: num(editDraft.overtimeHours),



        overtimeRate: num(editDraft.overtimeRate),



        bonus: num(editDraft.bonus),



        extraDeduction: num(editDraft.extraDeduction),



        allowances: num(editDraft.allowances),



        payeOverride: payeOverrideRaw === "" ? null : num(payeOverrideRaw),



        uifOverride: uifOverrideRaw === "" ? null : num(uifOverrideRaw),



        notes: editDraft.notes.trim(),



      },



    };



    setEmployees(nextEmployees);



    setAdjustments(nextAdjustments);



    syncResultsFromState(nextEmployees, nextAdjustments);



    closeEditEmployee();



  }



  function updateAdjustment(



    id: string,



    key: keyof PayrollAdjustment,



    value: number



  ) {



    setAdjustments((prev) => ({



      ...prev,



      [id]: {



        ...getAdjustment(id),



        [key]: value,



      },



    }));



  }



  function runPayroll() {



    const rows = buildPayrollRows(employees, adjustments);



    setResults(rows);



    setMessage(



      `Payroll completed successfully for ${rows.length} staff members.`



    );

    if (schoolId) {
      const draft = upsertDraftPayrollRun({
        schoolId,
        period,
        rows,
        payrollRunId: currentPayrollRunId || undefined,
      });
      setCurrentPayrollRunId(draft.payrollRunId);
      setAccountingMessage(`Accounting: Draft saved for ${period}. Post to Accounting when ready.`);
    }



  }

  useEffect(() => {
    if (!schoolId) return;
    const bump = () => setAccountingSyncTick((n) => n + 1);
    const onPayroll = (event: Event) => {
      const detail = (event as CustomEvent<{ schoolId?: string }>).detail;
      if (detail?.schoolId && detail.schoolId !== schoolId) return;
      bump();
    };
    window.addEventListener(ACCOUNTING_PAYROLL_UPDATED_EVENT, onPayroll);
    window.addEventListener(ACCOUNTING_JOURNALS_UPDATED_EVENT, onPayroll);
    return () => {
      window.removeEventListener(ACCOUNTING_PAYROLL_UPDATED_EVENT, onPayroll);
      window.removeEventListener(ACCOUNTING_JOURNALS_UPDATED_EVENT, onPayroll);
    };
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !currentPayrollRunId) return;
    reconcilePayrollRunWithJournal(schoolId, currentPayrollRunId);
    setAccountingSyncTick((n) => n + 1);
  }, [schoolId, currentPayrollRunId, results.length]);

  useEffect(() => {
    if (!schoolId) return;
    repairPayrollCoaForSchool(schoolId);
    setAccountingSyncTick((n) => n + 1);
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const onCoaUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ schoolId?: string }>).detail;
      if (detail?.schoolId && detail.schoolId !== schoolId) return;
      setAccountingSyncTick((n) => n + 1);
    };
    window.addEventListener(ACCOUNTING_COA_UPDATED_EVENT, onCoaUpdated);
    return () => window.removeEventListener(ACCOUNTING_COA_UPDATED_EVENT, onCoaUpdated);
  }, [schoolId]);

  const postedPayrollJournal = useMemo(() => {
    if (!schoolId || !currentPayrollRunId) return null;
    return findPostedPayrollJournal(schoolId, currentPayrollRunId);
  }, [schoolId, currentPayrollRunId, accountingSyncTick]);

  const hasPostedPayrollJournal = Boolean(postedPayrollJournal);

  const currentAccountingRun = useMemo(() => {
    if (!schoolId || !currentPayrollRunId) return null;
    return getPayrollRun(schoolId, currentPayrollRunId);
  }, [schoolId, currentPayrollRunId, accountingSyncTick]);

  const payrollJournalNo = postedPayrollJournal?.journalNo || currentAccountingRun?.journalNo || "";

  const payrollAccountingStatus: "Draft" | "Posted" = hasPostedPayrollJournal
    ? "Posted"
    : currentAccountingRun?.status === "Posted"
      ? "Posted"
      : "Draft";

  const coaValidation = useMemo(() => {
    if (!schoolId || hasPostedPayrollJournal) return { ok: true, message: "" };
    return validatePayrollCoaForPosting(schoolId, payImmediately);
  }, [schoolId, payImmediately, hasPostedPayrollJournal, accountingSyncTick]);

  useEffect(() => {
    if (!hasPostedPayrollJournal || !payrollJournalNo) return;
    setAccountingMessage((prev) => {
      const lower = prev.toLowerCase();
      if (
        lower.includes("not found") ||
        lower.includes("missing required") ||
        lower.includes("post payroll to accounting first")
      ) {
        return `Posted to Accounting · Journal ${payrollJournalNo} · AUTO · Source Payroll`;
      }
      return prev;
    });
  }, [hasPostedPayrollJournal, payrollJournalNo]);

  async function handlePostPayrollToAccounting() {
    if (!schoolId || !currentPayrollRunId) {
      setAccountingMessage("Run payroll first to create an accounting draft.");
      return;
    }
    if (hasPostedPayrollJournal) {
      setAccountingMessage(
        `Already posted · Journal ${payrollJournalNo || postedPayrollJournal?.journalNo || ""}`
      );
      return;
    }
    const preCheck = validatePayrollCoaForPosting(schoolId, payImmediately);
    if (!preCheck.ok) return;
    setAccountingBusy(true);
    setAccountingMessage("");
    try {
      const { result, run } = postPayrollRunToAccounting({
        schoolId,
        payrollRunId: currentPayrollRunId,
        paidImmediately: payImmediately,
        createdBy: "Payroll",
      });
      setAccountingSyncTick((n) => n + 1);
      if (result.ok) {
        setAccountingMessage(
          `Posted to Accounting · Journal ${result.journalNo} · AUTO · Source Payroll`
        );
      } else if (result.duplicate) {
        setAccountingMessage(
          `Already posted${result.journalNo ? ` · Journal ${result.journalNo}` : ""}.`
        );
      } else {
        setAccountingMessage(result.reason || "Could not post payroll to accounting.");
      }
      if (run?.payrollRunId) setCurrentPayrollRunId(run.payrollRunId);
    } finally {
      setAccountingBusy(false);
    }
  }

  function handleViewPayrollJournal() {
    if (!hasPostedPayrollJournal || !postedPayrollJournal) return;
    const journalNo = postedPayrollJournal.journalNo;
    window.alert(
      `Payroll journal ${journalNo} (Source: Payroll, AUTO).\n\nOpen Accounting → Journals and search for this journal number.`
    );
  }



  function createPayslipPdf(row: PayrollRow): jsPDF {



    const doc = new jsPDF();



    const pageW = doc.internal.pageSize.getWidth();



    doc.setFillColor(15, 23, 42);



    doc.rect(0, 0, pageW, 32, "F");



    doc.setTextColor(212, 175, 55);



    doc.setFont("helvetica", "bold");



    doc.setFontSize(22);



    doc.text("EduClear Payroll", 14, 18);



    doc.setFontSize(13);



    doc.text("PAYSLIP", pageW - 14, 18, {



      align: "right",



    });



    doc.setTextColor(17, 24, 39);



    doc.setFontSize(14);



    doc.text(row.employeeName, 14, 48);



    doc.setFontSize(9);



    doc.text(`Period: ${period}`, 14, 56);



    doc.text(`Employee Number: ${row.employeeNumber}`, 14, 62);



    doc.text(`ID Number: ${row.idNumber}`, 14, 68);



    doc.text(`Tax Number: ${row.taxNumber}`, 14, 74);



    doc.text(`Position: ${row.jobTitle}`, 14, 80);



    let y = 100;



    const line = (



      label: string,



      value: string,



      bold = false



    ) => {



      doc.setFont("helvetica", bold ? "bold" : "normal");



      doc.text(label, 18, y);



      doc.text(value, pageW - 18, y, {



        align: "right",



      });



      y += 8;



    };



    doc.setFont("helvetica", "bold");



    doc.text("Earnings", 18, y);



    y += 10;



    line("Basic Salary", money(row.basicSalary));



    line("Overtime", money(row.overtimePay));



    line("Bonus", money(row.bonus));



    line(



      "Employer Medical Aid",



      money(row.medicalAidEmployer)



    );



    line("Gross Earnings", money(row.gross), true);



    y += 8;



    doc.setFont("helvetica", "bold");



    doc.text("Deductions", 18, y);



    y += 10;



    line("PAYE", money(row.paye));



    line("UIF", money(row.uif));



    line("Pension", money(row.pension));



    line(



      "Medical Aid Employee",



      money(row.medicalAidEmployee)



    );



    line(



      "Extra Deduction",



      money(row.extraDeduction)



    );



    line("Total Deductions", money(row.deductions), true);



    y += 10;



    doc.setFillColor(15, 23, 42);



    doc.rect(14, y, pageW - 28, 16, "F");



    doc.setTextColor(255, 255, 255);



    doc.setFont("helvetica", "bold");



    doc.setFontSize(13);



    doc.text("NET PAY", 20, y + 10);



    doc.text(money(row.net), pageW - 20, y + 10, {



      align: "right",



    });



    doc.setTextColor(140, 140, 140);



    doc.setFontSize(8);



    doc.text(



      "Payroll processed by EduClear",



      pageW / 2,



      286,



      {



        align: "center",



      }



    );



    return doc;



  }



  function downloadPayslip(row: PayrollRow) {



    createPayslipPdf(row).save(



      `${row.employeeName}-Payslip.pdf`



    );



  }



  function emailPayslip(row: PayrollRow) {



    if (!row.email) {



      alert("Employee has no email address.");



      return;



    }



    alert(



      `Payslip ready to email to ${row.email}.`



    );



  }



  function downloadBookkeeperReport() {



    if (!results.length) {



      alert("Run payroll first.");



      return;



    }



    const doc = new jsPDF({



      orientation: "landscape",



    });



    const pageW = doc.internal.pageSize.getWidth();



    doc.setFillColor(15, 23, 42);



    doc.rect(0, 0, pageW, 28, "F");



    doc.setTextColor(212, 175, 55);



    doc.setFont("helvetica", "bold");



    doc.setFontSize(18);



    doc.text(



      "EduClear Payroll Bookkeeper Report",



      12,



      18



    );



    doc.setTextColor(17, 24, 39);



    doc.setFontSize(10);



    doc.text(`Period: ${period}`, 12, 40);



    let y = 54;



    const cols = [12, 62, 100, 142, 182, 222, 258];



    const headers = [



      "Staff Name",



      "ID Number",



      "Tax No",



      "Gross Salary",



      "Net Salary",



      "Deductions",



      "Email",



    ];



    doc.setFont("helvetica", "bold");



    headers.forEach((h, i) => {



      doc.text(h, cols[i], y);



    });



    y += 8;



    doc.setFont("helvetica", "normal");



    results.forEach((r) => {



      doc.text(r.employeeName.slice(0, 28), cols[0], y);



      doc.text(r.idNumber.slice(0, 18), cols[1], y);



      doc.text(r.taxNumber.slice(0, 18), cols[2], y);



      doc.text(money(r.gross), cols[3], y);



      doc.text(money(r.net), cols[4], y);



      doc.text(money(r.deductions), cols[5], y);



      doc.text(r.email.slice(0, 28), cols[6], y);



      y += 8;



    });



    y += 10;



    doc.setFont("helvetica", "bold");



    doc.text(



      `Total Gross: ${money(totals.gross)}`,



      12,



      y



    );



    doc.text(



      `Total Net: ${money(totals.net)}`,



      100,



      y



    );



    doc.text(



      `Total Deductions: ${money(totals.deductions)}`,



      190,



      y



    );



    doc.save(`Bookkeeper-Report-${period}.pdf`);



  }



  function emailBookkeeperReport() {



    if (!bookkeeperEmail.trim()) {



      alert("Enter bookkeeper email.");



      return;



    }



    alert(



      `Bookkeeper report ready to email to ${bookkeeperEmail}.`



    );



  }



  const card: React.CSSProperties = {



    background: "#ffffff",



    border: "1px solid #d6c17a",



    borderRadius: 18,



    overflow: "hidden",



    boxShadow: "0 14px 35px rgba(17,24,39,0.08)",



  };



  const header: React.CSSProperties = {



    background: "#111827",



    color: "#d4af37",



    padding: "14px 18px",



    fontWeight: 900,



    fontSize: 20,



  };



  const btn: React.CSSProperties = {



    border: "1px solid #d4af37",



    background: "#ffffff",



    color: "#111827",



    borderRadius: 12,



    padding: "9px 14px",



    fontWeight: 800,



    cursor: "pointer",



  };



  const goldBtn: React.CSSProperties = {



    ...btn,



    background: "#d4af37",



  };



  const input: React.CSSProperties = {



    border: "1px solid #d4af37",



    borderRadius: 10,



    padding: "9px 12px",



    fontWeight: 700,



    minHeight: 38,



  };



  return (



    <div



      style={{



        padding: 28,



        background: "#f6f4ef",



        minHeight: "100vh",



      }}



    >



      <h1



        style={{



          margin: 0,



          fontSize: 36,



          fontWeight: 900,



          color: "#111827",



        }}



      >



        Payroll



        <span



          style={{



            color: "#64748b",



            fontSize: 22,



            fontWeight: 600,



          }}



        >



          {" "}



          » Payroll management



        </span>



      </h1>



      <div



        style={{



          display: "grid",



          gridTemplateColumns: "repeat(4, 1fr)",



          gap: 14,



          margin: "22px 0",



        }}



      >



        {[



          ["Employees", employees.length],



          ["Gross", money(totals.gross)],



          ["Deductions", money(totals.deductions)],



          ["Net", money(totals.net)],



        ].map(([label, value]) => (



          <div key={String(label)} style={{ ...card, padding: 16 }}>



            <div



              style={{



                fontSize: 24,



                fontWeight: 900,



                color: "#111827",



              }}



            >



              {String(value)}



            </div>



            <div



              style={{



                color: "#64748b",



                fontWeight: 800,



              }}



            >



              {String(label)}



            </div>



          </div>



        ))}



      </div>



      <div style={{ ...card, marginBottom: 22 }}>



        <div style={header}>Payroll Actions</div>



        <div



          style={{



            padding: 16,



            display: "flex",



            gap: 10,



            flexWrap: "wrap",



            alignItems: "center",



          }}



        >



          <button



            style={goldBtn}



            onClick={runPayroll}



          >



            ▶ Run Payroll For All Staff



          </button>



          <button



            style={btn}



            onClick={downloadBookkeeperReport}



          >



            📄 Download Bookkeeper Report



          </button>



          <input



            style={{ ...input, width: 260 }}



            placeholder="Bookkeeper email"



            value={bookkeeperEmail}



            onChange={(e) =>



              setBookkeeperEmail(e.target.value)



            }



          />



          <button



            style={btn}



            onClick={emailBookkeeperReport}



          >



            ✉ Email Bookkeeper Report



          </button>



          <input



            style={{



              ...input,



              width: 260,



              marginLeft: "auto",



            }}



            placeholder="Search employees"



            value={search}



            onChange={(e) =>



              setSearch(e.target.value)



            }



          />



        </div>



        {message && (



          <div



            style={{



              padding: "0 16px 16px",



              color: "#166534",



              fontWeight: 800,



            }}



          >



            {message}



          </div>



        )}



      </div>



      <div style={{ ...card, marginBottom: 22 }}>



        <div style={header}>



          Employees (Pulled From Employees Module)



        </div>



        {loading ? (



          <div style={{ padding: 20 }}>



            Loading employees...



          </div>



        ) : (



          <table



            style={{



              width: "100%",



              borderCollapse: "collapse",



            }}



          >



            <thead>



              <tr style={{ background: "#f8fafc" }}>



                {[



                  "Employee",



                  "Basic Salary",



                  "Overtime",



                  "Bonus",



                  "Extra Deduction",



                  "Action",



                ].map((h) => (



                  <th



                    key={h}



                    style={{



                      padding: 12,



                      textAlign: "left",



                      fontWeight: 900,



                    }}



                  >



                    {h}



                  </th>



                ))}



              </tr>



            </thead>



            <tbody>



              {filteredEmployees.map((emp, index) => {



                const adj = getAdjustment(emp.id);



                return (



                  <tr



                    key={emp.id}



                    style={{



                      background:



                        index % 2 === 0



                          ? "#fffdf7"



                          : "#ffffff",



                    }}



                  >



                    <td style={{ padding: 12 }}>



                      <div style={{ fontWeight: 800 }}>



                        {employeeName(emp)}



                      </div>



                      <div



                        style={{



                          fontSize: 13,



                          color: "#64748b",



                        }}



                      >



                        {safe(emp.jobTitle)}



                      </div>



                    </td>



                    <td style={{ padding: 12 }}>



                      {money(emp.basicSalary)}



                    </td>



                    <td style={{ padding: 12 }}>



                      <div



                        style={{



                          display: "flex",



                          gap: 6,



                        }}



                      >



                        <input



                          type="number"



                          style={{



                            ...input,



                            width: 80,



                          }}



                          placeholder="Hours"



                          value={adj.overtimeHours}



                          onChange={(e) =>



                            updateAdjustment(



                              emp.id,



                              "overtimeHours",



                              num(e.target.value)



                            )



                          }



                        />



                        <input



                          type="number"



                          style={{



                            ...input,



                            width: 90,



                          }}



                          placeholder="Rate"



                          value={adj.overtimeRate}



                          onChange={(e) =>



                            updateAdjustment(



                              emp.id,



                              "overtimeRate",



                              num(e.target.value)



                            )



                          }



                        />



                      </div>



                    </td>



                    <td style={{ padding: 12 }}>



                      <input



                        type="number"



                        style={{



                          ...input,



                          width: 120,



                        }}



                        value={adj.bonus}



                        onChange={(e) =>



                          updateAdjustment(



                            emp.id,



                            "bonus",



                            num(e.target.value)



                          )



                        }



                      />



                    </td>



                    <td style={{ padding: 12 }}>



                      <input



                        type="number"



                        style={{



                          ...input,



                          width: 140,



                        }}



                        value={adj.extraDeduction}



                        onChange={(e) =>



                          updateAdjustment(



                            emp.id,



                            "extraDeduction",



                            num(e.target.value)



                          )



                        }



                      />



                    </td>



                    <td style={{ padding: 12 }}>



                      <button



                        type="button"



                        style={btn}



                        onClick={() => openEditEmployee(emp)}



                      >



                        Edit



                      </button>



                    </td>



                  </tr>



                );



              })}



            </tbody>



          </table>



        )}



      </div>



      {results.length > 0 && schoolId ? (
        <div style={{ ...card, marginBottom: 22 }}>
          <div style={header}>Accounting</div>
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>
              Status: <strong>{payrollAccountingStatus}</strong>
              {payrollJournalNo ? ` · Journal ${payrollJournalNo}` : ""}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={payImmediately}
                onChange={(e) => setPayImmediately(e.target.checked)}
                disabled={hasPostedPayrollJournal}
              />
              Pay net salaries immediately (credit Bank instead of Payroll Payable)
            </label>
            {!hasPostedPayrollJournal && !coaValidation.ok ? (
              <div style={{ fontWeight: 700, color: "#b91c1c", lineHeight: 1.5 }}>{coaValidation.message}</div>
            ) : !hasPostedPayrollJournal && coaValidation.ok ? (
              <div style={{ fontWeight: 700, color: "#15803d" }}>
                Chart of Accounts ready for payroll posting (1000, 2100, 2200, 5000).
              </div>
            ) : null}
            {accountingMessage ? (
              <div
                style={{
                  fontWeight: 700,
                  color: hasPostedPayrollJournal ? "#166534" : "#92400e",
                }}
              >
                {accountingMessage}
              </div>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                style={goldBtn}
                disabled={accountingBusy || hasPostedPayrollJournal || !coaValidation.ok}
                onClick={handlePostPayrollToAccounting}
              >
                {accountingBusy ? "Posting…" : "Post Payroll to Accounting"}
              </button>
              <button
                type="button"
                style={btn}
                onClick={handleViewPayrollJournal}
                disabled={!hasPostedPayrollJournal}
              >
                View Payroll Journal
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {results.length > 0 && (



        <div style={card}>



          <div style={header}>Payroll Results</div>



          <table



            style={{



              width: "100%",



              borderCollapse: "collapse",



            }}



          >



            <thead>



              <tr style={{ background: "#f8fafc" }}>



                {[



                  "Staff",



                  "Gross",



                  "PAYE",



                  "UIF",



                  "Deductions",



                  "Net",



                  "Payslip",



                ].map((h) => (



                  <th



                    key={h}



                    style={{



                      padding: 12,



                      textAlign: "left",



                      fontWeight: 900,



                    }}



                  >



                    {h}



                  </th>



                ))}



              </tr>



            </thead>



            <tbody>



              {results.map((row, index) => (



                <tr



                  key={row.employeeId}



                  style={{



                    background:



                      index % 2 === 0



                        ? "#fffdf7"



                        : "#ffffff",



                  }}



                >



                  <td style={{ padding: 12 }}>



                    <div style={{ fontWeight: 800 }}>



                      {row.employeeName}



                    </div>



                    <div



                      style={{



                        fontSize: 13,



                        color: "#64748b",



                      }}



                    >



                      {row.jobTitle}



                    </div>



                  </td>



                  <td style={{ padding: 12 }}>



                    {money(row.gross)}



                  </td>



                  <td style={{ padding: 12 }}>



                    {money(row.paye)}



                  </td>



                  <td style={{ padding: 12 }}>



                    {money(row.uif)}



                  </td>



                  <td style={{ padding: 12 }}>



                    {money(row.deductions)}



                  </td>



                  <td



                    style={{



                      padding: 12,



                      fontWeight: 900,



                    }}



                  >



                    {money(row.net)}



                  </td>



                  <td



                    style={{



                      padding: 12,



                      display: "flex",



                      gap: 8,



                    }}



                  >



                    <button



                      style={btn}



                      onClick={() =>



                        downloadPayslip(row)



                      }



                    >



                      Download



                    </button>



                    <button



                      style={btn}



                      onClick={() =>



                        emailPayslip(row)



                      }



                    >



                      Email



                    </button>



                  </td>



                </tr>



              ))}



            </tbody>



          </table>



        </div>



      )}



      {editingEmployee && editDraft ? (



        <div



          role="presentation"



          style={{



            position: "fixed",



            inset: 0,



            background: "rgba(15,23,42,0.55)",



            zIndex: 6000,



            display: "flex",



            alignItems: "center",



            justifyContent: "center",



            padding: 20,



          }}



          onClick={closeEditEmployee}



        >



          <div



            style={{



              ...card,



              width: "min(560px, 100%)",



              maxHeight: "90vh",



              overflow: "auto",



            }}



            onClick={(e) => e.stopPropagation()}



          >



            <div style={header}>Edit Payroll — {employeeName(editingEmployee)}</div>



            <div style={{ padding: 20, display: "grid", gap: 12 }}>



              {[



                ["Basic Salary", "basicSalary"],



                ["Overtime Hours", "overtimeHours"],



                ["Overtime Rate", "overtimeRate"],



                ["Bonus", "bonus"],



                ["Extra Deduction", "extraDeduction"],



                ["Allowances", "allowances"],



                ["Pension", "pension"],



                ["Medical Aid", "medicalAid"],



                ["PAYE override (optional)", "payeOverride"],



                ["UIF override (optional)", "uifOverride"],



              ].map(([label, key]) => (



                <label key={key} style={{ display: "grid", gap: 6, fontWeight: 800 }}>



                  {label}



                  <input



                    type="number"



                    style={input}



                    value={editDraft[key as keyof PayrollEditDraft]}



                    onChange={(e) =>



                      setEditDraft((prev) =>



                        prev ? { ...prev, [key]: e.target.value } : prev



                      )



                    }



                  />



                </label>



              ))}



              <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>



                Notes



                <textarea



                  style={{ ...input, minHeight: 80, resize: "vertical" }}



                  value={editDraft.notes}



                  onChange={(e) =>



                    setEditDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))



                  }



                />



              </label>



              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>



                <button type="button" style={goldBtn} onClick={saveEditEmployee}>



                  Save



                </button>



                <button type="button" style={btn} onClick={closeEditEmployee}>



                  Cancel



                </button>



              </div>



            </div>



          </div>



        </div>



      ) : null}



    </div>



  );



}