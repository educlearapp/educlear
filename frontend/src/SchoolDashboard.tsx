import { useEffect, useState } from "react";

import "./App.css";

import logo from "./assets/logo.png";



type MenuKey =

  | "dashboard"

  | "registrations"

  | "class-registers"

  | "classrooms"

  | "attendance"

  | "employees"

  | "incidents"

  | "invoice-runs"

  | "billing-plans"

  | "billing-reports"

  | "billing-documents"

  | "statements"

  | "invoices"

  | "payments"

  | "fees"

  | "letters-of-demand"

  | "section-41"

  | "email"

  | "sms";



export default function SchoolDashboard() {
    const schoolId = localStorage.getItem("schoolId");
  const [activeMenu, setActiveMenu] = useState<MenuKey>("dashboard");

  const [openSection, setOpenSection] = useState<string | null>(null);

  const [registrationView, setRegistrationView] = useState<"list" | "learner" | "parent">("list");
  const [parents, setParents] = useState<any[]>([]);
  const [selectedLearnerParents, setSelectedLearnerParents] = useState<any[]>([]);
  const [parentForm, setParentForm] = useState({

    name: "",
  
    surname: "",
  
    idNumber: "",
  
    phone: "",
  
    email: "",
    relationship: "",
  });
  const [learnerForm, setLearnerForm] = useState({

    firstName: "",
  
    lastName: "",
  
    grade: "",
  
    className: "",
  
    admissionNo: "",
  
    idNumber: "",

birthDate: "",

gender: "",

homeLanguage: "",

nationality: "",

religion: "",
  });
  const [selectedLearner, setSelectedLearner] = useState<any>(null);
  const [searchId, setSearchId] = useState("");

const [statusResult, setStatusResult] = useState<any>(null);
const [savedParents, setSavedParents] = useState<any[]>([]);

const [savedLearners, setSavedLearners] = useState<any[]>([]);
useEffect(() => {

    fetch("http://localhost:3000/api/learners")
  
      .then((res) => res.json())
  
      .then((data) => {
  
        if (Array.isArray(data)) {
  
          setSavedLearners(data);
  
        } else if (data.learners) {
  
          setSavedLearners(data.learners);
  
        } else {
  
          setSavedLearners([]);
  
        }
  
      })
  
      .catch((err) => {
  
        console.error(err);
  
        setSavedLearners([]);
  
      });
  
  }, []);
  const toggleSection = (section: string) => {

    setOpenSection((prev) => (prev === section ? null : section));

  };


  const saveParent = async () => {

    try {
  
      const res = await fetch("http://localhost:3000/api/parents", {
  
        method: "POST",
  
        headers: {
  
          "Content-Type": "application/json",
  
        },
  
        body: JSON.stringify({
  
          fullName: parentForm.name,
  
          mobile: parentForm.phone,
  
          email: parentForm.email,
  
          idNumber: parentForm.idNumber,
  
          schoolId: schoolId,
          learnerId: selectedLearner?.id,
        }),
  
      });
  
  
  
      const data = await res.json();
  
  
  
      if (data.success) {
  
        alert("Parent saved successfully ✅");
  
        console.log(data);
  
      } else {
  
        alert(data.message);
  
      }
  
    } catch (err) {
  
      console.error(err);
  
      alert("Error saving parent");
  
    }
  
  };
  const saveLearner = async () => {

    try {
        console.log("SENDING:", {

            schoolId,
          
            firstName: learnerForm.firstName,
          
            lastName: learnerForm.lastName,
          
            grade: learnerForm.grade || learnerForm.className,
          
          });
      const res = await fetch("http://localhost:3000/api/learners", {
  
        method: "POST",
  
        headers: {
  
          "Content-Type": "application/json",
  
        },
  
        body: JSON.stringify({
  
          schoolId: "cmmyhftzu00009eojp6o9i2tb",
  
          firstName: learnerForm.firstName,
  
          lastName: learnerForm.lastName,
  
          grade: learnerForm.grade || learnerForm.className,
  
          className: learnerForm.className,
  
          admissionNo: learnerForm.admissionNo,
  
        }),
  
      });
  
  
  
      const data = await res.json();
  
  
  
      if (data.success) {
  
        alert("Learner saved successfully ✅");
  
        console.log(data);
  
      } else {
  
        alert(data.message);
  
      }
  
    } catch (err) {
  
      console.error(err);
  
      alert("Error saving learner");
  
    }
  
  };
  useEffect(() => {

    const loadData = async () => {
  
      try {
  
        const parentsRes = await fetch("http://localhost:3000/api/parents");
  
        const parentsData = await parentsRes.json();
  
  
  
        if (Array.isArray(parentsData)) {
  
          setSavedParents(parentsData);
  
        } else if (parentsData.success) {
  
          setSavedParents(parentsData.parents || []);
  
        }
  
  
  
        const learnersRes = await fetch("http://localhost:3000/api/learners");
  
        const learnersData = await learnersRes.json();
  
  
  
        if (Array.isArray(learnersData)) {
  
          setSavedLearners(learnersData);
  
        } else if (learnersData.success) {
  
          setSavedLearners(learnersData.learners || []);
  
        }
  
      } catch (err) {
  
        console.error(err);
  
      }
  
    };
  
  
  
    loadData();
  
  }, []);
  const renderContent = () => {

    switch (activeMenu) {

      case "dashboard":

        return (
    

          <div className="dashboard-grid">
         <div style={{ marginBottom: "20px", width: "100%" }}>
         <div style={{ width: "100%", marginBottom: "20px" }}>

<h3>Saved Parents</h3>



{parents && parents.length > 0 ? (

  parents.map((p: any) => (

    <div key={p.id} style={{ padding: "10px", borderBottom: "1px solid #ccc" }}>

      <p><strong>{p.fullName}</strong></p>

      <p>{p.mobile}</p>

      <p>{p.email}</p>

    </div>

  ))

) : (

  <p>No parents found</p>

)}

</div>    

<h3>Check Outstanding Fees</h3>



<input

  type="text"

  placeholder="Enter Parent ID"

  value={searchId}

  onChange={(e) => setSearchId(e.target.value)}

  style={{ padding: "10px", marginRight: "10px" }}

/>



<button

  onClick={async () => {

    try {

      const res = await fetch(`http://localhost:3000/api/fees-status/${searchId}`);

      const data = await res.json();

      setStatusResult(data);

    } catch (err) {

      console.error(err);

    }

  }}

  className="primary-btn"

>

  Check Status

</button>



{statusResult && (

<div style={{ marginTop: "15px", fontWeight: "bold" }}>

  <p>

    Status:{" "}

    <span

      style={{

        color:

          statusResult.status === "GREEN"

            ? "green"

            : statusResult.status === "AMBER"

            ? "orange"

            : "red",

      }}

    >

      {statusResult.status}

    </span>

  </p>



  <p>Outstanding Amount: R {statusResult.outstandingAmount}</p>

  <p>School: {statusResult.school}</p>

  <p>Parent: {statusResult.parentName}</p>

</div>

)}

</div>   

            <div className="dashboard-card">

              <h3>Total Learners</h3>

              <p>395 Learners</p>

            </div>



            <div className="dashboard-card">

              <h3>Outstanding Fees</h3>

              <p>R 0.00</p>

            </div>



            <div className="dashboard-card">

              <h3>Payments This Month</h3>

              <p>R 0.00</p>

            </div>



            <div className="dashboard-card">

              <h3>Birthdays</h3>

              <p>1 today</p>

            </div>



            <div className="dashboard-card dashboard-card-wide">

              <h3>Quick Actions</h3>

              <p>Add Learner, Capture Payment, Send Statement</p>

            </div>



            <div className="dashboard-card dashboard-card-wide">

              <h3>Announcements</h3>

              <p>Welcome to EduClear.</p>

            </div>

          </div>

        );

        case "registrations":

        return (
      
          <div className="content-panel registration-page">
      
            <div className="registration-header">
      
              <div>
      
                <h2>Registration</h2>
      
                <p>
      
                  {registrationView === "learner"
      
                    ? "Manage child and parent information"
      
                    : "Change parent's information"}
      
                </p>
      
              </div>
      
      
              {registrationView === "list" && (

<div className="registration-card">

  <div className="registration-section-title">Children</div>



  <div style={{ display: "flex", gap: "10px", marginBottom: "15px", flexWrap: "wrap" }}>

    <button

      className="primary-btn"

      onClick={() => setRegistrationView("learner")}

    >

      + Add Learner

    </button>



    <button

      className="secondary-btn"

      onClick={() => setRegistrationView("learner")}

    >

      + Add Sibling

    </button>


  </div>



  {savedLearners.length === 0 ? (

    <p>No learners saved yet</p>

  ) : (

    <div style={{ overflowX: "auto" }}>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>

        <thead>

          <tr>

            <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Name</th>

            <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Surname</th>

            <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Grade</th>

            <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Classroom</th>
            <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Actions</th>
          </tr>

        </thead>

        <tbody>

          {savedLearners.map((learner: any, index) => (

<tr

key={learner.id || index}

onClick={() => setSelectedLearner(learner)}

style={{

  cursor: "pointer",

  backgroundColor: selectedLearner === learner ? "#eef4ff" : "transparent",

}}

>  

              <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>{learner.firstName}</td>

              <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>{learner.lastName}</td>

              <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>{learner.grade}</td>

              <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>{learner.className}</td>
              <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>

<button

  className="secondary-btn"

  onClick={() => {

    setSelectedLearner(learner);
  
    setSelectedLearnerParents(
  
      parents.filter((parent) => parent.learnerId === learner.id)
  
    );
  
  
  
    setLearnerForm({
  
      firstName: learner.firstName || "",
  
      lastName: learner.lastName || "",
  
      grade: learner.grade || "",
  
      className: learner.className || "",
  
      admissionNo: learner.admissionNo || "",
  
  
  
      idNumber: learner.idNumber || "",
  
      birthDate: learner.birthDate || "",
  
      gender: learner.gender || "",
  
      homeLanguage: learner.homeLanguage || "",
  
      nationality: learner.nationality || "",
  
      religion: learner.religion || "",
  
    });
  
  
  
    setRegistrationView("learner");
  
  }}

>

  Manage

</button>

</td>
            </tr>

          ))}

        </tbody>

      </table>

    </div>

  )}

</div>

)}
              <div className="registration-actions">
      
                <button
      
                  className="secondary-btn"
      
                  onClick={() => setRegistrationView("learner")}
      
                >
      
                  Back
      
                </button>
      
      
      
                <button

className="primary-btn"

onClick={() => {

    if (registrationView === "parent") {
  
      saveParent();
  
    } else {
  
      saveLearner();
  
    }
  
  }}

>

Save

</button> 
      
      
      
                <button className="secondary-btn">More Actions</button>
      
              </div>
      
            </div>
      
      
      
            {registrationView === "learner" && (
      
              <>
      
                <div className="registration-card">
      
                  <div className="registration-section-title">Child</div>
      
      
      
                  <div className="registration-tabs">
      
                    <button className="registration-tab active">General</button>
      
                    <button className="registration-tab">Billing Plan</button>
      
                    <button className="registration-tab">Medical</button>
      
                    <button className="registration-tab">Groups</button>
      
                    <button className="registration-tab">Other</button>
      
                    <button className="registration-tab">Extra</button>
      
                  </div>
      
      
      
                  <div className="kid-form-grid">
      
                    <label>Name / Nickname</label>
      
                    <div className="double-field">
      
                    <input

placeholder="Name"

value={learnerForm.firstName}

onChange={(e) =>

  setLearnerForm({ ...learnerForm, firstName: e.target.value })

}

/> 
      
                      <input placeholder="Nickname" />
      
                    </div>
      
      
      
                    <label>Surname</label>
      
                    <input

placeholder="Surname"

value={learnerForm.lastName}

onChange={(e) =>

  setLearnerForm({ ...learnerForm, lastName: e.target.value })

}

/> 
      
      
      
                    <label>ID No</label>
      
                    <input placeholder="ID No" />
      
      
      
                    <label>Birth Date</label>
      
                    <input type="date" />
      
      
      
                    <label>Gender</label>
      
                    <select defaultValue="">
      
                      <option value="" disabled>
      
                        Select gender
      
                      </option>
      
                      <option>Male</option>
      
                      <option>Female</option>
      
                    </select>
      
      
      
                    <label>Classroom</label>
      
                    <input

placeholder="Classroom"

value={learnerForm.className}

onChange={(e) =>

  setLearnerForm({ ...learnerForm, className: e.target.value })

}

/> 
      
      
      
                    <label>Home Language</label>
      
                    <input placeholder="Home Language" />
      
      
      
                    <label>Nationality</label>
      
                    <input placeholder="Nationality" />
      
      
      
                    <label>Religion</label>
      
                    <input placeholder="Religion" />
      
      
      
                    <label>Enrolment Date</label>
      
                    <input type="date" />
      
      
      
                    <label>Notes</label>
      
                    <textarea placeholder="Notes" rows={4} />
      
                  </div>
      
                </div>
      
      
      
                <div className="registration-card" style={{ marginTop: "24px" }}>
      
                  <div className="registration-section-title">Parents</div>
      
      
      
                  <div className="parent-toolbar">
      
                    <button
      
                      className="small-action-btn"
      
                      onClick={() => setRegistrationView("parent")}
      
                    >
      
                      + Add
      
                    </button>
      
                    <button className="small-action-btn">+ Add Existing</button>
      
                    <button className="small-action-btn">Manage</button>
      
                    <button className="small-action-btn danger">Remove</button>
      
                  </div>
      
      
      
                  <table className="parent-table">
      
                    <thead>
      
                      <tr>
      
                        <th>Relationship</th>
      
                        <th>Name</th>
      
                        <th>Surname</th>
      
                        <th>Cell</th>
      
                        <th>ID No</th>
      
                        <th>Email</th>
      
                      </tr>
      
                    </thead>
      
                    <tbody>

{parents.length === 0 ? (

  <tr>

    <td colSpan={6}>No parents added yet</td>

  </tr>

) : (

  parents.map((parent, index) => (

    <tr key={index}>

<td>{parent.relationship || "Parent"}</td>

<td>{parent.name}</td>

<td>{parent.surname || "-"}</td>

<td>{parent.phone || "-"}</td>

<td>{parent.idNumber || "-"}</td>

<td>{parent.email || "-"}</td>


    </tr>

  ))

)}

</tbody>  
      
                  </table>
      
                </div>
      
              </>
      
            )}
      
      
      
            {registrationView === "parent" && (
      
              <div className="registration-card">
      
                <div className="registration-section-title small">Parent</div>
      
      
      
                <div className="registration-tabs">
      
                  <button className="registration-tab active">General</button>
      
                  <button className="registration-tab">Contact</button>
      
                  <button className="registration-tab">Address</button>
      
                  <button className="registration-tab">Billing</button>
      
                  <button className="registration-tab">Other</button>
      
                  <button className="registration-tab">Extra</button>
      
                </div>
      
      
      
                <div className="kid-form-grid">
      
                  <label>Relationship</label>
      
                  <select

value={parentForm.relationship}

onChange={(e) =>

  setParentForm({ ...parentForm, relationship: e.target.value })

}

>

<option value="">Select relationship</option>

<option value="Father">Father</option>

<option value="Mother">Mother</option>

<option value="Guardian">Guardian</option>

</select>
      
      
      
                  <label>Title</label>
      
                  <select defaultValue="">
      
                    <option value="" disabled>
      
                      Select title
      
                    </option>
      
                    <option>Mr.</option>
      
                    <option>Mrs.</option>
      
                    <option>Ms.</option>
      
                  </select>
      
      
      
                  <label>Name / Nickname</label>
      
                  <div className="double-field">
      
                  <input

placeholder="Parent Name"

value={parentForm.name}

onChange={(e) =>

  setParentForm({ ...parentForm, name: e.target.value })

}

/>
      
                    <input placeholder="Nickname" />
      
                  </div>
      
      
      
                  <label>Surname</label>
      
                  <input

  placeholder="Parent Surname"

  value={parentForm.surname}

  onChange={(e) =>

    setParentForm({ ...parentForm, surname: e.target.value })

  }

/>
      
      
      
                  <label>ID No</label>
      
                  <input

  placeholder="Parent ID No"

  value={parentForm.idNumber}

  onChange={(e) =>

    setParentForm({ ...parentForm, idNumber: e.target.value })

  }

/>
      
      
      
                  <label>Marital Status</label>
      
                  <select defaultValue="">
      
                    <option value="" disabled>
      
                      Select marital status
      
                    </option>
      
                    <option>Single</option>
      
                    <option>Married</option>
      
                    <option>Divorced</option>
      
                    <option>Widowed</option>
      
                  </select>
      
      
      
                  <label>Cell</label>
      
                  <input

  placeholder="Phone Number"

  value={parentForm.phone}

  onChange={(e) =>

    setParentForm({ ...parentForm, phone: e.target.value })

  }

/>
      
      
      
                  <label>Email</label>
      
                  <input

  placeholder="Email Address"

  value={parentForm.email}

  onChange={(e) =>

    setParentForm({ ...parentForm, email: e.target.value })

  }

/>
      
      
      
                  <label>Address</label>
      
                  <textarea placeholder="Address" rows={3} />
      
      
      
                  <label>Notes</label>
      
                  <textarea placeholder="Notes" rows={4} />
      
                </div>
      
              </div>
      
            )}
      
          </div>
      
        ); 



      case "class-registers":

        return (

          <div className="content-panel">

            <h2>Class Registers</h2>

            <p>Daily class registers will be managed here.</p>

          </div>

        );



      case "classrooms":

        return (

          <div className="content-panel">

            <h2>Classrooms</h2>

            <p>Classroom setup will be managed here.</p>

          </div>

        );



      case "attendance":

        return (

          <div className="content-panel">

            <h2>Attendance</h2>

            <p>Attendance records will be managed here.</p>

          </div>

        );



      case "employees":

        return (

          <div className="content-panel">

            <h2>Employees</h2>

            <p>Employee records will be managed here.</p>

          </div>

        );



      case "incidents":

        return (

          <div className="content-panel">

            <h2>Incidents</h2>

            <p>Incidents will be managed here.</p>

          </div>

        );



      case "invoice-runs":

        return (

          <div className="content-panel">

            <h2>Invoice Runs</h2>

            <p>Run monthly invoices for learners here.</p>

          </div>

        );



      case "billing-plans":

        return (

          <div className="content-panel">

            <h2>Billing Plans</h2>

            <p>Set up and manage a child&apos;s billing plan here.</p>



            <div className="content-card">

              <h3>Billing Plan</h3>

              <p>Child: ADRIEN</p>

              <p>Exclude From Invoice Run: No</p>

              <p>Total: R 3000.00</p>

            </div>

          </div>

        );



      case "billing-reports":

        return (

          <div className="content-panel">

            <h2>Billing Reports</h2>

            <p>View, print or export billing reports here.</p>



            <div className="content-card">

              <h3>Available Reports</h3>

              <ul className="simple-list">

                <li>Account List (Account Status)</li>

                <li>Account List (Age Analysis)</li>

                <li>Billing Plan Summary By Child</li>

                <li>Deposit List</li>

                <li>Payments By Type</li>

                <li>Sibling Accounts</li>

                <li>Transaction List</li>

              </ul>

            </div>

          </div>

        );



      case "billing-documents":

        return (

          <div className="content-panel">

            <h2>Billing Documents</h2>

            <p>View or print billing documents here.</p>



            <div className="content-card">

              <h3>Documents</h3>

              <ul className="simple-list">

                <li>Invoices</li>

                <li>Statements</li>

              </ul>

            </div>

          </div>

        );



      case "statements":

        return (

          <div className="content-panel">

            <h2>Statements</h2>

            <p>Statements section.</p>

          </div>

        );



      case "invoices":

        return (

          <div className="content-panel">

            <h2>Invoices</h2>

            <p>Invoices section.</p>

          </div>

        );



      case "payments":

        return (

          <div className="content-panel">

            <h2>Payments</h2>

            <p>Payments section.</p>

          </div>

        );



      case "fees":

        return (

          <div className="content-panel">

            <h2>Fees</h2>

            <p>Fees section.</p>

          </div>

        );



      case "letters-of-demand":

        return (

          <div className="content-panel">

            <h2>Letters of Demand</h2>

            <p>Letters of demand will be created here.</p>

          </div>

        );



      case "section-41":

        return (

          <div className="content-panel">

            <h2>Section 41</h2>

            <p>Section 41 notices will be created here.</p>

          </div>

        );



      case "email":

        return (

          <div className="content-panel">

            <h2>Email</h2>

            <p>Email communication will be managed here.</p>

          </div>

        );



      case "sms":

        return (

          <div className="content-panel">

            <h2>SMS</h2>

            <p>SMS communication will be managed here.</p>

          </div>

        );



      default:

        return (

          <div className="content-panel">

            <h2>Coming Soon</h2>

            <p>This section is under construction.</p>

          </div>

        );

    }

  };



  return (

    <div className="dashboard-page">

      <aside className="sidebar">

        <div className="sidebar-header">

          <div className="logo-container">

            <img src={logo} alt="EduClear Logo" className="logo" />

          </div>

          <h2>Da Silva Academy</h2>

          <p>EduClear</p>

        </div>



        <button

          className={`menu-item ${activeMenu === "dashboard" ? "active" : ""}`}

          onClick={() => setActiveMenu("dashboard")}

        >

          Dashboard

        </button>



        <div className="menu-group">

          <button className="menu-item" onClick={() => toggleSection("business")}>

            Business

          </button>



          {openSection === "business" && (

            <div className="submenu">

              <button className="submenu-item">School Profile</button>

              <button className="submenu-item">Package</button>

              <button className="submenu-item">Users</button>

            </div>

          )}

        </div>



        <div className="menu-group">

          <button className="menu-item" onClick={() => toggleSection("administration")}>

            Administration

          </button>



          {openSection === "administration" && (

            <div className="submenu">

              <button

                className="submenu-item"

                onClick={() => setActiveMenu("registrations")}

              >

                Registrations

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("class-registers")}

              >

                Class Registers

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("classrooms")}

              >

                Classrooms

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("attendance")}

              >

                Attendance

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("employees")}

              >

                Employees

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("incidents")}

              >

                Incidents

              </button>

            </div>

          )}

        </div>



        <div className="menu-group">

          <button className="menu-item" onClick={() => toggleSection("billing")}>

            Billing

          </button>



          {openSection === "billing" && (

            <div className="submenu">

              <button

                className="submenu-item"

                onClick={() => setActiveMenu("invoice-runs")}

              >

                Invoice Runs

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("billing-plans")}

              >

                Billing Plans

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("billing-reports")}

              >

                Billing Reports

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("billing-documents")}

              >

                Billing Documents

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("statements")}

              >

                Statements

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("invoices")}

              >

                Invoices

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("payments")}

              >

                Payments

              </button>



              <button className="submenu-item" onClick={() => setActiveMenu("fees")}>

                Fees

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("letters-of-demand")}

              >

                Letters of Demand

              </button>



              <button

                className="submenu-item"

                onClick={() => setActiveMenu("section-41")}

              >

                Section 41

              </button>

            </div>

          )}

        </div>



        <div className="menu-group">

          <button className="menu-item" onClick={() => toggleSection("communication")}>

            Communication

          </button>



          {openSection === "communication" && (

            <div className="submenu">

              <button className="submenu-item" onClick={() => setActiveMenu("email")}>

                Email

              </button>



              <button className="submenu-item" onClick={() => setActiveMenu("sms")}>

                SMS

              </button>

            </div>

          )}

        </div>

      </aside>



      <main className="main-content">

        <div className="main-header">

          <h1>Hello Da Silva Academy!</h1>

          <p>School Management Dashboard</p>

        </div>



        {renderContent()}

      </main>

    </div>

  );

}

