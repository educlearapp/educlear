import { useState } from "react";
import logo from "../assets/logo.png";


type ProfileTab = "general" | "contact" | "address" | "billing" | "password";



type Props = {



  go: (page: any) => void;



};



export default function SchoolProfilePage({ go }: Props) {



  const [profileTab, setProfileTab] = useState<ProfileTab>("general");



  const [menuOpen, setMenuOpen] = useState(false);



  const tabClass = (tab: ProfileTab) =>



    profileTab === tab ? "profile-tab active" : "profile-tab";



  return (



    <div className="profile-page">



      <div className="profile-actions">



        <button type="button" onClick={() => go("dashboard")} className="profile-btn">



          ↩ Back



        </button>



        <button type="button" onClick={() => alert("Profile saved")} className="profile-btn">



          💾 Save



        </button>



        <div className="profile-menu-wrap">



          <button



            type="button"



            onClick={() => setMenuOpen(!menuOpen)}



            className="profile-btn"



          >



            More Actions⌄



          </button>



          {menuOpen && (



            <div className="profile-menu">



              <button type="button" onClick={() => document.getElementById("schoolLogoUpload")?.click()}>



                Upload Logo



              </button>



              <button type="button" onClick={() => go("schoolPackage")}>



                Change Package



              </button>



              <button type="button" onClick={() => window.print()}>



                Print Profile



              </button>



              <button



                type="button"



                onClick={() => {



                  if (confirm("Are you sure you want to close this account?")) {



                    alert("Close account request confirmed");



                  }



                }}



              >



                Close Account



              </button>



            </div>



          )}



        </div>



        <input



          id="schoolLogoUpload"



          type="file"



          accept="image/*"



          style={{ display: "none" }}



          onChange={() => alert("Logo selected")}



        />



      </div>



      <div className="profile-card">



      <aside className="profile-side">



<span>School</span>



</aside>



        <main className="profile-main">



          <div className="profile-tabs">



            <button type="button" onClick={() => setProfileTab("general")} className={tabClass("general")}>General</button>



            <button type="button" onClick={() => setProfileTab("contact")} className={tabClass("contact")}>Contact</button>



            <button type="button" onClick={() => setProfileTab("address")} className={tabClass("address")}>Address</button>



            <button type="button" onClick={() => setProfileTab("billing")} className={tabClass("billing")}>Billing</button>



            <button type="button" onClick={() => setProfileTab("password")} className={tabClass("password")}>Password</button>



          </div>



          <div className="profile-form">



            {profileTab === "general" && (



              <>



                <div className="form-row"><label>Business Name</label><input value="Da Silva Academy" readOnly /></div>



                <div className="form-row"><label>Registered Email</label><input value="dasilvaacademy@gmail.com" readOnly /></div>



                <div className="form-row"><label>Package</label><input value="Legendary Package" readOnly /></div>



                <div className="form-row"><label>Package Until</label><input value="8 October 2026" readOnly /></div>



                <div className="form-row"><label>Automatic Renew</label><input value="No" readOnly /></div>



                <div className="form-row"><label>Automatic Billing</label><input value="No" readOnly /></div>



              </>



            )}



            {profileTab === "contact" && (



              <>



                <div className="form-row"><label>Tel No</label><input value="0145925613" readOnly /></div>



                <div className="form-row"><label>Cell No</label><input value="0825765507" readOnly /></div>



                <div className="form-row"><label>Fax No</label><input value="0145925613" readOnly /></div>



                <div className="form-row"><label>Email</label><input value="tonydasilva@dasilvaacademy.com" readOnly /></div>



              </>



            )}



            {profileTab === "address" && (



              <>



                <div className="form-row"><label>Physical Address</label><input value="212 Klopper Street" readOnly /></div>



                <div className="form-row"><label></label><input value="Rustenburg" readOnly /></div>



                <div className="form-row"><label></label><input value="0299" readOnly /></div>



                <div className="form-row"><label></label><input placeholder="Physical Address Line 4" readOnly /></div>



                <div className="form-row"><label>Postal Address</label><input value="212 Klopper Street" readOnly /></div>



                <div className="form-row"><label></label><input value="Bodorp" readOnly /></div>



                <div className="form-row"><label></label><input value="Rustenburg" readOnly /></div>



                <div className="form-row"><label></label><input value="0299" readOnly /></div>



              </>



            )}



            {profileTab === "billing" && (



              <>



                <div className="form-row"><label>Banking Details</label><input value="Da Silva Academy" readOnly /></div>



                <div className="form-row"><label></label><input value="TymeBank        FNB" readOnly /></div>



                <div className="form-row"><label></label><input value="Account number: 53001618107        Account Number: 62839285542" readOnly /></div>



                <div className="form-row"><label></label><input value="Branch code: 678910        Rustenburg Square Branch" readOnly /></div>



              </>



            )}



            {profileTab === "password" && (



              <>



                <div className="form-row"><label>New Password</label><input type="password" /></div>



                <div className="form-row"><label>Confirm Password</label><input type="password" /></div>



              </>



            )}



          </div>



        </main>



      </div>



    </div>



  );



}