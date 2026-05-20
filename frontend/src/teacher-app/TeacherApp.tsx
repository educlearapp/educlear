import { Component, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "./teacherApp.css";
import TeacherLogin from "./TeacherLogin";
import TeacherShell from "./TeacherShell";
import TeacherDashboard from "./TeacherDashboard";
import TeacherHomeworkPage from "./TeacherHomeworkPage";
import TeacherNoticesPage from "./TeacherNoticesPage";
import TeacherIncidentsPage from "./TeacherIncidentsPage";
import TeacherDocumentsPage from "./TeacherDocumentsPage";
import TeacherLearnersPage from "./TeacherLearnersPage";
import TeacherNotificationsPage from "./TeacherNotificationsPage";
import TeacherInbox from "../teacher/TeacherInbox";

function TeacherIndex() {
  const ok = Boolean(localStorage.getItem("token") && localStorage.getItem("schoolId"));
  return <Navigate to={ok ? "home" : "login"} replace />;
}

type ErrorBoundaryState = { error: Error | null };

class TeacherAppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="teacher-app-root">
          <main className="teacher-app-main" style={{ maxWidth: 480 }}>
            <h1 className="teacher-app-title">Teacher Portal</h1>
            <p className="teacher-error">
              Unable to load the Teacher Portal. Please refresh the page or sign in again.
            </p>
            <p className="teacher-muted">{this.state.error.message}</p>
            <a
              href="/teacher/login"
              className="teacher-touch-btn primary"
              style={{ display: "inline-flex", marginTop: 16, textDecoration: "none" }}
            >
              Go to sign in
            </a>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function TeacherApp() {
  return (
    <TeacherAppErrorBoundary>
      <div className="teacher-app-root">
        <Routes>
          <Route element={<TeacherShell />}>
            <Route index element={<TeacherIndex />} />
            <Route path="login" element={<TeacherLogin />} />
            <Route path="home" element={<TeacherDashboard />} />
            <Route path="inbox" element={<TeacherInbox embedded />} />
            <Route path="homework" element={<TeacherHomeworkPage />} />
            <Route path="notices" element={<TeacherNoticesPage />} />
            <Route path="incidents" element={<TeacherIncidentsPage />} />
            <Route path="documents" element={<TeacherDocumentsPage />} />
            <Route path="learners" element={<TeacherLearnersPage />} />
            <Route path="notifications" element={<TeacherNotificationsPage />} />
            <Route path="assessments" element={<TeacherNoticesPage defaultNoticeType="ASSESSMENT" />} />
          </Route>
          <Route path="*" element={<Navigate to="login" replace />} />
        </Routes>
      </div>
    </TeacherAppErrorBoundary>
  );
}
