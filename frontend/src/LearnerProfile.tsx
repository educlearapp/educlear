import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_URL, apiFetch } from "./api";
import educlearLogo from "./assets/educlear-logo.png";

type LearnerLike = Record<string, any>;
type SchoolLike = Record<string, any>;

function safeString(value: unknown, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s ? s : fallback;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

function formatAge(value: unknown) {
  if (!value) return "-";
  const dob = new Date(String(value));
  if (Number.isNaN(dob.getTime())) return "-";
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();
  if (today.getDate() < dob.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return "-";
  return `${years}y ${months}m`;
}

export default function LearnerProfile() {
  const { learnerId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [learner, setLearner] = useState<LearnerLike | null>(null);
  const [school, setSchool] = useState<SchoolLike | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const id = String(learnerId || "").trim();
        if (!id) {
          if (!cancelled) setError("Missing learner ID.");
          return;
        }

        // Fast path: use any previously selected learner if it matches.
        const fromLocalStorage = (() => {
          const keys = ["selectedLearnerForManage", "selectedLearnerForSibling"];
          for (const k of keys) {
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              if (String(parsed?.id || "") === id) return parsed;
            } catch {
              // ignore
            }
          }
          return null;
        })();

        if (fromLocalStorage) {
          if (!cancelled) setLearner(fromLocalStorage);
        } else {
          const data: any = await apiFetch("/api/learners");
          const list = Array.isArray(data?.learners) ? data.learners : [];
          const found = list.find((l: any) => String(l?.id || "") === id) || null;
          if (!cancelled) setLearner(found);
        }

        const schoolId = localStorage.getItem("schoolId");
        try {
          const schools = (await apiFetch("/api/schools")) as any;
          const list = Array.isArray(schools) ? schools : [];
          const match = schoolId
            ? list.find((s: any) => String(s?.id || "") === String(schoolId))
            : list[0];
          if (!cancelled) setSchool(match || null);
        } catch {
          if (!cancelled) setSchool(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load learner.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [learnerId]);

  const learnerName = useMemo(() => {
    const first = learner?.firstName || learner?.name || "";
    const last = learner?.lastName || learner?.surname || "";
    return safeString(`${first} ${last}`.trim(), "Learner");
  }, [learner]);

  const schoolName = safeString(school?.schoolName || school?.name, "EduClear");
  const schoolLogo =
    school?.logoUrl ||
    school?.logo ||
    school?.logoPath ||
    (school?.logoFilename ? `${API_URL}/uploads/${school.logoFilename}` : null) ||
    educlearLogo;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f8fb",
        padding: "22px 18px 40px",
      }}
    >
      <div
        style={{
          maxWidth: 1050,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <img
              src={schoolLogo}
              alt={schoolName}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                objectFit: "contain",
                border: "1px solid rgba(15,23,42,0.08)",
                background: "#fff",
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = educlearLogo;
              }}
            />
            <div>
              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                {schoolName}
              </div>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 600 }}>
                Learner Profile
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => navigate(-1)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "#fff",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => navigate(`/learners/${encodeURIComponent(String(learnerId || ""))}/report`)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg, #0f172a, #1f2937)",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 14px 35px rgba(15, 23, 42, 0.18)",
              }}
            >
              Generate Digital Report
            </button>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid rgba(15,23,42,0.08)",
            borderRadius: 18,
            padding: 18,
            boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
          }}
        >
          {loading ? (
            <div style={{ color: "#64748b", fontWeight: 600 }}>Loading learner…</div>
          ) : error ? (
            <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div>
          ) : !learner ? (
            <div style={{ color: "#0f172a", fontWeight: 700 }}>
              Learner not found. Please go back to registrations and select a learner again.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                    {learnerName}
                  </div>
                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700, fontSize: 13 }}>
                    Grade/Class: {safeString(learner.grade || learner.className || learner.classroom)}
                    {" · "}
                    Age: {formatAge(learner.birthDate)}
                  </div>
                </div>

                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "rgba(15, 23, 42, 0.04)",
                    border: "1px solid rgba(15,23,42,0.08)",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#0f172a",
                  }}
                >
                  Learner ID: {safeString(learner.id)}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                <div style={{ gridColumn: "span 12" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                      gap: 12,
                    }}
                  >
                    {[
                      { label: "Admission No", value: learner.admissionNumber || learner.admissionNo },
                      { label: "ID No", value: learner.idNo || learner.idNumber },
                      { label: "Gender", value: learner.gender },
                      { label: "Date of Birth", value: formatDate(learner.birthDate || learner.dateOfBirth) },
                      { label: "Home Language", value: learner.homeLanguage },
                      { label: "Nationality", value: learner.nationality },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          gridColumn: "span 6",
                          padding: 14,
                          borderRadius: 14,
                          border: "1px solid rgba(15,23,42,0.08)",
                          background: "#fff",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                          {item.label}
                        </div>
                        <div style={{ marginTop: 6, color: "#0f172a", fontWeight: 800 }}>
                          {safeString(item.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ gridColumn: "span 12" }}>
                  <div
                    style={{
                      marginTop: 4,
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid rgba(15,23,42,0.08)",
                      background: "linear-gradient(180deg, #ffffff, #fbfdff)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, marginBottom: 8 }}>
                      Notes
                    </div>
                    <div style={{ color: "#0f172a", fontWeight: 650, whiteSpace: "pre-wrap" }}>
                      {safeString(learner.notes, "No notes recorded.")}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

