import React, { Fragment, useCallback, useEffect, useMemo, useState } from "react";



import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";



import AddLearner from "./AddLearner";



import TeacherPerformance from "./TeacherPerformance";



import Payroll from "./Payroll";



import Fees from "./Fees";



import FeeUpsert from "./FeeUpsert";
import InvoiceRuns from "./billing/InvoiceRuns";
import Statements from "./billing/Statements";
import BillingSummaryCards from "./billing/BillingSummaryCards";
import StatementManage from "./billing/StatementManage";
import BillingPlans from "./billing/BillingPlans";
import Payments from "./billing/Payments";
import PaymentCreateClean from "./billing/PaymentCreateClean";
import InvoiceCreateClean from "./billing/InvoiceCreateClean";
import BillingDocuments from "./billing/BillingDocuments";
import BillingReports from "./billing/BillingReports";
import Email from "./communication/Email";
import SMS from "./communication/SMS";
import CommunicationSettings from "./communication/CommunicationSettings";
import CommunicationCentre from "./communication/CommunicationCentre";
import {
  fetchSchoolEmailSettings,
  isSchoolEmailReadyForUi,
  normalizeSchoolEmailSettings,
  SCHOOL_EMAIL_READINESS_UPDATED,
  type SchoolEmailSettings,
} from "./communication/schoolEmailApi";
import AccountingOverview from "./accounting/AccountingOverview";
import AccountingExportCenter from "./accounting/AccountingExportCenter";
import AccountingBanking from "./accounting/AccountingBanking";
import {
  AccountingAssets,
  AccountingBudget,
  AccountingChartOfAccounts,
  AccountingExpenses,
  AccountingFinancialStatements,
  AccountingGeneralLedger,
  AccountingJournals,
  AccountingReports,
  AccountingDebtorsAgeing,
  AccountingCreditorsAgeing,
  SupplierInvoiceEngine,
  AccountingSettings,
  AccountingSuppliers,
  AccountingAuditCompliance,
} from "./accounting/accountingSections";
import {
  BILLING_UPDATED_EVENT,
  getBillingRows,
  LEARNERS_REFRESH_EVENT,
  notifyBillingUpdated,
} from "./billing/billingLedger";
import {
  defaultPaymentForm,
  normalizePaymentAccount,
  PAYMENT_ACCOUNT_STORAGE_KEY,
  paymentAccountContextsEqual,
  persistPaymentAccount,
  type PaymentAccountContext,
  type PaymentFormState,
} from "./billing/paymentCreateShared";
import {
  refreshBillingFromApi,
} from "./billing/billingApi";
import { KIDESYS_HISTORY_UPDATED_EVENT } from "./billing/kidesysTransactionHistory";
import {
  buildInvoiceRunDefaults,
  computeInvoiceDueDate,
  loadBillingSettingsForSchool,
  resolveInvoiceMessage,
} from "./billing/billingSettingsEngine";
import SchoolProfilePage from "./pages/SchoolProfilePage";
import SchoolCreditsPage from "./pages/SchoolCreditsPage";
import SchoolSasamsReportUploadPage from "./pages/SchoolSasamsReportUploadPage";
import SchoolSettingsPage from "./pages/SchoolSettingsPage";
import MigrationCentrePage from "./pages/migration/MigrationCentrePage";
import AccessDenied from "./auth/AccessDenied";
import BillingDepositsPage from "./pages/BillingDepositsPage";
import BillingSettingsPage from "./pages/BillingSettingsPage";
import { isSuperAdmin } from "./auth/roles";



import {
  canAccessSchoolPage,
  canViewAnySchoolPage,
  findFirstAllowedSchoolPage,
} from "./auth/schoolAccess";
import {
  getSchoolSessionUser,
  syncSchoolSessionFromLoginResponse,
  USER_PERMISSIONS_STORAGE_KEY,
} from "./auth/schoolSession";
import { getPackageDisplayPrice } from "./subscriptions/payfastCheckout";
import { API_URL, apiFetch } from "./api";
import { normalizeSaIdNumber } from "./utils/normalizeSaIdNumber";



import logo from "./assets/logo.png";



import { useSchoolId } from "./useSchoolId";
import {
  fetchSchoolEmployees,
  readEmployeesCache,
  saveSchoolEmployee,
  writeEmployeesCache,
} from "./employeesApi";

import ParentPortal from "./ParentPortal";
import TeacherInbox from "./teacher/TeacherInbox";
import Registrations from "./components/registrations/Registrations";
import Users from "./users/Users";
import ManageLearner from "./learner/ManageLearner";
import Classrooms from "./Classrooms";
import { calculateLearnerAge } from "./learner/learnerIdentity";
import { normalizeKidESysAccountRef, resolveKidESysAccountRefFromLearner } from "./billing/billingAccountRef";
import { isMigratedOpeningBalanceOverviewLabel } from "./billing/billingDisplayRules";
import { isActiveEnrollment, isFemaleLearnerForStats, isMaleLearnerForStats } from "./utils/learnerGender";


import "./App.css";



type PageKey =



  | "dashboard"



  | "schoolProfile"



  | "schoolPackage"



  | "schoolCredits"



  | "schoolUsers"



  | "schoolSettings"



  | "migrationCentre"



  | "registrations"

  | "sasamsReportUpload"



  | "parentPortal"

  | "teacherInbox"

  | "learnerProfile"



  | "addLearner"



  | "classrooms"

  | "classroomManage"

  | "groups"
  | "groupManage" 


  | "employees"
  | "employeeManage"


  | "teacherPerformance"



  | "attendance"
  | "attendanceManage"


  | "incidents"
  | "incidentManage"


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
  | "paymentCreate"

  | "fees"



  | "feeUpsert"



  | "plans"



  | "runs"



  | "reports"



  | "documents"



  | "billing-help"



  | "billing-more"

  | "billingDeposits"

  | "billingSettings"

  | "communicationEmail"

  | "communicationSms"

  | "communicationSettings"

  | "communicationCentre"

  | "bankStatementImport"
  | "accountingOverview"
  | "accountingBanking"
  | "accountingExpenses"
  | "accountingSuppliers"
  | "accountingAssets"
  | "accountingJournals"
  | "accountingGeneralLedger"
  | "accountingChartOfAccounts"
  | "accountingBudget"
  | "accountingFinancialStatements"
  | "accountingReports"
  | "accountingDebtorsAgeing"
  | "accountingCreditorsAgeing"
  | "accountingSupplierInvoices"
  | "accountingAuditCompliance"
  | "accountingExportCenter"
  | "accountingSettings";

const MOBILE_PAGE_TITLES: Partial<Record<PageKey, string>> = {
  dashboard: "Dashboard",
  schoolProfile: "School Profile",
  schoolPackage: "Package",
  schoolCredits: "Credits",
  schoolUsers: "Users",
  schoolSettings: "Settings",
  migrationCentre: "Migration Centre",
  registrations: "Registrations",
  sasamsReportUpload: "SASAMS Upload",
  parentPortal: "Parent Portal",
  teacherInbox: "Teacher Inbox",
  learnerProfile: "Learner Profile",
  addLearner: "Add Learner",
  classrooms: "Classrooms",
  classroomManage: "Classrooms",
  groups: "Groups",
  groupManage: "Groups",
  employees: "Employees",
  employeeManage: "Employees",
  teacherPerformance: "Teacher Performance",
  attendance: "Attendance",
  attendanceManage: "Attendance",
  incidents: "Incidents",
  incidentManage: "Incidents",
  lists: "Lists",
  forms: "Forms",
  help: "Help",
  more: "More",
  statements: "Statements",
  statementManage: "Statements",
  invoices: "Invoices",
  invoiceCreate: "Create Invoice",
  payments: "Payments",
  payroll: "Payroll",
  paymentCreate: "Create Payment",
  fees: "Fees",
  feeUpsert: "Fees",
  plans: "Billing Plans",
  runs: "Invoice Runs",
  reports: "Billing Reports",
  documents: "Documents",
  "billing-help": "Billing Help",
  "billing-more": "Billing More",
  billingDeposits: "Deposits",
  billingSettings: "Billing Settings",
  communicationEmail: "Email",
  communicationSms: "SMS",
  communicationSettings: "Communication Settings",
  communicationCentre: "Communication Centre",
  bankStatementImport: "Bank Import",
  accountingOverview: "Accounting",
  accountingBanking: "Banking",
  accountingExpenses: "Expenses",
  accountingSuppliers: "Suppliers",
  accountingAssets: "Assets",
  accountingJournals: "Journals",
  accountingGeneralLedger: "General Ledger",
  accountingChartOfAccounts: "Chart of Accounts",
  accountingBudget: "Budget",
  accountingFinancialStatements: "Financial Statements",
  accountingReports: "Accounting Reports",
  accountingDebtorsAgeing: "Debtors Ageing",
  accountingCreditorsAgeing: "Creditors Ageing",
  accountingSupplierInvoices: "Supplier Invoices",
  accountingAuditCompliance: "Audit & Compliance",
  accountingExportCenter: "Export Centre",
  accountingSettings: "Accounting Settings",
};

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



export default function SchoolDashboard() {



  const navigate = useNavigate();



  const location = useLocation();



  const hookSchoolId = useSchoolId();



const schoolId =



  hookSchoolId ||



  localStorage.getItem("schoolId") ||



  localStorage.getItem("selectedSchoolId") ||



  localStorage.getItem("currentSchoolId") ||



  "";



  const GOLD = "#d4af37";



  const BLACK = "#050505";

  const schoolSessionUser = getSchoolSessionUser();
  const canPage = (page: PageKey) => canAccessSchoolPage(page, schoolSessionUser);



  const [activePage, setActivePage] = useState<PageKey>("dashboard");



  const [adminOpen, setAdminOpen] = useState(true);



  const [schoolsOpen, setSchoolsOpen] = useState(false);



  const [billingOpen, setBillingOpen] = useState(true);
  const [billingMoreOpen, setBillingMoreOpen] = useState(false);
  const [accountingOpen, setAccountingOpen] = useState(false);

  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [communicationMoreOpen, setCommunicationMoreOpen] = useState(false);
  const [communicationSettingsTab, setCommunicationSettingsTab] = useState<
    "general" | "documents" | "email" | "sms"
  >("general");
  const [emailReadiness, setEmailReadiness] = useState<SchoolEmailSettings | null>(null);
  const [emailReadinessLoaded, setEmailReadinessLoaded] = useState(false);



  const [selectedPackage, setSelectedPackage] = useState("starter");



  const [manageFeeId, setManageFeeId] = useState<string | null>(null);



  const [learners, setLearners] = useState<any[]>([]);
  const [billingVersion, setBillingVersion] = useState(0);
  const [learnersVersion, setLearnersVersion] = useState(0);
  const [registrationsDataLoading, setRegistrationsDataLoading] = useState(Boolean(schoolId));
  const [registrationStats, setRegistrationStats] = useState<{
    children: number;
    parents: number;
    boys: number;
    girls: number;
    classrooms: number;
    avg: number;
    averageClassroomSize?: number;
  } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );

  const [parents, setParents] = useState<any[]>([]);

  const [schoolBranding, setSchoolBranding] = useState<{ name: string; email: string }>({
    name: String(localStorage.getItem("schoolName") || "").trim() || "School",
    email: "",
  });



  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);
  const [selectedClassroom, setSelectedClassroom] = useState<any | null>(null);



const [classroomSearch, setClassroomSearch] = useState("");



const [classroomPage, setClassroomPage] = useState(1);



const [classroomLearnerPage, setClassroomLearnerPage] = useState(1);



const [classroomMode, setClassroomMode] = useState<"none" | "add" | "manage">("none");
const [classroomMoreOpen, setClassroomMoreOpen] = useState(false);


const [classroomDraft, setClassroomDraft] = useState<any>({});



const [localClassrooms, setLocalClassrooms] = useState<any[]>([]);
const [selectedGroup, setSelectedGroup] = useState<any | null>(null);



const [groupSearch, setGroupSearch] = useState("");



const [groupPage, setGroupPage] = useState(1);



const [groupLearnerPage, setGroupLearnerPage] = useState(1);



const [groupMode, setGroupMode] = useState<"none" | "add" | "manage">("none");



const [groupDraft, setGroupDraft] = useState<any>({});



const [localGroups, setLocalGroups] = useState<any[]>(() => {



  try {



    const saved = localStorage.getItem("educlearGroups");



    return saved ? JSON.parse(saved) : [];



  } catch {



    return [];



  }



});
const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);



const [employeeSearch, setEmployeeSearch] = useState("");



const [employeePage, setEmployeePage] = useState(1);



const [employeeTab, setEmployeeTab] = useState<"general" | "contact" | "address" | "payroll" | "other" | "extra">("general");



const [employeeMode, setEmployeeMode] = useState<"none" | "add">("none");



const [employeeMoreOpen, setEmployeeMoreOpen] = useState(false);



const [employeeDraft, setEmployeeDraft] = useState<any>({});



const [localEmployees, setLocalEmployees] = useState<any[]>(() => readEmployeesCache());

const [employeesLoading, setEmployeesLoading] = useState(false);

const [employeesLoadError, setEmployeesLoadError] = useState("");
const [attendanceSelectedClass, setAttendanceSelectedClass] = useState<string | null>(null);
const [attendanceSearch, setAttendanceSearch] = useState("");
const [attendanceCapturePage, setAttendanceCapturePage] = useState(1);
const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10));
const [attendanceMarks, setAttendanceMarks] = useState<
  Record<string, { status?: string; arrived?: string; left?: string; reason?: string }>
>({});
const [attendanceLoading, setAttendanceLoading] = useState(false);
const [attendanceSaving, setAttendanceSaving] = useState(false);
const [attendanceNotice, setAttendanceNotice] = useState<string | null>(null);
const [incidentSearch, setIncidentSearch] = useState("");



const [incidentPage, setIncidentPage] = useState(1);



const [incidentLearnerPage, setIncidentLearnerPage] = useState(1);



const [incidentAddOpen, setIncidentAddOpen] = useState(false);



const [incidentAddType, setIncidentAddType] = useState<"child" | "parent">("child");



const [selectedIncidentLearner, setSelectedIncidentLearner] = useState<any | null>(null);



const [selectedIncident, setSelectedIncident] = useState<any | null>(null);



const [incidentMode, setIncidentMode] = useState<"add" | "manage">("add");



const [incidentMoreOpen, setIncidentMoreOpen] = useState(false);



const [incidentRecords, setIncidentRecords] = useState<any[]>([]);

useEffect(() => {
  if (!schoolId) return;
  void apiFetch(`/api/parent-portal/staff/incidents?schoolId=${encodeURIComponent(schoolId)}`)
    .then((data: any) => {
      if (Array.isArray(data?.incidents) && data.incidents.length) {
        setIncidentRecords(
          data.incidents.map((inc: any) => ({
            id: inc.id,
            date: inc.incidentDate,
            name: inc.learner
              ? `${inc.learner.firstName} ${inc.learner.lastName}`
              : "-",
            relationship: "Child",
            subject: inc.subject,
            type: inc.type,
            incident: inc.summary,
            private: !inc.parentVisible,
            learnerId: inc.learnerId,
          }))
        );
      }
    })
    .catch(() => {});
}, [schoolId]);

