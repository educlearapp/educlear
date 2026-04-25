import { useEffect, useRef, useState } from "react";
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

  | "schoolsProfile"
  | "schoolsPackage"
  | "schoolsCredits"
  | "schoolsUsers"
  | "schoolsMore"

  | "statements"
  | "statementManage"

  | "invoices"
  | "invoiceCreate"
  | "payments"
  | "paymentCreate"
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
  const [paymentsVersion, setPaymentsVersion] = useState(0);
  const [schoolsProfileTab, setSchoolsProfileTab] = useState<
    "general" | "contact" | "address" | "billing" | "password"
  >("general");
  const [manageFeeId, setManageFeeId] = useState<string | null>(null);

  const [schoolsUsersMode, setSchoolsUsersMode] = useState<"list" | "add" | "manage">("list");
  const [schoolsUsersPermPanels, setSchoolsUsersPermPanels] = useState<{
    administration: boolean;
    billing: boolean;
    communication: boolean;
  }>({ administration: false, billing: false, communication: false });
  const [schoolsUsersPerms, setSchoolsUsersPerms] = useState<{



    administration: Record<string, boolean>;
  
  
  
    billing: Record<string, boolean>;
  
  
  
    communication: Record<string, boolean>;
  
  
  
  }>(() => {
  
  
  
    const saved = localStorage.getItem("schoolsUsersPerms");
  
  
  
    return saved
  
  
  
      ? JSON.parse(saved)
  
  
  
      : {
  
  
  
          administration: {},
  
  
  
          billing: {},
  
  
  
          communication: {},
  
  
  
        };
  
  
  
  });
  const [schoolsUsersForm, setSchoolsUsersForm] = useState<{
    firstName: string;
    lastName: string;
    email: string;
  }>({ firstName: "", lastName: "", email: "" });

  

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

  const [schoolsOpen, setSchoolsOpen] = useState(true);



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
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<any | null>(null);
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
  const statementRows = parents.map((p: any, index: number) => {



    const familyRef =
  
  
  
      p.familyAccount?.accountRef ||
  
  
  
      p.accountRef ||
  
  
  
      `ACC${String(index + 1).padStart(3, "0")}`;
  
  
  
    const name = p.name || p.firstName || "-";
  
  
  
    const surname = p.surname || p.lastName || "-";
  
  
  
    const balance = Number(p.outstandingAmount ?? 0);
  
  
  
    const lastInvoiceAmount = Number(p.lastInvoiceAmount || 0);
  
  
  
    const savedPayments = JSON.parse(localStorage.getItem("payments") || "[]");



const accountPayments = savedPayments



  .filter((pay: any) => pay.account?.accountNo === familyRef || pay.accountNo === familyRef)



  .sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));



const lastPaymentRecord = accountPayments[0] || null;



const lastPaymentAmount = lastPaymentRecord ? Number(lastPaymentRecord.amount || 0) : 0;



