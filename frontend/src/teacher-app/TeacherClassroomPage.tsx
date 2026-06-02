import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { staffApiFetch } from "../staffApi";
import { NO_ASSIGNED_CLASSROOMS_MSG } from "./useTeacherAssignedClassrooms";
import { visibilityBadge } from "./TeacherVisibilitySelect";

type HomeworkRow = {
  id: string;
  title: string;
  className?: string | null;
  createdAt: string;
  visibility?: string;
};
type NoticeRow = { id: string; title: string; publishedAt: string; visibility?: string };
type MessageRow = {
  id: string;
  updatedAt: string;
  learner?: { firstName?: string; lastName?: string };
  parent?: { firstName?: string; surname?: string };
};
type IncidentRow = {
  id: string;
  subject: string;
  incidentDate: string;
  visibility?: string;
  learner?: { firstName?: string; lastName?: string };
};
type TeacherRow = {
  teacherName: string;
  teacherEmail: string;
  role: string;
};

type OverviewResponse = {
  success?: boolean;
  error?: string;
  classroom?: {
    id: string;
    name: string;
    learnerCount: number;
    role: string;
    coTeacherCount: number;
    teachers: TeacherRow[];
  };
  myHomework?: HomeworkRow[];
  sharedHomework?: HomeworkRow[];
  sharedNotices?: NoticeRow[];
  myMessages?: MessageRow[];
  incidents?: IncidentRow[];
};

export default function TeacherClassroomPage() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classroomId) return;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = (await staffApiFetch(
          `/api/teacher-app/classroom/${encodeURIComponent(classroomId)}`
        )) as OverviewResponse;
        if (res.error) throw new Error(res.error);
        setData(res);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not load classroom");
      } finally {
        setLoading(false);
      }
    })();
  }, [classroomId]);

  if (!classroomId) {
    return <p className="teacher-error">Missing classroom</p>;
  }

  const room = data?.classroom;

  return (
    <div>
      <h1 className="teacher-page-heading">{room?.name || "Classroom"}</h1>
      {loading && <p className="teacher-muted">Loading classroom…</p>}
      {err && <p className="teacher-error">{err}</p>}
      {!loading && !err && !room && (
        <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>
      )}

      {room && (
        <>
          <p className="teacher-muted">
            {room.learnerCount} learners · Your role: {room.role.replace(/_/g, " ").toLowerCase()}
            {room.coTeacherCount > 0 ? ` · ${room.coTeacherCount + 1} teachers assigned` : ""}
          </p>

          {room.teachers?.length ? (
            <div className="teacher-card" style={{ marginTop: 12, marginBottom: 16 }}>
              <h2 className="teacher-section-title">Class teachers</h2>
              <ul className="teacher-record-list">
                {room.teachers.map((t) => (
                  <li key={t.teacherEmail} className="teacher-record-card">
                    <strong>{t.teacherName || t.teacherEmail}</strong>
                    <span className="teacher-muted">
                      {t.role.replace(/_/g, " ").toLowerCase()} · {t.teacherEmail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="teacher-card-grid" style={{ marginBottom: 20 }}>
            <Link className="teacher-dash-card" to={`/teacher/learners?class=${encodeURIComponent(room.name)}`}>
              <span className="icon">🎓</span>
              Learner list
            </Link>
            <Link
              className="teacher-dash-card"
              to={`/teacher/attendance?class=${encodeURIComponent(room.name)}`}
            >
              <span className="icon">📋</span>
              Attendance
            </Link>
            <Link className="teacher-dash-card" to="/teacher/inbox">
              <span className="icon">✉️</span>
              My messages
            </Link>
            <Link className="teacher-dash-card" to="/teacher/homework">
              <span className="icon">📝</span>
              Homework
            </Link>
          </div>

          <section style={{ marginBottom: 24 }}>
            <h2 className="teacher-section-title">My homework</h2>
            <ul className="teacher-record-list">
              {(data?.myHomework || []).length === 0 ? (
                <li className="teacher-muted">No homework posted by you yet.</li>
              ) : (
                (data?.myHomework || []).map((h) => (
                  <li key={h.id} className="teacher-record-card">
                    <strong>{h.title}</strong>
                    <span className="teacher-muted">
                      {visibilityBadge(h.visibility)} · {new Date(h.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="teacher-section-title">Shared class homework</h2>
            <ul className="teacher-record-list">
              {(data?.sharedHomework || []).length === 0 ? (
                <li className="teacher-muted">No shared homework from co-teachers.</li>
              ) : (
                (data?.sharedHomework || []).map((h) => (
                  <li key={h.id} className="teacher-record-card">
                    <strong>{h.title}</strong>
                    <span className="teacher-muted">{new Date(h.createdAt).toLocaleString()}</span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="teacher-section-title">Shared notices</h2>
            <ul className="teacher-record-list">
              {(data?.sharedNotices || []).length === 0 ? (
                <li className="teacher-muted">No shared class notices.</li>
              ) : (
                (data?.sharedNotices || []).map((n) => (
                  <li key={n.id} className="teacher-record-card">
                    <strong>{n.title}</strong>
                    <span className="teacher-muted">{new Date(n.publishedAt).toLocaleString()}</span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="teacher-section-title">My messages</h2>
            <ul className="teacher-record-list">
              {(data?.myMessages || []).length === 0 ? (
                <li className="teacher-muted">No parent threads assigned to you for this class.</li>
              ) : (
                (data?.myMessages || []).map((m) => (
                  <li key={m.id} className="teacher-record-card">
                    <strong>
                      {m.learner?.firstName} {m.learner?.lastName}
                    </strong>
                    <span className="teacher-muted">
                      Parent: {m.parent?.firstName} {m.parent?.surname} ·{" "}
                      {new Date(m.updatedAt).toLocaleString()}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section>
            <h2 className="teacher-section-title">Incidents</h2>
            <ul className="teacher-record-list">
              {(data?.incidents || []).length === 0 ? (
                <li className="teacher-muted">No incidents visible for this class.</li>
              ) : (
                (data?.incidents || []).map((i) => (
                  <li key={i.id} className="teacher-record-card">
                    <strong>{i.subject}</strong>
                    <span className="teacher-muted">
                      {i.learner?.firstName} {i.learner?.lastName} · {visibilityBadge(i.visibility)} ·{" "}
                      {new Date(i.incidentDate).toLocaleDateString()}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
