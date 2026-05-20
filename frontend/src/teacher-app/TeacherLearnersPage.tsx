import { useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";

type Learner = { id: string; firstName: string; lastName: string; grade: string; admissionNo?: string | null };

export default function TeacherLearnersPage() {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!className) {
      setLearners([]);
      return;
    }
    void (async () => {
      try {
        setErr(null);
        const qs = new URLSearchParams({ className });
        const data = (await staffApiFetch(`/api/teacher-app/learners?${qs}`)) as { learners?: Learner[] };
        setLearners(data.learners || []);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Load failed");
        setLearners([]);
      }
    })();
  }, [className]);

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">Learners</h1>
      <p className="teacher-muted">Only learners in your assigned classes are listed.</p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {noAssigned && <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>}
      {!noAssigned && (
        <div className="teacher-field">
          <label>Class</label>
          <select
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            disabled={loading || classrooms.length === 0}
          >
            <option value="">{loading ? "Loading classes…" : "Select class"}</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} ({c.learnerCount})
              </option>
            ))}
          </select>
        </div>
      )}
      <ul className="teacher-learner-list">
        {learners.map((l) => (
          <li key={l.id} className="teacher-learner-card">
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
