import { useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";
import TeacherVisibilitySelect, {
  visibilityBadge,
  type TeacherVisibility,
} from "./TeacherVisibilitySelect";

type Learner = { id: string; firstName: string; lastName: string; className: string | null };

export default function TeacherIncidentsPage() {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [learnerId, setLearnerId] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [subject, setSubject] = useState("Class incident");
  const [parentVisible, setParentVisible] = useState(true);
  const [notifyParent, setNotifyParent] = useState(true);
  const [visibility, setVisibility] = useState<TeacherVisibility>("CLASS_TEACHERS");
  const [listScope, setListScope] = useState<"all" | "mine" | "shared">("all");
  const [incidents, setIncidents] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadIncidents(scope = listScope) {
    try {
      const qs = scope !== "all" ? `?scope=${scope}` : "";
      const data = (await staffApiFetch(`/api/teacher-app/incidents${qs}`)) as { incidents?: unknown[] };
      setIncidents(data.incidents || []);
    } catch (e: unknown) {
      console.error("[teacher-app] Failed to load incidents:", e instanceof Error ? e.message : e);
    }
  }

  useEffect(() => {
    void loadIncidents(listScope);
  }, [listScope]);

  useEffect(() => {
    if (!className) {
      setLearners([]);
      setLearnerId("");
      return;
    }
    void (async () => {
      try {
        const qs = new URLSearchParams({ className });
        const data = (await staffApiFetch(`/api/teacher-app/learners?${qs}`)) as { learners?: Learner[] };
        setLearners(data.learners || []);
      } catch (e: unknown) {
        console.error("[teacher-app] Failed to load learners for incidents:", e instanceof Error ? e.message : e);
        setLearners([]);
      }
    })();
  }, [className]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setSubmitting(true);
    try {
      await staffApiFetch("/api/teacher-app/incidents", {
        method: "POST",
        body: JSON.stringify({
          learnerId,
          summary: summary.trim(),
          severity,
          subject: subject.trim() || "Class incident",
          parentVisible,
          notifyParent: parentVisible ? notifyParent : false,
          visibility,
        }),
      });
      setOk("Incident saved. Parents are notified when visible and “notify parent” is on.");
      setSummary("");
      setLearnerId("");
      void loadIncidents(listScope);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">Incidents</h1>
      <p className="teacher-muted">Parent-visible incidents notify linked parents through the Communication Engine.</p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {noAssigned && <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      {!noAssigned && (
        <form onSubmit={submit}>
          <div className="teacher-field">
            <label>Class</label>
            <select
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
              disabled={loading || classrooms.length === 0}
            >
              <option value="">{loading ? "Loading classes…" : "Select class"}</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Learner</label>
            <select value={learnerId} onChange={(e) => setLearnerId(e.target.value)} required disabled={!className}>
              <option value="">Select learner</option>
              {learners.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.firstName} {l.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Short subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="teacher-field">
            <label>Severity</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <div className="teacher-field">
            <label>Summary</label>
            <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} required />
          </div>
          <div className="teacher-field">
            <label className="teacher-check-label">
              <input type="checkbox" checked={parentVisible} onChange={(e) => setParentVisible(e.target.checked)} />
              Parent-visible
            </label>
          </div>
          {parentVisible && (
            <div className="teacher-field">
              <label className="teacher-check-label">
                <input type="checkbox" checked={notifyParent} onChange={(e) => setNotifyParent(e.target.checked)} />
                Notify parents (Communication Engine)
              </label>
            </div>
          )}
          <TeacherVisibilitySelect
            value={visibility}
            onChange={setVisibility}
            id="incident-visibility"
          />
          <div className="teacher-form-actions">
            <button type="submit" className="teacher-touch-btn primary" disabled={submitting || !className}>
              Save incident
            </button>
          </div>
        </form>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 24, marginBottom: 8, flexWrap: "wrap" }}>
        {(["all", "mine", "shared"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`teacher-touch-btn${listScope === s ? " primary" : ""}`}
            onClick={() => setListScope(s)}
          >
            {s === "all" ? "All visible" : s === "mine" ? "My incidents" : "Shared with teachers"}
          </button>
        ))}
      </div>
      <h2 className="teacher-section-title">Recent (your classes)</h2>
      <ul className="teacher-record-list">
        {(
          incidents as {
            id: string;
            summary: string;
            type: string;
            parentVisible: boolean;
            incidentDate: string;
            visibility?: string;
          }[]
        ).map((i) => (
          <li key={i.id} className="teacher-record-card">
            <strong>{i.type}</strong>
            {i.parentVisible ? "Visible to parents" : "Internal"} · {visibilityBadge(i.visibility)} ·{" "}
            {new Date(i.incidentDate).toLocaleString()}
              <div style={{ marginTop: 6 }}>
                {i.summary.slice(0, 120)}
                {i.summary.length > 120 ? "…" : ""}
              </div>
            </li>
          )
        )}
      </ul>
    </div>
  );
}
