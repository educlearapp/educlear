import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  loadPaymentArrangements,
  type PaymentArrangement,
} from "../accounting/accountingDebtorsHelpers";
import { fetchBillingSettings } from "../billingSettings/billingSettingsApi";
import { createDefaultBillingSettings } from "../billingSettings/components/billingSettingsConstants";
import type { BillingAccountRow } from "./billingLedger";
import type { AccountHealth, FinancePolicySettings } from "../finance/financePolicy";
import { formatFinanceDate, formatFinanceMoney } from "../finance/financePolicy";
import {
  buildFinanceAccountSnapshots,
  type FinanceAccountSnapshot,
  groupCollectionsSnapshotsByHealth,
} from "../finance/financeAccountEngine";
import { downloadSchoolStatementPdf } from "./statementDocument";
import { DEFAULT_STATEMENT_PERIOD, buildStatementPdfFilename } from "./statementPeriod";

type Props = {
  schoolId: string;
  learners: unknown[];
  statementRows: BillingAccountRow[];
};

type HealthBucket = AccountHealth;

const healthOrder: HealthBucket[] = ["Excellent", "Needs Attention", "Action Required", "Critical"];
const reviewHealthOrder: HealthBucket[] = ["Critical", "Action Required", "Needs Attention"];
const pageSizeOptions = [10, 25, 50] as const;
const arrangementBuckets = [
  "New Payment Plan Requests",
  "Pending Review",
  "Approved",
  "Rejected",
  "Active",
  "Broken",
  "Completed",
] as const;

type ActionPanel =
  | { kind: "finance-update"; snapshot: FinanceAccountSnapshot }
  | { kind: "account"; snapshot: FinanceAccountSnapshot }
  | { kind: "payment-plan"; snapshot: FinanceAccountSnapshot };

