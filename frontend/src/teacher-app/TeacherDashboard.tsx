import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { staffApiFetch } from "../staffApi";
import { NO_ASSIGNED_CLASSROOMS_MSG } from "./useTeacherAssignedClassrooms";

type MeResponse = {
  success?: boolean;
  unreadInbox?: number;
  assignedClassNames?: string[];
  user?: { fullName?: string | null; email?: string };
  school?: { name?: string | null };
};

export default function TeacherDashboard() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = (await staffApiFetch("/api/teacher-app/me")) as MeResponse;
        setMe(data);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not load teacher profile");
      }
    })();
  }, []);

  const unread = me?.unreadInbox ?? 0;
  const classes = me?.assignedClassNames?.length ?? 0;

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
      <div className="teacher-card-grid" style={{ marginTop: 20 }}>
        <Link className="teacher-dash-card" to="/teacher/inbox">
          <span className="icon">✉️</span>
          Parent Messages
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
