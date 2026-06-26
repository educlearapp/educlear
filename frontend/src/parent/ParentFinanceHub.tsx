import { useMemo, useState } from "react";
import {
  buildFinanceHubSummary,
  DEFAULT_FINANCE_POLICY,
  formatFinanceDate,
  formatFinanceMoney,
  normaliseFinancePolicySettings,
  type FinancePolicySettings,
  type FinanceTransaction,
} from "../finance/financePolicy";

export type ParentFinanceBilling = {
  balance: number;
  accountRef: string;
  isFamilyAccount: boolean;
  learners: { id: string; firstName: string; lastName: string; grade: string }[];
  transactions: FinanceTransaction[];
};

type Props = {
  billing: ParentFinanceBilling | null;
  loading: boolean;
  policy?: FinancePolicySettings | null;
  accountLabel: string;
  parentName?: string;
  learnerName?: string;
  childrenOnAccount: { id: string; firstName: string; lastName: string; grade?: string }[];
  statementNotice?: string | null;
  statementBusy: boolean;
  onDownloadStatement: () => void;
};

type FinanceActionModal = "proof" | "history" | null;

const comingSoonMessage =
  "We are currently completing payment gateway approval. Secure online payments will be available soon. In the meantime, please continue making payments via EFT or your school's preferred payment method and upload your proof of payment through the Parent Portal.";

