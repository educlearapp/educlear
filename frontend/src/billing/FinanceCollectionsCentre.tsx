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
  groupFinanceSnapshotsByHealth,
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
  const classifiedSnapshots = useMemo(() => uniqueAccountSnapshots(financeSnapshots), [financeSnapshots]);
  const healthGroups = useMemo(() => groupFinanceSnapshotsByHealth(classifiedSnapshots), [classifiedSnapshots]);
  const reviewSnapshots = useMemo(
    () =>
      classifiedSnapshots
        .filter((snapshot) => snapshot.summary.accountHealth !== "Excellent")
        .sort(compareReviewUrgency),
    [classifiedSnapshots]
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

  const totalOutstanding = classifiedSnapshots.reduce(
    (sum, row) => sum + Math.max(0, Number(row.summary.amountYouOwe) || 0),
    0
  );
  const categoryTotal = healthOrder.reduce((sum, bucket) => sum + healthGroups[bucket].length, 0);
  const arrangements = useMemo(() => (schoolId ? loadPaymentArrangements(schoolId) : []), [schoolId]);

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
          <strong>{formatFinanceMoney(totalOutstanding)}</strong>
          <small style={lightMuted}>{categoryTotal} classified accounts</small>
        </div>
      </div>

      <section style={grid}>
        {healthOrder.map((bucket) => (
          <div key={bucket} style={statusCardStyle(bucket)}>
            <div style={statusIcon}>{statusIconFor(bucket)}</div>
            <span style={statusLabel}>{displayHealthBucket(bucket)}</span>
            <strong style={statusCount}>{healthGroups[bucket].length}</strong>
            <small style={statusAmount}>{formatFinanceMoney(sumSnapshots(healthGroups[bucket]))}</small>
          </div>
        ))}
      </section>

      <section style={panel}>
        <div style={panelHeader}>
          <div>
            <p style={eyebrow}>Next action</p>
            <h2 style={sectionTitle}>Today&apos;s Finance Priorities</h2>
          </div>
          <span style={muted}>
            Sorted by urgency. Healthy accounts are hidden here unless reviewed from the Healthy card.
          </span>
        </div>
        {statementNotice ? <div style={notice}>{statementNotice}</div> : null}
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Account</th>
                <th style={th}>Parent</th>
                <th style={th}>Overdue Payments</th>
                <th style={th}>Status</th>
                <th style={th}>What should happen next?</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviewSnapshots
                .slice(0, 20)
                .map((snapshot) => {
                  const health = snapshot.summary.accountHealth;
                  return (
                    <tr key={`${snapshot.row.learnerId}-${snapshot.row.accountNo}`}>
                      <td style={td}>
                        <strong>{snapshot.row.accountNo || "No account"}</strong>
                        <small style={muted}>{snapshot.learnerName || "Learner"}</small>
                      </td>
                      <td style={td}>{snapshot.parentName}</td>
                      <td style={td}>{formatFinanceMoney(snapshot.summary.amountOverdue)}</td>
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
          {!reviewSnapshots.length ? (
            <div style={emptyState}>No urgent finance priorities. All accounts are currently Healthy.</div>
          ) : null}
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

function uniqueAccountSnapshots(snapshots: FinanceAccountSnapshot[]) {
  const byAccount = new Map<string, FinanceAccountSnapshot>();
  for (const snapshot of snapshots) {
    const key = accountSnapshotKey(snapshot);
    if (!key || byAccount.has(key)) continue;
    byAccount.set(key, snapshot);
  }
  return Array.from(byAccount.values());
}

function accountSnapshotKey(snapshot: FinanceAccountSnapshot) {
  const accountNo = String(snapshot.row.accountNo || "").trim();
  if (accountNo) return `account:${accountNo}`;
  const familyId = String(snapshot.row.familyAccountId || "").trim();
  if (familyId) return `family:${familyId}`;
  const learnerId = String(snapshot.row.learnerId || snapshot.row.id || "").trim();
  return learnerId ? `learner:${learnerId}` : "";
}

function compareReviewUrgency(a: FinanceAccountSnapshot, b: FinanceAccountSnapshot) {
  const healthDiff = reviewRank(a.summary.accountHealth) - reviewRank(b.summary.accountHealth);
  if (healthDiff !== 0) return healthDiff;
  const daysDiff = b.summary.oldestOutstandingDays - a.summary.oldestOutstandingDays;
  if (daysDiff !== 0) return daysDiff;
  return b.summary.amountOverdue - a.summary.amountOverdue;
}

function reviewRank(health: AccountHealth) {
  const index = reviewHealthOrder.indexOf(health);
  return index === -1 ? reviewHealthOrder.length : index;
}

function sumSnapshots(rows: FinanceAccountSnapshot[]) {
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.summary.amountYouOwe) || 0), 0);
}

function accountArrangements(snapshot: FinanceAccountSnapshot, arrangements: PaymentArrangement[]) {
  const learnerId = String(snapshot.row.learnerId || snapshot.row.id || "").trim();
  const accountNo = String(snapshot.row.accountNo || "").trim();
  return arrangements.filter(
    (arrangement) =>
      String(arrangement.learnerId || "").trim() === learnerId &&
      String(arrangement.accountNo || "").trim() === accountNo
  );
}

function financeUpdateMessage(snapshot: FinanceAccountSnapshot) {
  const summary = snapshot.summary;
  const learner = snapshot.learnerName || "your child";
  return [
    `Hi ${snapshot.parentName || "Parent"},`,
    `${learner}'s account is currently ${summary.accountHealth}.`,
    `Amount you owe: ${formatFinanceMoney(summary.amountYouOwe)}.`,
    `Overdue payments: ${formatFinanceMoney(summary.amountOverdue)}.`,
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
            <Detail label="Account" value={snapshot.row.accountNo || "No account"} />
            <Detail label="Parent" value={snapshot.parentName} />
            <Detail label="Learner" value={snapshot.learnerName} />
            <Detail label="Amount You Owe" value={formatFinanceMoney(snapshot.summary.amountYouOwe)} />
            <Detail label="Amount Overdue" value={formatFinanceMoney(snapshot.summary.amountOverdue)} />
            <Detail label="Health" value={snapshot.summary.accountHealth} />
            <Detail label="Oldest Outstanding" value={`${snapshot.summary.oldestOutstandingDays} days`} />
            <Detail label="Next Due Date" value={formatFinanceDate(snapshot.summary.nextSchoolFeeDueDate)} />
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

function statusCardStyle(bucket: HealthBucket): CSSProperties {
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
  };
}
