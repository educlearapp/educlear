import { useEffect, useMemo, useState } from "react";



import type { CSSProperties } from "react";



import { useNavigate, useParams } from "react-router-dom";



import { API_URL, apiFetch } from "./api";



import educlearLogo from "./assets/logo.png";



type LearnerLike = Record<string, any>;



type SchoolLike = Record<string, any>;



type SubjectResult = {



  subject: string;



  mark: number;



  scoreText: string;



  comment: string;



};



function safeString(value: unknown, fallback = "-") {



  if (value === null || value === undefined) return fallback;



  const s = String(value).trim();



  return s ? s : fallback;



}



function formatDate(value: unknown) {



  if (!value) return "-";



  const d = new Date(String(value));



  if (Number.isNaN(d.getTime())) return "-";



  return d.toISOString().slice(0, 10);



}



function clamp(n: number, min: number, max: number) {



  return Math.max(min, Math.min(max, n));



}



function isHexColor(value: unknown) {



  return typeof value === "string" && /^#([0-9A-F]{3}){1,2}$/i.test(value.trim());



}



function schoolColor(school: SchoolLike | null, keys: string[], fallback: string) {



  for (const key of keys) {



    const v = school?.[key];



    if (isHexColor(v)) return String(v).trim();



  }



  return fallback;



}



function badgeFromAverage(avg: number) {



  if (avg >= 80) return { label: "Excellent", bg: "#16a34a", fg: "#ffffff" };



  if (avg >= 65) return { label: "Good", bg: "#2563eb", fg: "#ffffff" };



  if (avg >= 50) return { label: "Average", bg: "#f59e0b", fg: "#0f172a" };



  return { label: "Needs Support", bg: "#dc2626", fg: "#ffffff" };



}



function guessOverallAverage(results: SubjectResult[]) {



  if (results.length === 0) return 0;



  const sum = results.reduce((acc, r) => acc + (Number.isFinite(r.mark) ? r.mark : 0), 0);



  return Math.round((sum / results.length) * 10) / 10;



}



const placeholderResults: SubjectResult[] = [



  { subject: "English Home Language", mark: 72, scoreText: "72%", comment: "Result data not yet connected" },



  { subject: "Mathematics", mark: 64, scoreText: "64%", comment: "Result data not yet connected" },



  { subject: "Natural Sciences", mark: 70, scoreText: "70%", comment: "Result data not yet connected" },



  { subject: "Social Sciences", mark: 61, scoreText: "61%", comment: "Result data not yet connected" },



  { subject: "Life Orientation", mark: 78, scoreText: "78%", comment: "Result data not yet connected" },



  { subject: "Technology", mark: 66, scoreText: "66%", comment: "Result data not yet connected" },



  { subject: "Creative Arts", mark: 75, scoreText: "75%", comment: "Result data not yet connected" },



];



