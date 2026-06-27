import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ParentFinanceHub from "../parent/ParentFinanceHub";
import "../parent/parentPortal.css";
import { fetchBillingSettings } from "../billingSettings/billingSettingsApi";
import { createDefaultBillingSettings } from "../billingSettings/components/billingSettingsConstants";
import type { BillingAccountRow } from "./billingLedger";
import {
  formatFinanceDate,
  formatFinanceMoney,
  type AccountHealth,
  type FinancePolicySettings,
} from "../finance/financePolicy";
import {
  buildFinanceAccountSnapshots,
  groupFinanceSnapshotsByHealth,
  type FinanceAccountSnapshot,
} from "../finance/financeAccountEngine";
import { downloadSchoolStatementPdf } from "./statementDocument";
import { DEFAULT_STATEMENT_PERIOD, buildStatementPdfFilename } from "./statementPeriod";

type Props = {
  schoolId: string;
  learners: unknown[];
  statementRows: BillingAccountRow[];
  schoolName: string;
  onOpenPolicySettings: () => void;
  onOpenCollections: () => void;
};

const healthTabs: AccountHealth[] = ["Excellent", "Needs Attention", "Action Required", "Critical"];

export default function FinanceHubPage({
  schoolId,
  learners,
  statementRows,
  schoolName,
  onOpenPolicySettings,
  onOpenCollections,
}: Props) {
  const [policy, setPolicy] = useState<FinancePolicySettings>(
    createDefaultBillingSettings().financePolicy
  );
  const [activeHealth, setActiveHealth] = useState<AccountHealth>("Excellent");
  const [statementBusyAccount, setStatementBusyAccount] = useState("");
  const [statementNotice, setStatementNotice] = useState("");

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

  const snapshots = useMemo(
    () =>
      buildFinanceAccountSnapshots({
        schoolId,
        learners,
        statementRows,
        policy,
      }),
    [schoolId, learners, statementRows, policy]
  );
  const groups = useMemo(() => groupFinanceSnapshotsByHealth(snapshots), [snapshots]);
  const selectedSnapshot = groups[activeHealth][0] || snapshots[0] || null;

  const handleDownloadStatement = async (snapshot: FinanceAccountSnapshot) => {
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
      setStatementNotice(`Latest statement downloaded for account ${accountNo}.`);
    } catch (error) {
      setStatementNotice(error instanceof Error ? error.message : "Failed to download statement.");
    } finally {
      setStatementBusyAccount("");
    }
  };

  return (
    <div style={page}>
      <section style={header}>
        <div>
          <p style={eyebrow}>Finance Hub</p>
          <h1 style={title}>School-facing control and preview</h1>
          <p style={subtitle}>
            Preview what parents will see, check finance messages, and move quickly to policy settings or collections.
          </p>
        </div>
        <div style={headerActions}>
          <button type="button" style={goldBtn} onClick={onOpenPolicySettings}>
            Finance Policy Settings
          </button>
          <button type="button" style={outlineBtn} onClick={onOpenCollections}>
            Collections Centre
          </button>
        </div>
      </section>

      <section style={panel}>
        <div style={panelHeader}>
          <div>
            <p style={eyebrow}>Parent Finance Hub preview</p>
            <h2 style={sectionTitle}>Choose an account health view</h2>
          </div>
          <span style={muted}>{schoolName}</span>
        </div>
        <div style={tabs}>
          {healthTabs.map((health) => (
            <button
              key={health}
              type="button"
              style={activeHealth === health ? activeTab : tab}
              onClick={() => setActiveHealth(health)}
            >
              <span>{displayHealthBucket(health)}</span>
              <strong>{groups[health].length}</strong>
            </button>
          ))}
        </div>
      </section>

      <div style={contentGrid}>
        <section style={previewShell}>
          {selectedSnapshot ? (
            <ParentFinanceHub
              billing={selectedSnapshot.billing}
              loading={false}
              policy={policy}
              accountLabel={selectedSnapshot.row.accountNo || selectedSnapshot.learnerDisplayName}
              parentName={selectedSnapshot.parentGuardianName}
              learnerName={selectedSnapshot.learnerDisplayName}
              childrenOnAccount={selectedSnapshot.childrenOnAccount}
              summaryOverride={selectedSnapshot.summary}
              statementBusy={statementBusyAccount === String(selectedSnapshot.row.accountNo || "").trim()}
              statementNotice={
                statementNotice ||
                "School preview only. Parent data comes from billing accounts, statements, invoices, payments, payment plans, and finance policy settings."
              }
              onDownloadStatement={() => void handleDownloadStatement(selectedSnapshot)}
            />
          ) : (
            <div className="parent-portal-card parent-finance-empty">
              <h2>No billing accounts to preview yet</h2>
              <p>Sync statements or open Billing Accounts to load accounts into the Finance Hub preview.</p>
            </div>
          )}
        </section>

        <aside style={sidePanel}>
          <CommunicationPreview snapshot={selectedSnapshot} />
          <section style={linkCard}>
            <p style={eyebrow}>Quick links</p>
            <h3 style={smallTitle}>Next admin actions</h3>
            <button type="button" style={wideGoldBtn} onClick={onOpenPolicySettings}>
              Review Finance Policy Settings
            </button>
            <button type="button" style={wideOutlineBtn} onClick={onOpenCollections}>
              Open Collections Centre
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CommunicationPreview({ snapshot }: { snapshot: FinanceAccountSnapshot | null }) {
  const summary = snapshot?.summary;
  const isFamily = (snapshot?.childrenOnAccount.length || 0) > 1 || Boolean(snapshot?.row.familyAccountId);
  const subject = isFamily ? "Your family account" : `${snapshot?.learnerDisplayName || "Your child"}'s account`;
  const learnerList = snapshot?.learnerDisplayName || "";
  return (
    <section style={linkCard}>
      <p style={eyebrow}>Communication preview</p>
      <h3 style={smallTitle}>WhatsApp Finance Update preview</h3>
      <div style={phoneBubble}>
        <strong>Hi {snapshot?.parentGuardianName || "Parent"},</strong>
        {summary ? (
          <>
            <span>{subject} is currently {displayHealthBucket(summary.accountHealth)}.</span>
            {isFamily && learnerList ? <span>Learners: {learnerList}.</span> : null}
            <span>Total balance: {formatFinanceMoney(snapshot?.totalBalance || 0)}.</span>
            <span>Due now / overdue: {formatFinanceMoney(snapshot?.dueNow || 0)}.</span>
            <span>Monthly fee total: {formatFinanceMoney(snapshot?.monthlyFeeTotal || 0)}.</span>
            <span>Next school fee due: {formatFinanceDate(summary.nextSchoolFeeDueDate)}.</span>
            <span>{summary.nextAction}</span>
          </>
        ) : (
          <span>Select an account to preview the parent finance message.</span>
        )}
      </div>
      <p style={finePrint}>
        Preview only. Sending will be connected in the next communication phase.
      </p>
    </section>
  );
}

function displayHealthBucket(bucket: AccountHealth) {
  return bucket === "Excellent" ? "Healthy" : bucket;
}

const page: CSSProperties = { display: "grid", gap: 18 };
const header: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
  padding: 24,
  borderRadius: 28,
  background:
    "radial-gradient(circle at 88% 18%, rgba(247, 213, 106, 0.22), transparent 30%), linear-gradient(135deg, #0f0f0f, #241b0b)",
  color: "#fff",
  boxShadow: "0 24px 60px rgba(15,15,15,0.16)",
};
const eyebrow: CSSProperties = {
  margin: 0,
  color: "#d4af37",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
const title: CSSProperties = { margin: "5px 0 9px", fontSize: "2.25rem", letterSpacing: "-0.04em", lineHeight: 1 };
const subtitle: CSSProperties = { margin: 0, maxWidth: 680, color: "rgba(255,255,255,0.78)", fontWeight: 700, lineHeight: 1.5 };
const headerActions: CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" };
const goldBtn: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 999,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: "#111827",
  fontWeight: 900,
  cursor: "pointer",
};
const outlineBtn: CSSProperties = {
  ...goldBtn,
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.24)",
};
const panel: CSSProperties = {
  padding: 20,
  borderRadius: 22,
  background: "#ffffff",
  border: "1px solid rgba(212, 175, 55, 0.26)",
  boxShadow: "0 14px 34px rgba(15,15,15,0.07)",
};
const panelHeader: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 };
const sectionTitle: CSSProperties = { margin: "3px 0 0", fontSize: "1.45rem", letterSpacing: "-0.025em" };
const muted: CSSProperties = { color: "#64748b", fontSize: 12, fontWeight: 800 };
const tabs: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const tab: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  minHeight: 76,
  padding: 14,
  borderRadius: 18,
  border: "1px solid rgba(212, 175, 55, 0.25)",
  background: "#fffdf7",
  color: "#1d2736",
  textAlign: "left",
  fontWeight: 900,
  cursor: "pointer",
};
const activeTab: CSSProperties = {
  ...tab,
  color: "#ffffff",
  background: "linear-gradient(135deg, #111827, #6f5416)",
  boxShadow: "0 14px 30px rgba(15,15,15,0.14)",
};
const contentGrid: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 18, alignItems: "start" };
const previewShell: CSSProperties = { minWidth: 0 };
const sidePanel: CSSProperties = { display: "grid", gap: 14 };
const linkCard: CSSProperties = {
  padding: 18,
  borderRadius: 22,
  background: "#ffffff",
  border: "1px solid rgba(212, 175, 55, 0.26)",
  boxShadow: "0 14px 34px rgba(15,15,15,0.07)",
};
const smallTitle: CSSProperties = { margin: "5px 0 14px", fontSize: "1.15rem", letterSpacing: "-0.02em" };
const phoneBubble: CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 14,
  borderRadius: 18,
  background: "linear-gradient(135deg, #ecfdf5, #ffffff)",
  border: "1px solid rgba(16, 185, 129, 0.22)",
  color: "#064e3b",
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.45,
};
const finePrint: CSSProperties = { margin: "10px 0 0", color: "#64748b", fontSize: 12, fontWeight: 700, lineHeight: 1.4 };
const wideGoldBtn: CSSProperties = { ...goldBtn, width: "100%", marginTop: 2 };
const wideOutlineBtn: CSSProperties = {
  ...wideGoldBtn,
  marginTop: 10,
  background: "#fff",
  color: "#8b6b16",
};
