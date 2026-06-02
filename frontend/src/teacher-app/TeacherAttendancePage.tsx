import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { staffApiFetch } from "../staffApi";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";

type LearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  grade?: string;
  className?: string | null;
};
type MarkRow = {
  learnerId: string;
  status: string;
  reason?: string | null;
};

export default function TeacherAttendancePage() {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadingMarks, setLoadingMarks] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get("class");
    if (fromUrl) setClassName(fromUrl);
  }, [searchParams, setClassName]);

  useEffect(() => {
    if (!className) return;
    void (async () => {
      setLoadingMarks(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({ className, date });
        const data = (await staffApiFetch(`/api/teacher-app/attendance?${qs}`)) as {
          learners?: LearnerRow[];
          marks?: MarkRow[];
        };
        setLearners(data.learners || []);
        setMarks(data.marks || []);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not load attendance");
      } finally {
        setLoadingMarks(false);
      }
    })();
  }, [className, date]);

  const markByLearner = useMemo(() => {
    const map = new Map<string, MarkRow>();
    for (const m of marks) map.set(m.learnerId, m);
    return map;
  }, [marks]);

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">Attendance</h1>
      <p className="teacher-muted">
        View attendance for your assigned classes. All assigned teachers see the same register.
      </p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {noAssigned && <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>}

      {!noAssigned && (
        <>
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
                  {c.name} ({c.learnerCount} learners)
                </option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </>
      )}

      {loadingMarks && className ? <p className="teacher-muted">Loading attendance…</p> : null}

      {className && !loadingMarks ? (
        <ul className="teacher-record-list" style={{ marginTop: 16 }}>
          {learners.length === 0 ? (
            <li className="teacher-muted">No active learners in this class.</li>
          ) : (
            learners.map((l) => {
              const mark = markByLearner.get(l.id);
              return (
                <li key={l.id} className="teacher-record-card">
                  <strong>
                    {l.firstName} {l.lastName}
                  </strong>
                  <span className="teacher-muted">
                    {mark?.status || "Not marked"} · {l.grade || l.className || "—"}
                    {mark?.reason ? ` · ${mark.reason}` : ""}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
