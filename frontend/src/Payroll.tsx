import { useEffect, useState } from "react";
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



};

type PayrollResult = {



  employeeId: string;



  employeeName: string;



  basicSalary: number;



  paye: number;



  uif: number;



  deductions: number;



  net: number;



};

export default function Payroll() {



  const [schoolId, setSchoolId] = useState("");

  const [payrollResults, setPayrollResults] = useState<PayrollResult[]>([]);

  const [firstName, setFirstName] = useState("");



  const [lastName, setLastName] = useState("");



  const [email, setEmail] = useState("");



  const [idNumber, setIdNumber] = useState("");



  const [taxNumber, setTaxNumber] = useState("");



  const [basicSalary, setBasicSalary] = useState("");



  const [employees, setEmployees] = useState<Employee[]>([]);



  const [loading, setLoading] = useState(false);



  const [message, setMessage] = useState("");

  function generatePayslip(employee: any) {



    const doc = new jsPDF();
  
  
  
    doc.setFontSize(18);
  
  
  
    doc.text("EduClear Payslip", 20, 20);
  
  
  
    doc.setFontSize(12);
  
  
  
    doc.text(`Employee: ${employee.employeeName}`, 20, 40);
  
  
  
    doc.text(`Basic Salary: R ${Number(employee.basicSalary).toFixed(2)}`, 20, 50);
  
  
  
    doc.text(`PAYE: R ${Number(employee.paye).toFixed(2)}`, 20, 60);
  
  
  
    doc.text(`UIF: R ${Number(employee.uif).toFixed(2)}`, 20, 70);
  
  
  
    doc.text(`Total Deductions: R ${Number(employee.deductions).toFixed(2)}`, 20, 80);
  
  
  
    doc.setFontSize(14);
  
  
  
    doc.text(`Net Pay: R ${Number(employee.net).toFixed(2)}`, 20, 100);
  
  
  
    doc.save(`${employee.employeeName}-Payslip.pdf`);
  
  
  
  }
  
  


  useEffect(() => {



    const savedSchoolId = localStorage.getItem("schoolId") || "";



    setSchoolId(savedSchoolId);



    if (savedSchoolId) {



      fetchEmployees(savedSchoolId);



    }



  }, []);



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



          basicSalary: Number(basicSalary || 0),



        }),



      });



      const data = await response.json();



      if (!response.ok) {



        setMessage(data?.error || "Failed to add employee");



        return;



      }



      setFirstName("");



      setLastName("");



      setEmail("");



      setIdNumber("");



      setTaxNumber("");



      setBasicSalary("");



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



          <p style={{ marginTop: "8px", color: "#475569" }}>



            Add employees and run payroll for your school.



          </p>



          <p style={{ marginTop: "8px", color: "#0f172a", fontWeight: 600 }}>



            School ID: {schoolId || "Not found"}



          </p>



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



              <input



                type="number"



                placeholder="Basic salary"



                value={basicSalary}



                onChange={(e) => setBasicSalary(e.target.value)}



                style={inputStyle}



                required



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



        <div style={{ fontWeight: 700, fontSize: "18px" }}>



          {item.employeeName}



        </div>



        <div style={{ marginTop: "8px", color: "#334155" }}>



          Basic Salary: R {item.basicSalary.toFixed(2)}



        </div>



        <div style={{ marginTop: "4px", color: "#334155" }}>



          PAYE: R {item.paye.toFixed(2)}



        </div>



        <div style={{ marginTop: "4px", color: "#334155" }}>



          UIF: R {item.uif.toFixed(2)}



        </div>



        <div style={{ marginTop: "4px", color: "#334155" }}>



          Total Deductions: R {item.deductions.toFixed(2)}



        </div>



        <div style={{ marginTop: "6px", fontWeight: 700, color: "#0f172a" }}>



          Net Pay: R {item.net.toFixed(2)}



        </div>



        <button



onClick={() => generatePayslip(item)}



style={{



  marginTop: "12px",



  padding: "10px 14px",



  borderRadius: "8px",



  border: "none",



  background: "#111827",



  color: "#fff",



  cursor: "pointer"



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



                    <div style={{ color: "#475569", marginTop: "6px" }}>



                      {employee.email || "No email"}



                    </div>



                    <div style={{ color: "#475569", marginTop: "6px" }}>



                      ID Number: {employee.idNumber || "Not captured"}



                    </div>



                    <div style={{ color: "#475569", marginTop: "6px" }}>



                      Tax Number: {employee.taxNumber || "Not captured"}



                    </div>



                    <div style={{ color: "#0f172a", marginTop: "6px" }}>



                      Basic Salary: R {Number(employee.basicSalary || 0).toFixed(2)}



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