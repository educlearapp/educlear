import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import logoIcon from "../assets/logo.icon.png";
import { EDUCLEAR_LEGAL_CONTACT } from "../components/legal/legalContact";
import {
  PAYMENT_RETURN_POLL_INTERVAL_MS,
  PAYMENT_RETURN_POLL_MAX_MS,
  clearPendingCheckout,
  paymentReturnCopy,
  readPendingCheckoutMerchantPaymentId,
  resolveReturnUiState,
  type PaymentReturnUiState,
} from "../subscriptions/paymentReturnStatus";
import {
  clearSubscriptionGateCache,
  fetchPaymentReturnStatus,
} from "../subscriptions/subscriptionsApi";

const GOLD = "#D4AF37";
const BG =
  "radial-gradient(circle at top, #151515 0%, #050505 55%, #000 100%)";

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: BG,
  color: "#fff",
  fontFamily: "Arial, sans-serif",
};

const main: React.CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "80px 24px 64px",
  textAlign: "center",
};

const card: React.CSSProperties = {
  marginTop: 32,
  borderRadius: 22,
  padding: "40px 32px",
  background:
    "linear-gradient(180deg, rgba(212,175,55,0.14) 0%, rgba(255,255,255,0.04) 100%)",
  border: "1px solid rgba(212,175,55,0.55)",
  boxShadow: "0 0 32px rgba(212,175,55,0.18), 0 24px 50px rgba(0,0,0,0.4)",
};

const primaryButton: React.CSSProperties = {
  marginTop: 28,
  padding: "14px 28px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.65)",
  background: "linear-gradient(180deg, #d4af37 0%, #b8941f 100%)",
  color: "#0a0a0a",
  fontWeight: 800,
  fontSize: 15,
  letterSpacing: 0.5,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  background: "transparent",
  color: "#fff",
  marginTop: 12,
};

/**
 * PayFast browser return page.
 * Does NOT trust URL alone — polls tenant-scoped backend payment/activation status.
 */
export default function BillingPaymentSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const schoolId = String(localStorage.getItem("schoolId") || "").trim();
  const [uiState, setUiState] = useState<PaymentReturnUiState>("loading");
  const [busy, setBusy] = useState(false);

  const merchantPaymentIdFromUrl = String(
    searchParams.get("merchantPaymentId") ||
      searchParams.get("m_payment_id") ||
      ""
  ).trim();

  const resolveMerchantPaymentId = useCallback((): string | null => {
    if (merchantPaymentIdFromUrl) return merchantPaymentIdFromUrl;
    return readPendingCheckoutMerchantPaymentId(schoolId);
  }, [merchantPaymentIdFromUrl, schoolId]);

  const refreshStatus = useCallback(async () => {
    if (!schoolId) {
      setUiState("unconfirmed");
      return;
    }
    setBusy(true);
    try {
      const merchantPaymentId = resolveMerchantPaymentId();
      const status = await fetchPaymentReturnStatus({
        schoolId,
        merchantPaymentId,
      });
      const next = resolveReturnUiState(status);
      setUiState(next);
      if (next === "activated") {
        clearSubscriptionGateCache();
        clearPendingCheckout();
      }
    } catch {
      // Auth / not found / network — never claim Active; never urge re-payment.
      setUiState((prev) => (prev === "activated" ? prev : "unconfirmed"));
    } finally {
      setBusy(false);
    }
  }, [resolveMerchantPaymentId, schoolId]);

  useEffect(() => {
    clearSubscriptionGateCache();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    const maxPolls = Math.ceil(PAYMENT_RETURN_POLL_MAX_MS / PAYMENT_RETURN_POLL_INTERVAL_MS);

    async function tick() {
      if (cancelled) return;
      await refreshStatus();
      polls += 1;
    }

    void tick();
    const timer = window.setInterval(() => {
      if (cancelled) return;
      if (polls >= maxPolls) {
        window.clearInterval(timer);
        setUiState((prev) => (prev === "activated" ? prev : "unconfirmed"));
        return;
      }
      void (async () => {
        await refreshStatus();
        polls += 1;
        // Stop polling once activated.
        setUiState((prev) => {
          if (prev === "activated") {
            window.clearInterval(timer);
          }
          return prev;
        });
      })();
    }, PAYMENT_RETURN_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshStatus]);

  const displayState: PaymentReturnUiState =
    uiState === "loading" ? "pending" : uiState;
  const copy = paymentReturnCopy(displayState);
  const contactHref = `mailto:${EDUCLEAR_LEGAL_CONTACT.email}?subject=${encodeURIComponent(
    "EduClear payment confirmation"
  )}`;

  return (
    <div style={pageShell} data-testid="billing-payment-return">
      <main style={main}>
        <img
          src={logoIcon}
          alt="EduClear"
          style={{ width: 88, height: 88, objectFit: "contain" }}
        />
        <div style={card} data-testid={`payment-return-${displayState}`}>
          <h1 style={{ margin: "0 0 16px", fontSize: 28, color: GOLD }}>{copy.title}</h1>
          <p
            style={{
              margin: 0,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.88)",
              fontSize: 17,
            }}
          >
            {uiState === "loading"
              ? "We're confirming your EduClear subscription. This usually only takes a few moments."
              : copy.body}
          </p>
          {copy.showDashboardCta ? (
            <button
              type="button"
              style={primaryButton}
              data-testid="payment-return-dashboard"
              onClick={() => navigate("/dashboard")}
            >
              Go to Dashboard
            </button>
          ) : null}
          {copy.showRefreshCta ? (
            <button
              type="button"
              style={primaryButton}
              data-testid="payment-return-refresh"
              disabled={busy}
              onClick={() => void refreshStatus()}
            >
              {busy ? "Checking…" : "Refresh status"}
            </button>
          ) : null}
          {copy.showContactCta ? (
            <a
              href={contactHref}
              style={{ ...secondaryButton, display: "inline-block", textDecoration: "none" }}
              data-testid="payment-return-contact"
            >
              Contact EduClear
            </a>
          ) : null}
        </div>
      </main>
    </div>
  );
}
