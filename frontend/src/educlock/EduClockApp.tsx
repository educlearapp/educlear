import { Navigate, Route, Routes } from "react-router-dom";
import "../teacher-app/teacherApp.css";
import EduClockLogin from "./EduClockLogin";
import EduClockActivatePage from "./EduClockActivatePage";
import EduClockStaffClockPage from "./EduClockStaffClockPage";

function EduClockIndex() {
  const ok = Boolean(localStorage.getItem("token") && localStorage.getItem("schoolId"));
  return <Navigate to={ok ? "clock" : "login"} replace />;
}

export default function EduClockApp() {
  return (
    <div className="teacher-app-root">
      <Routes>
        <Route index element={<EduClockIndex />} />
        <Route path="login" element={<EduClockLogin />} />
        <Route path="activate" element={<EduClockActivatePage />} />
        <Route path="clock" element={<EduClockStaffClockPage />} />
        <Route path="*" element={<Navigate to="/educlock" replace />} />
      </Routes>
    </div>
  );
}
