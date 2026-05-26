import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadBillingSettingsForSchool,
  mapStatementHistoryToDefaultPeriod,
  resolveStatementMessage,
} from "./billingSettingsEngine";
import {
  mergeFamilyAccount,
  sanitizeUserFacingError,
  syncBillingLedgerFromApi,
  unmergeFamilyAccount,
} from "./billingApi";
import {
  BILLING_UPDATED_EVENT,
  LEARNERS_REFRESH_EVENT,
  calculateAccountBalance,
  calculateBalanceFromEntries,
  formatMoney,
  getAccountLedger,
  getFamilyAccountLedger,
  normaliseBillingAmount,
  notifyBillingUpdated,
  notifyLearnersRefresh,
  resolveEntryLearnerLabel,
} from "./billingLedger";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  formatKidesysHistoryDescriptionDisplay,
  formatKidesysHistoryReferenceDisplay,
  formatKidesysHistoryTypeLabel,
  formatLedgerDescriptionDisplay,
  formatLedgerReferenceDisplay,
  formatLedgerTypeLabel,
  isKidesysOpeningBalanceEntry,
  isMigratedOpeningBalanceOverviewLabel,
  MIGRATED_OPENING_BALANCE_OVERVIEW,
} from "./billingDisplayRules";
import type { KidesysHistoryEntry } from "./kidesysTransactionHistory";
import {
  filterHistoryForAccount,
  getHistorySummaryForAccount,
  KIDESYS_HISTORY_UPDATED_EVENT,
  readSchoolKidesysHistory,
} from "./kidesysTransactionHistory";
import { syncKidesysHistoryForAccountFromApi } from "./billingApi";
import {
  fetchSchoolEmailSettings,
  isSchoolEmailReadyForUi,
  normalizeSchoolEmailSettings,
  SCHOOL_EMAIL_READINESS_UPDATED,
  type SchoolEmailSettings,
} from "../communication/schoolEmailApi";
import {
  buildStatementCoverEmailHtml,
  buildStatementEmailDefaults,
  downloadSchoolStatementPdf,
  openSchoolStatementPdfPrint,
  loadStatementSchoolBranding,
  resolveStatementBillingContact,
  sendStatementEmail,
  type StatementContact,
  type StatementSchoolBranding,
} from "./statementDocument";
import {
  DEFAULT_STATEMENT_PERIOD,
  filterKidesysHistoryByStatementPeriod,
  filterLedgerByStatementPeriod,
  normalizeStatementPeriod,
  shouldShowOpeningBalanceMigration,
  STATEMENT_PERIOD_OPTIONS,
} from "./statementPeriod";

type Props = {
  selected: any;
  setActivePage: React.Dispatch<React.SetStateAction<any>>;
  onOpenPaymentCreate?: (account: any) => void;
  onOpenEmailSetup?: () => void;
  statementRows?: any[];
  learners?: any[];
  parents?: any[];
  schoolName?: string;
  schoolEmail?: string;
};

const GOLD = "#d4af37";
const INK = "#111827";
const TRANSACTIONS_PER_PAGE = 10;

type ModalKind =
  | "pending"
  | "journal"
  | "unallocateConfirm"
  | "unallocatePending"
  | "merge"
  | "mergePending"
  | "unmerge"
  | "unmergePending";

type PendingModal = {
  title: string;
  body: string;
};

function persistBillingAccount(storageKey: string, account: any) {
  const payload = {
    ...account,
    learnerId: account.learnerId || account.id || account.accountNo,
    id: account.id || account.learnerId || account.accountNo,
  };
  localStorage.setItem(storageKey, JSON.stringify(payload));
}

function resolveLearnerAccountRef(learner: any): string {
  const ref = getLearnerAccountNo(learner);
  return ref === "-" ? "" : ref;
}

function resolveFamilyAccountId(learner: any): string {
  return String(learner?.familyAccountId || learner?.familyAccount?.id || "").trim();
}

type AccountChild = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  accountNo: string;
};

function mapToAccountChild(source: any, fallbackAccountNo: string): AccountChild | null {
  const id = String(source?.id || source?.learnerId || "").trim();
  if (!id) return null;
  return {
    id,
    firstName: source?.firstName || source?.name || "-",
    lastName: source?.lastName || source?.surname || "-",
    grade: source?.grade || "-",
    accountNo:
      resolveLearnerAccountRef(source) ||
      String(source?.accountNo || "").trim() ||
      fallbackAccountNo ||
      "-",
  };
}

