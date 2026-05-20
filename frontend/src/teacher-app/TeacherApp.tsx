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

export default function TeacherApp() {
  return (
    <div className="teacher-app-root">
      <Routes>
        <Route path="/teacher/*" element={<TeacherShell />}>
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
      </Routes>
    </div>
  );
}
