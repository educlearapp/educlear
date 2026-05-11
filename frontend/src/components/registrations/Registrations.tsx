import React, { useEffect, useMemo, useState } from "react";



type AnyRecord = Record<string, any>;



type ViewMode = "list" | "profile";



type TabKey = "general" | "billing" | "medical" | "groups" | "other" | "extra";



type ModalKey = "none" | "email" | "sms";



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



function fullLearnerName(l: AnyRecord) {



  return `${learnerFirstName(l)} ${learnerSurname(l)}`.trim();



}



function parentName(p: AnyRecord) {



  return `${p?.firstName || p?.name || ""} ${p?.surname || p?.lastName || ""}`.trim();



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



  boxSizing: "border-box",



};



const labelStyle: React.CSSProperties = {



  width: 150,



  minWidth: 150,



  textAlign: "right",



  paddingRight: 12,



  fontSize: 13,



  fontWeight: 800,



  color: "#374151",



};



const rowStyle: React.CSSProperties = {



  display: "flex",



  alignItems: "center",



  marginBottom: 8,



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



function FieldRow({



  label,



  children,



  required = false,



}: {



  label: string;



  children: React.ReactNode;



  required?: boolean;



}) {



  return (



    <div style={rowStyle}>



      <div style={labelStyle}>{required ? `* ${label}` : label}</div>



      <div style={{ flex: 1 }}>{children}</div>



    </div>



  );



}



function TabButton({



  tab,



  label,



  activeTab,



  setActiveTab,



}: {



  tab: TabKey;



  label: string;



  activeTab: TabKey;



  setActiveTab: React.Dispatch<React.SetStateAction<TabKey>>;



}) {



  return (



    <button



      onClick={() => setActiveTab(tab)}



      style={{



        border: `1px solid ${BORDER}`,



        borderBottom: activeTab === tab ? "1px solid #fff" : `1px solid ${BORDER}`,



        background: activeTab === tab ? "#fff" : GOLD_SOFT,



        color: activeTab === tab ? GOLD : DARK,



        padding: "10px 18px",



        fontWeight: activeTab === tab ? 900 : 700,



        cursor: "pointer",



        minWidth: 86,



      }}



    >



      {label}



    </button>



  );



}



export default function Registrations(props: AnyRecord) {



  const { learners = [], parents = [], onAddLearner } = props;



  const [viewMode, setViewMode] = useState<ViewMode>("list");



  const [activeTab, setActiveTab] = useState<TabKey>("general");



  const [modal, setModal] = useState<ModalKey>("none");



  const [search, setSearch] = useState("");



  const [showUnenrolled, setShowUnenrolled] = useState(false);



  const [page, setPage] = useState(1);



  const [localLearners, setLocalLearners] = useState<AnyRecord[]>(Array.isArray(learners) ? learners : []);



  const [localParents, setLocalParents] = useState<AnyRecord[]>(Array.isArray(parents) ? parents : []);



  const [selectedLearnerId, setSelectedLearnerId] = useState<string>(



    learners?.[0]?.id ? String(learners[0].id) : ""



  );



  const [learnerDraft, setLearnerDraft] = useState<AnyRecord>(



    learners?.[0] ? { ...learners[0] } : {}



  );



  const [parentDraft, setParentDraft] = useState<AnyRecord>({});



  const [selectedParentId, setSelectedParentId] = useState("");



  const [parentMode, setParentMode] = useState<"none" | "add" | "manage" | "existing">("none");



  const [existingParentId, setExistingParentId] = useState("");



  const [moreOpen, setMoreOpen] = useState(false);



  const [emailDraft, setEmailDraft] = useState({



    description: "",



    subject: "",



    text: "",



  });



  const [smsDraft, setSmsDraft] = useState({



    description: "",



    text: "",



  });



  useEffect(() => {



    if (Array.isArray(learners)) {



      const savedEdits = JSON.parse(localStorage.getItem("registrationLearnerEdits") || "{}");



      const mergedLearners = learners.map((learner: AnyRecord) => {



        const edits = savedEdits[String(learner.id)] || {};
      
      
      
        return {
      
      
      
          ...learner,
      
      
      
          ...edits,
      
      
      
          parents: Array.isArray(edits.parents)
      
      
      
            ? edits.parents
      
      
      
            : Array.isArray(learner.parents)
      
      
      
              ? learner.parents
      
      
      
              : [],
      
      
      
        };
      
      
      
      });



setLocalLearners(mergedLearners);



      if (!selectedLearnerId && learners[0]) {



        openProfile(learners[0], false);



      }



    }



  }, [learners]);



  useEffect(() => {



    if (Array.isArray(parents)) setLocalParents(parents);



  }, [parents]);



  const selectedLearner =



    localLearners.find((l) => String(l.id) === String(selectedLearnerId)) || null;



  const selectedParents = parentsOf(selectedLearner || {});



  const selectedParent =



    selectedParents.find((p: AnyRecord) => String(p.id) === String(selectedParentId)) ||



    primaryParent(selectedLearner || {}) ||



    null;



  const stats = useMemo(() => {



    const total = localLearners.length;



    const boys = localLearners.filter((l) => String(l.gender || "").toLowerCase() === "male").length;



    const girls = localLearners.filter((l) => String(l.gender || "").toLowerCase() === "female").length;



    const classroomSet = new Set(localLearners.map(learnerClass).filter(Boolean));



    return {



      children: total,



      parents: localParents.length,



      boys,



      girls,



      classrooms: classroomSet.size,



      avg: classroomSet.size ? Math.round(total / classroomSet.size) : 0,



    };



  }, [localLearners, localParents]);



  const filteredLearners = useMemo(() => {



    const q = search.trim().toLowerCase();



    return localLearners.filter((learner) => {



      if (!showUnenrolled && String(learner.status || "Enrolled").toLowerCase() === "unenrolled") return false;



      if (!q) return true;



      const p = primaryParent(learner);



      return [



        learnerFirstName(learner),



        learnerSurname(learner),



        learnerClass(learner),



        learner.idNumber,



        p?.firstName,



        p?.surname,



        p?.idNumber,



        p?.cellNo,



        p?.email,



      ].filter(Boolean).join(" ").toLowerCase().includes(q);



    });



  }, [localLearners, search, showUnenrolled]);



  const totalPages = Math.max(1, Math.ceil(filteredLearners.length / pageSize));



  const safePage = Math.min(page, totalPages);



  const pagedLearners = filteredLearners.slice((safePage - 1) * pageSize, safePage * pageSize);



  const firstItem = filteredLearners.length === 0 ? 0 : (safePage - 1) * pageSize + 1;



  const lastItem = Math.min(safePage * pageSize, filteredLearners.length);
  function openProfile(learner: AnyRecord, switchView = true) {



    setSelectedLearnerId(String(learner.id));



    setLearnerDraft({ ...learner });



    const p = primaryParent(learner);



    setSelectedParentId(p?.id ? String(p.id) : "");



    setParentDraft(p ? { ...p } : {});



    setParentMode("none");



    setActiveTab("general");



    if (switchView) setViewMode("profile");



  }



  function goBack() {



    setViewMode("list");



    setMoreOpen(false);



    setModal("none");



  }



  function handleAddLearner() {



    const blank = {



      id: `local-learner-${Date.now()}`,



      firstName: "",



      surname: "",



      idNumber: "",



      birthDate: "",



      gender: "",



      classroom: "",



      status: "Enrolled",



      parents: [],



    };



    setLocalLearners((prev) => [blank, ...prev]);



    openProfile(blank, true);



    onAddLearner?.();



  }



  function handleAddSibling() {



    const base = selectedLearner || localLearners[0] || {};



    const sibling = {



      id: `local-sibling-${Date.now()}`,



      firstName: "",



      surname: learnerSurname(base),



      idNumber: "",



      birthDate: "",



      gender: "",



      classroom: learnerClass(base),



      status: "Enrolled",



      parents: parentsOf(base),



    };



    setLocalLearners((prev) => [sibling, ...prev]);



    openProfile(sibling, true);



  }



  function handleManage() {



    if (selectedLearner) openProfile(selectedLearner, true);



    else if (pagedLearners[0]) openProfile(pagedLearners[0], true);



  }



  function saveLearner() {



    if (!selectedLearner) return;
  
  
  
    const updated = {
  
  
  
      ...selectedLearner,
  
  
  
      ...learnerDraft,
  
  
  
      firstName: learnerDraft.firstName || learnerDraft.name || "",
  
  
  
      name: learnerDraft.firstName || learnerDraft.name || "",
  
  
  
      surname: learnerDraft.surname || learnerDraft.lastName || "",
  
  
  
      lastName: learnerDraft.surname || learnerDraft.lastName || "",
  
  
  
      classroom: learnerDraft.classroom || learnerDraft.className || learnerDraft.grade || "",
  
  
  
      className: learnerDraft.classroom || learnerDraft.className || learnerDraft.grade || "",
  
  
  
      grade: learnerDraft.classroom || learnerDraft.className || learnerDraft.grade || "",
  
  
  
    };
  
  
  
    const savedEdits = JSON.parse(localStorage.getItem("registrationLearnerEdits") || "{}");
  
    const updatedWithParents = {



      ...updated,
    
    
    
      parents: parentsOf(updated).map((p: AnyRecord) => ({
    
    
    
        ...p,
    
    
    
        relationship: p.relationship || "",
    
    
    
      })),
    
    
    
    };
  
    savedEdits[String(updated.id)] = updatedWithParents;
  
  
  
    localStorage.setItem("registrationLearnerEdits", JSON.stringify(savedEdits));
  
  
  
    setLocalLearners((prev) =>
  
  
  
      prev.map((l) => (String(l.id) === String(updated.id) ? updated : l))
  
  
  
    );
  
  
  
    setLearnerDraft(updatedWithParents);
  
  
  
    alert("Learner saved.");
  
  
  
  }








  function openEmailWindow() {



    const p = selectedParent || primaryParent(selectedLearner || {});



    setEmailDraft({



      description: "",



      subject: "",



      text: "",



    });



    setMoreOpen(false);



    setModal("email");



    if (p) {



      setSelectedParentId(String(p.id || ""));



      setParentDraft({ ...p });



    }



  }



  function openSmsWindow() {



    const p = selectedParent || primaryParent(selectedLearner || {});



    setSmsDraft({



      description: "",



      text: "",



    });



    setMoreOpen(false);



    setModal("sms");



    if (p) {



      setSelectedParentId(String(p.id || ""));



      setParentDraft({ ...p });



    }



  }



  function sendEmail() {



    alert("Email prepared. Backend email sending can be connected next.");



    setModal("none");



  }



  function sendSms() {



    alert("SMS prepared. SMS credits/sending can be connected next.");



    setModal("none");



  }



  function unenrolLearner() {



    if (!selectedLearner) return;



    const updated = { ...selectedLearner, status: "Unenrolled" };



    setLocalLearners((prev) =>



      prev.map((l) => String(l.id) === String(updated.id) ? updated : l)



    );



    setLearnerDraft(updated);



    alert("Learner marked as unenrolled.");



    setMoreOpen(false);



  }



  function deleteLearner() {



    if (!selectedLearner) return;



    if (!window.confirm("Delete this learner from the local list?")) return;



    setLocalLearners((prev) =>



      prev.filter((l) => String(l.id) !== String(selectedLearner.id))



    );



    setViewMode("list");



    setMoreOpen(false);



  }



  function startAddParent() {



    setParentMode("add");



    setParentDraft({



      id: `local-parent-${Date.now()}`,



      relationship: "",



      firstName: "",



      surname: "",



      idNumber: "",



      cellNo: "",



      email: "",



      workNo: "",



      isPrimary: parentsOf(selectedLearner || {}).length === 0,



    });



  }



  function startExistingParent() {



    setParentMode("existing");



    setExistingParentId("");



  }



  function startManageParent() {



    const p =



      selectedParents.find((parent: AnyRecord) => String(parent.id) === String(selectedParentId)) ||



      primaryParent(selectedLearner || {});



    if (!p) {



      startAddParent();



      return;



    }



    setParentDraft({ ...p });



    setSelectedParentId(String(p.id));



    setParentMode("manage");



  }



  function saveParent() {



    if (!selectedLearner) return;
  
  
  
    const relationshipValue = String(parentDraft.relationship || "").trim();
  
  
  
    const savedParent = {
  
  
  
      ...parentDraft,
  
  
  
      id: parentDraft.id || `local-parent-${Date.now()}`,
  
  
  
      firstName: parentDraft.firstName || parentDraft.name || "",
  
  
  
      name: parentDraft.firstName || parentDraft.name || "",
  
  
  
      surname: parentDraft.surname || parentDraft.lastName || "",
  
  
  
      lastName: parentDraft.surname || parentDraft.lastName || "",
  
  
  
      relationship: relationshipValue,
  
  
  
      cellNo: parentDraft.cellNo || parentDraft.cell || "",
  
  
  
      cell: parentDraft.cellNo || parentDraft.cell || "",
  
  
  
      workNo: parentDraft.workNo || parentDraft.work || "",
  
  
  
      work: parentDraft.workNo || parentDraft.work || "",
  
  
  
      email: parentDraft.email || "",
  
  
  
      idNumber: parentDraft.idNumber || "",
  
  
  
      isPrimary:
  
  
  
        parentDraft.isPrimary !== undefined
  
  
  
          ? parentDraft.isPrimary
  
  
  
          : parentsOf(selectedLearner).length === 0,
  
  
  
    };
  
  
  
    const currentParents = parentsOf(selectedLearner);
  
  
  
    const parentExists = currentParents.some(
  
  
  
      (p: AnyRecord) => String(p.id) === String(savedParent.id)
  
  
  
    );
  
  
  
    const nextParents = parentExists
  
  
  
      ? currentParents.map((p: AnyRecord) =>
  
  
  
          String(p.id) === String(savedParent.id)
  
  
  
            ? {
  
  
  
                ...p,
  
  
  
                ...savedParent,
  
  
  
                relationship: relationshipValue || p.relationship || "",
  
  
  
              }
  
  
  
            : p
  
  
  
        )
  
  
  
      : [...currentParents, savedParent];
  
  
  
    const updatedLearner = {
  
  
  
      ...selectedLearner,
  
  
  
      parents: nextParents,
  
  
  
    };
  
  
  
    setLocalParents((prev) => {
  
  
  
      const exists = prev.some(
  
  
  
        (p: AnyRecord) => String(p.id) === String(savedParent.id)
  
  
  
      );
  
  
  
      return exists
  
  
  
        ? prev.map((p: AnyRecord) =>
  
  
  
            String(p.id) === String(savedParent.id)
  
  
  
              ? { ...p, ...savedParent }
  
  
  
              : p
  
  
  
          )
  
  
  
        : [...prev, savedParent];
  
  
  
    });
  
  
  
    setLocalLearners((prev) =>
  
  
  
      prev.map((learner) =>
  
  
  
        String(learner.id) === String(selectedLearner.id) ? updatedLearner : learner
  
  
  
      )
  
  
  
    );
  
  
  
    const savedEdits = JSON.parse(
  
  
  
      localStorage.getItem("registrationLearnerEdits") || "{}"
  
  
  
    );
  
  
  
    savedEdits[String(updatedLearner.id)] = updatedLearner;
  
  
  
    localStorage.setItem("registrationLearnerEdits", JSON.stringify(savedEdits));
  
  
  
    setLearnerDraft(updatedLearner);
  
  
  
    setSelectedParentId(String(savedParent.id));
  
  
  
    setParentDraft(savedParent);
  
  
  
    setParentMode("none");
  
  
  
  }



  function linkExistingParent() {



    if (!selectedLearner || !existingParentId) return;



    const found = localParents.find((p) => String(p.id) === String(existingParentId));



    if (!found) return;



    setParentDraft({



      ...found,
    
    
    
      relationship:
    
    
    
        found.relationship ||
    
    
    
        parentsOf(selectedLearner).find(
    
    
    
          (p: AnyRecord) => String(p.id) === String(found.id),
    
    
    
        )?.relationship ||
    
    
    
        "",
    
    
    
      isPrimary: parentsOf(selectedLearner).length === 0,
    
    
    
    });



    setParentMode("add");



  }



  function removeParent() {



    if (!selectedLearner) return;



    const parentToRemove =



      selectedParents.find((p: AnyRecord) => String(p.id) === String(selectedParentId)) ||



      primaryParent(selectedLearner);



    if (!parentToRemove) return;



    if (!window.confirm("Remove this parent from the selected learner?")) return;



    setLocalLearners((prev) =>



      prev.map((learner) => {



        if (String(learner.id) !== String(selectedLearner.id)) return learner;



        return {



          ...learner,



          parents: parentsOf(learner).filter(



            (p: AnyRecord) => String(p.id) !== String(parentToRemove.id)



          ),



        };



      })



    );



    setSelectedParentId("");



    setParentDraft({});



    setParentMode("none");



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



          <StatCard icon="👥" value={stats.children} label="children" color="#7a9b28" />



          <StatCard icon="👥" value={stats.parents} label="parents" color="#7a9b28" />



          <StatCard icon="♂" value={stats.boys} label="boys" color="#4f9fd7" />



          <StatCard icon="♀" value={stats.girls} label="girls" color="#c94b4b" />



          <StatCard icon="⌂" value={stats.classrooms} label="classrooms" color="#c89c2d" />



          <StatCard icon="☷" value={stats.avg} label="average classroom size" color="#6856ad" />



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



                  onClick={() => openProfile(learner, false)}



                  onDoubleClick={() => openProfile(learner, true)}



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



                  <td style={tdStyle}>{dash(learner.age)}</td>



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
  function renderGeneralTab() {



    return (



      <div>



        <FieldRow label="Name / Nickname" required>



          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 6 }}>



            <input



              style={inputStyle}



              value={learnerDraft.firstName || learnerDraft.name || ""}



              onChange={(e) =>



                setLearnerDraft({ ...learnerDraft, firstName: e.target.value, name: e.target.value })



              }



            />



            <input



              style={inputStyle}



              placeholder="Nickname"



              value={learnerDraft.nickname || ""}



              onChange={(e) => setLearnerDraft({ ...learnerDraft, nickname: e.target.value })}



            />



          </div>



        </FieldRow>



        <FieldRow label="Surname" required>



          <input



            style={inputStyle}



            value={learnerDraft.surname || learnerDraft.lastName || ""}



            onChange={(e) =>



              setLearnerDraft({ ...learnerDraft, surname: e.target.value, lastName: e.target.value })



            }



          />



        </FieldRow>



        <FieldRow label="ID No">



          <input



            style={inputStyle}



            placeholder="ID No"



            value={learnerDraft.idNumber || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, idNumber: e.target.value })}



          />



        </FieldRow>



        <FieldRow label="Birth Date" required>



          <input



            style={inputStyle}



            placeholder="YYYY/MM/DD"



            value={learnerDraft.birthDate || learnerDraft.dateOfBirth || ""}



            onChange={(e) =>



              setLearnerDraft({ ...learnerDraft, birthDate: e.target.value, dateOfBirth: e.target.value })



            }



          />



        </FieldRow>



        <FieldRow label="Gender">



          <select



            style={inputStyle}



            value={learnerDraft.gender || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, gender: e.target.value })}



          >



            <option value="">Gender</option>



            <option>Male</option>



            <option>Female</option>



          </select>



        </FieldRow>



        <FieldRow label="Classroom">



          <input



            style={inputStyle}



            value={learnerDraft.classroom || learnerDraft.className || learnerDraft.grade || ""}



            onChange={(e) =>



              setLearnerDraft({



                ...learnerDraft,



                classroom: e.target.value,



                className: e.target.value,



                grade: e.target.value,



              })



            }



          />



        </FieldRow>



        <FieldRow label="Home Language">



          <input



            style={inputStyle}



            placeholder="Home Language"



            value={learnerDraft.homeLanguage || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, homeLanguage: e.target.value })}



          />



        </FieldRow>



        <FieldRow label="Nationality">



          <input



            style={inputStyle}



            placeholder="Nationality"



            value={learnerDraft.nationality || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, nationality: e.target.value })}



          />



        </FieldRow>



        <FieldRow label="Religion">



          <input



            style={inputStyle}



            placeholder="Religion"



            value={learnerDraft.religion || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, religion: e.target.value })}



          />



        </FieldRow>



        <FieldRow label="Enrolment Date">



          <input



            style={inputStyle}



            placeholder="Enrolment Date"



            value={learnerDraft.enrolmentDate || learnerDraft.enrollmentDate || ""}



            onChange={(e) =>



              setLearnerDraft({



                ...learnerDraft,



                enrolmentDate: e.target.value,



                enrollmentDate: e.target.value,



              })



            }



          />



        </FieldRow>



        <FieldRow label="Notes">



          <textarea



            style={{ ...inputStyle, minHeight: 115 }}



            placeholder="Notes"



            value={learnerDraft.notes || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, notes: e.target.value })}



          />



        </FieldRow>



      </div>



    );



  }



  function renderBillingTab() {



    return (



      <div>



        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>



          <button style={btnStyle("plain")} onClick={() => alert("Add billing item")}>+ Add</button>



          <button style={btnStyle("plain")} onClick={() => alert("New billing item")}>+ New</button>



          <button style={btnStyle("danger")} onClick={() => alert("Remove billing item")}>× Remove</button>



          <button style={btnStyle("blue")} onClick={() => alert("Move up")}>↑ Move Up</button>



          <button style={btnStyle("blue")} onClick={() => alert("Move down")}>↓ Move Down</button>



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse" }}>



          <thead>



            <tr>



              <th style={thStyle}>Description</th>



              <th style={thStyle}>Type</th>



              <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>



              <th style={thStyle}></th>



            </tr>



          </thead>



          <tbody>



            <tr>



              <td style={tdStyle}>{learnerDraft.billingDescription || "PRIMARY 2026"}</td>



              <td style={tdStyle}>{learnerDraft.billingType || "Monthly Fee"}</td>



              <td style={{ ...tdStyle, textAlign: "right" }}>{learnerDraft.billingAmount || "3000.00"}</td>



              <td style={tdStyle}>



                <button style={btnStyle("plain")} onClick={() => alert("Edit billing item")}>✎</button>



              </td>



            </tr>



            <tr>



              <td style={tdStyle}>Total</td>



              <td style={tdStyle}></td>



              <td style={{ ...tdStyle, textAlign: "right" }}>{learnerDraft.billingAmount || "3000.00"}</td>



              <td style={tdStyle}></td>



            </tr>



          </tbody>



        </table>



      </div>



    );



  }



  function renderMedicalTab() {



    return (



      <div>



        {[



          ["doctorName", "Doctor Name"],



          ["doctorNo", "Doctor No"],



          ["doctorAddress1", "Doctor Address"],



          ["doctorAddress2", ""],



          ["doctorAddress3", ""],



          ["doctorAddress4", ""],



          ["medicalAidNo", "Medical Aid No"],



          ["medicalAidName", "Medical Aid Name"],



          ["medicalAidMember", "Medical Aid Member"],



          ["allergies", "Allergies"],



        ].map(([key, label]) => (



          <FieldRow key={key} label={label}>



            <input



              style={inputStyle}



              placeholder={label || "Doctor Address Line"}



              value={learnerDraft[key] || ""}



              onChange={(e) => setLearnerDraft({ ...learnerDraft, [key]: e.target.value })}



            />



          </FieldRow>



        ))}



        <FieldRow label="Medical Notes">



          <textarea



            style={{ ...inputStyle, minHeight: 115 }}



            placeholder="Medical Notes"



            value={learnerDraft.medicalNotes || ""}



            onChange={(e) => setLearnerDraft({ ...learnerDraft, medicalNotes: e.target.value })}



          />



        </FieldRow>



      </div>



    );



  }
  function renderGroupsTab() {



    const groups = Array.isArray(learnerDraft.groups) ? learnerDraft.groups : ["Fire Team"];



    return (



      <div>



        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>



          <button



            style={btnStyle("plain")}



            onClick={() => {



              const name = window.prompt("Group name");



              if (!name) return;



              setLearnerDraft({ ...learnerDraft, groups: [...groups, name] });



            }}



          >



            + Add



          </button>



          <button



            style={btnStyle("danger")}



            onClick={() => setLearnerDraft({ ...learnerDraft, groups: groups.slice(0, -1) })}



          >



            × Remove



          </button>



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse" }}>



          <thead>



            <tr>



              <th style={thStyle}>Name</th>



            </tr>



          </thead>



          <tbody>



            {groups.map((group: string, index: number) => (



              <tr key={`${group}-${index}`}>



                <td style={tdStyle}>{group}</td>



              </tr>



            ))}



          </tbody>



        </table>



      </div>



    );



  }



  function renderOtherTab() {



    return (



      <div>



        <FieldRow label="Height / Weight">



          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>



            <input



              style={inputStyle}



              placeholder="Height"



              value={learnerDraft.height || ""}



              onChange={(e) => setLearnerDraft({ ...learnerDraft, height: e.target.value })}



            />



            <input



              style={inputStyle}



              placeholder="Weight"



              value={learnerDraft.weight || ""}



              onChange={(e) => setLearnerDraft({ ...learnerDraft, weight: e.target.value })}



            />



          </div>



        </FieldRow>



      </div>



    );



  }



  function renderExtraTab() {



    return (



      <div>



        {Array.from({ length: 10 }).map((_, index) => {



          const key = `extraField${index + 1}`;



          return (



            <FieldRow key={key} label={`Extra Field ${index + 1}`}>



              <input



                style={inputStyle}



                value={learnerDraft[key] || ""}



                onChange={(e) => setLearnerDraft({ ...learnerDraft, [key]: e.target.value })}



              />



            </FieldRow>



          );



        })}



      </div>



    );



  }



  function renderParentEditor() {



    if (parentMode === "existing") {



      return (



        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14, marginTop: 14 }}>



          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>



            <select



              style={{ ...inputStyle, maxWidth: 340 }}



              value={existingParentId}



              onChange={(e) => setExistingParentId(e.target.value)}



            >



              <option value="">Select existing parent</option>



              {localParents.map((parent) => (



                <option key={parent.id} value={parent.id}>



                  {parentName(parent)} - {parent.cellNo || parent.email || ""}



                </option>



              ))}



            </select>



            <button style={btnStyle("gold")} onClick={linkExistingParent}>



              Link Parent



            </button>



          </div>



        </div>



      );



    }



    if (parentMode !== "add" && parentMode !== "manage") return null;



    return (



      <div



        style={{



          borderTop: `1px solid ${BORDER}`,



          marginTop: 14,



          paddingTop: 14,



          display: "grid",



          gridTemplateColumns: "1fr 1fr",



          gap: 14,



        }}



      >



        <div>



          <FieldRow label="Relationship">



            <input



              style={inputStyle}



              value={parentDraft.relationship || ""}



              onChange={(e) => {



               
              
              
              
                setParentDraft({
              
              
              
                  ...parentDraft,
              
              
              
                  relationship: e.target.value,
              
              
              
                });
              
              
              
              }}



            />



          </FieldRow>



          <FieldRow label="Name">



            <input



              style={inputStyle}



              value={parentDraft.firstName || ""}



              onChange={(e) => setParentDraft({ ...parentDraft, firstName: e.target.value })}



            />



          </FieldRow>



          <FieldRow label="Surname">



            <input



              style={inputStyle}



              value={parentDraft.surname || ""}



              onChange={(e) => setParentDraft({ ...parentDraft, surname: e.target.value })}



            />



          </FieldRow>



          <FieldRow label="ID Number">



            <input



              style={inputStyle}



              value={parentDraft.idNumber || ""}



              onChange={(e) => setParentDraft({ ...parentDraft, idNumber: e.target.value })}



            />



          </FieldRow>



        </div>



        <div>



          <FieldRow label="Cell">



            <input



              style={inputStyle}



              value={parentDraft.cellNo || ""}



              onChange={(e) => setParentDraft({ ...parentDraft, cellNo: e.target.value })}



            />



          </FieldRow>



          <FieldRow label="Email">



            <input



              style={inputStyle}



              value={parentDraft.email || ""}



              onChange={(e) => setParentDraft({ ...parentDraft, email: e.target.value })}



            />



          </FieldRow>



          <FieldRow label="Work">



            <input



              style={inputStyle}



              value={parentDraft.workNo || ""}



              onChange={(e) => setParentDraft({ ...parentDraft, workNo: e.target.value })}



            />



          </FieldRow>



          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>



            <button style={btnStyle("plain")} onClick={() => setParentMode("none")}>



              Cancel



            </button>



            <button style={btnStyle("gold")} onClick={saveParent}>



              Save Parent



            </button>



          </div>



        </div>



      </div>



    );



  }
  function renderMessageModal() {



    if (modal === "none") return null;



    const isEmail = modal === "email";



    const p = selectedParent || primaryParent(selectedLearner || {});



    const recipientName = parentName(p || {});



    const recipientContact = isEmail ? p?.email || "" : p?.cellNo || "";



    return (



      <div



        style={{



          position: "fixed",



          inset: 0,



          background: "rgba(15,23,42,0.45)",



          zIndex: 9999,



          display: "grid",



          placeItems: "center",



          padding: 20,



        }}



      >



        <div



          style={{



            width: "min(760px, 96vw)",



            background: "#fffaf0",



            border: `1px solid ${BORDER}`,



            borderRadius: 16,



            boxShadow: "0 25px 70px rgba(0,0,0,0.25)",



            overflow: "hidden",



          }}



        >



          <div



            style={{



              background: HEADER,



              color: GOLD,



              padding: "14px 18px",



              fontWeight: 900,



              fontSize: 20,



            }}



          >



            {isEmail ? "Send Email" : "Send SMS"}



          </div>



          <div style={{ padding: 18 }}>



            <FieldRow label="To">



              <input



                style={inputStyle}



                readOnly



                value={



                  recipientName



                    ? `${recipientName}${recipientContact ? ` — ${recipientContact}` : ""}`



                    : recipientContact || "No recipient selected"



                }



              />



            </FieldRow>



            <FieldRow label="Description">



              <input



                style={inputStyle}



                value={isEmail ? emailDraft.description : smsDraft.description}



                onChange={(e) =>



                  isEmail



                    ? setEmailDraft({ ...emailDraft, description: e.target.value })



                    : setSmsDraft({ ...smsDraft, description: e.target.value })



                }



              />



            </FieldRow>



            {isEmail && (



              <FieldRow label="Subject">



                <input



                  style={inputStyle}



                  value={emailDraft.subject}



                  onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}



                />



              </FieldRow>



            )}



            <FieldRow label="Message">



              <textarea



                style={{ ...inputStyle, minHeight: isEmail ? 190 : 130 }}



                value={isEmail ? emailDraft.text : smsDraft.text}



                onChange={(e) =>



                  isEmail



                    ? setEmailDraft({ ...emailDraft, text: e.target.value })



                    : setSmsDraft({ ...smsDraft, text: e.target.value })



                }



              />



            </FieldRow>



            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>



              <button style={btnStyle("plain")} onClick={() => setModal("none")}>



                Cancel



              </button>



              <button style={btnStyle("gold")} onClick={isEmail ? sendEmail : sendSms}>



                Send



              </button>



            </div>



          </div>



        </div>



      </div>



    );



  }



  function renderProfile() {



    return (



      <div style={{ padding: 26, background: PAGE_BG, minHeight: "100vh" }}>



        {renderMessageModal()}



        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>



          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: GOLD }}>



            Registration



          </h1>



          <span style={{ color: "#6b7280", fontSize: 15 }}>› Manage child and parent information</span>



        </div>



        <div style={{ display: "flex", gap: 10, marginBottom: 14, position: "relative" }}>



          <button style={btnStyle("plain")} onClick={goBack}>



            ↩ Back



          </button>



          <button style={btnStyle("gold")} onClick={saveLearner}>



            💾 Save



          </button>



          <div style={{ position: "relative" }}>



            <button style={btnStyle("plain")} onClick={() => setMoreOpen((v) => !v)}>



              More Actions ▾



            </button>



            {moreOpen && (



              <div



                style={{



                  position: "absolute",



                  top: 40,



                  left: 0,



                  width: 220,



                  background: "#fff",



                  border: `1px solid ${BORDER}`,



                  boxShadow: "0 10px 28px rgba(0,0,0,0.12)",



                  zIndex: 100,



                  borderRadius: 10,



                  overflow: "hidden",



                }}



              >



                <button



                  style={{



                    ...btnStyle("plain"),



                    width: "100%",



                    border: "none",



                    borderBottom: `1px solid ${BORDER}`,



                    textAlign: "left",



                    borderRadius: 0,



                  }}



                  onClick={openEmailWindow}



                >



                  Send Email



                </button>



                <button



                  style={{



                    ...btnStyle("plain"),



                    width: "100%",



                    border: "none",



                    borderBottom: `1px solid ${BORDER}`,



                    textAlign: "left",



                    borderRadius: 0,



                  }}



                  onClick={openSmsWindow}



                >



                  Send SMS



                </button>



                <button



                  style={{



                    ...btnStyle("plain"),



                    width: "100%",



                    border: "none",



                    borderBottom: `1px solid ${BORDER}`,



                    textAlign: "left",



                    borderRadius: 0,



                  }}



                  onClick={unenrolLearner}



                >



                  Unenrol



                </button>



                <button



                  style={{



                    ...btnStyle("danger"),



                    width: "100%",



                    border: "none",



                    textAlign: "left",



                    borderRadius: 0,



                  }}



                  onClick={deleteLearner}



                >



                  Delete



                </button>



              </div>



            )}



          </div>



        </div>
        <div style={{ border: `1px solid ${BORDER}`, background: "#fffaf0", borderRadius: 16, overflow: "hidden" }}>



          <div style={{ background: HEADER, color: GOLD, padding: "14px 18px", fontWeight: 900, fontSize: 20 }}>



            Child



          </div>



          <div style={{ display: "flex", padding: 14, gap: 16 }}>



            <div



              style={{



                width: 128,



                height: 128,



                border: `1px solid ${BORDER}`,



                background: GOLD_SOFT,



                display: "grid",



                placeItems: "center",



                color: "#64748b",



                fontSize: 12,



              }}



            >



              Photo



            </div>



            <div style={{ flex: 1 }}>



              <div style={{ display: "flex", gap: 0, marginBottom: 14 }}>



                <TabButton tab="general" label="General" activeTab={activeTab} setActiveTab={setActiveTab} />



                <TabButton tab="billing" label="Billing" activeTab={activeTab} setActiveTab={setActiveTab} />



                <TabButton tab="medical" label="Medical" activeTab={activeTab} setActiveTab={setActiveTab} />



                <TabButton tab="groups" label="Groups" activeTab={activeTab} setActiveTab={setActiveTab} />



                <TabButton tab="other" label="Other" activeTab={activeTab} setActiveTab={setActiveTab} />



                <TabButton tab="extra" label="Extra" activeTab={activeTab} setActiveTab={setActiveTab} />



              </div>



              <div style={{ border: `1px solid ${BORDER}`, padding: 16, minHeight: 360, background: "#fff" }}>



                {activeTab === "general" && renderGeneralTab()}



                {activeTab === "billing" && renderBillingTab()}



                {activeTab === "medical" && renderMedicalTab()}



                {activeTab === "groups" && renderGroupsTab()}



                {activeTab === "other" && renderOtherTab()}



                {activeTab === "extra" && renderExtraTab()}



              </div>



            </div>



          </div>



        </div>



        <div style={{ border: `1px solid ${BORDER}`, background: "#fffaf0", marginTop: 16, borderRadius: 16, overflow: "hidden" }}>



          <div style={{ background: HEADER, color: GOLD, padding: "14px 18px", fontWeight: 900, fontSize: 20 }}>



            Parents



          </div>



          <div style={{ padding: 14 }}>



            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>



              <button style={btnStyle("gold")} onClick={startAddParent}>



                + Add



              </button>



              <button style={btnStyle("plain")} onClick={startExistingParent}>



                + Add Existing



              </button>



              <button style={btnStyle("plain")} onClick={startManageParent}>



                ▱ Manage



              </button>



              <button style={btnStyle("danger")} onClick={removeParent}>



                × Remove



              </button>



            </div>



            {renderParentEditor()}



            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>



              <thead>



                <tr>



                  <th style={thStyle}>Relationship</th>



                  <th style={thStyle}>Name</th>



                  <th style={thStyle}>Surname</th>



                  <th style={thStyle}>Parent ID</th>



                  <th style={thStyle}>Cell</th>



                  <th style={thStyle}>Email</th>



                  <th style={thStyle}>Work</th>



                  <th style={thStyle}>Primary</th>



                </tr>



              </thead>



              <tbody>



                {selectedParents.length === 0 ? (



                  <tr>



                    <td style={tdStyle} colSpan={8}>



                      No parent linked to this learner yet.



                    </td>



                  </tr>



                ) : (



                  selectedParents.map((parent: AnyRecord, index: number) => (



                    <tr



                      key={parent.id || index}



                      onClick={() => {



                        setSelectedParentId(String(parent.id || ""));



                        setParentDraft({ ...parent });



                      }}



                      style={{



                        background:



                          String(selectedParentId) === String(parent.id)



                            ? "rgba(212,175,55,0.22)"



                            : index % 2 === 0



                            ? "#fff"



                            : GOLD_SOFT,



                        cursor: "pointer",



                      }}



                    >



<td style={tdStyle}>



{dash(



  parent.relationship ||



    selectedParent?.relationship ||



    parentDraft.relationship ||



    ""



)}



</td>



                      <td style={tdStyle}>{dash(parent.firstName || parent.name)}</td>



                      <td style={tdStyle}>{dash(parent.surname || parent.lastName)}</td>



                      <td style={tdStyle}>{dash(parent.idNumber)}</td>



                      <td style={tdStyle}>{dash(parent.cellNo || parent.cell)}</td>



                      <td style={tdStyle}>{dash(parent.email)}</td>



                      <td style={tdStyle}>{dash(parent.workNo || parent.work)}</td>



                      <td style={tdStyle}>{parent.isPrimary ? "Yes" : "No"}</td>



                    </tr>



                  ))



                )}



              </tbody>



            </table>



          </div>



        </div>



      </div>



    );



  }



  return viewMode === "profile" ? renderProfile() : renderList();



}