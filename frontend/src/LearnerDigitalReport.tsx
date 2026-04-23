import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_URL, apiFetch } from "./api";
import educlearLogo from "./assets/logo.png";

type LearnerLike = Record<string, any>;
type SchoolLike = Record<string, any>;

type SubjectResult = {
  subject: string;
  mark: number;
  scoreText: string;
  comment: string;
};

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function badgeFromAverage(avg: number) {
  if (avg >= 80) return { label: "Excellent", bg: "#16a34a", fg: "#ffffff" };
  if (avg >= 65) return { label: "Good", bg: "#2563eb", fg: "#ffffff" };
  if (avg >= 50) return { label: "Average", bg: "#f59e0b", fg: "#0f172a" };
  return { label: "Needs Support", bg: "#dc2626", fg: "#ffffff" };
}

function guessOverallAverage(results: SubjectResult[]) {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + (Number.isFinite(r.mark) ? r.mark : 0), 0);
  return Math.round((sum / results.length) * 10) / 10;
}

const placeholderResults: SubjectResult[] = [
  { subject: "English Home Language", mark: 72, scoreText: "72%", comment: "Result data not yet connected" },
  { subject: "Mathematics", mark: 64, scoreText: "64%", comment: "Result data not yet connected" },
  { subject: "Natural Sciences", mark: 70, scoreText: "70%", comment: "Result data not yet connected" },
  { subject: "Social Sciences", mark: 61, scoreText: "61%", comment: "Result data not yet connected" },
  { subject: "Life Orientation", mark: 78, scoreText: "78%", comment: "Result data not yet connected" },
  { subject: "Technology", mark: 66, scoreText: "66%", comment: "Result data not yet connected" },
  { subject: "Creative Arts", mark: 75, scoreText: "75%", comment: "Result data not yet connected" },
];