export default function FinanceCollectionsCentre({ schoolId, learners, statementRows }: Props) {
  const [policy, setPolicy] = useState<FinancePolicySettings>(
    createDefaultBillingSettings().financePolicy
  );
  const [actionPanel, setActionPanel] = useState<ActionPanel | null>(null);
  const [statementNotice, setStatementNotice] = useState("");
  const [statementBusyAccount, setStatementBusyAccount] = useState("");
  const [activeHealth, setActiveHealth] = useState<HealthBucket>("Critical");
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(25);
  const [accountPage, setAccountPage] = useState(1);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    fetchBillingSettings(schoolId)
      .then((settings) => {
        if (!cancelled) setPolicy(settings.financePolicy);
      })
      .catch(() => {
        if (!cancelled) setPolicy(createDefaultBillingSettings().financePolicy);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const financeSnapshots = useMemo(
    () =>
      buildFinanceAccountSnapshots({
        schoolId,
        learners,
        statementRows,
        policy,
      }),
    [schoolId, learners, statementRows, policy]
  );

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("financeHealthTrace") !== "1") return;
    console.table(
      financeSnapshots.slice(0, 20).map((snapshot) => ({
        accountRef: snapshot.accountRef,
        monthsOutstanding: snapshot.monthsOutstanding,
        engineHealthStatus: snapshot.healthStatus,
        uiDisplayedStatus: snapshot.collectionsHealth,
      }))
    );
  }, [financeSnapshots]);

  const classifiedSnapshots = financeSnapshots;
  const healthGroups = useMemo(() => groupCollectionsSnapshotsByHealth(classifiedSnapshots), [classifiedSnapshots]);
  const filteredSnapshots = useMemo(
    () => [...healthGroups[activeHealth]].sort(activeHealth === "Excellent" ? compareHealthyAccounts : compareReviewUrgency),
    [activeHealth, healthGroups]
  );
  const totalPages = Math.max(1, Math.ceil(filteredSnapshots.length / pageSize));
  const currentPage = Math.min(accountPage, totalPages);
  const pagedSnapshots = useMemo(
    () => filteredSnapshots.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredSnapshots, pageSize]
  );

  const arrangementCounts = useMemo(() => {
    const counts = Object.fromEntries(arrangementBuckets.map((bucket) => [bucket, 0])) as Record<
      (typeof arrangementBuckets)[number],
      number
    >;
    if (!schoolId) return counts;
    for (const arrangement of loadPaymentArrangements(schoolId)) {
      const bucket = arrangementStatusBucket(String((arrangement as any).status || ""));
      counts[bucket] += 1;
    }
    return counts;
  }, [schoolId]);

  const totalCollectable = classifiedSnapshots.reduce(
    (sum, row) => sum + Math.max(0, Number(row.dueNow) || 0),
    0
  );
  const categoryTotal = healthOrder.reduce((sum, bucket) => sum + healthGroups[bucket].length, 0);
  const arrangements = useMemo(() => (schoolId ? loadPaymentArrangements(schoolId) : []), [schoolId]);

  const selectHealth = (health: HealthBucket) => {
    setActiveHealth(health);
    setAccountPage(1);
  };

  const handleGenerateStatement = async (snapshot: FinanceAccountSnapshot) => {
    const accountNo = String(snapshot.row.accountNo || "").trim();
    const learnerId = String(snapshot.row.learnerId || snapshot.row.id || "").trim();
    if (!schoolId || !accountNo) {
      setStatementNotice("This account does not have enough detail to generate a statement.");
      return;
    }
    setStatementNotice("");
    setStatementBusyAccount(accountNo);
    try {
      await downloadSchoolStatementPdf(
        schoolId,
        learnerId,
        buildStatementPdfFilename(accountNo, DEFAULT_STATEMENT_PERIOD),
        DEFAULT_STATEMENT_PERIOD,
        undefined,
        accountNo
      );
      setStatementNotice(`Latest statement opened for account ${accountNo}.`);
    } catch (error) {
      setStatementNotice(error instanceof Error ? error.message : "Failed to generate statement.");
    } finally {
      setStatementBusyAccount("");
    }
  };

  return (
    <div style={page}>
      <div style={header}>
        <div>
          <p style={eyebrow}>Finance Office</p>
          <h1 style={title}>Collections Centre</h1>
          <p style={subtitle}>
            See which accounts need attention, what to review next, and where payment plans stand.
          </p>
        </div>
        <div style={totalCard}>
          <span>Total Amount You Need To Collect</span>
          <strong>{formatFinanceMoney(totalCollectable)}</strong>
          <small style={lightMuted}>Overdue / due-now amount across {categoryTotal} grouped accounts</small>
        </div>
      </div>

      <section style={grid}>
        {healthOrder.map((bucket) => (
          <button
            key={bucket}
            type="button"
            style={statusCardStyle(bucket, activeHealth === bucket)}
            onClick={() => selectHealth(bucket)}
          >
            <div style={statusIcon}>{statusIconFor(bucket)}</div>
            <span style={statusLabel}>{displayHealthBucket(bucket)}</span>
            <strong style={statusCount}>{healthGroups[bucket].length}</strong>
            <small style={statusAmount}>{formatFinanceMoney(sumSnapshots(healthGroups[bucket]))}</small>
          </button>
        ))}
      </section>

      <section style={panel}>
        <div style={panelHeader}>
          <div>
            <p style={eyebrow}>Next action</p>
            <h2 style={sectionTitle}>{displayHealthBucket(activeHealth)} Accounts</h2>
          </div>
          <span style={muted}>
            {activeHealth === "Excellent"
              ? "Sorted alphabetically by account reference or parent surname."
              : "Sorted by urgency within the selected status."}
          </span>
        </div>
        {statementNotice ? <div style={notice}>{statementNotice}</div> : null}
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Account</th>
                <th style={th}>Parent</th>
                <th style={th}>Total Balance</th>
                <th style={th}>Due Now</th>
                <th style={th}>Monthly Fees</th>
                <th style={th}>Status</th>
                <th style={th}>What should happen next?</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedSnapshots
                .map((snapshot) => {
                  const health = snapshot.collectionsHealth;
                  return (
                    <tr key={snapshot.accountRef || `${snapshot.row.learnerId}-${snapshot.row.accountNo}`}>
                      <td style={td}>
                        <strong>{snapshot.billingAccountRef || snapshot.row.accountNo || "No account"}</strong>
                        <small style={muted}>
                          {snapshot.childrenOnAccount.length > 1
                            ? `Family account · ${snapshot.firstLearnerName}`
                            : snapshot.learnerDisplayName || "Learner"}
                        </small>
                      </td>
                      <td style={td}>{snapshot.parentGuardianName}</td>
                      <td style={td}>{formatFinanceMoney(snapshot.totalBalance)}</td>
                      <td style={td}>{formatFinanceMoney(snapshot.overdueAmount)}</td>
                      <td style={td}>{formatFinanceMoney(snapshot.monthlyFeeTotal)}</td>
                      <td style={td}>{health}</td>
                      <td style={td}>{nextOfficeAction(health)}</td>
                      <td style={td}>
                        <div style={actionGrid}>
                          <button type="button" style={actionBtn} onClick={() => setActionPanel({ kind: "finance-update", snapshot })}>
                            Preview Finance Update
                          </button>
                          <button type="button" style={actionBtn} onClick={() => setActionPanel({ kind: "account", snapshot })}>
                            View Account
                          </button>
                          <button type="button" style={actionBtn} onClick={() => setActionPanel({ kind: "payment-plan", snapshot })}>
                            Review Payment Plan
                          </button>
                          <button
                            type="button"
                            style={actionBtn}
                            onClick={() => void handleGenerateStatement(snapshot)}
                            disabled={statementBusyAccount === String(snapshot.row.accountNo || "").trim()}
                          >
                            {statementBusyAccount === String(snapshot.row.accountNo || "").trim()
                              ? "Generating..."
                              : "Generate Statement"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {!filteredSnapshots.length ? (
            <div style={emptyState}>No accounts in this status.</div>
          ) : null}
        </div>
        <div style={paginationBar}>
          <label style={pageSizeControl}>
            Accounts per page
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as (typeof pageSizeOptions)[number]);
                setAccountPage(1);
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <span style={muted}>Page {currentPage} of {totalPages}</span>
          <div style={paginationActions}>
            <button
              type="button"
              style={pageBtn}
              onClick={() => setAccountPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              style={pageBtn}
              onClick={() => setAccountPage((value) => Math.min(totalPages, value + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section style={panel}>
        <div style={panelHeader}>
          <div>
            <p style={eyebrow}>Payment plans</p>
            <h2 style={sectionTitle}>Payment Plan Review Board</h2>
          </div>
        </div>
        <div style={grid}>
          {arrangementBuckets.map((bucket) => (
            <div key={bucket} style={card}>
              <span style={eyebrow}>{bucket}</span>
              <strong style={count}>{arrangementCounts[bucket]}</strong>
            </div>
          ))}
        </div>
      </section>

      {actionPanel ? (
        <ActionPanelModal
          panel={actionPanel}
          arrangements={arrangements}
          onClose={() => setActionPanel(null)}
        />
      ) : null}
    </div>
  );
}

function arrangementStatusBucket(status: string): (typeof arrangementBuckets)[number] {
  const clean = status.trim().toLowerCase();
  if (clean === "pending review" || clean === "pending") return "Pending Review";
  if (clean === "approved") return "Approved";
  if (clean === "rejected" || clean === "cancelled") return "Rejected";
  if (clean === "active") return "Active";
  if (clean === "broken") return "Broken";
  if (clean === "completed") return "Completed";
  return "New Payment Plan Requests";
}

function nextOfficeAction(health: HealthBucket) {
  if (health === "Excellent") return "No action needed.";
  if (health === "Needs Attention") return "Send a friendly reminder.";
  if (health === "Action Required") return "Contact parent and request payment plan if allowed.";
  return "Prioritise urgent finance office follow-up.";
}

function compareReviewUrgency(a: FinanceAccountSnapshot, b: FinanceAccountSnapshot) {
  const healthDiff = reviewRank(a.collectionsHealth) - reviewRank(b.collectionsHealth);
  if (healthDiff !== 0) return healthDiff;
  const monthsDiff = b.collectionsMonthsOutstanding - a.collectionsMonthsOutstanding;
  if (monthsDiff !== 0) return monthsDiff;
  return b.overdueAmount - a.overdueAmount;
}

function compareHealthyAccounts(a: FinanceAccountSnapshot, b: FinanceAccountSnapshot) {
  const accountCompare = String(a.billingAccountRef || a.row.accountNo || "").localeCompare(
    String(b.billingAccountRef || b.row.accountNo || ""),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
  if (accountCompare !== 0) return accountCompare;
  return String(a.parentGuardianName || "").localeCompare(String(b.parentGuardianName || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function reviewRank(health: AccountHealth) {
  const index = reviewHealthOrder.indexOf(health);
  return index === -1 ? reviewHealthOrder.length : index;
}

function sumSnapshots(rows: FinanceAccountSnapshot[]) {
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.dueNow) || 0), 0);
}

function accountArrangements(snapshot: FinanceAccountSnapshot, arrangements: PaymentArrangement[]) {
  const learnerIds = new Set(
    [
      String(snapshot.row.learnerId || snapshot.row.id || "").trim(),
      ...(snapshot.row.memberLearnerIds || []).map((id) => String(id || "").trim()),
      ...snapshot.childrenOnAccount.map((child) => String(child.id || "").trim()),
    ].filter(Boolean)
  );
  const accountNo = String(snapshot.row.accountNo || "").trim();
  const familyAccountId = String(snapshot.row.familyAccountId || "").trim();
  return arrangements.filter(
    (arrangement: any) => {
      const arrangementAccountNo = String(arrangement.accountNo || "").trim();
      if (accountNo && arrangementAccountNo === accountNo) return true;
      if (familyAccountId && String(arrangement.familyAccountId || "").trim() === familyAccountId) return true;
      return learnerIds.has(String(arrangement.learnerId || "").trim()) && arrangementAccountNo === accountNo;
    }
  );
}

function financeUpdateMessage(snapshot: FinanceAccountSnapshot) {
  const summary = snapshot.summary;
  const isFamily = snapshot.childrenOnAccount.length > 1 || Boolean(snapshot.row.familyAccountId);
  const subject = isFamily ? "Your family account" : `${snapshot.learnerDisplayName || "Your child"}'s account`;
  const learnerLine = isFamily && snapshot.learnerDisplayName ? [`Learners: ${snapshot.learnerDisplayName}.`] : [];
  return [
    `Hi ${snapshot.parentGuardianName || "Parent"},`,
    `${subject} is currently ${displayHealthBucket(snapshot.healthStatus)}.`,
    ...learnerLine,
    `Total balance: ${formatFinanceMoney(snapshot.totalBalance)}.`,
    `Due now / overdue: ${formatFinanceMoney(snapshot.dueNow)}.`,
    `Monthly fee total: ${formatFinanceMoney(snapshot.monthlyFeeTotal)}.`,
    `Next school fee due: ${formatFinanceDate(summary.nextSchoolFeeDueDate)}.`,
    summary.nextAction,
  ].join("\n");
}

function ActionPanelModal({
  panel,
  arrangements,
  onClose,
}: {
  panel: ActionPanel;
  arrangements: PaymentArrangement[];
  onClose: () => void;
}) {
  const snapshot = panel.snapshot;
  const plans = accountArrangements(snapshot, arrangements);
  return (
    <div style={modalBackdrop} role="dialog" aria-modal="true">
      <div style={modalCard}>
        <div style={modalHeader}>
          <div>
            <p style={eyebrow}>{snapshot.row.accountNo || "Account"}</p>
            <h2 style={sectionTitle}>{modalTitle(panel.kind)}</h2>
          </div>
          <button type="button" style={closeBtn} onClick={onClose}>
            Close
          </button>
        </div>

        {panel.kind === "finance-update" ? (
          <div style={phonePreview}>
            <p style={previewLabel}>WhatsApp preview only. No message has been sent.</p>
            <pre style={messagePreview}>{financeUpdateMessage(snapshot)}</pre>
          </div>
        ) : null}

        {panel.kind === "account" ? (
          <div style={detailGrid}>
            <Detail label="Account" value={snapshot.accountRef || "No account"} />
            <Detail label="Parent / Guardian" value={snapshot.parentGuardianName} />
            <div style={detailItem}>
              <span>Learners</span>
              <div style={learnerDetailList}>
                {snapshot.learnerDetails.length ? (
                  snapshot.learnerDetails.map((learner) => (
                    <strong key={learner.id || learner.name}>
                      {learner.name}
                      {learner.grade ? ` — ${learner.grade}` : ""}
                    </strong>
                  ))
                ) : (
                  <strong>{snapshot.learnerDisplayName || "Learner"}</strong>
                )}
              </div>
            </div>
            <Detail label="Total Balance" value={formatFinanceMoney(snapshot.totalBalance)} />
            <Detail label="Overpaid Amount" value={formatFinanceMoney(snapshot.overpaidAmount)} />
            <Detail label="Monthly Fee Total" value={formatFinanceMoney(snapshot.monthlyFeeTotal)} />
            <Detail label="Due Now / Overdue" value={formatFinanceMoney(snapshot.dueNow)} />
            <Detail label="Collections Status" value={snapshot.collectionsHealth} />
            <Detail label="Collections Basis" value={snapshot.collectionsReason} />
            <Detail label="Months Outstanding" value={snapshot.collectionsMonthsOutstanding || "Current"} />
            <Detail label="Next Due Date" value={formatFinanceDate(snapshot.nextDueDate)} />
          </div>
        ) : null}

        {panel.kind === "payment-plan" ? (
          plans.length ? (
            <div style={planList}>
              {plans.map((plan) => (
                <div key={plan.id} style={planCard}>
                  <strong>{plan.status}</strong>
                  <span>{formatFinanceMoney(plan.amount)}</span>
                  <span>
                    {formatFinanceDate(plan.startDate)} to {formatFinanceDate(plan.endDate)}
                  </span>
                  {plan.notes ? <small style={muted}>{plan.notes}</small> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyState}>No payment plan request for this account yet.</div>
          )
        ) : null}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={detailItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function modalTitle(kind: ActionPanel["kind"]) {
  if (kind === "finance-update") return "Preview Finance Update";
  if (kind === "payment-plan") return "Payment Plan Review";
  return "Account Details";
}

const page: CSSProperties = { display: "grid", gap: 16 };
const header: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  gap: 16,
  padding: 24,
  borderRadius: 28,
  background:
    "radial-gradient(circle at 86% 18%, rgba(247, 213, 106, 0.22), transparent 30%), linear-gradient(135deg, #0f0f0f, #221b10)",
  color: "#ffffff",
  border: "1px solid rgba(212, 175, 55, 0.34)",
  boxShadow: "0 24px 60px rgba(15,15,15,0.16)",
};
const title: CSSProperties = { margin: "4px 0 10px", fontSize: "2.4rem", lineHeight: 1, letterSpacing: "-0.04em" };
const subtitle: CSSProperties = { margin: 0, color: "rgba(255,255,255,0.8)", maxWidth: 620, fontSize: "1.02rem", lineHeight: 1.5 };
const eyebrow: CSSProperties = {
  margin: 0,
  color: "#d4af37",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};
const totalCard: CSSProperties = {
  display: "grid",
  gap: 10,
  minWidth: 280,
  padding: 18,
  borderRadius: 22,
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255, 255, 255, 0.22)",
  backdropFilter: "blur(10px)",
  fontSize: "1rem",
};
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
};
const card: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  background: "#ffffff",
  border: "1px solid rgba(212, 175, 55, 0.26)",
  boxShadow: "0 8px 24px rgba(15,15,15,0.06)",
};
const count: CSSProperties = { display: "block", marginTop: 8, fontSize: "1.8rem" };
const muted: CSSProperties = { display: "block", color: "#64748b", fontSize: 12, lineHeight: 1.4 };
const lightMuted: CSSProperties = { display: "block", color: "rgba(255,255,255,0.76)", fontSize: 12, lineHeight: 1.4 };
const panel: CSSProperties = {
  padding: 20,
  borderRadius: 22,
  background: "#ffffff",
  border: "1px solid rgba(212, 175, 55, 0.26)",
  boxShadow: "0 14px 34px rgba(15,15,15,0.07)",
};
const panelHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  marginBottom: 12,
};
const sectionTitle: CSSProperties = { margin: "3px 0 0", fontSize: "1.45rem", letterSpacing: "-0.025em" };
const tableWrap: CSSProperties = { overflowX: "auto" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", minWidth: 980 };
const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e2e8f0",
  color: "#64748b",
  fontSize: 12,
};
const td: CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
  fontSize: 13,
};

const actionGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 6,
  minWidth: 270,
};

const actionBtn: CSSProperties = {
  minHeight: 32,
  padding: "7px 9px",
  borderRadius: 999,
  border: "1px solid rgba(212, 175, 55, 0.34)",
  background: "linear-gradient(180deg, #ffffff, #fffaf0)",
  color: "#8b6b16",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

const paginationBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 14,
};

const pageSizeControl: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#64748b",
  fontSize: 12,
  fontWeight: 800,
};

const paginationActions: CSSProperties = { display: "flex", gap: 8 };

const pageBtn: CSSProperties = {
  ...actionBtn,
  minWidth: 92,
};

const notice: CSSProperties = {
  marginBottom: 12,
  padding: "10px 12px",
  borderRadius: 14,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  color: "#9a3412",
  fontSize: 12,
  fontWeight: 800,
};

const emptyState: CSSProperties = {
  padding: 18,
  borderRadius: 16,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#64748b",
  fontWeight: 800,
};

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(15, 23, 42, 0.48)",
};

const modalCard: CSSProperties = {
  width: "min(720px, 100%)",
  maxHeight: "86vh",
  overflow: "auto",
  padding: 20,
  borderRadius: 24,
  background: "#ffffff",
  boxShadow: "0 28px 80px rgba(15, 23, 42, 0.24)",
  border: "1px solid rgba(212, 175, 55, 0.28)",
};

const modalHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 14,
};

const closeBtn: CSSProperties = {
  ...actionBtn,
  background: "#111827",
  borderColor: "#111827",
  color: "#ffffff",
};

const phonePreview: CSSProperties = {
  padding: 16,
  borderRadius: 20,
  background: "linear-gradient(135deg, #ecfdf5, #ffffff)",
  border: "1px solid rgba(16, 185, 129, 0.24)",
};

const previewLabel: CSSProperties = {
  margin: "0 0 10px",
  color: "#047857",
  fontSize: 12,
  fontWeight: 900,
};

const messagePreview: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  fontFamily: "inherit",
  color: "#064e3b",
  fontWeight: 800,
  lineHeight: 1.55,
};

const detailGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const detailItem: CSSProperties = {
  display: "grid",
  gap: 5,
  padding: 12,
  borderRadius: 14,
  background: "#fffdf7",
  border: "1px solid rgba(212, 175, 55, 0.2)",
  fontSize: 12,
  color: "#64748b",
};

const learnerDetailList: CSSProperties = {
  display: "grid",
  gap: 4,
  color: "#111827",
};

const planList: CSSProperties = { display: "grid", gap: 10 };

const planCard: CSSProperties = {
  display: "grid",
  gap: 6,
  padding: 14,
  borderRadius: 16,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#1f2937",
  fontSize: 13,
};

const statusIcon: CSSProperties = {
  width: 46,
  height: 46,
  display: "grid",
  placeItems: "center",
  borderRadius: 16,
  background: "rgba(255,255,255,0.2)",
  border: "1px solid rgba(255,255,255,0.22)",
  color: "#fff",
  fontSize: 22,
  fontWeight: 1000,
  marginBottom: 16,
};

const statusLabel: CSSProperties = {
  display: "block",
  color: "rgba(255,255,255,0.86)",
  fontSize: 12,
  fontWeight: 1000,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const statusCount: CSSProperties = {
  display: "block",
  marginTop: 8,
  color: "#ffffff",
  fontSize: "3.2rem",
  lineHeight: 0.95,
  letterSpacing: "-0.05em",
};

const statusAmount: CSSProperties = {
  display: "block",
  marginTop: 10,
  color: "rgba(255,255,255,0.82)",
  fontSize: 13,
  fontWeight: 800,
};

function statusIconFor(bucket: HealthBucket) {
  if (bucket === "Excellent") return "✓";
  if (bucket === "Needs Attention") return "!";
  if (bucket === "Action Required") return "⚠";
  return "!";
}

function displayHealthBucket(bucket: HealthBucket) {
  return bucket === "Excellent" ? "Healthy" : bucket;
}

function statusCardStyle(bucket: HealthBucket, active: boolean): CSSProperties {
  const gradients: Record<HealthBucket, string> = {
    Excellent: "linear-gradient(135deg, #065f46, #10b981)",
    "Needs Attention": "linear-gradient(135deg, #7c4a03, #d4af37)",
    "Action Required": "linear-gradient(135deg, #7c2d12, #ea580c)",
    Critical: "linear-gradient(135deg, #450a0a, #b91c1c)",
  };
  return {
    padding: 22,
    minHeight: 176,
    borderRadius: 24,
    background: gradients[bucket],
    border: "1px solid rgba(255,255,255,0.18)",
    boxShadow: "0 18px 46px rgba(15,15,15,0.13)",
    overflow: "hidden",
    position: "relative",
    textAlign: "left",
    cursor: "pointer",
    outline: active ? "3px solid rgba(17, 24, 39, 0.22)" : "none",
    transform: active ? "translateY(-2px)" : "none",
  };
}
