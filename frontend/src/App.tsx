import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./Login";

import SchoolDashboard from "./SchoolDashboard";

import TeacherPerformance from "./TeacherPerformance";
import logo from "./assets/logo.png";

import { apiFetch } from "./api";
import LearnerProfile from "./LearnerProfile.tsx";
import LearnerDigitalReport from "./LearnerDigitalReport.tsx";
function Home() {

  return (

    <div>
  
  
  
      {/* NAVBAR */}
  
    {/* NAVBAR */}

    <div style={{

display: "flex",

justifyContent: "space-between",

alignItems: "center",

padding: "20px 40px",

borderBottom: "1px solid #eee",

backgroundColor: "#fff"

}}>

<div style={{ display: "flex", alignItems: "center", gap: 15 }}>

  <img

    src={logo}

    alt="EduClear"

    style={{ height: 120, objectFit: "contain" }}

  />

  <span style={{ fontSize: 22, fontWeight: "bold" }}>

    EduClear

  </span>

</div>



<div style={{ display: "flex", gap: 20 }}>

  <a href="/">Home</a>
  
  <a href="/login">Login</a>

  <a href="#">Features</a>

  <a href="#">Pricing</a>

  <a href="#">Contact</a>

</div>

</div>
  
  
  
      {/* HERO */}
  
      <div style={{
  
        padding: "80px 40px",
  
        textAlign: "center"
  
      }}>
  
        <h1 style={{ fontSize: 48 }}>EduClear</h1>
  
        <p style={{ fontSize: 18 }}>
  
          Innovate. Empower. Achieve.
  
        </p>
  
      </div>
  
  
  
      {/* FEATURES */}
  
      <div style={{
  
        display: "flex",
  
        justifyContent: "space-around",
  
        padding: "40px"
  
      }}>
  
        <div style={{ maxWidth: 250, textAlign: "center" }}>
  
          <h3>Administration</h3>
  
          <p>Manage learners, parents, and school data easily.</p>
  
        </div>
  
  
  
        <div style={{ maxWidth: 250, textAlign: "center" }}>
  
          <h3>Billing</h3>
  
          <p>Create invoices, track payments and manage fees.</p>
  
        </div>
  
  
  
        <div style={{ maxWidth: 250, textAlign: "center" }}>
  
          <h3>Communication</h3>
  
          <p>Send notices, statements and updates to parents.</p>
  
        </div>
  
      </div>
  
  
  
    </div>
  
  );

}



export default function App() {

  return (

    <BrowserRouter>

      <Routes>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
        
        <Route path="/login" element={<Login onLoggedIn={() => {}} />} />

        <Route path="/dashboard/*" element={<SchoolDashboard />} />

        <Route path="/teacher-performance" element={<TeacherPerformance />} />
        <Route path="/learners/:learnerId" element={<LearnerProfile />} />
        <Route path="/learners/:learnerId/report" element={<LearnerDigitalReport />} />

      </Routes>

    </BrowserRouter>

  );

}