function StatementModal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: 24,
      }}
      onClick={onClose || undefined}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 14,
          border: `2px solid ${GOLD}`,
          boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            background: INK,
            color: GOLD,
            padding: "16px 20px",
            fontWeight: 900,
            fontSize: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{title}</span>
          {onClose ? (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${GOLD}`,
              background: "transparent",
              color: GOLD,
              borderRadius: 8,
              padding: "4px 10px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
          ) : null}
        </div>
        <div style={{ padding: 22 }}>{children}</div>
        {footer ? (
          <div
            style={{
              padding: "14px 22px 22px",
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function StatementManage({
  selected,
  setActivePage,
  onOpenPaymentCreate,
  onOpenEmailSetup,
  statementRows = [],
  learners = [],
  parents = [],
  schoolName: schoolNameProp = "",
  schoolEmail: schoolEmailProp = "",
}: Props) {
  const schoolId = localStorage.getItem("schoolId") || "";
  const learnerId = String(selected?.learnerId || selected?.id || "").trim();
  const accountNo = String(selected?.accountNo || "").trim();

  const [period, setPeriod] = useState(DEFAULT_STATEMENT_PERIOD);
  const [statementNote, setStatementNote] = useState("");
  const [, setTick] = useState(0);
  const [modalKind, setModalKind] = useState<ModalKind | null>(null);
  const [pendingModal, setPendingModal] = useState<PendingModal | null>(null);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTarget, setMergeTarget] = useState<any | null>(null);
  const [unmergeLearnerId, setUnmergeLearnerId] = useState("");
  const [unmergeCreateNew, setUnmergeCreateNew] = useState(true);
  const [familyActionBusy, setFamilyActionBusy] = useState(false);
  const [familyActionError, setFamilyActionError] = useState("");
  const [familyActionSuccess, setFamilyActionSuccess] = useState("");
  const [schoolBranding, setSchoolBranding] = useState<StatementSchoolBranding>({
    name: schoolNameProp || localStorage.getItem("schoolName") || "School",
    email: schoolEmailProp,
  });
  const [sendOpen, setSendOpen] = useState(false);
  const [sendContact, setSendContact] = useState<StatementContact | null>(null);
  const [sendSubject, setSendSubject] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [emailReadiness, setEmailReadiness] = useState<SchoolEmailSettings | null>(null);
  const [accountKidesysHistory, setAccountKidesysHistory] = useState<KidesysHistoryEntry[]>([]);
  const [kidesysHistoryVersion, setKidesysHistoryVersion] = useState(0);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const emailReady = isSchoolEmailReadyForUi(emailReadiness);

  const loadEmailReadiness = useCallback(async () => {
    if (!schoolId) {
      setEmailReadiness(null);
      return;
    }
    try {
      const res = await fetchSchoolEmailSettings(schoolId);
      setEmailReadiness(normalizeSchoolEmailSettings(res.settings));
    } catch {
      setEmailReadiness(null);
    }
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    loadBillingSettingsForSchool(schoolId).then((settings) => {
      if (cancelled) return;
      setPeriod(mapStatementHistoryToDefaultPeriod(settings.statement.statementHistory));
      setStatementNote(resolveStatementMessage(settings));
    });
    loadStatementSchoolBranding(schoolId).then((branding) => {
      if (cancelled) return;
      setSchoolBranding((prev) => ({
        ...prev,
        ...branding,
        name: branding.name || schoolNameProp || prev.name,
        email: branding.email || schoolEmailProp || prev.email,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [schoolId, schoolNameProp, schoolEmailProp]);

  useEffect(() => {
    void loadEmailReadiness();
  }, [loadEmailReadiness]);

  useEffect(() => {
    const onReadinessUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail as { schoolId?: string; settings?: SchoolEmailSettings };
      if (!detail?.settings || detail.schoolId !== schoolId) return;
      setEmailReadiness(normalizeSchoolEmailSettings(detail.settings));
    };
    window.addEventListener(SCHOOL_EMAIL_READINESS_UPDATED, onReadinessUpdated);
    return () => window.removeEventListener(SCHOOL_EMAIL_READINESS_UPDATED, onReadinessUpdated);
  }, [schoolId]);

  React.useEffect(() => {
    const refresh = () => setTick((v) => v + 1);
    window.addEventListener(BILLING_UPDATED_EVENT, refresh);
    window.addEventListener(LEARNERS_REFRESH_EVENT, refresh);
    return () => {
      window.removeEventListener(BILLING_UPDATED_EVENT, refresh);
      window.removeEventListener(LEARNERS_REFRESH_EVENT, refresh);
    };
  }, []);

  const accountRef = useMemo(() => {
    const fromSelected = resolveLearnerAccountRef(selected) || String(selected?.accountNo || "").trim();
    if (fromSelected && fromSelected !== "-") return fromSelected;
    const match = learners.find((l) => String(l?.id || l?.learnerId) === learnerId);
    return resolveLearnerAccountRef(match) || accountNo;
  }, [selected, learners, learnerId, accountNo]);

  const familyAccountId = useMemo(() => {
    const fromSelected = String(selected?.familyAccountId || "").trim();
    if (fromSelected) return fromSelected;
    const match = learners.find((l) => String(l?.id || l?.learnerId) === learnerId);
    const fromLearner = resolveFamilyAccountId(match);
    if (fromLearner) return fromLearner;
    if (accountRef) {
      const byAccount = learners.find((l) => resolveLearnerAccountRef(l) === accountRef);
      return resolveFamilyAccountId(byAccount);
    }
    return "";
  }, [selected, learners, learnerId, accountRef]);

  const familyAccountIdForRow = (row: any) => {
    const fromRow = String(row?.familyAccountId || "").trim();
    if (fromRow) return fromRow;
    const rowLearnerId = String(row?.learnerId || row?.id || "").trim();
    const match = learners.find((l) => String(l?.id || l?.learnerId) === rowLearnerId);
    const fromLearner = resolveFamilyAccountId(match);
    if (fromLearner) return fromLearner;
    const rowAccountRef = String(row?.accountNo || "").trim();
    if (rowAccountRef) {
      const byAccount = learners.find((l) => resolveLearnerAccountRef(l) === rowAccountRef);
      return resolveFamilyAccountId(byAccount);
    }
    return "";
  };

  const accountChildren = useMemo(() => {
    const ref = accountRef && accountRef !== "-" ? accountRef : "";
    const seen = new Set<string>();
    const children: AccountChild[] = [];

    const addChild = (source: any) => {
      const mapped = mapToAccountChild(source, ref || accountNo);
      if (!mapped || seen.has(mapped.id)) return;
      seen.add(mapped.id);
      children.push(mapped);
    };

    if (familyAccountId) {
      for (const learner of learners) {
        if (resolveFamilyAccountId(learner) === familyAccountId) addChild(learner);
      }
    } else if (ref) {
      for (const learner of learners) {
        if (resolveLearnerAccountRef(learner) === ref) addChild(learner);
      }
    }

    for (const row of statementRows) {
      const rowFamilyId = familyAccountIdForRow(row);
      const rowAccountRef = String(row.accountNo || "").trim();
      const matchesFamily = Boolean(familyAccountId && rowFamilyId === familyAccountId);
      const matchesRef = Boolean(ref && rowAccountRef === ref);
      if (!matchesFamily && !matchesRef) continue;
      const rowLearnerId = String(row.learnerId || row.id || "").trim();
      const learnerMatch = learners.find((l) => String(l?.id || l?.learnerId) === rowLearnerId);
      addChild(learnerMatch || row);
    }

    if (children.length === 0 && learnerId) {
      addChild(selected);
    }

    children.sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    );
    return children;
  }, [familyAccountId, accountRef, learners, statementRows, learnerId, selected, accountNo]);

  const isFamilyBillingAccount = accountChildren.length > 1 || Boolean(familyAccountId);
  const familyLearnerIds = useMemo(() => accountChildren.map((c) => c.id), [accountChildren]);

  const learnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const child of accountChildren) {
      map.set(child.id, `${child.firstName} ${child.lastName}`.trim());
    }
    return map;
  }, [accountChildren]);

  const familyLedgerScope = useMemo(
    () => ({
      accountRef: accountRef || accountNo,
      learnerIds: familyLearnerIds,
    }),
    [accountRef, accountNo, familyLearnerIds]
  );

  useEffect(() => {
    const onHistoryUpdated = () => setKidesysHistoryVersion((v) => v + 1);
    window.addEventListener(KIDESYS_HISTORY_UPDATED_EVENT, onHistoryUpdated);
    return () => window.removeEventListener(KIDESYS_HISTORY_UPDATED_EVENT, onHistoryUpdated);
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    const ref = accountRef || accountNo;
    if (!ref) {
      setAccountKidesysHistory([]);
      return;
    }
    let cancelled = false;
    syncKidesysHistoryForAccountFromApi(schoolId, ref)
      .then((rows) => {
        if (!cancelled) setAccountKidesysHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setAccountKidesysHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, accountRef, accountNo, kidesysHistoryVersion]);

  useEffect(() => {
    setTransactionsPage(1);
  }, [period, learnerId, accountNo, schoolId, accountRef]);

  const mergeCandidates = useMemo(() => {
    const q = mergeSearch.trim().toLowerCase();
    return statementRows.filter((row) => {
      const rowLearnerId = String(row.learnerId || row.id || "").trim();
      const rowAccountNo = String(row.accountNo || "").trim();
      const rowFamilyId = familyAccountIdForRow(row);
      if (rowLearnerId === learnerId && rowAccountNo === accountNo) return false;
      if (familyAccountId && rowFamilyId && rowFamilyId === familyAccountId) return false;
      if (accountRef && rowAccountNo === accountRef) return false;
      if (!q) return true;
      return [row.accountNo, row.name, row.surname, row.status, String(row.balance)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [statementRows, mergeSearch, learnerId, accountNo, familyAccountId, learners]);

  const ledger = useMemo(() => {
    const entries = isFamilyBillingAccount
      ? getFamilyAccountLedger(schoolId, familyLedgerScope)
      : getAccountLedger(schoolId, learnerId, accountRef || accountNo);
    return filterLedgerByStatementPeriod(entries, period);
  }, [schoolId, isFamilyBillingAccount, familyLedgerScope, learnerId, accountRef, accountNo, period]);

  const kidesysHistoryForAccount = useMemo(() => {
    const ref = accountRef || accountNo;
    if (accountKidesysHistory.length > 0) return accountKidesysHistory;
    if (!schoolId || !ref) return [];
    return filterHistoryForAccount(readSchoolKidesysHistory(schoolId), ref);
  }, [accountKidesysHistory, schoolId, accountRef, accountNo]);

  const kidesysHistorySummary = useMemo(
    () => getHistorySummaryForAccount(kidesysHistoryForAccount, accountRef || accountNo),
    [kidesysHistoryForAccount, accountRef, accountNo]
  );

  const lastInvoiceDisplay = useMemo(() => {
    const histInv = kidesysHistorySummary.lastInvoice;
    if (histInv) {
      const date = histInv.date ? ` on ${histInv.date}` : "";
      return `${formatMoney(histInv.amount)}${date}`;
    }
    if (selected?.lastInvoiceLabel && isMigratedOpeningBalanceOverviewLabel(selected.lastInvoiceLabel)) {
      return MIGRATED_OPENING_BALANCE_OVERVIEW;
    }
    if (selected?.lastInvoice === MIGRATED_OPENING_BALANCE_OVERVIEW) return MIGRATED_OPENING_BALANCE_OVERVIEW;
    if (selected?.lastInvoice && Number(selected.lastInvoice) > 0) {
      const date = selected?.lastInvoiceDate ? ` on ${selected.lastInvoiceDate}` : "";
      return `${formatMoney(selected.lastInvoice)}${date}`;
    }
    return selected?.lastInvoice || "No invoices";
  }, [kidesysHistorySummary, selected]);

  const lastPaymentDisplay = useMemo(() => {
    const histPay = kidesysHistorySummary.lastPayment;
    if (histPay) {
      const date = histPay.date ? ` on ${histPay.date}` : "";
      return `${formatMoney(histPay.amount)}${date}`;
    }
    if (selected?.lastPayment && Number(selected.lastPayment) > 0) {
      const date = selected?.lastPaymentDate ? ` on ${selected.lastPaymentDate}` : "";
      return `${formatMoney(selected.lastPayment)}${date}`;
    }
    return selected?.lastPayment || "No payments";
  }, [kidesysHistorySummary, selected]);

  const filteredKidesysHistory = useMemo(
    () => filterKidesysHistoryByStatementPeriod(kidesysHistoryForAccount, period),
    [kidesysHistoryForAccount, period]
  );

  const balance = isFamilyBillingAccount
    ? calculateBalanceFromEntries(ledger)
    : calculateAccountBalance(ledger, learnerId, accountRef || accountNo);

  type TransactionDisplayRow = {
    key: string;
    auditNo: string | number;
    date: string;
    type: string;
    learner: string;
    reference: string;
    description: string;
    amountIn: number;
    amountOut: number;
    balance: number | null;
    isKidesysHistory: boolean;
    isOpeningBalance: boolean;
    sortTime: number;
  };

  const transactions = useMemo(() => {
    type DisplayRow = TransactionDisplayRow;

    const postingRows: DisplayRow[] = [];
    const sortedPosting = [...ledger].sort(
      (a, b) =>
        new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
    );
    let running = 0;
    sortedPosting.forEach((entry, index) => {
      if (!shouldShowOpeningBalanceMigration(period, entry) && isKidesysOpeningBalanceEntry(entry)) {
        return;
      }
      const amount = normaliseBillingAmount(entry.amount);
      const isDebit = entry.type === "invoice" || entry.type === "penalty";
      const signed = isDebit ? amount : -amount;
      running += signed;
      const isOpeningBalance = isKidesysOpeningBalanceEntry(entry);
      const typeLabel = formatLedgerTypeLabel(entry);
      const learnerLabel = resolveEntryLearnerLabel(
        entry,
        learnerNameById,
        accountRef || accountNo
      );
      const sortTime = new Date(entry.date || entry.createdAt).getTime();
      postingRows.push({
        key: `posting-${entry.id}`,
        auditNo: index + 1,
        date: entry.date || "-",
        type: typeLabel,
        learner: learnerLabel,
        reference: formatLedgerReferenceDisplay(entry),
        description: formatLedgerDescriptionDisplay(entry),
        amountIn: isDebit ? amount : 0,
        amountOut: !isDebit ? amount : 0,
        balance: running,
        isKidesysHistory: false,
        isOpeningBalance,
        sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
      });
    });

    const historyRows: DisplayRow[] = filteredKidesysHistory.map((entry) => {
      const amount = normaliseBillingAmount(entry.amount);
      const isDebit = entry.type === "invoice";
      const sortTime = new Date(entry.date || "").getTime();
      return {
        key: `kidesys-${entry.id}`,
        auditNo: "—",
        date: entry.date || "-",
        type: formatKidesysHistoryTypeLabel(entry.type),
        learner: entry.fullName || "—",
        reference: formatKidesysHistoryReferenceDisplay(entry),
        description: formatKidesysHistoryDescriptionDisplay(entry),
        amountIn: isDebit ? amount : 0,
        amountOut: !isDebit ? amount : 0,
        balance: null,
        isKidesysHistory: true,
        isOpeningBalance: false,
        sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
      };
    });

    return [...postingRows, ...historyRows].sort((a, b) => {
      if (a.sortTime !== b.sortTime) return b.sortTime - a.sortTime;
      if (a.isKidesysHistory !== b.isKidesysHistory) return a.isKidesysHistory ? 1 : -1;
      return String(a.key).localeCompare(String(b.key));
    });
  }, [ledger, filteredKidesysHistory, learnerNameById, accountRef, accountNo, period]);

  const openingBalanceRows = useMemo(
    () => transactions.filter((row) => row.isOpeningBalance),
    [transactions]
  );

  const pageableTransactions = useMemo(
    () => transactions.filter((row) => !row.isOpeningBalance),
    [transactions]
  );

  const transactionsPagination = useMemo(() => {
    const total = pageableTransactions.length;
    const totalPages = Math.max(1, Math.ceil(total / TRANSACTIONS_PER_PAGE));
    const currentPage = Math.min(Math.max(1, transactionsPage), totalPages);
    const rangeStart = total === 0 ? 0 : (currentPage - 1) * TRANSACTIONS_PER_PAGE + 1;
    const rangeEnd = total === 0 ? 0 : Math.min(currentPage * TRANSACTIONS_PER_PAGE, total);
    const paginated = pageableTransactions.slice(
      (currentPage - 1) * TRANSACTIONS_PER_PAGE,
      currentPage * TRANSACTIONS_PER_PAGE
    );
    return { total, totalPages, currentPage, rangeStart, rangeEnd, paginated };
  }, [pageableTransactions, transactionsPage]);

  const transactionColumns = isFamilyBillingAccount
    ? ["Audit No", "Date", "Type", "Learner", "Reference", "Description", "Amount In", "Amount Out", "Balance"]
    : ["Audit No", "Date", "Type", "Reference", "Description", "Amount In", "Amount Out", "Balance"];

  const closeModal = () => {
    setModalKind(null);
    setPendingModal(null);
    setMergeSearch("");
    setMergeTarget(null);
    setUnmergeLearnerId("");
    setUnmergeCreateNew(true);
  };

  const openCreateInvoice = () => {
    persistBillingAccount("selectedInvoiceAccount", selected);
    setActivePage("invoiceCreate");
  };

  const openCreatePayment = () => {
    persistBillingAccount("selectedPaymentAccount", selected);
    if (onOpenPaymentCreate) {
      const account = {
        id: String(selected?.learnerId || selected?.id || "").trim(),
        learnerId: String(selected?.learnerId || selected?.id || "").trim(),
        accountNo: String(selected?.accountNo || "").trim(),
        name: String(selected?.name || selected?.firstName || "").trim(),
        surname: String(selected?.surname || selected?.lastName || "").trim(),
        balance: Number(selected?.balance || 0),
        parentName: selected?.parentName,
        lastPayment: selected?.lastPayment,
        lastInvoice: selected?.lastInvoice,
        status: selected?.status,
        familyAccountId: selected?.familyAccountId,
      };
      onOpenPaymentCreate(account as any);
      return;
    }
    setActivePage("paymentCreate");
  };

  const handleMoreAction = (action: string) => {
    switch (action) {
      case "Create Invoice":
        openCreateInvoice();
        break;
      case "Create Payment":
        openCreatePayment();
        break;
      case "Create Journal":
        setModalKind("journal");
        break;
      case "Unallocate All Transactions":
        setModalKind("unallocateConfirm");
        break;
      case "Merge With Another Account":
        setMergeSearch("");
        setMergeTarget(null);
        setFamilyActionError("");
        setFamilyActionSuccess("");
        setModalKind("merge");
        break;
      case "Unmerge Child From Account":
        setUnmergeLearnerId(accountChildren[0]?.id || "");
        setUnmergeCreateNew(true);
        setModalKind("unmerge");
        break;
      default:
        break;
    }
  };

  const confirmUnallocateAll = () => {
    setModalKind("unallocatePending");
  };

  const actorEmail = () => localStorage.getItem("userEmail") || undefined;

  const runMerge = async () => {
    if (!mergeTarget || !schoolId) return;
    const targetLearnerId = String(mergeTarget.learnerId || mergeTarget.id || "").trim();
    const targetFamilyId = familyAccountIdForRow(mergeTarget);
    const targetAccountRef = String(mergeTarget.accountNo || "").trim();

    if (!familyAccountId && !accountNo && !learnerId) {
      setFamilyActionError("Source account context is missing (school, account, or learner).");
      return;
    }
    if (!targetFamilyId && !targetAccountRef && !targetLearnerId) {
      setFamilyActionError("Target account context is missing.");
      return;
    }
    if (familyAccountId && targetFamilyId && familyAccountId === targetFamilyId) {
      setFamilyActionError("Cannot merge account into itself");
      return;
    }
    if (
      accountNo &&
      targetAccountRef &&
      accountNo === targetAccountRef &&
      (!familyAccountId || !targetFamilyId || familyAccountId === targetFamilyId)
    ) {
      setFamilyActionError("Cannot merge account into itself");
      return;
    }

    setFamilyActionBusy(true);
    setFamilyActionError("");
    setFamilyActionSuccess("");
    setModalKind("mergePending");

    try {
      const result = await mergeFamilyAccount({
        schoolId,
        sourceFamilyAccountId: familyAccountId || undefined,
        sourceAccountRef: accountNo || undefined,
        sourceLearnerId: learnerId || undefined,
        targetFamilyAccountId: targetFamilyId || undefined,
        targetAccountRef: targetAccountRef || undefined,
        targetLearnerId: targetLearnerId || undefined,
        actorEmail: actorEmail(),
      });
      await syncBillingLedgerFromApi(schoolId);
      notifyBillingUpdated();
      notifyLearnersRefresh();
      setTick((v) => v + 1);
      setFamilyActionSuccess(
        `Merged ${result.mergedLearnerIds?.length || 0} learner(s) into account ${result.targetAccountRef || mergeTarget.accountNo}.`
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Merge failed";
      setFamilyActionError(sanitizeUserFacingError(raw, "Merge failed"));
    } finally {
      setFamilyActionBusy(false);
    }
  };

  const confirmMerge = () => {
    if (!mergeTarget) return;
    const targetFamilyId = familyAccountIdForRow(mergeTarget);
    const targetAccountRef = String(mergeTarget.accountNo || "").trim();
    if (familyAccountId && targetFamilyId && familyAccountId === targetFamilyId) {
      setFamilyActionError("Cannot merge account into itself");
      return;
    }
    if (
      accountNo &&
      targetAccountRef &&
      accountNo === targetAccountRef &&
      (!familyAccountId || !targetFamilyId || familyAccountId === targetFamilyId)
    ) {
      setFamilyActionError("Cannot merge account into itself");
      return;
    }
    setFamilyActionError("");
    void runMerge();
  };

  const runUnmerge = async () => {
    if (!unmergeLearnerId || !schoolId) return;

    setFamilyActionBusy(true);
    setFamilyActionError("");
    setFamilyActionSuccess("");
    setModalKind("unmergePending");

    try {
      const result = await unmergeFamilyAccount({
        schoolId,
        learnerId: unmergeLearnerId,
        createNewAccount: unmergeCreateNew,
        actorEmail: actorEmail(),
      });
      await syncBillingLedgerFromApi(schoolId);
      notifyBillingUpdated();
      notifyLearnersRefresh();
      setTick((v) => v + 1);
      setFamilyActionSuccess(
        unmergeCreateNew
          ? `Learner moved to new account ${result.targetAccountRef || "created"}.`
          : "Learner detached from family account."
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Unmerge failed";
      setFamilyActionError(sanitizeUserFacingError(raw, "Unmerge failed"));
    } finally {
      setFamilyActionBusy(false);
    }
  };

  const confirmUnmerge = () => {
    if (!unmergeLearnerId) return;
    void runUnmerge();
  };

  const buttonStyle: React.CSSProperties = {
    border: `1px solid ${GOLD}`,
    background: "#fff",
    color: INK,
    borderRadius: 8,
    padding: "6px 12px",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
  };

  const modalBtn: React.CSSProperties = {
    ...buttonStyle,
    minWidth: 110,
  };

  const modalGoldBtn: React.CSSProperties = {
    ...modalBtn,
    background: `linear-gradient(135deg, #f7d56a, ${GOLD})`,
    border: "1px solid #b89329",
  };

  const periods = [...STATEMENT_PERIOD_OPTIONS];
  const statementPeriodForExport = normalizeStatementPeriod(period);

  const moreActions = [
    "Create Invoice",
    "Create Payment",
    "Create Journal",
    "Unallocate All Transactions",
    "Merge With Another Account",
    "Unmerge Child From Account",
  ];

  const sourceAccountLabel = `${accountNo || "-"} — ${selected?.name || ""} ${selected?.surname || ""}`.trim();

  const accountDisplayLabel = isFamilyBillingAccount
    ? `Family account ${accountRef || accountNo}`
    : `${selected?.name || ""} ${selected?.surname || ""}`.trim() || sourceAccountLabel;

  const statementChildren = useMemo(
    () =>
      accountChildren.map((c) => ({
        name: `${c.firstName} ${c.lastName}`.trim(),
        grade: c.grade,
      })),
    [accountChildren]
  );

  const handlePrintStatement = async () => {
    setActionNotice("");
    const anchorId = familyLearnerIds[0] || learnerId;
    if (!schoolId || !anchorId) {
      setActionNotice("School or learner context is missing.");
      return;
    }
    try {
      const opened = await openSchoolStatementPdfPrint(
        schoolId,
        anchorId,
        statementPeriodForExport,
        statementNote
      );
      if (!opened) {
        setActionNotice("Please allow pop-ups to print the statement.");
        setModalKind("pending");
        setPendingModal({
          title: "Print Statement",
          body: "Your browser blocked the print window. Allow pop-ups for this site, then try Print Statement again.",
        });
      }
    } catch (e: unknown) {
      setActionNotice((e as Error).message || "Could not generate statement PDF.");
    }
  };

  const handleDownloadStatement = async () => {
    setActionNotice("");
    const anchorId = familyLearnerIds[0] || learnerId;
    if (!schoolId || !anchorId) {
      setActionNotice("School or learner context is missing.");
      return;
    }
    const filename = `${(accountRef || accountNo || "statement").replace(/[^\w.-]+/g, "_")}-statement.pdf`;
    try {
      await downloadSchoolStatementPdf(
        schoolId,
        anchorId,
        filename,
        statementPeriodForExport,
        statementNote
      );
    } catch (e: unknown) {
      setActionNotice((e as Error).message || "Could not download statement PDF.");
    }
  };

  const closeSendModal = () => {
    setSendOpen(false);
    setSendError("");
    setSendBusy(false);
  };

  const handleSendStatement = async () => {
    setActionNotice("");
    const targetIds = familyLearnerIds.length ? familyLearnerIds : learnerId ? [learnerId] : [];
    const contact = resolveStatementBillingContact(learners, parents, targetIds);
    if (!contact?.email) {
      setModalKind("pending");
      setPendingModal({
        title: "Send Statement",
        body: "No parent or guardian email is on file for this account. Add an email on the learner’s Parents tab (with billing statements enabled) and try again.",
      });
      return;
    }
    if (!schoolId) {
      setModalKind("pending");
      setPendingModal({
        title: "Send Statement",
        body: "School context is missing. Please sign in again.",
      });
      return;
    }
    if (!emailReady) {
      if (onOpenEmailSetup) {
        onOpenEmailSetup();
        return;
      }
      setModalKind("pending");
      setPendingModal({
        title: "Send Statement",
        body: "Email setup required. Open Communication → Settings → Email (SMTP), save your provider settings, and send a test email.",
      });
      return;
    }
    const defaults = await buildStatementEmailDefaults(
      schoolId,
      schoolBranding.name,
      accountDisplayLabel,
      contact.name
    );
    setSendContact(contact);
    setSendSubject(defaults.subject);
    setSendMessage(defaults.message);
    setSendError("");
    setSendOpen(true);
  };

  const confirmSendStatement = async () => {
    if (!sendContact?.email || !schoolId) return;
    if (!sendSubject.trim()) {
      setSendError("Please enter an email subject.");
      return;
    }
    setSendBusy(true);
    setSendError("");
    try {
      const emailHtml = buildStatementCoverEmailHtml({
        school: schoolBranding,
        messagePlain: sendMessage || "",
      });
      const anchorId = familyLearnerIds[0] || learnerId;
      if (!anchorId) throw new Error("Learner context missing for statement PDF.");
      await sendStatementEmail({
        schoolId,
        to: sendContact.email,
        subject: sendSubject.trim(),
        html: emailHtml,
        learnerId: anchorId,
        period: statementPeriodForExport,
        statementNote,
        filename: `${(accountRef || accountNo || "statement").replace(/[^\w.-]+/g, "_")}-statement.pdf`,
      });
      closeSendModal();
      setModalKind("pending");
      setPendingModal({
        title: "Send Statement",
        body: `Statement sent to ${sendContact.email}.`,
      });
    } catch (e: unknown) {
      const err = e as Error & { setupRequired?: boolean };
      if (err.setupRequired) {
        setSendError(err.message || "Email setup required.");
        if (onOpenEmailSetup) {
          closeSendModal();
          onOpenEmailSetup();
        }
      } else {
        setSendError(err.message || "Failed to send statement.");
      }
    } finally {
      setSendBusy(false);
    }
  };

  const goldButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: `linear-gradient(135deg, #f7d56a, ${GOLD})`,
    border: "1px solid #b89329",
  };

  const pageBtnLight: React.CSSProperties = {
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: INK,
    borderRadius: 7,
    padding: "4px 10px",
    fontWeight: 800,
    fontSize: 12,
    cursor: "pointer",
  };

  const pageBtnGold: React.CSSProperties = {
    border: "1px solid #b89329",
    background: `linear-gradient(135deg, #f7d56a, ${GOLD})`,
    color: INK,
    borderRadius: 7,
    padding: "4px 10px",
    fontWeight: 900,
    fontSize: 12,
    minWidth: 32,
    cursor: "default",
  };

  const compactCell: React.CSSProperties = {
    padding: "7px 9px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 12,
  };

  const compactField: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#f8fafc",
    padding: "6px 8px",
    borderRadius: 6,
    fontWeight: 700,
    fontSize: 13,
    minHeight: 30,
    boxSizing: "border-box",
  };

  const renderTransactionRow = (row: TransactionDisplayRow) => (
    <tr
      key={row.key}
      style={
        row.isKidesysHistory
          ? { background: "rgba(212,175,55,0.08)" }
          : row.isOpeningBalance
            ? { background: "rgba(248,250,252,0.95)" }
            : undefined
      }
    >
      <td style={compactCell}>{row.auditNo}</td>
      <td style={compactCell}>{row.date}</td>
      <td style={compactCell}>
        {row.isKidesysHistory ? (
          <span style={{ fontWeight: 800, color: "#92400e" }}>{row.type}</span>
        ) : row.isOpeningBalance ? (
          <span style={{ fontWeight: 800, color: INK }}>{row.type}</span>
        ) : (
          row.type
        )}
      </td>
      {isFamilyBillingAccount ? (
        <td style={compactCell}>{row.learner || "-"}</td>
      ) : null}
      <td style={compactCell}>{row.reference}</td>
      <td style={compactCell}>{row.description}</td>
      <td style={{ ...compactCell, textAlign: "right" }}>
        {row.amountIn ? formatMoney(row.amountIn) : "-"}
      </td>
      <td style={{ ...compactCell, textAlign: "right" }}>
        {row.amountOut ? formatMoney(row.amountOut) : "-"}
      </td>
      <td style={{ ...compactCell, textAlign: "right", fontWeight: 800 }}>
        {row.balance === null ? "—" : formatMoney(row.balance)}
      </td>
    </tr>
  );

  const {
    total: pageableTotal,
    totalPages: transactionsTotalPages,
    currentPage: transactionsCurrentPage,
    rangeStart: transactionsRangeStart,
    rangeEnd: transactionsRangeEnd,
    paginated: paginatedTransactions,
  } = transactionsPagination;
  const totalTransactionCount = transactions.length;

  return (
    <div style={{ padding: "14px 18px", background: "#f6f4ef", minHeight: "100vh" }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: INK, lineHeight: 1.2 }}>
        Statement
        <span style={{ color: "#6b7280", fontSize: 16, fontWeight: 500 }}> » Manage a statement of account</span>
      </h1>
      <div style={{ display: "flex", gap: 8, margin: "10px 0", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={buttonStyle} onClick={() => setActivePage("statements")}>
          ↩ Back
        </button>
        <button type="button" style={buttonStyle} onClick={openCreatePayment}>
          + Payment
        </button>
        <button type="button" style={buttonStyle} onClick={() => void handlePrintStatement()}>
          Print Statement
        </button>
        <button type="button" style={buttonStyle} onClick={() => void handleDownloadStatement()}>
          Download PDF
        </button>
        <span
          style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
          title={emailReady ? "Send statement by email" : "Email setup required"}
        >
          <button type="button" style={goldButtonStyle} onClick={() => void handleSendStatement()}>
            Send Statement
          </button>
          {!emailReady ? (
            <span
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                background: "#b45309",
                color: "#fff",
                fontSize: 10,
                fontWeight: 900,
                padding: "2px 6px",
                borderRadius: 999,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              Email setup required
            </span>
          ) : null}
        </span>
        <select
          style={{ ...buttonStyle, minWidth: 200, minHeight: 32, appearance: "auto" }}
          defaultValue=""
          onChange={(e) => {
            const value = e.target.value;
            if (value) handleMoreAction(value);
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            More Actions
          </option>
          {moreActions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
        <select
          style={{ ...buttonStyle, minWidth: 180, minHeight: 32 }}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {actionNotice ? (
        <div style={{ margin: "0 0 8px", color: "#b45309", fontWeight: 700, fontSize: 13 }}>{actionNotice}</div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12, alignItems: "start" }}>
        <section style={{ background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ background: INK, color: GOLD, padding: "8px 12px", fontWeight: 900, fontSize: 14 }}>
            Account
          </div>
          <div style={{ padding: 12, display: "grid", gap: 8 }}>
            {[
              ["Account No", accountNo || "-"],
              ["Balance", formatMoney(balance)],
              ["Last Invoice", lastInvoiceDisplay],
              ["Last Payment", lastPaymentDisplay],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center" }}
              >
                <div style={{ textAlign: "right", fontWeight: 800, color: "#64748b", fontSize: 12 }}>
                  {label}
                </div>
                <div style={compactField}>{value}</div>
              </div>
            ))}
            {accountChildren.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "start" }}>
                <div style={{ textAlign: "right", fontWeight: 800, color: "#64748b", fontSize: 12 }}>
                  {accountChildren.length > 1 ? "Children" : "Learner"}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {accountChildren.map((child) => (
                    <div key={child.id} style={compactField}>
                      {child.firstName} {child.lastName}
                      <span style={{ color: "#64748b", fontWeight: 600, fontSize: 13 }}>
                        {" "}
                        · Grade {child.grade}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {isFamilyBillingAccount ? (
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textAlign: "right" }}>
                Family account · {accountChildren.length} learner{accountChildren.length === 1 ? "" : "s"} on{" "}
                {accountRef || accountNo || "this account"}
              </div>
            ) : null}
          </div>
        </section>
        <section style={{ background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 6 }}>Summary</div>
          <div style={{ fontWeight: 700, lineHeight: 1.55, fontSize: 13 }}>
            {accountChildren.length > 1 ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", letterSpacing: 0.4, marginBottom: 6 }}>
                  Children
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                  {accountChildren.map((child) => (
                    <li key={child.id}>
                      {child.firstName} {child.lastName}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                {selected?.name} {selected?.surname}
              </div>
            )}
            <div style={{ fontSize: 20, fontWeight: 900, color: balance > 0 ? "#b91c1c" : "#166534" }}>
              {formatMoney(balance)}
            </div>
            <div style={{ color: "#64748b" }}>{selected?.status || "Up To Date"}</div>
            {accountRef && accountChildren.length > 1 ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Account {accountRef}</div>
            ) : null}
            {statementNote ? (
              <div style={{ marginTop: 12, color: "#475569", fontSize: 14, whiteSpace: "pre-wrap" }}>
                {statementNote}
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <section style={{ marginTop: 12, background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "8px 12px", background: INK, color: GOLD, fontWeight: 900, fontSize: 15 }}>
          Transactions
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {transactionColumns.map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "7px 9px",
                        borderBottom: "1px solid #e5e7eb",
                        textAlign: h.includes("Amount") || h === "Balance" ? "right" : "left",
                        fontSize: 11,
                        fontWeight: 900,
                        color: "#64748b",
                      }}
                    >
                      {h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {totalTransactionCount === 0 ? (
                <tr>
                  <td
                    colSpan={transactionColumns.length}
                    style={{ padding: 16, textAlign: "center", color: "#64748b", fontWeight: 700, fontSize: 13 }}
                  >
                    No transactions recorded for this account yet.
                  </td>
                </tr>
              ) : (
                <>
                  {openingBalanceRows.map((row) => renderTransactionRow(row))}
                  {paginatedTransactions.map((row) => renderTransactionRow(row))}
                </>
              )}
            </tbody>
          </table>
        </div>
        {totalTransactionCount > 0 ? (
          <div
            style={{
              padding: "8px 12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid #e5e7eb",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span style={{ color: "#64748b", fontSize: 13, fontWeight: 600 }}>
              Showing{" "}
              {pageableTotal === 0
                ? 0
                : transactionsRangeStart}
              {" - "}
              {transactionsRangeEnd}
              {" of "}
              {totalTransactionCount}
              {" transaction"}
              {totalTransactionCount === 1 ? "" : "s"}
            </span>
            {pageableTotal > TRANSACTIONS_PER_PAGE ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  style={{
                    ...pageBtnLight,
                    opacity: transactionsCurrentPage <= 1 ? 0.5 : 1,
                    cursor: transactionsCurrentPage <= 1 ? "not-allowed" : "pointer",
                  }}
                  disabled={transactionsCurrentPage <= 1}
                  onClick={() => setTransactionsPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button type="button" style={pageBtnGold} aria-current="page">
                  {transactionsCurrentPage}
                </button>
                <button
                  type="button"
                  style={{
                    ...pageBtnLight,
                    opacity: transactionsCurrentPage >= transactionsTotalPages ? 0.5 : 1,
                    cursor: transactionsCurrentPage >= transactionsTotalPages ? "not-allowed" : "pointer",
                  }}
                  disabled={transactionsCurrentPage >= transactionsTotalPages}
                  onClick={() =>
                    setTransactionsPage((p) => Math.min(transactionsTotalPages, p + 1))
                  }
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {modalKind === "journal" ? (
        <StatementModal
          title="Create Journal"
          onClose={closeModal}
          footer={
            <button type="button" style={modalGoldBtn} onClick={closeModal}>
              Close
            </button>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 600 }}>
            Manual billing journals from Statement Manage are not available yet. Supplier and expense journals are
            handled in Accounting → Journals. This action is pending implementation for debtor accounts.
          </p>
        </StatementModal>
      ) : null}

      {modalKind === "unallocateConfirm" ? (
        <StatementModal
          title="Unallocate All Transactions"
          onClose={closeModal}
          footer={
            <>
              <button type="button" style={modalBtn} onClick={closeModal}>
                Cancel
              </button>
              <button type="button" style={{ ...modalGoldBtn, color: "#7f1d1d" }} onClick={confirmUnallocateAll}>
                Yes, unallocate all
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 600 }}>
            This will remove payment allocations for every transaction on{" "}
            <strong>{sourceAccountLabel}</strong>. This cannot be undone once the unallocation engine is live.
          </p>
          <p style={{ margin: "14px 0 0", color: "#b45309", fontWeight: 800 }}>
            Are you sure you want to continue?
          </p>
        </StatementModal>
      ) : null}

      {modalKind === "unallocatePending" ? (
        <StatementModal
          title="Unallocate All Transactions"
          onClose={closeModal}
          footer={
            <button type="button" style={modalGoldBtn} onClick={closeModal}>
              Close
            </button>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 700 }}>
            Unallocation engine not implemented yet.
          </p>
          <p style={{ margin: "12px 0 0", color: "#64748b", fontWeight: 600 }}>
            Per-payment unallocate is available on the Create Payment screen. Account-wide unallocation will be added
            when the backend API is ready.
          </p>
        </StatementModal>
      ) : null}

      {modalKind === "merge" ? (
        <StatementModal
          title="Merge With Another Account"
          onClose={closeModal}
          footer={
            <>
              <button type="button" style={modalBtn} onClick={closeModal}>
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...modalGoldBtn,
                  opacity: mergeTarget ? 1 : 0.45,
                  cursor: mergeTarget ? "pointer" : "not-allowed",
                }}
                disabled={!mergeTarget}
                onClick={confirmMerge}
              >
                Confirm merge
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>Source account</div>
              <div style={{ padding: 12, borderRadius: 8, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                {sourceAccountLabel}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>Search target account</div>
              <input
                value={mergeSearch}
                onChange={(e) => setMergeSearch(e.target.value)}
                placeholder="Account no, name, or surname"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontWeight: 600,
                }}
              />
              <div
                style={{
                  marginTop: 8,
                  maxHeight: 180,
                  overflow: "auto",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                }}
              >
                {mergeCandidates.length === 0 ? (
                  <div style={{ padding: 14, color: "#64748b", fontWeight: 600 }}>No matching accounts.</div>
                ) : (
                  mergeCandidates.slice(0, 12).map((row) => {
                    const key = String(row.learnerId || row.id || row.accountNo);
                    const selectedTarget =
                      String(mergeTarget?.learnerId || mergeTarget?.id) === String(row.learnerId || row.id);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setMergeTarget(row);
                          setFamilyActionError("");
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          border: "none",
                          borderBottom: "1px solid #f1f5f9",
                          background: selectedTarget ? "rgba(212,175,55,0.2)" : "#fff",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {row.accountNo} — {row.name} {row.surname} ({formatMoney(row.balance)})
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            {mergeTarget ? (
              <div>
                <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>Target account</div>
                <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${GOLD}`, background: "#fffbeb" }}>
                  {mergeTarget.accountNo} — {mergeTarget.name} {mergeTarget.surname}
                </div>
              </div>
            ) : null}
            <p style={{ margin: 0, color: "#b45309", fontWeight: 800, lineHeight: 1.6 }}>
              Warning: learners and transactions from the source account will be merged into the target family account.
              Balances and history will be combined.
            </p>
            {familyActionError ? (
              <p style={{ margin: 0, color: "#b91c1c", fontWeight: 700, lineHeight: 1.6 }}>{familyActionError}</p>
            ) : null}
          </div>
        </StatementModal>
      ) : null}

      {modalKind === "mergePending" ? (
        <StatementModal
          title="Merge With Another Account"
          onClose={familyActionBusy ? undefined : closeModal}
          footer={
            <button type="button" style={modalGoldBtn} onClick={closeModal} disabled={familyActionBusy}>
              Close
            </button>
          }
        >
          {familyActionBusy ? (
            <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 700 }}>
              Merging {sourceAccountLabel} → {mergeTarget?.accountNo} — {mergeTarget?.name} {mergeTarget?.surname}…
            </p>
          ) : familyActionError ? (
            <p style={{ margin: 0, lineHeight: 1.7, color: "#b91c1c", fontWeight: 700 }}>{familyActionError}</p>
          ) : (
            <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 700 }}>
              {familyActionSuccess || "Merge completed."}
            </p>
          )}
        </StatementModal>
      ) : null}

      {modalKind === "unmerge" ? (
        <StatementModal
          title="Unmerge Child From Account"
          onClose={closeModal}
          footer={
            <>
              <button type="button" style={modalBtn} onClick={closeModal}>
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...modalGoldBtn,
                  opacity: unmergeLearnerId ? 1 : 0.45,
                  cursor: unmergeLearnerId ? "pointer" : "not-allowed",
                }}
                disabled={!unmergeLearnerId}
                onClick={confirmUnmerge}
              >
                Confirm unmerge
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "#64748b", fontWeight: 600, lineHeight: 1.6 }}>
              Move a learner off this family billing account. Outstanding balance stays with the family account unless
              you reallocate after split.
            </p>
            <div>
              <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>Learners on this account</div>
              {accountChildren.length === 0 ? (
                <div style={{ color: "#64748b", fontWeight: 600 }}>No learners found for this account.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {accountChildren.map((child) => (
                    <label
                      key={child.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: 12,
                        borderRadius: 8,
                        border: `1px solid ${unmergeLearnerId === child.id ? GOLD : "#e5e7eb"}`,
                        background: unmergeLearnerId === child.id ? "rgba(212,175,55,0.12)" : "#f8fafc",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      <input
                        type="radio"
                        name="unmergeLearner"
                        checked={unmergeLearnerId === child.id}
                        onChange={() => setUnmergeLearnerId(child.id)}
                      />
                      <span>
                        {child.firstName} {child.lastName} · Grade {child.grade} · {child.accountNo}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={unmergeCreateNew}
                onChange={(e) => setUnmergeCreateNew(e.target.checked)}
              />
              Create a new billing account for this learner
            </label>
            <p style={{ margin: 0, color: "#b45309", fontWeight: 800, lineHeight: 1.6 }}>
              Warning: unmerging changes how statements and payments are grouped. Review balances before confirming.
            </p>
          </div>
        </StatementModal>
      ) : null}

      {modalKind === "unmergePending" ? (
        <StatementModal
          title="Unmerge Child From Account"
          onClose={familyActionBusy ? undefined : closeModal}
          footer={
            <button type="button" style={modalGoldBtn} onClick={closeModal} disabled={familyActionBusy}>
              Close
            </button>
          }
        >
          {familyActionBusy ? (
            <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 700 }}>
              {unmergeCreateNew ? "Creating new account and unmerging learner…" : "Detaching learner from family account…"}
            </p>
          ) : familyActionError ? (
            <p style={{ margin: 0, lineHeight: 1.7, color: "#b91c1c", fontWeight: 700 }}>{familyActionError}</p>
          ) : (
            <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 700 }}>
              {familyActionSuccess || "Unmerge completed."}
            </p>
          )}
        </StatementModal>
      ) : null}

      {modalKind === "pending" && pendingModal ? (
        <StatementModal
          title={pendingModal.title}
          onClose={closeModal}
          footer={
            <button type="button" style={modalGoldBtn} onClick={closeModal}>
              Close
            </button>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", fontWeight: 600 }}>{pendingModal.body}</p>
        </StatementModal>
      ) : null}

      {sendOpen && sendContact ? (
        <StatementModal
          title="Send Statement"
          onClose={sendBusy ? undefined : closeSendModal}
          footer={
            <>
              <button type="button" style={modalBtn} onClick={closeSendModal} disabled={sendBusy}>
                Cancel
              </button>
              <button type="button" style={modalGoldBtn} onClick={() => void confirmSendStatement()} disabled={sendBusy}>
                {sendBusy ? "Sending…" : "Send Email"}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>To</div>
              <div style={{ padding: 12, borderRadius: 8, border: "1px solid #e5e7eb", background: "#f8fafc", fontWeight: 700 }}>
                {sendContact.name} &lt;{sendContact.email}&gt;
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>Subject</div>
              <input
                value={sendSubject}
                onChange={(e) => setSendSubject(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontWeight: 600,
                }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 900, color: INK, marginBottom: 6 }}>Message</div>
              <textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                rows={6}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontWeight: 600,
                  resize: "vertical",
                }}
              />
            </div>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13, fontWeight: 600 }}>
              The statement PDF for account {accountRef || accountNo} is attached. Email is sent using your school&apos;s
              saved SMTP settings (From / Reply-To from Communication settings).
            </p>
            {sendError ? (
              <p style={{ margin: 0, color: "#b91c1c", fontWeight: 700, lineHeight: 1.6 }}>{sendError}</p>
            ) : null}
          </div>
        </StatementModal>
      ) : null}
    </div>
  );
}
