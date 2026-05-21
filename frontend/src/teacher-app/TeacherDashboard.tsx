import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { staffApiFetch } from "../staffApi";
import { NO_ASSIGNED_CLASSROOMS_MSG } from "./useTeacherAssignedClassrooms";

type MeResponse = {
  success?: boolean;
  unreadInbox?: number;
  assignedClassNames?: string[];
  assignedClassrooms?: { id: string; name: string; learnerCount?: number }[];
  user?: { fullName?: string | null; email?: string };
  school?: { name?: string | null };
};

type HomeworkPost = { dueDate?: string | null };
type IncidentRow = { id: string };

function isDueToday(iso: string | null | undefined) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function TeacherDashboard() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [homeworkDueToday, setHomeworkDueToday] = useState(0);
  const [pendingIncidents, setPendingIncidents] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [meData, hwData, incData] = await Promise.all([
          staffApiFetch("/api/teacher-app/me") as Promise<MeResponse>,
          staffApiFetch("/api/teacher-app/homework").catch(() => ({ posts: [] })),
          staffApiFetch("/api/teacher-app/incidents").catch(() => ({ incidents: [] })),
        ]);
        setMe(meData);
        const posts = (hwData as { posts?: HomeworkPost[] }).posts || [];
        setHomeworkDueToday(posts.filter((p) => isDueToday(p.dueDate)).length);
        setPendingIncidents(((incData as { incidents?: IncidentRow[] }).incidents || []).length);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not load teacher profile");
      }
    })();
  }, []);

  const unread = me?.unreadInbox ?? 0;
  const assignedLearners = useMemo(() => {
    const rooms = me?.assignedClassrooms || [];
    if (rooms.length) {
      return rooms.reduce((sum, c) => sum + (Number(c.learnerCount) || 0), 0);
    }
    return me?.assignedClassNames?.length ?? 0;
  }, [me]);

  const classes =
    (me?.assignedClassrooms?.length ?? 0) > 0
      ? (me?.assignedClassrooms?.length ?? 0)
      : (me?.assignedClassNames?.length ?? 0);

  return (
    <div>
      <h1 className="teacher-page-heading">Dashboard</h1>
      {me?.user && (
        <p className="teacher-muted">
          {me.user.fullName || "Teacher"} · {me.user.email}
          {me.school?.name ? ` · ${me.school.name}` : ""}
        </p>
      )}
      {err && <p className="teacher-error">{err}</p>}
      {!err && me && classes === 0 && (
        <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>
      )}
      {!err && me && classes > 0 && (me.assignedClassrooms?.length || me.assignedClassNames?.length) ? (
        <p className="teacher-muted" style={{ marginTop: 8 }}>
          Assigned classes:{" "}
          {(me.assignedClassrooms?.length
            ? me.assignedClassrooms.map((c) => c.name)
            : me.assignedClassNames || []
          ).join(" · ")}
        </p>
      ) : null}

      <div className="teacher-stats-row" aria-label="Quick stats">
        <div className="teacher-stat-card">
          <p className="teacher-stat-card-label">Assigned Learners</p>
          <p className="teacher-stat-card-value">{assignedLearners}</p>
          <p className="teacher-stat-card-hint">Across your classes</p>
        </div>
        <div className="teacher-stat-card">
          <p className="teacher-stat-card-label">Homework Due Today</p>
          <p className="teacher-stat-card-value">{homeworkDueToday}</p>
          <p className="teacher-stat-card-hint">Posted for your classes</p>
        </div>
        <div className="teacher-stat-card">
          <p className="teacher-stat-card-label">Unread Messages</p>
          <p className="teacher-stat-card-value">{unread}</p>
          <p className="teacher-stat-card-hint">From parents</p>
        </div>
        <div className="teacher-stat-card">
          <p className="teacher-stat-card-label">Pending Incidents</p>
          <p className="teacher-stat-card-value">{pendingIncidents}</p>
          <p className="teacher-stat-card-hint">Recorded for your learners</p>
        </div>
      </div>

      <div className="teacher-card-grid">
        <Link className="teacher-dash-card" to="/teacher/inbox">
          <span className="icon">✉️</span>
          Parents Portal
          {unread > 0 && (
            <span style={{ color: "var(--t-gold)", fontSize: "0.8rem" }}>{unread} unread</span>
          )}
        </Link>
        <Link className="teacher-dash-card" to="/teacher/homework">
          <span className="icon">📝</span>
          Homework
        </Link>
        <Link className="teacher-dash-card" to="/teacher/notices">
          <span className="icon">📌</span>
          Notices
        </Link>
        <Link className="teacher-dash-card" to="/teacher/incidents">
          <span className="icon">⚠️</span>
          Incidents
        </Link>
        <Link className="teacher-dash-card" to="/teacher/assessments">
          <span className="icon">📊</span>
          Assessments / Exams
        </Link>
        <Link className="teacher-dash-card" to="/teacher/documents">
          <span className="icon">📎</span>
          Documents
        </Link>
        <Link className="teacher-dash-card" to="/teacher/learners">
          <span className="icon">🎓</span>
          Learners
        </Link>
        <Link className="teacher-dash-card" to="/teacher/notifications">
          <span className="icon">🔔</span>
          Notifications
        </Link>
      </div>
    </div>
  );
}