export default function ParentFinanceHub({
  billing,
  loading,
  policy,
  accountLabel,
  parentName = "Maria",
  learnerName,
  childrenOnAccount,
  statementNotice,
  statementBusy,
  onDownloadStatement,
}: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<FinanceActionModal>(null);
  const [showArrangementPage, setShowArrangementPage] = useState(false);
  const financePolicy = useMemo(
    () => normaliseFinancePolicySettings(policy || DEFAULT_FINANCE_POLICY),
    [policy]
  );
  const summary = useMemo(
    () =>
      buildFinanceHubSummary({
        transactions: billing?.transactions || [],
        balance: billing?.balance || 0,
        policy: financePolicy,
      }),
    [billing?.balance, billing?.transactions, financePolicy]
  );

  if (loading) {
    return (
      <div className="parent-finance-hub">
        <div className="parent-portal-card">
          <p className="parent-portal-muted" style={{ margin: 0 }}>
            Loading your finance summary...
          </p>
        </div>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="parent-finance-hub">
        <div className="parent-portal-card parent-finance-empty">
          <h2>Your Finance Hub</h2>
          <p>We could not load billing details right now. Please try again in a moment.</p>
        </div>
      </div>
    );
  }

  const healthClass = `parent-finance-health parent-finance-health--${summary.accountHealth
    .toLowerCase()
    .replace(/\s+/g, "-")}`;
  const childName = learnerName || childrenOnAccount[0]?.firstName || accountLabel || "your child";
  const accountSubject = childrenOnAccount.length > 1 || billing.isFamilyAccount ? "Your family account" : `${childName}'s account`;
  const arrangementSubject =
    childrenOnAccount.length > 1 || billing.isFamilyAccount ? "your family account" : `${childName}'s school fees`;
  const healthIcon = accountHealthIcon(summary.accountHealth);
  const paymentRows = billing.transactions
    .filter((row) => Number(row.amountIn) > 0)
    .slice()
    .reverse();

  if (showArrangementPage) {
    return (
      <PaymentArrangementPage
        summary={{
          amountYouOwe: summary.amountYouOwe,
          amountOverdue: summary.amountOverdue,
          settlementDeadlineDate: summary.settlementDeadlineDate,
        }}
        policy={financePolicy}
        childName={arrangementSubject}
        onBack={() => setShowArrangementPage(false)}
        onNotice={setNotice}
      />
    );
  }

  return (
    <div className="parent-finance-hub">
      <section className={healthClass} aria-label="Account Health">
        <div className="parent-finance-health-main">
          <div className="parent-finance-health-icon" aria-hidden>
            {healthIcon}
          </div>
          <div>
            <p className="parent-finance-greeting">{greetingForNow()}, {parentName} 👋</p>
            <h2>{accountSubject} is currently {summary.accountHealth}.</h2>
            <p>{summary.nextAction}</p>
          </div>
        </div>
        <div className="parent-finance-health-amount">
          <span>Amount You Owe</span>
          <strong>{formatFinanceMoney(summary.amountYouOwe)}</strong>
        </div>
      </section>

      {notice ? (
        <div className="parent-finance-message" role="status">
          <button type="button" aria-label="Close message" onClick={() => setNotice(null)}>
            x
          </button>
          {notice}
        </div>
      ) : null}

      <section className="parent-portal-card">
        <div className="parent-finance-section-head">
          <div>
            <div className="parent-finance-eyebrow">What you need to know</div>
            <h3>Here&apos;s where your account stands</h3>
          </div>
          <span>{billing.accountRef ? `Ref ${billing.accountRef}` : accountLabel}</span>
        </div>
        {childrenOnAccount.length > 1 ? (
          <div className="parent-finance-family">
            <strong>Children on this account</strong>
            <span>
              {childrenOnAccount
                .map((child) => `${child.firstName} ${child.lastName}`.trim())
                .filter(Boolean)
                .join(", ")}
            </span>
          </div>
        ) : null}
        <div className="parent-finance-summary-grid">
          <FinanceMetric label="Amount You Owe" value={formatFinanceMoney(summary.amountYouOwe)} tone="strong" />
          <FinanceMetric label="Current Month Fees" value={formatFinanceMoney(summary.currentMonthFees)} />
          <FinanceMetric label="Amount Overdue" value={formatFinanceMoney(summary.amountOverdue)} tone="warning" />
          <FinanceMetric
            label="Last Payment"
            value={
              summary.lastPaymentAmount
                ? `${formatFinanceMoney(summary.lastPaymentAmount)} on ${formatFinanceDate(summary.lastPaymentDate)}`
                : "No payments yet"
            }
          />
          <FinanceMetric label="Next School Fee Due" value={formatFinanceDate(summary.nextSchoolFeeDueDate)} />
          <FinanceMetric label="School Settlement Deadline" value={formatFinanceDate(summary.settlementDeadlineDate)} />
        </div>
      </section>

      <section className="parent-portal-card">
        <div className="parent-finance-section-head">
          <div>
            <div className="parent-finance-eyebrow">Where you are</div>
            <h3>Finance Timeline</h3>
          </div>
          <span>Due day {financePolicy.monthlyFeeDueDay}</span>
        </div>
        <div className="parent-finance-timeline">
          {summary.months.map((month) => (
            <div key={month.key} className={`parent-finance-month parent-finance-month--${month.status.toLowerCase()}`}>
              <div>
                <strong>{month.label}</strong>
                <span>{timelineStatusLabel(month.status)}</span>
              </div>
              <small>
                Due {formatFinanceDate(month.dueDate)}
                {month.unpaid > 0 ? ` - ${formatFinanceMoney(month.unpaid)} outstanding` : ""}
              </small>
            </div>
          ))}
          <div className="parent-finance-month parent-finance-month--deadline">
            <div>
              <strong>School settlement deadline</strong>
              <span>🎯 {formatFinanceDate(summary.settlementDeadlineDate)}</span>
            </div>
            <small>Payment arrangements must finish before this date.</small>
          </div>
        </div>
      </section>

      <section className="parent-portal-card">
        <div className="parent-finance-section-head">
          <div>
            <div className="parent-finance-eyebrow">What to do next</div>
            <h3>What would you like to do today?</h3>
          </div>
        </div>
        <div className="parent-finance-actions">
          <button type="button" className="parent-finance-action-card parent-finance-action-card--primary" onClick={() => setNotice(comingSoonMessage)}>
            <span aria-hidden>💳</span>
            <strong>Pay Now</strong>
            <small>Secure online payments coming soon</small>
          </button>
          <button
            type="button"
            className="parent-finance-action-card"
            disabled={statementBusy}
            onClick={onDownloadStatement}
          >
            <span aria-hidden>📄</span>
            <strong>{statementBusy ? "Preparing..." : "Statement"}</strong>
            <small>Download your latest statement</small>
          </button>
          <button
            type="button"
            className="parent-finance-action-card"
            onClick={() => setActionModal("proof")}
          >
            <span aria-hidden>📤</span>
            <strong>Upload Proof</strong>
            <small>Share EFT confirmation</small>
          </button>
          <button
            type="button"
            className="parent-finance-action-card"
            onClick={() => setActionModal("history")}
          >
            <span aria-hidden>📜</span>
            <strong>Payment History</strong>
            <small>View recent payments</small>
          </button>
        </div>
        {summary.showArrangementButton ? (
          <button
            type="button"
            className="parent-finance-arrangement-btn"
            onClick={() => setShowArrangementPage(true)}
          >
            Request a Payment Plan
          </button>
        ) : (
          <p className="parent-portal-muted parent-finance-arrangement-note">{summary.arrangementReason}</p>
        )}
        {statementNotice ? <p className="parent-portal-muted parent-finance-arrangement-note">{statementNotice}</p> : null}
      </section>

      {actionModal ? (
        <FinanceActionDialog
          kind={actionModal}
          accountRef={billing.accountRef || accountLabel}
          learnerName={learnerName || childName}
          paymentRows={paymentRows}
          onClose={() => setActionModal(null)}
        />
      ) : null}
    </div>
  );
}

