import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import InactivityLogoutManager from "./auth/InactivityLogoutManager";



import Login from "./Login";



import SchoolDashboard from "./SchoolDashboard";

import SuperAdminRouteGuard from "./auth/SuperAdminRouteGuard";
import SuperAdminDashboard from "./SuperAdminDashboard";
import SuperAdminLogin from "./SuperAdminLogin";



import TeacherPerformance from "./TeacherPerformance";



import LearnerProfile from "./LearnerProfile";



import LearnerDigitalReport from "./LearnerDigitalReport";



import RegisterSchool from "./RegisterSchool";
import TermsAndConditions from "./pages/TermsAndConditions";
import RefundAndCancellationPolicy from "./pages/RefundAndCancellationPolicy";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import SiteFooter from "./components/legal/SiteFooter";
import SubscriptionPackages from "./subscriptions/SubscriptionPackages";
import SubscriptionGate from "./subscriptions/SubscriptionGate";
import SubscriptionStatus from "./subscriptions/SubscriptionStatus";
import ParentPortalApp from "./parent/ParentPortalApp";
import TeacherInbox from "./teacher/TeacherInbox";
import TeacherApp from "./teacher-app/TeacherApp";



import logoIcon from "./assets/logo.icon.png";



function Home() {



  return (



    <div
      className="landing-home"



      style={{



        minHeight: "100vh",



        display: "flex",



        flexDirection: "column",



        background: "radial-gradient(circle at top, #151515 0%, #050505 55%, #000 100%)",



        color: "white",



        fontFamily: "Arial, sans-serif",



      }}



    >



      <header



        style={{



          height: 82,



          display: "flex",



          alignItems: "center",



          justifyContent: "space-between",



          padding: "0 42px",



          borderBottom: "1px solid rgba(212,175,55,0.25)",



          background: "rgba(0,0,0,0.75)",



        }}



      >



        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>



          <img



            src={logoIcon}



            alt="EduClear"



            style={{ width: 90, height: 90, objectFit: "contain" }}



          />



<strong style={{ fontSize: 22, letterSpacing: 1 }}>



EduClear



</strong>



        </div>



        <nav style={{ display: "flex", gap: 22 }}>



          <a style={{ color: "#ddd", textDecoration: "none" }} href="/">Home</a>



          <a style={{ color: "#ddd", textDecoration: "none" }} href="/login">Login</a>
          <a style={{ color: "#ddd", textDecoration: "none" }} href="/parent">Parent Portal</a>



          <a style={{ color: "#d4af37", textDecoration: "none", fontWeight: 700 }} href="/register-school">



            Register School



          </a>



        </nav>



      </header>



      <main className="landing-home__main" style={{ textAlign: "center" }}>



<img



src={logoIcon}



alt="EduClear"



style={{



  width: 360,



  maxWidth: 360,



  height: "auto",



  objectFit: "contain",



  marginBottom: 30,



  filter: "drop-shadow(0 0 18px rgba(212,175,55,0.35))",



}}



/>



        <p



          style={{



            color: "#d4af37",



            letterSpacing: 4,



            fontSize: 13,



            fontWeight: 800,



            marginBottom: 16,



          }}



        >



          PREMIUM SCHOOL MANAGEMENT



        </p>



        <h1



          style={{



            maxWidth: 900,



            fontSize: 54,



            lineHeight: 1.08,



            margin: "0 0 20px",



          }}



        >



          Run your school with clarity, confidence and control.



        </h1>



        <p



          style={{



            maxWidth: 760,



            color: "#d6d6d6",



            fontSize: 17,



            lineHeight: 1.7,



            marginBottom: 34,



          }}



        >



          EduClear brings registrations, learner management, billing, statements,



          payments, payroll, reports and parent communication into one premium



          school management platform.



        </p>



        <div



          style={{



            display: "grid",



            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",



            gap: 14,



            maxWidth: 940,



            width: "100%",



          }}



        >



          {[



            "Learner registrations and profiles",



            "Fees, invoices, statements and payments",



            "Payroll, payslips and staff records",



            "Parent communication and digital records",



            "Reports, documents and school admin",



            "Role-based access for school staff",



          ].map((item) => (



            <div



              key={item}



              style={{



                border: "1px solid rgba(212,175,55,0.28)",



                borderRadius: 16,



                padding: "15px 18px",



                background: "rgba(255,255,255,0.05)",



                color: "#f1f1f1",



              }}



            >



              {item}



            </div>



          ))}



        </div>



      </main>



      <SiteFooter variant="dark" />



    </div>



  );



}



export default function App() {



  return (



    <BrowserRouter>
      <InactivityLogoutManager />

      <Routes>



        <Route path="/" element={<Home />} />



        <Route path="/login" element={<Login onLoggedIn={() => {}} />} />



        <Route path="/register-school" element={<RegisterSchool />} />

        <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
        <Route
          path="/refund-and-cancellation-policy"
          element={<RefundAndCancellationPolicy />}
        />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />

        <Route path="/subscription/packages" element={<SubscriptionPackages />} />
        <Route path="/subscription/status" element={<SubscriptionStatus />} />
        <Route path="/subscription/return" element={<SubscriptionStatus />} />
        <Route path="/subscription/cancel" element={<SubscriptionStatus />} />
        <Route path="/subscriptions/return" element={<SubscriptionStatus />} />
        <Route path="/subscriptions/cancel" element={<SubscriptionStatus />} />

        <Route path="/parent" element={<ParentPortalApp />} />
        <Route path="/parent/*" element={<ParentPortalApp />} />
        <Route path="/parent-portal" element={<Navigate to="/parent" replace />} />
        <Route path="/parent-portal/*" element={<Navigate to="/parent" replace />} />

        <Route
          path="/dashboard/*"
          element={
            <SubscriptionGate>
              <SchoolDashboard />
            </SubscriptionGate>
          }
        />
        <Route path="/teacher-inbox" element={<TeacherInbox />} />
        <Route path="/teacher-portal/dashboard" element={<Navigate to="/teacher/home" replace />} />
        <Route path="/teacher-portal/*" element={<Navigate to="/teacher/home" replace />} />
        <Route path="/teacher/*" element={<TeacherApp />} />

        <Route path="/superadmin" element={<Navigate to="/super-admin/schools" replace />} />
        <Route path="/superadmin/*" element={<Navigate to="/super-admin/schools" replace />} />
        <Route path="/super-admin" element={<Navigate to="/super-admin/schools" replace />} />
        <Route path="/migration" element={<Navigate to="/super-admin/migration" replace />} />

        <Route path="/super-admin/login" element={<SuperAdminLogin />} />
        <Route
          path="/super-admin/*"
          element={
            <SuperAdminRouteGuard>
              <SuperAdminDashboard />
            </SuperAdminRouteGuard>
          }
        />



        <Route
          path="/teacher-performance"
          element={
            <SubscriptionGate>
              <TeacherPerformance />
            </SubscriptionGate>
          }
        />

        <Route
          path="/learners/:learnerId"
          element={
            <SubscriptionGate>
              <LearnerProfile />
            </SubscriptionGate>
          }
        />

        <Route
          path="/learners/:learnerId/report"
          element={
            <SubscriptionGate>
              <LearnerDigitalReport />
            </SubscriptionGate>
          }
        />



      </Routes>



    </BrowserRouter>



  );



}