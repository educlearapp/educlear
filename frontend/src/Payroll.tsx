import React, { useCallback, useEffect, useMemo, useState } from "react";



import jsPDF from "jspdf";



import { API_URL } from "./api";



import { useSchoolId } from "./useSchoolId";



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



  const pension = num(emp.employeePension);



  const medicalAidEmployee = num(emp.employeeMedicalAid);



  const medicalAidEmployer = num(emp.employerMedicalAid);



  const extraDeduction = num(adj.extraDeduction);



  const gross =



    basicSalary +



    overtimePay +



    bonus +



    medicalAidEmployer;



  const paye = calculatePAYE(gross);



  const uif = Math.min(gross * 0.01, 177.12);



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



      }



    );



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



    const rows = employees.map((emp) =>



      calculatePayroll(emp, getAdjustment(emp.id))



    );



    setResults(rows);



    setMessage(



      `Payroll completed successfully for ${rows.length} staff members.`



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



                      <button style={btn}>



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



    </div>



  );



}