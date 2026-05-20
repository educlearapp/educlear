import { useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";

type Classroom = { id: string; name: string; learnerCount: number };
type Learner = { id: string; firstName: string; lastName: string; grade: string; admissionNo?: string | null };

export default function TeacherLearnersPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [className, setClassName] = useState("");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const me = (await staffApiFetch("/api/teacher-app/me")) as { classrooms?: Classroom[] };
        setClassrooms(me.classrooms || []);
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
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Load failed");
      }
    })();
  }, [className]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Learners</h1>
      <p className="teacher-muted">Only learners in your assigned classes are listed.</p>
      {err && <p className="teacher-error">{err}</p>}
      <div className="teacher-field">
        <label>Class</label>
        <select value={className} onChange={(e) => setClassName(e.target.value)}>
          <option value="">Select class</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name} ({c.learnerCount})
            </option>
          ))}
        </select>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {learners.map((l) => (
          <li
            key={l.id}
            style={{
              padding: "14px 16px",
              borderRadius: 14,
              border: "1px solid var(--t-border)",
              marginBottom: 10,
              background: "var(--t-panel)",
            }}
          >
            <strong>
              {l.firstName} {l.lastName}
            </strong>
            <div className="teacher-muted" style={{ marginTop: 4 }}>
              Grade {l.grade}
              {l.admissionNo ? ` · Adm ${l.admissionNo}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
