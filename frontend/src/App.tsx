import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./Login";

import SchoolDashboard from "./SchoolDashboard";

import LearnerProfile from "./LearnerProfile.tsx";
import LearnerDigitalReport from "./LearnerDigitalReport.tsx";
import Landing from "./Landing.tsx";
import RegisterSchool from "./RegisterSchool.tsx";
import SelectSchool from "./SelectSchool.tsx";
import ProtectedRoute from "./ProtectedRoute.tsx";
import TeacherPerformance from "./TeacherPerformance.tsx";
import ParentPortalLogin from "./ParentPortalLogin";
import ParentPortalLayout from "./ParentPortalLayout";
import ParentPortalDashboard from "./ParentPortalDashboard";
import ParentPortalStatements from "./ParentPortalStatements";
import ParentPortalHomework from "./ParentPortalHomework";
import ParentPortalProjects from "./ParentPortalProjects";
import ParentPortalNotices from "./ParentPortalNotices";
import ParentPortalTuckshop from "./ParentPortalTuckshop";
import ParentPortalMessages from "./ParentPortalMessages";

export default function App() {

  return (

    <BrowserRouter>

      <Routes>

        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<RegisterSchool />} />
        
        <Route path="/login" element={<Login />} />
        <Route path="/select-school" element={<ProtectedRoute requireSchool={false} element={<SelectSchool />} />} />

        <Route
          path="/dashboard/*"
          element={<ProtectedRoute requireSchool element={<SchoolDashboard />} />}
        />

        <Route
          path="/teacher-performance"
          element={<ProtectedRoute requireSchool element={<TeacherPerformance />} />}
        />
        <Route
          path="/learners/:learnerId"
          element={<ProtectedRoute requireSchool element={<LearnerProfile />} />}
        />
        <Route
          path="/learners/:learnerId/report"
          element={<ProtectedRoute requireSchool element={<LearnerDigitalReport />} />}
        />

        {/* Parent Portal (new routes) */}
        <Route path="/parent/login" element={<ParentPortalLogin />} />
        <Route path="/parent" element={<ParentPortalLayout />}>
          <Route index element={<Navigate to="/parent/dashboard" replace />} />
          <Route path="dashboard" element={<ParentPortalDashboard />} />
          <Route path="statements" element={<ParentPortalStatements />} />
          <Route path="homework" element={<ParentPortalHomework />} />
          <Route path="projects" element={<ParentPortalProjects />} />
          <Route path="notices" element={<ParentPortalNotices />} />
          <Route path="tuckshop" element={<ParentPortalTuckshop />} />
          <Route path="messages" element={<ParentPortalMessages />} />
        </Route>

        {/* Backwards compatible redirects */}
        <Route path="/parent-portal/login" element={<Navigate to="/parent/login" replace />} />
        <Route path="/parent-portal/dashboard" element={<Navigate to="/parent/dashboard" replace />} />
        <Route path="/parent-portal/statements" element={<Navigate to="/parent/statements" replace />} />
        <Route path="/parent-portal/homework" element={<Navigate to="/parent/homework" replace />} />
        <Route path="/parent-portal/projects" element={<Navigate to="/parent/projects" replace />} />
        <Route path="/parent-portal/notices" element={<Navigate to="/parent/notices" replace />} />
        <Route path="/parent-portal/tuckshop" element={<Navigate to="/parent/tuckshop" replace />} />
        <Route path="/parent-portal/messages" element={<Navigate to="/parent/messages" replace />} />

      </Routes>

    </BrowserRouter>

  );

}