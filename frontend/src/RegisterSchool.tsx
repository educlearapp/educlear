import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import logo from "./assets/logo.png";

const gold = "#D4AF37";
const bg = "#070707";

function isValidEmail(email: string) {
  const e = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default function RegisterSchool() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    schoolName: "",
    contactPerson: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [status, setStatus] = useState<{ type: "idle" | "loading" | "error" | "success"; message?: string }>({
    type: "idle",
  });

  const canSubmit = useMemo(() => {
    if (!String(form.schoolName).trim()) return false;
    if (!String(form.contactPerson).trim()) return false;
    if (!isValidEmail(form.email)) return false;
    if (!String(form.phone).trim()) return false;
    if (String(form.password).length < 8) return false;
    if (form.password !== form.confirmPassword) return false;
    return true;
  }, [form]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ type: "loading", message: "Creating your school..." });

    try {
      await apiFetch("/auth/school/register", {
        method: "POST",
        body: JSON.stringify({
          schoolName: form.schoolName,
          contactPerson: form.contactPerson,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      });
      setStatus({ type: "success", message: "Registration successful. You can now log in." });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message || "Registration failed" });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: bg, color: "#fff" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={logo} alt="EduClear" style={{ width: 46, height: 46, objectFit: "contain" }} />
            <div style={{ fontWeight: 900, letterSpacing: 0.4 }}>EduClear</div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => navigate("/")}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: "transparent",
                border: "1px solid rgba(212,175,55,0.35)",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: gold,
                border: `1px solid ${gold}`,
                color: "#151515",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Login
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 26 }}>
          <div>
            <h1 style={{ margin: "6px 0 10px", fontSize: 34, lineHeight: 1.1 }}>
              Register your school
              <br />
              <span style={{ color: gold }}>and create your admin account</span>
            </h1>
            <p style={{ color: "rgba(255,255,255,0.75)", lineHeight: 1.7, maxWidth: 430 }}>
              This creates a new school and a secure admin login. After registration, you’ll log in and then select
              your school to open the dashboard.
            </p>

            <div
              style={{
                marginTop: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.35)",
                borderRadius: 16,
                padding: 14,
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Password must be at least 8 characters. We’ll never show a default school on the public site.
            </div>
          </div>

          <div
            style={{
              border: "1px solid rgba(212,175,55,0.18)",
              background: "rgba(0,0,0,0.35)",
              borderRadius: 18,
              padding: 16,
            }}
          >
            <form onSubmit={submit}>
              {[
                { key: "schoolName", label: "School name", type: "text", autoComplete: "organization" },
                { key: "contactPerson", label: "Contact person", type: "text", autoComplete: "name" },
                { key: "email", label: "Email", type: "email", autoComplete: "username" },
                { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
                { key: "password", label: "Password", type: "password", autoComplete: "new-password" },
                { key: "confirmPassword", label: "Confirm password", type: "password", autoComplete: "new-password" },
              ].map((f) => (
                <div key={f.key} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 12, color: "rgba(255,255,255,0.9)", marginBottom: 6 }}>
                    {f.label}
                  </div>
                  <input
                    value={(form as any)[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    type={f.type as any}
                    autoComplete={f.autoComplete}
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#fff",
                      outline: "none",
                    }}
                  />
                </div>
              ))}

              {form.password && form.confirmPassword && form.password !== form.confirmPassword ? (
                <div style={{ margin: "4px 0 10px", color: "#ffb4b4", fontSize: 12, fontWeight: 800 }}>
                  Passwords do not match.
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit || status.type === "loading"}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: canSubmit ? gold : "rgba(212,175,55,0.35)",
                  border: `1px solid ${canSubmit ? gold : "rgba(212,175,55,0.35)"}`,
                  color: "#151515",
                  fontWeight: 950,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {status.type === "loading" ? "Registering..." : "Register Your School"}
              </button>

              {status.type !== "idle" ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.35)",
                    color:
                      status.type === "success"
                        ? "rgba(210, 255, 210, 0.95)"
                        : status.type === "error"
                          ? "rgba(255, 200, 200, 0.95)"
                          : "rgba(255,255,255,0.8)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    fontWeight: 750,
                  }}
                >
                  {status.message}
                  {status.type === "success" ? (
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => navigate("/login")}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 12,
                          background: "transparent",
                          border: "1px solid rgba(212,175,55,0.55)",
                          color: "#fff",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Go to Login
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

