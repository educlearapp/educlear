import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../../api";
import "./Registrations.css";
import { calculateLearnerAge } from "../../learner/learnerIdentity";
import { isActiveEnrollment } from "../../utils/learnerGender";



type ParentRelationship = {



  id?: string;



  firstName?: string;



  surname?: string;



  email?: string;



  cellNo?: string;



  relationship?: any;



};



type AnyRecord = Record<string, any>;



const GOLD = "#d4af37";



const GOLD_LIGHT = "#f3e7bd";



const GOLD_SOFT = "rgba(212,175,55,0.10)";



const PAGE_BG = "#f3f0e8";



const DARK = "#111827";



const BORDER = "#eadcae";



const HEADER = "#101820";



const RED = "#b42318";



const pageSize = 10;



function value(v: any) {



  return v === undefined || v === null || v === "" ? "" : String(v);



}



function dash(v: any) {



  return value(v) || "-";



}



function learnerFirstName(l: AnyRecord) {



  return l.firstName || l.name || "";



}



function learnerSurname(l: AnyRecord) {



  return l.surname || l.lastName || "";



}



function learnerClass(l: AnyRecord) {



  return l.classroom || l.className || l.grade || "";



}



function parentsOf(l: AnyRecord) {



  const directParents = Array.isArray(l?.parents) ? l.parents : [];



  return directParents.map((p: AnyRecord) => ({



    ...p,



    relationship:



      p.relationship ||



      p.parentRelationship ||



      p.relation ||



      p.link?.relation ||



      p.parent?.relationship ||



      "",



  }));



}



function primaryParent(l: AnyRecord) {



  const parents = parentsOf(l);



  return parents.find((p: AnyRecord) => p.isPrimary) || parents[0] || null;



}



function btnStyle(kind: "gold" | "plain" | "danger" | "blue" = "plain"): React.CSSProperties {



  return {



    border: `1px solid ${kind === "gold" ? "#b89122" : kind === "danger" ? "#f1b5b5" : BORDER}`,



    background: kind === "gold" ? GOLD : kind === "danger" ? "#fff5f5" : kind === "blue" ? "#eef6ff" : "#fff",



    color: kind === "danger" ? RED : DARK,



    borderRadius: 8,



    padding: "8px 13px",



    fontWeight: 800,



    fontSize: 13,



    cursor: "pointer",



    minHeight: 34,



  };



}



const inputStyle: React.CSSProperties = {



  width: "100%",



  border: `1px solid ${BORDER}`,



  borderRadius: 6,



  padding: "9px 10px",



  fontSize: 13,



  background: "#fff",



  color: DARK,

  WebkitTextFillColor: DARK,

  boxSizing: "border-box",



};



const thStyle: React.CSSProperties = {



  background: GOLD_LIGHT,



  border: `1px solid ${BORDER}`,



  padding: "9px",



  textAlign: "left",



  fontSize: 13,



  fontWeight: 900,



  color: DARK,



};



const tdStyle: React.CSSProperties = {



  border: `1px solid ${BORDER}`,



  padding: "9px",



  fontSize: 13,



};



