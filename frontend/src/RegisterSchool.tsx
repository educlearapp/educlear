import { useEffect, useMemo, useState, type FormEvent } from "react";



import { useNavigate } from "react-router-dom";



import { API_URL } from "./api";



import logo from "./assets/logo.icon.png";



const gold = "#D4AF37";



const goldSoft = "rgba(212, 175, 55, 0.22)";



const bg = "#050508";



function isValidEmail(email: string) {



  const e = String(email || "").trim().toLowerCase();



  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);



}



function fullLogoUrl(url: string) {



  if (!url) return "";



  if (url.startsWith("http")) return url;



  return `${API_URL}${url.startsWith("/") ? url : `/${url}`}`;



}



const features = [



  "Learner registrations and profiles",



  "Fees, invoices, statements and payments",



  "Payroll, payslips and staff records",



  "Parent communication and digital records",



  "Reports, documents and school administration",



  "Role-based access for school staff",



];



export default function RegisterSchool() {



  const navigate = useNavigate();



  const [showForm, setShowForm] = useState(false);



  const [form, setForm] = useState({



    schoolName: "EduClear Test School",



    contactPerson: "",



    email: "",



    phone: "",



    password: "",



    confirmPassword: "",



  });



  const [logoFile, setLogoFile] = useState<File | null>(null);



  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);



  const [status, setStatus] = useState<{



    type: "idle" | "loading" | "error" | "success";



    message?: string;



  }>({ type: "idle" });



  useEffect(() => {



    return () => {



      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);



    };



  }, [logoPreviewUrl]);



  const canSubmit = useMemo(() => {



    if (!String(form.schoolName).trim()) return false;



    if (!String(form.contactPerson).trim()) return false;



    if (!isValidEmail(form.email)) return false;



    if (!String(form.phone).trim()) return false;



    if (String(form.password).length < 8) return false;



    if (form.password !== form.confirmPassword) return false;



    return true;



  }, [form]);



  async function uploadLogo() {



    if (!logoFile) return "";



    const fd = new FormData();



    fd.append("logo", logoFile);



    const res = await fetch(`${API_URL}/api/upload-logo`, {



      method: "POST",



      body: fd,



    });



    const data = await res.json();



    if (!res.ok || !data?.success || !data?.url) {



      throw new Error(data?.error || "Logo upload failed");



    }



    const finalUrl = fullLogoUrl(String(data.url));



    localStorage.setItem("schoolLogoUrl", finalUrl);



    return finalUrl;



  }



  async function submit(e: FormEvent) {



    e.preventDefault();



    if (!canSubmit) {



      setStatus({ type: "error", message: "Please complete all fields correctly." });



      return;



    }



    setStatus({ type: "loading", message: "Creating your school..." });



    try {



      const logoUrl = await uploadLogo();



      localStorage.setItem("schoolName", form.schoolName || "EduClear Test School");



      if (logoUrl) localStorage.setItem("schoolLogoUrl", logoUrl);



      setStatus({



        type: "success",



        message: "Registration successful. Opening dashboard...",



      });



      navigate("/dashboard");



    } catch (err: any) {



      setStatus({ type: "error", message: err?.message || "Registration failed" });



    }



  }



  const inputLight = {



    width: "100%" as const,



    padding: "12px 14px",



    borderRadius: 12,



    border: "1px solid rgba(15, 15, 20, 0.12)",



    background: "rgba(250, 250, 252, 0.95)",



    color: "#0f0f14",



    outline: "none" as const,



    fontSize: 15,



    boxSizing: "border-box" as const,



  };



  return (



    <>



      <style>{`



        .reg-school-page {



          position: relative;



          min-height: 100vh;



          display: grid;



          grid-template-columns: ${showForm ? "minmax(0, 1fr) minmax(420px, 0.72fr)" : "1fr"};



          grid-template-rows: auto auto;



          align-content: start;



          background: ${bg};



        }



        .reg-school-brand {



          position: relative;



          padding: ${showForm ? "34px 48px 48px" : "34px 48px 64px"};



          display: flex;



          flex-direction: column;



          justify-content: flex-start;



          align-items: center;



          width: 100%;



          box-sizing: border-box;



          background: linear-gradient(160deg, #08080c 0%, #0c0c12 45%, #060608 100%);



          border-right: ${showForm ? `1px solid ${goldSoft}` : "none"};



          overflow: hidden;



        }



        .reg-school-brand::before {



          content: "";



          position: absolute;



          inset: 0;



          background:



            radial-gradient(circle at 20% 8%, rgba(212,175,55,0.12), transparent 30%),



            radial-gradient(circle at 85% 15%, rgba(212,175,55,0.08), transparent 28%);



          pointer-events: none;



        }



        .reg-school-content {



          display: flex;



          flex-direction: column;



          justify-content: flex-start;



          align-items: ${showForm ? "stretch" : "center"};



          text-align: ${showForm ? "left" : "center"};



          width: 100%;



          max-width: ${showForm ? "760px" : "900px"};



          margin-left: auto;



          margin-right: auto;



          padding: ${showForm ? "40px 40px 32px" : "60px 48px"};



          box-sizing: border-box;



        }



        .reg-school-logo-wrap {



          display: flex;



          justify-content: center;



          margin-bottom: ${showForm ? "22px" : "26px"};



        }



        .reg-school-logo {



          width: clamp(320px, 34vw, 380px);



          max-width: 100%;



          height: auto;



          object-fit: contain;



          display: block;



          border: none;



          outline: none;



          box-shadow: none;



          background: transparent;



        }



        .reg-school-kicker {



          margin-bottom: 10px;



          font-weight: 900;



          font-size: 12px;



          letter-spacing: 0.28em;



          text-transform: uppercase;



          color: ${gold};



        }



        .reg-school-title {



          margin: 0 0 14px;



          font-size: ${showForm ? "clamp(1.7rem, 3vw, 2.55rem)" : "clamp(2rem, 4vw, 3.45rem)"};



          line-height: 1.08;



          font-weight: 900;



          color: #fafafa;



          max-width: 850px;



          width: 100%;



        }



        .reg-school-copy {



          margin: 0 0 20px;



          color: rgba(255,255,255,0.78);



          font-size: ${showForm ? "15px" : "16px"};



          line-height: 1.55;



          max-width: 850px;



        }



        .reg-school-features {



          display: grid;



          grid-template-columns: ${showForm ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))"};



          gap: 12px;



          margin-top: 18px;



          width: 100%;



          max-width: 850px;



        }



        .reg-school-feature-card {



          padding: 10px 14px;



          border-radius: 10px;



          border: 1px solid rgba(212, 175, 55, 0.25);



          background: rgba(255, 255, 255, 0.02);



          color: #e5e7eb;



          font-size: 13px;



          line-height: 1.4;



          white-space: nowrap;



          overflow: hidden;



          text-overflow: ellipsis;



        }



        .reg-school-form-wrap {



          grid-column: 2;



          grid-row: 1;



          padding: clamp(24px, 4vw, 48px);



          display: flex;



          flex-direction: column;



          justify-content: center;



          align-items: stretch;



          background: linear-gradient(180deg, #f7f6f3 0%, #efede8 100%);



        }



        .reg-school-footer {



          grid-column: 1 / -1;



          grid-row: 2;



          position: relative;



          width: 100%;



          box-sizing: border-box;



          padding: 20px 16px 28px;



          text-align: center;



          font-size: 12px;



          line-height: 1.6;



          color: rgba(255,255,255,0.62);



          letter-spacing: 0.06em;



        }



        .reg-school-footer a {



          color: ${gold};



          text-decoration: none;



        }



        .reg-school-footer a:hover {



          text-decoration: underline;



        }



        @media (max-width: 1024px) {



          .reg-school-page {



            grid-template-columns: 1fr;



          }



          .reg-school-brand {



            min-height: auto;



            padding: 88px 24px 40px;



            border-right: none;



            border-bottom: 1px solid ${goldSoft};



          }



          .reg-school-form-wrap {



            grid-column: 1;



            grid-row: auto;



            min-height: 0;



          }



          .reg-school-logo {



            width: clamp(300px, 78vw, 380px);



          }



          .reg-school-features {



            grid-template-columns: 1fr;



          }



          .reg-school-footer {



            padding: 16px 16px 24px;



            background: ${bg};



          }



        }



      `}</style>



<div className="reg-school-page" style={{ minHeight: "80vh" }}>



        <aside className="reg-school-brand">



          <div



            style={{



              position: "absolute",



              top: "clamp(18px, 3vw, 28px)",



              right: "clamp(18px, 3vw, 28px)",



              display: "flex",



              gap: 12,



              zIndex: 5,



            }}



          >



            <button



              type="button"



              onClick={() => navigate("/login")}



              style={{



                padding: "10px 18px",



                borderRadius: 999,



                background: "transparent",



                border: `1px solid ${gold}`,



                color: "#fff",



                fontWeight: 800,



                cursor: "pointer",



              }}



            >



              Login



            </button>



            {!showForm && (



              <button



                type="button"



                onClick={() => setShowForm(true)}



                style={{



                  padding: "10px 18px",



                  borderRadius: 999,



                  background: gold,



                  border: `1px solid ${gold}`,



                  color: "#151515",



                  fontWeight: 800,



                  cursor: "pointer",



                }}



              >



                Register Your School



              </button>



            )}



          </div>



          <div className="reg-school-content">



            <div className="reg-school-logo-wrap">



            <img



src={logo}



alt="EduClear"



className="reg-school-logo"



style={{



  width: "400px",



  maxWidth: "95%",



  filter: "drop-shadow(0 0 24px rgba(212,175,55,0.55))",



}}



/>



            </div>



            <div className="reg-school-kicker">Premium school management</div>



            <h1 className="reg-school-title">



              Run your school with clarity, confidence and control.



            </h1>



            <p className="reg-school-copy">



              EduClear brings registrations, learner management, billing, statements,



              payments, payroll, reports and parent communication into one professional



              school management platform. Built for schools that want to look professional,



              stay organised and manage their finances with confidence.



            </p>



            <div className="reg-school-features">



              {features.map((item) => (



                <div key={item} className="reg-school-feature-card">



                  {item}



                </div>



              ))}



            </div>



          </div>



        </aside>



        {showForm && (



          <div className="reg-school-form-wrap">



            <div



              style={{



                width: "100%",



                maxWidth: 460,



                margin: "0 auto",



                borderRadius: 20,



                padding: "clamp(24px, 4vw, 36px)",



                background: "#fffef9",



                border: `1px solid ${goldSoft}`,



                boxShadow:



                  "0 4px 6px rgba(0,0,0,0.04), 0 24px 48px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",



              }}



            >



              <h2



                style={{



                  margin: "0 0 6px",



                  fontSize: "clamp(1.35rem, 2.5vw, 1.6rem)",



                  fontWeight: 800,



                  color: "#121218",



                  letterSpacing: -0.02,



                }}



              >



                Register Your School



              </h2>



              <p



                style={{



                  margin: "0 0 22px",



                  color: "rgba(15,15,20,0.55)",



                  fontSize: 14,



                  lineHeight: 1.5,



                }}



              >



                This creates a new school and a secure admin login.



              </p>



              <form onSubmit={submit}>



                {[



                  { key: "schoolName", label: "School name", type: "text" },



                  { key: "contactPerson", label: "Contact person", type: "text" },



                  { key: "email", label: "Email", type: "email" },



                  { key: "phone", label: "Phone", type: "tel" },



                  { key: "password", label: "Password", type: "password" },



                  { key: "confirmPassword", label: "Confirm password", type: "password" },



                ].map((f) => (



                  <div key={f.key} style={{ marginBottom: 14 }}>



                    <div



                      style={{



                        fontWeight: 700,



                        fontSize: 12,



                        marginBottom: 6,



                        color: "rgba(15,15,20,0.75)",



                      }}



                    >



                      {f.label}



                    </div>



                    <input



                      value={(form as any)[f.key]}



                      onChange={(e) =>



                        setForm((prev) => ({ ...prev, [f.key]: e.target.value }))



                      }



                      type={f.type}



                      style={inputLight}



                    />



                  </div>



                ))}



                <div style={{ marginBottom: 16 }}>



                  <div



                    style={{



                      fontWeight: 700,



                      fontSize: 12,



                      marginBottom: 6,



                      color: "rgba(15,15,20,0.75)",



                    }}



                  >



                    School logo



                  </div>



                  <input



                    type="file"



                    accept="image/png,image/jpeg,image/webp"



                    onChange={(e) => {



                      const file = e.target.files?.[0] || null;



                      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);



                      if (!file) {



                        setLogoFile(null);



                        setLogoPreviewUrl(null);



                        return;



                      }



                      setLogoFile(file);



                      setLogoPreviewUrl(URL.createObjectURL(file));



                    }}



                    style={{



                      ...inputLight,



                      padding: "10px 12px",



                      fontSize: 14,



                    }}



                  />



                  {logoPreviewUrl && (



                    <img



                      src={logoPreviewUrl}



                      alt="School logo preview"



                      style={{



                        maxHeight: 72,



                        marginTop: 12,



                        display: "block",



                        borderRadius: 10,



                      }}



                    />



                  )}



                </div>



                <button



                  type="submit"



                  disabled={!canSubmit || status.type === "loading"}



                  style={{



                    width: "100%",



                    padding: "14px 16px",



                    borderRadius: 12,



                    background: canSubmit ? gold : "rgba(212,175,55,0.4)",



                    border: `1px solid ${gold}`,



                    color: "#151515",



                    fontWeight: 800,



                    cursor: canSubmit ? "pointer" : "not-allowed",



                    fontSize: 15,



                    letterSpacing: 0.02,



                    boxShadow: canSubmit



                      ? "0 8px 24px rgba(212, 175, 55, 0.35)"



                      : "none",



                  }}



                >



                  {status.type === "loading" ? "Registering..." : "Register Your School"}



                </button>



                {status.type !== "idle" && (



                  <div



                    style={{



                      marginTop: 14,



                      fontWeight: 700,



                      color: "#1a1a22",



                      fontSize: 14,



                    }}



                  >



                    {status.message}



                  </div>



                )}



              </form>



            </div>



          </div>



        )}



        <div className="reg-school-footer">



          © 2026 EduClear. All rights reserved.{" "}



          <a href="mailto:info@educlear.co.za">info@educlear.co.za</a>



        </div>



      </div>



    </>



  );



}