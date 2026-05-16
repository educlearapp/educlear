import { BrowserRouter, Routes, Route } from "react-router-dom";



import Login from "./Login";



import SchoolDashboard from "./SchoolDashboard_OLD";



import TeacherPerformance from "./TeacherPerformance";



import LearnerProfile from "./LearnerProfile";



import LearnerDigitalReport from "./LearnerDigitalReport";



import RegisterSchool from "./RegisterSchool";



import logoIcon from "./assets/logo.icon.png";



function Home() {



  return (



    <div



      style={{



        minHeight: "100vh",



        background: "radial-gradient(circle at top, #151515 0%, #050505 55%, #000 100%)",



        color: "white",



        fontFamily: "Arial, sans-serif",



        overflow: "hidden",



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



          <a style={{ color: "#d4af37", textDecoration: "none", fontWeight: 700 }} href="/register-school">



            Register School



          </a>



        </nav>



      </header>



      <main



        style={{



          minHeight: "calc(100vh - 140px)",



          display: "flex",



          flexDirection: "column",



          alignItems: "center",



          justifyContent: "center",



          textAlign: "center",



          padding: "40px 20px",



        }}



      >



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



    </div>



  );



}



export default function App() {



  return (



    <BrowserRouter>



      <Routes>



        <Route path="/" element={<Home />} />



        <Route path="/login" element={<Login onLoggedIn={() => {}} />} />



        <Route path="/register-school" element={<RegisterSchool />} />

        <Route path="/dashboard/*" element={<SchoolDashboard />} />



        <Route path="/teacher-performance" element={<TeacherPerformance />} />



        <Route path="/learners/:learnerId" element={<LearnerProfile />} />



        <Route path="/learners/:learnerId/report" element={<LearnerDigitalReport />} />



      </Routes>



    </BrowserRouter>



  );



}