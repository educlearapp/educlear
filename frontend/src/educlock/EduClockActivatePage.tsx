import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { activateEduClock, fetchEduClockMe, type EduClockActivateResponse } from "./educlockApi";

const IDENTITY_TYPES = [
  { value: "SA_ID", label: "South African ID" },
  { value: "PASSPORT", label: "Passport" },
  { value: "PERMIT", label: "Permit" },
  { value: "OTHER", label: "Other" },
] as const;

export default function EduClockActivatePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [meStatus, setMeStatus] = useState<string>("");
  const [success, setSuccess] = useState<EduClockActivateResponse | null>(null);
  const [identityType, setIdentityType] = useState<string>("SA_ID");
  const [identityNumber, setIdentityNumber] = useState("");
  const [identityCountryCode, setIdentityCountryCode] = useState("ZA");
  const [activeSummary, setActiveSummary] = useState<{
    employeeName?: string;
    employeeNumber?: string;
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const schoolId = localStorage.getItem("schoolId");
    if (!token || !schoolId) {
      navigate("/educlock/login", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await fetchEduClockMe();
        if (cancelled) return;
        setMeStatus(me.status);
        if (me.status === "ACTIVE") {
          setActiveSummary({
            employeeName: me.employeeName,
            employeeNumber: me.employeeNumber,
          });
          navigate("/educlock/clock", { replace: true });
          return;
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load EduClock status");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    // Never persist identity numbers in storage — keep only in React state for this submit.
    try {
      const result = await activateEduClock({
        identityType,
        identityNumber: identityNumber.trim(),
        identityCountryCode:
          identityType === "PASSPORT" || identityType === "PERMIT" || identityType === "OTHER"
            ? identityCountryCode.trim().toUpperCase()
            : undefined,
      });
      setIdentityNumber("");
      setSuccess(result);
      setMeStatus("ACTIVE");
    } catch (err: unknown) {
      const anyErr = err as { message?: string; code?: string };
      setError(anyErr?.message || (err instanceof Error ? err.message : "Activation failed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="teacher-app-main" style={{ maxWidth: 480 }}>
        <h1 className="teacher-app-title">EduClock</h1>
        <p className="teacher-muted">Checking activation status…</p>
      </main>
    );
  }

  if (success) {
    return (
      <main className="teacher-app-main" style={{ maxWidth: 480 }}>
        <h1 className="teacher-app-title">EduClock activated</h1>
        <p className="teacher-muted">You can now clock in and out with email and password only.</p>
        <div style={{ marginTop: 16, lineHeight: 1.6 }}>
          <p>
            <strong>Employee:</strong> {success.employeeName}
          </p>
          <p>
            <strong>Employee number:</strong> {success.employeeNumber}
          </p>
          <p>
            <strong>Document:</strong> {success.identityMasked}
          </p>
        </div>
        <Link
          to="/educlock/clock"
          className="teacher-touch-btn primary"
          style={{ marginTop: 24, display: "inline-flex" }}
        >
          Open EduClock
        </Link>
      </main>
    );
  }

  if (meStatus === "ACTIVE" && activeSummary) {
    return (
      <main className="teacher-app-main" style={{ maxWidth: 480 }}>
        <h1 className="teacher-app-title">EduClock ready</h1>
        <p className="teacher-muted">Your account is already activated.</p>
        <div style={{ marginTop: 16, lineHeight: 1.6 }}>
          <p>
            <strong>Employee:</strong> {activeSummary.employeeName}
          </p>
          <p>
            <strong>Employee number:</strong> {activeSummary.employeeNumber}
          </p>
        </div>
        <Link
          to="/educlock/clock"
          className="teacher-touch-btn primary"
          style={{ marginTop: 24, display: "inline-flex" }}
        >
          Open EduClock
        </Link>
      </main>
    );
  }

  if (meStatus.startsWith("BLOCKED_")) {
    return (
      <main className="teacher-app-main" style={{ maxWidth: 480 }}>
        <h1 className="teacher-app-title">EduClock blocked</h1>
        <p className="teacher-error">
          Your staff link cannot be used for EduClock yet. Contact your school owner.
        </p>
        <p className="teacher-muted">Status: {meStatus}</p>
        <Link to="/educlock/login" className="teacher-touch-btn" style={{ marginTop: 16, display: "inline-flex" }}>
          Back to sign in
        </Link>
      </main>
    );
  }

  const needsCountry = identityType === "PASSPORT" || identityType === "PERMIT";

  return (
    <main className="teacher-app-main" style={{ maxWidth: 480 }}>
      <h1 className="teacher-app-title">Activate EduClock</h1>
      <p className="teacher-muted" style={{ marginBottom: 16 }}>
        First-time setup: verify your identity document. This is only required once. Your school owner manages
        employee numbers and links.
      </p>
      <form
        onSubmit={onSubmit}
        autoComplete="off"
        onKeyDown={(e) => {
          // Avoid accidental browser password-manager storage of ID numbers.
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            /* allow submit */
          }
        }}
      >
        <div className="teacher-field">
          <label htmlFor="ec-id-type">Document type</label>
          <select
            id="ec-id-type"
            value={identityType}
            onChange={(e) => setIdentityType(e.target.value)}
          >
            {IDENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {(needsCountry || identityType === "OTHER") && (
          <div className="teacher-field">
            <label htmlFor="ec-country">Country code {needsCountry ? "(required)" : "(optional)"}</label>
            <input
              id="ec-country"
              name="educlock-country"
              autoComplete="off"
              maxLength={2}
              value={identityCountryCode}
              onChange={(e) => setIdentityCountryCode(e.target.value.toUpperCase())}
              placeholder="ZA"
            />
          </div>
        )}
        <div className="teacher-field">
          <label htmlFor="ec-id-number">Document number</label>
          <input
            id="ec-id-number"
            name="educlock-identity"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={identityNumber}
            onChange={(e) => setIdentityNumber(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="teacher-touch-btn primary"
          disabled={submitting}
          style={{ width: "100%" }}
        >
          {submitting ? "Activating…" : "Activate EduClock"}
        </button>
      </form>
      {error && <p className="teacher-error">{error}</p>}
    </main>
  );
}