useEffect(() => {
  if (!schoolId || !attendanceSelectedClass) return;
  if (activePage !== "attendance" && activePage !== "attendanceManage") return;

  let cancelled = false;
  setAttendanceLoading(true);
  setAttendanceNotice(null);

  const qs = new URLSearchParams({
    schoolId,
    className: attendanceSelectedClass,
    date: attendanceDate,
  });

  void apiFetch(`/api/attendance?${qs}`)
    .then((data: any) => {
      if (cancelled || !data?.success) return;
      setAttendanceMarks(data.marks || {});
      setAttendanceCapturePage(1);
    })
    .catch(() => {
      if (!cancelled) setAttendanceNotice("Could not load attendance for this class and date.");
    })
    .finally(() => {
      if (!cancelled) setAttendanceLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [schoolId, attendanceSelectedClass, attendanceDate, activePage]);

const [incidentDraft, setIncidentDraft] = useState<any>({



  type: "General",



  subject: "General",



  incident: "",



  private: false,



});
const [selectedGroupLearnerIds, setSelectedGroupLearnerIds] = useState<string[]>([]);


const [learnerGradeOverrides, setLearnerGradeOverrides] = useState<Record<string, string>>({});



const [selectedClassroomLearnerIds, setSelectedClassroomLearnerIds] = useState<string[]>([]);
const [reportTab, setReportTab] = useState<"overview" | "results" | "reports">("overview");



const [selectedLearnerReport, setSelectedLearnerReport] = useState<any>(null);

  const [showUnenrolled, setShowUnenrolled] = useState(false);



  const [searchText, setSearchText] = useState("");



  const [selectedStatementAccount, setSelectedStatementAccount] = useState<any | null>(null);



  const [selectedInvoiceAccount, setSelectedInvoiceAccount] = useState<any | null>(null);
  const [billingAccountsSearch, setBillingAccountsSearch] = useState("");
  const [billingAccountsPage, setBillingAccountsPage] = useState(1);
  const [selectedAccount, setSelectedAccount] = useState<PaymentAccountContext | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(() => defaultPaymentForm());



  const [parentIdInput, setParentIdInput] = useState("");



  const [feeStatus, setFeeStatus] = useState("GREEN");



  const [feeOutstandingAmount, setFeeOutstandingAmount] = useState(0);



  const [feeSchool, setFeeSchool] = useState("-");



  const [feeParentName, setFeeParentName] = useState("-");



  const [feeMessage, setFeeMessage] = useState("");



  const [feeLoading, setFeeLoading] = useState(false);



  const [feeLookupDone, setFeeLookupDone] = useState(false);

  const [feeCheckError, setFeeCheckError] = useState("");

  const [feeLookupNotFound, setFeeLookupNotFound] = useState(false);



  type FeeCheckResultCard = {
    parentName: string;
    schoolName: string;
    familyAccountNumber: string;
    outstandingAmount: number;
    status: "GREEN" | "AMBER" | "RED";
    learners: Array<{ id: string; name: string }>;
  };

  const [feeResults, setFeeResults] = useState<FeeCheckResultCard[]>([]);



  const [topPerformer, setTopPerformer] = useState<TeacherPerformanceRecord | null>(null);



  const [topPerformerLoading, setTopPerformerLoading] = useState(false);



  const [plansSearch, setPlansSearch] = useState("");
  const [plansPage, setPlansPage] = useState(1);


  const [selectedPlanLearner, setSelectedPlanLearner] = useState<any | null>(null);
  
  
  
  const [showFeePicker, setShowFeePicker] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    if (localStorage.getItem(USER_PERMISSIONS_STORAGE_KEY)) return;
    apiFetch("/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((data) => syncSchoolSessionFromLoginResponse(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => {
      setIsMobileViewport(mq.matches);
      if (!mq.matches) setMobileNavOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (canPage(activePage)) return;
    setActivePage(findFirstAllowedSchoolPage(schoolSessionUser) as PageKey);
  }, [activePage]);

  const go = (page: PageKey) => {
    if (!canPage(page)) {
      window.alert("You do not have permission to access this section.");
      return;
    }
    setActivePage(page);
    if (isMobileViewport) setMobileNavOpen(false);

    const isAccountingPage =
      page === "payroll" ||
      page === "bankStatementImport" ||
      page === "accountingOverview" ||
      page === "accountingBanking" ||
      page === "accountingExpenses" ||
      page === "accountingSuppliers" ||
      page === "accountingAssets" ||
      page === "accountingJournals" ||
      page === "accountingGeneralLedger" ||
      page === "accountingChartOfAccounts" ||
      page === "accountingBudget" ||
      page === "accountingFinancialStatements" ||
      page === "accountingReports" ||
      page === "accountingDebtorsAgeing" ||
      page === "accountingCreditorsAgeing" ||
      page === "accountingSupplierInvoices" ||
      page === "accountingAuditCompliance" ||
      page === "accountingExportCenter" ||
      page === "accountingSettings";

    if (isAccountingPage) {
      setAccountingOpen(true);
      setBillingOpen(false);
      setSchoolsOpen(false);
      setAdminOpen(false);
      setCommunicationOpen(false);
      setCommunicationMoreOpen(false);
    }

    if (
      page === "communicationEmail" ||
      page === "communicationSms" ||
      page === "communicationSettings" ||
      page === "communicationCentre"
    ) {
      setCommunicationOpen(true);
      setCommunicationMoreOpen(page === "communicationSettings");
      setSchoolsOpen(false);
      setAdminOpen(false);
      setBillingOpen(false);
      setAccountingOpen(false);
    }

    if (page === "billingDeposits" || page === "billingSettings") {
      setBillingOpen(true);
      setBillingMoreOpen(true);
      setSchoolsOpen(false);
      setAdminOpen(false);
      setAccountingOpen(false);
      setCommunicationOpen(false);
    }

    if (location.pathname.startsWith("/dashboard/billing/")) {
      navigate("/dashboard");
    }
  };

  const openCommunicationEmailSetup = () => {
    setCommunicationSettingsTab("email");
    go("communicationSettings");
  };

  const openCommunicationSmsSetup = () => {
    setCommunicationSettingsTab("sms");
    go("communicationSettings");
  };

  const refreshEmailReadiness = async () => {
    if (!schoolId) {
      setEmailReadiness(null);
      setEmailReadinessLoaded(false);
      return;
    }
    try {
      const res = await fetchSchoolEmailSettings(schoolId);
      setEmailReadiness(normalizeSchoolEmailSettings(res.settings));
    } catch {
      setEmailReadiness(null);
    } finally {
      setEmailReadinessLoaded(true);
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
    learner?.classroom ||
    learner?.classroomName ||
    learner?.className ||
    learner?.grade ||
    "";



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
    void refreshEmailReadiness();
  }, [schoolId, activePage]);

  useEffect(() => {
    const onReadinessUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail as { schoolId?: string; settings?: SchoolEmailSettings };
      if (!detail?.settings || detail.schoolId !== schoolId) return;
      setEmailReadiness(normalizeSchoolEmailSettings(detail.settings));
    };
    window.addEventListener(SCHOOL_EMAIL_READINESS_UPDATED, onReadinessUpdated);
    return () => window.removeEventListener(SCHOOL_EMAIL_READINESS_UPDATED, onReadinessUpdated);
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) {
      setLearners([]);
      setParents([]);
      setRegistrationStats(null);
      setRegistrationsDataLoading(false);
      return;
    }

    let cancelled = false;
    setRegistrationsDataLoading(true);

    Promise.all([
      fetch(`${API_URL}/api/registrations/learners?schoolId=${encodeURIComponent(schoolId)}`).then((res) =>
        res.json()
      ),
      fetch(`${API_URL}/api/parents?schoolId=${encodeURIComponent(schoolId)}`).then((res) =>
        res.json()
      ),
      fetch(`${API_URL}/api/registrations/stats?schoolId=${encodeURIComponent(schoolId)}`).then((res) =>
        res.json()
      ),
    ])
      .then(([learnersData, parentsData, statsData]) => {
        if (cancelled) return;



        setLearners(



          Array.isArray(learnersData?.learners)
        
        
        
            ? learnersData.learners.map((learner: any) => ({
        
        
        
                ...learner,
        
        
        
                gender:
        
        
        
                  learner.gender ||
        
        
        
                  learner.Gender ||
        
        
        
                  learner.sex ||
        
        
        
                  "",
        
        
        
                birthDate:
        
        
        
                  learner.birthDate ||
        
        
        
                  learner.dateOfBirth ||
        
        
        
                  learner.dob ||
        
        
        
                  "",
        
        
        
                homeLanguage:
        
        
        
                  learner.homeLanguage ||
        
        
        
                  learner.language ||
        
        
        
                  "",
        
        
        
                idNumber:
        
        
        
                  learner.idNumber ||
        
        
        
                  learner.idNo ||
        
        
        
                  "",
        
        
        
              }))
        
        
        
            : []
        
        
        
        );



        const nextParents = Array.isArray(parentsData)
          ? parentsData
          : Array.isArray(parentsData?.parents)
            ? parentsData.parents
            : Array.isArray(parentsData?.data)
              ? parentsData.data
              : [];

        setParents(nextParents);

        setRegistrationStats(
          statsData?.success && statsData?.stats
            ? {
                children: Number(statsData.stats.children) || 0,
                parents: Number(statsData.stats.parents) || 0,
                boys: Number(statsData.stats.boys) || 0,
                girls: Number(statsData.stats.girls) || 0,
                classrooms: Number(statsData.stats.classrooms) || 0,
                avg: Number(statsData.stats.avg ?? statsData.stats.averageClassroomSize) || 0,
                averageClassroomSize: Number(statsData.stats.averageClassroomSize) || 0,
              }
            : null
        );

        if (import.meta.env.DEV) {
          const nextLearners = Array.isArray(learnersData?.learners)
            ? learnersData.learners
            : [];
          console.info("[EduClear Dev] School dashboard registrations fetch", {
            schoolId,
            apiUrl: API_URL,
            learnersCount: nextLearners.length,
            parentsCount: nextParents.length,
            learnersEndpoint: `${API_URL}/api/registrations/learners?schoolId=${encodeURIComponent(schoolId)}`,
            parentsEndpoint: `${API_URL}/api/parents?schoolId=${encodeURIComponent(schoolId)}`,
          });
        }
      })



      .catch(() => {
        if (cancelled) return;
        setLearners([]);
        setParents([]);
        setRegistrationStats(null);
      })
      .finally(() => {
        if (!cancelled) setRegistrationsDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId, learnersVersion]);

  useEffect(() => {
    const onLearnersRefresh = () => setLearnersVersion((v) => v + 1);
    window.addEventListener(LEARNERS_REFRESH_EVENT, onLearnersRefresh);
    return () => window.removeEventListener(LEARNERS_REFRESH_EVENT, onLearnersRefresh);
  }, []);



  useEffect(() => {



    const path = location.pathname || "";



    if (!path.startsWith("/dashboard/billing/fees")) return;



    setBillingOpen(true);



    if (path === "/dashboard/billing/fees" || path === "/dashboard/billing/fees/") {
      if (!canPage("fees")) {
        setActivePage(findFirstAllowedSchoolPage(schoolSessionUser) as PageKey);
        navigate("/dashboard");
        return;
      }

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
    const normalizedId = normalizeSaIdNumber(parentIdInput);
    if (!normalizedId || feeLoading) return;

    if (normalizedId !== parentIdInput) {
      setParentIdInput(normalizedId);
    }

    setFeeLoading(true);
    setFeeLookupDone(false);
    setFeeLookupNotFound(false);
    setFeeCheckError("");
    setFeeMessage("");
    setFeeResults([]);
    setFeeSchool("-");
    setFeeParentName("-");

    if (normalizedId.length < 6) {
      setFeeLoading(false);
      setFeeCheckError("Enter a valid ID number (at least 6 digits, numbers only).");
      return;
    }

    const buildId = import.meta.env.VITE_FEE_CHECK_BUILD_ID || "dev";
    const feeCheckUrl = `${API_URL}/api/parents/fee-check/${encodeURIComponent(normalizedId)}?_=${encodeURIComponent(buildId)}`;

    try {
      const res = await fetch(feeCheckUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });

      let data: Record<string, unknown> | null = null;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = null;
      }

      if (!res.ok) {
        const apiError =
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.message === "string" && data.message) ||
          `Fee check failed (${res.status})`;
        setFeeCheckError(apiError);
        return;
      }

      setFeeLookupDone(true);

      const rows: FeeCheckResultCard[] = Array.isArray(data?.results)
        ? (data.results as FeeCheckResultCard[]).map((row) => ({
            parentName: String(row.parentName || data?.parentName || "-"),
            schoolName: String(row.schoolName || data?.school || "-"),
            familyAccountNumber: String(row.familyAccountNumber || "—"),
            outstandingAmount: Number(row.outstandingAmount || 0),
            status: row.status === "RED" || row.status === "AMBER" ? row.status : "GREEN",
            learners: Array.isArray(row.learners) ? row.learners : [],
          }))
        : [];

      if (!data?.found || !rows.length) {
        setFeeLookupNotFound(true);
        setFeeStatus("GREEN");
        setFeeOutstandingAmount(0);
        setFeeSchool("-");
        setFeeParentName("-");
        setFeeMessage("");
        setFeeResults([]);
        return;
      }

      setFeeLookupNotFound(false);
      const aggregateStatus =
        data.status === "RED" || data.status === "AMBER" ? data.status : "GREEN";
      setFeeStatus(aggregateStatus);
      setFeeOutstandingAmount(Number(data.totalOutstanding ?? data.outstandingAmount ?? 0));
      setFeeSchool(rows.length === 1 ? rows[0].schoolName : `${rows.length} accounts`);
      setFeeParentName(rows[0].parentName || "-");
      setFeeResults(rows);

      if (aggregateStatus === "RED") {
        setFeeMessage("Immediate action required – high outstanding balance");
      } else if (aggregateStatus === "AMBER") {
        setFeeMessage("Payment arrangement required");
      } else {
        setFeeMessage("Account in good standing");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to complete fee check. Check your connection and try again.";
      setFeeCheckError(message);
    } finally {
      setFeeLoading(false);
    }
  };



  const filteredLearners = useMemo(() => {



    const base = showUnenrolled



      ? learners



      : learners.filter((learner: any) => isActiveEnrollment(learner));



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



  const activeLearners = useMemo(
    () => learners.filter((learner: any) => isActiveEnrollment(learner)),
    [learners]
  );

  const totalLearners = filteredLearners.length;

  const totalParents = registrationStats?.parents ?? parents.length;

  const totalBoys =
    registrationStats?.boys ??
    activeLearners.filter((learner: any) => isMaleLearnerForStats(learner)).length;

  const totalGirls =
    registrationStats?.girls ??
    activeLearners.filter((learner: any) => isFemaleLearnerForStats(learner)).length;

  const totalClassrooms =
    registrationStats?.classrooms ??
    new Set(
      activeLearners
        .map((learner: any) => learnerClassroom(learner))
        .filter((c: string) => c && !/no classroom/i.test(String(c)))
    ).size;

  const averageClassSize =
    registrationStats?.avg ??
    (totalClassrooms > 0 ? Math.round(activeLearners.length / totalClassrooms) : 0);




  const readJsonArray = (key: string) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const refreshBillingRows = useCallback(async () => {
    if (!schoolId) return;
    await refreshBillingFromApi(schoolId);
    setBillingVersion((v) => v + 1);
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    refreshBillingFromApi(schoolId).catch(() => {});
    const onBillingUpdated = () => setBillingVersion((v) => v + 1);
    window.addEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
    window.addEventListener(KIDESYS_HISTORY_UPDATED_EVENT, onBillingUpdated);
    return () => {
      window.removeEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
      window.removeEventListener(KIDESYS_HISTORY_UPDATED_EVENT, onBillingUpdated);
    };
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const billingPages: PageKey[] = [
      "statements",
      "statementManage",
      "invoices",
      "invoiceCreate",
      "payments",
      "paymentCreate",
    ];
    if (!billingPages.includes(activePage)) return;
    refreshBillingRows().catch(() => {});
  }, [activePage, schoolId, refreshBillingRows]);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    fetch(`${API_URL}/api/schools`)
      .then((res) => res.json())
      .then((rows) => {
        if (cancelled) return;
        const match = Array.isArray(rows) ? rows.find((row: any) => row?.id === schoolId) : null;
        if (match) {
          setSchoolBranding({
            name: String(match.name || localStorage.getItem("schoolName") || "School").trim() || "School",
            email: String(match.email || "").trim(),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const statementRows = useMemo(
    () => getBillingRows(learners || [], schoolId || ""),
    [learners, schoolId, billingVersion]
  );

  const selectPaymentAccount = useCallback((account: PaymentAccountContext) => {
    const normalized = normalizePaymentAccount(account, statementRows, learners) || account;
    setSelectedAccount(normalized);
    persistPaymentAccount(normalized);
  }, [statementRows, learners]);

  const openPaymentCreate = useCallback(
    (account?: PaymentAccountContext | null) => {
      if (!account) return;
      let normalized = normalizePaymentAccount(account, statementRows, learners) || account;
      const accountNo = String(normalized.accountNo || "").trim();
      const learnerId = String(normalized.learnerId || "").trim();
      const learnerIdValid = (learners || []).some(
        (l: any) => String(l?.id || l?.learnerId || "").trim() === learnerId
      );
      const kidRef = normalizeKidESysAccountRef(accountNo);
      if (!learnerIdValid && kidRef) {
        const match = (learners || []).find(
          (l: any) => resolveKidESysAccountRefFromLearner(l) === kidRef
        );
        if (match) {
          const resolvedId = String(match.id || match.learnerId || "").trim();
          normalized = {
            ...normalized,
            learnerId: resolvedId,
            id: resolvedId,
          };
        }
      }
      console.log("OPEN PAYMENT ACCOUNT", normalized);
      setSelectedAccount(normalized);
      persistPaymentAccount(normalized);
      setPaymentForm(defaultPaymentForm(normalized));
      const resolvedLearnerId = String(normalized.learnerId || "").trim();
      if (resolvedLearnerId) {
        const learner =
          learners.find((l: any) => String(l?.id || l?.learnerId || "") === resolvedLearnerId) ||
          null;
        if (learner) setSelectedLearner(learner);
      }
      setActivePage("paymentCreate");
    },
    [learners, statementRows]
  );

  useEffect(() => {
    if (!selectedAccount) return;
    const refreshed = normalizePaymentAccount(selectedAccount, statementRows, learners);
    if (!refreshed) return;
    if (paymentAccountContextsEqual(selectedAccount, refreshed)) return;
    setSelectedAccount(refreshed);
  }, [
    billingVersion,
    learnersVersion,
    selectedAccount?.learnerId ?? "",
    selectedAccount?.accountNo ?? "",
  ]);

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



  ) => {
    const billingPageSize = 10;
    const billingSearchQ = billingAccountsSearch.trim().toLowerCase();
    const billingFilteredRows = !billingSearchQ
      ? rows
      : rows.filter((row) =>
          [
            row.accountNo,
            row.name,
            row.surname,
            row.balance,
            row.lastInvoice,
            row.lastPayment,
            row.status,
          ]
            .join(" ")
            .toLowerCase()
            .includes(billingSearchQ)
        );
    const billingPageCount = Math.max(
      1,
      Math.ceil(billingFilteredRows.length / billingPageSize)
    );
    const billingSafePage = Math.min(billingAccountsPage, billingPageCount);
    const billingPagedRows = billingFilteredRows.slice(
      (billingSafePage - 1) * billingPageSize,
      billingSafePage * billingPageSize
    );
    const billingFirstItem =
      billingFilteredRows.length === 0
        ? 0
        : (billingSafePage - 1) * billingPageSize + 1;
    const billingLastItem = Math.min(
      billingSafePage * billingPageSize,
      billingFilteredRows.length
    );

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



      <div style={{ marginBottom: "18px" }}>



        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>



          {title}



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>{subtitle}</p>



      </div>



      <BillingSummaryCards rows={rows} />



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



          <input
            placeholder="Search"
            value={billingAccountsSearch}
            onChange={(e) => {
              setBillingAccountsSearch(e.target.value);
              setBillingAccountsPage(1);
            }}
            style={{ ...selectStyle, width: "230px" }}
          />



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



            {billingFilteredRows.length === 0 ? (



              <tr>



                <td colSpan={7} style={{ ...td, textAlign: "center", padding: "20px" }}>



                  No accounts found



                </td>



              </tr>



            ) : (



              billingPagedRows.map((row, index) => {



                const isSelected = String(selected?.accountNo || "") === String(row.accountNo || "");



                return (



                  <tr



                    key={`${row.accountNo || row.learnerId || "row"}-${index}`}



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



                    <td style={td}>
                      {isMigratedOpeningBalanceOverviewLabel(row.lastInvoice) ||
                      row.lastInvoice === "No invoices" ||
                      !row.lastInvoice
                        ? row.lastInvoice || "No invoices"
                        : `${row.lastInvoice}${row.lastInvoiceDate ? ` on ${row.lastInvoiceDate}` : ""}`}
                    </td>



                    <td style={td}>{row.lastPayment || "No payments"}</td>



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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
            flexWrap: "wrap",
            gap: 12,
            padding: "0 4px",
          }}
        >
          <span style={{ color: "#64748b", fontWeight: 800 }}>
            {billingFirstItem} - {billingLastItem} / {billingFilteredRows.length}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              style={goldBtn}
              disabled={billingSafePage <= 1}
              onClick={() => setBillingAccountsPage(1)}
            >
              «
            </button>
            <button
              type="button"
              style={goldBtn}
              disabled={billingSafePage <= 1}
              onClick={() => setBillingAccountsPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span style={{ padding: "0 8px", fontWeight: 900, color: "#0f172a" }}>
              Page {billingSafePage} / {billingPageCount}
            </span>
            <button
              type="button"
              style={goldBtn}
              disabled={billingSafePage >= billingPageCount}
              onClick={() => setBillingAccountsPage((p) => Math.min(billingPageCount, p + 1))}
            >
              ›
            </button>
            <button
              type="button"
              style={goldBtn}
              disabled={billingSafePage >= billingPageCount}
              onClick={() => setBillingAccountsPage(billingPageCount)}
            >
              »
            </button>
          </div>
        </div>



      </div>



    </div>



  );
  };

  const getLearnerGrade = (learner: any) => {



    const id = String(learner?.id || "");
  
  
  
    return (



      learnerGradeOverrides[id] ||
    
    
    
      learner?.className ||
    
    
    
      learner?.classroom ||
    
    
    
      learner?.classroomName ||
    
    
    
      learner?.grade ||
    
    
    
      ""
    
    
    
    );
  
  
  
  };
  
  
  
  const classroomRows = useMemo(() => {



    const getClassValue = (learner: any) =>
  
  
  
      String(
  
  
  
        getLearnerGrade(learner) ||
  
  
  
          learner.className ||
  
  
  
          learner.classroom ||
  
  
  
          learner.classroomName ||
  
  
  
          learner.grade ||
  
  
  
          ""
  
  
  
      ).trim();
  
  
  
    const map = new Map<string, any>();
  
  
  
    learners.forEach((learner: any) => {
      if (!isActiveEnrollment(learner)) return;

      const className = getClassValue(learner);

      if (!className || /no classroom/i.test(className)) return;
  
  
  
      if (!map.has(className)) {
  
  
  
        map.set(className, {
  
  
  
          id: className,
  
  
  
          name: className,
  
  
  
          teacher: "",
  
  
  
          children: 0,
  
  
  
        });
  
  
  
      }
  
  
  
      map.get(className).children += 1;
  
  
  
    });
  
  
  
    localClassrooms.forEach((classroom: any) => {
  
  
  
      const className = String(classroom.name || "").trim();
  
  
  
      if (!className) return;
  
  
  
      if (!map.has(className)) {
  
  
  
        map.set(className, {
  
  
  
          ...classroom,
  
  
  
          id: classroom.id || className,
  
  
  
          name: className,
  
  
  
          children: 0,
  
  
  
        });
  
  
  
      }
  
  
  
    });
  
  
  
    return Array.from(map.values()).sort((a, b) =>
  
  
  
      String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
  
  
  
    );
  
  
  
  }, [learners, localClassrooms, learnerGradeOverrides]);
  
  
  
       const filteredClassroomRows = useMemo(() => {
  
  
  
    const q = classroomSearch.trim().toLowerCase();
  
  
  
    if (!q) return classroomRows;
  
  
  
    return classroomRows.filter((row) =>
  
  
  
      [row.name, row.teacher, `${row.children} children`].join(" ").toLowerCase().includes(q)
  
  
  
    );
  
  
  
  }, [classroomRows, classroomSearch]);
  
  
  
  const classroomPageSize = 10;
  
  
  
  const classroomTotalPages = Math.max(1, Math.ceil(filteredClassroomRows.length / classroomPageSize));
  
  
  
  const classroomPagedRows = filteredClassroomRows.slice(
  
  
  
    (classroomPage - 1) * classroomPageSize,
  
  
  
    classroomPage * classroomPageSize
  
  
  
  );
  
  
  
  const selectedClassroomLearners = selectedClassroom



  ? learners.filter((learner: any) => {



      const learnerClass = String(



        learner.classroom || ""



      )



        .trim()



        .toLowerCase();



      return (



        learnerClass ===



        String(selectedClassroom.name || "")



          .trim()



          .toLowerCase()



      );



    })



  : [];
  
  
  
  const classroomLearnerPageSize = 5;
  
  
  
  const classroomLearnerTotalPages = Math.max(
  
  
  
    1,
  
  
  
    Math.ceil(selectedClassroomLearners.length / classroomLearnerPageSize)
  
  
  
  );
  
  
  
  const classroomLearnerPagedRows = selectedClassroomLearners.slice(
  
  
  
    (classroomLearnerPage - 1) * classroomLearnerPageSize,
  
  
  
    classroomLearnerPage * classroomLearnerPageSize
  
  
  
  );
  
  
  
  const openClassroomManage = (classroom: any) => {
  
  
  
    setSelectedClassroom(classroom);
  
  
  
    setClassroomDraft(classroom);
  
  
  
    setClassroomMode("manage");
  
  
  
    setClassroomLearnerPage(1);
  
  
  
    setSelectedClassroomLearnerIds([]);
  
  
  
    localStorage.setItem("selectedClassroomForManage", JSON.stringify(classroom));
  
  
  
    setActivePage("classroomManage");
  
  
  
  };
  
  
  
  const renderClassrooms = () => (
  
  
  
    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px", border: "1px solid rgba(15,23,42,0.08)" }}>
  
  
  
      <div style={{ marginBottom: "18px" }}>
  
  
  
        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>Classrooms</h1>
  
  
  
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Manage your classrooms</p>
  
  
  
      </div>
  
  
  
      <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderRadius: "12px", overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>
  
  
  
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", fontWeight: 900 }}>Classrooms</div>
  
  
  
        <div style={{ padding: "10px", display: "flex", gap: "8px", borderBottom: "1px solid #e5e7eb", alignItems: "center" }}>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={() => {
  
  
  
              setClassroomMode("add");
  
  
  
              setSelectedClassroom(null);
  
  
  
              setClassroomDraft({ name: "", teacher: "", minYears: "", minMonths: "", maxYears: "", maxMonths: "", notes: "" });
  
  
  
            }}
  
  
  
          >
  
  
  
            + Add
  
  
  
          </button>
  
  
  
          <button
  
  
  
            style={{ ...actionBtn, opacity: selectedClassroom ? 1 : 0.55 }}
  
  
  
            disabled={!selectedClassroom}
  
  
  
            onClick={() => {
  
  
  
              if (!selectedClassroom) return alert("Please select a classroom first.");
  
  
  
              openClassroomManage(selectedClassroom);
  
  
  
            }}
  
  
  
          >
  
  
  
            ✎ Manage
  
  
  
          </button>
  
  
  
          <div style={{ flex: 1 }} />
  
  
  
          <input
  
  
  
            placeholder="Search"
  
  
  
            value={classroomSearch}
  
  
  
            onChange={(e) => {
  
  
  
              setClassroomSearch(e.target.value);
  
  
  
              setClassroomPage(1);
  
  
  
            }}
  
  
  
            style={{ ...selectStyle, width: "230px" }}
  
  
  
          />
  
  
  
        </div>
  
  
  
        {classroomMode === "add" && (
  
  
  
          <div style={{ padding: "14px", background: "rgba(212,175,55,0.08)", borderBottom: "1px solid #e5e7eb" }}>
  
  
  
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
  
  
  
              <input style={inputStyle} placeholder="Grade name e.g. Grade 1A 2026" value={classroomDraft.name || ""} onChange={(e) => setClassroomDraft((p: any) => ({ ...p, name: e.target.value }))} />
  
  
  
              <input style={inputStyle} placeholder="Teacher" value={classroomDraft.teacher || ""} onChange={(e) => setClassroomDraft((p: any) => ({ ...p, teacher: e.target.value }))} />
  
  
  
              <input style={inputStyle} placeholder="Notes" value={classroomDraft.notes || ""} onChange={(e) => setClassroomDraft((p: any) => ({ ...p, notes: e.target.value }))} />
  
  
  
            </div>
  
  
  
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
  
  
  
              <button
  
  
  
                style={goldBtn}
  
  
  
                onClick={() => {
  
  
  
                  if (!String(classroomDraft.name || "").trim()) return alert("Grade name is required.");
  
  
  
                  const newClassroom = { ...classroomDraft, id: `classroom-${Date.now()}`, children: 0 };
  
  
  
                  setLocalClassrooms((prev) => [newClassroom, ...prev]);
  
  
  
                  setSelectedClassroom(newClassroom);
  
  
  
                  setClassroomMode("none");
  
  
  
                }}
  
  
  
              >
  
  
  
                Save Classroom
  
  
  
              </button>
  
  
  
              <button style={actionBtn} onClick={() => setClassroomMode("none")}>Cancel</button>
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        )}
  
  
  
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
  
  
  
          <thead>
  
  
  
            <tr>
  
  
  
              <th style={th}>Name</th>
  
  
  
              <th style={th}>Teacher</th>
  
  
  
              <th style={th}>Children</th>
  
  
  
            </tr>
  
  
  
          </thead>
  
  
  
          <tbody>
  
  
  
            {classroomPagedRows.map((row, index) => {
  
  
  
              const isSelected = selectedClassroom?.name === row.name;
  
  
  
              return (
  
  
  
                <tr
  
  
  
                  key={row.id || row.name}
  
  
  
                  onClick={() => setSelectedClassroom(row)}
  
  
  
                  onDoubleClick={() => openClassroomManage(row)}
  
  
  
                  style={{
  
  
  
                    cursor: "pointer",
  
  
  
                    background: isSelected ? "linear-gradient(90deg, rgba(212,175,55,0.25), #fff)" : index % 2 === 0 ? "#fff" : "rgba(212,175,55,0.07)",
  
  
  
                    outline: isSelected ? `2px solid ${GOLD}` : "none",
  
  
  
                  }}
  
  
  
                >
  
  
  
                  <td style={td}>{row.name}</td>
  
  
  
                  <td style={td}>{row.teacher || "-"}</td>
  
  
  
                  <td style={td}>



{



  learners.filter((learner: any) => {



    const learnerClass = String(



      learner.className ||



      learner.classroom ||



      learner.classroomName ||



      learner.grade ||



      ""



    ).trim().toLowerCase();



    const rowClass = String(row.name || "").trim().toLowerCase();



    return learnerClass === rowClass;



  }).length



} children



</td>
  
  
  
                </tr>
  
  
  
              );
  
  
  
            })}
  
  
  
          </tbody>
  
  
  
        </table>
  
  
  
        <div style={{ padding: "10px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: 800 }}>
  
  
  
          <span>{filteredClassroomRows.length === 0 ? "0" : (classroomPage - 1) * classroomPageSize + 1} - {Math.min(classroomPage * classroomPageSize, filteredClassroomRows.length)} / {filteredClassroomRows.length}</span>
  
  
  
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
  
  
  
            <button style={actionBtn} disabled={classroomPage <= 1} onClick={() => setClassroomPage((p) => Math.max(1, p - 1))}>‹</button>
  
  
  
            <span>Page {classroomPage} / {classroomTotalPages}</span>
  
  
  
            <button style={actionBtn} disabled={classroomPage >= classroomTotalPages} onClick={() => setClassroomPage((p) => Math.min(classroomTotalPages, p + 1))}>›</button>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
    </div>
  
  
  
  );
  
  const renderClassroomManage = () => {



    const saved = localStorage.getItem("selectedClassroomForManage");
  
  
  
    const classroom =
  
  
  
      selectedClassroom ||
  
  
  
      (saved
  
  
  
        ? (() => {
  
  
  
            try {
  
  
  
              return JSON.parse(saved);
  
  
  
            } catch {
  
  
  
              return null;
  
  
  
            }
  
  
  
          })()
  
  
  
        : null);
  
  
  
    if (!classroom) {
  
  
  
      return (
  
  
  
        <div style={{ padding: "32px" }}>
  
  
  
          <h1 className="page-title">Classroom</h1>
  
  
  
          <p>Select a classroom first.</p>
  
  
  
          <button style={actionBtn} onClick={() => setActivePage("classrooms")}>
  
  
  
            Back
  
  
  
          </button>
  
  
  
        </div>
  
  
  
      );
  
  
  
    }
  
  
  
    const selectedClassName = String(
  
  
  
      classroomDraft?.name || classroom?.name || selectedClassroom?.name || ""
  
  
  
    )
  
  
  
      .trim()
  
     
  
      .toLowerCase();
     
      
  
  
      
  
  
  
    const classroomLearnerTotalPages = Math.max(
  
  
  
      1,
  
  
  
      Math.ceil(selectedClassroomLearners.length / classroomLearnerPageSize)
  
  
  
    );
  
  
  
    const classroomLearnerPagedRows = selectedClassroomLearners.slice(
  
  
  
      (classroomLearnerPage - 1) * classroomLearnerPageSize,
  
  
  
      classroomLearnerPage * classroomLearnerPageSize
  
  
  
    );
  
  
  
    const openLearnerReport = (learner: any) => {
  
  
  
      setSelectedLearnerReport({
  
  
  
        learnerId: learner.id,
  
  
  
        learnerName:
  
  
  
          learner.firstName && learner.lastName
  
  
  
            ? `${learner.firstName} ${learner.lastName}`
  
  
  
            : learner.name || "Learner",
  
  
  
        term: "Term 1",
  
  
  
        average: "",
  
  
  
        attendance: "",
  
  
  
        teacherRemark: "",
  
  
  
        principalRemark: "",
  
  
  
      });
  
  
  
    };
  
  
  
    const moveSelectedLearners = () => {
  
  
  
      const target = window.prompt("Move selected learners to which grade?");
  
  
  
      if (!target) return;
  
  
  
      setLearnerGradeOverrides((prev) => {
  
  
  
        const next = { ...prev };
  
  
  
        selectedClassroomLearnerIds.forEach((id) => {
  
  
  
          next[id] = target;
  
  
  
        });
  
  
  
        return next;
  
  
  
      });
  
  
  
      setLearners((prevLearners: any[]) =>
  
  
  
        prevLearners.map((learner: any) =>
  
  
  
          selectedClassroomLearnerIds.includes(String(learner.id))
  
  
  
            ? {
  
  
  
                ...learner,
  
  
  
                className: target,
  
  
  
                grade: target,
  
  
  
                classroom: target,
  
  
  
                classroomName: target,
  
  
  
              }
  
  
  
            : learner
  
  
  
        )
  
  
  
      );
  
  
  
      setSelectedClassroomLearnerIds([]);
  
  
  
      alert("Selected learners moved successfully. Now click Save on this classroom page.");
  
  
  
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
  
  
  
            Classroom
  
  
  
          </h1>
  
  
  
          <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
  
  
  
            Change classroom information and manage children
  
  
  
          </p>
  
  
  
        </div>
  
  
  
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
  
  
  
          <button style={actionBtn} onClick={() => setActivePage("classrooms")}>
  
  
  
            ← Back
  
  
  
          </button>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={async () => {
  
  
  
              const updated = {
  
  
  
                ...classroom,
  
  
  
                ...classroomDraft,
  
  
  
                name: classroomDraft.name || classroom.name,
  
  
  
              };
  
  
  
              setSelectedClassroom(updated);
  
  
  
              setLocalClassrooms((prev) => {
  
  
  
                const exists = prev.some(
  
  
  
                  (item) => item.id === updated.id || item.name === classroom.name
  
  
  
                );
  
  
  
                return exists
  
  
  
                  ? prev.map((item) =>
  
  
  
                      item.id === updated.id || item.name === classroom.name ? updated : item
  
  
  
                    )
  
  
  
                  : [updated, ...prev];
  
  
  
              });
  
  
  
              localStorage.setItem("selectedClassroomForManage", JSON.stringify(updated));
  
  
  
              for (const [learnerId, newClass] of Object.entries(learnerGradeOverrides)) {
  
  
  
                await fetch(`${API_URL}/api/learners/${learnerId}`, {
  
  
  
                  method: "PUT",
  
  
  
                  headers: { "Content-Type": "application/json" },
  
  
  
                  body: JSON.stringify({
  
  
  
                    className: newClass,
  
  
  
                    classroom: newClass,
  
  
  
                    classroomName: newClass,
  
  
  
                    grade: newClass,
  
  
  
                  }),
  
  
  
                });
  
  
  
              }
  
  
  
              setLearners((prevLearners: any[]) =>
  
  
  
                prevLearners.map((learner: any) => {
  
  
  
                  const override = learnerGradeOverrides[String(learner.id)];
  
  
  
                  if (!override) return learner;
  
  
  
                  return {
  
  
  
                    ...learner,
  
  
  
                    className: override,
  
  
  
                    classroom: override,
  
  
  
                    classroomName: override,
  
  
  
                    grade: override,
  
  
  
                  };
  
  
  
                })
  
  
  
              );
  
  
  
              alert("Classroom saved.");
  
  
  
            }}
  
  
  
          >
  
  
  
            💾 Save
  
  
  
          </button>
  
  
  
          <div style={{ position: "relative" }}>
  
  
  
            <button
  
  
  
              type="button"
  
  
  
              className="btn-secondary"
  
  
  
              onClick={() => setClassroomMoreOpen((prev: boolean) => !prev)}
  
  
  
            >
  
  
  
              More Actions
  
  
  
            </button>
  
  
  
            {classroomMoreOpen && (
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  position: "absolute",
  
  
  
                  top: "52px",
  
  
  
                  left: 0,
  
  
  
                  background: "#ffffff",
  
  
  
                  border: "1px solid #e5e7eb",
  
  
  
                  borderRadius: "14px",
  
  
  
                  boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
  
  
  
                  minWidth: "240px",
  
  
  
                  overflow: "hidden",
  
  
  
                  zIndex: 1000,
  
  
  
                }}
  
  
  
              >
  
  
  
                <button
  
  
  
                  type="button"
  
  
  
                  onClick={() => {
  
  
  
                    setReportTab("reports");
  
  
  
                    setClassroomMoreOpen(false);
  
  
  
                  }}
  
  
  
                  style={{
  
  
  
                    width: "100%",
  
  
  
                    padding: "14px 18px",
  
  
  
                    border: "none",
  
  
  
                    background: "#fff",
  
  
  
                    textAlign: "left",
  
  
  
                    cursor: "pointer",
  
  
  
                    fontWeight: 600,
  
  
  
                  }}
  
  
  
                >
  
  
  
                  📄 Send Learner Digital Reports
  
  
  
                </button>
  
  
  
                <button
  
  
  
                  type="button"
  
  
  
                  onClick={() => {
  
  
  
                    const confirmed = window.confirm("Are you sure you want to delete this classroom?");
  
  
  
                    if (!confirmed) return;
  
  
  
                    setLocalClassrooms((prev: any[]) =>
  
  
  
                      prev.filter((c: any) => c.id !== classroom?.id)
  
  
  
                    );
  
  
  
                    setSelectedClassroom(null);
  
  
  
                    setClassroomMode("none");
  
  
  
                    setClassroomMoreOpen(false);
  
  
  
                    setActivePage("classrooms");
  
  
  
                  }}
  
  
  
                  style={{
  
  
  
                    width: "100%",
  
  
  
                    padding: "14px 18px",
  
  
  
                    border: "none",
  
  
  
                    borderTop: "1px solid #f3f4f6",
  
  
  
                    background: "#fff",
  
  
  
                    textAlign: "left",
  
  
  
                    cursor: "pointer",
  
  
  
                    color: "#dc2626",
  
  
  
                    fontWeight: 700,
  
  
  
                  }}
  
  
  
                >
  
  
  
                  🗑 Delete Classroom
  
  
  
                </button>
  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
  
  
  
        </div>
  
  
  
        {reportTab === "reports" && (
  
  
  
          <div
  
  
  
            style={{
  
  
  
              marginBottom: "22px",
  
  
  
              background: "#fff",
  
  
  
              border: "1px solid #cbd5e1",
  
  
  
              borderRadius: "16px",
  
  
  
              overflow: "hidden",
  
  
  
              boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  
  
  
            }}
  
  
  
          >
  
  
  
            <div
  
  
  
              style={{
  
  
  
                padding: "16px 18px",
  
  
  
                borderBottom: "1px solid #e5e7eb",
  
  
  
                display: "flex",
  
  
  
                justifyContent: "space-between",
  
  
  
                alignItems: "center",
  
  
  
                gap: "12px",
  
  
  
              }}
  
  
  
            >
  
  
  
              <div>
  
  
  
                <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 900 }}>
  
  
  
                  Learner Digital Reports
  
  
  
                </h2>
  
  
  
                <p style={{ margin: "4px 0 0", color: "#64748b", fontWeight: 700 }}>
  
  
  
                  Generate reports for all learners in this classroom.
  
  
  
                </p>
  
  
  
              </div>
  
  
  
              <button
  
  
  
                style={goldBtn}
  
  
  
                onClick={() => {



                  if (selectedClassroomLearners.length === 0) {
                
                
                
                    alert("There are no learners in this classroom to generate reports for.");
                
                
                
                    return;
                
                
                
                  }
                
                
                
                  const confirmed = window.confirm(
                
                
                
                    `Generate learner digital reports for ${selectedClassroomLearners.length} learner(s) in ${classroom.name}?`
                
                
                
                  );
                
                
                
                  if (!confirmed) return;
                
                
                
                  localStorage.setItem(
                
                
                
                    "bulkLearnerReports",
                
                
                
                    JSON.stringify({
                
                
                
                      classroomName: classroom.name,
                
                
                
                      learners: selectedClassroomLearners,
                
                
                
                      createdAt: new Date().toISOString(),
                
                
                
                    })
                
                
                
                  );
                
                
                
                  alert(`${selectedClassroomLearners.length} report(s) prepared. Open each learner report to complete/print/email.`);
                
                
                
                }}
  
  
  
              >
  
  
  
                Generate & Email All
  
  
  
              </button>
  
  
  
            </div>
  
  
  
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
  
  
  
              <thead>
  
  
  
                <tr>
  
  
  
                  <th style={th}>Learner</th>
  
  
  
                  <th style={th}>Class</th>
  
  
  
                  <th style={th}>Actions</th>
  
  
  
                </tr>
  
  
  
              </thead>
  
  
  
              <tbody>
  
  
  
                {selectedClassroomLearners.length === 0 ? (
  
  
  
                  <tr>
  
  
  
                    <td style={td} colSpan={3}>
  
  
  
                      No learners in this classroom.
  
  
  
                    </td>
  
  
  
                  </tr>
  
  
  
                ) : (
  
  
  
                  selectedClassroomLearners.map((learner: any) => (
  
  
  
                    <tr key={learner.id}>
  
  
  
                      <td style={td}>
  
  
  
                        {learner.firstName} {learner.lastName || learner.surname}
  
  
  
                      </td>
  
  
  
                      <td style={td}>{learner.className || learner.classroom || learner.grade || "-"}</td>
  
  
  
                      <td style={td}>
  
  
  
                        <button
  
  
  
                          style={goldBtn}
  
  
  
                          onClick={() => {
  
  
  
                            localStorage.setItem("selectedLearnerForManage", JSON.stringify(learner));
  
  
  
                            navigate("/learners/" + learner.id + "/report");
  
  
  
                          }}
  
  
  
                        >
  
  
  
                          Open Report
  
  
  
                        </button>
  
  
  
                      </td>
  
  
  
                    </tr>
  
  
  
                  ))
  
  
  
                )}
  
  
  
              </tbody>
  
  
  
            </table>
  
  
  
          </div>
  
  
  
        )}
  
  
  
        <div
  
  
  
          style={{
  
  
  
            display: "grid",
  
  
  
            gridTemplateColumns: "minmax(620px,1fr) 380px",
  
  
  
            gap: "28px",
  
  
  
            alignItems: "start",
  
  
  
          }}
  
  
  
        >
  
  
  
          <div
  
  
  
            style={{
  
  
  
              background: "#fff",
  
  
  
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
  
  
  
              <div style={{ padding: "14px", fontWeight: 900, borderRight: "1px solid #cbd5e1" }}>
  
  
  
                Classroom
  
  
  
              </div>
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  padding: "12px 18px",
  
  
  
                  fontWeight: 900,
  
  
  
                  borderTop: `4px solid ${GOLD}`,
  
  
  
                  background: "#fff",
  
  
  
                }}
  
  
  
              >
  
  
  
                General
  
  
  
              </div>
  
  
  
            </div>
  
  
  
            <div
  
  
  
              style={{
  
  
  
                padding: "22px",
  
  
  
                display: "grid",
  
  
  
                gridTemplateColumns: "150px 1fr",
  
  
  
                rowGap: "10px",
  
  
  
                columnGap: "12px",
  
  
  
              }}
  
  
  
            >
  
  
  
              <label style={labelStyle}>* Name</label>
  
  
  
              <input
  
  
  
                style={inputStyle}
  
  
  
                value={classroomDraft.name ?? classroom.name ?? ""}
  
  
  
                onChange={(e) => setClassroomDraft((p: any) => ({ ...p, name: e.target.value }))}
  
  
  
              />
  
  
  
              <label style={labelStyle}>Teacher</label>
  
  
  
              <input
  
  
  
                style={inputStyle}
  
  
  
                value={classroomDraft.teacher ?? classroom.teacher ?? ""}
  
  
  
                onChange={(e) => setClassroomDraft((p: any) => ({ ...p, teacher: e.target.value }))}
  
  
  
              />
  
  
  
              <label style={labelStyle}>Minimum Age</label>
  
  
  
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
  
  
  
                <input
  
  
  
                  style={inputStyle}
  
  
  
                  placeholder="Years"
  
  
  
                  value={classroomDraft.minYears ?? classroom.minYears ?? ""}
  
  
  
                  onChange={(e) => setClassroomDraft((p: any) => ({ ...p, minYears: e.target.value }))}
  
  
  
                />
  
  
  
                <input
  
  
  
                  style={inputStyle}
  
  
  
                  placeholder="Months"
  
  
  
                  value={classroomDraft.minMonths ?? classroom.minMonths ?? ""}
  
  
  
                  onChange={(e) => setClassroomDraft((p: any) => ({ ...p, minMonths: e.target.value }))}
  
  
  
                />
  
  
  
              </div>
  
  
  
              <label style={labelStyle}>Maximum Age</label>
  
  
  
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
  
  
  
                <input
  
  
  
                  style={inputStyle}
  
  
  
                  placeholder="Years"
  
  
  
                  value={classroomDraft.maxYears ?? classroom.maxYears ?? ""}
  
  
  
                  onChange={(e) => setClassroomDraft((p: any) => ({ ...p, maxYears: e.target.value }))}
  
  
  
                />
  
  
  
                <input
  
  
  
                  style={inputStyle}
  
  
  
                  placeholder="Months"
  
  
  
                  value={classroomDraft.maxMonths ?? classroom.maxMonths ?? ""}
  
  
  
                  onChange={(e) => setClassroomDraft((p: any) => ({ ...p, maxMonths: e.target.value }))}
  
  
  
                />
  
  
  
              </div>
  
  
  
              <label style={labelStyle}>Notes</label>
  
  
  
              <textarea
  
  
  
                style={{
  
  
  
                  ...inputStyle,
  
  
  
                  minHeight: "105px",
  
  
  
                  resize: "vertical",
  
  
  
                  fontFamily: "inherit",
  
  
  
                }}
  
  
  
                value={classroomDraft.notes ?? classroom.notes ?? ""}
  
  
  
                onChange={(e) => setClassroomDraft((p: any) => ({ ...p, notes: e.target.value }))}
  
  
  
              />
  
  
  
            </div>
  
  
  
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
  
  
  
              }}
  
  
  
            >
  
  
  
              <div style={{ width: "120px", height: "120px", borderRadius: "999px", background: "#94a3b8" }} />
  
  
  
            </div>
  
  
  
            <div
  
  
  
              style={{
  
  
  
                display: "grid",
  
  
  
                gridTemplateColumns: "120px 1fr",
  
  
  
                border: "1px solid #e5e7eb",
  
  
  
                background: "#fff",
  
  
  
                boxShadow: "0 10px 26px rgba(15,23,42,0.05)",
  
  
  
              }}
  
  
  
            >
  
  
  
              {[
  
  
  
                ["Name", classroomDraft.name || classroom.name || "-"],
  
  
  
                ["Teacher", classroomDraft.teacher || classroom.teacher || "-"],
  
  
  
                ["Children", `${selectedClassroomLearners.length} children`],
  
  
  
                ["Notes", classroomDraft.notes || classroom.notes || ""],
  
  
  
              ].map(([label, value]) => (
  
  
  
                <React.Fragment key={label}>
  
  
  
                  <div
  
  
  
                    style={{
  
  
  
                      padding: "12px",
  
  
  
                      background: "#f1f5f9",
  
  
  
                      fontWeight: 900,
  
  
  
                      textAlign: "right",
  
  
  
                      borderBottom: "1px solid #e5e7eb",
  
  
  
                    }}
  
  
  
                  >
  
  
  
                    {label}
  
  
  
                  </div>
  
  
  
                  <div style={{ padding: "12px", fontWeight: 800, borderBottom: "1px solid #e5e7eb" }}>
  
  
  
                    {value}
  
  
  
                  </div>
  
  
  
                </React.Fragment>
  
  
  
              ))}
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
        <div
  
  
  
          style={{
  
  
  
            marginTop: "18px",
  
  
  
            background: "#fff",
  
  
  
            border: "1px solid #cbd5e1",
  
  
  
            borderRadius: "10px",
  
  
  
            overflow: "hidden",
  
  
  
            boxShadow: "0 14px 34px rgba(15,23,42,0.07)",
  
  
  
          }}
  
  
  
        >
  
  
  
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #cbd5e1", fontWeight: 900, background: "#f8fafc" }}>
  
  
  
            Children
  
  
  
          </div>
  
  
  
          <div style={{ padding: "10px", display: "flex", gap: "8px", borderBottom: "1px solid #e5e7eb" }}>
  
  
  
            <button style={goldBtn} onClick={() => setActivePage("addLearner")}>
  
  
  
              + Add
  
  
  
            </button>
  
  
  
            <button
  
  
  
              style={actionBtn}
  
  
  
              onClick={() => {
  
  
  
                if (selectedClassroomLearnerIds.length !== 1) return alert("Select one learner to manage.");
  
  
  
                const learner = selectedClassroomLearners.find(
  
  
  
                  (l: any) => String(l.id) === String(selectedClassroomLearnerIds[0])
  
  
  
                );
  
  
  
                if (learner) openLearnerProfile(learner);
  
  
  
              }}
  
  
  
            >
  
  
  
              ✎ Manage
  
  
  
            </button>
  
  
  
            <button style={actionBtn} onClick={moveSelectedLearners}>
  
  
  
              ➜ Move
  
  
  
            </button>
  
  
  
            <button
  
  
  
              style={dangerBtn}
  
  
  
              onClick={() => {
  
  
  
                if (selectedClassroomLearnerIds.length === 0) return alert("Select learners first.");
  
  
  
                setLearnerGradeOverrides((prev) => {
  
  
  
                  const next = { ...prev };
  
  
  
                  selectedClassroomLearnerIds.forEach((id) => {
  
  
  
                    next[id] = "";
  
  
  
                  });
  
  
  
                  return next;
  
  
  
                });
  
  
  
                setSelectedClassroomLearnerIds([]);
  
  
  
              }}
  
  
  
            >
  
  
  
              × Remove
  
  
  
            </button>
  
  
  
          </div>
  
  
  
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
  
  
  
            <thead>
  
  
  
              <tr>
  
  
  
                <th style={th}>✓</th>
  
  
  
                <th style={th}>Name</th>
  
  
  
                <th style={th}>Surname</th>
  
  
  
                <th style={th}>Age</th>
  
  
  
                <th style={th}>Child Status</th>
  
  
  
              </tr>
  
  
  
            </thead>
  
  
  
            <tbody>
  
  
  
              {classroomLearnerPagedRows.length === 0 ? (
  
  
  
                <tr>
  
  
  
                  <td style={td} colSpan={5}>
  
  
  
                    No learners in this classroom.
  
  
  
                  </td>
  
  
  
                </tr>
  
  
  
              ) : (
  
  
  
                classroomLearnerPagedRows.map((learner: any, index: number) => {
  
  
  
                  const checked = selectedClassroomLearnerIds.includes(String(learner.id));
  
  
  
                  return (
  
  
  
                    <tr
  
  
  
                      key={learner.id || index}
  
  
  
                      style={{
  
  
  
                        background: checked
  
  
  
                          ? "rgba(212,175,55,0.22)"
  
  
  
                          : index % 2 === 0
  
  
  
                          ? "#fff"
  
  
  
                          : "rgba(212,175,55,0.06)",
  
  
  
                      }}
  
  
  
                    >
  
  
  
                      <td style={td}>
  
  
  
                        <input
  
  
  
                          type="checkbox"
  
  
  
                          checked={checked}
  
  
  
                          onChange={(e) => {
  
  
  
                            const learnerId = String(learner.id);
  
  
  
                            setSelectedClassroomLearnerIds((prev) =>
  
  
  
                              e.target.checked
  
  
  
                                ? [...prev, learnerId]
  
  
  
                                : prev.filter((x) => x !== learnerId)
  
  
  
                            );
  
  
  
                          }}
  
  
  
                        />
  
  
  
                      </td>
  
  
  
                      <td style={td}>{learner.firstName || "-"}</td>
  
  
  
                      <td style={td}>{learner.lastName || learner.surname || "-"}</td>
  
  
  
                      <td style={td}>{calculateLearnerAge(learner.birthDate || learner.dateOfBirth || learner.dob)}</td>
  
  
  
                      <td style={td}>
  
  
  
                        <span
  
  
  
                          style={{
  
  
  
                            color: (learner.childStatus || "Enrolled") === "Enrolled" ? "#15803d" : "#b91c1c",
  
  
  
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
  
  
  
            <span>
  
  
  
              {selectedClassroomLearners.length === 0
  
  
  
                ? "0"
  
  
  
                : (classroomLearnerPage - 1) * classroomLearnerPageSize + 1}{" "}
  
  
  
              - {Math.min(classroomLearnerPage * classroomLearnerPageSize, selectedClassroomLearners.length)} /{" "}
  
  
  
              {selectedClassroomLearners.length}
  
  
  
            </span>
  
  
  
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
  
  
  
              <button
  
  
  
                style={actionBtn}
  
  
  
                disabled={classroomLearnerPage <= 1}
  
  
  
                onClick={() => setClassroomLearnerPage((p) => Math.max(1, p - 1))}
  
  
  
              >
  
  
  
                ‹
  
  
  
              </button>
  
  
  
              <span>
  
  
  
                Page {classroomLearnerPage} / {classroomLearnerTotalPages}
  
  
  
              </span>
  
  
  
              <button
  
  
  
                style={actionBtn}
  
  
  
                disabled={classroomLearnerPage >= classroomLearnerTotalPages}
  
  
  
                onClick={() => setClassroomLearnerPage((p) => Math.min(classroomLearnerTotalPages, p + 1))}
  
  
  
              >
  
  
  
                ›
  
  
  
              </button>
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
    );
  
  
  
  };
  
  

  const groupRows = useMemo(() => {



    return localGroups
  
  
  
      .map((group) => ({
  
  
  
        ...group,
  
  
  
        children: Array.isArray(group.learnerIds) ? group.learnerIds.length : 0,
  
  
  
      }))
  
  
  
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  
  
  
  }, [localGroups]);
  
  
  
  const filteredGroupRows = useMemo(() => {
  
  
  
    const q = groupSearch.trim().toLowerCase();
  
  
  
    if (!q) return groupRows;
  
  
  
    return groupRows.filter((group) =>
  
  
  
      [group.name, group.comments, `${group.children} children`]
  
  
  
        .join(" ")
  
  
  
        .toLowerCase()
  
  
  
        .includes(q)
  
  
  
    );
  
  
  
  }, [groupRows, groupSearch]);
  
  
  
  const groupPageSize = 10;
  
  
  
  const groupTotalPages = Math.max(1, Math.ceil(filteredGroupRows.length / groupPageSize));
  
  
  
  const groupPagedRows = filteredGroupRows.slice(
  
  
  
    (groupPage - 1) * groupPageSize,
  
  
  
    groupPage * groupPageSize
  
  
  
  );
  
  
  
  const selectedGroupLearners = selectedGroup
  
  
  
    ? learners.filter((learner: any) =>
  
  
  
        Array.isArray(selectedGroup.learnerIds)
  
  
  
          ? selectedGroup.learnerIds.map(String).includes(String(learner.id))
  
  
  
          : false
  
  
  
      )
  
  
  
    : [];
  
  
  
  const groupLearnerPageSize = 5;
  
  
  
  const groupLearnerTotalPages = Math.max(1, Math.ceil(selectedGroupLearners.length / groupLearnerPageSize));
  
  
  
  const groupLearnerPagedRows = selectedGroupLearners.slice(
  
  
  
    (groupLearnerPage - 1) * groupLearnerPageSize,
  
  
  
    groupLearnerPage * groupLearnerPageSize
  
  
  
  );
  
  
  
  const openGroupManage = (group: any) => {
  
  
  
    setSelectedGroup(group);
  
  
  
    setGroupDraft(group);
  
  
  
    setGroupLearnerPage(1);
  
  
  
    setSelectedGroupLearnerIds([]);
  
  
  
    localStorage.setItem("selectedGroupForManage", JSON.stringify(group));
  
  
  
    setActivePage("groupManage");
  
  
  
  };
  
  
  
  const saveGroup = (updatedGroup: any) => {
  
  
  
    setSelectedGroup(updatedGroup);



setGroupDraft(updatedGroup);



const updatedGroups =



  localGroups.some((item: any) => item.id === updatedGroup.id)



    ? localGroups.map((item: any) =>



        item.id === updatedGroup.id ? updatedGroup : item



      )



    : [...localGroups, updatedGroup];



setLocalGroups(updatedGroups);



localStorage.setItem(



  "educlearGroups",



  JSON.stringify(updatedGroups)



);
  
  
  
    localStorage.setItem("selectedGroupForManage", JSON.stringify(updatedGroup));
  
  
  
  };
  
  
  
  const renderGroups = () => (
  
  
  
    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px", border: "1px solid rgba(15,23,42,0.08)" }}>
  
  
  
      <div style={{ marginBottom: "18px" }}>
  
  
  
        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>Groups</h1>
  
  
  
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Manage your groups</p>
  
  
  
      </div>
  
  
  
      <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderTop: `4px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>
  
  
  
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", fontWeight: 900 }}>
  
  
  
          Groups
  
  
  
        </div>
  
  
  
        <div style={{ padding: "10px", display: "flex", gap: "8px", borderBottom: "1px solid #e5e7eb", alignItems: "center" }}>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={() => {
  
  
  
              setGroupMode("add");
  
  
  
              setSelectedGroup(null);
  
  
  
              setGroupDraft({ name: "", comments: "", learnerIds: [] });
  
  
  
            }}
  
  
  
          >
  
  
  
            + Add
  
  
  
          </button>
  
  
  
          <button
  
  
  
            style={{ ...actionBtn, opacity: selectedGroup ? 1 : 0.55, cursor: selectedGroup ? "pointer" : "not-allowed" }}
  
  
  
            disabled={!selectedGroup}
  
  
  
            onClick={() => {
  
  
  
              if (!selectedGroup) return alert("Please select a group first.");
  
  
  
              openGroupManage(selectedGroup);
  
  
  
            }}
  
  
  
          >
  
  
  
            ✎ Manage
  
  
  
          </button>
  
  
  
          <div style={{ flex: 1 }} />
  
  
  
          <input
  
  
  
            placeholder="Search"
  
  
  
            value={groupSearch}
  
  
  
            onChange={(e) => {
  
  
  
              setGroupSearch(e.target.value);
  
  
  
              setGroupPage(1);
  
  
  
            }}
  
  
  
            style={{ ...selectStyle, width: "230px" }}
  
  
  
          />
  
  
  
        </div>
  
  
  
        {groupMode === "add" && (
  
  
  
          <div style={{ padding: "14px", background: "rgba(212,175,55,0.08)", borderBottom: "1px solid #e5e7eb" }}>
  
  
  
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "10px" }}>
  
  
  
              <input
  
  
  
                style={inputStyle}
  
  
  
                placeholder="Group name"
  
  
  
                value={groupDraft.name || ""}
  
  
  
                onChange={(e) => setGroupDraft((p: any) => ({ ...p, name: e.target.value }))}
  
  
  
              />
  
  
  
              <input
  
  
  
                style={inputStyle}
  
  
  
                placeholder="Comments"
  
  
  
                value={groupDraft.comments || ""}
  
  
  
                onChange={(e) => setGroupDraft((p: any) => ({ ...p, comments: e.target.value }))}
  
  
  
              />
  
  
  
            </div>
  
  
  
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
  
  
  
              <button
  
  
  
                style={goldBtn}
  
  
  
                onClick={() => {
  
  
  
                  if (!String(groupDraft.name || "").trim()) return alert("Group name is required.");
  
  
  
                  const newGroup = {
  
  
  
                    id: `group-${Date.now()}`,
  
  
  
                    name: groupDraft.name,
  
  
  
                    comments: groupDraft.comments || "",
  
  
  
                    learnerIds: [],
  
  
  
                  };
  
  
  
                  saveGroup(newGroup);
  
  
  
                  setGroupMode("none");
  
  
  
                }}
  
  
  
              >
  
  
  
                Save Group
  
  
  
              </button>
  
  
  
              <button style={actionBtn} onClick={() => setGroupMode("none")}>
  
  
  
                Cancel
  
  
  
              </button>
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        )}
  
  
  
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
  
  
  
          <thead>
  
  
  
            <tr>
  
  
  
              <th style={th}>Name</th>
  
  
  
              <th style={th}>Children</th>
  
  
  
              <th style={th}>Comments</th>
  
  
  
            </tr>
  
  
  
          </thead>
  
  
  
          <tbody>
  
  
  
            {groupPagedRows.length === 0 ? (
  
  
  
              <tr>
  
  
  
                <td colSpan={3} style={{ ...td, textAlign: "center", padding: "24px" }}>
  
  
  
                  No groups found. Click + Add to create your first group.
  
  
  
                </td>
  
  
  
              </tr>
  
  
  
            ) : (
  
  
  
              groupPagedRows.map((group, index) => {
  
  
  
                const isSelected = selectedGroup?.id === group.id;
  
  
  
                return (
  
  
  
                  <tr
  
  
  
                    key={group.id}
  
  
  
                    onClick={() => setSelectedGroup(group)}
  
  
  
                    onDoubleClick={() => openGroupManage(group)}
  
  
  
                    style={{
  
  
  
                      cursor: "pointer",
  
  
  
                      background: isSelected
  
  
  
                        ? "linear-gradient(90deg, rgba(212,175,55,0.25), #fff)"
  
  
  
                        : index % 2 === 0
  
  
  
                        ? "#fff"
  
  
  
                        : "rgba(212,175,55,0.07)",
  
  
  
                      outline: isSelected ? `2px solid ${GOLD}` : "none",
  
  
  
                    }}
  
  
  
                  >
  
  
  
                    <td style={td}>{group.name}</td>
  
  
  
                    <td style={td}>{group.children} children</td>
  
  
  
                    <td style={td}>{group.comments || "-"}</td>
  
  
  
                  </tr>
  
  
  
                );
  
  
  
              })
  
  
  
            )}
  
  
  
          </tbody>
  
  
  
        </table>
  
  
  
        <div style={{ padding: "10px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: 800 }}>
  
  
  
          <span>
  
  
  
            {filteredGroupRows.length === 0 ? "0" : (groupPage - 1) * groupPageSize + 1} - {Math.min(groupPage * groupPageSize, filteredGroupRows.length)} / {filteredGroupRows.length}
  
  
  
          </span>
  
  
  
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
  
  
  
            <button style={actionBtn} disabled={groupPage <= 1} onClick={() => setGroupPage((p) => Math.max(1, p - 1))}>‹</button>
  
  
  
            <span>Page {groupPage} / {groupTotalPages}</span>
  
  
  
            <button style={actionBtn} disabled={groupPage >= groupTotalPages} onClick={() => setGroupPage((p) => Math.min(groupTotalPages, p + 1))}>›</button>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
    </div>
  
  
  
  );
  const renderGroupManage = () => {



    const saved = localStorage.getItem("selectedGroupForManage");
  
  
  
    const group =
  
  
  
      selectedGroup ||
  
  
  
      (saved
  
  
  
        ? (() => {
  
  
  
            try {
  
  
  
              return JSON.parse(saved);
  
  
  
            } catch {
  
  
  
              return null;
  
  
  
            }
  
  
  
          })()
  
  
  
        : null);
  
  
  
    if (!group) {
  
  
  
      return (
  
  
  
        <div style={{ padding: "32px" }}>
  
  
  
          <h1 className="page-title">Group</h1>
  
  
  
          <p>Select a group first.</p>
  
  
  
          <button style={actionBtn} onClick={() => setActivePage("groups")}>
  
  
  
            Back
  
  
  
          </button>
  
  
  
        </div>
  
  
  
      );
  
  
  
    }
  
  
  
    const addLearnerToGroup = () => {
  
  
  
      const typed = window.prompt("Type learner name to add to this group:");
  
  
  
      if (!typed) return;
  
  
  
      const found = learners.find((learner: any) =>
  
  
  
        `${learner.firstName || ""} ${learner.lastName || learner.surname || ""}`
  
  
  
          .toLowerCase()
  
  
  
          .includes(typed.toLowerCase())
  
  
  
      );
  
  
  
      if (!found) return alert("Learner not found.");
  
  
  
      if ((group.learnerIds || []).map(String).includes(String(found.id))) {
  
  
  
        return alert("Learner is already in this group.");
  
  
  
      }
  
  
  
      saveGroup({
  
  
  
        ...group,
  
  
  
        learnerIds: [...(group.learnerIds || []), String(found.id)],
  
  
  
      });
  
  
  
    };
  
  
  
    const removeLearnersFromGroup = () => {
  
  
  
      if (selectedGroupLearnerIds.length === 0) return alert("Select learners first.");
  
  
  
      saveGroup({
  
  
  
        ...group,
  
  
  
        learnerIds: (group.learnerIds || []).filter(
  
  
  
          (id: string) => !selectedGroupLearnerIds.includes(String(id))
  
  
  
        ),
  
  
  
      });
  
  
  
      setSelectedGroupLearnerIds([]);
  
  
  
    };
  
  
  
    return (
  
  
  
      <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px", border: "1px solid rgba(15,23,42,0.08)" }}>
  
  
  
        <div style={{ marginBottom: "12px" }}>
  
  
  
          <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>Group</h1>
  
  
  
          <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Change group information and manage children</p>
  
  
  
        </div>
  
  
  
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
  
  
  
          <button style={actionBtn} onClick={() => setActivePage("groups")}>
  
  
  
            ← Back
  
  
  
          </button>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={() => {
  
  
  
              saveGroup({
  
  
  
                ...group,
  
  
  
                ...groupDraft,
  
  
  
                name: groupDraft.name || group.name,
  
  
  
                comments: groupDraft.comments ?? group.comments ?? "",
  
  
  
                learnerIds: group.learnerIds || [],
  
  
  
              });
  
  
  
              alert("Group saved.");
  
  
  
            }}
  
  
  
          >
  
  
  
            💾 Save
  
  
  
          </button>
  
  
  
          <button style={actionBtn} onClick={() => alert("More group actions will be connected later.")}>
  
  
  
            More Actions⌄
  
  
  
          </button>
  
  
  
        </div>
  
  
  
        <div style={{ background: "#fff", border: "1px solid #cbd5e1", borderTop: `4px solid ${GOLD}`, borderRadius: "10px", overflow: "hidden", boxShadow: "0 14px 34px rgba(15,23,42,0.07)", marginBottom: "18px" }}>
  
  
  
          <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", borderBottom: "1px solid #cbd5e1", background: "#f8fafc" }}>
  
  
  
            <div style={{ padding: "14px", fontWeight: 900, borderRight: "1px solid #cbd5e1" }}>
  
  
  
              Group
  
  
  
            </div>
  
  
  
            <div style={{ padding: "12px 18px", fontWeight: 900, background: "#fff" }}>
  
  
  
              General
  
  
  
            </div>
  
  
  
          </div>
  
  
  
          <div style={{ padding: "22px", display: "grid", gridTemplateColumns: "150px 1fr", rowGap: "10px", columnGap: "12px" }}>
  
  
  
            <label style={labelStyle}>* Name</label>
  
  
  
            <input
  
  
  
              style={inputStyle}
  
  
  
              value={groupDraft.name ?? group.name ?? ""}
  
  
  
              onChange={(e) => setGroupDraft((p: any) => ({ ...p, name: e.target.value }))}
  
  
  
            />
  
  
  
            <label style={labelStyle}>Notes</label>
  
  
  
            <textarea
  
  
  
              style={{ ...inputStyle, minHeight: "105px", resize: "vertical", fontFamily: "inherit" }}
  
  
  
              value={groupDraft.comments ?? group.comments ?? ""}
  
  
  
              onChange={(e) => setGroupDraft((p: any) => ({ ...p, comments: e.target.value }))}
  
  
  
            />
  
  
  
          </div>
  
  
  
        </div>
  
  
  
        <div style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "10px", overflow: "hidden", boxShadow: "0 14px 34px rgba(15,23,42,0.07)" }}>
  
  
  
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #cbd5e1", fontWeight: 900, background: "#f8fafc" }}>
  
  
  
            Children
  
  
  
          </div>
  
  
  
          <div style={{ padding: "10px", display: "flex", gap: "8px", borderBottom: "1px solid #e5e7eb" }}>
  
  
  
            <button style={goldBtn} onClick={addLearnerToGroup}>
  
  
  
              + Add
  
  
  
            </button>
  
  
  
            <button
  
  
  
              style={actionBtn}
  
  
  
              onClick={() => {
  
  
  
                if (selectedGroupLearnerIds.length !== 1) return alert("Select one learner to manage.");
  
  
  
                const learner = selectedGroupLearners.find(
  
  
  
                  (item: any) => String(item.id) === String(selectedGroupLearnerIds[0])
  
  
  
                );
  
  
  
                if (learner) openLearnerProfile(learner);
  
  
  
              }}
  
  
  
            >
  
  
  
              ✎ Manage
  
  
  
            </button>
  
  
  
            <button style={dangerBtn} onClick={removeLearnersFromGroup}>
  
  
  
              × Remove
  
  
  
            </button>
  
  
  
          </div>
  
  
  
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
  
  
  
            <thead>
  
  
  
              <tr>
  
  
  
                <th style={th}>✓</th>
  
  
  
                <th style={th}>Name</th>
  
  
  
                <th style={th}>Surname</th>
  
  
  
                <th style={th}>Grade</th>
  
  
  
                <th style={th}>Age</th>
  
  
  
                <th style={th}>Child Status</th>
  
  
  
              </tr>
  
  
  
            </thead>
  
  
  
            <tbody>
  
  
  
              {groupLearnerPagedRows.length === 0 ? (
  
  
  
                <tr>
  
  
  
                  <td colSpan={6} style={{ ...td, textAlign: "center", padding: "20px" }}>
  
  
  
                    No learners linked to this group yet
  
  
  
                  </td>
  
  
  
                </tr>
  
  
  
              ) : (
  
  
  
                groupLearnerPagedRows.map((learner: any, index: number) => {
  
  
  
                  const checked = selectedGroupLearnerIds.includes(String(learner.id));
  
  
  
                  return (
  
  
  
                    <tr
  
  
  
                      key={learner.id || index}
  
  
  
                      style={{
  
  
  
                        background: checked
  
  
  
                          ? "rgba(212,175,55,0.22)"
  
  
  
                          : index % 2 === 0
  
  
  
                          ? "#fff"
  
  
  
                          : "rgba(212,175,55,0.06)",
  
  
  
                      }}
  
  
  
                    >
  
  
  
                      <td style={td}>
  
  
  
                        <input
  
  
  
                          type="checkbox"
  
  
  
                          checked={checked}
  
  
  
                          onChange={(e) => {
  
  
  
                            const id = String(learner.id);
  
  
  
                            setSelectedGroupLearnerIds((prev) =>
  
  
  
                              e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)
  
  
  
                            );
  
  
  
                          }}
  
  
  
                        />
  
  
  
                      </td>
  
  
  
                      <td style={td}>{learner.firstName || "-"}</td>
  
  
  
                      <td style={td}>{learner.lastName || learner.surname || "-"}</td>
  
  
  
                      <td style={td}>{getLearnerGrade(learner) || "-"}</td>
  
  
  
                      <td style={td}>{calculateLearnerAge(learner.birthDate || learner.dateOfBirth || learner.dob)}</td>
  
  
  
                      <td style={td}>
  
  
  
                        <span style={{ color: (learner.childStatus || "Enrolled") === "Enrolled" ? "#15803d" : "#b91c1c", fontWeight: 900 }}>
  
  
  
                          {learner.childStatus || "Enrolled"}
  
  
  
                        </span>
  
  
  
                      </td>
  
  
  
                    </tr>
  
  
  
                  );
  
  
  
                })
  
  
  
              )}
  
  
  
            </tbody>
  
  
  
          </table>
  
  
  
          <div style={{ padding: "10px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: 800 }}>
  
  
  
            <span>
  
  
  
              {selectedGroupLearners.length === 0 ? "0" : (groupLearnerPage - 1) * groupLearnerPageSize + 1} - {Math.min(groupLearnerPage * groupLearnerPageSize, selectedGroupLearners.length)} / {selectedGroupLearners.length}
  
  
  
            </span>
  
  
  
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
  
  
  
              <button style={actionBtn} disabled={groupLearnerPage <= 1} onClick={() => setGroupLearnerPage((p) => Math.max(1, p - 1))}>
  
  
  
                ‹
  
  
  
              </button>
  
  
  
              <span>
  
  
  
                Page {groupLearnerPage} / {groupLearnerTotalPages}
  
  
  
              </span>
  
  
  
              <button style={actionBtn} disabled={groupLearnerPage >= groupLearnerTotalPages} onClick={() => setGroupLearnerPage((p) => Math.min(groupLearnerTotalPages, p + 1))}>
  
  
  
                ›
  
  
  
              </button>
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
    );
  
  
  
  };

  const employeeRows = useMemo(() => {



    return localEmployees.sort((a, b) =>
  
  
  
      `${a.surname || ""} ${a.firstName || ""}`.localeCompare(`${b.surname || ""} ${b.firstName || ""}`)
  
  
  
    );
  
  
  
  }, [localEmployees]);
  
  
  
  const filteredEmployeeRows = useMemo(() => {
  
  
  
    const q = employeeSearch.trim().toLowerCase();
  
  
  
    if (!q) return employeeRows;
  
  
  
    return employeeRows.filter((employee) =>
  
  
  
      [
  
  
  
        employee.occupation,
  
  
  
        employee.title,
  
  
  
        employee.firstName,
  
  
  
        employee.surname,
  
  
  
        employee.phone,
  
  
  
        employee.cell,
  
  
  
        employee.email,
  
  
  
        employee.idNumber,
  
  
  
      ]
  
  
  
        .join(" ")
  
  
  
        .toLowerCase()
  
  
  
        .includes(q)
  
  
  
    );
  
  
  
  }, [employeeRows, employeeSearch]);
  
  
  
  const employeePageSize = 10;
  
  
  
  const employeeTotalPages = Math.max(1, Math.ceil(filteredEmployeeRows.length / employeePageSize));
  
  
  
  const employeePagedRows = filteredEmployeeRows.slice(
  
  
  
    (employeePage - 1) * employeePageSize,
  
  
  
    employeePage * employeePageSize
  
  
  
  );
  
  
  
  const employeeFullName = (employee: any) =>
  
  
  
    `${employee?.firstName || ""} ${employee?.surname || ""}`.trim();
  
  
  
  const saveEmployee = async (updatedEmployee: any) => {
    if (!schoolId) {
      alert("School ID is missing. Cannot save employee.");
      return;
    }

    try {
      const saved = await saveSchoolEmployee(schoolId, updatedEmployee);

      setSelectedEmployee(saved);
      setEmployeeDraft(saved);

      setLocalEmployees((prev: any[]) => {
        const next = [
          saved,
          ...prev.filter((item) => item.id !== saved.id && item.id !== updatedEmployee.id),
        ];
        writeEmployeesCache(next);
        return next;
      });

      localStorage.setItem("selectedEmployeeForManage", JSON.stringify(saved));
    } catch (e: any) {
      alert(e?.message || "Failed to save employee");
      throw e;
    }
  };

  const loadSchoolEmployees = useCallback(async () => {
    if (!schoolId) return;

    setEmployeesLoading(true);
    setEmployeesLoadError("");

    try {
      const rows = await fetchSchoolEmployees(schoolId);
      setLocalEmployees(rows);
      writeEmployeesCache(rows);
    } catch (e: any) {
      setEmployeesLoadError(e?.message || "Failed to load employees");
      const cached = readEmployeesCache();
      if (cached.length) setLocalEmployees(cached);
    } finally {
      setEmployeesLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadSchoolEmployees();
  }, [loadSchoolEmployees]);
  
  
  
  const openEmployeeManage = (employee: any) => {
  
  
  
    setSelectedEmployee(employee);
  
  
  
    setEmployeeDraft(employee);
  
  
  
    setEmployeeTab("general");
  
  
  
    setEmployeeMoreOpen(false);
  
  
  
    localStorage.setItem("selectedEmployeeForManage", JSON.stringify(employee));
  
  
  
    setActivePage("employeeManage");
  
  
  
  };
  
  
  
  const renderEmployees = () => (
  
  
  
    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px", border: "1px solid rgba(15,23,42,0.08)" }}>
  
  
  
      <div style={{ marginBottom: "18px" }}>
  
  
  
        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>Employees</h1>
  
  
  
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Manage your employees</p>
        {employeesLoading ? (
          <p style={{ margin: "8px 0 0", color: "#64748b", fontWeight: 700, fontSize: "13px" }}>Syncing employees…</p>
        ) : null}
        {employeesLoadError ? (
          <p style={{ margin: "8px 0 0", color: "#b45309", fontWeight: 700, fontSize: "13px" }}>
            {employeesLoadError} (showing cached employees if available)
          </p>
        ) : null}
  
  
  
      </div>
  
  
  
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(160px, 1fr))", gap: "12px", marginBottom: "18px" }}>
  
  
  
        <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", borderTop: `4px solid ${GOLD}`, borderRadius: "14px", padding: "16px", boxShadow: "0 10px 26px rgba(15,23,42,0.06)" }}>
  
  
  
          <div style={{ fontSize: "28px", fontWeight: 900, color: "#0f172a" }}>{localEmployees.length}</div>
  
  
  
          <div style={{ color: "#64748b", fontWeight: 900, fontSize: "12px" }}>employees</div>
  
  
  
        </div>
  
  
  
        <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", borderTop: `4px solid ${GOLD}`, borderRadius: "14px", padding: "16px", boxShadow: "0 10px 26px rgba(15,23,42,0.06)" }}>
  
  
  
          <div style={{ fontSize: "28px", fontWeight: 900, color: "#0f172a" }}>
  
  
  
            {localEmployees.filter((e) => String(e.occupation || "").toLowerCase().includes("teacher")).length}
  
  
  
          </div>
  
  
  
          <div style={{ color: "#64748b", fontWeight: 900, fontSize: "12px" }}>teachers</div>
  
  
  
        </div>
  
  
  
        <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", borderTop: `4px solid ${GOLD}`, borderRadius: "14px", padding: "16px", boxShadow: "0 10px 26px rgba(15,23,42,0.06)" }}>
  
  
  
          <div style={{ fontSize: "28px", fontWeight: 900, color: "#0f172a" }}>
  
  
  
            {localEmployees.filter((e) => e.payrollEnabled).length}
  
  
  
          </div>
  
  
  
          <div style={{ color: "#64748b", fontWeight: 900, fontSize: "12px" }}>payroll enabled</div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
      <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderTop: `4px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>
  
  
  
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", fontWeight: 900 }}>
  
  
  
          Employees
  
  
  
        </div>
  
  
  
        <div style={{ padding: "10px", display: "flex", gap: "8px", borderBottom: "1px solid #e5e7eb", alignItems: "center" }}>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={() => {
  
  
  
              setEmployeeMode("add");
  
  
  
              setSelectedEmployee(null);
  
  
  
              setEmployeeDraft({
  
  
  
                occupation: "Teacher",
  
  
  
                title: "",
  
  
  
                firstName: "",
  
  
  
                surname: "",
  
  
  
                idNumber: "",
  
  
  
                employmentDate: "",
  
  
  
                notes: "",
  
  
  
                payrollEnabled: true,
  
  
  
                basicSalary: "",
  
  
  
                uifEnabled: true,
  
  
  
                taxNumber: "",
  
  
  
              });
  
  
  
            }}
  
  
  
          >
  
  
  
            + Add
  
  
  
          </button>
  
  
  
          <button
  
  
  
            style={{ ...actionBtn, opacity: selectedEmployee ? 1 : 0.55, cursor: selectedEmployee ? "pointer" : "not-allowed" }}
  
  
  
            disabled={!selectedEmployee}
  
  
  
            onClick={() => {
  
  
  
              if (!selectedEmployee) return alert("Please select an employee first.");
  
  
  
              openEmployeeManage(selectedEmployee);
  
  
  
            }}
  
  
  
          >
  
  
  
            ✎ Manage
  
  
  
          </button>
  
  
  
          <div style={{ flex: 1 }} />
  
  
  
          <input
  
  
  
            placeholder="Search"
  
  
  
            value={employeeSearch}
  
  
  
            onChange={(e) => {
  
  
  
              setEmployeeSearch(e.target.value);
  
  
  
              setEmployeePage(1);
  
  
  
            }}
  
  
  
            style={{ ...selectStyle, width: "230px" }}
  
  
  
          />
  
  
  
        </div>
  
  
  
        {employeeMode === "add" && (
  
  
  
          <div style={{ padding: "14px", background: "rgba(212,175,55,0.08)", borderBottom: "1px solid #e5e7eb" }}>
  
  
  
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
  
  
  
              <input style={inputStyle} placeholder="Occupation" value={employeeDraft.occupation || ""} onChange={(e) => setEmployeeDraft((p: any) => ({ ...p, occupation: e.target.value }))} />
  
  
  
              <input style={inputStyle} placeholder="Title" value={employeeDraft.title || ""} onChange={(e) => setEmployeeDraft((p: any) => ({ ...p, title: e.target.value }))} />
  
  
  
              <input style={inputStyle} placeholder="Name" value={employeeDraft.firstName || ""} onChange={(e) => setEmployeeDraft((p: any) => ({ ...p, firstName: e.target.value }))} />
  
  
  
              <input style={inputStyle} placeholder="Surname" value={employeeDraft.surname || ""} onChange={(e) => setEmployeeDraft((p: any) => ({ ...p, surname: e.target.value }))} />
  
  
  
              <input style={inputStyle} placeholder="Cell" value={employeeDraft.cell || ""} onChange={(e) => setEmployeeDraft((p: any) => ({ ...p, cell: e.target.value }))} />
  
  
  
            </div>
  
  
  
            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
  
  
  
              <button
  
  
  
                style={goldBtn}
  
  
  
                onClick={async () => {
  
  
  
                  if (!String(employeeDraft.firstName || "").trim()) return alert("Employee name is required.");
  
  
  
                  if (!String(employeeDraft.surname || "").trim()) return alert("Employee surname is required.");
  
  
  
                  try {
                    await saveEmployee(employeeDraft);
                    setEmployeeMode("none");
                  } catch {
                    /* alert shown in saveEmployee */
                  }
  
  
  
                }}
  
  
  
              >
  
  
  
                Save Employee
  
  
  
              </button>
  
  
  
              <button style={actionBtn} onClick={() => setEmployeeMode("none")}>Cancel</button>
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        )}
  
  
  
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
  
  
  
          <thead>
  
  
  
            <tr>
  
  
  
              <th style={th}>Occupation</th>
  
  
  
              <th style={th}>Name</th>
  
  
  
              <th style={th}>Surname</th>
  
  
  
              <th style={th}>Phone</th>
  
  
  
              <th style={th}>Cell</th>
  
  
  
              <th style={th}>Payroll</th>
  
  
  
            </tr>
  
  
  
          </thead>
  
  
  
          <tbody>
  
  
  
            {employeePagedRows.length === 0 ? (
  
  
  
              <tr>
  
  
  
                <td colSpan={6} style={{ ...td, textAlign: "center", padding: "24px" }}>
  
  
  
                  No employees found. Click + Add to create your first employee.
  
  
  
                </td>
  
  
  
              </tr>
  
  
  
            ) : (
  
  
  
              employeePagedRows.map((employee, index) => {
  
  
  
                const isSelected = selectedEmployee?.id === employee.id;
  
  
  
                return (
  
  
  
                  <tr
  
  
  
                    key={employee.id}
  
  
  
                    onClick={() => setSelectedEmployee(employee)}
  
  
  
                    onDoubleClick={() => openEmployeeManage(employee)}
  
  
  
                    style={{
  
  
  
                      cursor: "pointer",
  
  
  
                      background: isSelected
  
  
  
                        ? "linear-gradient(90deg, rgba(212,175,55,0.25), #fff)"
  
  
  
                        : index % 2 === 0
  
  
  
                        ? "#fff"
  
  
  
                        : "rgba(212,175,55,0.07)",
  
  
  
                      outline: isSelected ? `2px solid ${GOLD}` : "none",
  
  
  
                    }}
  
  
  
                  >
  
  
  
                    <td style={td}>{employee.occupation || "-"}</td>
  
  
  
                    <td style={td}>{employee.firstName || "-"}</td>
  
  
  
                    <td style={td}>{employee.surname || "-"}</td>
  
  
  
                    <td style={td}>{employee.phone || "-"}</td>
  
  
  
                    <td style={td}>{employee.cell || "-"}</td>
  
  
  
                    <td style={td}>
  
  
  
                      <span style={{ color: employee.payrollEnabled ? "#15803d" : "#64748b", fontWeight: 900 }}>
  
  
  
                        {employee.payrollEnabled ? "Enabled" : "Not enabled"}
  
  
  
                      </span>
  
  
  
                    </td>
  
  
  
                  </tr>
  
  
  
                );
  
  
  
              })
  
  
  
            )}
  
  
  
          </tbody>
  
  
  
        </table>
  
  
  
        <div style={{ padding: "10px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: 800 }}>
  
  
  
          <span>
  
  
  
            {filteredEmployeeRows.length === 0 ? "0" : (employeePage - 1) * employeePageSize + 1} - {Math.min(employeePage * employeePageSize, filteredEmployeeRows.length)} / {filteredEmployeeRows.length}
  
  
  
          </span>
  
  
  
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
  
  
  
            <button style={actionBtn} disabled={employeePage <= 1} onClick={() => setEmployeePage((p) => Math.max(1, p - 1))}>‹</button>
  
  
  
            <span>Page {employeePage} / {employeeTotalPages}</span>
  
  
  
            <button style={actionBtn} disabled={employeePage >= employeeTotalPages} onClick={() => setEmployeePage((p) => Math.min(employeeTotalPages, p + 1))}>›</button>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
    </div>
  
  
  
  );
   
  const renderEmployeeManage = () => {



    const saved = localStorage.getItem("selectedEmployeeForManage");
  
  
  
    const employee =
  
  
  
      selectedEmployee ||
  
  
  
      (saved
  
  
  
        ? (() => {
  
  
  
            try {
  
  
  
              return JSON.parse(saved);
  
  
  
            } catch {
  
  
  
              return null;
  
  
  
            }
  
  
  
          })()
  
  
  
        : null);
  
  
  
    if (!employee) {
  
  
  
      return (
  
  
  
        <div style={{ padding: "32px" }}>
  
  
  
          <h1 className="page-title">Employee</h1>
  
  
  
          <p>Select an employee first.</p>
  
  
  
          <button style={actionBtn} onClick={() => setActivePage("employees")}>
  
  
  
            Back
  
  
  
          </button>
  
  
  
        </div>
  
  
  
      );
  
  
  
    }
  
  
  
    const updateEmployeeDraft = (key: string, value: any) => {
  
  
  
      setEmployeeDraft((prev: any) => ({ ...prev, [key]: value }));
  
  
  
    };
  
  
  
    const tabButton = (key: typeof employeeTab, label: string) => (
  
  
  
      <button
  
  
  
        type="button"
  
  
  
        onClick={() => setEmployeeTab(key)}
  
  
  
        style={{
  
  
  
          padding: "14px 18px",
  
  
  
          border: "none",
  
  
  
          borderRight: "1px solid #e5e7eb",
  
  
  
          background: employeeTab === key ? "#ffffff" : "#f8fafc",
  
  
  
          borderTop: employeeTab === key ? `4px solid ${GOLD}` : "4px solid transparent",
  
  
  
          fontWeight: 900,
  
  
  
          color: employeeTab === key ? "#0f172a" : "#64748b",
  
  
  
          cursor: "pointer",
  
  
  
        }}
  
  
  
      >
  
  
  
        {label}
  
  
  
      </button>
  
  
  
    );
  
  
  
    const field = (label: string, key: string, required = false, type = "text") => (
  
  
  
      <>
  
  
  
        <label style={labelStyle}>{required ? "* " : ""}{label}</label>
  
  
  
        <input
  
  
  
          type={type}
  
  
  
          style={inputStyle}
  
  
  
          value={employeeDraft[key] ?? employee[key] ?? ""}
  
  
  
          onChange={(e) => updateEmployeeDraft(key, e.target.value)}
  
  
  
        />
  
  
  
      </>
  
  
  
    );
  
  
  
    return (
  
  
  
      <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px", border: "1px solid rgba(15,23,42,0.08)" }}>
  
  
  
        <div style={{ marginBottom: "12px" }}>
  
  
  
          <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>Employee</h1>
  
  
  
          <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Change employee information</p>
  
  
  
        </div>
  
  
  
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px", position: "relative" }}>
  
  
  
          <button style={actionBtn} onClick={() => setActivePage("employees")}>← Back</button>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={async () => {
  
  
  
              try {
                await saveEmployee({
  
  
  
                  ...employee,
  
  
  
                  ...employeeDraft,
  
  
  
                  firstName: employeeDraft.firstName ?? employee.firstName,
  
  
  
                  surname: employeeDraft.surname ?? employee.surname,
  
  
  
                });
                alert("Employee saved.");
              } catch {
                /* alert shown in saveEmployee */
              }
  
  
  
            }}
  
  
  
          >
  
  
  
            💾 Save
  
  
  
          </button>
  
  
  
          <button style={actionBtn} onClick={() => setEmployeeMoreOpen((v) => !v)}>
  
  
  
            More Actions⌄
  
  
  
          </button>
  
  
  
          {employeeMoreOpen && (
  
  
  
            <div
  
  
  
              style={{
  
  
  
                position: "absolute",
  
  
  
                top: "42px",
  
  
  
                left: "196px",
  
  
  
                width: "230px",
  
  
  
                background: "#ffffff",
  
  
  
                border: "1px solid #e5e7eb",
  
  
  
                borderRadius: "12px",
  
  
  
                boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
  
  
  
                overflow: "hidden",
  
  
  
                zIndex: 20,
  
  
  
              }}
  
  
  
            >
  
  
  
              {["Unenrol", "Delete", "Manage Occupations"].map((item) => (
  
  
  
                <button
  
  
  
                  key={item}
  
  
  
                  type="button"
  
  
  
                  onClick={() => {
  
  
  
                    setEmployeeMoreOpen(false);
  
  
  
                    alert(`${item} will be connected in the backend pass.`);
  
  
  
                  }}
  
  
  
                  style={{
  
  
  
                    display: "block",
  
  
  
                    width: "100%",
  
  
  
                    textAlign: "left",
  
  
  
                    padding: "14px 16px",
  
  
  
                    background: "#ffffff",
  
  
  
                    border: "none",
  
  
  
                    borderBottom: "1px solid #e5e7eb",
  
  
  
                    fontWeight: 800,
  
  
  
                    cursor: "pointer",
  
  
  
                  }}
  
  
  
                >
  
  
  
                  {item}
  
  
  
                </button>
  
  
  
              ))}
  
  
  
            </div>
  
  
  
          )}
  
  
  
        </div>
  
  
  
        <div style={{ display: "grid", gridTemplateColumns: "minmax(680px,1fr) 380px", gap: "28px", alignItems: "start" }}>
  
  
  
          <div style={{ background: "#fff", border: "1px solid #cbd5e1", borderTop: `4px solid ${GOLD}`, borderRadius: "10px", overflow: "hidden", boxShadow: "0 14px 34px rgba(15,23,42,0.07)" }}>
  
  
  
            <div style={{ display: "grid", gridTemplateColumns: "160px repeat(6, 1fr)", borderBottom: "1px solid #cbd5e1", background: "#f8fafc" }}>
  
  
  
              <div style={{ padding: "14px", fontWeight: 900, borderRight: "1px solid #cbd5e1" }}>Employee</div>
  
  
  
              {tabButton("general", "General")}
  
  
  
              {tabButton("contact", "Contact")}
  
  
  
              {tabButton("address", "Address")}
  
  
  
              {tabButton("payroll", "Payroll")}
  
  
  
              {tabButton("other", "Other")}
  
  
  
              {tabButton("extra", "Extra")}
  
  
  
            </div>
  
  
  
            <div style={{ padding: "22px", display: "grid", gridTemplateColumns: "170px 1fr", rowGap: "10px", columnGap: "12px" }}>
  
  
  
              {employeeTab === "general" && (
  
  
  
                <>
  
  
  
                  {field("Occupation", "occupation", true)}
  
  
  
                  {field("Title", "title", true)}
  
  
  
                  {field("Name / Nickname", "firstName", true)}
  
  
  
                  {field("Surname", "surname", true)}
  
  
  
                  {field("ID No", "idNumber")}
  
  
  
                  {field("Employment Date", "employmentDate", false, "date")}
  
  
  
                  <label style={labelStyle}>Notes</label>
  
  
  
                  <textarea
  
  
  
                    style={{ ...inputStyle, minHeight: "110px", resize: "vertical", fontFamily: "inherit" }}
  
  
  
                    value={employeeDraft.notes ?? employee.notes ?? ""}
  
  
  
                    onChange={(e) => updateEmployeeDraft("notes", e.target.value)}
  
  
  
                  />
  
  
  
                </>
  
  
  
              )}
  
  
  
              {employeeTab === "contact" && (
  
  
  
                <>
  
  
  
                  {field("Cell", "cell")}
  
  
  
                  {field("Phone", "phone")}
  
  
  
                  {field("Email", "email", false, "email")}
  
  
  
                  {field("Emergency Contact", "emergencyContact")}
  
  
  
                  {field("Emergency Cell", "emergencyCell")}
  
  
  
                </>
  
  
  
              )}
  
  
  
              {employeeTab === "address" && (
  
  
  
                <>
  
  
  
                  {field("Address Line 1", "address1")}
  
  
  
                  {field("Address Line 2", "address2")}
  
  
  
                  {field("City", "city")}
  
  
  
                  {field("Province", "province")}
  
  
  
                  {field("Postal Code", "postalCode")}
  
  
  
                </>
  
  
  
              )}
  
  
  
              {employeeTab === "payroll" && (
  
  
  
                <>
  
  
  
                  <label style={labelStyle}>Payroll Enabled</label>
  
  
  
                  <select
  
  
  
                    style={inputStyle}
  
  
  
                    value={employeeDraft.payrollEnabled ?? employee.payrollEnabled ? "yes" : "no"}
  
  
  
                    onChange={(e) => updateEmployeeDraft("payrollEnabled", e.target.value === "yes")}
  
  
  
                  >
  
  
  
                    <option value="yes">Yes</option>
  
  
  
                    <option value="no">No</option>
  
  
  
                  </select>
  
  
  
                  {field("Basic Salary", "basicSalary", false, "number")}
  
  
  
                  {field("Tax Number", "taxNumber")}
  
  
  
                  {field("UIF Number", "uifNumber")}
  
  
  
                  {field("Bank Name", "bankName")}
  
  
  
                  {field("Account Number", "bankAccount")}
  
  
  
                  {field("Branch Code", "branchCode")}
  
  
  
                </>
  
  
  
              )}
  
  
  
              {employeeTab === "other" && (
  
  
  
                <>
  
  
  
                  {field("Vehicle Reg No", "vehicleRegNo")}
  
  
  
                  {field("Vehicle Description", "vehicleDescription")}
  
  
  
                  {field("Birthday Day", "birthdayDay", false, "number")}
  
  
  
                  {field("Birthday Month", "birthdayMonth")}
  
  
  
                </>
  
  
  
              )}
  
  
  
              {employeeTab === "extra" && (
  
  
  
                <>
  
  
  
                  {field("Extra Info 1", "extra1")}
  
  
  
                  {field("Extra Info 2", "extra2")}
  
  
  
                  {field("Extra Info 3", "extra3")}
  
  
  
                </>
  
  
  
              )}
  
  
  
            </div>
  
  
  
          </div>
  
  
  
          <div style={{ paddingTop: "56px" }}>
  
  
  
            <div style={{ width: "205px", height: "205px", margin: "0 auto 18px", border: "1px solid #cbd5e1", background: "linear-gradient(180deg,#e2e8f0,#f8fafc)", display: "grid", placeItems: "center" }}>
  
  
  
              <div style={{ width: "120px", height: "120px", borderRadius: "999px", background: "#94a3b8" }} />
  
  
  
            </div>
  
  
  
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", border: "1px solid #e5e7eb", background: "#fff", boxShadow: "0 10px 26px rgba(15,23,42,0.05)" }}>
  
  
  
              {[
  
  
  
                ["Full Name", employeeFullName({ ...employee, ...employeeDraft }) || "-"],
  
  
  
                ["Occupation", employeeDraft.occupation || employee.occupation || "-"],
  
  
  
                ["Payroll", employeeDraft.payrollEnabled ?? employee.payrollEnabled ? "Enabled" : "Not enabled"],
  
  
  
                ["Notes", employeeDraft.notes || employee.notes || ""],
  
  
  
              ].map(([label, value]) => (
  
  
  
                <>
  
  
  
                  <div key={`${label}-l`} style={{ padding: "12px", background: "#f1f5f9", fontWeight: 900, textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>{label}</div>
  
  
  
                  <div key={`${label}-v`} style={{ padding: "12px", fontWeight: 800, borderBottom: "1px solid #e5e7eb" }}>{value}</div>
  
  
  
                </>
  
  
  
              ))}
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
      </div>
  
  
  
    );
  
  
  
  };
  
  const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Excused"] as const;
  const attendancePerPage = 25;
  const attendancePaginationThreshold = 25;

  const learnerMatchesAttendanceClass = (learner: any, className: string) => {
    const learnerClass = String(getLearnerGrade(learner) || "").trim().toLowerCase();
    return learnerClass === String(className || "").trim().toLowerCase();
  };

  const attendanceClassLearners = attendanceSelectedClass
    ? learners.filter(
        (learner: any) =>
          isActiveEnrollment(learner) &&
          learnerMatchesAttendanceClass(learner, attendanceSelectedClass)
      )
    : [];

  const attendanceLearnersFiltered = attendanceClassLearners.filter((learner: any) => {
    const fullName = `${learner.firstName || ""} ${learner.lastName || ""}`.toLowerCase();
    return fullName.includes(attendanceSearch.trim().toLowerCase());
  });

  const attendanceUsePagination = attendanceLearnersFiltered.length > attendancePaginationThreshold;
  const attendanceCaptureTotalPages = Math.max(
    1,
    Math.ceil(attendanceLearnersFiltered.length / attendancePerPage)
  );
  const attendanceCapturePaginated = attendanceUsePagination
    ? attendanceLearnersFiltered.slice(
        (attendanceCapturePage - 1) * attendancePerPage,
        attendanceCapturePage * attendancePerPage
      )
    : attendanceLearnersFiltered;

  const attendanceSummary = {
    total: attendanceClassLearners.length,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
  };
  attendanceClassLearners.forEach((learner: any) => {
    const status = String(attendanceMarks[learner.id]?.status || "").trim();
    if (status === "Present") attendanceSummary.present += 1;
    else if (status === "Absent") attendanceSummary.absent += 1;
    else if (status === "Late") attendanceSummary.late += 1;
    else if (status === "Excused") attendanceSummary.excused += 1;
  });

  const updateAttendanceMark = (
    learnerId: string,
    field: "status" | "arrived" | "left" | "reason",
    value: string
  ) => {
    setAttendanceMarks((prev) => ({
      ...prev,
      [learnerId]: {
        ...(prev[learnerId] || {}),
        [field]: value,
      },
    }));
  };

  const setAllAttendancePresent = () => {
    const updates: Record<string, { status: string }> = {};
    attendanceClassLearners.forEach((learner: any) => {
      updates[learner.id] = { ...(attendanceMarks[learner.id] || {}), status: "Present" };
    });
    setAttendanceMarks((prev) => ({ ...prev, ...updates }));
  };

  const clearAllAttendanceMarks = () => {
    setAttendanceMarks({});
  };

  const saveAttendanceForClass = async () => {
    if (!schoolId || !attendanceSelectedClass) return;
    if (!attendanceClassLearners.length) {
      alert("No learners in this class.");
      return;
    }
    const missing = attendanceClassLearners.filter((learner: any) => !attendanceMarks[learner.id]?.status);
    if (missing.length) {
      alert("Please set a status for every learner before saving.");
      return;
    }

    setAttendanceSaving(true);
    setAttendanceNotice(null);
    try {
      const marks = attendanceClassLearners.map((learner: any) => {
        const mark = attendanceMarks[learner.id] || {};
        return {
          learnerId: learner.id,
          status: mark.status,
          arrived: mark.arrived || "",
          left: mark.left || "",
          reason: mark.reason || "",
        };
      });
      const data: any = await apiFetch("/api/attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          className: attendanceSelectedClass,
          date: attendanceDate,
          marks,
        }),
      });
      if (!data?.success) throw new Error(data?.error || "Save failed");
      setAttendanceNotice(`Attendance saved for ${attendanceSelectedClass} (${attendanceDate}).`);
      const qs = new URLSearchParams({
        schoolId,
        className: attendanceSelectedClass,
        date: attendanceDate,
      });
      const refreshed: any = await apiFetch(`/api/attendance?${qs}`);
      if (refreshed?.success) setAttendanceMarks(refreshed.marks || {});
    } catch (e: unknown) {
      setAttendanceNotice(e instanceof Error ? e.message : "Failed to save attendance.");
    } finally {
      setAttendanceSaving(false);
    }
  };

  const renderAttendanceStatusButtons = (learnerId: string, currentStatus: string) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
      {ATTENDANCE_STATUSES.map((status) => {
        const active = currentStatus === status;
        return (
          <button
            key={status}
            type="button"
            onClick={() => updateAttendanceMark(learnerId, "status", status)}
            style={{
              ...actionBtn,
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 800,
              border: active ? `1px solid ${GOLD}` : "1px solid #e2e8f0",
              background: active
                ? "linear-gradient(135deg, #d4af37, #f5d06f)"
                : "#fff",
              color: active ? "#111827" : "#475569",
            }}
          >
            {status}
          </button>
        );
      })}
    </div>
  );

  const renderAttendance = () => (
    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px", border: "1px solid rgba(15,23,42,0.08)" }}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>Attendance</h1>
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
          {attendanceSelectedClass
            ? `Capture attendance for ${attendanceSelectedClass}`
            : "Select a class to capture attendance"}
        </p>
      </div>

      {!attendanceSelectedClass ? (
        <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderTop: `4px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", fontWeight: 900, color: "#0f172a" }}>Select class</div>
          <div style={{ padding: "14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
            {classroomRows.length === 0 ? (
              <div style={{ color: "#64748b", fontWeight: 700, padding: "12px" }}>No classes found. Add learners with a class name first.</div>
            ) : (
              classroomRows.map((row) => (
                <button
                  key={row.id || row.name}
                  type="button"
                  onClick={() => {
                    setAttendanceSelectedClass(String(row.name));
                    setAttendanceCapturePage(1);
                    setAttendanceSearch("");
                    setAttendanceNotice(null);
                  }}
                  style={{
                    ...actionBtn,
                    textAlign: "left",
                    padding: "14px",
                    border: "1px solid rgba(15,23,42,0.12)",
                    background: "linear-gradient(180deg, #fff 0%, rgba(212,175,55,0.08) 100%)",
                    boxShadow: "0 8px 18px rgba(15,23,42,0.06)",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "15px" }}>{row.name}</div>
                  <div style={{ marginTop: "6px", color: "#64748b", fontWeight: 700, fontSize: "12px" }}>
                    {row.children} learner{row.children === 1 ? "" : "s"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px", alignItems: "center" }}>
            <button
              type="button"
              style={actionBtn}
              onClick={() => {
                setAttendanceSelectedClass(null);
                setAttendanceMarks({});
                setAttendanceNotice(null);
              }}
            >
              ← All classes
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 800, color: "#334155" }}>
              Date
              <input
                type="date"
                style={{ ...selectStyle, width: "170px" }}
                value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)}
              />
            </label>
            <div style={{ flex: 1 }} />
            <button type="button" style={goldBtn} onClick={() => void setAllAttendancePresent()}>
              Mark all present
            </button>
            <button type="button" style={actionBtn} onClick={clearAllAttendanceMarks}>
              Clear all
            </button>
            <button
              type="button"
              style={{ ...goldBtn, opacity: attendanceSaving ? 0.7 : 1 }}
              disabled={attendanceSaving}
              onClick={() => void saveAttendanceForClass()}
            >
              {attendanceSaving ? "Saving…" : "Save attendance"}
            </button>
          </div>

          {attendanceNotice ? (
            <div style={{ marginBottom: "12px", padding: "10px 12px", borderRadius: "10px", background: "rgba(212,175,55,0.15)", border: `1px solid ${GOLD}`, fontWeight: 700, color: "#0f172a" }}>
              {attendanceNotice}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: "10px", marginBottom: "14px" }}>
            {[
              { label: "Total learners", value: attendanceSummary.total },
              { label: "Present", value: attendanceSummary.present },
              { label: "Absent", value: attendanceSummary.absent },
              { label: "Late", value: attendanceSummary.late },
              { label: "Excused", value: attendanceSummary.excused },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: "#0f172a",
                  color: "#f8fafc",
                  borderRadius: "10px",
                  padding: "12px",
                  border: `1px solid rgba(212,175,55,0.35)`,
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(248,250,252,0.75)" }}>{item.label}</div>
                <div style={{ fontSize: "22px", fontWeight: 900, color: GOLD, marginTop: "4px" }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.10)", borderTop: `4px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", fontWeight: 900, color: "#0f172a" }}>
              {attendanceSelectedClass} · {attendanceDate}
              {attendanceLoading ? " · Loading…" : ""}
            </div>

            <div style={{ padding: "10px", display: "flex", gap: "8px", borderBottom: "1px solid #e5e7eb", alignItems: "center" }}>
              <input
                placeholder="Search learners"
                value={attendanceSearch}
                onChange={(e) => {
                  setAttendanceSearch(e.target.value);
                  setAttendanceCapturePage(1);
                }}
                style={{ ...selectStyle, width: "260px" }}
              />
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Surname</th>
                  <th style={th}>Status</th>
                  <th style={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {attendanceCapturePaginated.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ ...td, textAlign: "center", padding: "24px" }}>
                      {attendanceLoading
                        ? "Loading learners…"
                        : "No learners found in this class."}
                    </td>
                  </tr>
                ) : (
                  attendanceCapturePaginated.map((learner: any, index: number) => {
                    const id = String(learner.id);
                    const mark = attendanceMarks[id] || {};
                    const currentStatus = String(mark.status || "");
                    return (
                      <tr
                        key={id}
                        style={{ background: index % 2 === 0 ? "#fff" : "rgba(212,175,55,0.07)" }}
                      >
                        <td style={{ ...td, padding: "8px 10px" }}>{learner.firstName || "-"}</td>
                        <td style={{ ...td, padding: "8px 10px" }}>{learner.lastName || learner.surname || "-"}</td>
                        <td style={{ ...td, padding: "8px 10px" }}>{renderAttendanceStatusButtons(id, currentStatus)}</td>
                        <td style={{ ...td, padding: "8px 10px" }}>
                          <input
                            style={{ ...inputStyle, minWidth: "160px" }}
                            placeholder="Optional"
                            value={mark.reason || ""}
                            onChange={(e) => updateAttendanceMark(id, "reason", e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {attendanceUsePagination ? (
              <div style={{ padding: "10px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: 800 }}>
                <span>
                  {(attendanceCapturePage - 1) * attendancePerPage + 1} - {Math.min(attendanceCapturePage * attendancePerPage, attendanceLearnersFiltered.length)} / {attendanceLearnersFiltered.length}
                </span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <button style={actionBtn} disabled={attendanceCapturePage <= 1} onClick={() => setAttendanceCapturePage((p) => Math.max(1, p - 1))}>‹</button>
                  <span>Page {attendanceCapturePage} / {attendanceCaptureTotalPages}</span>
                  <button
                    style={actionBtn}
                    disabled={attendanceCapturePage >= attendanceCaptureTotalPages}
                    onClick={() => setAttendanceCapturePage((p) => Math.min(attendanceCaptureTotalPages, p + 1))}
                  >
                    ›
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );

  const renderAttendanceManage = () => renderAttendance();
  
const incidentMenuBtn: React.CSSProperties = {



  width: "100%",



  padding: "14px 16px",



  border: "none",



  background: "#fff",



  textAlign: "left",



  fontWeight: 800,



  cursor: "pointer",



  color: "#0f172a",



};



const incidentPerPage = 10;



const incidentFiltered = incidentRecords.filter((item: any) => {



  const text = `${item.date || ""} ${item.name || ""} ${item.relationship || ""} ${item.subject || ""}`.toLowerCase();



  return text.includes(incidentSearch.toLowerCase());



});



const incidentTotalPages = Math.max(1, Math.ceil(incidentFiltered.length / incidentPerPage));



const incidentPaginated = incidentFiltered.slice(



  (incidentPage - 1) * incidentPerPage,



  incidentPage * incidentPerPage



);



const incidentLearnersFiltered = learners.filter((learner: any) => {



  const fullName = `${learner.firstName || ""} ${learner.lastName || learner.surname || ""}`.toLowerCase();



  const grade = String(getLearnerGrade(learner) || learner.classroom || "").toLowerCase();



  return `${fullName} ${grade}`.includes(incidentSearch.toLowerCase());



});



const incidentLearnerTotalPages = Math.max(1, Math.ceil(incidentLearnersFiltered.length / incidentPerPage));



const incidentLearnerPaginated = incidentLearnersFiltered.slice(



  (incidentLearnerPage - 1) * incidentPerPage,



  incidentLearnerPage * incidentPerPage



);



const openIncidentLearnerPicker = (type: "child" | "parent") => {



  setIncidentAddType(type);



  setIncidentAddOpen(true);



  setIncidentLearnerPage(1);



  setIncidentSearch("");



  setSelectedIncidentLearner(null);



};



const openIncidentFormForLearner = (learner: any) => {



  const fullName = `${learner.firstName || ""} ${learner.lastName || learner.surname || ""}`.trim();



  setSelectedIncidentLearner(learner);



  setIncidentDraft({



    type: "General",



    subject: "General",



    incident: "",



    private: false,



    relationship: incidentAddType === "parent" ? "Parent" : "Child",



    name: fullName,



    date: new Date().toISOString().slice(0, 16),



  });



  setIncidentMode("add");



  setIncidentAddOpen(false);



  setActivePage("incidentManage");



};



const manageSelectedIncident = () => {



  if (!selectedIncident) {



    alert("Please select an incident first.");



    return;



  }



  setIncidentDraft({



    type: selectedIncident.type || "General",



    subject: selectedIncident.subject || "General",



    incident: selectedIncident.incident || "",



    private: Boolean(selectedIncident.private),



    relationship: selectedIncident.relationship || "Child",



    name: selectedIncident.name || "",



    date: selectedIncident.date || new Date().toISOString().slice(0, 16),



  });



  const learner = learners.find((l: any) => String(l.id) === String(selectedIncident.learnerId));



  setSelectedIncidentLearner(learner || null);



  setIncidentMode("manage");



  setActivePage("incidentManage");



};



const saveIncidentRecord = async () => {
  const learnerId = selectedIncidentLearner?.id || selectedIncident?.learnerId || null;
  const record = {
    id: selectedIncident?.id || String(Date.now()),
    date: incidentDraft.date || new Date().toISOString().slice(0, 16),
    name: incidentDraft.name || "-",
    relationship: incidentDraft.relationship || "Child",
    subject: incidentDraft.subject || "General",
    type: incidentDraft.type || "General",
    incident: incidentDraft.incident || "",
    private: Boolean(incidentDraft.private),
    learnerId,
  };

  if (schoolId && learnerId) {
    try {
      const saved = await apiFetch("/api/parent-portal/staff/incidents", {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          learnerId,
          type: record.type,
          subject: record.subject,
          summary: record.incident,
          private: record.private,
          date: record.date,
        }),
      });
      if (saved?.incident?.id) record.id = saved.incident.id;
    } catch (e) {
      console.warn("[Incidents] API save failed, keeping local copy", e);
    }
  }

  setIncidentRecords((prev: any[]) => {
    const exists = prev.some((item: any) => item.id === record.id);
    if (exists) return prev.map((item: any) => (item.id === record.id ? record : item));
    return [record, ...prev];
  });

  setSelectedIncident(record);
  setActivePage("incidents");
};



const deleteSelectedIncident = () => {



  if (!selectedIncident) return alert("Please select an incident first.");



  if (!window.confirm("Delete this incident?")) return;



  setIncidentRecords((prev: any[]) => prev.filter((item: any) => item.id !== selectedIncident.id));



  setSelectedIncident(null);



  setActivePage("incidents");



};



const renderIncidents = () => (



  <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px" }}>



    <div style={{ marginBottom: 18 }}>



      <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>Incidents</h1>



      <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Manage incidents</p>



    </div>



    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderTop: `4px solid ${GOLD}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>



      <div style={{ padding: "14px 16px", fontWeight: 900, borderBottom: "1px solid #e5e7eb" }}>Incidents</div>



      <div style={{ padding: 10, display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #e5e7eb" }}>



        <div style={{ position: "relative" }}>



          <button style={goldBtn} onClick={() => setIncidentAddOpen((v: boolean) => !v)}>+ Add ▾</button>



          {incidentAddOpen && (



            <div style={{ position: "absolute", top: 44, left: 0, width: 220, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 20px 45px rgba(15,23,42,0.18)", zIndex: 20, overflow: "hidden" }}>



              <button style={incidentMenuBtn} onClick={() => openIncidentLearnerPicker("child")}>Child Incident</button>



              <button style={incidentMenuBtn} onClick={() => openIncidentLearnerPicker("parent")}>Parent Incident</button>



            </div>



          )}



        </div>



        <button style={actionBtn} onClick={manageSelectedIncident}>✎ Manage</button>



        <div style={{ flex: 1 }} />



        <input



          placeholder="Search"



          value={incidentSearch}



          onChange={(e) => {



            setIncidentSearch(e.target.value);



            setIncidentPage(1);



          }}



          style={{ ...selectStyle, width: 230 }}



        />



      </div>



      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>



        <thead>



          <tr>



            <th style={th}>Date</th>



            <th style={th}>Name</th>



            <th style={th}>Relationship</th>



            <th style={th}>Subject</th>



          </tr>



        </thead>



        <tbody>



          {incidentPaginated.length === 0 ? (



            <tr>



              <td colSpan={4} style={{ ...td, textAlign: "center", padding: 24 }}>No incidents captured yet.</td>



            </tr>



          ) : (



            incidentPaginated.map((item: any, index: number) => {



              const selected = selectedIncident?.id === item.id;



              return (



                <tr



                  key={item.id}



                  onClick={() => setSelectedIncident(item)}



                  onDoubleClick={manageSelectedIncident}



                  style={{



                    cursor: "pointer",



                    background: selected ? "rgba(212,175,55,0.22)" : index % 2 ? "rgba(212,175,55,0.07)" : "#fff",



                    outline: selected ? `2px solid ${GOLD}` : "none",



                  }}



                >



                  <td style={td}>{String(item.date || "").slice(0, 10)}</td>



                  <td style={td}>{item.name || "-"}</td>



                  <td style={td}>{item.relationship || "-"}</td>



                  <td style={td}>{item.subject || "-"}</td>



                </tr>



              );



            })



          )}



        </tbody>



      </table>



      <div style={{ padding: 10, display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 800, color: "#64748b" }}>



        <span>



          {incidentFiltered.length === 0 ? "0" : (incidentPage - 1) * incidentPerPage + 1} - {Math.min(incidentPage * incidentPerPage, incidentFiltered.length)} / {incidentFiltered.length}



        </span>



        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>



          <button style={actionBtn} onClick={() => setIncidentPage((p: number) => Math.max(1, p - 1))}>‹</button>



          <span>Page {incidentPage} / {incidentTotalPages}</span>



          <button style={actionBtn} onClick={() => setIncidentPage((p: number) => Math.min(incidentTotalPages, p + 1))}>›</button>



        </div>



      </div>



    </div>



    {incidentAddOpen && (



      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", zIndex: 80 }}>



        <div style={{ width: "900px", background: "#fff", borderRadius: 16, border: `2px solid ${GOLD}`, boxShadow: "0 30px 80px rgba(0,0,0,0.25)", overflow: "hidden" }}>



          <div style={{ padding: "16px 20px", fontWeight: 900, fontSize: 20, borderBottom: "1px solid #e5e7eb" }}>



            {incidentAddType === "parent" ? "Parent Incident" : "Child Incident"}



          </div>



          <div style={{ padding: 12, display: "flex", gap: 8, borderBottom: "1px solid #e5e7eb" }}>



            <select style={selectStyle}><option>All Groups</option></select>



            <select style={selectStyle}><option>All Classrooms</option></select>



            <input



              placeholder="Search"



              value={incidentSearch}



              onChange={(e) => {



                setIncidentSearch(e.target.value);



                setIncidentLearnerPage(1);



              }}



              style={{ ...selectStyle, flex: 1 }}



            />



          </div>



          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>



            <thead>



              <tr>



                <th style={th}>Name</th>



                <th style={th}>Surname</th>



                <th style={th}>Classroom</th>



              </tr>



            </thead>



            <tbody>



              {incidentLearnerPaginated.map((learner: any, index: number) => {



                const selected = selectedIncidentLearner?.id === learner.id;



                return (



                  <tr



                    key={learner.id}



                    onClick={() => setSelectedIncidentLearner(learner)}



                    style={{



                      cursor: "pointer",



                      background: selected ? "rgba(212,175,55,0.22)" : index % 2 ? "rgba(212,175,55,0.07)" : "#fff",



                      outline: selected ? `2px solid ${GOLD}` : "none",



                    }}



                  >



                    <td style={td}>{learner.firstName || "-"}</td>



                    <td style={td}>{learner.lastName || learner.surname || "-"}</td>



                    <td style={td}>{getLearnerGrade(learner) || learner.classroom || "-"}</td>



                  </tr>



                );



              })}



            </tbody>



          </table>



          <div style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e5e7eb" }}>



            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 800 }}>



              <button style={actionBtn} onClick={() => setIncidentLearnerPage((p: number) => Math.max(1, p - 1))}>‹</button>



              <span>Page {incidentLearnerPage} / {incidentLearnerTotalPages}</span>



              <button style={actionBtn} onClick={() => setIncidentLearnerPage((p: number) => Math.min(incidentLearnerTotalPages, p + 1))}>›</button>



            </div>



            <div style={{ display: "flex", gap: 8 }}>



              <button



                style={goldBtn}



                onClick={() => {



                  if (!selectedIncidentLearner) return alert("Please select a learner first.");



                  openIncidentFormForLearner(selectedIncidentLearner);



                }}



              >



                ✓ Continue



              </button>



              <button style={dangerBtn} onClick={() => setIncidentAddOpen(false)}>× Cancel</button>



            </div>



          </div>



        </div>



      </div>



    )}



  </div>



);



const renderIncidentManage = () => (



  <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px" }}>



    <div style={{ marginBottom: 12 }}>



      <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>Incident</h1>



      <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Add or manage an incident</p>



    </div>



    <div style={{ display: "flex", gap: 8, marginBottom: 20, position: "relative" }}>



      <button style={actionBtn} onClick={() => setActivePage("incidents")}>← Back</button>



      <button style={goldBtn} onClick={saveIncidentRecord}>💾 Save</button>



      <button style={actionBtn} onClick={() => window.print()}>▣ Print</button>



      <button style={actionBtn} onClick={() => setIncidentMoreOpen((v: boolean) => !v)}>More Actions⌄</button>



      {incidentMoreOpen && (



        <div style={{ position: "absolute", top: 44, left: 310, width: 210, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 20px 45px rgba(15,23,42,0.18)", zIndex: 30, overflow: "hidden" }}>



          <button style={incidentMenuBtn} onClick={deleteSelectedIncident}>Delete</button>



          <button style={incidentMenuBtn} onClick={() => alert("Manage Types will be connected later.")}>Manage Types</button>



        </div>



      )}



    </div>



    <div style={{ display: "grid", gridTemplateColumns: "1fr 330px", gap: 26 }}>



      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderTop: `4px solid ${GOLD}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>



        <div style={{ padding: "14px 16px", fontWeight: 900, borderBottom: "1px solid #e5e7eb" }}>Incident</div>



        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, alignItems: "center" }}>



          <label style={labelStyle}>* Name</label>



          <input style={inputStyle} value={incidentDraft.name || ""} onChange={(e) => setIncidentDraft((p: any) => ({ ...p, name: e.target.value }))} />



          <label style={labelStyle}>* Relationship</label>



          <input style={inputStyle} value={incidentDraft.relationship || ""} onChange={(e) => setIncidentDraft((p: any) => ({ ...p, relationship: e.target.value }))} />



          <label style={labelStyle}>* Type</label>



          <select style={inputStyle} value={incidentDraft.type || "General"} onChange={(e) => setIncidentDraft((p: any) => ({ ...p, type: e.target.value }))}>



            <option>General</option>



            <option>Discipline</option>



            <option>Bullying</option>



            <option>Late Coming</option>



            <option>Parent Meeting</option>



          </select>



          <label style={labelStyle}>* Date</label>



          <input type="datetime-local" style={inputStyle} value={incidentDraft.date || ""} onChange={(e) => setIncidentDraft((p: any) => ({ ...p, date: e.target.value }))} />



          <label style={labelStyle}>* Subject</label>



          <input style={inputStyle} value={incidentDraft.subject || ""} onChange={(e) => setIncidentDraft((p: any) => ({ ...p, subject: e.target.value }))} />



          <label style={labelStyle}>Incident</label>



          <textarea



            style={{ ...inputStyle, minHeight: 250, resize: "vertical" }}



            value={incidentDraft.incident || ""}



            onChange={(e) => setIncidentDraft((p: any) => ({ ...p, incident: e.target.value }))}



          />



          <span />



          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>



            <input type="checkbox" checked={Boolean(incidentDraft.private)} onChange={(e) => setIncidentDraft((p: any) => ({ ...p, private: e.target.checked }))} />



            Private



          </label>



        </div>



      </div>



      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, alignSelf: "start", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>



        <div style={{ width: 150, height: 150, margin: "0 auto 18px", borderRadius: 18, background: "linear-gradient(135deg,#e5e7eb,#f8fafc)", display: "grid", placeItems: "center", fontSize: 72 }}>



          👤



        </div>



        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>



          <div style={{ padding: 12, background: "#f1f5f9", fontWeight: 900 }}>Full Name</div>



          <div style={{ padding: 12 }}>{incidentDraft.name || "-"}</div>



          <div style={{ padding: 12, background: "#f1f5f9", fontWeight: 900 }}>Relationship</div>



          <div style={{ padding: 12 }}>{incidentDraft.relationship || "-"}</div>



        </div>



      </div>



    </div>



  </div>



);

const LIST_REGISTER_ITEMS = [



  "Address List",



  "Age List",



  "Allergies List",



  "Attendance List",



  "Attendance Register (Daily)",



  "Attendance Register (Monthly)",



  "Attendance Register (Monthly) (Weekends)",



  "Attendance Register (Weekly)",



  "Attendance Register (Weekly) (Weekends)",



  "Birthday Child List",



  "Birthday Employee List",



  "Birthday Parent List",



  "Block Sheet (5 Blocks)",



  "Block Sheet (10 Blocks)",



  "Block Sheet (20 Blocks)",



  "Child List",



  "Child List (3 Extra Fields)",



  "Child List (6 Extra Fields)",



  "Class List",



  "Contact List",



  "Employee Attendance Register (Monthly)",



  "Employee Attendance Register (Monthly) (Weekends)",



  "Employee Attendance Register (Weekly)",



  "Employee Attendance Register (Weekly) (Weekends)",



  "Employee Attendance Time Register (Weekly)",



  "Employee Attendance Time Register (Weekly) (Weekends)",



  "Employee Contact List",



  "Future Enrolled List",



  "Group List",



  "Incident List",



];



const [listRegisterSearch, setListRegisterSearch] = useState("");



const [selectedListRegister, setSelectedListRegister] = useState("");



const [listRegisterSetupOpen, setListRegisterSetupOpen] = useState(false);



const [listRegisterActionsOpen, setListRegisterActionsOpen] = useState(false);



const [listRegisterViewOpen, setListRegisterViewOpen] = useState(false);



const [listRegisterGroupBy, setListRegisterGroupBy] =



  useState("Classrooms");



const [listRegisterSortBy, setListRegisterSortBy] =



  useState("Name");
  const [formsTemplateSearch, setFormsTemplateSearch] = useState("");



const [selectedFormsTemplate, setSelectedFormsTemplate] = useState<string | null>(null);



const [formsTemplateSetupOpen, setFormsTemplateSetupOpen] = useState(false);



const [formsTemplateActionsOpen, setFormsTemplateActionsOpen] = useState(false);



const [formsTemplateViewOpen, setFormsTemplateViewOpen] = useState(false);



const [formsTemplateGroupBy, setFormsTemplateGroupBy] = useState("Classroom");



const [formsTemplateText, setFormsTemplateText] = useState("");



const [formsTemplateText2, setFormsTemplateText2] = useState("");

const [moreSettingsTab, setMoreSettingsTab] = useState<"general" | "attendance" | "communication">("general");



const [adminChildSort, setAdminChildSort] = useState("Name");



const [adminChildNumberShow, setAdminChildNumberShow] = useState(false);



const [adminChildNumberRequired, setAdminChildNumberRequired] = useState(false);



const [adminChildExtraFields, setAdminChildExtraFields] = useState([



  "Extra Field 1",



  "Extra Field 2",



  "Extra Field 3",



  "Extra Field 4",



  "Extra Field 5",



  "Extra Field 6",



  "Extra Field 7",



  "Extra Field 8",



  "Extra Field 9",



  "Extra Field 10",



]);



const [adminParentExtraFields, setAdminParentExtraFields] = useState([



  "Extra Field 1",



  "Extra Field 2",



  "Extra Field 3",



]);



const [adminEmployeeExtraFields, setAdminEmployeeExtraFields] = useState([



  "Extra Field 1",



  "Extra Field 2",



  "Extra Field 3",



]);



const [schoolOpeningTime, setSchoolOpeningTime] = useState("06:30");



const [schoolClosingTime, setSchoolClosingTime] = useState("17:30");

const filteredListRegisters = LIST_REGISTER_ITEMS.filter((item) =>



  item.toLowerCase().includes(listRegisterSearch.toLowerCase())



);



const openListRegister = (name: string) => {



  setSelectedListRegister(name);



  setListRegisterSetupOpen(true);



};



const continueListRegister = () => {



  setListRegisterSetupOpen(false);



  setListRegisterActionsOpen(true);



};



const openListRegisterView = () => {



  setListRegisterActionsOpen(false);



  setListRegisterViewOpen(true);



};

const renderListsRegisters = () => {



  const escapeCsv = (value: any) => {



    const text = String(value ?? "");



    return `"${text.replace(/"/g, '""')}"`;



  };



  const listRegisterRows = learners.map((learner: any) => ({



    name: learner.firstName || "-",



    surname: learner.lastName || learner.surname || "-",



    classroom: getLearnerGrade(learner) || learner.classroom || "-",



  }));



  const exportListRegisterCsv = () => {



    if (!selectedListRegister) {



      alert("Please select a report first.");



      return;



    }



    const csv = [



      ["Report", selectedListRegister],



      ["School", schoolBranding.name || ""],



      [],



      ["Name", "Surname", "Classroom"],



      ...listRegisterRows.map((row) => [row.name, row.surname, row.classroom]),



    ]



      .map((row) => row.map(escapeCsv).join(","))



      .join("\n");



    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });



    const url = URL.createObjectURL(blob);



    const link = document.createElement("a");



    link.href = url;



    link.download = `${String(selectedListRegister).replace(/\s+/g, "-").toLowerCase()}.csv`;



    link.click();



    URL.revokeObjectURL(url);



  };



  const downloadListRegister = () => {



    exportListRegisterCsv();



  };



  return (



    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px" }}>



      <div style={{ marginBottom: 18 }}>



        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>



          Lists & Registers



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>



          View, print or export lists and registers



        </p>



      </div>



      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderTop: `4px solid ${GOLD}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>



        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10 }}>



          <button



            style={goldBtn}



            onClick={() => {



              if (!selectedListRegister) {



                alert("Please select a report first.");



                return;



              }



              setListRegisterSetupOpen(true);



            }}



          >



            🖨 Print



          </button>



          <div style={{ flex: 1 }} />



          <input



            placeholder="Search"



            value={listRegisterSearch}



            onChange={(e) => setListRegisterSearch(e.target.value)}



            style={{ ...selectStyle, width: 260 }}



          />



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>



          <thead>



            <tr>



              <th style={th}>Report Name</th>



            </tr>



          </thead>



          <tbody>



            {filteredListRegisters.map((item: string, index: number) => (



              <tr



                key={item}



                onClick={() => setSelectedListRegister(item)}



                onDoubleClick={() => {



                  setSelectedListRegister(item);



                  setListRegisterSetupOpen(true);



                }}



                style={{



                  cursor: "pointer",



                  background:



                    selectedListRegister === item



                      ? "rgba(212,175,55,0.22)"



                      : index % 2



                      ? "rgba(212,175,55,0.06)"



                      : "#fff",



                }}



              >



                <td style={td}>{item}</td>



              </tr>



            ))}



          </tbody>



        </table>



      </div>



      {listRegisterSetupOpen && (



        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", zIndex: 90 }}>



          <div style={{ width: 500, background: "#fff", borderRadius: 16, border: `2px solid ${GOLD}`, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.25)" }}>



            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", fontWeight: 900, fontSize: 22 }}>



              {selectedListRegister}



            </div>



            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "center" }}>



              <label style={labelStyle}>Group By</label>



              <select style={inputStyle} value={listRegisterGroupBy} onChange={(e) => setListRegisterGroupBy(e.target.value)}>



                <option>Classrooms</option>



                <option>Groups</option>



              </select>



              <label style={labelStyle}>Sort By</label>



              <select style={inputStyle} value={listRegisterSortBy} onChange={(e) => setListRegisterSortBy(e.target.value)}>



                <option>Name</option>



                <option>Surname</option>



              </select>



            </div>



            <div style={{ padding: 16, display: "flex", justifyContent: "space-between", borderTop: "1px solid #e5e7eb" }}>



              <button style={goldBtn} onClick={continueListRegister}>



                ✓ Continue



              </button>



              <button style={dangerBtn} onClick={() => setListRegisterSetupOpen(false)}>



                ✕ Cancel



              </button>



            </div>



          </div>



        </div>



      )}



      {listRegisterActionsOpen && (



        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", zIndex: 90 }}>



          <div style={{ width: 620, background: "#fff", borderRadius: 16, border: `2px solid ${GOLD}`, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.25)" }}>



            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", fontWeight: 900, fontSize: 22 }}>



              {selectedListRegister}



            </div>



            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, padding: 24 }}>



              <button style={goldBtn} onClick={openListRegisterView}>



                🔍 View



              </button>



              <button style={actionBtn} onClick={downloadListRegister}>



                ⬇ Download



              </button>



              <button style={actionBtn} onClick={exportListRegisterCsv}>



                📄 Export



              </button>



            </div>



            <div style={{ padding: 16, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end" }}>



              <button style={dangerBtn} onClick={() => setListRegisterActionsOpen(false)}>



                ✕ Close



              </button>



            </div>



          </div>



        </div>



      )}



      {listRegisterViewOpen && (



        <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 120, overflow: "auto", padding: 40 }}>



          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>



            <h1 style={{ fontSize: 32, margin: 0 }}>{selectedListRegister}</h1>



            <h1 style={{ fontSize: 32, margin: 0 }}>{schoolBranding.name || ""}</h1>



          </div>



          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>



            <thead>



              <tr>



                <th style={th}>Name</th>



                <th style={th}>Surname</th>



                <th style={th}>Classroom</th>



              </tr>



            </thead>



            <tbody>



              {listRegisterRows.map((row, index: number) => (



                <tr key={`${row.name}-${row.surname}-${index}`} style={{ background: index % 2 ? "rgba(212,175,55,0.05)" : "#fff" }}>



                  <td style={td}>{row.name}</td>



                  <td style={td}>{row.surname}</td>



                  <td style={td}>{row.classroom}</td>



                </tr>



              ))}



            </tbody>



          </table>



          <div style={{ marginTop: 30 }}>



            <button style={goldBtn} onClick={() => window.print()}>



              🖨 Print



            </button>



            <button style={{ ...dangerBtn, marginLeft: 12 }} onClick={() => setListRegisterViewOpen(false)}>



              ✕ Close



            </button>



          </div>



        </div>



      )}



    </div>



  );



};

const renderFormsTemplates = () => {



  const formsTemplates = [



    "Cover Pages - Child",



    "Cover Pages - Classroom / Group",



    "Labels - Name (Grade 0 Font)",



    "Labels - Object (Grade 0 Font)",



    "Month Calendar",



    "Registration Form - Child Details",



    "Registration Form - Child Development Overview",



    "Registration Form - Medical Permissions",



    "Registration Form - Other Contacts",



    "Registration Form - Parent Details",



    "Registration Form - Photograph Permissions",



    "Trace Sheet (1 Trace)",



    "Trace Sheet (3 Traces)",



    "Trace Sheet (5 Traces)",



    "Update Details Forms",



    "Update Details Forms (Next of Kin)",



    "Update Details Forms (Next of Kin) (One Classroom)",



    "Update Details Forms (One Classroom)",



  ];



  const filteredFormsTemplates = formsTemplates.filter((item) =>



    item.toLowerCase().includes(formsTemplateSearch.toLowerCase())



  );



  const safeSelectedForm = selectedFormsTemplate || "Forms & Templates";



  const openFormsTemplateSetup = () => {



    if (!selectedFormsTemplate) {



      alert("Please select a form first.");



      return;



    }



    setFormsTemplateSetupOpen(true);



  };



  const continueFormsTemplate = () => {



    setFormsTemplateSetupOpen(false);



    setFormsTemplateActionsOpen(true);



  };



  const openFormsTemplateView = () => {



    setFormsTemplateActionsOpen(false);



    setFormsTemplateViewOpen(true);



  };



  const exportFormsTemplateCsv = () => {



    if (!selectedFormsTemplate) {



      alert("Please select a form first.");



      return;



    }



    const rows = [



      ["Form", safeSelectedForm],



      ["School", schoolBranding.name || ""],



      ["Group By", formsTemplateGroupBy],



      ["Text", formsTemplateText],



      ["Text 2", formsTemplateText2],



    ];



    const csv = rows



      .map((row) =>



        row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")



      )



      .join("\n");



    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });



    const url = URL.createObjectURL(blob);



    const link = document.createElement("a");



    link.href = url;



    link.download = `${safeSelectedForm.replace(/\s+/g, "-").toLowerCase()}.csv`;



    document.body.appendChild(link);



    link.click();



    document.body.removeChild(link);



    URL.revokeObjectURL(url);



  };



  const downloadFormsTemplate = () => {



    exportFormsTemplateCsv();



  };



  return (



    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px" }}>



      <div style={{ marginBottom: 18 }}>



        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>



          Forms & Templates



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>



          View, print or export forms and templates



        </p>



      </div>



      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderTop: `4px solid ${GOLD}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 18px 40px rgba(15,23,42,0.08)" }}>



        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10 }}>



          <button style={goldBtn} onClick={openFormsTemplateSetup}>



            🖨 Print



          </button>



          <div style={{ flex: 1 }} />



          <input



            placeholder="Search"



            value={formsTemplateSearch}



            onChange={(e) => setFormsTemplateSearch(e.target.value)}



            style={{ ...selectStyle, width: 260 }}



          />



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>



          <thead>



            <tr>



              <th style={th}>Report Name</th>



            </tr>



          </thead>



          <tbody>



            {filteredFormsTemplates.map((item, index) => (



              <tr



                key={item}



                onClick={() => setSelectedFormsTemplate(item)}



                onDoubleClick={() => {



                  setSelectedFormsTemplate(item);



                  setFormsTemplateSetupOpen(true);



                }}



                style={{



                  cursor: "pointer",



                  background:



                    selectedFormsTemplate === item



                      ? "rgba(212,175,55,0.22)"



                      : index % 2



                      ? "rgba(212,175,55,0.06)"



                      : "#fff",



                }}



              >



                <td style={td}>{item}</td>



              </tr>



            ))}



          </tbody>



        </table>



      </div>



      {formsTemplateSetupOpen && (



        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", zIndex: 90 }}>



          <div style={{ width: 560, background: "#fff", borderRadius: 16, border: `2px solid ${GOLD}`, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.25)" }}>



            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", fontWeight: 900, fontSize: 22 }}>



              {safeSelectedForm}



            </div>



            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "center" }}>



              <label style={labelStyle}>Group By</label>



              <select style={inputStyle} value={formsTemplateGroupBy} onChange={(e) => setFormsTemplateGroupBy(e.target.value)}>



                <option>Classroom</option>



                <option>Group</option>



              </select>



              <label style={labelStyle}>Text</label>



              <input style={inputStyle} value={formsTemplateText} onChange={(e) => setFormsTemplateText(e.target.value)} placeholder="Text" />



              <label style={labelStyle}>Text 2</label>



              <input style={inputStyle} value={formsTemplateText2} onChange={(e) => setFormsTemplateText2(e.target.value)} placeholder="Text 2" />



            </div>



            <div style={{ padding: 16, display: "flex", justifyContent: "space-between", borderTop: "1px solid #e5e7eb" }}>



              <button style={goldBtn} onClick={continueFormsTemplate}>



                ✓ Continue



              </button>



              <button style={dangerBtn} onClick={() => setFormsTemplateSetupOpen(false)}>



                ✕ Cancel



              </button>



            </div>



          </div>



        </div>



      )}



      {formsTemplateActionsOpen && (



        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", zIndex: 90 }}>



          <div style={{ width: 620, background: "#fff", borderRadius: 16, border: `2px solid ${GOLD}`, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.25)" }}>



            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", fontWeight: 900, fontSize: 22 }}>



              {safeSelectedForm}



            </div>



            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, padding: 24 }}>



              <button style={goldBtn} onClick={openFormsTemplateView}>



                🔍 View



              </button>



              <button style={actionBtn} onClick={downloadFormsTemplate}>



                ⬇ Download



              </button>



              <button style={actionBtn} onClick={exportFormsTemplateCsv}>



                📄 Export



              </button>



            </div>



            <div style={{ padding: 16, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end" }}>



              <button style={dangerBtn} onClick={() => setFormsTemplateActionsOpen(false)}>



                ✕ Close



              </button>



            </div>



          </div>



        </div>



      )}



      {formsTemplateViewOpen && (



        <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 120, overflow: "auto", padding: 50 }}>



          <div style={{ minHeight: "80vh", border: "1px solid #e5e7eb", padding: 50 }}>



            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 60 }}>



              <h1 style={{ fontSize: 30, margin: 0 }}>{safeSelectedForm}</h1>



              <h1 style={{ fontSize: 30, margin: 0 }}>{schoolBranding.name || ""}</h1>



            </div>



            <div style={{ textAlign: "center", marginTop: 120 }}>



              <h1 style={{ fontSize: 42, marginBottom: 20 }}>



                {formsTemplateText || safeSelectedForm}



              </h1>



              {formsTemplateText2 && (



                <h2 style={{ fontSize: 26, fontWeight: 700 }}>



                  {formsTemplateText2}



                </h2>



              )}



              <p style={{ marginTop: 40, fontSize: 18 }}>



                {formsTemplateGroupBy}



              </p>



            </div>



          </div>



          <div style={{ marginTop: 30 }}>



            <button style={goldBtn} onClick={() => window.print()}>



              🖨 Print



            </button>



            <button style={{ ...dangerBtn, marginLeft: 12 }} onClick={() => setFormsTemplateViewOpen(false)}>



              ✕ Close



            </button>



          </div>



        </div>



      )}



    </div>



  );



};

const renderMoreSettings = () => {



  const saveMoreSettings = () => {



    localStorage.setItem(



      "educlearMoreSettings",



      JSON.stringify({



        adminChildSort,



        adminChildNumberShow,



        adminChildNumberRequired,



        adminChildExtraFields,



        adminParentExtraFields,



        adminEmployeeExtraFields,



        schoolOpeningTime,



        schoolClosingTime,



      })



    );



    alert("Settings saved.");



  };



  const updateChildExtraField = (index: number, value: string) => {



    setAdminChildExtraFields((prev) =>



      prev.map((item, i) => (i === index ? value : item))



    );



  };



  const updateParentExtraField = (index: number, value: string) => {



    setAdminParentExtraFields((prev) =>



      prev.map((item, i) => (i === index ? value : item))



    );



  };



  const updateEmployeeExtraField = (index: number, value: string) => {



    setAdminEmployeeExtraFields((prev) =>



      prev.map((item, i) => (i === index ? value : item))



    );



  };



  return (



    <div style={{ padding: "26px", background: "#f8fafc", minHeight: "100%", borderRadius: "20px" }}>



      <div style={{ marginBottom: 18 }}>



        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>



          Administration Settings



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>



          Change administration related settings and details



        </p>



      </div>



      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>



        <button style={actionBtn} onClick={() => setActivePage("dashboard")}>



          ← Back



        </button>



        <button style={goldBtn} onClick={saveMoreSettings}>



          💾 Save



        </button>



      </div>



      <div



        style={{



          background: "#fff",



          border: "1px solid #e5e7eb",



          borderTop: `4px solid ${GOLD}`,



          borderRadius: 16,



          overflow: "hidden",



          boxShadow: "0 18px 40px rgba(15,23,42,0.08)",



        }}



      >



        <div



          style={{



            padding: "14px 16px",



            borderBottom: "1px solid #e5e7eb",



            display: "flex",



            alignItems: "center",



          }}



        >



          <div style={{ fontWeight: 900, color: "#0f172a" }}>Settings</div>



          <div style={{ flex: 1 }} />



          <button



            style={{



              ...(moreSettingsTab === "general" ? goldBtn : actionBtn),



              borderRadius: "12px 12px 0 0",



            }}



            onClick={() => setMoreSettingsTab("general")}



          >



            General



          </button>



          <button



            style={{



              ...(moreSettingsTab === "attendance" ? goldBtn : actionBtn),



              borderRadius: "12px 12px 0 0",



            }}



            onClick={() => setMoreSettingsTab("attendance")}



          >



            Attendance



          </button>



          <button



            style={{



              ...(moreSettingsTab === "communication" ? goldBtn : actionBtn),



              borderRadius: "12px 12px 0 0",



            }}



            onClick={() => setMoreSettingsTab("communication")}



          >



            Communication



          </button>



        </div>



        {moreSettingsTab === "communication" && schoolId ? (
          <CommunicationSettings
            schoolId={schoolId}
            schoolName={schoolBranding.name}
            schoolEmail={schoolBranding.email}
            initialTab={communicationSettingsTab}
          />
        ) : null}



        {moreSettingsTab === "general" && (



          <div style={{ padding: 24, maxWidth: 760 }}>



            <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 14, alignItems: "center" }}>



              <label style={labelStyle}>Child Sort</label>



              <select style={inputStyle} value={adminChildSort} onChange={(e) => setAdminChildSort(e.target.value)}>



                <option>Name</option>



                <option>Surname</option>



                <option>Classroom</option>



              </select>



              <label style={labelStyle}>Child Number</label>



              <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>



                <input



                  type="checkbox"



                  checked={adminChildNumberShow}



                  onChange={(e) => setAdminChildNumberShow(e.target.checked)}



                />



                Show



              </label>



              <span />



              <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>



                <input



                  type="checkbox"



                  checked={adminChildNumberRequired}



                  onChange={(e) => setAdminChildNumberRequired(e.target.checked)}



                />



                Required



              </label>



              {adminChildExtraFields.map((field, index) => (



                <React.Fragment key={`child-extra-${index}`}>



                  <label style={labelStyle}>Child Extra Field {index + 1}</label>



                  <input



                    style={inputStyle}



                    value={field}



                    onChange={(e) => updateChildExtraField(index, e.target.value)}



                  />



                </React.Fragment>



              ))}



              {adminParentExtraFields.map((field, index) => (



                <React.Fragment key={`parent-extra-${index}`}>



                  <label style={labelStyle}>Parent Extra Field {index + 1}</label>



                  <input



                    style={inputStyle}



                    value={field}



                    onChange={(e) => updateParentExtraField(index, e.target.value)}



                  />



                </React.Fragment>



              ))}



              {adminEmployeeExtraFields.map((field, index) => (



                <React.Fragment key={`employee-extra-${index}`}>



                  <label style={labelStyle}>Employee Extra Field {index + 1}</label>



                  <input



                    style={inputStyle}



                    value={field}



                    onChange={(e) => updateEmployeeExtraField(index, e.target.value)}



                  />



                </React.Fragment>



              ))}



            </div>



          </div>



        )}



        {moreSettingsTab === "attendance" && (



          <div style={{ padding: 24, maxWidth: 560 }}>



            <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 14, alignItems: "center" }}>



              <label style={labelStyle}>School Opening Time</label>



              <input



                type="time"



                style={inputStyle}



                value={schoolOpeningTime}



                onChange={(e) => setSchoolOpeningTime(e.target.value)}



              />



              <label style={labelStyle}>School Closing Time</label>



              <input



                type="time"



                style={inputStyle}



                value={schoolClosingTime}



                onChange={(e) => setSchoolClosingTime(e.target.value)}



              />



            </div>



          </div>



        )}



      </div>



    </div>



  );



};

  const renderDashboard = () => (



    <div className="dashboard-page">



      <div className="dashboard-header">



        <img src={logo} className="dashboard-logo" alt="EduClear" />



        <div>



          <h1 className="page-title">Overview</h1>



          <p className="dashboard-subtitle">School Management Dashboard</p>



        </div>



      </div>

      {emailReadinessLoaded && !isSchoolEmailReadyForUi(emailReadiness) ? (
        <div
          style={{
            marginBottom: 20,
            padding: "14px 18px",
            borderRadius: 12,
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            color: "#92400e",
            fontWeight: 700,
            fontSize: 14,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            Email setup incomplete — configure SMTP and send a test email before statements and billing emails can be
            sent.
          </span>
          <button
            type="button"
            onClick={openCommunicationEmailSetup}
            style={{
              border: "1px solid #b89329",
              background: "linear-gradient(135deg, #f7d56a, #d4af37)",
              color: "#111827",
              borderRadius: 10,
              padding: "8px 14px",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Open Email (SMTP)
          </button>
        </div>
      ) : null}

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
            {feeLoading ? (
              <p style={{ marginTop: 12, fontWeight: 700, color: "#6b7280" }}>Checking fee status…</p>
            ) : null}

            {!feeLoading && feeCheckError ? (
              <p style={{ marginTop: 12, fontWeight: 800, color: "#b91c1c" }}>{feeCheckError}</p>
            ) : null}

            {!feeLoading && !feeCheckError && feeLookupDone && feeLookupNotFound ? (
              <p style={{ marginTop: 12, fontWeight: 800, color: "#6b7280" }}>No record found</p>
            ) : null}

            {!feeLoading && feeResults.length > 0 ? (
              <>
                {feeResults.length > 1 ? (
                  <div className="fees-status-line" style={{ marginTop: 12 }}>
                    <span className="fees-label">Total outstanding (all accounts):</span>
                    <strong>R {feeOutstandingAmount.toLocaleString()}</strong>
                  </div>
                ) : null}

                {feeResults.map((row, index) => (
                  <div
                    key={`${row.schoolName}-${row.familyAccountNumber}-${index}`}
                    style={{
                      marginTop: 14,
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "#fafafa",
                    }}
                  >
                    <div className="fees-status-line">
                      <span className="fees-label">Status:</span>
                      <span
                        className={`status-pill ${
                          row.status === "RED"
                            ? "status-red"
                            : row.status === "AMBER"
                              ? "status-amber"
                              : "status-green"
                        }`}
                      >
                        {row.status}
                      </span>
                    </div>

                    <div className="fees-status-line">
                      <span className="fees-label">Outstanding:</span>
                      <strong>R {row.outstandingAmount.toLocaleString()}</strong>
                    </div>

                    <div className="fees-status-line">
                      <span className="fees-label">School:</span>
                      <span>{row.schoolName}</span>
                    </div>

                    <div className="fees-status-line">
                      <span className="fees-label">Parent / guardian:</span>
                      <span>{row.parentName}</span>
                    </div>

                    <div className="fees-status-line">
                      <span className="fees-label">Family account:</span>
                      <span>{row.familyAccountNumber}</span>
                    </div>

                    {row.learners.length > 0 ? (
                      <div className="fees-status-line">
                        <span className="fees-label">Learner(s):</span>
                        <span>{row.learners.map((l) => l.name).join(", ")}</span>
                      </div>
                    ) : null}
                  </div>
                ))}

                {feeMessage && feeMessage !== "No record found" ? (
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
                ) : null}
              </>
            ) : null}
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



          <h2>
            {registrationsDataLoading ? (
              <span className="stat-skeleton" aria-label="Loading learners" />
            ) : (
              activeLearners.length
            )}
          </h2>



          <p>
            {registrationsDataLoading ? (
              <span className="stat-skeleton" style={{ minWidth: 140, height: 14, display: "inline-block" }} aria-hidden />
            ) : (
              `${totalBoys} boys • ${totalGirls} girls`
            )}
          </p>



        </div>



        <div className="dashboard-card">



          <h3>Classrooms</h3>



          <h2>
            {registrationsDataLoading ? (
              <span className="stat-skeleton" aria-label="Loading classrooms" />
            ) : (
              totalClassrooms
            )}
          </h2>



          <p>
            {registrationsDataLoading ? (
              <span className="stat-skeleton" style={{ minWidth: 160, height: 14, display: "inline-block" }} aria-hidden />
            ) : (
              `Average class size: ${averageClassSize}`
            )}
          </p>



        </div>



        <div className="dashboard-card">



          <h3>Birthdays</h3>



          <h2>1 today</h2>



          <p>View today’s learner birthdays</p>



        </div>



      </div>



    </div>



  );



  const ParentPortalPage = ParentPortal as any;

  const [invoiceRunView, setInvoiceRunView] = useState<



  | "list"



  | "manage"



  | "wizardStart"



  | "wizardSettings"



  | "wizardChildren"



  | "wizardFees"



  | "wizardPreview"



  | "wizardCreate"



  | "wizardSummary"



  | "wizardFinish"



  | "emailInvoices"



  | "emailStatements"



  | "emailBoth"



  | "printInvoices"



  | "printStatements"



>("list");



  const [invoiceRunStep, setInvoiceRunStep] = useState(1);
  
  
  
  const [invoiceRunSearch, setInvoiceRunSearch] = useState("");
  
  
  
  const [invoiceRunPage, setInvoiceRunPage] = useState(1);
  
  
  
  const [selectedInvoiceRunId, setSelectedInvoiceRunId] = useState<string | null>(null);
  
  
  
  const invoiceRunSteps = [
  
  
  
    "Start",
  
  
  
    "Settings",
  
  
  
    "Children",
  
  
  
    "Fees",
  
  
  
    "Preview",
  
  
  
    "Create Invoices",
  
  
  
    "Summary",
  
  
  
    "Finish",
  
  
  
  ];
  
  
  
  const [invoiceRunSettings, setInvoiceRunSettings] = useState({
  
  
  
    description: "",
  
  
  
    invoiceDate: new Date().toISOString().split("T")[0],
  
  
  
    dueDate: new Date().toISOString().split("T")[0],
  
  
  
    month: "",
  
  
  
    message: "School fees are payable by the due date stated on this invoice.",



  });
  const [quickInvoiceMessage, setQuickInvoiceMessage] = useState("");
  const [quickInvoiceDueDate, setQuickInvoiceDueDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );

  useEffect(() => {
    const schoolId = hookSchoolId || localStorage.getItem("schoolId") || "";
    if (!schoolId) return;
    let cancelled = false;
    loadBillingSettingsForSchool(schoolId).then((settings) => {
      if (cancelled) return;
      const today = new Date().toISOString().split("T")[0];
      const defaults = buildInvoiceRunDefaults(settings, today);
      setInvoiceRunSettings((prev) => ({
        ...prev,
        message: prev.message || defaults.message,
        dueDate: computeInvoiceDueDate(today, settings, prev.dueDate),
      }));
      const invoiceMessage = resolveInvoiceMessage(settings);
      setQuickInvoiceMessage(invoiceMessage);
      setQuickInvoiceDueDate(computeInvoiceDueDate(today, settings));
      setInvoiceRunStatementOptions((prev) => ({
        ...prev,
        message: invoiceMessage || prev.message,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [hookSchoolId]);

  const [storedRuns, setStoredRuns] = useState<any[]>(() => {
    const readJson = (keys: string[], fallback: any) => {
      for (const key of keys) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (parsed) return parsed;
        } catch {}
      }
      return fallback;
    };
    const toArray = (value: any) => {
      if (Array.isArray(value)) return value;
      if (Array.isArray(value?.data)) return value.data;
      if (Array.isArray(value?.learners)) return value.learners;
      if (Array.isArray(value?.parents)) return value.parents;
      if (Array.isArray(value?.accounts)) return value.accounts;
      if (Array.isArray(value?.items)) return value.items;
      return [];
    };
    return toArray(readJson(["educlearInvoiceRuns"], []));
  });

  const [invoiceRunActionsOpen, setInvoiceRunActionsOpen] = useState(false);
  const [invoiceRunActionType, setInvoiceRunActionType] = useState<



  "emailInvoices" | "emailStatements" | "emailBoth" | "printInvoices" | "printStatements" | ""



>("");



const [invoiceRunModal, setInvoiceRunModal] = useState<



  "statementOptions" | "invoiceOptions" | "documentsReady" | ""



>("");



const [invoiceRunStatementOptions, setInvoiceRunStatementOptions] = useState({



  statementPeriod: "Last 3 Months",



  hideCorrections: true,



  message:



    "Please note: School fees to be paid in full by the 3rd of the month.\n\nPlease keep all receipts safe if there might be any enquiries.",



});



const [invoiceRunInvoiceOptions, setInvoiceRunInvoiceOptions] = useState({



  accountStatus: "All",



  groupBy: "Classroom",



  sortBy: "Name",



  selection: "Custom Dates",



  fromDate: new Date().toISOString().split("T")[0],



  toDate: new Date().toISOString().split("T")[0],



});



const [invoiceRunEmailDraft, setInvoiceRunEmailDraft] = useState({



  from: "no-reply@educlear.co.za",



  description: "",



  subject: "",



  body: "",



});


  const renderPage = () => {
    if (!canPage(activePage)) {
      return (
        <div style={{ padding: "32px", maxWidth: "560px" }}>
          <h1 className="page-title">Access restricted</h1>
          <p style={{ color: "#64748b", marginTop: "8px" }}>
            Your account does not have permission to open this section. Contact your school owner if
            you need access.
          </p>
          <button
            type="button"
            className="profile-btn"
            style={{ marginTop: "16px" }}
            onClick={() => setActivePage(findFirstAllowedSchoolPage(schoolSessionUser) as PageKey)}
          >
            Go to allowed page
          </button>
        </div>
      );
    }

    if (activePage === "addLearner")
      return <AddLearner onBack={() => go("registrations")} schoolParents={parents} />;



    if (activePage === "learnerProfile") {
      return (
        <ManageLearner
          learner={selectedLearner}
          setLearner={setSelectedLearner}
          setLearners={setLearners}
          parents={parents}
          setParents={setParents}
          onBack={() => setActivePage("registrations")}
        />
      );
    }



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
              className="school-package-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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

                <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 800, color: "#111827" }}>
                  {getPackageDisplayPrice("STARTER")}
                </p>



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

                <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 800, color: GOLD }}>
                  {getPackageDisplayPrice("UNLIMITED")}
                </p>



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

      return (



        <Registrations
      
      
      
          learners={learners}
      
      
      
          parents={parents}
          registrationStats={registrationStats}
          dataLoading={registrationsDataLoading}
         linkedParents={parents}
      
      
          classrooms={classroomRows}
      
      
      
          schoolId={schoolId}
      
      
      
          onAddLearner={() => setActivePage("addLearner")}
      
      
      
          onOpenLearner={(learner: any) => openLearnerProfile(learner)}
      
      
      
          onOpenParentPortal={() => setActivePage("parentPortal")}
      
      
      
        />
      
      
      
      );

        

      case "parentPortal":

        return (
          <ParentPortalPage
            schoolId={schoolId}
            onBack={() => setActivePage("registrations")}
            onOpenLearnerProfile={openLearnerProfile}
            onGoToStatements={() => setActivePage("statements")}
            onGoToInvoices={() => setActivePage("invoices")}
            onGoToIncidents={() => setActivePage("incidents")}
          />
        );

      case "teacherInbox":
        return <TeacherInbox />;



        case "statements":



        return (
      
      
      
          <Statements
      
      
      
            rows={statementRows}
      
      
      
            selected={selectedStatementAccount}
      
      
      
            setSelected={setSelectedStatementAccount}
      
      
      
            onManage={(row) => {
      
      
      
              localStorage.setItem(
      
      
      
                "selectedStatementAccount",
      
      
      
                JSON.stringify(row)
      
      
      
              );
      
      
      
              setActivePage("statementManage");
      
      
      
            }}
      
      
      
          />
      
      
      
        );



      case "invoices":



        return renderBillingAccounts(



          "New Invoice",



          "Create a new invoice.",



          statementRows,



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
        
        
        
          if (!selected) {
        
        
        
            return (
        
        
        
              <div style={{ padding: "32px" }}>
        
        
        
                <h1 className="page-title">Statement</h1>
        
        
        
                <p style={{ color: "#475569", fontWeight: 700 }}>Select an account first.</p>
        
        
        
                <button style={actionBtn} onClick={() => setActivePage("statements")}>Back</button>
        
        
        
              </div>
        
        
        
            );
        
        
        
          }
        
        
        
          const liveRow =
            statementRows.find(
              (row: any) =>
                String(row.accountNo) === String(selected.accountNo) ||
                String(row.learnerId || row.id) === String(selected.learnerId || selected.id)
            ) || selected;

          return (
            <StatementManage
              selected={liveRow}
              setActivePage={setActivePage}
              onOpenPaymentCreate={openPaymentCreate}
              onOpenEmailSetup={openCommunicationEmailSetup}
              statementRows={statementRows}
              learners={learners || []}
              parents={parents}
              schoolName={schoolBranding.name}
              schoolEmail={schoolBranding.email}
            />
          );
        }

        case "invoiceCreate": {
          const saved = localStorage.getItem("selectedInvoiceAccount");
          const rawSelected =
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
          const invoiceAccount = normalizePaymentAccount(rawSelected, statementRows, learners);
          return (
            <InvoiceCreateClean
              key={invoiceAccount?.accountNo || invoiceAccount?.learnerId || "invoice-create"}
              schoolId={schoolId || ""}
              learners={learners}
              selectedAccount={invoiceAccount}
              defaultDueDate={quickInvoiceDueDate}
              defaultMessage={quickInvoiceMessage}
              onBack={() => setActivePage("invoices")}
              onSaved={async () => {
                await refreshBillingRows();
                notifyBillingUpdated();
                setActivePage("invoices");
              }}
            />
          );
        }

        case "payments": {



          return (
        
        
        
            <Payments
              statementRows={statementRows}
              learners={learners}
              selectedAccount={selectedAccount}
              onSelectAccount={selectPaymentAccount}
              onOpenPaymentCreate={openPaymentCreate}
              setActivePage={setActivePage}
            />
        
        
        
          );
        
        
        
        }

        case "bankStatementImport":
        case "accountingBanking":
          return (
            <AccountingBanking
              schoolId={schoolId || ""}
              learners={learners}
              onOpenPaymentCreate={openPaymentCreate}
            />
          );

        case "accountingOverview":
          return <AccountingOverview schoolId={schoolId || ""} />;

        case "accountingExpenses":
          return <AccountingExpenses schoolId={schoolId || ""} />;

        case "accountingSuppliers":
          return <AccountingSuppliers schoolId={schoolId || ""} />;

        case "accountingAssets":
          return <AccountingAssets schoolId={schoolId || ""} />;

        case "accountingJournals":
          return <AccountingJournals schoolId={schoolId || ""} />;

        case "accountingGeneralLedger":
          return <AccountingGeneralLedger schoolId={schoolId || ""} />;

        case "accountingChartOfAccounts":
          return <AccountingChartOfAccounts schoolId={schoolId || ""} />;

        case "accountingBudget":
          return <AccountingBudget schoolId={schoolId || ""} />;

        case "accountingFinancialStatements":
          return (
            <AccountingFinancialStatements
              schoolId={schoolId || ""}
              schoolName={schoolBranding.name}
              learners={learners}
            />
          );

        case "accountingReports":
          return (
            <AccountingReports
              schoolId={schoolId || ""}
              learners={learners}
              schoolName={schoolBranding.name}
            />
          );

        case "accountingDebtorsAgeing":
          return (
            <AccountingDebtorsAgeing
              schoolId={schoolId || ""}
              learners={learners}
              statementRows={statementRows}
              setActivePage={setActivePage}
              onOpenLearner={(learnerId) => {
                const learner = (learners || []).find(
                  (l: any) => String(l?.id || l?.learnerId || "") === learnerId
                );
                if (learner) openLearnerProfile(learner);
              }}
            />
          );

        case "accountingCreditorsAgeing":
          return (
            <AccountingCreditorsAgeing
              schoolId={schoolId || ""}
              setActivePage={setActivePage}
            />
          );

        case "accountingSupplierInvoices":
          return (
            <SupplierInvoiceEngine
              schoolId={schoolId || ""}
              setActivePage={setActivePage}
            />
          );

        case "accountingExportCenter":
          return (
            <AccountingExportCenter
              schoolId={schoolId || ""}
              learners={learners}
              schoolName={schoolBranding.name}
            />
          );

        case "accountingSettings":
          return <AccountingSettings schoolId={schoolId || ""} />;

        case "accountingAuditCompliance":
          return (
            <AccountingAuditCompliance
              schoolId={schoolId || ""}
              schoolName={schoolBranding.name}
              learners={learners}
            />
          );
        
        
        
        case "paymentCreate": {
          const savedPaymentRaw = localStorage.getItem(PAYMENT_ACCOUNT_STORAGE_KEY);
          const rawPaymentSelected =
            selectedAccount ||
            (savedPaymentRaw
              ? (() => {
                  try {
                    return JSON.parse(savedPaymentRaw);
                  } catch {
                    return null;
                  }
                })()
              : null);
          const paymentAccount = normalizePaymentAccount(
            rawPaymentSelected,
            statementRows,
            learners
          );
          return (
            <PaymentCreateClean
              key={paymentAccount?.accountNo || paymentAccount?.learnerId || "payment-create"}
              schoolId={schoolId || ""}
              learners={learners}
              parents={parents}
              statementRows={statementRows}
              selectedAccount={paymentAccount}
              paymentForm={paymentForm}
              onPaymentFormChange={setPaymentForm}
              onBack={() => setActivePage("payments")}
              onSaved={async () => {
                await refreshBillingRows();
                notifyBillingUpdated();
                setActivePage("payments");
              }}
            />
          );
        }
  
  
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
          case "classroomManage":
            return (
              <Classrooms
                schoolId={schoolId || ""}
                onAddLearnerToClassroom={(classroomName) => {
                  try {
                    localStorage.setItem("addLearnerPrefillClassName", classroomName);
                  } catch {
                    /* ignore */
                  }
                  setActivePage("addLearner");
                }}
                onManageLearner={(learnerId) => {
                  const learner = learners.find((l: any) => String(l?.id) === String(learnerId));
                  if (learner) openLearnerProfile(learner);
                }}
              />
            );
  
  
  
  case "groups":



  return renderGroups();



case "groupManage":



  return renderGroupManage();
  
  
  
  case "employees":



  return renderEmployees();



case "employeeManage":



  return renderEmployeeManage(); 
  
  
  
  case "attendance":



  return renderAttendance();



case "attendanceManage":



  return renderAttendanceManage();
  
  
     
  case "incidents":



  return renderIncidents();



case "incidentManage":



  return renderIncidentManage();




  
  
  
        case "lists":
  
  
  
          return renderListsRegisters();
  
  
  
        case "forms":
  
  
  
          return renderFormsTemplates();
  
  
  
        case "help":
  
  
  
          return <h1 className="page-title">Help & Tips</h1>;
  
  
  
        case "more":
  
  
  
         return renderMoreSettings();
  
  
  
         case "plans": {



          return (
        
        
        
            <BillingPlans
        
        
        
              learners={learners}
        
        
        
              setLearners={setLearners}
        
        
        
              plansSearch={plansSearch}
        
        
        
              setPlansSearch={setPlansSearch}
        
        
        
              plansPage={plansPage}
        
        
        
              setPlansPage={setPlansPage}
        
        
        
              selectedPlanLearner={selectedPlanLearner}
        
        
        
              setSelectedPlanLearner={setSelectedPlanLearner}
        
        
        
              showFeePicker={showFeePicker}
        
        
        
              setShowFeePicker={setShowFeePicker}
        
        
        
            />
        
        
        
          );
        
        
        
        }
  
  
  

case "runs":



return (



  <InvoiceRuns



    learners={learners}



    invoiceRunSearch={invoiceRunSearch}



    setInvoiceRunSearch={setInvoiceRunSearch}



    invoiceRunPage={invoiceRunPage}



    setInvoiceRunPage={setInvoiceRunPage}



    invoiceRunSettings={invoiceRunSettings}



    setInvoiceRunSettings={setInvoiceRunSettings}



    invoiceRunView={invoiceRunView}



    setInvoiceRunView={setInvoiceRunView}



    storedRuns={storedRuns}



    setStoredRuns={setStoredRuns}



  />



);
 
  
  
        case "reports":
          return (
            <BillingReports
              schoolId={schoolId || ""}
              schoolName={schoolBranding.name}
              learners={learners || []}
              parents={parents || []}
              statementRows={statementRows}
            />
          );
  
  
  
        case "documents":
          return (
            <BillingDocuments
              schoolId={schoolId || ""}
              learners={learners}
              statementRows={statementRows}
              setActivePage={setActivePage}
            />
          );
  
  
  
        case "billing-help":
  
  
  
          return <h1 className="page-title">Help & Tips</h1>;
  
  
  

        case "billingDeposits":
          return <BillingDepositsPage />;

        case "billingSettings":
          return <BillingSettingsPage onBack={() => go("statements")} />;

        case "communicationEmail":
          return (
            <Email
              schoolId={schoolId || ""}
              learners={learners}
              parents={parents}
              schoolName={schoolBranding.name}
              schoolEmail={schoolBranding.email}
            />
          );

        case "communicationSms":
          return (
            <SMS
              schoolId={schoolId || ""}
              learners={learners}
              parents={parents}
              schoolName={schoolBranding.name}
              onOpenSmsSettings={openCommunicationSmsSetup}
            />
          );

        case "communicationSettings":
          return schoolId ? (
            <CommunicationSettings
              schoolId={schoolId}
              schoolName={schoolBranding.name}
              schoolEmail={schoolBranding.email}
              initialTab={communicationSettingsTab}
            />
          ) : (
            <h1 className="page-title">Communication Settings</h1>
          );

        case "communicationCentre":
          return schoolId ? (
            <CommunicationCentre schoolId={schoolId} schoolName={schoolBranding.name} />
          ) : (
            <h1 className="page-title">Communication Centre</h1>
          );
  
  
  
        case "schoolCredits":
          return <SchoolCreditsPage onConnectWinSms={openCommunicationSmsSetup} />;

        case "sasamsReportUpload":
          return <SchoolSasamsReportUploadPage />;
  
  
  
        case "schoolUsers":



          return <Users schoolId={schoolId || ""} />;



        case "schoolSettings":



          return <SchoolSettingsPage onBack={() => go("dashboard")} />;



        case "migrationCentre":
          if (!isSuperAdmin()) {
            return (
              <AccessDenied message="Access denied — Migration Center requires a platform super admin account." />
            );
          }
          return <MigrationCentrePage />;
  
  
  
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

    const mobilePageTitle = MOBILE_PAGE_TITLES[activePage] || "EduClear";

    return (



      <div className={`school-shell${mobileNavOpen ? " mobile-nav-open" : ""}`}>
        {isMobileViewport && mobileNavOpen ? (
          <button
            type="button"
            className="mobile-nav-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <aside className="sidebar" aria-hidden={isMobileViewport && !mobileNavOpen}>
  
  
  
          <div className="brand-row">
  
  
  
            <img src={logo} className="sidebar-logo" alt="EduClear" />
  
  
  
            <span>EduClear</span>
  
  
  
          </div>
  
  
  
          {canPage("dashboard") ? (
          <div
  
  
  
            className={`top-dashboard ${activePage === "dashboard" ? "active" : ""}`}
  
  
  
            onClick={() => go("dashboard")}
  
  
  
          >
  
  
  
            <span className="menu-icon">◉</span>
  
  
  
            <span>Dashboard</span>
  
  
  
          </div>
          ) : null}
  
  
  
          {canViewAnySchoolPage(
            ["schoolProfile", "schoolPackage", "schoolCredits", "schoolUsers", "schoolSettings"],
            schoolSessionUser
          ) ? (
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
  
  
  
                {canPage("schoolProfile") ? (
                <div className={`submenu-item ${activePage === "schoolProfile" ? "active" : ""}`} onClick={() => go("schoolProfile")}>Profile</div>
                ) : null}
  
  
  
                {canPage("schoolPackage") ? (
                <div className={`submenu-item ${activePage === "schoolPackage" ? "active" : ""}`} onClick={() => go("schoolPackage")}>Package</div>
                ) : null}
  
  
  
                {canPage("schoolCredits") ? (
                <div className={`submenu-item ${activePage === "schoolCredits" ? "active" : ""}`} onClick={() => go("schoolCredits")}>Credits</div>
                ) : null}
  
  
  
                {canPage("schoolUsers") ? (
                <div className={`submenu-item ${activePage === "schoolUsers" ? "active" : ""}`} onClick={() => go("schoolUsers")}>Users</div>
                ) : null}
  
  
  
                {canPage("schoolSettings") ? (
                <div className={`submenu-item ${activePage === "schoolSettings" ? "active" : ""}`} onClick={() => go("schoolSettings")}>Settings</div>
                ) : null}

  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
          ) : null}
  
  
  
          {canViewAnySchoolPage(
            [
              "registrations",
              "sasamsReportUpload",
              "parentPortal",
              "teacherInbox",
              "addLearner",
              "classrooms",
              "groups",
              "employees",
              "teacherPerformance",
              "attendance",
              "incidents",
              "lists",
              "forms",
              "more",
            ],
            schoolSessionUser
          ) ? (
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
  
  
  
                {canPage("registrations") ? (
                <div className={`submenu-item ${activePage === "registrations" ? "active" : ""}`} onClick={() => go("registrations")}>Registrations</div>
                ) : null}

                {canPage("sasamsReportUpload") ? (
                <div
                  className={`submenu-item ${activePage === "sasamsReportUpload" ? "active" : ""}`}
                  onClick={() => go("sasamsReportUpload")}
                >
                  SASAMS Report Upload
                </div>
                ) : null}

                {canPage("parentPortal") ? (
                <div className={`submenu-item ${activePage === "parentPortal" ? "active" : ""}`} onClick={() => go("parentPortal")}>Parent Portal</div>
                ) : null}
                {canPage("teacherInbox") ? (
                <div className={`submenu-item ${activePage === "teacherInbox" ? "active" : ""}`} onClick={() => go("teacherInbox")}>Teacher Inbox</div>
                ) : null}
  
  
  
                {canPage("addLearner") ? (
                <div className={`submenu-item ${activePage === "addLearner" ? "active" : ""}`} onClick={() => go("addLearner")}>Add Learner</div>
                ) : null}
  
  
  
                {canPage("classrooms") ? (
                <div className={`submenu-item ${activePage === "classrooms" ? "active" : ""}`} onClick={() => go("classrooms")}>Classrooms</div>
                ) : null}
  
  
  
                {canPage("groups") ? (
                <div className={`submenu-item ${activePage === "groups" ? "active" : ""}`} onClick={() => go("groups")}>Groups</div>
                ) : null}
  
  
  
                {canPage("employees") ? (
                <div className={`submenu-item ${activePage === "employees" ? "active" : ""}`} onClick={() => go("employees")}>Employees</div>
                ) : null}
  
  
  
                {canPage("teacherPerformance") ? (
                <div className={`submenu-item ${activePage === "teacherPerformance" ? "active" : ""}`} onClick={() => go("teacherPerformance")}>Teacher Performance</div>
                ) : null}
  
  
  
                {canPage("attendance") ? (
                <div className={`submenu-item ${activePage === "attendance" ? "active" : ""}`} onClick={() => go("attendance")}>Attendance</div>
                ) : null}
  
  
  
                {canPage("incidents") ? (
                <div className={`submenu-item ${activePage === "incidents" ? "active" : ""}`} onClick={() => go("incidents")}>Incidents</div>
                ) : null}
  
  
  
                {canPage("lists") ? (
                <div className={`submenu-item ${activePage === "lists" ? "active" : ""}`} onClick={() => go("lists")}>Lists & Registers</div>
                ) : null}
  
  
  
                {canPage("forms") ? (
                <div className={`submenu-item ${activePage === "forms" ? "active" : ""}`} onClick={() => go("forms")}>Forms & Templates</div>
                ) : null}
  
  
  
  
  
  
                {canPage("more") ? (
                <div className={`submenu-item ${activePage === "more" ? "active" : ""}`} onClick={() => go("more")}>More</div>
                ) : null}
  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
          ) : null}
  
  
  
          {canViewAnySchoolPage(
            [
              "statements",
              "invoices",
              "payments",
              "plans",
              "runs",
              "reports",
              "documents",
              "fees",
              "billingDeposits",
              "billingSettings",
              "billing-help",
            ],
            schoolSessionUser
          ) ? (
          <div className="main-section">
  
  
  
            <div
  
  
  
              className="section-header"
  
  
  
              onClick={() => {
                setBillingOpen(!billingOpen);
                setSchoolsOpen(false);
                setAdminOpen(false);
                setAccountingOpen(false);
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
  
  
  
                {canPage("statements") ? (
                <div className={`submenu-item ${activePage === "statements" ? "active" : ""}`} onClick={() => go("statements")}>Statements</div>
                ) : null}
  
  
  
                {canPage("invoices") ? (
                <div className={`submenu-item ${activePage === "invoices" ? "active" : ""}`} onClick={() => go("invoices")}>Invoices</div>
                ) : null}
  
  
  
                {canPage("payments") ? (
                <div
                  className={`submenu-item ${activePage === "payments" || activePage === "paymentCreate" ? "active" : ""}`}
                  onClick={() => go("payments")}
                >
                  Payments
                </div>
                ) : null}

  
  
  
  
  
  
                {canPage("fees") ? (
                <div className={`submenu-item ${activePage === "fees" ? "active" : ""}`} onClick={() => navigate("/dashboard/billing/fees")}>Fees</div>
                ) : null}
  
  
  
                {canPage("plans") ? (
                <div className={`submenu-item ${activePage === "plans" ? "active" : ""}`} onClick={() => go("plans")}>Billing Plans</div>
                ) : null}
  
  
  
                {canPage("runs") ? (
                <div className={`submenu-item ${activePage === "runs" ? "active" : ""}`} onClick={() => go("runs")}>Invoice Runs</div>
                ) : null}
  
  
  
                {canPage("reports") ? (
                <div className={`submenu-item ${activePage === "reports" ? "active" : ""}`} onClick={() => go("reports")}>Billing Reports</div>
                ) : null}
  
  
  
                {canPage("documents") ? (
                <div className={`submenu-item ${activePage === "documents" ? "active" : ""}`} onClick={() => go("documents")}>Billing Documents</div>
                ) : null}
  
  
  
                {canPage("billing-help") ? (
                <div className={`submenu-item ${activePage === "billing-help" ? "active" : ""}`} onClick={() => go("billing-help")}>Help & Tips</div>
                ) : null}
  
  
  
                {canViewAnySchoolPage(["billingDeposits", "billingSettings"], schoolSessionUser) ? (
                <div
                  className={`submenu-item submenu-expand ${billingMoreOpen ? "open" : ""} ${
                    activePage === "billingDeposits" || activePage === "billingSettings" ? "active" : ""
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBillingMoreOpen((prev) => !prev);
                  }}
                >
                  <span>More</span>
                  <span className={`chevron submenu-chevron ${billingMoreOpen ? "open" : ""}`}>⌄</span>
                </div>
                ) : null}
                {billingMoreOpen ? (
                  <>
                    {canPage("billingDeposits") ? (
                    <div
                      className={`submenu-item submenu-nested ${activePage === "billingDeposits" ? "active" : ""}`}
                      onClick={() => go("billingDeposits")}
                    >
                      Deposits
                    </div>
                    ) : null}
                    {canPage("billingSettings") ? (
                    <div
                      className={`submenu-item submenu-nested ${activePage === "billingSettings" ? "active" : ""}`}
                      onClick={() => go("billingSettings")}
                    >
                      Settings
                    </div>
                    ) : null}
                  </>
                ) : null}
  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
          ) : null}

          <div className="main-section">
            <div
              className="section-header"
              onClick={() => {
                setAccountingOpen(!accountingOpen);
                setBillingOpen(false);
                setSchoolsOpen(false);
                setAdminOpen(false);
                setCommunicationOpen(false);
              }}
            >
              <div className="section-left">
                <span className="menu-icon">◈</span>
                <span>Accounting</span>
              </div>
              <span className={`chevron ${accountingOpen ? "open" : ""}`}>⌄</span>
            </div>
            {accountingOpen && (
              <div className="submenu">
                <div className={`submenu-item ${activePage === "accountingOverview" ? "active" : ""}`} onClick={() => go("accountingOverview")}>Overview</div>
                <div
                  className={`submenu-item ${activePage === "accountingBanking" || activePage === "bankStatementImport" ? "active" : ""}`}
                  onClick={() => go("accountingBanking")}
                >
                  Banking
                </div>
                <div className={`submenu-item ${activePage === "payroll" ? "active" : ""}`} onClick={() => go("payroll")}>Payroll</div>
                <div className={`submenu-item ${activePage === "accountingExpenses" ? "active" : ""}`} onClick={() => go("accountingExpenses")}>Expenses</div>
                <div className={`submenu-item ${activePage === "accountingSuppliers" ? "active" : ""}`} onClick={() => go("accountingSuppliers")}>Suppliers</div>
                <div className={`submenu-item ${activePage === "accountingAssets" ? "active" : ""}`} onClick={() => go("accountingAssets")}>Assets</div>
                <div className={`submenu-item ${activePage === "accountingJournals" ? "active" : ""}`} onClick={() => go("accountingJournals")}>Journals</div>
                <div className={`submenu-item ${activePage === "accountingGeneralLedger" ? "active" : ""}`} onClick={() => go("accountingGeneralLedger")}>General Ledger</div>
                <div className={`submenu-item ${activePage === "accountingChartOfAccounts" ? "active" : ""}`} onClick={() => go("accountingChartOfAccounts")}>Chart of Accounts</div>
                <div className={`submenu-item ${activePage === "accountingBudget" ? "active" : ""}`} onClick={() => go("accountingBudget")}>Budget</div>
                <div className={`submenu-item ${activePage === "accountingFinancialStatements" ? "active" : ""}`} onClick={() => go("accountingFinancialStatements")}>Financial Statements</div>
                <div className={`submenu-item ${activePage === "accountingReports" ? "active" : ""}`} onClick={() => go("accountingReports")}>Reports</div>
                <div className={`submenu-item ${activePage === "accountingDebtorsAgeing" ? "active" : ""}`} onClick={() => go("accountingDebtorsAgeing")}>Debtors Ageing</div>
                <div className={`submenu-item ${activePage === "accountingCreditorsAgeing" ? "active" : ""}`} onClick={() => go("accountingCreditorsAgeing")}>Creditors Ageing</div>
                <div className={`submenu-item ${activePage === "accountingSupplierInvoices" ? "active" : ""}`} onClick={() => go("accountingSupplierInvoices")}>Supplier Invoices</div>
                <div className={`submenu-item ${activePage === "accountingAuditCompliance" ? "active" : ""}`} onClick={() => go("accountingAuditCompliance")}>Audit & Compliance</div>
                <div className={`submenu-item ${activePage === "accountingExportCenter" ? "active" : ""}`} onClick={() => go("accountingExportCenter")}>Export Center</div>
                <div className={`submenu-item ${activePage === "accountingSettings" ? "active" : ""}`} onClick={() => go("accountingSettings")}>Settings</div>
              </div>
            )}
          </div>

          <div className="main-section">
            <div
              className="section-header"
              onClick={() => {
                setCommunicationOpen(!communicationOpen);
                setSchoolsOpen(false);
                setAdminOpen(false);
                setBillingOpen(false);
                setAccountingOpen(false);
              }}
            >
              <div className="section-left">
                <span className="menu-icon">💬</span>
                <span>Communication</span>
              </div>
              <span className={`chevron ${communicationOpen ? "open" : ""}`}>⌄</span>
            </div>
            {communicationOpen && (
              <div className="submenu">
                <div
                  className={`submenu-item ${activePage === "communicationCentre" ? "active" : ""}`}
                  onClick={() => go("communicationCentre")}
                >
                  Communication Centre
                </div>
                <div
                  className={`submenu-item ${activePage === "communicationEmail" ? "active" : ""}`}
                  onClick={() => go("communicationEmail")}
                >
                  Email
                </div>
                <div
                  className={`submenu-item ${activePage === "communicationSms" ? "active" : ""}`}
                  onClick={() => go("communicationSms")}
                >
                  SMS
                </div>
                <div
                  className={`submenu-item submenu-expand ${communicationMoreOpen ? "open" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCommunicationMoreOpen((prev) => !prev);
                  }}
                >
                  <span>More</span>
                  <span className={`chevron submenu-chevron ${communicationMoreOpen ? "open" : ""}`}>⌄</span>
                </div>
                {communicationMoreOpen ? (
                  <div
                    className={`submenu-item submenu-nested ${activePage === "communicationSettings" ? "active" : ""}`}
                    onClick={() => go("communicationSettings")}
                  >
                    Settings
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="bottom-section">
            <div className="sidebar-collapse">≪</div>
          </div>
  
  
  
        </aside>

        <div className="school-main-column">
          {isMobileViewport ? (
            <header className="mobile-top-bar">
              <button
                type="button"
                className="mobile-menu-btn"
                aria-label="Open menu"
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                ☰
              </button>
              <div className="mobile-top-bar-brand">
                <img src={logo} className="mobile-top-bar-logo" alt="" />
                <span className="mobile-top-bar-name">EduClear</span>
              </div>
              <h1 className="mobile-top-bar-title">{mobilePageTitle}</h1>
            </header>
          ) : null}

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

      </div>



    );



  }
  const billingPlansTh: React.CSSProperties = {



    padding: "16px",
  
  
  
    textAlign: "left",
  
  
  
    fontSize: "12px",
  
  
  
    fontWeight: 800,
  
  
  
    color: "#64748b",
  
  
  
    borderBottom: "1px solid #e2e8f0",
  
  
  
  };
  
  
  
  const billingPlansTd: React.CSSProperties = {
  
  
  
    padding: "16px",
  
  
  
    fontSize: "14px",
  
  
  
    color: "#0f172a",
  
  
  
    borderBottom: "1px solid #f1f5f9",
  
  
  
  };
  
  
  
  const paginationButtonStyle: React.CSSProperties = {
  
  
  
    width: "38px",
  
  
  
    height: "38px",
  
  
  
    borderRadius: "8px",
  
  
  
    border: "1px solid #cbd5e1",
  
  
  
    background: "#ffffff",
  
  
  
    color: "#0f172a",
  
  
  
    fontWeight: 700,
  
  
  
    cursor: "pointer",
  
  
  
  };
  const compactBillingTd: React.CSSProperties = {



    padding: "12px 14px",
  
  
  
    fontSize: "13px",
  
  
  
    color: "#0f172a",
  
  
  
    borderBottom: "1px solid #f1f5f9",
  
  
  
  };
  
  
  
  const goldBillingButton: React.CSSProperties = {
  
  
  
    padding: "10px 16px",
  
  
  
    borderRadius: "10px",
  
  
  
    border: "none",
  
  
  
    background: "#d4af37",
  
  
  
    color: "#020617",
  
  
  
    fontWeight: 800,
  
  
  
    cursor: "pointer",
  
  
  
    fontSize: "13px",
  
  
  
  };
  
  
  
  const dangerBillingButton: React.CSSProperties = {
  
  
  
    padding: "10px 16px",
  
  
  
    borderRadius: "10px",
  
  
  
    border: "1px solid #dc2626",
  
  
  
    background: "#ffffff",
  
  
  
    color: "#dc2626",
  
  
  
    fontWeight: 700,
  
  
  
    cursor: "pointer",
  
  
  
    fontSize: "13px",
  
  
  
  };
  
  
  
  const lightBillingButton: React.CSSProperties = {
  
  
  
    padding: "10px 16px",
  
  
  
    borderRadius: "10px",
  
  
  
    border: "1px solid #cbd5e1",
  
  
  
    background: "#ffffff",
  
  
  
    color: "#0f172a",
  
  
  
    fontWeight: 700,
  
  
  
    cursor: "pointer",
  
  
  
    fontSize: "13px",
  
  
  
  }
  