import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import AddLearner from "./AddLearner";
import TeacherPerformance from "./TeacherPerformance";
import Payroll from "./Payroll";
import { API_URL } from "./api";
import logo from "./assets/logo.png";
import "./App.css";
import Fees from "./Fees";
import FeeUpsert from "./FeeUpsert";
import { useSchoolId } from "./useSchoolId";

type TeacherPerformanceRecord = {
  id: string;
  teacherName: string;
  teacherEmail?: string | null;
  finalScore: number;
  performanceLevel: string;
  createdAt?: string;
};

function pickTopPerformer(records: TeacherPerformanceRecord[]): TeacherPerformanceRecord | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => {
    const scoreDiff = b.finalScore - a.finalScore;
    if (scoreDiff !== 0) return scoreDiff;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  })[0];
}



type PageKey =

  | "dashboard"

  | "registrations"

  | "classrooms"

  | "groups"

  | "employees"

  | "attendance"

  | "incidents"

  | "lists"

  | "forms"

  | "help"

  | "more"

  | "statements"
  | "statementManage"

  | "invoices"
  | "invoiceCreate"
  | "payments"
  | "payroll"

  | "fees"
  | "feeUpsert"

  | "plans"

  | "runs"

  | "reports"

  | "documents"

  | "billing-help"

  | "billing-more"

  | "addLearner"
  | "teacherPerformance"; 