export default function Registrations(props: AnyRecord) {
  const {
    learners = [],
    parents = [],
    schoolId = "",
    onAddLearner,
    onOpenLearner,
  } = props;

  const [search, setSearch] = useState("");



  const [showUnenrolled, setShowUnenrolled] = useState(false);



  const [page, setPage] = useState(1);



  const [localLearners, setLocalLearners] = useState<AnyRecord[]>(Array.isArray(learners) ? learners : []);



  const [localParents, setLocalParents] = useState<AnyRecord[]>(Array.isArray(parents) ? parents : []);

  const [registrationStats, setRegistrationStats] = useState<{
    children: number;
    parents: number;
    boys: number;
    girls: number;
    classrooms: number;
    averageClassroomSize: number;
  } | null>(null);

  const [registrationStatsLoading, setRegistrationStatsLoading] = useState(false);



  const [selectedLearnerId, setSelectedLearnerId] = useState<string>(



    learners?.[0]?.id ? String(learners[0].id) : ""



  );



  useEffect(() => {



    if (Array.isArray(learners)) {



      const savedEdits = JSON.parse(localStorage.getItem("registrationLearnerEdits") || "{}");



      const mergedLearners = learners.map((learner: AnyRecord) => {
        const edits = savedEdits[String(learner.id)] || {};
        const meaningfulEdits = Object.fromEntries(
          Object.entries(edits).filter(([key, value]) => {
            if (key === "parents") return Array.isArray(value) && value.length > 0;
            if (value === "" || value === null || value === undefined) return false;
            if (typeof value === "string" && !value.trim()) return false;
            return true;
          })
        );

        return {
          ...learner,
          ...meaningfulEdits,
          parents: Array.isArray(meaningfulEdits.parents)
            ? meaningfulEdits.parents
            : Array.isArray(learner.parents)
              ? learner.parents
              : [],
        };
      });



setLocalLearners(mergedLearners);



      if (!selectedLearnerId && learners[0]) {
        setSelectedLearnerId(String(learners[0].id));
      }



    }



  }, [learners]);



  useEffect(() => {
    if (Array.isArray(parents)) setLocalParents(parents);
  }, [parents]);

  useEffect(() => {
    const sid = String(schoolId || "").trim();
    if (!sid) {
      setRegistrationStats(null);
      setRegistrationStatsLoading(false);
      return;
    }
    let cancelled = false;
    setRegistrationStats(null);
    setRegistrationStatsLoading(true);
    fetch(`${API_URL}/api/registrations/stats?schoolId=${encodeURIComponent(sid)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.success || !data?.stats) {
          setRegistrationStats(null);
          return;
        }
        if (import.meta.env.DEV && Array.isArray(data?.debug?.sampleLearners)) {
          console.info("[EduClear Dev] Registrations stats sample learners", data.debug.sampleLearners);
        }
        setRegistrationStats({
          children: Number(data.stats.children ?? 0),
          parents: Number(data.stats.parents ?? 0),
          boys: Number(data.stats.boys ?? 0),
          girls: Number(data.stats.girls ?? 0),
          classrooms: Number(data.stats.classrooms ?? 0),
          averageClassroomSize: Number(
            data.stats.averageClassroomSize ?? data.stats.avg ?? 0
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setRegistrationStats(null);
      })
      .finally(() => {
        if (!cancelled) setRegistrationStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info("[EduClear Dev] Registrations view", {
      schoolId: String(schoolId || ""),
      apiUrl: API_URL,
      learnersCount: Array.isArray(learners) ? learners.length : 0,
      parentsCount: Array.isArray(parents) ? parents.length : 0,
    });
  }, [schoolId, learners, parents]);



  const selectedLearner =



    localLearners.find((l) => String(l.id) === String(selectedLearnerId)) || null;



  const statsDisplay = (key: keyof NonNullable<typeof registrationStats>) => {
    if (registrationStatsLoading || !registrationStats) return "—";
    return registrationStats[key];
  };



  const filteredLearners = useMemo(() => {



    const q = search.trim().toLowerCase();



    return localLearners.filter((learner) => {



      if (!showUnenrolled) {
        const status = String(learner.status || learner.childStatus || "").toLowerCase();
        if (status === "unenrolled" || status === "historical") return false;
        if (String(learner.enrollmentStatus || "").toUpperCase() === "HISTORICAL") return false;
      }



      if (!q) return true;



      const p = primaryParent(learner);



      return [



        learnerFirstName(learner),



        learnerSurname(learner),



        learnerClass(learner),



        learner.idNumber,



        (p as AnyRecord)?.firstName,



        (p as AnyRecord)?.surname,
        
        
        
        (p as AnyRecord)?.idNumber,
        
        
        
        (p as AnyRecord)?.cellNo,
        
        
        
        (p as AnyRecord)?.email,



      ].filter(Boolean).join(" ").toLowerCase().includes(q);



    });



  }, [localLearners, search, showUnenrolled]);



  const totalPages = Math.max(1, Math.ceil(filteredLearners.length / pageSize));



  const safePage = Math.min(page, totalPages);



  const pagedLearners = filteredLearners.slice((safePage - 1) * pageSize, safePage * pageSize);



  const firstItem = filteredLearners.length === 0 ? 0 : (safePage - 1) * pageSize + 1;



  const lastItem = Math.min(safePage * pageSize, filteredLearners.length);
  function selectLearner(learner: AnyRecord) {
    setSelectedLearnerId(String(learner.id));
  }

  function openManageLearner(learner: AnyRecord) {
    if (!learner) return;
    localStorage.setItem("selectedLearnerForManage", JSON.stringify(learner));
    onOpenLearner?.(learner);
  }

  function handleAddLearner() {
    localStorage.removeItem("selectedLearnerForSibling");
    onAddLearner?.();
  }

  function handleAddSibling() {
    const base = selectedLearner || localLearners[0] || null;
    if (base) {
      localStorage.setItem("selectedLearnerForSibling", JSON.stringify(base));
    }
    onAddLearner?.();
  }

  function handleManage() {
    if (selectedLearner) openManageLearner(selectedLearner);
    else if (pagedLearners[0]) openManageLearner(pagedLearners[0]);
  }



  function StatCard({ icon, value, label, color }: AnyRecord) {



    return (



      <div



        style={{



          flex: "1 1 160px",



          minWidth: 160,



          border: `1px solid ${BORDER}`,



          background: "#fffaf0",



          display: "flex",



          alignItems: "center",



          gap: 12,



          padding: "18px 20px",



          minHeight: 74,



        }}



      >



        <div



          style={{



            width: 42,



            height: 42,



            borderRadius: 999,



            background: color,



            color: "#fff",



            display: "grid",



            placeItems: "center",



            fontSize: 20,



            fontWeight: 900,



          }}



        >



          {icon}



        </div>



        <div>



          <div style={{ fontSize: 25, fontWeight: 800, color }}>{value}</div>



          <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.15 }}>{label}</div>



        </div>



      </div>



    );



  }



  function renderList() {



    return (



      <div style={{ padding: 30, color: DARK, background: PAGE_BG, minHeight: "100vh" }}>



        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 22 }}>



          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: GOLD }}>Registrations</h1>



          <span style={{ color: "#6b7280", fontSize: 15 }}>› Manage your registrations</span>



        </div>



        <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 22 }}>



          <StatCard icon="👥" value={statsDisplay("children")} label="children" color="#7a9b28" />



          <StatCard icon="👥" value={statsDisplay("parents")} label="parents" color="#7a9b28" />



          <StatCard icon="♂" value={statsDisplay("boys")} label="boys" color="#4f9fd7" />



          <StatCard icon="♀" value={statsDisplay("girls")} label="girls" color="#c94b4b" />



          <StatCard icon="⌂" value={statsDisplay("classrooms")} label="classrooms" color="#c89c2d" />



          <StatCard
            icon="☷"
            value={statsDisplay("averageClassroomSize")}
            label="average classroom size"
            color="#6856ad"
          />



        </div>



        <div style={{ border: `1px solid ${BORDER}`, background: "#fffaf0", borderRadius: 16, overflow: "hidden" }}>



          <div style={{ background: HEADER, color: GOLD, padding: "14px 18px", fontWeight: 900, fontSize: 20 }}>



            Children



          </div>



          <div



            style={{



              display: "grid",



              gridTemplateColumns: "auto auto auto 1fr auto auto auto",



              gap: 8,



              alignItems: "center",



              padding: 14,



              borderBottom: `1px solid ${BORDER}`,



              background: "#fffaf0",



            }}



          >



            <button style={btnStyle("gold")} onClick={handleAddLearner}>+ Add</button>



            <button style={btnStyle("plain")} onClick={handleAddSibling}>+ Add Sibling</button>



            <button style={btnStyle("plain")} onClick={handleManage}>▱ Manage</button>



            <div />



            <select



              style={inputStyle}



              value={showUnenrolled ? "show" : "hide"}



              onChange={(e) => {



                setShowUnenrolled(e.target.value === "show");



                setPage(1);



              }}



            >



              <option value="hide">Hide Unenrolled</option>



              <option value="show">Show Unenrolled</option>



            </select>



            <select style={inputStyle}>



              <option>All Groups</option>



            </select>



            <select style={inputStyle}>



              <option>All Classrooms</option>



            </select>



            <input



              style={{ ...inputStyle, gridColumn: "1 / -1", maxWidth: 360 }}



              value={search}



              onChange={(e) => {



                setSearch(e.target.value);



                setPage(1);



              }}



              placeholder="Search"

              className="registrations-search-input"



            />



          </div>



          <table style={{ width: "100%", borderCollapse: "collapse" }}>



            <thead>



              <tr>



                <th style={thStyle}>Name</th>



                <th style={thStyle}>Surname</th>



                <th style={thStyle}>Classroom</th>



                <th style={thStyle}>Age</th>



                <th style={thStyle}>Child Status</th>



              </tr>



            </thead>



            <tbody>



              {pagedLearners.map((learner, index) => (



                <tr



                  key={learner.id || index}



                  onClick={() => selectLearner(learner)}



                  onDoubleClick={() => openManageLearner(learner)}



                  style={{



                    background:



                      String(selectedLearnerId) === String(learner.id)



                        ? "rgba(212,175,55,0.22)"



                        : index % 2 === 0



                        ? "#fff"



                        : GOLD_SOFT,



                    cursor: "pointer",



                  }}



                >



                  <td style={tdStyle}>{dash(learnerFirstName(learner)).toUpperCase()}</td>



                  <td style={tdStyle}>{dash(learnerSurname(learner)).toUpperCase()}</td>



                  <td style={tdStyle}>{dash(learnerClass(learner))}</td>



                  <td style={tdStyle}>
                    {calculateLearnerAge(learner.birthDate || learner.dateOfBirth || learner.dob)}
                  </td>



                  <td style={{ ...tdStyle, color: "#2f7d32", fontWeight: 700 }}>{dash(learner.status || "Enrolled")}</td>



                </tr>



              ))}



            </tbody>



          </table>



          <div



            style={{



              padding: 12,



              display: "flex",



              justifyContent: "space-between",



              alignItems: "center",



              fontSize: 13,



              background: "#fffaf0",



            }}



          >



            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>



              <button style={btnStyle("plain")} disabled={safePage <= 1} onClick={() => setPage(1)}>«</button>



              <button style={btnStyle("plain")} disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>



              <span style={{ padding: "0 8px", fontWeight: 800 }}>



                Page {safePage} / {totalPages}



              </span>



              <button style={btnStyle("plain")} disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>



              <button style={btnStyle("plain")} disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>»</button>



            </div>



            <span style={{ fontWeight: 800 }}>



              {firstItem} - {lastItem} / {filteredLearners.length}



            </span>



          </div>



        </div>



      </div>



    );



  }

  return renderList();

}