const lastPaymentDate = lastPaymentRecord?.date || "";
  
  
  
    let status = "Up To Date";
  
  
  
    if (balance > 10000) status = "Bad Debt";
  
  
  
    else if (balance > 0) status = "Recently Owing";
  
  
  
    else if (balance < 0) status = "Over Paid";
  
  
  
    return {
  
  
  
      parentId: p.id,
      accountNo: familyRef,
  
  
  
      name,
  
  
  
      surname,
  
  
  
      balance,
  
  
  
      lastInvoice: lastInvoiceAmount,
  
  
  
      lastInvoiceDate: "2026/04/15",
  
  
  
      lastPayment: lastPaymentAmount,



lastPaymentDate: lastPaymentDate || "-",
  
  
  
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
  
  
  
  const getAccountBalance = (account: any) => {
  
  
  
    if (!account) return 0;
  
  
  
    // Balance is server-backed (Parent.outstandingAmount). Payments are persisted via /api/payments.
    return Number(account.balance || 0);
  
  
  
  };

  type PaymentMethodType = "Cash" | "Cheque" | "Debit Order" | "EFT" | "Credit Card" | "ATM";

  function PaymentCreatePage({ accountRows }: { accountRows: any[] }) {
    const paymentTypes: PaymentMethodType[] = [
      "Cash",
      "Cheque",
      "Debit Order",
      "EFT",
      "Credit Card",
      "ATM",
    ];

    const todayIso = (() => {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    })();

    const [tab, setTab] = useState<"general">("general");
    const [date, setDate] = useState<string>(todayIso);
    const [type, setType] = useState<PaymentMethodType>("Cash");
    const [description, setDescription] = useState<string>("");
    const [amountText, setAmountText] = useState<string>("");
    const [message, setMessage] = useState<string>("");
    const [allocatedAmount, setAllocatedAmount] = useState<number>(0);
    const [detailsSelected, setDetailsSelected] = useState<boolean>(true);

    const didInitSelectedAccountRef = useRef(false);
    useEffect(() => {
      if (didInitSelectedAccountRef.current) return;

      if (selectedPaymentAccount) {
        didInitSelectedAccountRef.current = true;
        return;
      }

      if (accountRows.length > 0) {
        const firstRow = accountRows[0];



const firstRowWithParentId = {



  ...firstRow,



  parentId: firstRow.parentId || firstRow.id || firstRow.parent?.id,



};



setSelectedPaymentAccount(firstRowWithParentId);



localStorage.setItem("selectedPaymentAccount", JSON.stringify(firstRowWithParentId));
        didInitSelectedAccountRef.current = true;
      }
    }, [accountRows, selectedPaymentAccount]);

    const selectedAccount = selectedPaymentAccount || null;

    const paymentAmount = Number(amountText || 0) || 0;
    const unpaidAmount = selectedAccount ? Math.max(getAccountBalance(selectedAccount), 0) : 0;
    const amountAllocated = Math.max(0, Math.min(allocatedAmount, paymentAmount));
    const amountUnallocated = Math.max(0, paymentAmount - amountAllocated);

    useEffect(() => {
      setAllocatedAmount((prev) => Math.max(0, Math.min(prev, paymentAmount)));
    }, [paymentAmount]);

    const savedPayments = JSON.parse(localStorage.getItem("payments") || "[]");



const accountPaymentRows = savedPayments



  .filter((pay: any) =>



    pay.account?.accountNo === selectedAccount?.accountNo ||



    pay.accountNo === selectedAccount?.accountNo ||



    pay.parentId === selectedAccount?.parentId



  )



  .map((pay: any, index: number) => ({



    auditNo: pay.auditNo || `PAY-${index + 1}`,



    type: "Payment",



    date: pay.date || "-",



    reference: selectedAccount?.accountNo || "-",



    description: pay.description || pay.method || "Payment",



    unpaidAmount: 0,



    allocated: Number(pay.amount || 0),



  }));



const invoiceRow = selectedAccount



  ? {



      auditNo: `AUD-${selectedAccount.accountNo}`,



      type: "Invoice",



      date: selectedAccount.lastInvoiceDate || "-",



      reference: selectedAccount.accountNo,



      description: "Outstanding balance",



      unpaidAmount,



      allocated: 0,



    }



  : null;



const detailsRows = invoiceRow



  ? [invoiceRow, ...accountPaymentRows]



  : accountPaymentRows;

    const autoAllocate = () => {
      const next = Math.min(paymentAmount, unpaidAmount);
      setAllocatedAmount(next);
    };

    const unallocateAll = () => {
      setAllocatedAmount(0);
    };

    const allocate = () => {
      if (!detailsSelected) return;
      const next = Math.min(paymentAmount, unpaidAmount);
      setAllocatedAmount(next);
    };

    const unallocate = () => {
      if (!detailsSelected) return;
      setAllocatedAmount(0);
    };

    const onBack = () => {
      setActivePage("payments");
    };

    const onSave = async () => {
      if (!selectedAccount) {
        alert("Please select an account.");
        return;
      }
      if (!date) {
        alert("Please select a date.");
        return;
      }
      if (!paymentAmount || paymentAmount <= 0) {
        alert("Please enter a valid amount.");
        return;
      }
      if (!selectedAccount.parentId) {
        alert("This account is missing a parentId. Please refresh and try again.");
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: selectedAccount.parentId,
            amount: paymentAmount,
            method: type,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || "Failed to save payment");
        }

        // Optional local audit trail for UI/history; balances come from server.
        const existing = JSON.parse(localStorage.getItem("payments") || "[]");
        const auditNo = `PAY-${Date.now()}`;
        const newPayment = {
          auditNo,
          parentId: selectedAccount.parentId,
          account: {
            accountNo: selectedAccount.accountNo,
            name: selectedAccount.name,
            surname: selectedAccount.surname,
          },
          date,
          type,
          description,
          amount: paymentAmount,
          message,
          allocated: amountAllocated,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem("payments", JSON.stringify([newPayment, ...existing]));

        setParents((prev) =>
          prev.map((p: any) =>
            p.id === selectedAccount.parentId
              ? { ...p, outstandingAmount: Number(p.outstandingAmount || 0) - paymentAmount }
              : p
          )
        );
        setPaymentsVersion((v) => v + 1);
        setActivePage("payments");
      } catch (e: any) {
        console.error(e);
        alert(e?.message || "Failed to save payment.");
      }
    };

    const panelCard: React.CSSProperties = {
      background: "#ffffff",
      border: "1px solid rgba(15, 23, 42, 0.10)",
      borderRadius: "18px",
      boxShadow: "0 10px 26px rgba(15, 23, 42, 0.06)",
      overflow: "hidden",
    };

    const labelStyle: React.CSSProperties = {
      fontSize: "13px",
      color: "#475569",
      fontWeight: 700,
      marginBottom: "6px",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    };

    const inputStyle: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "12px",
      border: "1px solid rgba(15, 23, 42, 0.14)",
      outline: "none",
      fontSize: "14px",
      background: "#fff",
    };

    const readOnlyStyle: React.CSSProperties = {
      ...inputStyle,
      background: "rgba(148, 163, 184, 0.12)",
      color: "#0f172a",
    };

    return (
      <div style={{ padding: "32px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "18px",
          }}
        >
          <div>
            <h1 className="page-title">Create Payment » Create a payment.</h1>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button className="action-btn" onClick={onBack}>
              Back
            </button>
            <button className="action-btn" onClick={onSave}>
              Save
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.25fr 0.75fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          <div style={panelCard}>
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
                background:
                  "linear-gradient(180deg, rgba(255, 215, 0, 0.20) 0%, rgba(255, 215, 0, 0.08) 100%)",
              }}
            >
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Payment</div>

              <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                <button
                  onClick={() => setTab("general")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "999px",
                    border: "1px solid rgba(15, 23, 42, 0.12)",
                    background: tab === "general" ? "rgba(15, 23, 42, 0.92)" : "rgba(255,255,255,0.7)",
                    color: tab === "general" ? "#ffd700" : "#0f172a",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  General
                </button>
              </div>
            </div>

            <div style={{ padding: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <div style={labelStyle}>Account</div>
                  <select
                    value={selectedPaymentAccount ? String(selectedPaymentAccount.accountNo) : ""}
                    onChange={(e) => {
                      const nextAccountNo = String(e.target.value || "");
                      const matchedAccount =
                        accountRows.find((r) => String(r.accountNo) === String(nextAccountNo)) || null;
                        setSelectedPaymentAccount(

                          matchedAccount
                        
                            ? {
                        
                                ...matchedAccount,
                        
                                parentId:
                        
                                  matchedAccount.parentId ||
                        
                                  matchedAccount.parent?.id ||
                        
                                  matchedAccount.id,
                        
                              }
                        
                            : null
                        
                        );
                      if (matchedAccount) {
                        if (matchedAccount) {



                          const fixedAccount = {
                        
                        
                        
                            ...matchedAccount,
                        
                        
                        
                            parentId:
                        
                        
                        
                              matchedAccount.parentId ||
                        
                        
                        
                              matchedAccount.parent?.id ||
                        
                        
                        
                              matchedAccount.id,
                        
                        
                        
                          };
                        
                        
                        
                          localStorage.setItem("selectedPaymentAccount", JSON.stringify(fixedAccount));
                        
                        
                        
                        }
                      }
                    }}
                    style={inputStyle}
                  >
                    <option value="">Select account...</option>
                    {accountRows.map((row) => (
                      <option key={String(row.accountNo)} value={String(row.accountNo)}>
                        {row.accountNo} — {row.name} {row.surname}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={labelStyle}>Date</div>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
                </div>

                <div>
                  <div style={labelStyle}>Type</div>
                  <select value={type} onChange={(e) => setType(e.target.value as PaymentMethodType)} style={inputStyle}>
                    {paymentTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={labelStyle}>Amount</div>
                  <input
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    placeholder="0.00"
                    style={inputStyle}
                  />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={labelStyle}>Description</div>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={labelStyle}>Message</div>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Amount Allocated</div>
                  <input value={formatMoney(amountAllocated)} readOnly style={readOnlyStyle} />
                </div>

                <div>
                  <div style={labelStyle}>Amount Unallocated</div>
                  <input value={formatMoney(amountUnallocated)} readOnly style={readOnlyStyle} />
                </div>
              </div>
            </div>
          </div>

          <div style={panelCard}>
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
                background:
                  "linear-gradient(180deg, rgba(15, 23, 42, 0.94) 0%, rgba(15, 23, 42, 0.85) 100%)",
                color: "#ffd700",
                fontWeight: 900,
              }}
            >
              Account Summary
            </div>
            <div style={{ padding: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 12px", fontSize: "14px" }}>
                <div style={{ color: "#475569", fontWeight: 800 }}>Account No</div>
                <div style={{ fontWeight: 800, color: "#0f172a" }}>{selectedAccount?.accountNo || "-"}</div>

                <div style={{ color: "#475569", fontWeight: 800 }}>Children</div>
                <div style={{ color: "#0f172a" }}>-</div>

                <div style={{ color: "#475569", fontWeight: 800 }}>Parents</div>
                <div style={{ color: "#0f172a" }}>
                  {selectedAccount ? `${selectedAccount.name || "-"} ${selectedAccount.surname || "-"}` : "-"}
                </div>

                <div style={{ color: "#475569", fontWeight: 800 }}>Balance</div>
                <div style={{ fontWeight: 900, color: "#0f172a" }}>
                  {selectedAccount ? formatMoney(getAccountBalance(selectedAccount)) : formatMoney(0)}
                </div>

                <div style={{ color: "#475569", fontWeight: 800 }}>Notes</div>
                <div style={{ color: "#0f172a" }}>-</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "16px", ...panelCard }}>
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              background:
                "linear-gradient(180deg, rgba(255, 215, 0, 0.16) 0%, rgba(255, 215, 0, 0.06) 100%)",
            }}
          >
            <div style={{ fontWeight: 900, color: "#0f172a" }}>Payment Details</div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button className="action-btn" onClick={autoAllocate}>
                Auto Allocate
              </button>
              <button className="action-btn" onClick={unallocateAll}>
                Unallocate All
              </button>
              <button className="action-btn" onClick={allocate}>
                Allocate
              </button>
              <button className="action-btn" onClick={unallocate}>
                Unallocate
              </button>
            </div>
          </div>

          <div style={{ padding: "16px" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Audit No</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th>Unpaid Amount</th>
                  <th>Allocated</th>
                </tr>
              </thead>
              <tbody>



{detailsRows.length === 0 ? (



  <tr>



    <td colSpan={7}>No transactions found</td>



  </tr>



) : (



  detailsRows.map((row: any, i: number) => (



    <tr key={i}>



      <td>{row.auditNo}</td>



      <td>{row.type}</td>



      <td>{row.date}</td>



      <td>{row.reference}</td>



      <td>{row.description}</td>



      <td>{formatMoney(row.unpaidAmount)}</td>



      <td>{formatMoney(row.allocated)}</td>



    </tr>



  ))



)}



</tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
  
   
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

      case "schoolsProfile":
        return (
          <div
            style={{
              padding: "24px",
              background: "#f3f4f6",
              minHeight: "100%",
              borderRadius: "6px",
              border: "1px solid rgba(15, 23, 42, 0.10)",
              boxShadow: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "16px",
              }}
            >
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "28px",
                    fontWeight: 800,
                    letterSpacing: "-0.01em",
                    color: "#0f172a",
                  }}
                >
                  Profile
                </h1>
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "14px",
                    color: "#64748b",
                    fontWeight: 600,
                  }}
                >
                  Manage your profile
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => go("dashboard")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "4px",
                    border: "1px solid rgba(15, 23, 42, 0.18)",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 700,
                    fontSize: "13px",
                    boxShadow: "none",
                    cursor: "pointer",
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "4px",
                    border: "1px solid rgba(15, 23, 42, 0.18)",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 700,
                    fontSize: "13px",
                    boxShadow: "none",
                    cursor: "pointer",
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "4px",
                    border: "1px solid rgba(15, 23, 42, 0.18)",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 700,
                    fontSize: "13px",
                    boxShadow: "none",
                    cursor: "pointer",
                  }}
                >
                  More Actions
                </button>
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid rgba(15, 23, 42, 0.14)",
                borderRadius: "6px",
                padding: "14px",
                boxShadow: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "14px",
                  flexWrap: "wrap",
                  paddingBottom: "10px",
                  borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 800,
                    color: "#0f172a",
                    letterSpacing: "-0.01em",
                  }}
                >
                  School
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 0,
                    flexWrap: "wrap",
                    borderRadius: "4px",
                    border: "1px solid rgba(15, 23, 42, 0.14)",
                    background: "#f8fafc",
                    overflow: "hidden",
                  }}
                >
                  {(
                    [
                      { key: "general", label: "General" },
                      { key: "contact", label: "Contact" },
                      { key: "address", label: "Address" },
                      { key: "billing", label: "Billing" },
                      { key: "password", label: "Password" },
                    ] as const
                  ).map((t) => {
                    const active = schoolsProfileTab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setSchoolsProfileTab(t.key)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 0,
                          border: "none",
                          borderRight: "1px solid rgba(15, 23, 42, 0.14)",
                          background: active ? "#ffffff" : "#f8fafc",
                          color: active ? "#0f172a" : "#475569",
                          fontWeight: active ? 800 : 700,
                          fontSize: "13px",
                          boxShadow: "none",
                          borderBottom: active
                            ? "2px solid rgba(15, 23, 42, 0.85)"
                            : "2px solid transparent",
                          cursor: "pointer",
                        }}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(() => {
                const labelColWidth = 220;

                const Section = ({ children }: { children: React.ReactNode }) => (
                  <div
                    style={{
                      border: "1px solid rgba(15, 23, 42, 0.12)",
                      borderRadius: "4px",
                      overflow: "hidden",
                      background: "#ffffff",
                    }}
                  >
                    {children}
                  </div>
                );

                const Row = ({
                  label,
                  value,
                  compactValue,
                }: {
                  label: string;
                  value: React.ReactNode;
                  compactValue?: boolean;
                }) => (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `${labelColWidth}px 1fr`,
                      gap: "12px",
                      alignItems: compactValue ? "start" : "center",
                      padding: "10px 12px",
                      borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "#334155",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 650,
                        color: "#0f172a",
                        lineHeight: 1.4,
                        wordBreak: "break-word",
                        whiteSpace: "pre-line",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                );

                const lastRowStyle = { borderBottom: "none" as const };

                if (schoolsProfileTab === "general") {
                  return (
                    <Section>
                      <Row label="Business Name" value="Da Silva Academy" />
                      <Row label="Registered Email" value="dasilvaacademy@gmail.com" />
                      <Row label="Package" value="Legendary Package" />
                      <Row label="Package Until" value="8 October 2026" />
                      <Row label="Automatic Renew" value="No" />
                      <div style={lastRowStyle}>
                        <Row label="Automatic Billing" value="No" />
                      </div>
                    </Section>
                  );
                }

                if (schoolsProfileTab === "contact") {
                  return (
                    <Section>
                      <Row label="Tel No" value="0145925613" />
                      <Row label="Cell No" value="0825765507" />
                      <Row label="Fax No" value="0145925613" />
                      <div style={lastRowStyle}>
                        <Row label="Email" value="tonydasilva@dasilvaacademy.com" />
                      </div>
                    </Section>
                  );
                }

                if (schoolsProfileTab === "address") {
                  return (
                    <Section>
                      <Row
                        label="Physical Address"
                        compactValue
                        value={`212 Klopper Street\nRustenburg\n0299\nPhysical Address Line 4`}
                      />
                      <div style={lastRowStyle}>
                        <Row
                          label="Postal Address"
                          compactValue
                          value={`212 Klopper Street\nBodorp\nRustenburg\n0299`}
                        />
                      </div>
                    </Section>
                  );
                }

                if (schoolsProfileTab === "billing") {
                  return (
                    <Section>
                      <div style={lastRowStyle}>
                        <Row
                          label="Banking Details"
                          compactValue
                          value={`Da Silva Academy\nTymeBank\nFNB\nAccount number: 53001618107\nAccount Number: 62839\nBranch code: 678910\nRustenburg Square Bra`}
                        />
                      </div>
                    </Section>
                  );
                }

                return (
                  <Section>
                    <Row
                      label="New Password"
                      value={
                        <input
                          type="password"
                          placeholder="New Password"
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            padding: "8px 10px",
                            borderRadius: "4px",
                            border: "1px solid rgba(15, 23, 42, 0.18)",
                            background: "#ffffff",
                            outline: "none",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#0f172a",
                          }}
                        />
                      }
                    />
                    <div style={lastRowStyle}>
                      <Row
                        label="Confirm Password"
                        value={
                          <input
                            type="password"
                            placeholder="Confirm Password"
                            style={{
                              width: "100%",
                              maxWidth: 420,
                              padding: "8px 10px",
                              borderRadius: "4px",
                              border: "1px solid rgba(15, 23, 42, 0.18)",
                              background: "#ffffff",
                              outline: "none",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: "#0f172a",
                            }}
                          />
                        }
                      />
                    </div>
                  </Section>
                );
              })()}
            </div>
          </div>
        );

      case "schoolsPackage":
      case "schoolsCredits":
      case "schoolsMore":
        return (
          <div style={{ padding: "32px" }}>
            <h1 className="page-title">Coming Soon</h1>
            <p>This section will be available soon.</p>
          </div>
        );

      case "schoolsUsers": {
        const administrationPages = [
          { key: "registrations", label: "Registrations" },
          { key: "addLearner", label: "Add Learner" },
          { key: "classrooms", label: "Classrooms" },
          { key: "groups", label: "Groups" },
          { key: "employees", label: "Employees" },
          { key: "teacherPerformance", label: "Teacher Performance" },
          { key: "attendance", label: "Attendance" },
          { key: "incidents", label: "Incidents" },
          { key: "listsAndRegisters", label: "Lists & Registers" },
          { key: "formsAndTemplates", label: "Forms & Templates" },
        ] as const;

        const billingPages = [
          { key: "fees", label: "Fees" },
          { key: "statements", label: "Statements" },
          { key: "invoices", label: "Invoices" },
          { key: "payments", label: "Payments" },
          { key: "payroll", label: "Payroll" },
          { key: "billingPlans", label: "Billing Plans" },
          { key: "billingReports", label: "Billing Reports" },
          { key: "billingDocuments", label: "Billing Documents" },
          { key: "billingHelp", label: "Help & Tips" },
          { key: "billingMore", label: "More" },
        ] as const;

        const communicationPages = [
          { key: "sms", label: "SMS" },
          { key: "email", label: "Email" },
          { key: "templates", label: "Templates" },
          { key: "communicationReports", label: "Communication Reports" },
        ] as const;

        const initPerms = (preset?: {
          administration?: string[];
          billing?: string[];
          communication?: string[];
        }) => {
          const presetAdmin = new Set(preset?.administration ?? []);
          const presetBilling = new Set(preset?.billing ?? []);
          const presetComms = new Set(preset?.communication ?? []);

          const admin: Record<string, boolean> = {};
          const billing: Record<string, boolean> = {};
          const comms: Record<string, boolean> = {};

          administrationPages.forEach((p) => (admin[p.key] = presetAdmin.has(p.key)));
          billingPages.forEach((p) => (billing[p.key] = presetBilling.has(p.key)));
          communicationPages.forEach((p) => (comms[p.key] = presetComms.has(p.key)));

          setSchoolsUsersPerms({ administration: admin, billing, communication: comms });
          const savedPerms = localStorage.getItem("schoolsUsersPerms");



if (savedPerms) {



  setSchoolsUsersPerms(JSON.parse(savedPerms));



} else {



  setSchoolsUsersPerms({ administration: admin, billing, communication: comms });



}
        };

        const countSelected = (section: "administration" | "billing" | "communication") => {
          const record = schoolsUsersPerms[section] || {};
          return Object.values(record).filter(Boolean).length;
        };

        const summary = (section: "administration" | "billing" | "communication", total: number) => {
          const selected = countSelected(section);
          if (selected === 0) return "No Access";
          if (selected === total) return "Full Access";
          return `${selected} pages selected`;
        };

        const togglePage = (



          section: "administration" | "billing" | "communication",
        
        
        
          page: string
        
        
        
        ) => {
        
        
        
          setSchoolsUsersPerms((prev) => {
        
        
        
            const updated = {
        
        
        
              ...prev,
        
        
        
              [section]: {
        
        
        
                ...(prev[section] || {}),
        
        
        
                [page]: !prev[section]?.[page],
        
        
        
              },
        
        
        
            };
        
        
        
            localStorage.setItem("schoolsUsersPerms", JSON.stringify(updated));
        
        
        
            return updated;
        
        
        
          });
        
        
        
        };

        const topWrap: React.CSSProperties = {
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "16px",
        };

        const actionBtn: React.CSSProperties = {
          padding: "8px 12px",
          borderRadius: "4px",
          border: "1px solid rgba(15, 23, 42, 0.18)",
          background: "#ffffff",
          color: "#0f172a",
          fontWeight: 700,
          fontSize: "13px",
          boxShadow: "none",
          cursor: "pointer",
        };

        const card: React.CSSProperties = {
          background: "#ffffff",
          border: "1px solid rgba(15, 23, 42, 0.14)",
          borderRadius: "6px",
          padding: "14px",
          boxShadow: "none",
        };

        const labelColWidth = 220;
        const Row = ({
          label,
          value,
          compactValue,
        }: {
          label: string;
          value: React.ReactNode;
          compactValue?: boolean;
        }) => (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${labelColWidth}px 1fr`,
              gap: "12px",
              alignItems: compactValue ? "start" : "center",
              padding: "10px 12px",
              borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#334155" }}>{label}</div>
            <div>{value}</div>
          </div>
        );

        const sectionBox = (opts: {
          title: "Administration Access" | "Billing Access" | "Communication Access";
          section: "administration" | "billing" | "communication";
          pages: readonly { key: string; label: string }[];
        }) => {
          const open = schoolsUsersPermPanels[opts.section];
          const total = opts.pages.length;
          return (
            <div
              style={{
                border: "1px solid rgba(15, 23, 42, 0.12)",
                borderRadius: "6px",
                overflow: "hidden",
                background: "#ffffff",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setSchoolsUsersPermPanels((p) => ({ ...p, [opts.section]: !p[opts.section] }))
                }
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "#f8fafc",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  borderBottom: open ? "1px solid rgba(15, 23, 42, 0.10)" : "none",
                }}
                aria-expanded={open}
              >
                <div style={{ display: "grid", gap: "2px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>
                    {opts.title}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b" }}>
                    {summary(opts.section, total)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 900,
                    color: "#0f172a",
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: "1px solid rgba(15, 23, 42, 0.12)",
                    background: "#ffffff",
                  }}
                >
                  {open ? "Hide" : "Edit"}
                </div>
              </button>

              {open ? (
                <div style={{ padding: "10px 12px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "10px 14px",
                    }}
                  >
                    {opts.pages.map((p) => {
                      const checked = !!schoolsUsersPerms?.[opts.section]?.[p.key];
                      return (
                        <label
                          key={p.key}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid rgba(15, 23, 42, 0.10)",
                            background: "#ffffff",
                            cursor: "pointer",
                            userSelect: "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePage(opts.section, p.key)}
                            style={{ width: 16, height: 16 }}
                          />
                          <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>
                            {p.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        };

        return (
          <div
            style={{
              padding: "24px",
              background: "#f3f4f6",
              minHeight: "100%",
              borderRadius: "6px",
              border: "1px solid rgba(15, 23, 42, 0.10)",
              boxShadow: "none",
            }}
          >
            <div style={topWrap}>
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "28px",
                    fontWeight: 800,
                    letterSpacing: "-0.01em",
                    color: "#0f172a",
                  }}
                >
                  Users
                </h1>
                <div style={{ marginTop: "6px", fontSize: "14px", color: "#64748b", fontWeight: 600 }}>
                  Create and manage school users.
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (schoolsUsersMode !== "list") {
                      setSchoolsUsersMode("list");
                      return;
                    }
                    go("dashboard");
                  }}
                  style={actionBtn}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {



                    localStorage.setItem(
                  
                  
                  
                      "schoolsUsersPerms",
                  
                  
                  
                      JSON.stringify(schoolsUsersPerms)
                    );
                  
                  
                    
                  
                  
                  
                    alert("Saved.");
                  
                  
                  
                    setSchoolsUsersMode("list");
                  
                  
                  
                  }}
                  style={actionBtn}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => alert("More Actions")}
                  style={actionBtn}
                >
                  More Actions
                </button>
              </div>
            </div>

            <div style={card}>
              {schoolsUsersMode === "list" ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      paddingBottom: "10px",
                      borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
                      marginBottom: "12px",
                    }}
                  >
                    <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>School Users</div>
                    <button
                      type="button"
                      style={{ ...actionBtn, borderRadius: "999px" }}
                      onClick={() => {
                        setSchoolsUsersMode("add");
                        setSchoolsUsersForm({ firstName: "", lastName: "", email: "" });
                        initPerms();
                      }}
                    >
                      Add User
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid rgba(15, 23, 42, 0.10)",
                        borderRadius: "10px",
                        padding: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        flexWrap: "wrap",
                        background: "#ffffff",
                      }}
                    >
                      <div style={{ display: "grid", gap: "2px" }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>Tony DaSilva (Sample)</div>
                        <div style={{ fontWeight: 700, color: "#64748b", fontSize: "13px" }}>
                          tonydasilva@dasilvaacademy.com
                        </div>
                      </div>
                      <button
                        type="button"
                        style={actionBtn}
                        onClick={() => {
                          setSchoolsUsersMode("manage");
                          setSchoolsUsersForm({
                            firstName: "Tony",
                            lastName: "DaSilva",
                            email: "tonydasilva@dasilvaacademy.com",
                          });
                          initPerms({
                            administration: ["registrations", "attendance", "employees"],
                            billing: ["invoices", "statements"],
                            communication: ["email"],
                          });
                        }}
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 900,
                      color: "#0f172a",
                      paddingBottom: "10px",
                      borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
                      marginBottom: "12px",
                    }}
                  >
                    {schoolsUsersMode === "add" ? "Add User" : "Manage User"}
                  </div>

                  <div
                    style={{
                      border: "1px solid rgba(15, 23, 42, 0.10)",
                      borderRadius: "6px",
                      overflow: "hidden",
                      background: "#ffffff",
                      marginBottom: "12px",
                    }}
                  >
                    <Row
                      label="First Name"
                      value={
                        <input
                          value={schoolsUsersForm.firstName}
                          onChange={(e) =>
                            setSchoolsUsersForm((p) => ({ ...p, firstName: e.target.value }))
                          }
                          placeholder="First Name"
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            padding: "8px 10px",
                            borderRadius: "4px",
                            border: "1px solid rgba(15, 23, 42, 0.18)",
                            background: "#ffffff",
                            outline: "none",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#0f172a",
                          }}
                        />
                      }
                    />
                    <Row
                      label="Last Name"
                      value={
                        <input
                          value={schoolsUsersForm.lastName}
                          onChange={(e) =>
                            setSchoolsUsersForm((p) => ({ ...p, lastName: e.target.value }))
                          }
                          placeholder="Last Name"
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            padding: "8px 10px",
                            borderRadius: "4px",
                            border: "1px solid rgba(15, 23, 42, 0.18)",
                            background: "#ffffff",
                            outline: "none",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#0f172a",
                          }}
                        />
                      }
                    />
                    <Row
                      label="Email"
                      value={
                        <input
                          value={schoolsUsersForm.email}
                          onChange={(e) =>
                            setSchoolsUsersForm((p) => ({ ...p, email: e.target.value }))
                          }
                          placeholder="Email"
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            padding: "8px 10px",
                            borderRadius: "4px",
                            border: "1px solid rgba(15, 23, 42, 0.18)",
                            background: "#ffffff",
                            outline: "none",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#0f172a",
                          }}
                        />
                      }
                    />
                  </div>

                  <div style={{ display: "grid", gap: "12px" }}>
                    {sectionBox({
                      title: "Administration Access",
                      section: "administration",
                      pages: administrationPages,
                    })}
                    {sectionBox({
                      title: "Billing Access",
                      section: "billing",
                      pages: billingPages,
                    })}
                    {sectionBox({
                      title: "Communication Access",
                      section: "communication",
                      pages: communicationPages,
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

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



          const selected = selectedStatementAccount;
        
        
        
          if (!selected) {
        
        
        
            return (
        
        
        
              <div style={{ padding: "32px" }}>
        
        
        
                <h1 className="page-title">Statement</h1>
        
        
        
                <p>Select an account first.</p>
        
        
        
              </div>
        
        
        
            );
        
        
        
          }
        
        
        
          return (
        
        
        
            <div
              style={{
                padding: "32px",
                background: "linear-gradient(180deg, #ffffff 0%, #fafafa 55%, #f3f4f6 100%)",
                minHeight: "100%",
              }}
            >
              {(() => {
                const BLACK = "#111827";
                const GOLD = "#d4af37";

                const textMuted = "rgba(17, 24, 39, 0.70)";
                const borderSoft = "rgba(17, 24, 39, 0.10)";
                const shadowSoft = "0 18px 45px rgba(17, 24, 39, 0.10)";

                const setBtnHover = (el: HTMLButtonElement, isHover: boolean) => {
                  if (isHover) {
                    el.style.borderColor = GOLD;
                    el.style.boxShadow = "0 10px 22px rgba(212, 175, 55, 0.20)";
                    el.style.background = "rgba(212, 175, 55, 0.10)";
                  } else {
                    el.style.borderColor = borderSoft;
                    el.style.boxShadow = "none";
                    el.style.background = "#ffffff";
                  }
                };

                const actionBtnStyle: React.CSSProperties = {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "40px",
                  padding: "0 14px",
                  borderRadius: "12px",
                  border: `1px solid ${borderSoft}`,
                  background: "#ffffff",
                  color: BLACK,
                  fontWeight: 700,
                  fontSize: "13px",
                  letterSpacing: "0.01em",
                  cursor: "pointer",
                  transition: "all 140ms ease",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                };

                const cardStyle: React.CSSProperties = {
                  background: "#ffffff",
                  borderRadius: "16px",
                  border: `1px solid ${borderSoft}`,
                  boxShadow: shadowSoft,
                };

                const labelStyle: React.CSSProperties = {
                  fontSize: "12px",
                  color: textMuted,
                  fontWeight: 700,
                  marginBottom: "6px",
                };

                const inputStyle: React.CSSProperties = {
                  width: "100%",
                  height: "40px",
                  borderRadius: "12px",
                  border: `1px solid ${borderSoft}`,
                  padding: "10px 12px",
                  outline: "none",
                  color: BLACK,
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  boxSizing: "border-box",
                };

                const textareaStyle: React.CSSProperties = {
                  width: "100%",
                  minHeight: "98px",
                  borderRadius: "12px",
                  border: `1px solid ${borderSoft}`,
                  padding: "10px 12px",
                  outline: "none",
                  color: BLACK,
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  resize: "vertical",
                  boxSizing: "border-box",
                };

                const formatMaybeMoney = (val: unknown) => {
                  if (val === null || val === undefined) return "";
                  if (typeof val === "number") return val.toFixed(2);
                  return String(val);
                };

                const parentsLabel = `${(selected as any)?.name ?? ""} ${(selected as any)?.surname ?? ""}`.trim() || "-";
                const childrenLabel =
                  Array.isArray((selected as any)?.children) ? String((selected as any).children.length) : "-";

                const txDummy: Array<{
                  auditNo: string;
                  date: string;
                  type: string;
                  reference: string;
                  description: string;
                  amount: string;
                  amountOut: string;
                  balance: string;
                }> = [
                  {
                    auditNo: "A-000102",
                    date: "2026-04-15",
                    type: "Invoice",
                    reference: "INV-1042",
                    description: "School Fees",
                    amount: "R 8 000.00",
                    amountOut: "—",
                    balance: "R 8 000.00",
                  },
                  {
                    auditNo: "A-000118",
                    date: "2026-04-25",
                    type: "Payment",
                    reference: "PAY-552",
                    description: "Payment Received",
                    amount: "—",
                    amountOut: "R 2 000.00",
                    balance: "R 6 000.00",
                  },
                ];

                const transactions: typeof txDummy = Array.isArray((selected as any)?.transactions)
                  ? (selected as any).transactions
                  : txDummy;

                return (
                  <>
                    <div style={{ marginBottom: "18px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "16px",
                          flexWrap: "wrap",
                          marginBottom: "12px",
                        }}
                      >
                        <div>
                          <h1
                            style={{
                              margin: 0,
                              fontSize: "28px",
                              fontWeight: 900,
                              letterSpacing: "-0.02em",
                              color: BLACK,
                            }}
                          >
                            Statement » Manage a statement of account
                          </h1>
                          <div style={{ marginTop: "6px", fontSize: "13px", color: textMuted, fontWeight: 600 }}>
                            Account: {(selected as any).accountNo} • {parentsLabel}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onClick={() => setActivePage("statements")}
                            onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                            onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                            onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                            onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                          >
                            Print
                          </button>
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                            onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                          >
                            Send
                          </button>
                          <button
                            type="button"
                            style={{
                              ...actionBtnStyle,
                              borderColor: "rgba(212, 175, 55, 0.55)",
                              background:
                                "linear-gradient(135deg, rgba(212, 175, 55, 0.18), rgba(212, 175, 55, 0.06))",
                            }}
                            onMouseEnter={(e) => {
                              const el = e.currentTarget;
                              el.style.borderColor = GOLD;
                              el.style.boxShadow = "0 12px 26px rgba(212, 175, 55, 0.25)";
                            }}
                            onMouseLeave={(e) => {
                              const el = e.currentTarget;
                              el.style.borderColor = "rgba(212, 175, 55, 0.55)";
                              el.style.boxShadow = "none";
                            }}
                          >
                            More Actions
                          </button>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "2fr 1fr",
                        gap: "18px",
                        alignItems: "start",
                      }}
                    >
                      <div style={{ ...cardStyle, padding: "16px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "12px",
                            paddingBottom: "12px",
                            borderBottom: `1px solid ${borderSoft}`,
                            marginBottom: "14px",
                          }}
                        >
                          <div style={{ fontSize: "16px", fontWeight: 900, color: BLACK }}>Account</div>

                          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            <div
                              style={{
                                fontSize: "12px",
                                fontWeight: 800,
                                color: BLACK,
                                border: `1px solid ${borderSoft}`,
                                background: "#ffffff",
                                borderRadius: "999px",
                                padding: "6px 10px",
                                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
                              }}
                            >
                              General
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "12px 14px",
                          }}
                        >
                          <div>
                            <div style={labelStyle}>Account No</div>
                            <input style={inputStyle} value={(selected as any).accountNo ?? ""} readOnly />
                          </div>
                          <div>
                            <div style={labelStyle}>Balance</div>
                            <input style={inputStyle} value={formatMaybeMoney((selected as any).balance)} readOnly />
                          </div>
                          <div>
                            <div style={labelStyle}>Current</div>
                            <input style={inputStyle} value="0.00" readOnly />
                          </div>
                          <div>
                            <div style={labelStyle}>30 Days</div>
                            <input style={inputStyle} value="0.00" readOnly />
                          </div>
                          <div>
                            <div style={labelStyle}>60 Days</div>
                            <input style={inputStyle} value="0.00" readOnly />
                          </div>
                          <div>
                            <div style={labelStyle}>90 Days</div>
                            <input style={inputStyle} value="0.00" readOnly />
                          </div>
                          <div>
                            <div style={labelStyle}>120 Days</div>
                            <input style={inputStyle} value="0.00" readOnly />
                          </div>

                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={labelStyle}>Notes</div>
                            <textarea style={textareaStyle} placeholder="Notes" />
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          ...cardStyle,
                          padding: "14px 14px 12px 14px",
                          borderTop: `4px solid ${GOLD}`,
                        }}
                      >
                        <div style={{ fontSize: "14px", fontWeight: 900, color: BLACK, marginBottom: "10px" }}>
                          Summary
                        </div>

                        <div style={{ overflow: "hidden", borderRadius: "12px", border: `1px solid ${borderSoft}` }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                            {[
                              ["Account No", (selected as any).accountNo ?? "-"],
                              ["Children", childrenLabel],
                              ["Parents", parentsLabel],
                              ["Balance", formatMaybeMoney((selected as any).balance)],
                              ["Notes", "—"],
                            ].map(([k, v]) => (
                              <div key={k} style={{ display: "contents" }}>
                                <div
                                  style={{
                                    padding: "10px 12px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    background: "rgba(17, 24, 39, 0.02)",
                                    color: textMuted,
                                    fontSize: "12px",
                                    fontWeight: 800,
                                  }}
                                >
                                  {k}
                                </div>
                                <div
                                  style={{
                                    padding: "10px 12px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    color: BLACK,
                                    fontSize: "12px",
                                    fontWeight: 800,
                                  }}
                                >
                                  {String(v ?? "")}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ ...cardStyle, marginTop: "18px", padding: "14px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          flexWrap: "wrap",
                          paddingBottom: "12px",
                          borderBottom: `1px solid ${borderSoft}`,
                          marginBottom: "12px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <div style={{ fontSize: "16px", fontWeight: 900, color: BLACK }}>Transactions</div>

                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              style={actionBtnStyle}
                              onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                              onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                            >
                              Manage
                            </button>
                            <button
                              type="button"
                              style={actionBtnStyle}
                              onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                              onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                            >
                              Undo
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={{ ...actionBtnStyle, height: "36px", padding: "0 12px", fontWeight: 800 }}
                            onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                            onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                          >
                            Hide Corrections
                          </button>
                          <button
                            type="button"
                            style={{ ...actionBtnStyle, height: "36px", padding: "0 12px", fontWeight: 800 }}
                            onMouseEnter={(e) => setBtnHover(e.currentTarget, true)}
                            onMouseLeave={(e) => setBtnHover(e.currentTarget, false)}
                          >
                            Last 10 Transactions
                          </button>
                          <input
                            placeholder="Search"
                            style={{
                              ...inputStyle,
                              height: "36px",
                              width: "260px",
                              fontWeight: 700,
                              borderColor: "rgba(17, 24, 39, 0.14)",
                            }}
                            onFocus={(e) => {
                              e.currentTarget.style.borderColor = GOLD;
                              e.currentTarget.style.boxShadow = "0 0 0 4px rgba(212, 175, 55, 0.16)";
                            }}
                            onBlur={(e) => {
                              e.currentTarget.style.borderColor = "rgba(17, 24, 39, 0.14)";
                              e.currentTarget.style.boxShadow = "none";
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                          <thead>
                            <tr>
                              {[
                                "Audit No",
                                "Date",
                                "Type",
                                "Reference",
                                "Description",
                                "Amount",
                                "Amount Out",
                                "Balance",
                              ].map((h) => (
                                <th
                                  key={h}
                                  style={{
                                    textAlign: "left",
                                    padding: "10px 10px",
                                    fontSize: "12px",
                                    color: textMuted,
                                    fontWeight: 900,
                                    borderBottom: `1px solid ${borderSoft}`,
                                    background: "rgba(17, 24, 39, 0.02)",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.map((tx, idx) => (
                              <tr
                                key={(tx as any).auditNo ?? idx}
                                style={{ background: idx % 2 ? "#ffffff" : "#fcfcfd" }}
                              >
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 800,
                                    color: BLACK,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).auditNo ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 700,
                                    color: BLACK,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).date ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 700,
                                    color: BLACK,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).type ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 700,
                                    color: BLACK,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).reference ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 700,
                                    color: BLACK,
                                    minWidth: "220px",
                                  }}
                                >
                                  {(tx as any).description ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 800,
                                    color: "#0f172a",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).amount ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 800,
                                    color: "#0f172a",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).amountOut ?? "—"}
                                </td>
                                <td
                                  style={{
                                    padding: "10px 10px",
                                    borderBottom: `1px solid ${borderSoft}`,
                                    fontWeight: 900,
                                    color: BLACK,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {(tx as any).balance ?? "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
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

  if (!schoolsUsersPerms?.billing?.payments) {



    return (
  
  
  
      <div style={{ padding: "32px" }}>
  
  
  
        <h1 className="page-title">No Access</h1>
  
  
  
        <p>You do not have permission to access Payments.</p>
  
  
  
      </div>
  
  
  
    );
  
  
  
  }

  return (



    <div style={{ padding: "32px" }}>



      <div style={{ marginBottom: "22px" }}>



        <h1 className="page-title">New Payment</h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: "15px" }}>



          Create a new payment



        </p>



      </div>



      <div style={{ display: "flex", gap: "14px", marginBottom: "20px", flexWrap: "wrap" }}>



        <div className="dashboard-card"><h3>Accounts</h3><h2>{statementsAccountsCount}</h2></div>



        <div className="dashboard-card"><h3>Total Outstanding</h3>{formatMoney(statementsTotalOutstanding)}<h2></h2></div>



        <div className="dashboard-card"><h3>Recently Owing</h3><h2>{formatMoney(statementsRecentlyOwing)}</h2></div>



        <div className="dashboard-card"><h3>Bad Debt</h3><h2>{formatMoney(statementsBadDebt)}</h2></div>



        <div className="dashboard-card"><h3>Over Paid</h3><h2>{formatMoney(statementsOverPaidAbs)}</h2></div>



      </div>



      <button



        className="action-btn"



        onClick={() => {
          if (selectedPaymentAccount) {
            localStorage.setItem("selectedPaymentAccount", JSON.stringify(selectedPaymentAccount));
          }
          setActivePage("paymentCreate" as PageKey);
        }}



        style={{ marginBottom: "18px" }}



      >



        + Create Payment



      </button>



      <div className="table-card">



        <h2 style={{ marginTop: 0 }}>Children</h2>



        <table className="data-table">



          <thead>



            <tr>



              <th>Account No</th>



              <th>Name</th>



              <th>Surname</th>



              <th>Balance</th>



              <th>Last Invoice</th>



              <th>Last Payment</th>



              <th>Account Status</th>



            </tr>



          </thead>



          <tbody>



          



{statementRows.map((account: any) => (



<tr



  key={account.accountNo}



  onClick={() => {



    setSelectedPaymentAccount(account);



    localStorage.setItem("selectedPaymentAccount", JSON.stringify(account));



  }}



  style={{



    cursor: "pointer",



    background:



      selectedPaymentAccount?.accountNo === account.accountNo



        ? "rgba(37, 99, 235, 0.12)"



        : "transparent",



  }}



>



  <td>{account.accountNo}</td>



  <td>{account.name}</td>



  <td>{account.surname}</td>



  <td>{formatMoney(getAccountBalance(account))}</td>



  <td>{formatMoney(account.lastInvoice || 0)} on {account.lastInvoiceDate || "-"}</td>



  <td>



  {Number(account.lastPayment || 0) > 0



    ? `${formatMoney(account.lastPayment || 0)} on ${account.lastPaymentDate || "-"}`



    : "R 0,00"}



</td>



  <td>{getAccountBalance(account) <= 0 ? "Over Paid" : "Recently Owing"}</td>



</tr>



))}  











</tbody> 



        </table>



      </div>



    </div>



  );
   
   


case "paymentCreate": 



  // Ensure balances refresh immediately after Save (localStorage is the source of truth)
  void paymentsVersion;
  return <PaymentCreatePage accountRows={statementRows} />;




            
            
            
              

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

<div className="section-header" onClick={() => setSchoolsOpen(!schoolsOpen)}>

  <div className="section-left">

    <span className="menu-icon">🏫</span>

    <span>Schools</span>

  </div>

  <span className={`chevron ${schoolsOpen ? "open" : ""}`}>⌄</span>

</div>

{schoolsOpen && (

  <div className="submenu">

    <div

      className={`submenu-item ${activePage === "schoolsProfile" ? "active" : ""}`}

      onClick={() => go("schoolsProfile")}

    >

      Profile

    </div>

    <div

      className={`submenu-item ${activePage === "schoolsPackage" ? "active" : ""}`}

      onClick={() => go("schoolsPackage")}

    >

      Package

    </div>

    <div

      className={`submenu-item ${activePage === "schoolsCredits" ? "active" : ""}`}

      onClick={() => go("schoolsCredits")}

    >

      Credits

    </div>

    <div

      className={`submenu-item ${activePage === "schoolsUsers" ? "active" : ""}`}

      onClick={() => go("schoolsUsers")}

    >

      Users

    </div>

    <div

      className={`submenu-item ${activePage === "schoolsMore" ? "active" : ""}`}

      onClick={() => go("schoolsMore")}

    >

      More

    </div>

  </div>

)}

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

{schoolsUsersPerms?.administration?.registrations && (



<div



  className={`submenu-item ${activePage === "registrations" ? "active" : ""}`}



  onClick={() => go("registrations")}



>



  Registrations



</div>



)}

<div

  className={`submenu-item ${activePage === "registrations" ? "active" : ""}`}

  onClick={() => go("registrations")}

>

  Registrations

</div>

)



{schoolsUsersPerms?.administration?.addLearner && (



<div



  className={`submenu-item ${activePage === "addLearner" ? "active" : ""}`}



  onClick={() => go("addLearner")}



>



  Add Learner



</div>



)}  



{schoolsUsersPerms?.administration?.classrooms && (



<div



  className={`submenu-item ${activePage === "classrooms" ? "active" : ""}`}



  onClick={() => go("classrooms")}



>



  Classrooms



</div>



)}



{schoolsUsersPerms?.administration?.groups && (



<div



  className={`submenu-item ${activePage === "groups" ? "active" : ""}`}



  onClick={() => go("groups")}



>



  Groups



</div>



)}
          {schoolsUsersPerms?.administration?.employees && (



<div



  className={`submenu-item ${activePage === "employees" ? "active" : ""}`}



  onClick={() => go("employees")}



>



  Employees



</div>



)}
    


             
    {schoolsUsersPerms?.administration?.teacherPerformance && (



<div



  className={`submenu-item ${activePage === "teacherPerformance" ? "active" : ""}`}



  onClick={() => go("teacherPerformance")}



>



  Teacher Performance



</div>



)} 


{schoolsUsersPerms?.administration?.attendance && (



<div



  className={`submenu-item ${activePage === "attendance" ? "active" : ""}`}



  onClick={() => go("attendance")}



>



  Attendance



</div>



)} 



{schoolsUsersPerms?.administration?.incidents && (

<div

  className={`submenu-item ${activePage === "incidents" ? "active" : ""}`}

  onClick={() => go("incidents")}

>

  Incidents

</div>

)}





{schoolsUsersPerms?.administration?.listsAndRegisters && (



  <div



    className={`submenu-item ${activePage === "lists" ? "active" : ""}`}



    onClick={() => go("lists")}



  >



    Lists & Registers



  </div>



)}







{schoolsUsersPerms?.administration?.formsAndTemplates && (



<div



  className={`submenu-item ${activePage === "forms" ? "active" : ""}`}



  onClick={() => go("forms")}



>



  Forms & Templates



</div>



)}



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

{schoolsUsersPerms?.billing?.statements && (



<div



  className={`submenu-item ${activePage === "statements" ? "active" : ""}`}



  onClick={() => go("statements")}



>



  Statements



</div>



)}



{schoolsUsersPerms?.billing?.invoices && (



<div



  className={`submenu-item ${activePage === "invoices" ? "active" : ""}`}



  onClick={() => go("invoices")}



>



  Invoices



</div>



)}



{schoolsUsersPerms?.billing?.payments && (



<div



  className={`submenu-item ${activePage === "payments" ? "active" : ""}`}



  onClick={() => go("payments")}



>



  Payments



</div>



)}

{schoolsUsersPerms?.billing?.payroll && (



<div



  className={`submenu-item ${activePage === "payroll" ? "active" : ""}`}



  onClick={() => go("payroll")}



>



  Payroll



</div>



)} 



{schoolsUsersPerms?.billing?.fees && (



<div



  className={`submenu-item ${activePage === "fees" ? "active" : ""}`}



  onClick={() => go("fees")}



>



  Fees



</div>



)}



{schoolsUsersPerms?.billing?.billingPlans && (



<div



  className={`submenu-item ${activePage === "plans" ? "active" : ""}`}



  onClick={() => go("plans")}



>



  Billing Plans



</div>



)}



{schoolsUsersPerms?.billing?.invoiceRuns && (



<div



  className={`submenu-item ${activePage === "runs" ? "active" : ""}`}



  onClick={() => go("runs")}



>



  Invoice Runs



</div>



)}



{schoolsUsersPerms?.billing?.reports && (



<div



  className={`submenu-item ${activePage === "reports" ? "active" : ""}`}



  onClick={() => go("reports")}



>



  Billing Reports



</div>



)}



{schoolsUsersPerms?.billing?.documents && (



<div



  className={`submenu-item ${activePage === "documents" ? "active" : ""}`}



  onClick={() => go("documents")}



>



  Billing Documents



</div>



)}



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