export default function SchoolDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const schoolId = useSchoolId();

  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [manageFeeId, setManageFeeId] = useState<string | null>(null);

  const go = (page: PageKey) => {
    setActivePage(page);
    // Fees uses nested routes; leaving those routes is required for non-fees pages
    // to render again when switching via sidebar.
    if (location.pathname.startsWith("/dashboard/billing/")) {
      navigate("/dashboard");
    }
  };

  const [adminOpen, setAdminOpen] = useState(true);

  const [billingOpen, setBillingOpen] = useState(true);



  const [parentIdInput, setParentIdInput] = useState("");

  const [feeStatus, setFeeStatus] = useState("GREEN");

  const [feeOutstandingAmount, setFeeOutstandingAmount] = useState(0);

  const [feeSchool, setFeeSchool] = useState("No record found");

  const [feeParentName, setFeeParentName] = useState("-");

  const [feeMessage, setFeeMessage] = useState("");

  const [feeLoading, setFeeLoading] = useState(false);



  const [learners, setLearners] = useState<any[]>([]);

  const [parents, setParents] = useState<any[]>([]);

  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);
  const [selectedStatementAccount, setSelectedStatementAccount] = useState<any | null>(null);
  const [selectedInvoiceAccount, setSelectedInvoiceAccount] = useState<any | null>(null);

  const [showUnenrolled, setShowUnenrolled] = useState(false);

  const [topPerformer, setTopPerformer] = useState<TeacherPerformanceRecord | null>(null);
  const [topPerformerLoading, setTopPerformerLoading] = useState(false);
  const [topPerformerFetchFailed, setTopPerformerFetchFailed] = useState(false);

  useEffect(() => {
    if (activePage !== "dashboard") return;
    if (!schoolId) {
      setTopPerformer(null);
      setTopPerformerLoading(false);
      setTopPerformerFetchFailed(false);
      return;
    }

    let cancelled = false;
    setTopPerformerLoading(true);
    setTopPerformerFetchFailed(false);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/teacher-performance/school/${schoolId}`);
        if (!res.ok) {
          if (!cancelled) {
            setTopPerformer(null);
            setTopPerformerFetchFailed(true);
          }
          return;
        }
        const data = (await res.json()) as TeacherPerformanceRecord[];
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setTopPerformer(pickTopPerformer(list));
        setTopPerformerFetchFailed(false);
      } catch {
        if (!cancelled) {
          setTopPerformer(null);
          setTopPerformerFetchFailed(true);
        }
      } finally {
        if (!cancelled) setTopPerformerLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePage, schoolId]);

  useEffect(() => {

    console.log("Active page is:", activePage);

    const needsRegistrationsData =
      activePage === "registrations" || activePage === "statements" || activePage === "invoices";

    if (needsRegistrationsData) {
      if (!schoolId) {
        setLearners([]);
        setParents([]);
        return;
      }

      Promise.all([

        fetch(`${API_URL}/api/learners?schoolId=${encodeURIComponent(schoolId)}`).then((res) =>
          res.json()
        ),
        fetch(`${API_URL}/api/parents?schoolId=${encodeURIComponent(schoolId)}`).then((res) =>
          res.json()
        ),

      ])

        .then(([learnersData, parentsData]) => {

          console.log("Learners loaded:", learnersData);

          console.log("Parents loaded:", parentsData);



          setLearners(Array.isArray(learnersData?.learners) ? learnersData.learners : []);
          setParents(Array.isArray(parentsData?.parents) ? parentsData.parents : []);

        })

        .catch((error) => {

          console.error("Failed to fetch registrations data:", error);

          setLearners([]);

          setParents([]);

        });

    }

  }, [activePage, schoolId]);

  useEffect(() => {
    const path = location.pathname || "";
    if (!path.startsWith("/dashboard/billing/fees")) return;

    setBillingOpen(true);

    if (path === "/dashboard/billing/fees" || path === "/dashboard/billing/fees/") {
      setManageFeeId(null);
      setActivePage("fees");
      return;
    }

    if (path.endsWith("/new")) {
      setManageFeeId(null);
      setActivePage("feeUpsert");
      return;
    }

    const m = path.match(/\/dashboard\/billing\/fees\/([^/]+)\/?$/);
    if (m?.[1]) {
      setManageFeeId(decodeURIComponent(m[1]));
      setActivePage("feeUpsert");
    }
  }, [location.pathname]);



  const handleFeeCheck = async () => {

    try {

      if (!parentIdInput.trim()) return;



      setFeeLoading(true);



      const res = await fetch(

        `http://localhost:3000/api/parents/fee-check/${parentIdInput}`

      );



      const data = await res.json();



      setFeeStatus(data.status);

      setFeeOutstandingAmount(data.outstandingAmount);

      setFeeSchool(data.school);

      setFeeParentName(data.parentName);



      if (data.status === "RED") {

        setFeeMessage("Immediate action required – high outstanding balance");

      } else if (data.status === "AMBER") {

        setFeeMessage("Payment arrangement required");

      } else {

        setFeeMessage("Account in good standing");

      }

    } catch (err) {

      console.error("Fee check error:", err);

      setFeeMessage("");

    } finally {

      setFeeLoading(false);

    }

  };



  const getAgeFromBirthDate = (birthDate?: string | null) => {

    if (!birthDate) return "-";



    const dob = new Date(birthDate);

    const today = new Date();



    if (Number.isNaN(dob.getTime())) return "-";



    let years = today.getFullYear() - dob.getFullYear();

    const monthDiff = today.getMonth() - dob.getMonth();



    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {

      years -= 1;

    }



    return years >= 0 ? String(years) : "-";

  };



  const statCardStyle = {

    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  
    padding: "22px 24px",
  
    borderRadius: "20px",
  
    minWidth: "150px",
  
    textAlign: "left" as const,
  
    border: "1px solid rgba(15, 23, 42, 0.08)",
  
    boxShadow:
  
      "0 10px 30px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  
  };



  const statNumber = {

    fontSize: "40px",
  
    fontWeight: 800,
  
    lineHeight: 1,
  
    color: "#0f172a",
  
    marginBottom: "10px",
  
    letterSpacing: "-0.03em",
  
  };



  const statLabel = {

    fontSize: "13px",
  
    fontWeight: 700,
  
    color: "#64748b",
  
    textTransform: "uppercase" as const,
  
    letterSpacing: "0.08em",
  
  };


  const actionBtn = {

    padding: "10px 16px",
  
    borderRadius: "12px",
  
    border: "1px solid rgba(15, 23, 42, 0.08)",
  
    background: "#ffffff",
  
    fontWeight: 600,
  
    fontSize: "13px",
  
    color: "#0f172a",
  
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
  
    cursor: "pointer",
  
  };


  const selectStyle = {

    padding: "10px 14px",
  
    borderRadius: "12px",
  
    border: "1px solid rgba(15, 23, 42, 0.08)",
  
    background: "#ffffff",
  
    fontSize: "13px",
  
    color: "#0f172a",
  
  };



  const th = {

    textAlign: "left" as const,
  
    padding: "12px 16px",
  
    fontSize: "12px",
  
    color: "#64748b",
  
    fontWeight: 700,
  
    textTransform: "uppercase" as const,
  
    letterSpacing: "0.08em",
  
  };



  const td = {

    padding: "18px 16px",
  
    color: "#0f172a",
  
    background: "#ffffff",
  
  };
  const billingSummaryWrap = {

    display: "grid",
  
    gridTemplateColumns: "repeat(5, minmax(160px, 1fr))",
  
    gap: "12px",
  
    marginBottom: "18px",
  
  };
  
  
  
  const billingSummaryCard = {
  
    background: "#ffffff",
  
    border: "1px solid rgba(15, 23, 42, 0.08)",
  
    borderRadius: "16px",
  
    padding: "16px 18px",
  
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
  
  };
  
  
  
  const billingSummaryValue = {
  
    fontSize: "18px",
  
    fontWeight: 800,
  
    color: "#0f172a",
  
    marginBottom: "6px",
  
  };
  
  
  
  const billingSummaryLabel = {
  
    fontSize: "12px",
  
    fontWeight: 700,
  
    color: "#64748b",
  
    textTransform: "uppercase" as const,
  
    letterSpacing: "0.08em",
  
  };
  
  
  
  const billingTableCard = {
  
    background: "#ffffff",
  
    borderRadius: "18px",
  
    padding: "16px",
  
    border: "1px solid rgba(15, 23, 42, 0.06)",
  
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
  
    overflow: "hidden",
  
  };

  const formatAge = (birthDate?: string) => {

    if (!birthDate) return "-";



    const dob = new Date(birthDate);

    const today = new Date();



    let years = today.getFullYear() - dob.getFullYear();

    let months = today.getMonth() - dob.getMonth();



    if (months < 0 || (months === 0 && today.getDate() < dob.getDate())) {

      years--;

      months += 12;

    }



    if (years <= 0) return `${months} months`;



    return `${years} years${months > 0 ? ` ${months} months` : ""}`;

  };



  const filteredLearners = showUnenrolled

    ? learners

    : learners.filter((l: any) => (l.childStatus || "Enrolled") === "Enrolled");



  const totalLearners = filteredLearners.length;

  const totalParents = parents.length;

  const totalBoys = learners.filter((l: any) => l.gender === "Male").length;

  const totalGirls = learners.filter((l: any) => l.gender === "Female").length;

  const totalClassrooms = new Set(

    learners

      .map((l: any) => l.grade || l.className || l.classroom)

      .filter(Boolean)

  ).size;
  const statementRows = learners.map((l: any, index: number) => {

    const familyRef =
  
      l.familyAccount?.accountRef ||
  
      l.admissionNo ||
  
      l.admissionNumber ||
  
      `ACC${String(index + 1).padStart(3, "0")}`;
  
  
  
    const name = l.firstName || "-";
  
    const surname = l.lastName || l.surname || "-";
  
  
  
    const balance = Number(l.totalFee || l.balance || 0);
  
    const lastInvoiceAmount = Number(l.lastInvoiceAmount || l.tuitionFee || 0);
  
    const lastPaymentAmount = Number(l.lastPaymentAmount || 0);
  
  
  
    let status = "Up To Date";
  
    if (balance > 10000) status = "Bad Debt";
  
    else if (balance > 0) status = "Recently Owing";
  
    else if (balance < 0) status = "Over Paid";
  
  
  
    return {
  
      accountNo: familyRef,
  
      name,
  
      surname,
  
      balance,
  
      lastInvoice: lastInvoiceAmount,
  
      lastInvoiceDate: "2026/04/15",
  
      lastPayment: lastPaymentAmount,
  
      lastPaymentDate: "2026/04/09",
  
      status,
  
    };
  
  });
  
  
  
  const statementsAccountsCount = statementRows.length;
  
  
  
  const statementsTotalOutstanding = statementRows
  
    .filter((row) => row.balance > 0)
  
    .reduce((sum, row) => sum + row.balance, 0);
  
  
  
  const statementsRecentlyOwing = statementRows
  
    .filter((row) => row.balance > 0 && row.balance <= 10000)
  
    .reduce((sum, row) => sum + row.balance, 0);
  
  
  
  const statementsBadDebt = statementRows
  
    .filter((row) => row.balance > 10000)
  
    .reduce((sum, row) => sum + row.balance, 0);
  
  
  
  const statementsOverPaidAbs = Math.abs(
  
    statementRows
  
      .filter((row) => row.balance < 0)
  
      .reduce((sum, row) => sum + row.balance, 0)
  
  );
  
  const invoiceRows = statementRows;



  const invoicesAccountsCount = invoiceRows.length;
  
  const invoicesTotalOutstanding = statementsTotalOutstanding;
  
  const invoicesRecentlyOwing = statementsRecentlyOwing;
  
  const invoicesBadDebt = statementsBadDebt;
  
  const invoicesOverPaidAbs = statementsOverPaidAbs;
  
  const formatMoney = (value: number) =>
  
    `R ${value.toLocaleString("en-ZA", {
  
      minimumFractionDigits: 2,
  
      maximumFractionDigits: 2,
  
    })}`;
  const renderPage = () => {

    if (activePage === "addLearner") {

      return <AddLearner />;

    }

    if (activePage === "teacherPerformance") {



      return <TeacherPerformance />;
    
    
    
    }

    if (activePage === "feeUpsert") {
      return (
        <FeeUpsert
          feeId={manageFeeId}
          onBack={() => setActivePage("fees")}
          onSaved={() => setActivePage("fees")}
        />
      );
    }

    if (activePage === "registrations") {

      return (

        <div


        style={{
      
          padding: "32px",
      
          background:
      
            "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
      
          minHeight: "100%",
      
          borderRadius: "28px",
      
          border: "1px solid rgba(15, 23, 42, 0.06)",
      
          boxShadow:
      
            "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
      
        }}
      
      >

<div style={{ marginBottom: "24px" }}>

<h1

  style={{

    margin: 0,

    fontSize: "38px",

    fontWeight: 800,

    letterSpacing: "-0.03em",

    color: "#0f172a",

  }}

>

  Registrations

</h1>



<p

  style={{

    margin: "10px 0 0 0",

    fontSize: "15px",

    color: "#475569",

    fontWeight: 500,

  }}

>

  Learner registrations, sibling linking, class placement and enrolment management.

</p>

</div>



          <div

style={{

  display: "flex",

  gap: "12px",

  marginBottom: "22px",

  alignItems: "center",

  flexWrap: "wrap",

  padding: "14px",

  background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",

  border: "1px solid rgba(15, 23, 42, 0.06)",

  borderRadius: "18px",

  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.05)",

}}
  >
          

            <div style={statCardStyle}>

              <div style={statNumber}>{totalLearners}</div>

              <div style={statLabel}>children</div>

            </div>



            <div style={statCardStyle}>

              <div style={statNumber}>{totalParents}</div>

              <div style={statLabel}>parents</div>

            </div>



            <div style={statCardStyle}>

              <div style={statNumber}>{totalBoys}</div>

              <div style={statLabel}>boys</div>

            </div>



            <div style={statCardStyle}>

              <div style={statNumber}>{totalGirls}</div>

              <div style={statLabel}>girls</div>

            </div>



            <div style={statCardStyle}>

              <div style={statNumber}>{totalClassrooms}</div>

              <div style={statLabel}>classrooms</div>

            </div>

          </div>



          <div

style={{

  display: "flex",

  gap: "10px",

  marginBottom: "16px",

  alignItems: "center",

  flexWrap: "wrap",

  padding: "14px",


}}

          >

<button

style={{

  padding: "10px 18px",

  borderRadius: "12px",

  border: "none",

  background: "linear-gradient(135deg, #d4af37, #f5d06f)",

  color: "#0f172a",

  fontWeight: 700,

  fontSize: "13px",

  boxShadow: "0 6px 18px rgba(212, 175, 55, 0.35)",

  cursor: "pointer",

}}

onClick={() => {

  const savedAccount = localStorage.getItem("selectedInvoiceAccount");



  if (!savedAccount) {

    alert("Please select a learner first.");

    return;

  }



  setActivePage("invoiceCreate");

}}

>

+ Add

</button>



<button

style={{
  ...actionBtn,
  ...(selectedLearner ? null : { opacity: 0.6, cursor: "not-allowed" }),
}}

onClick={() => {

  if (!selectedLearner) {

    alert("Please select a learner first.");

    return;

  }



  localStorage.setItem(

    "selectedLearnerForSibling",

    JSON.stringify(selectedLearner)

  );



  localStorage.removeItem("selectedLearnerForManage");

  setActivePage("addLearner");

}}

disabled={!selectedLearner}
>

Add Sibling

</button>



<button

style={{
  ...actionBtn,
  ...(selectedLearner ? null : { opacity: 0.6, cursor: "not-allowed" }),
}}

onClick={() => {

  if (!selectedLearner) {

    alert("Please select a learner first.");

    return;

  }



  localStorage.setItem(

    "selectedLearnerForManage",

    JSON.stringify(selectedLearner)

  );



  setActivePage("addLearner");

}}

disabled={!selectedLearner}
>

Manage

</button>



            <select

              style={selectStyle}

              value={showUnenrolled ? "show" : "hide"}

              onChange={(e) => setShowUnenrolled(e.target.value === "show")}

            >

              <option value="hide">Hide Unenrolled</option>

              <option value="show">Show Unenrolled</option>

            </select>



            <select style={selectStyle}>

              <option>All Groups</option>

            </select>



            <select style={selectStyle}>

              <option>All Classrooms</option>

            </select>



            <input

              placeholder="Search"

              style={{

                padding: "10px 14px",
              
                borderRadius: "12px",
              
                border: "1px solid rgba(15, 23, 42, 0.08)",
              
                background: "#ffffff",
              
                fontSize: "13px",
              
                width: "200px",
              
                boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
              
              }}

            />

          </div>



          {selectedLearner && (

            <div

            style={{

              marginBottom: "16px",
            
              padding: "20px",
            
              border: "1px solid #e5e7eb",
            
              borderRadius: "14px",
            
              background: "#ffffff",
            
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
            
            }}

            >

              <h3>

                {selectedLearner.firstName}{" "}

                {selectedLearner.lastName || selectedLearner.surname || ""}

              </h3>



              <p>

                Grade:{" "}

                {selectedLearner.grade || selectedLearner.className || "-"}

              </p>



              <p>Age: {formatAge(selectedLearner.birthDate)}</p>

            </div>

          )}



          {filteredLearners.length === 0 ? (

            <p>No learners found</p>

          ) : (

            <div

  style={{

    background: "#ffffff",

    borderRadius: "18px",

    padding: "16px",

    border: "1px solid rgba(15, 23, 42, 0.06)",

    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",

    overflow: "hidden",

  }}

>
          
            <table
            
              style={{
          
                width: "100%",
          
                borderCollapse: "separate",
               borderSpacing: "0 10px",
                fontSize: "14px",
          
              }}
          
            >

             

              <thead>

                <tr>

                  <th style={th}>Name</th>

                  <th style={th}>Surname</th>

                  <th style={th}>Classroom</th>

                  <th style={th}>Age</th>

                  <th style={th}>Child Status</th>

                </tr>

              </thead>



              <tbody>

                {filteredLearners.map((l: any) => (

  <tr
    key={l.id}
    onClick={() => {
      setSelectedLearner(l);
    }}
    style={{
      background: "#ffffff",
      boxShadow:
        selectedLearner && String(selectedLearner?.id) === String(l?.id)
          ? "0 0 0 2px rgba(29, 78, 216, 0.45), 0 8px 24px rgba(15, 23, 42, 0.08)"
          : "0 8px 24px rgba(15, 23, 42, 0.08)",
      borderRadius: "12px",
      overflow: "hidden",
      cursor: "pointer",
    }}
  >

                    <td style={td}>

                      <button

                        type="button"

                        onClick={() => {

                          setSelectedLearner(l);

                          localStorage.setItem(

                            "selectedLearnerForManage",

                            JSON.stringify(l)

                          );

                        }}

                        style={{

                          background: "none",

                          border: "none",

                          padding: 0,

                          margin: 0,

                          color: "#1d4ed8",

                          cursor: "pointer",

                          fontWeight: 600,

                          textDecoration: "underline",

                          fontSize: "inherit",

                        }}

                      >

                        {l.firstName || "--"}

                      </button>

                    </td>



                    <td style={td}>

                      <button

                        type="button"

                        onClick={() => {

                          setSelectedLearner(l);

                          localStorage.setItem(

                            "selectedLearnerForManage",

                            JSON.stringify(l)

                          );

                        }}

                        style={{

                          background: "none",

                          border: "none",

                          padding: 0,

                          margin: 0,

                          color: "#1d4ed8",

                          cursor: "pointer",

                          fontWeight: 600,

                          textDecoration: "underline",

                          fontSize: "inherit",

                        }}

                      >

                        {l.lastName || l.surname || "--"}

                      </button>

                    </td>



                    <td style={td}>

                      {l.grade || l.className || l.classroom || "-"}

                    </td>



                    <td style={td}>{formatAge(l.birthDate)}</td>



                    <td style={td}>

                      <span

                        style={{

                          padding: "6px 12px",

                          borderRadius: "20px",

                          fontWeight: "bold",

                          fontSize: "12px",

                          color: "white",

                          backgroundColor:

                            (l.childStatus || "Enrolled") === "Enrolled"

                              ? "#16a34a"

                              : "#dc2626",

                        }}

                      >

                        {l.childStatus || "Enrolled"}

                      </span>

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
    if (activePage === "dashboard") {

      return (

        <div className="dashboard-page">

          <div className="dashboard-header">

            <img src={logo} className="dashboard-logo" alt="EduClear" />



            <div>

              <h1 className="page-title">Hello Da Silva Academy!</h1>

              <p className="dashboard-subtitle">School Management Dashboard</p>

            </div>

          </div>



          <div className="fees-check-card">

            <div className="fees-check-left">

              <h2 className="dashboard-card-title">Check Outstanding Fees</h2>



              <div className="fees-check-form">

                <input

                  className="fees-input"

                  type="text"

                  placeholder="Enter Parent ID"

                  value={parentIdInput}

                  onChange={(e) => setParentIdInput(e.target.value)}

                />



                <button

                  className="fees-check-button"

                  type="button"

                  onClick={handleFeeCheck}

                  disabled={feeLoading}

                >

                  {feeLoading ? "Checking..." : "Check Status"}

                </button>

              </div>



              <div className="fees-status-results">

                <div className="fees-status-line">

                  <span className="fees-label">Status:</span>

                  <span

                    className={`status-pill ${

                      feeStatus === "RED"

                        ? "status-red"

                        : feeStatus === "AMBER"

                        ? "status-amber"

                        : "status-green"

                    }`}

                  >

                    {feeStatus}

                  </span>

                </div>



                {feeMessage && (

                  <div

                    style={{

                      marginTop: "10px",

                      padding: "12px 16px",

                      borderRadius: "10px",

                      fontWeight: "600",

                      width: "fit-content",

                      backgroundColor:

                        feeStatus === "RED"

                          ? "#ffe5e5"

                          : feeStatus === "AMBER"

                          ? "#fff4e5"

                          : "#e6f7ec",

                      color:

                        feeStatus === "RED"

                          ? "#cc0000"

                          : feeStatus === "AMBER"

                          ? "#b36b00"

                          : "#1e7e34",

                      border:

                        feeStatus === "RED"

                          ? "1px solid #ffb3b3"

                          : feeStatus === "AMBER"

                          ? "1px solid #ffd699"

                          : "1px solid #b7ebc6",

                    }}

                  >

                    {feeMessage}

                  </div>

                )}



                <div className="fees-status-line">

                  <span className="fees-label">Outstanding Amount:</span>

                  <strong>R {feeOutstandingAmount.toLocaleString()}</strong>

                </div>



                <div className="fees-status-line">

                  <span className="fees-label">School:</span>

                  <span>{feeSchool}</span>

                </div>



                <div className="fees-status-line">

                  <span className="fees-label">Parent:</span>

                  <span>{feeParentName}</span>

                </div>

              </div>

            </div>



            <div className="fees-check-right">

              <div className="fees-legend-card">

                <h3 className="legend-title">Fee Status Guide</h3>



                <div className="legend-row">

                  <span className="status-pill status-green">GREEN</span>

                  <span>Fees up to date</span>

                </div>



                <div className="legend-row">

                  <span className="status-pill status-amber">AMBER</span>

                  <span>Outstanding fees of R10,000 or less</span>

                </div>



                <div className="legend-row">

                  <span className="status-pill status-red">RED</span>

                  <span>Outstanding fees above R10,000</span>

                </div>

              </div>

            </div>

          </div>



          <div className="dashboard-bottom-grid">

            <div
              className="dashboard-card dashboard-card-clickable"
              role="button"
              tabIndex={0}
              onClick={() => go("teacherPerformance")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go("teacherPerformance");
                }
              }}
            >
              <div className="top-performer-card-head">
                <span className="top-performer-trophy" aria-hidden>
                  🏆
                </span>
                <h3>Top Performer</h3>
              </div>

              {topPerformerLoading ? (
                <p className="dashboard-card-text">Loading…</p>
              ) : !topPerformer ? (
                <p className="dashboard-card-text">No teacher performance data yet</p>
              ) : (
                <>
                  <h2 className="dashboard-card-value" style={{ fontSize: 26 }}>
                    {topPerformer.teacherName}
                  </h2>
                  {topPerformer.teacherEmail ? (
                    <p className="dashboard-card-text" style={{ marginBottom: 8 }}>
                      {topPerformer.teacherEmail}
                    </p>
                  ) : null}
                  <p className="dashboard-card-text-large" style={{ marginBottom: 6 }}>
                    {Number(topPerformer.finalScore).toFixed(1)} / 10
                  </p>
                  <p
                    style={{
                      color:
                        topPerformer.performanceLevel === "Excellent"
                          ? "#1e7e34"
                          : topPerformer.performanceLevel === "Acceptable"
                            ? "#b36b00"
                            : topPerformer.performanceLevel === "At Risk"
                              ? "#cc5500"
                              : "#cc0000",
                      fontWeight: 700,
                      fontSize: 16,
                    }}
                  >
                    {topPerformer.performanceLevel}
                  </p>
                </>
              )}
            </div>

            <div className="dashboard-card">

              <h3>Learners</h3>

              <h2>393</h2>

              <p>188 boys • 205 girls</p>

            </div>



            <div className="dashboard-card">

              <h3>Classrooms</h3>

              <h2>23</h2>

              <p>Average class size: 17</p>

            </div>



            <div className="dashboard-card">

              <h3>Birthdays</h3>

              <h2>1 today</h2>

              <p>View today’s learner birthdays</p>

            </div>

          </div>



          <div className="dashboard-bottom-grid">

            <div className="dashboard-card">

              <h3>Announcements</h3>

              <p>Welcome to EduClear.</p>

            </div>



            <div className="dashboard-card">

              <h3>Review</h3>

              <p>

                We would love your feedback once everything is live and complete.

              </p>

            </div>

          </div>

        </div>

      );

    }
    
    



      switch (activePage) {

        case "invoiceCreate":

        return (
      
          <div style={{ padding: "32px" }}>
      
            <h1 className="page-title">Create Invoice</h1>
      
            {(() => {
              const saved = localStorage.getItem("selectedInvoiceAccount");
              const selected =
                selectedInvoiceAccount ||
                (saved
                  ? (() => {
                      try {
                        return JSON.parse(saved);
                      } catch {
                        return null;
                      }
                    })()
                  : null);

              if (!selected) {
                return (
                  <div
                    style={{
                      background: "#ffffff",
                      borderRadius: "12px",
                      padding: "24px",
                      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                      marginTop: "20px",
                      border: "1px solid rgba(234, 88, 12, 0.18)",
                      color: "#9a3412",
                      fontWeight: 700,
                    }}
                  >
                    Select an account first.
                  </div>
                );
              }

              const ref = String(selected?.accountNo || "");
              const learnerName = `${String(selected?.name || "").trim()} ${String(selected?.surname || "").trim()}`.trim();

              return (
                <div
                  style={{
                    background: "#ffffff",
                    borderRadius: "12px",
                    padding: "24px",
                    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                    marginTop: "20px",
                    border: "1px solid rgba(15, 23, 42, 0.08)",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: "14px", color: "#0f172a", marginBottom: "8px" }}>
                    Invoice for
                  </div>
                  <div style={{ fontWeight: 900, fontSize: "18px", color: "#0f172a", marginBottom: "6px" }}>
                    {learnerName || "Selected account"}
                  </div>
                  <div style={{ color: "#475569", fontWeight: 700, fontSize: "13px", marginBottom: "14px" }}>
                    Account: {ref || "-"}
                  </div>
                  <p style={{ margin: 0 }}>Select fees or add manual items for this learner.</p>
                </div>
              );
            })()}
      
          </div>
      
        );
      
      
      
      case "classrooms":

        return <h1 className="page-title">Classrooms</h1>;

      case "groups":

        return <h1 className="page-title">Groups</h1>;

      case "employees":

        return <h1 className="page-title">Employees</h1>;

      case "attendance":

        return <h1 className="page-title">Attendance</h1>;

      case "incidents":

        return <h1 className="page-title">Incidents</h1>;

      case "lists":

        return <h1 className="page-title">Lists & Registers</h1>;

      case "forms":

        return <h1 className="page-title">Forms & Templates</h1>;

      case "help":

        return <h1 className="page-title">Help & Tips</h1>;

      case "more":

        return <h1 className="page-title">More</h1>;

        case "statements":

        return (
      
          <div
      
            style={{
      
              padding: "32px",
      
              background:
      
                "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
      
              minHeight: "100%",
      
              borderRadius: "28px",
      
              border: "1px solid rgba(15, 23, 42, 0.06)",
      
              boxShadow:
      
                "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
      
            }}
      
          >
      
            <div style={{ marginBottom: "24px" }}>
      
              <h1
      
                style={{
      
                  margin: 0,
      
                  fontSize: "38px",
      
                  fontWeight: 800,
      
                  letterSpacing: "-0.03em",
      
                  color: "#0f172a",
      
                }}
      
              >
      
                Statements
      
              </h1>
      
      
      
              <p
      
                style={{
      
                  margin: "10px 0 0 0",
      
                  fontSize: "15px",
      
                  color: "#475569",
      
                  fontWeight: 500,
      
                }}
      
              >
      
                Manage your statement of accounts.
      
              </p>
      
            </div>
      
      
      
            <div style={billingSummaryWrap}>
      
              <div style={billingSummaryCard}>
      
                <div style={billingSummaryValue}>{statementsAccountsCount}</div>
      
                <div style={billingSummaryLabel}>Accounts</div>
      
              </div>
      
      
      
              <div style={billingSummaryCard}>
      
                <div style={billingSummaryValue}>
      
                  {formatMoney(statementsTotalOutstanding)}
      
                </div>
      
                <div style={billingSummaryLabel}>Total Outstanding</div>
      
              </div>
      
      
      
              <div style={billingSummaryCard}>
      
                <div style={billingSummaryValue}>
      
                  {formatMoney(statementsRecentlyOwing)}
      
                </div>
      
                <div style={billingSummaryLabel}>Recently Owing</div>
      
              </div>
      
      
      
              <div style={billingSummaryCard}>
      
                <div style={{ ...billingSummaryValue, color: "#b91c1c" }}>
      
                  {formatMoney(statementsBadDebt)}
      
                </div>
      
                <div style={billingSummaryLabel}>Bad Debt</div>
      
              </div>
      
      
      
              <div style={billingSummaryCard}>
      
                <div style={{ ...billingSummaryValue, color: "#15803d" }}>
      
                  {formatMoney(statementsOverPaidAbs)}
      
                </div>
      
                <div style={billingSummaryLabel}>Over Paid</div>
      
              </div>
      
            </div>
      
      
      
            <div style={billingTableCard}>
      
              <div
      
                style={{
      
                  display: "flex",
      
                  justifyContent: "space-between",
      
                  alignItems: "center",
      
                  gap: "12px",
      
                  marginBottom: "14px",
      
                  flexWrap: "wrap",
      
                }}
      
              >
      
                <button
      
                  style={{
      
                    ...actionBtn,
                    ...(selectedStatementAccount ? null : { opacity: 0.6, cursor: "not-allowed" }),
      
                    border: "1px solid rgba(15, 23, 42, 0.12)",
      
                    background: "#ffffff",
      
                  }}
                  disabled={!selectedStatementAccount}
                  aria-disabled={!selectedStatementAccount}
                  title={!selectedStatementAccount ? "Select an account first" : "Manage selected account"}
                  onClick={() => {
                    if (!selectedStatementAccount) {
                      alert("Please select an account first.");
                      return;
                    }
                    localStorage.setItem(
                      "selectedStatementAccount",
                      JSON.stringify(selectedStatementAccount)
                    );
                    setActivePage("statementManage");
                  }}
      
                >
      
                  Manage
      
                </button>
      
      
      
                <input
      
                  placeholder="Search"
      
                  style={{
      
                    padding: "10px 14px",
      
                    borderRadius: "12px",
      
                    border: "1px solid rgba(15, 23, 42, 0.08)",
      
                    background: "#ffffff",
      
                    fontSize: "13px",
      
                    width: "220px",
      
                    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
      
                  }}
      
                />
      
              </div>
      
      
      
              <table
      
                style={{
      
                  width: "100%",
      
                  borderCollapse: "separate",
      
                  borderSpacing: "0 10px",
      
                  fontSize: "14px",
      
                }}
      
              >
      
                <thead>
      
                  <tr>
      
                    <th style={th}>Account No</th>
      
                    <th style={th}>Name</th>
      
                    <th style={th}>Surname</th>
      
                    <th style={th}>Balance</th>
      
                    <th style={th}>Last Invoice</th>
      
                    <th style={th}>Last Payment</th>
      
                    <th style={th}>Account Status</th>
      
                  </tr>
      
                </thead>
      
      
      
                <tbody>
      
                  {statementRows.length === 0 ? (
      
                    <tr>
      
                      <td
      
                        colSpan={7}
      
                        style={{
      
                          ...td,
      
                          textAlign: "center",
      
                          borderRadius: "12px",
      
                        }}
      
                      >
      
                        No statement accounts found
      
                      </td>
      
                    </tr>
      
                  ) : (
      
                    statementRows.map((row, index) => (
      
                      <tr
      
                        key={`${row.accountNo}-${index}`}
                        onClick={() => {
                          setSelectedStatementAccount(row);
                        }}
      
                        style={{
      
                          background:
                            selectedStatementAccount &&
                            String(selectedStatementAccount?.accountNo) === String(row?.accountNo)
                              ? "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)"
                              : "#ffffff",
      
                          boxShadow:
                            selectedStatementAccount &&
                            String(selectedStatementAccount?.accountNo) === String(row?.accountNo)
                              ? "0 0 0 2px rgba(29, 78, 216, 0.45), 0 8px 24px rgba(15, 23, 42, 0.08)"
                              : "0 8px 24px rgba(15, 23, 42, 0.08)",
      
                          borderRadius: "12px",
      
                          overflow: "hidden",
                          cursor: "pointer",
                          outline:
                            selectedStatementAccount &&
                            String(selectedStatementAccount?.accountNo) === String(row?.accountNo)
                              ? "2px solid rgba(29, 78, 216, 0.35)"
                              : "none",
                          outlineOffset: "2px",
      
                        }}
      
                      >
      
                        <td style={td}>{row.accountNo}</td>
      
                        <td style={td}>{row.name}</td>
      
                        <td style={td}>{row.surname}</td>
      
                        <td style={td}>{formatMoney(row.balance)}</td>
      
                        <td style={td}>
      
                          {formatMoney(row.lastInvoice)} on {row.lastInvoiceDate}
      
                        </td>
      
                        <td style={td}>
      
                          {formatMoney(row.lastPayment)} on {row.lastPaymentDate}
      
                        </td>
      
                        <td style={td}>
      
                          <span
      
                            style={{
      
                              fontWeight: 700,
      
                              color:
      
                                row.status === "Bad Debt"
      
                                  ? "#b91c1c"
      
                                  : row.status === "Recently Owing"
      
                                  ? "#b45309"
      
                                  : row.status === "Over Paid"
      
                                  ? "#15803d"
      
                                  : "#475569",
      
                            }}
      
                          >
      
                            {row.status}
      
                          </span>
      
                        </td>
      
                      </tr>
      
                    ))
      
                  )}
      
                </tbody>
      
              </table>
      
            </div>
      
          </div>
      
        );

        case "statementManage": {
          const saved = localStorage.getItem("selectedStatementAccount");
          const selected =
            selectedStatementAccount ||
            (saved
              ? (() => {
                  try {
                    return JSON.parse(saved);
                  } catch {
                    return null;
                  }
                })()
              : null);

          if (!selected) {
            return (
              <div style={{ padding: "32px" }}>
                <h1 className="page-title">Statement</h1>
                <div
                  style={{
                    background: "#ffffff",
                    borderRadius: "12px",
                    padding: "24px",
                    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                    marginTop: "20px",
                    border: "1px solid rgba(234, 88, 12, 0.18)",
                    color: "#9a3412",
                    fontWeight: 700,
                  }}
                >
                  Select an account first.
                </div>
                <div style={{ marginTop: "14px" }}>
                  <button type="button" style={actionBtn} onClick={() => setActivePage("statements")}>
                    Back
                  </button>
                </div>
              </div>
            );
          }

          const ref = String(selected?.accountNo || "");
          const learnerName = `${String(selected?.name || "").trim()} ${String(selected?.surname || "").trim()}`.trim();

          return (
            <div style={{ padding: "32px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h1 className="page-title">Statement</h1>
                  <p style={{ margin: "8px 0 0 0", color: "#475569", fontWeight: 600 }}>
                    Account: <span style={{ fontWeight: 800, color: "#0f172a" }}>{ref || "-"}</span>
                    {learnerName ? (
                      <>
                        {" "}
                        • Learner: <span style={{ fontWeight: 800, color: "#0f172a" }}>{learnerName}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <button type="button" style={actionBtn} onClick={() => setActivePage("statements")}>
                  Back
                </button>
              </div>

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "24px",
                  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                  marginTop: "20px",
                }}
              >
                <p style={{ margin: 0, color: "#475569", fontWeight: 650 }}>
                  This view is now correctly opened from Statements “Manage” and is linked to the selected account.
                </p>
              </div>
            </div>
          );
        }

        case "invoices":

  return (

    <div

      style={{

        padding: "32px",

        background:

          "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",

        minHeight: "100%",

        borderRadius: "28px",

        border: "1px solid rgba(15, 23, 42, 0.06)",

        boxShadow:

          "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",

      }}

    >

      <div style={{ marginBottom: "24px" }}>

        <h1

          style={{

            margin: 0,

            fontSize: "38px",

            fontWeight: 800,

            letterSpacing: "-0.03em",

            color: "#0f172a",

          }}

        >

          New Invoice

        </h1>



        <p

          style={{

            margin: "10px 0 0 0",

            fontSize: "15px",

            color: "#475569",

            fontWeight: 500,

          }}

        >

          Create a new invoice.

        </p>

      </div>



      <div style={billingSummaryWrap}>

        <div style={billingSummaryCard}>

          <div style={billingSummaryValue}>{invoicesAccountsCount}</div>

          <div style={billingSummaryLabel}>Accounts</div>

        </div>



        <div style={billingSummaryCard}>

          <div style={billingSummaryValue}>

            {formatMoney(invoicesTotalOutstanding)}

          </div>

          <div style={billingSummaryLabel}>Total Outstanding</div>

        </div>



        <div style={billingSummaryCard}>

          <div style={billingSummaryValue}>

            {formatMoney(invoicesRecentlyOwing)}

          </div>

          <div style={billingSummaryLabel}>Recently Owing</div>

        </div>



        <div style={billingSummaryCard}>

          <div style={{ ...billingSummaryValue, color: "#b91c1c" }}>

            {formatMoney(invoicesBadDebt)}

          </div>

          <div style={billingSummaryLabel}>Bad Debt</div>

        </div>



        <div style={billingSummaryCard}>

          <div style={{ ...billingSummaryValue, color: "#15803d" }}>

            {formatMoney(invoicesOverPaidAbs)}

          </div>

          <div style={billingSummaryLabel}>Over Paid</div>

        </div>

      </div>



      <div style={billingTableCard}>

        <div

          style={{

            display: "flex",

            justifyContent: "space-between",

            alignItems: "center",

            gap: "12px",

            marginBottom: "14px",

            flexWrap: "wrap",

          }}

        >

          <button

            style={{

              padding: "10px 18px",

              borderRadius: "12px",

              border: "none",

              background: "linear-gradient(135deg, #d4af37, #f5d06f)",

              color: "#0f172a",

              fontWeight: 700,

              fontSize: "13px",

              boxShadow: "0 6px 18px rgba(212, 175, 55, 0.35)",

              cursor: selectedInvoiceAccount ? "pointer" : "not-allowed",
              opacity: selectedInvoiceAccount ? 1 : 0.6,

            }}
            onClick={() => {
              if (!selectedInvoiceAccount) {
                alert("Please select an account first.");
                return;
              }
              localStorage.setItem("selectedInvoiceAccount", JSON.stringify(selectedInvoiceAccount));
              setActivePage("invoiceCreate");
            }}
            disabled={!selectedInvoiceAccount}
            aria-disabled={!selectedInvoiceAccount}
            title={!selectedInvoiceAccount ? "Select an account first" : "Create an invoice for selected account"}

          >

            + Add

          </button>

          <button
            type="button"
            style={{
              ...actionBtn,
              ...(selectedInvoiceAccount ? null : { opacity: 0.6, cursor: "not-allowed" }),
            }}
            disabled={!selectedInvoiceAccount}
            aria-disabled={!selectedInvoiceAccount}
            title={!selectedInvoiceAccount ? "Select an account first" : "Manage selected account"}
            onClick={() => {
              if (!selectedInvoiceAccount) {
                alert("Please select an account first.");
                return;
              }
              localStorage.setItem("selectedInvoiceAccount", JSON.stringify(selectedInvoiceAccount));
              setActivePage("invoiceCreate");
            }}
          >
            Manage
          </button>



          <input

            placeholder="Search"

            style={{

              padding: "10px 14px",

              borderRadius: "12px",

              border: "1px solid rgba(15, 23, 42, 0.08)",

              background: "#ffffff",

              fontSize: "13px",

              width: "220px",

              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",

            }}

          />

        </div>



        <table

          style={{

            width: "100%",

            borderCollapse: "separate",

            borderSpacing: "0 10px",

            fontSize: "14px",

          }}

        >

          <thead>

            <tr>

              <th style={th}>Account No</th>

              <th style={th}>Name</th>

              <th style={th}>Surname</th>

              <th style={th}>Balance</th>

              <th style={th}>Last Invoice</th>

              <th style={th}>Last Payment</th>

              <th style={th}>Account Status</th>

            </tr>

          </thead>



          <tbody>

            {invoiceRows.length === 0 ? (

              <tr>

                <td

                  colSpan={7}

                  style={{

                    ...td,

                    textAlign: "center",

                    borderRadius: "12px",

                  }}

                >

                  No invoice accounts found

                </td>

              </tr>

            ) : (

              invoiceRows.map((row, index) => (

                <tr

                  key={`${row.accountNo}-${index}`}
                  onClick={() => {
                    setSelectedInvoiceAccount(row);
                  }}

                  style={{

                    background:
                      selectedInvoiceAccount &&
                      String(selectedInvoiceAccount?.accountNo) === String(row?.accountNo)
                        ? "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)"
                        : "#ffffff",

                    boxShadow:
                      selectedInvoiceAccount &&
                      String(selectedInvoiceAccount?.accountNo) === String(row?.accountNo)
                        ? "0 0 0 2px rgba(29, 78, 216, 0.45), 0 8px 24px rgba(15, 23, 42, 0.08)"
                        : "0 8px 24px rgba(15, 23, 42, 0.08)",

                    borderRadius: "12px",

                    overflow: "hidden",
                    cursor: "pointer",
                    outline:
                      selectedInvoiceAccount &&
                      String(selectedInvoiceAccount?.accountNo) === String(row?.accountNo)
                        ? "2px solid rgba(29, 78, 216, 0.35)"
                        : "none",
                    outlineOffset: "2px",

                  }}

                >

                  <td style={td}>{row.accountNo}</td>

                  <td style={td}>

  <button

    type="button"

    onClick={() => {

      setSelectedInvoiceAccount(row);
      // Selection only; actions decide what to do with it.

    }}
    onMouseDown={(e) => e.stopPropagation()}
    onClickCapture={(e) => e.stopPropagation()}

    style={{

      background: "none",

      border: "none",

      padding: 0,

      margin: 0,

      color: "#1d4ed8",

      cursor: "pointer",

      fontWeight: 600,

      textDecoration: "underline",

      fontSize: "inherit",

    }}

  >

    {row.name}

  </button>

</td>

                  <td style={td}>{row.surname}</td>

                  <td style={td}>{formatMoney(row.balance)}</td>

                  <td style={td}>

                    {formatMoney(row.lastInvoice)} on {row.lastInvoiceDate}

                  </td>

                  <td style={td}>

                    {formatMoney(row.lastPayment)} on {row.lastPaymentDate}

                  </td>

                  <td style={td}>

                    <span

                      style={{

                        fontWeight: 700,

                        color:

                          row.status === "Bad Debt"

                            ? "#b91c1c"

                            : row.status === "Recently Owing"

                            ? "#b45309"

                            : row.status === "Over Paid"

                            ? "#15803d"

                            : "#475569",

                      }}

                    >

                      {row.status}

                    </span>

                  </td>

                </tr>

              ))

            )}

          </tbody>

        </table>

      </div>

    </div>

  );

      case "payments":

        return <h1 className="page-title">Payments</h1>;

      case "payroll":
        return <Payroll />;

      case "fees":
        return (
          <Fees
            onAdd={() => {
              setManageFeeId(null);
              setActivePage("feeUpsert");
            }}
            onManage={(feeId) => {
              setManageFeeId(feeId);
              setActivePage("feeUpsert");
            }}
          />
        );

      case "plans":

        return <h1 className="page-title">Billing Plans</h1>;

      case "runs":

        return <h1 className="page-title">Invoice Runs</h1>;

      case "reports":

        return <h1 className="page-title">Billing Reports</h1>;

      case "documents":

        return <h1 className="page-title">Billing Documents</h1>;

      case "billing-help":

        return <h1 className="page-title">Help & Tips</h1>;

      case "billing-more":

        return <h1 className="page-title">More</h1>;

      default:

        return <h1 className="page-title">Dashboard</h1>;

    }

  };

  function FeeUpsertRoute() {
    const params = useParams();
    const feeId = params.feeId ? String(params.feeId) : null;
    return (
      <FeeUpsert
        feeId={feeId}
        onBack={() => navigate("/dashboard/billing/fees")}
        onSaved={() => navigate("/dashboard/billing/fees")}
      />
    );
  }

  return (

    <div className="school-shell">

      <aside className="sidebar">

        <div className="brand-row">

          <img src={logo} className="sidebar-logo" alt="EduClear" />

          <span>EduClear</span>

        </div>



        <div

          className={`top-dashboard ${activePage === "dashboard" ? "active" : ""}`}

          onClick={() => go("dashboard")}

        >

          <span className="menu-icon">◉</span>

          <span>Dashboard</span>

        </div>



        <div className="main-section">

          <div className="section-header" onClick={() => setAdminOpen(!adminOpen)}>

            <div className="section-left">

              <span className="menu-icon">👥</span>

              <span>Administration</span>

            </div>

            <span className={`chevron ${adminOpen ? "open" : ""}`}>⌄</span>

          </div>



          {adminOpen && (

            <div className="submenu">

              <div

                className={`submenu-item ${activePage === "registrations" ? "active" : ""}`}

                onClick={() => go("registrations")}

              >

                Registrations

              </div>



              <div

                className={`submenu-item ${activePage === "addLearner" ? "active" : ""}`}

                onClick={() => go("addLearner")}

              >

                Add Learner

              </div>



              <div

                className={`submenu-item ${activePage === "classrooms" ? "active" : ""}`}

                onClick={() => go("classrooms")}

              >

                Classrooms

              </div>



              <div

                className={`submenu-item ${activePage === "groups" ? "active" : ""}`}

                onClick={() => go("groups")}

              >

                Groups

              </div>



              <div

                className={`submenu-item ${activePage === "employees" ? "active" : ""}`}

                onClick={() => go("employees")}

              >

                Employees

              </div>
              <div



className={`submenu-item ${activePage === "teacherPerformance" ? "active" : ""}`}



onClick={() => go("teacherPerformance")}



>



Teacher Performance



</div>


              <div

                className={`submenu-item ${activePage === "attendance" ? "active" : ""}`}

                onClick={() => go("attendance")}

              >

                Attendance

              </div>



              <div

                className={`submenu-item ${activePage === "incidents" ? "active" : ""}`}

                onClick={() => go("incidents")}

              >

                Incidents

              </div>



              <div

                className={`submenu-item ${activePage === "lists" ? "active" : ""}`}

                onClick={() => go("lists")}

              >

                Lists & Registers

              </div>



              <div

                className={`submenu-item ${activePage === "forms" ? "active" : ""}`}

                onClick={() => go("forms")}

              >

                Forms & Templates

              </div>



              <div

                className={`submenu-item ${activePage === "help" ? "active" : ""}`}

                onClick={() => go("help")}

              >

                Help & Tips

              </div>



              <div

                className={`submenu-item ${activePage === "more" ? "active" : ""}`}

                onClick={() => go("more")}

              >

                More

              </div>

            </div>

          )}

        </div>



        <div className="main-section">

          <div className="section-header" onClick={() => setBillingOpen(!billingOpen)}>

            <div className="section-left">

              <span className="menu-icon">▦</span>

              <span>Billing</span>

            </div>

            <span className={`chevron ${billingOpen ? "open" : ""}`}>⌄</span>

          </div>



          {billingOpen && (

            <div className="submenu">

              <div

                className={`submenu-item ${activePage === "statements" ? "active" : ""}`}

                onClick={() => go("statements")}

              >

                Statements

              </div>



              <div

                className={`submenu-item ${activePage === "invoices" ? "active" : ""}`}

                onClick={() => go("invoices")}

              >

                Invoices

              </div>



              <div

                className={`submenu-item ${activePage === "payments" ? "active" : ""}`}

                onClick={() => go("payments")}

              >

                Payments

              </div>

              <div
                className={`submenu-item ${activePage === "payroll" ? "active" : ""}`}
                onClick={() => go("payroll")}
              >
                Payroll
              </div>



              <div

                className={`submenu-item ${activePage === "fees" ? "active" : ""}`}

                onClick={() => navigate("/dashboard/billing/fees")}

              >

                Fees

              </div>



              <div

                className={`submenu-item ${activePage === "plans" ? "active" : ""}`}

                onClick={() => go("plans")}

              >

                Billing Plans

              </div>



              <div

                className={`submenu-item ${activePage === "runs" ? "active" : ""}`}

                onClick={() => go("runs")}

              >

                Invoice Runs

              </div>



              <div

                className={`submenu-item ${activePage === "reports" ? "active" : ""}`}

                onClick={() => go("reports")}

              >

                Billing Reports

              </div>



              <div

                className={`submenu-item ${activePage === "documents" ? "active" : ""}`}

                onClick={() => go("documents")}

              >

                Billing Documents

              </div>



              <div

                className={`submenu-item ${activePage === "billing-help" ? "active" : ""}`}

                onClick={() => go("billing-help")}

              >

                Help & Tips

              </div>



              <div

                className={`submenu-item ${activePage === "billing-more" ? "active" : ""}`}

                onClick={() => go("billing-more")}

              >

                More

              </div>

            </div>

          )}

        </div>



        <div className="bottom-section">

          <div className="section-header">

            <div className="section-left">

              <span className="menu-icon">💬</span>

              <span>Communication</span>

            </div>

            <span className="chevron">⌄</span>

          </div>



          <div className="sidebar-collapse">≪</div>

        </div>

      </aside>



      <main

        className="main-content"

        style={{

          flex: 1,

          width: "100%",

          minWidth: 0,

          display: "flex",

          alignItems: "stretch",

          justifyContent: "stretch",

          boxSizing: "border-box",

          padding: 0,

          background: "#f7f4ef",

        }}

      >

        <div

          className="page-area"

          style={{

            flex: 1,

            width: "100%",

            minWidth: 0,

            maxWidth: "none",

            display: "block",

            boxSizing: "border-box",

            background: "#ffffff",

            minHeight: "100vh",

            padding: "32px",

          }}

        >

          <Routes>
            <Route
              path="billing/fees"
              element={
                <Fees
                  onAdd={() => {
                    setManageFeeId(null);
                    navigate("/dashboard/billing/fees/new");
                  }}
                  onManage={(feeId) => {
                    setManageFeeId(feeId);
                    navigate(`/dashboard/billing/fees/${encodeURIComponent(String(feeId))}`);
                  }}
                />
              }
            />
            <Route
              path="billing/fees/new"
              element={
                <FeeUpsert
                  feeId={null}
                  onBack={() => navigate("/dashboard/billing/fees")}
                  onSaved={() => navigate("/dashboard/billing/fees")}
                />
              }
            />
            <Route
              path="billing/fees/:feeId"
              element={<FeeUpsertRoute />}
            />
            <Route path="*" element={renderPage()} />
          </Routes>

        </div>

      </main>

    </div>

  );

 }