export default function LearnerDigitalReport() {



  const { learnerId } = useParams();



  const navigate = useNavigate();



  const [loading, setLoading] = useState(true);



  const [learner, setLearner] = useState<LearnerLike | null>(null);



  const [school, setSchool] = useState<SchoolLike | null>(null);



  const [error, setError] = useState("");



  useEffect(() => {



    let cancelled = false;



    const loadReport = async () => {



      try {



        setLoading(true);



        setError("");



        const id = String(learnerId || "").trim();



        const schoolId = localStorage.getItem("schoolId");



        let localLearner: any = null;



        const localKeys = ["selectedLearnerForManage", "selectedLearnerForSibling"];



        for (const key of localKeys) {



          const raw = localStorage.getItem(key);



          if (!raw) continue;



          try {



            const parsed = JSON.parse(raw);



            if (!id || String(parsed?.id || "") === id) {



              localLearner = parsed;



              break;



            }



          } catch {



            localLearner = null;



          }



        }



        let backendLearner: any = null;



        if (id) {



          const learnerUrl = schoolId



            ? `/api/learners?schoolId=${encodeURIComponent(schoolId)}`



            : "/api/learners";



          const data: any = await apiFetch(learnerUrl);



          const list = Array.isArray(data?.learners) ? data.learners : [];



          backendLearner = list.find((item: any) => String(item?.id || "") === id) || null;



        }



        const finalLearner = {



          ...(localLearner || {}),



          ...(backendLearner || {}),



        };



        if (!cancelled) {



          setLearner(finalLearner?.id ? finalLearner : null);



        }



        try {



          const schoolData: any = await apiFetch("/api/schools");



          const schoolList = Array.isArray(schoolData)



            ? schoolData



            : Array.isArray(schoolData?.schools)



              ? schoolData.schools



              : [];



          const match = schoolId



            ? schoolList.find((s: any) => String(s?.id || "") === String(schoolId))



            : schoolList[0];



          if (!cancelled) setSchool(match || null);



        } catch {



          if (!cancelled) setSchool(null);



        }



      } catch (e: any) {



        if (!cancelled) setError(e?.message || "Failed to load report.");



      } finally {



        if (!cancelled) setLoading(false);



      }



    };



    loadReport();



    return () => {



      cancelled = true;



    };



  }, [learnerId]);



  const schoolName = safeString(school?.schoolName || school?.name, "School");



  const schoolPrimary = schoolColor(



    school,



    ["primaryColor", "primaryColour", "brandColor", "brandColour"],



    "#0f172a"



  );



  const schoolSecondary = schoolColor(



    school,



    ["secondaryColor", "secondaryColour", "accentColor", "accentColour"],



    "#d4af37"



  );



  const schoolLogo =



    school?.logoUrl ||



    school?.logo ||



    school?.logoPath ||



    school?.schoolLogo ||



    (school?.logoFilename ? `${API_URL}/uploads/${school.logoFilename}` : null) ||



    educlearLogo;



  const schoolEmail = safeString(school?.email || school?.contactEmail, "");



  const schoolPhone = safeString(school?.phone || school?.cell || school?.telephone, "");



  const schoolAddress = safeString(school?.address || school?.physicalAddress, "");



  const learnerName = useMemo(() => {



    const first = learner?.firstName || learner?.name || "";



    const last = learner?.lastName || learner?.surname || "";



    return safeString(`${first} ${last}`.trim(), "Learner");



  }, [learner]);



  const gradeOrClass = safeString(learner?.classroom || learner?.className || learner?.grade);



  const subjectResults: SubjectResult[] = useMemo(() => {



    const raw = learner?.results || learner?.subjectResults || learner?.subjects || null;



    if (Array.isArray(raw) && raw.length > 0) {



      return raw



        .map((r: any) => {



          const mark = clamp(Number(r.mark ?? r.score ?? r.percentage ?? 0) || 0, 0, 100);



          return {



            subject: safeString(r.subject || r.subjectName || r.name, "Subject"),



            mark,



            scoreText: safeString(r.scoreText || r.percentageText || `${mark}%`),



            comment: safeString(r.comment || r.teacherComment, "—"),



          };



        })



        .slice(0, 12);



    }



    return placeholderResults;



  }, [learner]);



  const overallAverage = useMemo(() => {



    const v = learner?.overallAverage ?? learner?.average ?? null;



    if (v !== null && v !== undefined && String(v).trim() !== "") {



      const n = Number(v);



      if (Number.isFinite(n)) return clamp(Math.round(n * 10) / 10, 0, 100);



    }



    return guessOverallAverage(subjectResults);



  }, [learner, subjectResults]);



  const performanceBadge = badgeFromAverage(overallAverage);



  const passStatus = overallAverage >= 50 ? "Promotion / Pass: Likely" : "Promotion / Pass: At Risk";



  const shellButton: CSSProperties = {



    padding: "10px 14px",



    borderRadius: 12,



    border: "1px solid rgba(212,175,55,0.35)",



    background: "#ffffff",



    color: "#0f172a",



    fontWeight: 900,



    cursor: "pointer",



  };



  return (



    <div style={{ minHeight: "100vh", background: "#f3f0e8" }}>



      <style>{`



        @media print {



          body { background: #ffffff !important; }



          .educlear-no-print { display: none !important; }



          .educlear-report-shell { padding: 0 !important; background: #ffffff !important; }



          .school-report-card { box-shadow: none !important; border-radius: 0 !important; }



        }



      `}</style>



      <div className="educlear-report-shell" style={{ padding: "22px 18px 40px" }}>



        <div style={{ maxWidth: 1100, margin: "0 auto" }}>



          <div



            className="educlear-no-print"



            style={{



              display: "flex",



              justifyContent: "space-between",



              gap: 10,



              flexWrap: "wrap",



              marginBottom: 14,



              background: "#101820",



              border: "1px solid rgba(212,175,55,0.35)",



              borderRadius: 16,



              padding: 14,



            }}



          >



            <button type="button" onClick={() => navigate(-1)} style={shellButton}>



              Back



            </button>



            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>



              <button type="button" onClick={() => window.print()} style={shellButton}>



                Print



              </button>



              <button



                type="button"



                onClick={() => window.print()}



                style={{



                  ...shellButton,



                  border: "none",



                  background: "linear-gradient(135deg, #d4af37, #f5d06f)",



                  color: "#111827",



                }}



              >



                Download PDF



              </button>



              <button



                type="button"



                onClick={() => alert("Email sending to parents will be connected from Classrooms next.")}



                style={{



                  ...shellButton,



                  border: "none",



                  background: "linear-gradient(135deg, #0f172a, #1f2937)",



                  color: "#d4af37",



                }}



              >



                Send to Parent Email



              </button>



            </div>



          </div>



          <div



            className="school-report-card"



            style={{



              background: "#ffffff",



              border: `1px solid ${schoolPrimary}`,



              borderRadius: 18,



              boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",



              overflow: "hidden",



            }}



          >



            <div



              style={{



                padding: "20px 20px 18px",



                borderBottom: `4px solid ${schoolSecondary}`,



                background: schoolPrimary,



                color: "#ffffff",



              }}



            >



              <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", flexWrap: "wrap" }}>



                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>



                  <img



                    src={schoolLogo}



                    alt={schoolName}



                    style={{



                      width: 66,



                      height: 66,



                      borderRadius: 14,



                      objectFit: "contain",



                      border: "2px solid rgba(255,255,255,0.55)",



                      background: "#ffffff",



                      padding: 4,



                    }}



                    onError={(e) => {



                      (e.currentTarget as HTMLImageElement).src = educlearLogo;



                    }}



                  />



                  <div>



                    <div style={{ fontWeight: 950, fontSize: 18 }}>{schoolName}</div>



                    <div style={{ fontWeight: 950, fontSize: 24, marginTop: 2 }}>Digital Learner Report</div>



                    <div style={{ marginTop: 8, color: "rgba(255,255,255,0.88)", fontWeight: 800, fontSize: 12 }}>



                      Reporting period: Term / Month



                    </div>



                    <div style={{ marginTop: 6, color: "rgba(255,255,255,0.80)", fontWeight: 700, fontSize: 11 }}>



                      {[schoolEmail, schoolPhone, schoolAddress].filter(Boolean).join(" • ")}



                    </div>



                  </div>



                </div>



                <div



                  style={{



                    padding: "8px 12px",



                    borderRadius: 999,



                    background: "rgba(255,255,255,0.12)",



                    border: "1px solid rgba(255,255,255,0.22)",



                    fontSize: 12,



                    fontWeight: 900,



                  }}



                >



                  Generated: {new Date().toISOString().slice(0, 10)}



                </div>



              </div>



            </div>



            <div style={{ padding: 18 }}>



              {loading ? (



                <div style={{ color: "#64748b", fontWeight: 700 }}>Loading report…</div>



              ) : error ? (



                <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div>



              ) : !learner ? (



                <div style={{ color: "#0f172a", fontWeight: 800 }}>



                  Learner not found. Please return to classrooms and select a learner report again.



                </div>



              ) : (



                <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 14 }}>



                  <div style={{ gridColumn: "span 12" }}>



                    <div style={{ borderRadius: 16, border: `1px solid ${schoolSecondary}`, background: "#ffffff", padding: 16 }}>



                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>



                        <div>



                          <div style={{ fontSize: 20, fontWeight: 950, color: schoolPrimary }}>{learnerName}</div>



                          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 13 }}>



                            Grade/Class: <span style={{ color: "#0f172a" }}>{gradeOrClass}</span>



                          </div>



                        </div>



                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>



                          <div style={{ padding: "8px 10px", borderRadius: 12, background: `${schoolSecondary}22`, color: schoolPrimary, fontWeight: 900, fontSize: 12 }}>



                            Admission No: {safeString(learner.admissionNumber || learner.admissionNo)}



                          </div>



                          <div style={{ padding: "8px 10px", borderRadius: 12, background: "#f8fafc", color: "#0f172a", fontWeight: 900, fontSize: 12 }}>



                            Learner ID: {safeString(learner.id)}



                          </div>



                        </div>



                      </div>



                      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 10 }}>



                        {[



                          { label: "Gender", value: learner.gender },



                          { label: "Date of Birth", value: formatDate(learner.birthDate || learner.dateOfBirth) },



                          { label: "Home Language", value: learner.homeLanguage },



                          { label: "ID No", value: learner.idNo || learner.idNumber },



                        ].map((item) => (



                          <div key={item.label} style={{ gridColumn: "span 6", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>



                            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>{item.label}</div>



                            <div style={{ marginTop: 6, fontWeight: 850, color: "#0f172a" }}>{safeString(item.value)}</div>



                          </div>



                        ))}



                      </div>



                    </div>



                  </div>



                  <div style={{ gridColumn: "span 12" }}>



                    <div style={{ borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", background: "#ffffff", padding: 16 }}>



                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>



                        <div style={{ fontSize: 15, fontWeight: 950, color: schoolPrimary }}>Academic Summary</div>



                        <div style={{ padding: "7px 10px", borderRadius: 999, background: performanceBadge.bg, color: performanceBadge.fg, fontWeight: 950, fontSize: 12 }}>



                          {performanceBadge.label}



                        </div>



                      </div>



                      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 10 }}>



                        <div style={{ gridColumn: "span 6", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>



                          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Overall average</div>



                          <div style={{ marginTop: 6, fontWeight: 950, color: schoolPrimary, fontSize: 20 }}>{overallAverage}%</div>



                        </div>



                        <div style={{ gridColumn: "span 6", padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>



                          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Status</div>



                          <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>{passStatus}</div>



                        </div>



                        <div style={{ gridColumn: "span 12", padding: 12, borderRadius: 14, border: `1px dashed ${schoolSecondary}`, background: "#fff" }}>



                          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Attendance</div>



                          <div style={{ marginTop: 6, fontWeight: 850, color: "#0f172a" }}>



                            {safeString(learner.attendance, "Attendance data not yet connected")}



                          </div>



                        </div>



                      </div>



                    </div>



                  </div>



                  <div style={{ gridColumn: "span 12" }}>



                    <div style={{ borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", background: "#fff", padding: 16 }}>



                      <div style={{ fontSize: 15, fontWeight: 950, color: schoolPrimary }}>Subject Results</div>



                      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>



                        {subjectResults.map((r) => (



                          <div



                            key={r.subject}



                            style={{



                              display: "grid",



                              gridTemplateColumns: "minmax(0, 1.4fr) 90px 120px minmax(0, 2fr)",



                              gap: 10,



                              alignItems: "start",



                              padding: 12,



                              borderRadius: 14,



                              border: "1px solid rgba(15,23,42,0.08)",



                              background: "#ffffff",



                            }}



                          >



                            <div style={{ fontWeight: 950, color: schoolPrimary }}>{r.subject}</div>



                            <div style={{ fontWeight: 950, color: "#0f172a", textAlign: "right" }}>{r.mark}</div>



                            <div style={{ fontWeight: 900, color: "#64748b", textAlign: "right" }}>{r.scoreText}</div>



                            <div style={{ color: "#0f172a", fontWeight: 650, lineHeight: 1.35 }}>{r.comment}</div>



                          </div>



                        ))}



                      </div>



                    </div>



                  </div>



                  <div style={{ gridColumn: "span 12" }}>



                    <div style={{ borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", background: "#fff", padding: 16 }}>



                      <div style={{ fontSize: 15, fontWeight: 950, color: schoolPrimary }}>Remarks</div>



                      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>



                        <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>



                          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Class teacher remark</div>



                          <div style={{ marginTop: 6, fontWeight: 650, color: "#0f172a", whiteSpace: "pre-wrap" }}>



                            {safeString(learner.classTeacherRemark, "Class teacher remark not yet connected")}



                          </div>



                        </div>



                        <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.08)", background: "#fff" }}>



                          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Principal remark</div>



                          <div style={{ marginTop: 6, fontWeight: 650, color: "#0f172a", whiteSpace: "pre-wrap" }}>



                            {safeString(learner.principalRemark, "Principal remark not yet connected")}



                          </div>



                        </div>



                      </div>



                    </div>



                  </div>



                  <div style={{ gridColumn: "span 12", textAlign: "center", paddingTop: 6, color: "#64748b", fontSize: 11, fontWeight: 700 }}>



                    Generated securely by EduClear for {schoolName}



                  </div>



                </div>



              )}



            </div>



          </div>



        </div>



      </div>



    </div>



  );



}