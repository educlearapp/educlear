import { useNavigate } from "react-router-dom";
import logo from "./assets/logo.png";

const gold = "#D4AF37";
const bg = "#070707";

function Button({
  children,
  variant = "gold",
  onClick,
}: {
  children: React.ReactNode;
  variant?: "gold" | "ghost";
  onClick: () => void;
}) {
  const base: React.CSSProperties = {
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid transparent",
    fontWeight: 700,
    letterSpacing: 0.2,
    cursor: "pointer",
    fontSize: 15,
  };
  const styles =
    variant === "gold"
      ? ({ ...base, background: gold, color: "#151515", borderColor: gold } as const)
      : ({ ...base, background: "transparent", color: "#fff", borderColor: "rgba(212,175,55,0.5)" } as const);
  return (
    <button type="button" onClick={onClick} style={styles}>
      {children}
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(1200px 600px at 20% -10%, rgba(212,175,55,0.12), transparent 55%),
                     radial-gradient(1000px 700px at 90% 10%, rgba(212,175,55,0.08), transparent 60%),
                     ${bg}`,
        color: "#fff",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 60px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={logo} alt="EduClear" style={{ width: 54, height: 54, objectFit: "contain" }} />
            <div>
              <div style={{ fontWeight: 900, letterSpacing: 0.4, fontSize: 18 }}>EduClear</div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Modern school administration</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={() => navigate("/login")}>
              Login
            </Button>
            <Button onClick={() => navigate("/register")}>Register Your School</Button>
          </div>
        </div>

        <div style={{ paddingTop: 64, display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 18 }}>
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(212,175,55,0.35)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.9)",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Premium, secure, South Africa–ready
            </div>

            <h1 style={{ marginTop: 14, fontSize: 48, lineHeight: 1.05, marginBottom: 14 }}>
              Run your school with clarity.
              <br />
              <span style={{ color: gold }}>Administration, billing, communication</span>—in one place.
            </h1>

            <p style={{ color: "rgba(255,255,255,0.78)", fontSize: 16, lineHeight: 1.7, maxWidth: 640 }}>
              EduClear helps schools manage learners and parents, track fees and payments, and streamline day-to-day
              operations—without spreadsheets or messy paperwork.
            </p>

            <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
              <Button onClick={() => navigate("/register")}>Register Your School</Button>
              <Button variant="ghost" onClick={() => navigate("/login")}>
                Login
              </Button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 34 }}>
              {[
                { title: "Administration", text: "Learners, parents, records, and reporting—organized." },
                { title: "Billing", text: "Fees, invoices, statements, payments—tracked end-to-end." },
                { title: "Communication", text: "Keep families informed with clear, consistent messaging." },
              ].map((c) => (
                <div
                  key={c.title}
                  style={{
                    border: "1px solid rgba(212,175,55,0.18)",
                    background: "rgba(0,0,0,0.32)",
                    borderRadius: 16,
                    padding: "14px 14px",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#fff", marginBottom: 6 }}>{c.title}</div>
                  <div style={{ color: "rgba(255,255,255,0.74)", fontSize: 13, lineHeight: 1.5 }}>{c.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              border: "1px solid rgba(212,175,55,0.18)",
              background: "rgba(0,0,0,0.35)",
              borderRadius: 18,
              padding: 18,
              alignSelf: "start",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8, color: "rgba(255,255,255,0.92)" }}>
              Get started in minutes
            </div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 1.6 }}>
              Register your school, create your admin account, then log in to select your school and open the dashboard.
            </div>

            <div style={{ height: 14 }} />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button onClick={() => navigate("/register")}>Register Your School</Button>
              <Button variant="ghost" onClick={() => navigate("/login")}>
                Login
              </Button>
            </div>

            <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "rgba(255,255,255,0.85)" }}>No public dashboard</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", lineHeight: 1.6 }}>
                The dashboard is protected and only available after login and school selection.
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 52, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
          © {new Date().getFullYear()} EduClear. All rights reserved.
        </div>
      </div>
    </div>
  );
}

