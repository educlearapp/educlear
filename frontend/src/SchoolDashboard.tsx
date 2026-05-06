import { useEffect, useMemo, useState } from "react";



import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";



import AddLearner from "./AddLearner";



import TeacherPerformance from "./TeacherPerformance";



import Payroll from "./Payroll";



import Fees from "./Fees";



import FeeUpsert from "./FeeUpsert";



import SchoolProfilePage from "./pages/SchoolProfilePage";



import { API_URL } from "./api";



import logo from "./assets/logo.png";



import { useSchoolId } from "./useSchoolId";



import "./App.css";



type PageKey =



  | "dashboard"



  | "schoolProfile"



  | "schoolPackage"



  | "schoolCredits"



  | "schoolUsers"



  | "schoolMore"



  | "registrations"



  | "learnerProfile"



  | "addLearner"



  | "classrooms"



  | "groups"



  | "employees"



  | "teacherPerformance"



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



  | "billing-more";



type TeacherPerformanceRecord = {



  id: string;



  teacherName: string;



  teacherEmail?: string | null;



  finalScore: number;



  performanceLevel: string;



  createdAt?: string;



};



type ParentDraft = {



  id?: string;



  relationship?: string;



  firstName?: string;



  name?: string;



  lastName?: string;



  surname?: string;



  cell?: string;



  phone?: string;



  mobile?: string;



  email?: string;



  work?: string;



  workPhone?: string;



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



export default function SchoolDashboard() {



  const navigate = useNavigate();



  const location = useLocation();



  const schoolId = useSchoolId();



  const GOLD = "#d4af37";



  const BLACK = "#050505";



  const [activePage, setActivePage] = useState<PageKey>("dashboard");



  const [adminOpen, setAdminOpen] = useState(true);



  const [schoolsOpen, setSchoolsOpen] = useState(false);



  const [billingOpen, setBillingOpen] = useState(true);



  const [selectedPackage, setSelectedPackage] = useState("starter");



  const [manageFeeId, setManageFeeId] = useState<string | null>(null);



  const [learners, setLearners] = useState<any[]>([]);



  const [parents, setParents] = useState<any[]>([]);



  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);



  const [showUnenrolled, setShowUnenrolled] = useState(false);



  const [searchText, setSearchText] = useState("");



  const [selectedParent, setSelectedParent] = useState<any | null>(null);



  const [parentMode, setParentMode] = useState<"none" | "add" | "existing" | "manage">("none");



  const [parentDraft, setParentDraft] = useState<ParentDraft>({});



  const [selectedStatementAccount, setSelectedStatementAccount] = useState<any | null>(null);



  const [selectedInvoiceAccount, setSelectedInvoiceAccount] = useState<any | null>(null);



  const [parentIdInput, setParentIdInput] = useState("");



  const [feeStatus, setFeeStatus] = useState("GREEN");



  const [feeOutstandingAmount, setFeeOutstandingAmount] = useState(0);



  const [feeSchool, setFeeSchool] = useState("No record found");



  const [feeParentName, setFeeParentName] = useState("-");



  const [feeMessage, setFeeMessage] = useState("");



  const [feeLoading, setFeeLoading] = useState(false);



  const [topPerformer, setTopPerformer] = useState<TeacherPerformanceRecord | null>(null);



  const [topPerformerLoading, setTopPerformerLoading] = useState(false);



  const [profileMoreOpen, setProfileMoreOpen] = useState(false);



  const [profileTab, setProfileTab] = useState<



    "general" | "billing" | "medical" | "groups" | "other" | "extra"



  >("general");



  const go = (page: PageKey) => {



    setActivePage(page);



    if (location.pathname.startsWith("/dashboard/billing/")) {



      navigate("/dashboard");



    }



  };



  const actionBtn = {



    padding: "10px 16px",



    borderRadius: "10px",



    border: "1px solid rgba(15, 23, 42, 0.14)",



    background: "#ffffff",



    fontWeight: 800,



    fontSize: "13px",



    color: "#0f172a",



    boxShadow: "0 4px 10px rgba(15, 23, 42, 0.05)",



    cursor: "pointer",



  };



  const goldBtn = {



    ...actionBtn,



    border: "1px solid rgba(212,175,55,0.7)",



    background: "linear-gradient(135deg, #d4af37, #f5d06f)",



    color: "#111827",



    boxShadow: "0 8px 18px rgba(212,175,55,0.28)",



  };



  const dangerBtn = {



    ...actionBtn,



    color: "#b91c1c",



    border: "1px solid rgba(185,28,28,0.24)",



    background: "#ffffff",



  };



  const selectStyle = {



    padding: "10px 12px",



    borderRadius: "10px",



    border: "1px solid rgba(15, 23, 42, 0.12)",



    background: "#ffffff",



    fontSize: "13px",



    color: "#0f172a",



  };



  const inputStyle = {



    width: "100%",



    padding: "10px 11px",



    borderRadius: "6px",



    border: "1px solid #cbd5e1",



    background: "#ffffff",



    fontSize: "13px",



    color: "#0f172a",



    boxSizing: "border-box" as const,



  };



  const labelStyle = {



    fontSize: "13px",



    fontWeight: 800,



    color: "#334155",



    textAlign: "right" as const,



    paddingTop: "10px",



  };



  const th = {



    textAlign: "left" as const,



    padding: "10px 12px",



    fontSize: "12px",



    color: "#334155",



    fontWeight: 900,



    background: "#f1f5f9",



    borderBottom: "1px solid #cbd5e1",



  };



  const td = {



    padding: "10px 12px",



    color: "#0f172a",



    borderBottom: "1px solid #e5e7eb",



    fontSize: "13px",



  };



  const formatAge = (birthDate?: string | null) => {



    if (!birthDate) return "-";



    const dob = new Date(birthDate);



    const today = new Date();



    if (Number.isNaN(dob.getTime())) return "-";



    let years = today.getFullYear() - dob.getFullYear();



    let months = today.getMonth() - dob.getMonth();



    if (months < 0 || (months === 0 && today.getDate() < dob.getDate())) {



      years--;



      months += 12;



    }



    if (years <= 0) return `${months} months`;



    return `${years} years${months > 0 ? ` and ${months} months` : ""}`;



  };



  const formatDate = (value?: string | null) => {



    if (!value) return "";



    const d = new Date(value);



    if (Number.isNaN(d.getTime())) return String(value);



    return d.toISOString().slice(0, 10).replaceAll("-", "/");



  };



  const formatMoney = (value: number) =>



    `R ${value.toLocaleString("en-ZA", {



      minimumFractionDigits: 2,



      maximumFractionDigits: 2,



    })}`;



  const learnerFullName = (learner: any) =>



    `${learner?.firstName || ""} ${learner?.lastName || learner?.surname || ""}`.trim();



  const learnerClassroom = (learner: any) =>



    learner?.grade || learner?.className || learner?.classroom || "";



  const parentName = (parent: any) => parent?.firstName || parent?.name || "";



  const parentSurname = (parent: any) => parent?.lastName || parent?.surname || "";



  const parentCell = (parent: any) => parent?.cell || parent?.phone || parent?.mobile || "";



  const parentWork = (parent: any) => parent?.workPhone || parent?.work || "";



  const learnerParents = (learner: any) => {



    const learnerId = String(learner?.id || "");



    const learnerSurname = String(learner?.lastName || learner?.surname || "")



      .trim()



      .toLowerCase();



    const learnerFamilyId = String(



      learner?.familyAccountId ||



        learner?.familyAccount?.id ||



        learner?.familyId ||



        learner?.accountId ||



        ""



    );



    const embeddedParents = [



      ...(Array.isArray(learner?.parents) ? learner.parents : []),



      ...(Array.isArray(learner?.parentLinks)



        ? learner.parentLinks.map((link: any) => link.parent || link).filter(Boolean)



        : []),



    ];



    if (embeddedParents.length > 0) return embeddedParents;



    return parents.filter((parent: any) => {



      const directLearnerIds = [



        parent.learnerId,



        parent.childId,



        parent.studentId,



        parent.learner?.id,



        parent.child?.id,



      ]



        .filter(Boolean)



        .map(String);



      const nestedLearnerIds = Array.isArray(parent.learners)



        ? parent.learners



            .map((item: any) => item?.id || item?.learnerId || item?.learner?.id)



            .filter(Boolean)



            .map(String)



        : [];



      const parentFamilyId = String(



        parent.familyAccountId ||



          parent.familyAccount?.id ||



          parent.familyId ||



          parent.accountId ||



          ""



      );



      const pSurname = String(parent.lastName || parent.surname || "").trim().toLowerCase();



      const linkedByLearnerId = [...directLearnerIds, ...nestedLearnerIds].includes(learnerId);



      const linkedByFamily = learnerFamilyId && parentFamilyId && learnerFamilyId === parentFamilyId;



      const linkedBySurname = learnerSurname && pSurname && learnerSurname === pSurname;



      return linkedByLearnerId || linkedByFamily || linkedBySurname;



    });



  };



  const openLearnerProfile = (learner: any) => {



    setSelectedLearner(learner);



    setSelectedParent(null);



    setParentMode("none");



    localStorage.setItem("selectedLearnerForManage", JSON.stringify(learner));



    setActivePage("learnerProfile");



  };

  useEffect(() => {



    if (activePage !== "dashboard") return;



    if (!schoolId) {



      setTopPerformer(null);



      setTopPerformerLoading(false);



      return;



    }



    let cancelled = false;



    setTopPerformerLoading(true);



    (async () => {



      try {



        const res = await fetch(`${API_URL}/api/teacher-performance/school/${schoolId}`);



        if (!res.ok) {



          if (!cancelled) setTopPerformer(null);



          return;



        }



        const data = (await res.json()) as TeacherPerformanceRecord[];



        if (!cancelled) {



          setTopPerformer(pickTopPerformer(Array.isArray(data) ? data : []));



        }



      } catch {



        if (!cancelled) setTopPerformer(null);



      } finally {



        if (!cancelled) setTopPerformerLoading(false);



      }



    })();



    return () => {



      cancelled = true;



    };



  }, [activePage, schoolId]);



  useEffect(() => {



    const needsData =



      activePage === "registrations" ||



      activePage === "learnerProfile" ||



      activePage === "statements" ||



      activePage === "invoices" ||



      activePage === "dashboard";



    if (!needsData) return;



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



        setLearners(Array.isArray(learnersData?.learners) ? learnersData.learners : []);



        setParents(Array.isArray(parentsData?.parents) ? parentsData.parents : []);



      })



      .catch(() => {



        setLearners([]);



        setParents([]);



      });



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



    const match = path.match(/\/dashboard\/billing\/fees\/([^/]+)\/?$/);



    if (match?.[1]) {



      setManageFeeId(decodeURIComponent(match[1]));



      setActivePage("feeUpsert");



    }



  }, [location.pathname]);



  const handleFeeCheck = async () => {



    try {



      if (!parentIdInput.trim()) return;



      setFeeLoading(true);



      const res = await fetch(`${API_URL}/api/parents/fee-check/${parentIdInput}`);



      const data = await res.json();



      setFeeStatus(data.status || "GREEN");



      setFeeOutstandingAmount(Number(data.outstandingAmount || 0));



      setFeeSchool(data.school || "No record found");



      setFeeParentName(data.parentName || "-");



      if (data.status === "RED") {



        setFeeMessage("Immediate action required – high outstanding balance");



      } else if (data.status === "AMBER") {



        setFeeMessage("Payment arrangement required");



      } else {



        setFeeMessage("Account in good standing");



      }



    } catch {



      setFeeMessage("");



    } finally {



      setFeeLoading(false);



    }



  };



  const filteredLearners = useMemo(() => {



    const base = showUnenrolled



      ? learners



      : learners.filter((learner: any) => (learner.childStatus || "Enrolled") === "Enrolled");



    const q = searchText.trim().toLowerCase();



    if (!q) return base;



    return base.filter((learner: any) => {



      const text = [



        learner.firstName,



        learner.lastName,



        learner.surname,



        learner.grade,



        learner.className,



        learner.classroom,



        learner.childStatus,



      ]



        .filter(Boolean)



        .join(" ")



        .toLowerCase();



      return text.includes(q);



    });



  }, [learners, searchText, showUnenrolled]);



  const totalLearners = filteredLearners.length;



  const totalParents = parents.length;



  const totalBoys = learners.filter(



    (learner: any) => String(learner.gender || "").toLowerCase() === "male"



  ).length;



  const totalGirls = learners.filter(



    (learner: any) => String(learner.gender || "").toLowerCase() === "female"



  ).length;



  const totalClassrooms = new Set(learners.map((learner: any) => learnerClassroom(learner)).filter(Boolean)).size;



  const averageClassSize = totalClassrooms > 0 ? Math.round(learners.length / totalClassrooms) : 0;



  const createLocalParent = (learner: any) => {



    const nowId = `local-parent-${Date.now()}`;



    const newParent = {



      id: nowId,



      relationship: parentDraft.relationship || "-",



      firstName: parentDraft.firstName || parentDraft.name || "",



      name: parentDraft.firstName || parentDraft.name || "",



      lastName: parentDraft.lastName || parentDraft.surname || "",



      surname: parentDraft.lastName || parentDraft.surname || "",



      cell: parentDraft.cell || parentDraft.phone || parentDraft.mobile || "",



      phone: parentDraft.cell || parentDraft.phone || parentDraft.mobile || "",



      email: parentDraft.email || "",



      work: parentDraft.work || parentDraft.workPhone || "",



      workPhone: parentDraft.work || parentDraft.workPhone || "",



      learnerId: learner?.id,



      familyAccountId:



        learner?.familyAccountId ||



        learner?.familyAccount?.id ||



        learner?.familyId ||



        learner?.accountId ||



        "",



    };



    setParents((prev) => [newParent, ...prev]);



    setSelectedParent(newParent);



    setParentDraft({});



    setParentMode("none");



  };



  const updateLocalParent = () => {



    if (!selectedParent) {



      alert("Please select a parent first.");



      return;



    }



    const updatedParent = {



      ...selectedParent,



      relationship: parentDraft.relationship ?? selectedParent.relationship,



      firstName: parentDraft.firstName ?? parentDraft.name ?? selectedParent.firstName,



      name: parentDraft.firstName ?? parentDraft.name ?? selectedParent.name,



      lastName: parentDraft.lastName ?? parentDraft.surname ?? selectedParent.lastName,



      surname: parentDraft.lastName ?? parentDraft.surname ?? selectedParent.surname,



      cell: parentDraft.cell ?? parentDraft.phone ?? parentDraft.mobile ?? selectedParent.cell,



      phone: parentDraft.cell ?? parentDraft.phone ?? parentDraft.mobile ?? selectedParent.phone,



      email: parentDraft.email ?? selectedParent.email,



      work: parentDraft.work ?? parentDraft.workPhone ?? selectedParent.work,



      workPhone: parentDraft.work ?? parentDraft.workPhone ?? selectedParent.workPhone,



    };



    setParents((prev) =>



      prev.map((parent) => String(parent.id) === String(selectedParent.id) ? updatedParent : parent)



    );



    setSelectedParent(updatedParent);



    setParentDraft({});



    setParentMode("none");



  };



  const removeLocalParentLink = () => {



    if (!selectedParent) {



      alert("Please select a parent first.");



      return;



    }



    const ok = window.confirm("Remove this parent from the learner profile?");



    if (!ok) return;



    setParents((prev) => prev.filter((parent) => String(parent.id) !== String(selectedParent.id)));



    setSelectedParent(null);



    setParentMode("none");



  };

  const renderRegistrations = () => (



    <div



      style={{



        padding: "26px",



        background: "#f8fafc",



        minHeight: "100%",



        borderRadius: "20px",



        border: "1px solid rgba(15,23,42,0.08)",



      }}



    >



      <div style={{ marginBottom: "18px" }}>



        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>



          Registrations



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>



          Manage your registrations



        </p>



      </div>



      <div



        style={{



          display: "grid",



          gridTemplateColumns: "repeat(6, minmax(130px, 1fr))",



          gap: "12px",



          marginBottom: "18px",



        }}



      >



        {[



          ["👥", totalLearners, "children"],



          ["👪", totalParents, "parents"],



          ["🚹", totalBoys, "boys"],



          ["🚺", totalGirls, "girls"],



          ["🏫", totalClassrooms, "classrooms"],



          ["☰", averageClassSize, "average classroom size"],



        ].map(([icon, value, label]) => (



          <div



            key={String(label)}



            style={{



              background: "#ffffff",



              border: "1px solid rgba(15,23,42,0.08)",



              borderTop: `3px solid ${GOLD}`,



              borderRadius: "14px",



              padding: "16px",



              display: "flex",



              alignItems: "center",



              gap: "12px",



              boxShadow: "0 10px 26px rgba(15,23,42,0.06)",



            }}



          >



            <div



              style={{



                width: "44px",



                height: "44px",



                borderRadius: "999px",



                background: "linear-gradient(135deg,#111827,#000000)",



                color: GOLD,



                display: "grid",



                placeItems: "center",



                fontSize: "20px",



                border: `1px solid ${GOLD}`,



              }}



            >



              {icon}



            </div>



            <div>



              <div style={{ fontSize: "28px", fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>



                {value}



              </div>



              <div style={{ fontSize: "12px", fontWeight: 800, color: "#64748b" }}>



                {label}



              </div>



            </div>



          </div>



        ))}



      </div>



      <div



        style={{



          background: "#ffffff",



          border: "1px solid rgba(15,23,42,0.10)",



          borderRadius: "12px",



          overflow: "hidden",



          boxShadow: "0 18px 40px rgba(15,23,42,0.08)",



        }}



      >



        <div



          style={{



            padding: "12px 14px",



            borderBottom: "1px solid #e5e7eb",



            fontWeight: 900,



            color: "#0f172a",



          }}



        >



          Children



        </div>



        <div



          style={{



            padding: "10px",



            display: "flex",



            gap: "8px",



            alignItems: "center",



            flexWrap: "wrap",



            borderBottom: "1px solid #e5e7eb",



          }}



        >



          <button



            style={goldBtn}



            onClick={() => {



              localStorage.removeItem("selectedLearnerForManage");



              localStorage.removeItem("selectedLearnerForSibling");



              setActivePage("addLearner");



            }}



          >



            + Add



          </button>



          <button



            style={{



              ...actionBtn,



              opacity: selectedLearner ? 1 : 0.55,



              cursor: selectedLearner ? "pointer" : "not-allowed",



            }}



            disabled={!selectedLearner}



            onClick={() => {



              if (!selectedLearner) return alert("Please select a learner first.");



              localStorage.setItem("selectedLearnerForSibling", JSON.stringify(selectedLearner));



              localStorage.removeItem("selectedLearnerForManage");



              setActivePage("addLearner");



            }}



          >



            + Add Sibling



          </button>



          <button



            style={{



              ...actionBtn,



              opacity: selectedLearner ? 1 : 0.55,



              cursor: selectedLearner ? "pointer" : "not-allowed",



            }}



            disabled={!selectedLearner}



            onClick={() => {



              if (!selectedLearner) return alert("Please select a learner first.");



              openLearnerProfile(selectedLearner);



            }}



          >



            ✎ Manage



          </button>



          <div style={{ flex: 1 }} />



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



            value={searchText}



            onChange={(e) => setSearchText(e.target.value)}



            placeholder="Search"



            style={{



              ...selectStyle,



              width: "220px",



            }}



          />



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>



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



            {filteredLearners.length === 0 ? (



              <tr>



                <td colSpan={5} style={{ ...td, textAlign: "center", padding: "24px" }}>



                  No learners found



                </td>



              </tr>



            ) : (



              filteredLearners.slice(0, 10).map((learner: any, index: number) => {



                const isSelected = String(selectedLearner?.id || "") === String(learner?.id || "");



                return (



                  <tr



                    key={learner.id || index}



                    onClick={() => setSelectedLearner(learner)}



                    onDoubleClick={() => openLearnerProfile(learner)}



                    style={{



                      cursor: "pointer",



                      background: isSelected



                        ? "linear-gradient(90deg, rgba(212,175,55,0.22), #ffffff)"



                        : index % 2 === 0



                        ? "#ffffff"



                        : "rgba(212,175,55,0.07)",



                      outline: isSelected ? `2px solid ${GOLD}` : "none",



                    }}



                  >



                    <td style={td}>



                      <button



                        type="button"



                        onClick={(e) => {



                          e.stopPropagation();



                          openLearnerProfile(learner);



                        }}



                        style={{



                          background: "none",



                          border: "none",



                          padding: 0,



                          color: "#0f172a",



                          fontWeight: 900,



                          cursor: "pointer",



                          textDecoration: "underline",



                          textDecorationColor: GOLD,



                        }}



                      >



                        {learner.firstName || "--"}



                      </button>



                    </td>



                    <td style={td}>{learner.lastName || learner.surname || "--"}</td>



                    <td style={td}>{learnerClassroom(learner) || "-"}</td>



                    <td style={td}>{formatAge(learner.birthDate)}</td>



                    <td style={td}>



                      <span



                        style={{



                          color:



                            (learner.childStatus || "Enrolled") === "Enrolled" ? "#15803d" : "#b91c1c",



                          fontWeight: 900,



                        }}



                      >



                        {learner.childStatus || "Enrolled"}



                      </span>



                    </td>



                  </tr>



                );



              })



            )}



          </tbody>



        </table>



        <div



          style={{



            padding: "10px",



            display: "flex",



            justifyContent: "space-between",



            color: "#64748b",



            fontSize: "12px",



            fontWeight: 800,



          }}



        >



          <span>1 - {Math.min(10, filteredLearners.length)} / {filteredLearners.length}</span>



          <span>Page 1</span>



        </div>



      </div>



    </div>



  );
  const renderLearnerProfile = () => {



    const saved = localStorage.getItem("selectedLearnerForManage");



    const learner =



      selectedLearner ||



      (saved



        ? (() => {



            try {



              return JSON.parse(saved);



            } catch {



              return null;



            }



          })()



        : null);



    if (!learner) {



      return (



        <div style={{ padding: "32px" }}>



          <h1 className="page-title">Registration</h1>



          <p>No learner selected.</p>



          <button style={actionBtn} onClick={() => setActivePage("registrations")}>



            Back



          </button>



        </div>



      );



    }



    const visibleParents = learnerParents(learner);



    const fullName = learnerFullName(learner);



    const classroom = learnerClassroom(learner);



    const field = (label: string, value: any, required = false) => (



      <>



        <label style={labelStyle}>



          {required ? "* " : ""}



          {label}



        </label>



        <input style={inputStyle} defaultValue={value || ""} />



      </>



    );



    const tabStyle = (tab: typeof profileTab) => ({



      padding: "12px 18px",



      border: "none",



      borderRight: "1px solid #cbd5e1",



      background: profileTab === tab ? "#ffffff" : "#f1f5f9",



      color: profileTab === tab ? "#0f172a" : "#64748b",



      fontWeight: 900,



      cursor: "pointer",



      borderTop: profileTab === tab ? `4px solid ${GOLD}` : "4px solid transparent",



    });



    const startAddParent = () => {



      setParentMode("add");



      setSelectedParent(null);



      setParentDraft({



        relationship: "Parent",



        firstName: "",



        lastName: learner.lastName || learner.surname || "",



        cell: "",



        email: "",



        work: "",



      });



    };



    const startManageParent = () => {



      if (!selectedParent) {



        alert("Please select a parent first.");



        return;



      }



      setParentMode("manage");



      setParentDraft({



        relationship: selectedParent.relationship || selectedParent.relation || "",



        firstName: parentName(selectedParent),



        lastName: parentSurname(selectedParent),



        cell: parentCell(selectedParent),



        email: selectedParent.email || "",



        work: parentWork(selectedParent),



      });



    };



    return (



      <div



        style={{



          padding: "26px",



          background: "#f8fafc",



          minHeight: "100%",



          borderRadius: "20px",



          border: "1px solid rgba(15,23,42,0.08)",



        }}



      >



        <div style={{ marginBottom: "12px" }}>



          <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>



            Registration



          </h1>



          <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>



            Manage child and parent information



          </p>



        </div>



        <div style={{ display: "flex", gap: "8px", marginBottom: "14px", position: "relative" }}>



          <button style={actionBtn} onClick={() => setActivePage("registrations")}>



            ← Back



          </button>



          <button



            style={goldBtn}



            onClick={() => alert("Learner save will be connected to the backend in the save pass.")}



          >



            💾 Save



          </button>



          <button style={actionBtn} onClick={() => setProfileMoreOpen((value) => !value)}>



            More Actions⌄



          </button>



          {profileMoreOpen && (



            <div



              style={{



                position: "absolute",



                top: "46px",



                left: "204px",



                width: "220px",



                background: "#ffffff",



                border: "1px solid #cbd5e1",



                borderRadius: "10px",



                boxShadow: "0 18px 40px rgba(15,23,42,0.18)",



                overflow: "hidden",



                zIndex: 30,



              }}



            >



              {["Send Email", "Send SMS", "Unenrol", "Delete"].map((item) => (



                <button



                  key={item}



                  type="button"



                  style={{



                    display: "block",



                    width: "100%",



                    padding: "14px 18px",



                    textAlign: "left",



                    border: "none",



                    borderBottom: "1px solid #e5e7eb",



                    background: "#ffffff",



                    fontWeight: 900,



                    color: item === "Delete" ? "#b91c1c" : "#0f172a",



                    cursor: "pointer",



                  }}



                  onClick={() => {



                    setProfileMoreOpen(false);



                    alert(`${item} will be connected in the next functionality pass.`);



                  }}



                >



                  {item}



                </button>



              ))}



            </div>



          )}



        </div>



        <div



          style={{



            display: "grid",



            gridTemplateColumns: "minmax(620px, 1fr) 380px",



            gap: "28px",



            alignItems: "start",



          }}



        >



          <div



            style={{



              background: "#ffffff",



              border: "1px solid #cbd5e1",



              borderRadius: "10px",



              overflow: "hidden",



              boxShadow: "0 14px 34px rgba(15,23,42,0.07)",



            }}



          >



            <div



              style={{



                display: "grid",



                gridTemplateColumns: "170px 1fr",



                borderBottom: "1px solid #cbd5e1",



                background: "#f8fafc",



              }}



            >



              <div



                style={{



                  padding: "14px",



                  fontWeight: 900,



                  color: "#0f172a",



                  borderRight: "1px solid #cbd5e1",



                }}



              >



                Child



              </div>



              <div style={{ display: "flex" }}>



                <button style={tabStyle("general")} onClick={() => setProfileTab("general")}>



                  General



                </button>



                <button style={tabStyle("billing")} onClick={() => setProfileTab("billing")}>



                  Billing Plan



                </button>



                <button style={tabStyle("medical")} onClick={() => setProfileTab("medical")}>



                  Medical



                </button>



                <button style={tabStyle("groups")} onClick={() => setProfileTab("groups")}>



                  Groups



                </button>



                <button style={tabStyle("other")} onClick={() => setProfileTab("other")}>



                  Other



                </button>



                <button style={tabStyle("extra")} onClick={() => setProfileTab("extra")}>



                  Extra



                </button>



              </div>



            </div>



            {profileTab === "general" ? (



              <div



                style={{



                  padding: "22px",



                  display: "grid",



                  gridTemplateColumns: "150px 1fr",



                  rowGap: "10px",



                  columnGap: "12px",



                }}



              >



                {field("Name / Nickname", learner.firstName, true)}



                {field("Surname", learner.lastName || learner.surname, true)}



                {field("ID No", learner.idNumber)}



                {field("Birth Date", formatDate(learner.birthDate), true)}



                {field("Gender", learner.gender)}



                {field("Classroom", classroom)}



                {field("Home Language", learner.homeLanguage)}



                {field("Nationality", learner.nationality)}



                {field("Religion", learner.religion)}



                {field("Enrolment Date", formatDate(learner.enrolmentDate || learner.createdAt))}



                <label style={labelStyle}>Notes</label>



                <textarea



                  style={{



                    ...inputStyle,



                    minHeight: "105px",



                    resize: "vertical",



                    fontFamily: "inherit",



                  }}



                  defaultValue={learner.notes || ""}



                />



              </div>



            ) : (



              <div style={{ padding: "28px", color: "#64748b", fontWeight: 900 }}>



                {profileTab === "billing" && "Billing plan information will be connected here."}



                {profileTab === "medical" && "Medical information will be connected here."}



                {profileTab === "groups" && "Groups information will be connected here."}



                {profileTab === "other" && "Other learner information will be connected here."}



                {profileTab === "extra" && "Extra learner fields will be connected here."}



              </div>



            )}



          </div>



          <div style={{ paddingTop: "56px" }}>



            <div



              style={{



                width: "205px",



                height: "205px",



                margin: "0 auto 18px",



                border: "1px solid #cbd5e1",



                background: "linear-gradient(180deg,#e2e8f0,#f8fafc)",



                display: "grid",



                placeItems: "center",



                position: "relative",



              }}



            >



              <div



                style={{



                  width: "120px",



                  height: "120px",



                  borderRadius: "999px",



                  background: "#94a3b8",



                }}



              />



              <div



                style={{



                  position: "absolute",



                  right: "14px",



                  bottom: "14px",



                  width: "34px",



                  height: "34px",



                  borderRadius: "999px",



                  background: GOLD,



                  color: "#111827",



                  display: "grid",



                  placeItems: "center",



                  fontWeight: 900,



                  border: "2px solid #ffffff",



                }}



              >



                +



              </div>



            </div>



            <div



              style={{



                display: "grid",



                gridTemplateColumns: "120px 1fr",



                border: "1px solid #e5e7eb",



                background: "#ffffff",



                boxShadow: "0 10px 26px rgba(15,23,42,0.05)",



              }}



            >



              {[



                ["Full Name", fullName || "-"],



                ["Age", formatAge(learner.birthDate)],



                ["Classroom", classroom || "-"],



                ["Notes", learner.notes || ""],



              ].map(([label, value]) => (



                <>



                  <div



                    key={`${label}-label`}



                    style={{



                      padding: "12px",



                      background: "#f1f5f9",



                      fontWeight: 900,



                      color: "#334155",



                      textAlign: "right",



                      borderBottom: "1px solid #e5e7eb",



                    }}



                  >



                    {label}



                  </div>



                  <div



                    key={`${label}-value`}



                    style={{



                      padding: "12px",



                      color: "#0f172a",



                      fontWeight: 800,



                      borderBottom: "1px solid #e5e7eb",



                    }}



                  >



                    {value}



                  </div>



                </>



              ))}



            </div>



          </div>



        </div>
        <div



          style={{



            marginTop: "18px",



            background: "#ffffff",



            border: "1px solid #cbd5e1",



            borderRadius: "10px",



            overflow: "hidden",



            boxShadow: "0 14px 34px rgba(15,23,42,0.07)",



          }}



        >



          <div



            style={{



              padding: "12px 14px",



              borderBottom: "1px solid #cbd5e1",



              fontWeight: 900,



              color: "#0f172a",



              background: "#f8fafc",



              display: "flex",



              justifyContent: "space-between",



              alignItems: "center",



            }}



          >



            <span>Parents</span>



            <span style={{ color: GOLD, fontSize: "12px" }}>



              {visibleParents.length} linked



            </span>



          </div>



          <div



            style={{



              padding: "10px",



              display: "flex",



              gap: "8px",



              borderBottom: "1px solid #e5e7eb",



              flexWrap: "wrap",



            }}



          >



            <button style={goldBtn} onClick={startAddParent}>



              + Add



            </button>



            <button



              style={goldBtn}



              onClick={() => {



                setParentMode("existing");



                setParentDraft({});



              }}



            >



              + Add Existing



            </button>



            <button style={actionBtn} onClick={startManageParent}>



              ✎ Manage



            </button>



            <button style={dangerBtn} onClick={removeLocalParentLink}>



              × Remove



            </button>



          </div>



          {parentMode !== "none" && (



            <div



              style={{



                padding: "14px",



                background: "rgba(212,175,55,0.07)",



                borderBottom: "1px solid #e5e7eb",



              }}



            >



              <div



                style={{



                  fontWeight: 900,



                  color: "#0f172a",



                  marginBottom: "10px",



                }}



              >



                {parentMode === "add" && "Add Parent"}



                {parentMode === "manage" && "Manage Parent"}



                {parentMode === "existing" && "Add Existing Parent"}



              </div>



              {parentMode === "existing" ? (



                <div



                  style={{



                    display: "flex",



                    gap: "8px",



                    flexWrap: "wrap",



                    alignItems: "center",



                  }}



                >



                  <select



                    style={{ ...selectStyle, minWidth: "280px" }}



                    value={selectedParent?.id || ""}



                    onChange={(e) => {



                      const found = parents.find(



                        (parent) => String(parent.id) === String(e.target.value)



                      );



                      setSelectedParent(found || null);



                    }}



                  >



                    <option value="">Select existing parent</option>



                    {parents.map((parent: any, index: number) => (



                      <option key={parent.id || index} value={parent.id || index}>



                        {parentName(parent)} {parentSurname(parent)} - {parentCell(parent)}



                      </option>



                    ))}



                  </select>



                  <button



                    style={goldBtn}



                    onClick={() => {



                      if (!selectedParent) {



                        alert("Please select an existing parent first.");



                        return;



                      }



                      const linkedParent = {



                        ...selectedParent,



                        learnerId: learner.id,



                        familyAccountId:



                          learner.familyAccountId ||



                          learner.familyAccount?.id ||



                          learner.familyId ||



                          learner.accountId ||



                          selectedParent.familyAccountId ||



                          "",



                      };



                      setParents((prev) =>



                        prev.map((parent) =>



                          String(parent.id) === String(selectedParent.id)



                            ? linkedParent



                            : parent



                        )



                      );



                      setSelectedParent(linkedParent);



                      setParentMode("none");



                    }}



                  >



                    Link Selected Parent



                  </button>



                  <button style={actionBtn} onClick={() => setParentMode("none")}>



                    Cancel



                  </button>



                </div>



              ) : (



                <>



                  <div



                    style={{



                      display: "grid",



                      gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",



                      gap: "8px",



                    }}



                  >



                    <input



                      style={inputStyle}



                      placeholder="Relationship"



                      value={parentDraft.relationship || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          relationship: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Name"



                      value={parentDraft.firstName || parentDraft.name || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          firstName: e.target.value,



                          name: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Surname"



                      value={parentDraft.lastName || parentDraft.surname || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          lastName: e.target.value,



                          surname: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Cell"



                      value={parentDraft.cell || parentDraft.phone || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          cell: e.target.value,



                          phone: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Email"



                      value={parentDraft.email || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          email: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Work"



                      value={parentDraft.work || parentDraft.workPhone || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          work: e.target.value,



                          workPhone: e.target.value,



                        }))



                      }



                    />



                  </div>



                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>



                    <button



                      style={goldBtn}



                      onClick={() => {



                        if (parentMode === "add") createLocalParent(learner);



                        if (parentMode === "manage") updateLocalParent();



                      }}



                    >



                      Save Parent



                    </button>



                    <button



                      style={actionBtn}



                      onClick={() => {



                        setParentMode("none");



                        setParentDraft({});



                      }}



                    >



                      Cancel



                    </button>



                  </div>



                </>



              )}



            </div>



          )}



          <table style={{ width: "100%", borderCollapse: "collapse" }}>



            <thead>



              <tr>



                <th style={th}>Relationship</th>



                <th style={th}>Name</th>



                <th style={th}>Surname</th>



                <th style={th}>Cell</th>



                <th style={th}>Email</th>



                <th style={th}>Work</th>



              </tr>



            </thead>



            <tbody>



              {visibleParents.length === 0 ? (



                <tr>



                  <td colSpan={6} style={{ ...td, textAlign: "center", padding: "20px" }}>



                    No parents linked to this learner yet



                  </td>



                </tr>



              ) : (



                visibleParents.map((parent: any, index: number) => {



                  const isSelected =



                    String(selectedParent?.id || "") === String(parent?.id || "");



                  return (



                    <tr



                      key={parent.id || index}



                      onClick={() => {



                        setSelectedParent(parent);



                        setParentMode("none");



                      }}



                      style={{



                        cursor: "pointer",



                        background: isSelected



                          ? "linear-gradient(90deg, rgba(212,175,55,0.25), #ffffff)"



                          : index % 2 === 0



                          ? "#ffffff"



                          : "rgba(212,175,55,0.06)",



                        outline: isSelected ? `2px solid ${GOLD}` : "none",



                      }}



                    >



                      <td style={td}>{parent.relationship || parent.relation || "-"}</td>



                      <td style={td}>{parentName(parent) || "-"}</td>



                      <td style={td}>{parentSurname(parent) || "-"}</td>



                      <td style={td}>{parentCell(parent) || "-"}</td>



                      <td style={td}>{parent.email || "-"}</td>



                      <td style={td}>{parentWork(parent) || "-"}</td>



                    </tr>



                  );



                })



              )}



            </tbody>



          </table>



        </div>



      </div>



    );



  };

  const statementRows = (learners || []).map((learner: any, index: number) => {



    const accountNo =



      learner.familyAccount?.accountRef ||



      learner.admissionNo ||



      learner.admissionNumber ||



      `ACC${String(index + 1).padStart(3, "0")}`;



    const balance = Number(learner.balance || learner.outstandingAmount || 0);



    const lastInvoice = Number(learner.lastInvoiceAmount || learner.tuitionFee || 0);



    const lastPayment = Number(learner.lastPaymentAmount || 0);



    let status = "Up To Date";



    if (balance > 10000) status = "Bad Debt";



    else if (balance > 0) status = "Recently Owing";



    else if (balance < 0) status = "Over Paid";



    return {



      accountNo,



      name: learner.firstName || "-",



      surname: learner.lastName || learner.surname || "-",



      balance,



      lastInvoice,



      lastInvoiceDate: "2026/04/15",



      lastPayment,



      lastPaymentDate: "2026/04/09",



      status,



    };



  });



  const invoiceRows = statementRows;



  const accountsCount = statementRows.length;



  const totalOutstanding = statementRows



    .filter((row) => row.balance > 0)



    .reduce((sum, row) => sum + row.balance, 0);



  const recentlyOwing = statementRows



    .filter((row) => row.balance > 0 && row.balance <= 10000)



    .reduce((sum, row) => sum + row.balance, 0);



  const badDebt = statementRows



    .filter((row) => row.balance > 10000)



    .reduce((sum, row) => sum + row.balance, 0);



  const overPaidAbs = Math.abs(



    statementRows.filter((row) => row.balance < 0).reduce((sum, row) => sum + row.balance, 0)



  );



  const billingSummaryWrap = {



    display: "grid",



    gridTemplateColumns: "repeat(5, minmax(150px, 1fr))",



    gap: "12px",



    marginBottom: "18px",



  };



  const billingSummaryCard = {



    background: "#ffffff",



    border: "1px solid rgba(15,23,42,0.08)",



    borderTop: `3px solid ${GOLD}`,



    borderRadius: "14px",



    padding: "16px",



    boxShadow: "0 10px 26px rgba(15,23,42,0.06)",



  };



  const billingSummaryValue = {



    fontSize: "18px",



    fontWeight: 900,



    color: "#0f172a",



    marginBottom: "4px",



  };



  const billingSummaryLabel = {



    fontSize: "11px",



    fontWeight: 900,



    color: "#64748b",



    textTransform: "uppercase" as const,



    letterSpacing: "0.06em",



  };



  const billingTableCard = {



    background: "#ffffff",



    borderRadius: "14px",



    padding: "14px",



    border: "1px solid rgba(15,23,42,0.08)",



    boxShadow: "0 14px 34px rgba(15,23,42,0.07)",



    overflow: "hidden",



  };



  const renderBillingAccounts = (



    title: string,



    subtitle: string,



    rows: any[],



    selected: any,



    setSelected: (row: any) => void,



    managePage: PageKey,



    storageKey: string,



    buttonLabel = "Manage"



  ) => (



    <div



      style={{



        padding: "26px",



        background: "#f8fafc",



        minHeight: "100%",



        borderRadius: "20px",



        border: "1px solid rgba(15,23,42,0.08)",



      }}



    >



      <div style={{ marginBottom: "18px" }}>



        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>



          {title}



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>{subtitle}</p>



      </div>



      <div style={billingSummaryWrap}>



        <div style={billingSummaryCard}>



          <div style={billingSummaryValue}>{accountsCount}</div>



          <div style={billingSummaryLabel}>Accounts</div>



        </div>



        <div style={billingSummaryCard}>



          <div style={billingSummaryValue}>{formatMoney(totalOutstanding)}</div>



          <div style={billingSummaryLabel}>Total Outstanding</div>



        </div>



        <div style={billingSummaryCard}>



          <div style={billingSummaryValue}>{formatMoney(recentlyOwing)}</div>



          <div style={billingSummaryLabel}>Recently Owing</div>



        </div>



        <div style={billingSummaryCard}>



          <div style={{ ...billingSummaryValue, color: "#b91c1c" }}>{formatMoney(badDebt)}</div>



          <div style={billingSummaryLabel}>Bad Debt</div>



        </div>



        <div style={billingSummaryCard}>



          <div style={{ ...billingSummaryValue, color: "#15803d" }}>{formatMoney(overPaidAbs)}</div>



          <div style={billingSummaryLabel}>Over Paid</div>



        </div>



      </div>



      <div style={billingTableCard}>



        <div



          style={{



            display: "flex",



            justifyContent: "space-between",



            gap: "12px",



            alignItems: "center",



            marginBottom: "12px",



            flexWrap: "wrap",



          }}



        >



          <button



            style={{



              ...goldBtn,



              opacity: selected ? 1 : 0.55,



              cursor: selected ? "pointer" : "not-allowed",



            }}



            disabled={!selected}



            onClick={() => {



              if (!selected) return alert("Please select an account first.");



              localStorage.setItem(storageKey, JSON.stringify(selected));



              setActivePage(managePage);



            }}



          >



            {buttonLabel}



          </button>



          <input placeholder="Search" style={{ ...selectStyle, width: "230px" }} />



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>



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



            {rows.length === 0 ? (



              <tr>



                <td colSpan={7} style={{ ...td, textAlign: "center", padding: "20px" }}>



                  No accounts found



                </td>



              </tr>



            ) : (



              rows.map((row, index) => {



                const isSelected = String(selected?.accountNo || "") === String(row.accountNo || "");



                return (



                  <tr



                    key={`${row.accountNo}-${index}`}



                    onClick={() => setSelected(row)}



                    style={{



                      cursor: "pointer",



                      background: isSelected



                        ? "linear-gradient(90deg, rgba(212,175,55,0.22), #ffffff)"



                        : index % 2 === 0



                        ? "#ffffff"



                        : "rgba(212,175,55,0.06)",



                      outline: isSelected ? `2px solid ${GOLD}` : "none",



                    }}



                  >



                    <td style={td}>{row.accountNo}</td>



                    <td style={td}>{row.name}</td>



                    <td style={td}>{row.surname}</td>



                    <td style={td}>{formatMoney(row.balance)}</td>



                    <td style={td}>{formatMoney(row.lastInvoice)} on {row.lastInvoiceDate}</td>



                    <td style={td}>{formatMoney(row.lastPayment)} on {row.lastPaymentDate}</td>



                    <td style={td}>



                      <span



                        style={{



                          fontWeight: 900,



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



                );



              })



            )}



          </tbody>



        </table>



      </div>



    </div>



  );

  const renderDashboard = () => (



    <div className="dashboard-page">



      <div className="dashboard-header">



        <img src={logo} className="dashboard-logo" alt="EduClear" />



        <div>



          <h1 className="page-title">Overview</h1>



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



                  fontWeight: 700,



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



      <div className="dashboard-overview-stats">



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



            <span className="top-performer-trophy">🏆</span>



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



              <p className="dashboard-card-text-large">



                {Number(topPerformer.finalScore).toFixed(1)} / 10



              </p>



              <p style={{ color: GOLD, fontWeight: 900 }}>



                {topPerformer.performanceLevel}



              </p>



            </>



          )}



        </div>



        <div className="dashboard-card">



          <h3>Learners</h3>



          <h2>{learners.length || 0}</h2>



          <p>



            {totalBoys} boys • {totalGirls} girls



          </p>



        </div>



        <div className="dashboard-card">



          <h3>Classrooms</h3>



          <h2>{totalClassrooms}</h2>



          <p>Average class size: {averageClassSize}</p>



        </div>



        <div className="dashboard-card">



          <h3>Birthdays</h3>



          <h2>1 today</h2>



          <p>View today’s learner birthdays</p>



        </div>



      </div>



    </div>



  );



  const renderPage = () => {



    if (activePage === "addLearner") return <AddLearner />;



    if (activePage === "learnerProfile") return renderLearnerProfile();



    if (activePage === "teacherPerformance") return <TeacherPerformance />;



    if (activePage === "feeUpsert") {



      return (



        <FeeUpsert



          feeId={manageFeeId}



          onBack={() => setActivePage("fees")}



          onSaved={() => setActivePage("fees")}



        />



      );



    }



    switch (activePage) {



      case "dashboard":



        return renderDashboard();



      case "schoolProfile":



        return <SchoolProfilePage go={go} />;



      case "schoolPackage":



        return (



          <div style={{ padding: "32px" }}>



            <h1 className="page-title">Package</h1>



            <p style={{ color: "#475569", marginTop: "-8px" }}>



              Choose the EduClear package that matches your school size.



            </p>



            <div



              style={{



                background: "linear-gradient(135deg, #050505, #111827)",



                color: "#fff",



                borderRadius: "18px",



                padding: "28px",



                marginTop: "24px",



                border: "1px solid rgba(212,175,55,0.35)",



              }}



            >



              <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>



                CURRENT PACKAGE



              </div>



              <h2>{selectedPackage === "unlimited" ? "Unlimited" : "Starter"}</h2>



              <p>



                {selectedPackage === "unlimited"



                  ? "Unlimited learners • Unlimited payroll staff"



                  : "Up to 100 learners • Up to 15 payroll staff"}



              </p>



            </div>



            <div



              style={{



                display: "grid",



                gridTemplateColumns: "1fr 1fr",



                gap: "28px",



                marginTop: "28px",



              }}



            >



              <div



                style={{



                  background: "#fff",



                  borderRadius: "18px",



                  padding: "28px",



                  border: "1px solid rgba(15,23,42,0.08)",



                  boxShadow: "0 12px 30px rgba(15,23,42,0.08)",



                }}



              >



                <h2>Starter</h2>



                <p style={{ color: "#6b7280" }}>For smaller schools getting started.</p>



                <div style={{ marginTop: "20px", lineHeight: 2 }}>



                  ✅ Up to 100 learners<br />



                  ✅ Up to 15 payroll staff<br />



                  ✅ Billing, statements and payments<br />



                  ✅ Registrations and learner records



                </div>



                <button



                  onClick={() => setSelectedPackage("starter")}



                  style={{



                    ...actionBtn,



                    marginTop: "24px",



                    border: `1px solid ${GOLD}`,



                    background: selectedPackage === "starter" ? GOLD : "#fff",



                  }}



                >



                  {selectedPackage === "starter" ? "Current Package" : "Apply Starter Package"}



                </button>



              </div>



              <div



                style={{



                  background: "linear-gradient(135deg, #050505, #111827)",



                  color: "#fff",



                  borderRadius: "18px",



                  padding: "28px",



                  border: `2px solid ${GOLD}`,



                  boxShadow: "0 18px 40px rgba(212,175,55,0.18)",



                }}



              >



                <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>



                  MOST POPULAR



                </div>



                <h2>Unlimited</h2>



                <p style={{ color: "#d1d5db" }}>For growing and larger schools.</p>



                <div style={{ marginTop: "20px", lineHeight: 2 }}>



                  ✅ Unlimited learners<br />



                  ✅ Unlimited payroll staff<br />



                  ✅ All EduClear features<br />



                  ✅ Priority support



                </div>



                <button



                  onClick={() => setSelectedPackage("unlimited")}



                  style={{ ...goldBtn, marginTop: "24px" }}



                >



                  {selectedPackage === "unlimited" ? "Current Package" : "Apply Unlimited Package"}



                </button>



              </div>



            </div>



          </div>



        );



      case "registrations":



        return renderRegistrations();



      case "statements":



        return renderBillingAccounts(



          "Statements",



          "Manage your statement of accounts.",



          statementRows,



          selectedStatementAccount,



          setSelectedStatementAccount,



          "statementManage",



          "selectedStatementAccount",



          "Manage"



        );



      case "invoices":



        return renderBillingAccounts(



          "New Invoice",



          "Create a new invoice.",



          invoiceRows,



          selectedInvoiceAccount,



          setSelectedInvoiceAccount,



          "invoiceCreate",



          "selectedInvoiceAccount",



          "+ Add"



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
  
  
  
          return (
  
  
  
            <div style={{ padding: "32px" }}>
  
  
  
              <h1 className="page-title">Statement</h1>
  
  
  
              <p style={{ color: "#475569", fontWeight: 700 }}>
  
  
  
                {selected
  
  
  
                  ? `Account: ${selected.accountNo} • ${selected.name} ${selected.surname}`
  
  
  
                  : "Select an account first."}
  
  
  
              </p>
  
  
  
              <button style={actionBtn} onClick={() => setActivePage("statements")}>
  
  
  
                Back
  
  
  
              </button>
  
  
  
            </div>
  
  
  
          );
  
  
  
        }
  
  
  
        case "invoiceCreate": {
  
  
  
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
  
  
  
          return (
  
  
  
            <div style={{ padding: "32px" }}>
  
  
  
              <h1 className="page-title">Create Invoice</h1>
  
  
  
              <p style={{ color: "#475569", fontWeight: 700 }}>
  
  
  
                {selected
  
  
  
                  ? `Invoice for ${selected.name} ${selected.surname} • Account ${selected.accountNo}`
  
  
  
                  : "Select an account first."}
  
  
  
              </p>
  
  
  
              <button style={actionBtn} onClick={() => setActivePage("invoices")}>
  
  
  
                Back
  
  
  
              </button>
  
  
  
            </div>
  
  
  
          );
  
  
  
        }
  
  
  
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
  
  
  
        case "schoolCredits":
  
  
  
          return <h1 className="page-title">Credits</h1>;
  
  
  
        case "schoolUsers":
  
  
  
          return <h1 className="page-title">Users</h1>;
  
  
  
        case "schoolMore":
  
  
  
          return <h1 className="page-title">More</h1>;
  
  
  
        default:
  
  
  
          return renderDashboard();
  
  
  
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
  
  
  
            <div
  
  
  
              className="section-header"
  
  
  
              onClick={() => {
  
  
  
                setSchoolsOpen(!schoolsOpen);
  
  
  
                setAdminOpen(false);
  
  
  
                setBillingOpen(false);
  
  
  
              }}
  
  
  
            >
  
  
  
              <div className="section-left">
  
  
  
                <span className="menu-icon">🏫</span>
  
  
  
                <span>Schools</span>
  
  
  
              </div>
  
  
  
              <span className={`chevron ${schoolsOpen ? "open" : ""}`}>⌄</span>
  
  
  
            </div>
  
  
  
            {schoolsOpen && (
  
  
  
              <div className="submenu">
  
  
  
                <div className={`submenu-item ${activePage === "schoolProfile" ? "active" : ""}`} onClick={() => go("schoolProfile")}>Profile</div>
  
  
  
                <div className={`submenu-item ${activePage === "schoolPackage" ? "active" : ""}`} onClick={() => go("schoolPackage")}>Package</div>
  
  
  
                <div className={`submenu-item ${activePage === "schoolCredits" ? "active" : ""}`} onClick={() => go("schoolCredits")}>Credits</div>
  
  
  
                <div className={`submenu-item ${activePage === "schoolUsers" ? "active" : ""}`} onClick={() => go("schoolUsers")}>Users</div>
  
  
  
                <div className={`submenu-item ${activePage === "schoolMore" ? "active" : ""}`} onClick={() => go("schoolMore")}>More</div>
  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
  
  
  
          <div className="main-section">
  
  
  
            <div
  
  
  
              className="section-header"
  
  
  
              onClick={() => {
  
  
  
                setAdminOpen(!adminOpen);
  
  
  
                setSchoolsOpen(false);
  
  
  
                setBillingOpen(false);
  
  
  
              }}
  
  
  
            >
  
  
  
              <div className="section-left">
  
  
  
                <span className="menu-icon">👥</span>
  
  
  
                <span>Administration</span>
  
  
  
              </div>
  
  
  
              <span className={`chevron ${adminOpen ? "open" : ""}`}>⌄</span>
  
  
  
            </div>
  
  
  
            {adminOpen && (
  
  
  
              <div className="submenu">
  
  
  
                <div className={`submenu-item ${activePage === "registrations" ? "active" : ""}`} onClick={() => go("registrations")}>Registrations</div>
  
  
  
                <div className={`submenu-item ${activePage === "addLearner" ? "active" : ""}`} onClick={() => go("addLearner")}>Add Learner</div>
  
  
  
                <div className={`submenu-item ${activePage === "classrooms" ? "active" : ""}`} onClick={() => go("classrooms")}>Classrooms</div>
  
  
  
                <div className={`submenu-item ${activePage === "groups" ? "active" : ""}`} onClick={() => go("groups")}>Groups</div>
  
  
  
                <div className={`submenu-item ${activePage === "employees" ? "active" : ""}`} onClick={() => go("employees")}>Employees</div>
  
  
  
                <div className={`submenu-item ${activePage === "teacherPerformance" ? "active" : ""}`} onClick={() => go("teacherPerformance")}>Teacher Performance</div>
  
  
  
                <div className={`submenu-item ${activePage === "attendance" ? "active" : ""}`} onClick={() => go("attendance")}>Attendance</div>
  
  
  
                <div className={`submenu-item ${activePage === "incidents" ? "active" : ""}`} onClick={() => go("incidents")}>Incidents</div>
  
  
  
                <div className={`submenu-item ${activePage === "lists" ? "active" : ""}`} onClick={() => go("lists")}>Lists & Registers</div>
  
  
  
                <div className={`submenu-item ${activePage === "forms" ? "active" : ""}`} onClick={() => go("forms")}>Forms & Templates</div>
  
  
  
                <div className={`submenu-item ${activePage === "help" ? "active" : ""}`} onClick={() => go("help")}>Help & Tips</div>
  
  
  
                <div className={`submenu-item ${activePage === "more" ? "active" : ""}`} onClick={() => go("more")}>More</div>
  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
  
  
  
          <div className="main-section">
  
  
  
            <div
  
  
  
              className="section-header"
  
  
  
              onClick={() => {
  
  
  
                setBillingOpen(!billingOpen);
  
  
  
                setSchoolsOpen(false);
  
  
  
                setAdminOpen(false);
  
  
  
              }}
  
  
  
            >
  
  
  
              <div className="section-left">
  
  
  
                <span className="menu-icon">▦</span>
  
  
  
                <span>Billing</span>
  
  
  
              </div>
  
  
  
              <span className={`chevron ${billingOpen ? "open" : ""}`}>⌄</span>
  
  
  
            </div>
  
  
  
            {billingOpen && (
  
  
  
              <div className="submenu">
  
  
  
                <div className={`submenu-item ${activePage === "statements" ? "active" : ""}`} onClick={() => go("statements")}>Statements</div>
  
  
  
                <div className={`submenu-item ${activePage === "invoices" ? "active" : ""}`} onClick={() => go("invoices")}>Invoices</div>
  
  
  
                <div className={`submenu-item ${activePage === "payments" ? "active" : ""}`} onClick={() => go("payments")}>Payments</div>
  
  
  
                <div className={`submenu-item ${activePage === "payroll" ? "active" : ""}`} onClick={() => go("payroll")}>Payroll</div>
  
  
  
                <div className={`submenu-item ${activePage === "fees" ? "active" : ""}`} onClick={() => navigate("/dashboard/billing/fees")}>Fees</div>
  
  
  
                <div className={`submenu-item ${activePage === "plans" ? "active" : ""}`} onClick={() => go("plans")}>Billing Plans</div>
  
  
  
                <div className={`submenu-item ${activePage === "runs" ? "active" : ""}`} onClick={() => go("runs")}>Invoice Runs</div>
  
  
  
                <div className={`submenu-item ${activePage === "reports" ? "active" : ""}`} onClick={() => go("reports")}>Billing Reports</div>
  
  
  
                <div className={`submenu-item ${activePage === "documents" ? "active" : ""}`} onClick={() => go("documents")}>Billing Documents</div>
  
  
  
                <div className={`submenu-item ${activePage === "billing-help" ? "active" : ""}`} onClick={() => go("billing-help")}>Help & Tips</div>
  
  
  
                <div className={`submenu-item ${activePage === "billing-more" ? "active" : ""}`} onClick={() => go("billing-more")}>More</div>
  
  
  
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
  
  
  
              <Route path="billing/fees/:feeId" element={<FeeUpsertRoute />} />
  
  
  
              <Route path="*" element={renderPage()} />
  
  
  
            </Routes>
  
  
  
          </div>
  
  
  
        </main>
  
  
  
      </div>
  
  
  
    );
  
  
  
  }