export default function LearnerDigitalReport() {
  const { learnerId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [learner, setLearner] = useState<LearnerLike | null>(null);
  const [school, setSchool] = useState<SchoolLike | null>(null);
  const [error, setError] = useState("");

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
        if (!cancelled) setError(e?.message || "Failed to load report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [learnerId]);

  const schoolName = safeString(school?.schoolName || school?.name, "EduClear");
  const schoolLogo =
    school?.logoUrl ||
    school?.logo ||
    school?.logoPath ||
    (school?.logoFilename ? `${API_URL}/uploads/${school.logoFilename}` : null) ||
    educlearLogo;

  const learnerName = useMemo(() => {
    const first = learner?.firstName || learner?.name || "";
    const last = learner?.lastName || learner?.surname || "";
    return safeString(`${first} ${last}`.trim(), "Learner");
  }, [learner]);

  const gradeOrClass = safeString(learner?.grade || learner?.className || learner?.classroom);

  // Results: use placeholders until API is connected. If data exists later, it will render.
  const subjectResults: SubjectResult[] = useMemo(() => {
    const raw = learner?.results || learner?.subjectResults || learner?.subjects || null;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw
        .map((r: any) => ({
          subject: safeString(r.subject || r.subjectName || r.name, "Subject"),
          mark: clamp(Number(r.mark ?? r.score ?? r.percentage ?? 0) || 0, 0, 100),
          scoreText: safeString(r.scoreText || r.percentageText || `${clamp(Number(r.mark ?? r.score ?? r.percentage ?? 0) || 0, 0, 100)}%`),
          comment: safeString(r.comment || r.teacherComment, "—"),
        }))
        .slice(0, 12);
    }
    return placeholderResults;
  }, [learner]);

  const overallAverage = useMemo(() => {
    const v = learner?.overallAverage ?? learner?.average ?? null;
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return clamp(Math.round(n * 10) / 10, 0, 100);
    }
    return guessOverallAverage(subjectResults);
  }, [learner, subjectResults]);

  const performanceBadge = badgeFromAverage(overallAverage);
  const passStatus = overallAverage >= 50 ? "Promotion / Pass: Likely" : "Promotion / Pass: At Risk";

  return (
    <div style={{ minHeight: "100vh", background: "#f7f8fb" }}>
      <style>{`
        @media print {
          body { background: #ffffff !important; }
          .educlear-no-print { display: none !important; }
          .educlear-report-shell { padding: 0 !important; background: #ffffff !important; }
          .educlear-report-card { box-shadow: none !important; }
          .educlear-report-grid { gap: 10px !important; }
        }
      `}</style>

      <div className="educlear-report-shell" style={{ padding: "22px 18px 40px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div className="educlear-no-print" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => navigate(-1)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "#fff",
                color: "#0f172a",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => window.print()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(15,23,42,0.10)",
                  background: "#fff",
                  color: "#0f172a",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Print
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #0f172a, #1f2937)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.18)",
                }}
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => alert("WhatsApp sharing coming soon")}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #22c55e, #16a34a)",
                  color: "#ffffff",
                  fontWeight: 900,
                  cursor: "pointer",
                  boxShadow: "0 14px 35px rgba(34, 197, 94, 0.20)",
                }}
              >
                Share on WhatsApp
              </button>
            </div>
          </div>

          <div
            className="educlear-report-card"
            style={{
              background: "#ffffff",
              border: "1px solid rgba(15,23,42,0.08)",
              borderRadius: 18,
              boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "18px 18px 16px",
                borderBottom: "1px solid rgba(15,23,42,0.06)",
                background: "linear-gradient(180deg, #ffffff, #fbfdff)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <img
                    src={schoolLogo}
                    alt={schoolName}
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 14,
                      objectFit: "contain",
                      border: "1px solid rgba(15,23,42,0.08)",
                      background: "#fff",
                    }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = educlearLogo;
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 950, fontSize: 16, color: "#0f172a" }}>{schoolName}</div>
                    <div style={{ fontWeight: 900, fontSize: 22, color: "#0f172a", marginTop: 2 }}>Digital Learner Report</div>
                    <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
                      Reporting period: <span style={{ color: "#0f172a" }}>Term / Month (placeholder)</span>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "rgba(15, 23, 42, 0.04)",
                    border: "1px solid rgba(15,23,42,0.08)",
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#0f172a",
                  }}
                >
                  Generated: {new Date().toISOString().slice(0, 10)}
                </div>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: 18 }}>
              {loading ? (
                <div style={{ color: "#64748b", fontWeight: 700 }}>Loading report…</div>
              ) : error ? (
                <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div>
              ) : !learner ? (
                <div style={{ color: "#0f172a", fontWeight: 800 }}>
                  Learner not found. Please return to registrations and select a learner again.
                </div>
              ) : (
                <>
                  <div className="educlear-report-grid" style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 14 }}>
                    {/* Learner summary */}
                    <div style={{ gridColumn: "span 12" }}>
                      <div
                        style={{
                          borderRadius: 16,
                          border: "1px solid rgba(15,23,42,0.08)",
                          background: "#ffffff",
                          padding: 16,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 950, color: "#0f172a" }}>{learnerName}</div>
                            <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
                              Grade/Class: <span style={{ color: "#0f172a" }}>{gradeOrClass}</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ padding: "8px 10px", borderRadius: 12, background: "rgba(37, 99, 235, 0.08)", color: "#1d4ed8", fontWeight: 900, fontSize: 12 }}>
                              Admission No: {safeString(learner.admissionNumber || learner.admissionNo)}
                            </div>
                            <div style={{ padding: "8px 10px", borderRadius: 12, background: "rgba(15, 23, 42, 0.04)", color: "#0f172a", fontWeight: 900, fontSize: 12 }}>
                              Learner ID: {safeString(learner.id)}
                            </div>
                          </div>
                        </div>

                        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 10 }}>
                          {[
                            { label: "Gender", value: learner.gender },
                            { label: "Date of Birth", value: formatDate(learner.birthDate || learner.dateOfBirth) },
                            { label: "Home Language", value: learner.homeLanguage },
                            { label: "ID No", value: learner.idNo || learner.idNumber },
                          ].map((item) => (
                            <div key={item.label} style={{ gridColumn: "span 6", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>
                              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>{item.label}</div>
                              <div style={{ marginTop: 6, fontWeight: 850, color: "#0f172a" }}>{safeString(item.value)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Academic summary */}
                    <div style={{ gridColumn: "span 12" }}>
                      <div
                        style={{
                          borderRadius: 16,
                          border: "1px solid rgba(15,23,42,0.08)",
                          background: "linear-gradient(180deg, #ffffff, #fbfdff)",
                          padding: 16,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <div style={{ fontSize: 14, fontWeight: 950, color: "#0f172a" }}>Academic Summary</div>
                          <div style={{ padding: "7px 10px", borderRadius: 999, background: performanceBadge.bg, color: performanceBadge.fg, fontWeight: 950, fontSize: 12 }}>
                            {performanceBadge.label}
                          </div>
                        </div>

                        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 10 }}>
                          <div style={{ gridColumn: "span 6", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Overall average</div>
                            <div style={{ marginTop: 6, fontWeight: 950, color: "#0f172a", fontSize: 18 }}>{overallAverage}%</div>
                          </div>
                          <div style={{ gridColumn: "span 6", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Status</div>
                            <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>{passStatus}</div>
                          </div>
                          <div style={{ gridColumn: "span 12", padding: 12, borderRadius: 14, border: "1px dashed rgba(15,23,42,0.18)", background: "#fff" }}>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Attendance</div>
                            <div style={{ marginTop: 6, fontWeight: 850, color: "#0f172a" }}>
                              {safeString(learner.attendance, "Attendance data not yet connected")}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Subject results */}
                    <div style={{ gridColumn: "span 12" }}>
                      <div style={{ borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", background: "#fff", padding: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 950, color: "#0f172a" }}>Subject Results</div>
                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          {subjectResults.map((r) => (
                            <div
                              key={r.subject}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(0, 1.4fr) 90px 120px minmax(0, 2fr)",
                                gap: 10,
                                alignItems: "start",
                                padding: 12,
                                borderRadius: 14,
                                border: "1px solid rgba(15,23,42,0.08)",
                                background: "linear-gradient(180deg, #ffffff, #fbfdff)",
                              }}
                            >
                              <div style={{ fontWeight: 950, color: "#0f172a" }}>{r.subject}</div>
                              <div style={{ fontWeight: 950, color: "#0f172a", textAlign: "right" }}>{r.mark}</div>
                              <div style={{ fontWeight: 900, color: "#64748b", textAlign: "right" }}>{r.scoreText}</div>
                              <div style={{ color: "#0f172a", fontWeight: 650, lineHeight: 1.35 }}>{r.comment}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Remarks */}
                    <div style={{ gridColumn: "span 12" }}>
                      <div style={{ borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", background: "#fff", padding: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 950, color: "#0f172a" }}>Remarks</div>
                        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 10 }}>
                          <div style={{ gridColumn: "span 12", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Class teacher remark</div>
                            <div style={{ marginTop: 6, fontWeight: 650, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                              {safeString(learner.classTeacherRemark, "Class teacher remark not yet connected")}
                            </div>
                          </div>
                          <div style={{ gridColumn: "span 12", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>
                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Principal remark</div>
                            <div style={{ marginTop: 6, fontWeight: 650, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                              {safeString(learner.principalRemark, "Principal remark not yet connected")}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

