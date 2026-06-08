import { useNavigate } from "react-router-dom";

import logoIcon from "../assets/logo.icon.png";

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
  width: "100%",
  maxWidth: 280,
};

const secondaryButton: React.CSSProperties = {
  marginTop: 14,
  padding: "14px 28px",
  borderRadius: 12,
  border: "1px solid rgba(212,175,55,0.45)",
  background: "transparent",
  color: GOLD,
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: 0.5,
  cursor: "pointer",
  width: "100%",
  maxWidth: 280,
};

export default function BillingPaymentCancelled() {
  const navigate = useNavigate();

  return (
    <div style={pageShell}>
      <main style={main}>
        <img
          src={logoIcon}
          alt="EduClear"
          style={{ width: 88, height: 88, objectFit: "contain" }}
        />
        <div style={card}>
          <h1 style={{ margin: "0 0 16px", fontSize: 32, color: GOLD }}>Payment cancelled</h1>
          <p style={{ margin: 0, lineHeight: 1.6, color: "rgba(255,255,255,0.75)", fontSize: 16 }}>
            You can try again when you&apos;re ready.
          </p>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button
              type="button"
              style={primaryButton}
              onClick={() => navigate("/subscription/packages")}
            >
              Choose package
            </button>
            <button type="button" style={secondaryButton} onClick={() => navigate("/login")}>
              Back to login
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
