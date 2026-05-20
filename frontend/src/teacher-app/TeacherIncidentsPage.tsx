import { useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";

type Classroom = { id: string; name: string };
type Learner = { id: string; firstName: string; lastName: string; className: string | null };

export default function TeacherIncidentsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [className, setClassName] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [learnerId, setLearnerId] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [subject, setSubject] = useState("Class incident");
  const [parentVisible, setParentVisible] = useState(true);
  const [notifyParent, setNotifyParent] = useState(true);
  const [incidents, setIncidents] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadIncidents() {
    const data = (await staffApiFetch("/api/teacher-app/incidents")) as { incidents?: unknown[] };
    setIncidents(data.incidents || []);
  }

  useEffect(() => {
    void (async () => {
      try {
        const me = (await staffApiFetch("/api/teacher-app/me")) as { classrooms?: (Classroom & { learnerCount?: number })[] };
        setClassrooms(me.classrooms || []);
        await loadIncidents();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Load failed");
      }
    })();
  }, []);

  useEffect(() => {
    if (!className) {
      setLearners([]);
      return;
    }
    void (async () => {
      try {
        const qs = new URLSearchParams({ className });
        const data = (await staffApiFetch(`/api/teacher-app/learners?${qs}`)) as { learners?: Learner[] };
        setLearners(data.learners || []);
      } catch {
        setLearners([]);
      }
    })();
  }, [className]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setLoading(true);
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
        }),
      });
      setOk("Incident saved. Parents are notified when visible and “notify parent” is on.");
      setSummary("");
      setLearnerId("");
      void loadIncidents();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Incidents</h1>
      <p className="teacher-muted">Parent-visible incidents notify linked parents through the Communication Engine.</p>
      {err && <p className="teacher-error">{err}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      <form onSubmit={submit}>
        <div className="teacher-field">
          <label>Class</label>
          <select value={className} onChange={(e) => setClassName(e.target.value)} required>
            <option value="">Select class</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="teacher-field">
          <label>Learner</label>
          <select value={learnerId} onChange={(e) => setLearnerId(e.target.value)} required>
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
          <label style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <input type="checkbox" checked={parentVisible} onChange={(e) => setParentVisible(e.target.checked)} />
            Parent-visible
          </label>
        </div>
        {parentVisible && (
          <div className="teacher-field">
            <label style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={notifyParent} onChange={(e) => setNotifyParent(e.target.checked)} />
              Notify parents (Communication Engine)
            </label>
          </div>
        )}
        <button type="submit" className="teacher-touch-btn primary" disabled={loading}>
          Save incident
        </button>
      </form>
      <h2 style={{ marginTop: 32, fontSize: "1.1rem" }}>Recent (your classes)</h2>
      <ul className="teacher-muted" style={{ paddingLeft: 18 }}>
        {(incidents as { id: string; summary: string; type: string; parentVisible: boolean; incidentDate: string }[]).map(
          (i) => (
            <li key={i.id} style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--t-text)" }}>{i.type}</strong> · {i.parentVisible ? "visible" : "internal"} ·{" "}
              {new Date(i.incidentDate).toLocaleString()} — {i.summary.slice(0, 80)}
              {i.summary.length > 80 ? "…" : ""}
            </li>
          )
        )}
      </ul>
    </div>
  );
}
