import React, { useEffect, useMemo, useState } from "react";



type AnyRecord = Record<string, any>;



type RegistrationsProps = {



    learners?: AnyRecord[];
  
  
  
    parents?: AnyRecord[];
  
  
  
    linkedParents?: AnyRecord[];
  
  
  
    classrooms?: AnyRecord[];
  
  
  
    schoolId?: string;
  
  
  
    onSaveLearner?: (learner: AnyRecord) => void;
  
  
  
    onSaveParent?: (parent: AnyRecord, learner: AnyRecord | null) => void;
  
  
  
    onAddLearner?: () => void;
  
  
  
    onAddSibling?: (learner: AnyRecord | null) => void;
  
  
  
    onOpenLearner?: (learner: AnyRecord) => void;
  
  
  
    onOpenParentPortal?: () => void;
  
  
  
  };



const GOLD = "#d4af37";



const DARK = "#111827";



export default function Registrations({



    learners = [],
  
  
  
    parents = [],
  
  
  
    linkedParents = [],
  
  
  
    classrooms = [],
  
  
  
    schoolId,
  
  
  
    onSaveLearner,
  
  
  
    onSaveParent,
  
  
  
    onAddLearner,
  
  
  
    onAddSibling,
  
  
  
    onOpenLearner,
  
  
  
    onOpenParentPortal,
  
  
  
  }: RegistrationsProps) {



  const [search, setSearch] = useState("");



  const [showUnenrolled, setShowUnenrolled] = useState(false);



  const [selectedLearner, setSelectedLearner] = useState<AnyRecord | null>(null);



  const [editingLearner, setEditingLearner] = useState<AnyRecord | null>(null);



  const [editingParent, setEditingParent] = useState<AnyRecord | null>(null);



  const [localParents, setLocalParents] = useState<AnyRecord[]>([]);



  useEffect(() => {



    const allParents = [...parents, ...linkedParents];



    if (allParents.length > 0) {



      setLocalParents(allParents);



      return;



    }



    try {



      const stored =



        localStorage.getItem("educlearParents") ||



        localStorage.getItem("parents") ||



        localStorage.getItem("linkedParents");



      setLocalParents(stored ? JSON.parse(stored) : []);



    } catch {



      setLocalParents([]);



    }



  }, [parents, linkedParents]);



  const safeLearners = useMemo(() => {



    if (learners.length > 0) return learners;



    try {



      const stored =



        localStorage.getItem("educlearLearners") ||



        localStorage.getItem("learners");



      return stored ? JSON.parse(stored) : [];



    } catch {



      return [];



    }



  }, [learners]);



  const fullName = (item: AnyRecord) =>



    `${item?.name || item?.firstName || ""} ${



      item?.surname || item?.lastName || ""



    }`.trim();



  const learnerIdNumber = (learner: AnyRecord) =>



    learner?.idNumber ||



    learner?.learnerIdNumber ||



    learner?.saId ||



    learner?.identityNumber ||



    learner?.idNo ||



    "";



  const parentIdNumber = (parent: AnyRecord) =>



    parent?.idNumber ||



    parent?.parentIdNumber ||



    parent?.identityNumber ||



    parent?.idNo ||



    parent?.saId ||



    "";



  const parentCell = (parent: AnyRecord) =>



    parent?.cell ||



    parent?.cellphone ||



    parent?.mobile ||



    parent?.phone ||



    parent?.contactNumber ||



    "";



    const findParentForLearner = (learner: AnyRecord) => {



        const embedded =
      
      
      
          learner?.parent ||
      
      
      
          learner?.primaryParent ||
      
      
      
          learner?.guardian ||
      
      
      
          learner?.accountHolder ||
      
      
      
          learner?.mother ||
      
      
      
          learner?.father ||
      
      
      
          (Array.isArray(learner?.parents) ? learner.parents[0] : null) ||
      
      
      
          (Array.isArray(learner?.guardians) ? learner.guardians[0] : null);
      
      
      
        if (embedded) return embedded;
      
      
      
        const learnerId = String(learner?.id || learner?.learnerId || "").trim();
      
      
      
        const learnerAccount = String(
      
      
      
          learner?.accountNo ||
      
      
      
            learner?.accountNumber ||
      
      
      
            learner?.account ||
      
      
      
            learner?.familyCode ||
      
      
      
            ""
      
      
      
        )
      
      
      
          .trim()
      
      
      
          .toLowerCase();
      
      
      
        const learnerName = fullName(learner).trim().toLowerCase();
      
      
      
        return (
      
      
      
          localParents.find((parent) => {
      
      
      
            const parentLearnerId = String(
      
      
      
              parent?.learnerId ||
      
      
      
                parent?.childId ||
      
      
      
                parent?.studentId ||
      
      
      
                parent?.learner_id ||
      
      
      
                parent?.learner?.id ||
      
      
      
                parent?.child?.id ||
      
      
      
                ""
      
      
      
            ).trim();
      
      
      
            const parentAccount = String(
      
      
      
              parent?.accountNo ||
      
      
      
                parent?.accountNumber ||
      
      
      
                parent?.account ||
      
      
      
                parent?.familyCode ||
      
      
      
                ""
      
      
      
            )
      
      
      
              .trim()
      
      
      
              .toLowerCase();
      
      
      
            const parentLearnerName = String(
      
      
      
              parent?.learnerName ||
      
      
      
                parent?.childName ||
      
      
      
                parent?.studentName ||
      
      
      
                parent?.linkedLearnerName ||
      
      
      
                fullName(parent?.learner || {}) ||
      
      
      
                fullName(parent?.child || {}) ||
      
      
      
                ""
      
      
      
            )
      
      
      
              .trim()
      
      
      
              .toLowerCase();
      
      
      
            const parentChildren = Array.isArray(parent?.children)
      
      
      
              ? parent.children
      
      
      
              : Array.isArray(parent?.learners)
      
      
      
              ? parent.learners
      
      
      
              : [];
      
      
      
            const linkedByChildArray = parentChildren.some((child: AnyRecord) => {
      
      
      
              const childId = String(child?.id || child?.learnerId || "").trim();
      
      
      
              const childName = fullName(child).trim().toLowerCase();
      
      
      
              return (
      
      
      
                (learnerId && childId && learnerId === childId) ||
      
      
      
                (learnerName && childName && learnerName === childName)
      
      
      
              );
      
      
      
            });
      
      
      
            return (
      
      
      
              linkedByChildArray ||
      
      
      
              (learnerId && parentLearnerId && learnerId === parentLearnerId) ||
      
      
      
              (learnerAccount && parentAccount && learnerAccount === parentAccount) ||
      
      
      
              (learnerName && parentLearnerName && learnerName === parentLearnerName)
      
      
      
            );
      
      
      
          }) || null
      
      
      
        );
      
      
      
      };



  const mappedLearners = safeLearners.map((learner: AnyRecord) => {



    const parent = findParentForLearner(learner) || {};



    return {



      ...learner,



      displayName: learner?.name || learner?.firstName || "",



      displaySurname: learner?.surname || learner?.lastName || "",



      learnerIdNumber: learnerIdNumber(learner),



      parentRelationship: parent?.relationship || parent?.relation || "",



      parentName: parent?.name || parent?.firstName || "",



      parentSurname: parent?.surname || parent?.lastName || "",



      parentIdNumber: parentIdNumber(parent),



      parentCell: parentCell(parent),



      parentEmail: parent?.email || parent?.parentEmail || "",



      parentWork: parent?.work || parent?.workPhone || "",



      rawParent: parent,



    };



  });



  const filteredLearners = mappedLearners.filter((learner: AnyRecord) => {



    const term = search.toLowerCase();



    const enrolled =



      learner?.status !== "Unenrolled" &&



      learner?.enrolled !== false &&



      learner?.isEnrolled !== false;



    if (!showUnenrolled && !enrolled) return false;



    return (



      !term ||



      String(learner.displayName || "").toLowerCase().includes(term) ||



      String(learner.displaySurname || "").toLowerCase().includes(term) ||



      String(learner.learnerIdNumber || "").toLowerCase().includes(term) ||



      String(learner.parentName || "").toLowerCase().includes(term) ||



      String(learner.parentSurname || "").toLowerCase().includes(term)



    );



  });



  const openLearner = (learner: AnyRecord) => {



    setSelectedLearner(learner);



    setEditingLearner({ ...learner });



    setEditingParent({



      ...(learner.rawParent || {}),



      relationship: learner.parentRelationship || "",



      name: learner.parentName || "",



      surname: learner.parentSurname || "",



      idNumber: learner.parentIdNumber || "",



      cell: learner.parentCell || "",



      email: learner.parentEmail || "",



      work: learner.parentWork || "",



      learnerId: learner.id,



      learnerName: `${learner.displayName} ${learner.displaySurname}`.trim(),



      accountNo: learner.accountNo || learner.accountNumber || "",



    });



  };



  const saveParent = () => {



    if (!editingParent || !selectedLearner) return;



    const cleanParent = {



      ...editingParent,



      relationship: editingParent.relationship || "",



      name: editingParent.name || "",



      surname: editingParent.surname || "",



      idNumber: editingParent.idNumber || "",



      cell: editingParent.cell || "",



      email: editingParent.email || "",



      work: editingParent.work || "",



      learnerId: selectedLearner.id,



      learnerName: fullName(selectedLearner),



      accountNo: selectedLearner.accountNo || selectedLearner.accountNumber || "",



    };



    setLocalParents((prev) => {



      const existingIndex = prev.findIndex(



        (p) =>



          String(p.id || "") === String(cleanParent.idNumber|| "") ||



          String(p.learnerId || "") === String(selectedLearner.id || "")



      );



      const next =



        existingIndex >= 0



          ? prev.map((p, i) => (i === existingIndex ? cleanParent : p))



          : [{ ...cleanParent, id: cleanParent.id || `parent-${Date.now()}` }, ...prev];



      localStorage.setItem("educlearParents", JSON.stringify(next));



      return next;



    });



    onSaveParent?.(cleanParent, selectedLearner);



    setEditingParent(cleanParent);



  };



  const saveLearner = () => {



    if (!editingLearner) return;



    onSaveLearner?.(editingLearner);



    setSelectedLearner(editingLearner);



  };



  return (



    <div style={{ padding: 24, background: "#f7f8fa", minHeight: "100vh" }}>



      <div style={{ marginBottom: 22 }}>



        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: DARK }}>



          Registrations



        </h1>



        <div style={{ color: "#64748b", fontWeight: 700, marginTop: 6 }}>



          Manage learners, parent details, enrolments and parent portal links.



        </div>



      </div>



      <div style={card}>



        <div style={toolbar}>



          <button style={goldBtn} onClick={onAddLearner}>



            + Add



          </button>



          <button style={whiteBtn} onClick={() => onAddSibling?.(selectedLearner)}>



            + Add Sibling



          </button>



          <button



            style={whiteBtn}



            onClick={() => selectedLearner && openLearner(selectedLearner)}



          >



            ✎ Manage



          </button>



          <button style={whiteBtn}>👪 Parent Portal</button>



          <div style={{ flex: 1 }} />



          <button



            style={whiteBtn}



            onClick={() => setShowUnenrolled((value) => !value)}



          >



            {showUnenrolled ? "Hide Unenrolled" : "Show Unenrolled"}



          </button>



        </div>



        <input



          value={search}



          onChange={(e) => setSearch(e.target.value)}



          placeholder="Search learner, parent or ID number"



          style={{ ...input, maxWidth: 360, marginBottom: 18 }}



        />



        <div style={tableWrap}>



          <table style={table}>



            <thead>



              <tr>



                <th style={th}>Name</th>



                <th style={th}>Surname</th>



                <th style={th}>Classroom</th>



                <th style={th}>Learner ID</th>



                <th style={th}>Parent</th>



                <th style={th}>Relationship</th>



                <th style={th}>Parent ID</th>



                <th style={th}>Cell</th>



                <th style={th}>Email</th>



              </tr>



            </thead>



            <tbody>



              {filteredLearners.map((learner: AnyRecord, index: number) => (



                <tr



                  key={learner.id || index}



                  onClick={() => openLearner(learner)}



                  style={{



                    cursor: "pointer",



                    background:



                      selectedLearner?.id === learner.id



                        ? "rgba(212,175,55,0.16)"



                        : index % 2 === 0



                        ? "#ffffff"



                        : "rgba(212,175,55,0.05)",



                  }}



                >



                  <td style={td}>{learner.displayName || "-"}</td>



                  <td style={td}>{learner.displaySurname || "-"}</td>



                  <td style={td}>{learner.classroom || learner.grade || "-"}</td>



                  <td style={td}>{learner.learnerIdNumber || "-"}</td>



                  <td style={td}>



                    {`${learner.parentName || ""} ${learner.parentSurname || ""}`.trim() ||



                      "-"}



                  </td>



                  <td style={td}>{learner.parentRelationship || "-"}</td>



                  <td style={td}>{learner.parentIdNumber || "-"}</td>



                  <td style={td}>{learner.parentCell || "-"}</td>



                  <td style={td}>{learner.parentEmail || "-"}</td>



                </tr>



              ))}



            </tbody>



          </table>



        </div>



      </div>



      {editingLearner && (



        <div style={{ ...card, marginTop: 20 }}>



          <h2 style={sectionTitle}>Learner Profile</h2>



          <div style={grid}>



            <Field label="Name">



              <input



                style={input}



                value={editingLearner.name || editingLearner.firstName || ""}



                onChange={(e) =>



                  setEditingLearner({ ...editingLearner, name: e.target.value })



                }



              />



            </Field>



            <Field label="Surname">



              <input



                style={input}



                value={editingLearner.surname || editingLearner.lastName || ""}



                onChange={(e) =>



                  setEditingLearner({ ...editingLearner, surname: e.target.value })



                }



              />



            </Field>



            <Field label="Learner ID Number">



              <input



                style={input}



                value={editingLearner.idNumber || editingLearner.learnerIdNumber || ""}



                onChange={(e) =>



                  setEditingLearner({



                    ...editingLearner,



                    idNumber: e.target.value,



                    learnerIdNumber: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Classroom / Grade">



              <input



                style={input}



                value={editingLearner.classroom || editingLearner.grade || ""}



                onChange={(e) =>



                  setEditingLearner({



                    ...editingLearner,



                    classroom: e.target.value,



                    grade: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Gender">



              <input



                style={input}



                value={editingLearner.gender || ""}



                onChange={(e) =>



                  setEditingLearner({ ...editingLearner, gender: e.target.value })



                }



              />



            </Field>



            <Field label="Date of Birth">



              <input



                type="date"



                style={input}



                value={editingLearner.birthDate || editingLearner.dateOfBirth || ""}



                onChange={(e) =>



                  setEditingLearner({



                    ...editingLearner,



                    birthDate: e.target.value,



                    dateOfBirth: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Enrolment Date">



              <input



                type="date"



                style={input}



                value={editingLearner.enrolmentDate || editingLearner.enrollmentDate || ""}



                onChange={(e) =>



                  setEditingLearner({



                    ...editingLearner,



                    enrolmentDate: e.target.value,



                    enrollmentDate: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Status">



              <input



                style={input}



                value={editingLearner.status || "Enrolled"}



                onChange={(e) =>



                  setEditingLearner({ ...editingLearner, status: e.target.value })



                }



              />



            </Field>



          </div>



          <button style={{ ...goldBtn, marginTop: 16 }} onClick={saveLearner}>



            Save Learner



          </button>



        </div>



      )}



      {editingParent && (



        <div style={{ ...card, marginTop: 20 }}>



          <h2 style={sectionTitle}>Parents</h2>



          <div style={toolbar}>



            <button style={goldBtn}>+ Add</button>



            <button style={goldBtn}>+ Add Existing</button>



            <button style={whiteBtn}>✎ Manage</button>



            <button style={dangerBtn}>× Remove</button>



          </div>



          <h3 style={{ margin: "18px 0 12px", color: DARK }}>Manage Parent</h3>



          <div style={grid}>



            <Field label="Relationship">



              <input



                style={input}



                value={editingParent.relationship || ""}



                onChange={(e) =>



                  setEditingParent({



                    ...editingParent,



                    relationship: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Name">



              <input



                style={input}



                value={editingParent.name || editingParent.firstName || ""}



                onChange={(e) =>



                  setEditingParent({ ...editingParent, name: e.target.value })



                }



              />



            </Field>



            <Field label="Surname">



              <input



                style={input}



                value={editingParent.surname || editingParent.lastName || ""}



                onChange={(e) =>



                  setEditingParent({ ...editingParent, surname: e.target.value })



                }



              />



            </Field>



            <Field label="Parent ID Number">



              <input



                style={input}



                value={editingParent.idNumber || editingParent.parentIdNumber || ""}



                onChange={(e) =>



                  setEditingParent({



                    ...editingParent,



                    idNumber: e.target.value,



                    parentIdNumber: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Cell Number">



              <input



                style={input}



                value={editingParent.cell || editingParent.cellphone || ""}



                onChange={(e) =>



                  setEditingParent({



                    ...editingParent,



                    cell: e.target.value,



                    cellphone: e.target.value,



                  })



                }



              />



            </Field>



            <Field label="Email">



              <input



                style={input}



                value={editingParent.email || ""}



                onChange={(e) =>



                  setEditingParent({ ...editingParent, email: e.target.value })



                }



              />



            </Field>



            <Field label="Work">



              <input



                style={input}



                value={editingParent.work || editingParent.workPhone || ""}



                onChange={(e) =>



                  setEditingParent({



                    ...editingParent,



                    work: e.target.value,



                    workPhone: e.target.value,



                  })



                }



              />



            </Field>



          </div>



          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>



            <button style={goldBtn} onClick={saveParent}>



              Save Parent



            </button>



            <button style={whiteBtn} onClick={() => setEditingParent(null)}>



              Cancel



            </button>



          </div>



          <div style={{ ...tableWrap, marginTop: 18 }}>



            <table style={table}>



              <thead>



                <tr>



                  <th style={th}>Relationship</th>



                  <th style={th}>Name</th>



                  <th style={th}>Surname</th>



                  <th style={th}>Parent ID</th>



                  <th style={th}>Cell</th>



                  <th style={th}>Email</th>



                  <th style={th}>Work</th>



                </tr>



              </thead>



              <tbody>



                <tr style={{ background: "rgba(212,175,55,0.05)" }}>



                  <td style={td}>{editingParent.relationship || "-"}</td>



                  <td style={td}>{editingParent.name || "-"}</td>



                  <td style={td}>{editingParent.surname || "-"}</td>



                  <td style={td}>{editingParent.idNumber || "-"}</td>



                  <td style={td}>{editingParent.cell || "-"}</td>



                  <td style={td}>{editingParent.email || "-"}</td>



                  <td style={td}>{editingParent.work || "-"}</td>



                </tr>



              </tbody>



            </table>



          </div>



        </div>



      )}



    </div>



  );



}



function Field({



  label,



  children,



}: {



  label: string;



  children: React.ReactNode;



}) {



  return (



    <label style={{ display: "block" }}>



      <div



        style={{



          fontSize: 13,



          fontWeight: 900,



          color: "#334155",



          marginBottom: 6,



        }}



      >



        {label}



      </div>



      {children}



    </label>



  );



}



const card: React.CSSProperties = {



  background: "#ffffff",



  border: "1px solid #d8dee8",



  borderRadius: 18,



  padding: 22,



  boxShadow: "0 10px 28px rgba(15,23,42,0.08)",



};



const toolbar: React.CSSProperties = {



  display: "flex",



  gap: 10,



  flexWrap: "wrap",



  alignItems: "center",



  marginBottom: 16,



};



const grid: React.CSSProperties = {



  display: "grid",



  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",



  gap: 12,



};



const input: React.CSSProperties = {



  width: "100%",



  padding: "11px 12px",



  border: "1px solid #cbd5e1",



  borderRadius: 10,



  outline: "none",



  fontSize: 14,



  background: "#ffffff",



};



const tableWrap: React.CSSProperties = {



  overflowX: "auto",



  border: "1px solid #e5eaf2",



  borderRadius: 14,



};



const table: React.CSSProperties = {



  width: "100%",



  borderCollapse: "collapse",



};



const th: React.CSSProperties = {



  padding: "12px",



  textAlign: "left",



  background: "#f8fafc",



  borderBottom: "1px solid #e5eaf2",



  color: "#334155",



  fontSize: 13,



  fontWeight: 900,



};



const td: React.CSSProperties = {



  padding: "12px",



  borderBottom: "1px solid #edf2f7",



  color: "#111827",



  fontSize: 14,



};



const sectionTitle: React.CSSProperties = {



  margin: "0 0 16px",



  color: DARK,



  fontSize: 24,



  fontWeight: 900,



};



const goldBtn: React.CSSProperties = {



  padding: "10px 15px",



  borderRadius: 10,



  border: "1px solid #b89329",



  background: `linear-gradient(135deg, #f7d56a, ${GOLD})`,



  color: "#111827",



  fontWeight: 900,



  cursor: "pointer",



};



const whiteBtn: React.CSSProperties = {



  padding: "10px 15px",



  borderRadius: 10,



  border: "1px solid #cbd5e1",



  background: "#ffffff",



  color: "#111827",



  fontWeight: 900,



  cursor: "pointer",



};



const dangerBtn: React.CSSProperties = {



  padding: "10px 15px",



  borderRadius: 10,



  border: "1px solid #fecaca",



  background: "#fff7f7",



  color: "#991b1b",



  fontWeight: 900,



  cursor: "pointer",



};