function FinanceActionDialog({
  kind,
  accountRef,
  learnerName,
  paymentRows,
  onClose,
}: {
  kind: Exclude<FinanceActionModal, null>;
  accountRef: string;
  learnerName: string;
  paymentRows: FinanceTransaction[];
  onClose: () => void;
}) {
  const title = kind === "proof" ? "Upload Proof of Payment" : "Payment History";
  return (
    <div className="parent-finance-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="parent-finance-modal-card">
        <div className="parent-finance-modal-head">
          <div>
            <div className="parent-finance-eyebrow">Account {accountRef || "billing account"}</div>
            <h3>{title}</h3>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {kind === "proof" ? (
          <div className="parent-finance-proof-flow">
            <p className="parent-portal-muted">
              Upload proof for {learnerName || "this account"}. This will be linked to account {accountRef || "billing account"}.
            </p>
            <label>
              Proof of payment file
              <input type="file" accept="image/*,.pdf" />
            </label>
            <label>
              Payment reference
              <input type="text" placeholder={`Reference for ${accountRef || "account"}`} />
            </label>
            <p className="parent-portal-muted">
              The file picker is scoped to this account. Submitting proof to the finance office will be enabled once the review endpoint is available.
            </p>
          </div>
        ) : (
          <div className="parent-finance-history">
            {paymentRows.length ? (
              paymentRows.map((row) => (
                <div key={row.id} className="parent-finance-history-row">
                  <div>
                    <strong>{formatFinanceMoney(row.amountIn)}</strong>
                    <span>{row.description || row.reference || "Payment"}</span>
                  </div>
                  <small>{formatFinanceDate(row.date)}</small>
                </div>
              ))
            ) : (
              <p className="parent-portal-muted">No payments to show yet for account {accountRef || "billing account"}.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FinanceMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "strong" | "warning";
}) {
  return (
    <div className={`parent-finance-metric${tone ? ` parent-finance-metric--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaymentArrangementPage({
  summary,
  policy,
  childName,
  onBack,
  onNotice,
}: {
  summary: {
    amountYouOwe: number;
    amountOverdue: number;
    settlementDeadlineDate: string;
  };
  policy: FinancePolicySettings;
  childName: string;
  onBack: () => void;
  onNotice: (message: string | null) => void;
}) {
  const maxMonths = Math.min(6, policy.maximumArrangementDurationMonths);
  return (
    <div className="parent-finance-hub">
      <section className="parent-portal-card parent-finance-arrangement-page">
        <button type="button" className="parent-finance-back-btn" onClick={onBack}>
          Back to Finance Hub
        </button>
        <div className="parent-finance-arrangement-hero">
          <div className="parent-finance-health-icon" aria-hidden>🤝</div>
          <div>
            <div className="parent-finance-eyebrow">Payment Plan</div>
            <h2>Let&apos;s help you get back on track.</h2>
            <p>
              If you need more time with {childName}, you can ask the school finance office to review a respectful payment plan.
            </p>
          </div>
        </div>

        <div className="parent-finance-summary-grid">
          <FinanceMetric label="Amount You Owe" value={formatFinanceMoney(summary.amountYouOwe)} tone="strong" />
          <FinanceMetric label="Overdue Payments" value={formatFinanceMoney(summary.amountOverdue)} tone="warning" />
          <FinanceMetric label="Must Finish Before" value={formatFinanceDate(summary.settlementDeadlineDate)} />
        </div>

        <div className="parent-finance-policy-list">
          <strong>What the school will check</strong>
          <span>Maximum duration: {maxMonths} month{maxMonths === 1 ? "" : "s"}</span>
          <span>Minimum upfront payment: {formatFinanceMoney(policy.minimumUpfrontPayment)}</span>
          <span>Minimum monthly payment: {formatFinanceMoney(policy.minimumMonthlyPayment)}</span>
          <span>{policy.requireApproval ? "School approval required" : "Approval not required"}</span>
          <span>
            {policy.requireSupportingDocuments
              ? "Supporting documents may be requested"
              : "Supporting documents are not required"}
          </span>
        </div>

        <div className="parent-finance-reassurance">
          Every payment plan request is reviewed individually. Submitting a request does not guarantee approval.
          Our finance office will carefully consider your request and contact you with the outcome.
        </div>

        <div className="parent-finance-arrangement-form">
          <label>
            Preferred upfront payment
            <input type="text" value={formatFinanceMoney(policy.minimumUpfrontPayment)} readOnly />
          </label>
          <label>
            Preferred monthly payment
            <input type="text" value={formatFinanceMoney(policy.minimumMonthlyPayment)} readOnly />
          </label>
          <label>
            Parent note
            <textarea readOnly value="I would like the school finance office to review a payment plan." />
          </label>
        </div>

        <button
          type="button"
          className="parent-portal-btn-primary parent-finance-submit-btn"
          onClick={() =>
            onNotice("Payment arrangement requests will be submitted to the school finance office once approvals are enabled.")
          }
        >
          Submit Request to Finance Office
        </button>
      </section>
    </div>
  );
}

function accountHealthIcon(status: string) {
  if (status === "Excellent") return "✓";
  if (status === "Needs Attention") return "!";
  if (status === "Action Required") return "⚠";
  return "!";
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function timelineStatusLabel(status: string) {
  if (status === "Paid") return "✅ Paid";
  if (status === "Outstanding") return "⚠ Outstanding";
  return "📅 Next School Fee Due";
}
