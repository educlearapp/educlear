import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./Login";

import SchoolDashboard from "./SchoolDashboard";

import LearnerProfile from "./LearnerProfile.tsx";
import LearnerDigitalReport from "./LearnerDigitalReport.tsx";
import Landing from "./Landing.tsx";
import RegisterSchool from "./RegisterSchool.tsx";
import SelectSchool from "./SelectSchool.tsx";
import ProtectedRoute from "./ProtectedRoute.tsx";
import TeacherPerformance from "./TeacherPerformance.tsx";

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

      </Routes>

    </BrowserRouter>

  );

}