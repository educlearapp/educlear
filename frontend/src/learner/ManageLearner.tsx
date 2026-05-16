import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import {
  calculateLearnerAge,
  getBirthDateFromSouthAfricanId,
  getLearnerAccountNo,
  normaliseDateForInput,
} from "./learnerIdentity";

const GOLD = "#d4af37";

type ParentDraft = {
  relationship?: string;
  firstName?: string;
  name?: string;
  lastName?: string;
  surname?: string;
  cell?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  work?: string;
  workPhone?: string;
};

type ProfileTab = "general" | "billing" | "medical" | "groups" | "other" | "extra";

export type ManageLearnerProps = {
  learner: any | null;
  setLearner: (learner: any | null) => void;
  setLearners: React.Dispatch<React.SetStateAction<any[]>>;
  parents: any[];
  setParents: React.Dispatch<React.SetStateAction<any[]>>;
  onBack: () => void;
};

const actionBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "10px",
  border: "1px solid rgba(15, 23, 42, 0.14)",
  background: "#ffffff",
  fontWeight: 800,
  fontSize: "13px",
  color: "#0f172a",
  boxShadow: "0 4px 10px rgba(15, 23, 42, 0.05)",
  cursor: "pointer",
};

const goldBtn: React.CSSProperties = {
  ...actionBtn,
  border: "1px solid rgba(212,175,55,0.7)",
  background: "linear-gradient(135deg, #d4af37, #f5d06f)",
  color: "#111827",
  boxShadow: "0 8px 18px rgba(212,175,55,0.28)",
};

const dangerBtn: React.CSSProperties = {
  ...actionBtn,
  color: "#b91c1c",
  border: "1px solid rgba(185,28,28,0.24)",
  background: "#ffffff",
};

const selectStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  fontSize: "13px",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  fontSize: "13px",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontWeight: 800,
  color: "#334155",
  fontSize: "13px",
  display: "flex",
  alignItems: "center",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "12px",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 900,
  color: "#334155",
  fontSize: "13px",
};

const td: React.CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "13px",
};

function learnerFullName(learner: any) {
  return `${learner?.firstName || ""} ${learner?.lastName || learner?.surname || ""}`.trim();
}

function learnerClassroom(learner: any) {
  return learner?.grade || learner?.className || learner?.classroom || "";
}

function parentName(parent: any) {
  return parent?.firstName || parent?.name || "";
}

function parentSurname(parent: any) {
  return parent?.lastName || parent?.surname || "";
}

function parentCell(parent: any) {
  return parent?.cell || parent?.phone || parent?.mobile || "";
}

function parentWork(parent: any) {
  return parent?.workPhone || parent?.work || "";
}

function learnerParents(learner: any, parents: any[]) {
  const learnerId = String(learner?.id || "");
  const learnerSurname = String(learner?.lastName || learner?.surname || "").trim().toLowerCase();
  const learnerFamilyId = String(
    learner?.familyAccountId ||
      learner?.familyAccount?.id ||
      learner?.familyId ||
      learner?.accountId ||
      ""
  );

  const embeddedParents = [
    ...(Array.isArray(learner?.parents) ? learner.parents : []),
    ...(Array.isArray(learner?.parentLinks)
      ? learner.parentLinks.map((link: any) => link.parent || link).filter(Boolean)
      : []),
  ];

  if (embeddedParents.length > 0) return embeddedParents;

  return parents.filter((parent: any) => {
    const directLearnerIds = [
      parent.learnerId,
      parent.childId,
      parent.studentId,
      parent.learner?.id,
      parent.child?.id,
    ]
      .filter(Boolean)
      .map(String);

    const nestedLearnerIds = Array.isArray(parent.learners)
      ? parent.learners
          .map((item: any) => item?.id || item?.learnerId || item?.learner?.id)
          .filter(Boolean)
          .map(String)
      : [];

    const parentFamilyId = String(
      parent.familyAccountId || parent.familyAccount?.id || parent.familyId || parent.accountId || ""
    );

    const pSurname = String(parent.lastName || parent.surname || "").trim().toLowerCase();
    const linkedByLearnerId = [...directLearnerIds, ...nestedLearnerIds].includes(learnerId);
    const linkedByFamily = learnerFamilyId && parentFamilyId && learnerFamilyId === parentFamilyId;
    const linkedBySurname = learnerSurname && pSurname && learnerSurname === pSurname;

    return linkedByLearnerId || linkedByFamily || linkedBySurname;
  });
}

export default function ManageLearner({
  learner: learnerProp,
  setLearner: setSelectedLearner,
  setLearners,
  parents,
  setParents,
  onBack,
}: ManageLearnerProps) {
  const [profileMoreOpen, setProfileMoreOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>("general");
  const [selectedParent, setSelectedParent] = useState<any | null>(null);
  const [parentMode, setParentMode] = useState<"none" | "add" | "existing" | "manage">("none");
  const [parentDraft, setParentDraft] = useState<ParentDraft>({});

  const learner = useMemo(() => {
    if (learnerProp) return learnerProp;
    const saved = localStorage.getItem("selectedLearnerForManage");
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }, [learnerProp]);

  useEffect(() => {
    if (!learner?.id) return;
    setSelectedParent(null);
    setParentMode("none");
    setParentDraft({});
    setProfileTab("general");
    setProfileMoreOpen(false);
  }, [learner?.id]);




    if (!learner) {
  
  
  
      return (
  
  
  
        <div style={{ padding: "32px" }}>
  
  
  
          <h1 className="page-title">Registration</h1>
  
  
  
          <p>No learner selected.</p>
  
  
  
          <button style={actionBtn} onClick={() => onBack()}>
  
  
  
            Back
  
  
  
          </button>
  
  
  
        </div>
  
  
  
      );
  
  
  
    }
  
  
  
    const visibleParents = learnerParents(learner, parents);
    const fullName = learnerFullName(learner);
    const classroom = learnerClassroom(learner);
    const accountNo = getLearnerAccountNo(learner);

    const persistLearner = (updated: any) => {
      setSelectedLearner(updated);
      localStorage.setItem("selectedLearnerForManage", JSON.stringify(updated));
    };

    const updateLearnerField = (key: string, value: any) => {
      const updated: any = { ...learner, [key]: value };

      if (key === "idNumber" || key === "idNo") {
        updated.idNumber = value;
        updated.idNo = value;
        const extractedBirthDate = getBirthDateFromSouthAfricanId(value);
        if (extractedBirthDate) {
          updated.birthDate = extractedBirthDate;
          updated.dateOfBirth = extractedBirthDate;
        }
      }

      if (key === "birthDate") {
        updated.birthDate = value;
        updated.dateOfBirth = value;
      }

      if (key === "classroom") {
        updated.className = value;
        updated.classroomName = value;
      }

      if (key === "className") {
        updated.classroom = value;
        updated.classroomName = value;
      }

      persistLearner(updated);
    };

    const createLocalParent = (targetLearner: any) => {
      const nowId = `local-parent-${Date.now()}`;
      const newParent = {
        id: nowId,
        relationship: parentDraft.relationship || "-",
        firstName: parentDraft.firstName || parentDraft.name || "",
        name: parentDraft.firstName || parentDraft.name || "",
        lastName: parentDraft.lastName || parentDraft.surname || "",
        surname: parentDraft.lastName || parentDraft.surname || "",
        cell: parentDraft.cell || parentDraft.phone || parentDraft.mobile || "",
        phone: parentDraft.cell || parentDraft.phone || parentDraft.mobile || "",
        email: parentDraft.email || "",
        work: parentDraft.work || parentDraft.workPhone || "",
        workPhone: parentDraft.work || parentDraft.workPhone || "",
        learnerId: targetLearner?.id,
        familyAccountId:
          targetLearner?.familyAccountId ||
          targetLearner?.familyAccount?.id ||
          targetLearner?.familyId ||
          targetLearner?.accountId ||
          "",
      };
      setParents((prev) => [newParent, ...prev]);
      setSelectedParent(newParent);
      setParentDraft({});
      setParentMode("none");
    };

    const updateLocalParent = () => {
      if (!selectedParent) {
        alert("Please select a parent first.");
        return;
      }
      const updatedParent = {
        ...selectedParent,
        relationship: parentDraft.relationship ?? selectedParent.relationship,
        firstName: parentDraft.firstName ?? parentDraft.name ?? selectedParent.firstName,
        name: parentDraft.firstName ?? parentDraft.name ?? selectedParent.name,
        lastName: parentDraft.lastName ?? parentDraft.surname ?? selectedParent.lastName,
        surname: parentDraft.lastName ?? parentDraft.surname ?? selectedParent.surname,
        cell: parentDraft.cell ?? parentDraft.phone ?? parentDraft.mobile ?? selectedParent.cell,
        phone: parentDraft.cell ?? parentDraft.phone ?? parentDraft.mobile ?? selectedParent.phone,
        email: parentDraft.email ?? selectedParent.email,
        work: parentDraft.work ?? parentDraft.workPhone ?? selectedParent.work,
        workPhone: parentDraft.work ?? parentDraft.workPhone ?? selectedParent.workPhone,
      };
      setParents((prev) =>
        prev.map((parent) => (String(parent.id) === String(selectedParent.id) ? updatedParent : parent))
      );
      setSelectedParent(updatedParent);
      setParentDraft({});
      setParentMode("none");
    };

    const removeLocalParentLink = () => {
      if (!selectedParent) {
        alert("Please select a parent first.");
        return;
      }
      const ok = window.confirm("Remove this parent from the learner profile?");
      if (!ok) return;
      setParents((prev) => prev.filter((parent) => String(parent.id) !== String(selectedParent.id)));
      setSelectedParent(null);
      setParentMode("none");
    };

    const birthDateField = () => (
      <>
        <label style={labelStyle}>* Birth Date</label>
        <input
          style={inputStyle}
          type="date"
          value={normaliseDateForInput(learner.birthDate || learner.dateOfBirth || learner.dob)}
          onChange={(e) => updateLearnerField("birthDate", e.target.value)}
        />
      </>
    );

    const accountNoField = () => (
      <>
        <label style={labelStyle}>Account No</label>
        <input style={{ ...inputStyle, background: "#f8fafc" }} value={accountNo} readOnly />
      </>
    );

    const field = (
  
  
  
      label: string,
  
  
  
      key: string,
  
  
  
      value: any,
  
  
  
      required = false,
  
  
  
      type = "text"
  
  
  
    ) => (
  
  
  
      <>
  
  
  
        <label style={labelStyle}>
  
  
  
          {required ? "* " : ""}
  
  
  
          {label}
  
  
  
        </label>
  
  
  
        <input
  
  
  
          style={inputStyle}
  
  
  
          type={type}
  
  
  
          value={value || ""}
  
  
  
          onChange={(e) => updateLearnerField(key, e.target.value)}
  
  
  
        />
  
  
  
      </>
  
  
  
    );
  
  
  
    const tabStyle = (tab: typeof profileTab) => ({
  
  
  
      padding: "12px 18px",
  
  
  
      border: "none",
  
  
  
      borderRight: "1px solid #cbd5e1",
  
  
  
      background: profileTab === tab ? "#ffffff" : "#f1f5f9",
  
  
  
      color: profileTab === tab ? "#0f172a" : "#64748b",
  
  
  
      fontWeight: 900,
  
  
  
      cursor: "pointer",
  
  
  
      borderTop: profileTab === tab ? `4px solid ${GOLD}` : "4px solid transparent",
  
  
  
    });
  
  
  
    const startAddParent = () => {
  
  
  
      setParentMode("add");
  
  
  
      setSelectedParent(null);
  
  
  
      setParentDraft({
  
  
  
        relationship: "Parent",
  
  
  
        firstName: "",
  
  
  
        lastName: learner.lastName || learner.surname || "",
  
  
  
        cell: "",
  
  
  
        email: "",
  
  
  
        work: "",
  
  
  
      });
  
  
  
    };
  
  
  
    const startManageParent = () => {
  
  
  
      if (!selectedParent) {
  
  
  
        alert("Please select a parent first.");
  
  
  
        return;
  
  
  
      }
  
  
  
      setParentMode("manage");
  
  
  
      setParentDraft({
  
  
  
        relationship: selectedParent.relationship || selectedParent.relation || "",
  
  
  
        firstName: parentName(selectedParent),
  
  
  
        lastName: parentSurname(selectedParent),
  
  
  
        cell: parentCell(selectedParent),
  
  
  
        email: selectedParent.email || "",
  
  
  
        work: parentWork(selectedParent),
  
  
  
      });
  
  
  
    };
  
  
  
    return (
  
  
  
      <div
  
  
  
        style={{
  
  
  
          padding: "26px",
  
  
  
          background: "#f8fafc",
  
  
  
          minHeight: "100%",
  
  
  
          borderRadius: "20px",
  
  
  
          border: "1px solid rgba(15,23,42,0.08)",
  
  
  
        }}
  
  
  
      >
  
  
  
        <div style={{ marginBottom: "12px" }}>
  
  
  
          <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 900, color: "#0f172a" }}>
  
  
  
            Registration
  
  
  
          </h1>
  
  
  
          <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
  
  
  
            Manage child and parent information
  
  
  
          </p>
  
  
  
        </div>
  
  
  
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px", position: "relative" }}>
  
  
  
          <button style={actionBtn} onClick={() => onBack()}>
  
  
  
            ← Back
  
  
  
          </button>
  
  
  
          <button
  
  
  
            style={goldBtn}
  
  
  
            onClick={async () => {
  
  
  
              try {
  
  
  
                if (!learner?.id) {
  
  
  
                  alert("No learner selected");
  
  
  
                  return;
  
  
  
                }
  
  
  
                const response = await fetch(`${API_URL}/api/learners/${learner.id}`, {
  
  
  
                  method: "PUT",
  
  
  
                  headers: {
  
  
  
                    "Content-Type": "application/json",
  
  
  
                  },
  
  
  
                  body: JSON.stringify({
  
  
  
                    firstName: learner.firstName || "",
  
  
  
                    lastName: learner.lastName || learner.surname || "",
  
  
  
                    gender: learner.gender || "",
  
  
  
                    birthDate: learner.birthDate || learner.dateOfBirth || "",
  
  
  
                    homeLanguage: learner.homeLanguage || "",
  
  
  
                    religion: learner.religion || "",
  
  
  
                    nationality: learner.nationality || "",
  
  
  
                    enrolmentDate: learner.enrolmentDate || "",
  
  
  
                    idNumber: learner.idNumber || learner.idNo || "",
  
  
  
                    classroom: learner.classroom || learner.className || "",
  
  
  
                    classroomName: learner.classroomName || learner.classroom || learner.className || "",
  
  
  
                    className: learner.className || learner.classroom || "",
  
  
  
                    notes: learner.notes || "",
  
  
  
                  }),
  
  
  
                });
  
  
  
                if (!response.ok) {
  
  
  
                  throw new Error("Failed to save learner");
  
  
  
                }
  
  
  
                const result = await response.json();
  
  
  
                const updatedLearner = result.learner || result;
  
  
  
                setSelectedLearner(updatedLearner);
  
  
  
                setLearners((prevLearners: any[]) =>
  
  
  
                  prevLearners.map((item: any) =>
  
  
  
                    String(item.id) === String(updatedLearner.id) ? updatedLearner : item
  
  
  
                  )
  
  
  
                );
  
  
  
                localStorage.setItem("selectedLearnerForManage", JSON.stringify(updatedLearner));
  
  
  
                alert("Learner saved successfully");
  
  
  
              } catch (error) {
  
  
  
                console.error(error);
  
  
  
                alert("Failed to save learner");
  
  
  
              }
  
  
  
            }}
  
  
  
          >
  
  
  
            💾 Save
  
  
  
          </button>
  
  
  
          <button style={actionBtn} onClick={() => setProfileMoreOpen((value) => !value)}>
  
  
  
            More Actions⌄
  
  
  
          </button>
  
  
  
          {profileMoreOpen && (
  
  
  
            <div
  
  
  
              style={{
  
  
  
                position: "absolute",
  
  
  
                top: "46px",
  
  
  
                left: "204px",
  
  
  
                width: "220px",
  
  
  
                background: "#ffffff",
  
  
  
                border: "1px solid #cbd5e1",
  
  
  
                borderRadius: "10px",
  
  
  
                boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
  
  
  
                overflow: "hidden",
  
  
  
                zIndex: 30,
  
  
  
              }}
  
  
  
            >
  
  
  
              {["Send Email", "Send SMS", "Unenrol", "Delete"].map((item) => (
  
  
  
                <button
  
  
  
                  key={item}
  
  
  
                  type="button"
  
  
  
                  style={{
  
  
  
                    display: "block",
  
  
  
                    width: "100%",
  
  
  
                    padding: "14px 18px",
  
  
  
                    textAlign: "left",
  
  
  
                    border: "none",
  
  
  
                    borderBottom: "1px solid #e5e7eb",
  
  
  
                    background: "#ffffff",
  
  
  
                    fontWeight: 900,
  
  
  
                    color: item === "Delete" ? "#b91c1c" : "#0f172a",
  
  
  
                    cursor: "pointer",
  
  
  
                  }}
  
  
  
                  onClick={() => {
  
  
  
                    setProfileMoreOpen(false);
  
  
  
                    alert(`${item} will be connected in the next functionality pass.`);
  
  
  
                  }}
  
  
  
                >
  
  
  
                  {item}
  
  
  
                </button>
  
  
  
              ))}
  
  
  
            </div>
  
  
  
          )}
  
  
  
        </div>
  
  
  
        <div
  
  
  
          style={{
  
  
  
            display: "grid",
  
  
  
            gridTemplateColumns: "minmax(620px, 1fr) 380px",
  
  
  
            gap: "28px",
  
  
  
            alignItems: "start",
  
  
  
          }}
  
  
  
        >
  
  
  
          <div
  
  
  
            style={{
  
  
  
              background: "#ffffff",
  
  
  
              border: "1px solid #cbd5e1",
  
  
  
              borderRadius: "10px",
  
  
  
              overflow: "hidden",
  
  
  
              boxShadow: "0 14px 34px rgba(15,23,42,0.07)",
  
  
  
            }}
  
  
  
          >
  
  
  
            <div
  
  
  
              style={{
  
  
  
                display: "grid",
  
  
  
                gridTemplateColumns: "170px 1fr",
  
  
  
                borderBottom: "1px solid #cbd5e1",
  
  
  
                background: "#f8fafc",
  
  
  
              }}
  
  
  
            >
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  padding: "14px",
  
  
  
                  fontWeight: 900,
  
  
  
                  color: "#0f172a",
  
  
  
                  borderRight: "1px solid #cbd5e1",
  
  
  
                }}
  
  
  
              >
  
  
  
                Child
  
  
  
              </div>
  
  
  
              <div style={{ display: "flex" }}>
  
  
  
                <button style={tabStyle("general")} onClick={() => setProfileTab("general")}>
  
  
  
                  General
  
  
  
                </button>
  
  
  
                <button style={tabStyle("billing")} onClick={() => setProfileTab("billing")}>
  
  
  
                  Billing Plan
  
  
  
                </button>
  
  
  
                <button style={tabStyle("medical")} onClick={() => setProfileTab("medical")}>
  
  
  
                  Medical
  
  
  
                </button>
  
  
  
                <button style={tabStyle("groups")} onClick={() => setProfileTab("groups")}>
  
  
  
                  Groups
  
  
  
                </button>
  
  
  
                <button style={tabStyle("other")} onClick={() => setProfileTab("other")}>
  
  
  
                  Other
  
  
  
                </button>
  
  
  
                <button style={tabStyle("extra")} onClick={() => setProfileTab("extra")}>
  
  
  
                  Extra
  
  
  
                </button>
  
  
  
              </div>
  
  
  
            </div>
  
  
  
            {profileTab === "general" ? (
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  padding: "22px",
  
  
  
                  display: "grid",
  
  
  
                  gridTemplateColumns: "150px 1fr",
  
  
  
                  rowGap: "10px",
  
  
  
                  columnGap: "12px",
  
  
  
                }}
  
  
  
              >
  
  
  
                {field("Name / Nickname", "firstName", learner.firstName, true)}
  
  
  
                {field("Surname", "lastName", learner.lastName || learner.surname, true)}
  
  
  
                {field("ID No", "idNumber", learner.idNumber || learner.idNo)}
                {birthDateField()}
                {accountNoField()}
                {field("Gender", "gender", learner.gender)}
  
  
  
                {field("Classroom", "classroom", classroom)}
  
  
  
                {field("Home Language", "homeLanguage", learner.homeLanguage)}
  
  
  
                {field("Nationality", "nationality", learner.nationality)}
  
  
  
                {field("Religion", "religion", learner.religion)}
  
  
  
                {field(
  
  
  
                  "Enrolment Date",
  
  
  
                  "enrolmentDate",
  
  
  
                  normaliseDateForInput(learner.enrolmentDate || learner.createdAt),
  
  
  
                  false,
  
  
  
                  "date"
  
  
  
                )}
  
  
  
                <label style={labelStyle}>Notes</label>
  
  
  
                <textarea
  
  
  
                  style={{
  
  
  
                    ...inputStyle,
  
  
  
                    minHeight: "105px",
  
  
  
                    resize: "vertical",
  
  
  
                    fontFamily: "inherit",
  
  
  
                  }}
  
  
  
                  value={learner.notes || ""}
  
  
  
                  onChange={(e) => updateLearnerField("notes", e.target.value)}
  
  
  
                />
  
  
  
              </div>
  
  
  
            ) : (
  
  
  
              <div style={{ padding: "28px", color: "#64748b", fontWeight: 900 }}>
  
  
  
                {profileTab === "billing" && "Billing plan information will be connected here."}
  
  
  
                {profileTab === "medical" && "Medical information will be connected here."}
  
  
  
                {profileTab === "groups" && "Groups information will be connected here."}
  
  
  
                {profileTab === "other" && "Other learner information will be connected here."}
  
  
  
                {profileTab === "extra" && "Extra learner fields will be connected here."}
  
  
  
              </div>
  
  
  
            )}
  
  
  
          </div>
  
  
  
          <div style={{ paddingTop: "56px" }}>
  
  
  
            <div
  
  
  
              style={{
  
  
  
                width: "205px",
  
  
  
                height: "205px",
  
  
  
                margin: "0 auto 18px",
  
  
  
                border: "1px solid #cbd5e1",
  
  
  
                background: "linear-gradient(180deg,#e2e8f0,#f8fafc)",
  
  
  
                display: "grid",
  
  
  
                placeItems: "center",
  
  
  
                position: "relative",
  
  
  
              }}
  
  
  
            >
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  width: "120px",
  
  
  
                  height: "120px",
  
  
  
                  borderRadius: "999px",
  
  
  
                  background: "#94a3b8",
  
  
  
                }}
  
  
  
              />
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  position: "absolute",
  
  
  
                  right: "14px",
  
  
  
                  bottom: "14px",
  
  
  
                  width: "34px",
  
  
  
                  height: "34px",
  
  
  
                  borderRadius: "999px",
  
  
  
                  background: GOLD,
  
  
  
                  color: "#111827",
  
  
  
                  display: "grid",
  
  
  
                  placeItems: "center",
  
  
  
                  fontWeight: 900,
  
  
  
                  border: "2px solid #ffffff",
  
  
  
                }}
  
  
  
              >
  
  
  
                +
  
  
  
              </div>
  
  
  
            </div>
  
  
  
            <div
  
  
  
              style={{
  
  
  
                display: "grid",
  
  
  
                gridTemplateColumns: "120px 1fr",
  
  
  
                border: "1px solid #e5e7eb",
  
  
  
                background: "#ffffff",
  
  
  
                boxShadow: "0 10px 26px rgba(15,23,42,0.05)",
  
  
  
              }}
  
  
  
            >
  
  
  
              {[
  
  
  
                ["Full Name", fullName || "-"],
  
  
  
                ["Age", calculateLearnerAge(learner.birthDate || learner.dateOfBirth || learner.dob)],
  
  
  
                ["Classroom", classroom || "-"],
  
  
  
                ["Notes", learner.notes || ""],
  
  
  
              ].map(([label, value]) => (
  
  
  
                <React.Fragment key={label}>
  
  
  
                  <div
  
  
  
                    style={{
  
  
  
                      padding: "12px",
  
  
  
                      background: "#f1f5f9",
  
  
  
                      fontWeight: 900,
  
  
  
                      color: "#334155",
  
  
  
                      textAlign: "right",
  
  
  
                      borderBottom: "1px solid #e5e7eb",
  
  
  
                    }}
  
  
  
                  >
  
  
  
                    {label}
  
  
  
                  </div>
  
  
  
                  <div
  
  
  
                    style={{
  
  
  
                      padding: "12px",
  
  
  
                      color: "#0f172a",
  
  
  
                      fontWeight: 800,
  
  
  
                      borderBottom: "1px solid #e5e7eb",
  
  
  
                    }}
  
  
  
                  >
  
  
  
                    {value}
  
  
  
                  </div>
  
  
  
                </React.Fragment>
  
  
  
              ))}
  
  
  
            </div>
  
  
  
          </div>
  
  
  
        </div>
  
  
  
        <div
  
  
  
          style={{
  
  
  
            marginTop: "18px",
  
  
  
            background: "#ffffff",
  
  
  
            border: "1px solid #cbd5e1",
  
  
  
            borderRadius: "10px",
  
  
  
            overflow: "hidden",
  
  
  
            boxShadow: "0 14px 34px rgba(15,23,42,0.07)",
  
  
  
          }}
  
  
  
        >
  
  
  
          <div
  
  
  
            style={{
  
  
  
              padding: "12px 14px",
  
  
  
              borderBottom: "1px solid #cbd5e1",
  
  
  
              fontWeight: 900,
  
  
  
              color: "#0f172a",
  
  
  
              background: "#f8fafc",
  
  
  
              display: "flex",
  
  
  
              justifyContent: "space-between",
  
  
  
              alignItems: "center",
  
  
  
            }}
  
  
  
          >
  
  
  
            <span>Parents</span>
  
  
  
            <span style={{ color: GOLD, fontSize: "12px" }}>{visibleParents.length} linked</span>
  
  
  
          </div>
  
  
  
          <div
  
  
  
            style={{
  
  
  
              padding: "10px",
  
  
  
              display: "flex",
  
  
  
              gap: "8px",
  
  
  
              borderBottom: "1px solid #e5e7eb",
  
  
  
              flexWrap: "wrap",
  
  
  
            }}
  
  
  
          >
  
  
  
            <button style={goldBtn} onClick={startAddParent}>
  
  
  
              + Add
  
  
  
            </button>
  
  
  
            <button
  
  
  
              style={goldBtn}
  
  
  
              onClick={() => {
  
  
  
                setParentMode("existing");
  
  
  
                setParentDraft({});
  
  
  
              }}
  
  
  
            >
  
  
  
              + Add Existing
  
  
  
            </button>
  
  
  
            <button style={actionBtn} onClick={startManageParent}>
  
  
  
              ✎ Manage
  
  
  
            </button>
  
  
  
            <button style={dangerBtn} onClick={removeLocalParentLink}>
  
  
  
              × Remove
  
  
  
            </button>
  
  
  
          </div>
  
  
  
          {parentMode !== "none" && (
  
  
  
            <div
  
  
  
              style={{
  
  
  
                padding: "14px",
  
  
  
                background: "rgba(212,175,55,0.07)",
  
  
  
                borderBottom: "1px solid #e5e7eb",
  
  
  
              }}
  
  
  
            >
  
  
  
              <div
  
  
  
                style={{
  
  
  
                  fontWeight: 900,
  
  
  
                  color: "#0f172a",
  
  
  
                  marginBottom: "10px",
  
  
  
                }}
  
  
  
              >
  
  
  
                {parentMode === "add" && "Add Parent"}
  
  
  
                {parentMode === "manage" && "Manage Parent"}
  
  
  
                {parentMode === "existing" && "Add Existing Parent"}
  
  
  
              </div>
  
  
  
              {parentMode === "existing" ? (
  
  
  
                <div
  
  
  
                  style={{
  
  
  
                    display: "flex",
  
  
  
                    gap: "8px",
  
  
  
                    flexWrap: "wrap",
  
  
  
                    alignItems: "center",
  
  
  
                  }}
  
  
  
                >
  
  
  
                  <select
  
  
  
                    style={{ ...selectStyle, minWidth: "280px" }}
  
  
  
                    value={selectedParent?.id || ""}
  
  
  
                    onChange={(e) => {
  
  
  
                      const found = parents.find(
  
  
  
                        (parent) => String(parent.id) === String(e.target.value)
  
  
  
                      );
  
  
  
                      setSelectedParent(found || null);
  
  
  
                    }}
  
  
  
                  >
  
  
  
                    <option value="">Select existing parent</option>
  
  
  
                    {parents.map((parent: any, index: number) => (
  
  
  
                      <option key={parent.id || index} value={parent.id || index}>
  
  
  
                        {parentName(parent)} {parentSurname(parent)} - {parentCell(parent)}
  
  
  
                      </option>
  
  
  
                    ))}
  
  
  
                  </select>
  
  
  
                  <button
  
  
  
                    style={goldBtn}
  
  
  
                    onClick={() => {
  
  
  
                      if (!selectedParent) {
  
  
  
                        alert("Please select an existing parent first.");
  
  
  
                        return;
  
  
  
                      }



                      const linkedParent = {



                        ...selectedParent,



                        learnerId: learner.id,



                        familyAccountId:



                          learner.familyAccountId ||



                          learner.familyAccount?.id ||



                          learner.familyId ||



                          learner.accountId ||



                          selectedParent.familyAccountId ||



                          "",



                      };



                      setParents((prev) =>



                        prev.map((parent) =>



                          String(parent.id) === String(selectedParent.id)



                            ? linkedParent



                            : parent



                        )



                      );



                      setSelectedParent(linkedParent);



                      setParentMode("none");



                    }}



                  >



                    Link Selected Parent



                  </button>



                  <button style={actionBtn} onClick={() => setParentMode("none")}>



                    Cancel



                  </button>



                </div>



              ) : (



                <>



                  <div



                    style={{



                      display: "grid",



                      gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",



                      gap: "8px",



                    }}



                  >



                    <input



                      style={inputStyle}



                      placeholder="Relationship"



                      value={parentDraft.relationship || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          relationship: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Name"



                      value={parentDraft.firstName || parentDraft.name || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          firstName: e.target.value,



                          name: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Surname"



                      value={parentDraft.lastName || parentDraft.surname || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          lastName: e.target.value,



                          surname: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Cell"



                      value={parentDraft.cell || parentDraft.phone || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          cell: e.target.value,



                          phone: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Email"



                      value={parentDraft.email || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          email: e.target.value,



                        }))



                      }



                    />



                    <input



                      style={inputStyle}



                      placeholder="Work"



                      value={parentDraft.work || parentDraft.workPhone || ""}



                      onChange={(e) =>



                        setParentDraft((prev) => ({



                          ...prev,



                          work: e.target.value,



                          workPhone: e.target.value,



                        }))



                      }



                    />



                  </div>



                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>



                    <button



                      style={goldBtn}



                      onClick={() => {



                        if (parentMode === "add") createLocalParent(learner);



                        if (parentMode === "manage") updateLocalParent();



                      }}



                    >



                      Save Parent



                    </button>



                    <button



                      style={actionBtn}



                      onClick={() => {



                        setParentMode("none");



                        setParentDraft({});



                      }}



                    >



                      Cancel



                    </button>



                  </div>



                </>



              )}



            </div>



          )}



          <table style={{ width: "100%", borderCollapse: "collapse" }}>



            <thead>



              <tr>



                <th style={th}>Relationship</th>



                <th style={th}>Name</th>



                <th style={th}>Surname</th>



                <th style={th}>Cell</th>



                <th style={th}>Email</th>



                <th style={th}>Work</th>



              </tr>



            </thead>



            <tbody>



              {visibleParents.length === 0 ? (



                <tr>



                  <td colSpan={6} style={{ ...td, textAlign: "center", padding: "20px" }}>



                    No parents linked to this learner yet



                  </td>



                </tr>



              ) : (



                visibleParents.map((parent: any, index: number) => {



                  const isSelected =



                    String(selectedParent?.id || "") === String(parent?.id || "");



                  return (



                    <tr



                    key={parent.idNumber || parent.email || index}



                      onClick={() => {



                        setSelectedParent(parent);



                        setParentMode("none");



                      }}



                      style={{



                        cursor: "pointer",



                        background: isSelected



                          ? "linear-gradient(90deg, rgba(212,175,55,0.25), #ffffff)"



                          : index % 2 === 0



                          ? "#ffffff"



                          : "rgba(212,175,55,0.06)",



                        outline: isSelected ? `2px solid ${GOLD}` : "none",



                      }}



                    >



                      <td style={td}>{parent.relationship || parent.relation || "-"}</td>



                      <td style={td}>{parentName(parent) || "-"}</td>



                      <td style={td}>{parentSurname(parent) || "-"}</td>



                      <td style={td}>{parentCell(parent) || "-"}</td>



                      <td style={td}>{parent.email || "-"}</td>



                      <td style={td}>{parentWork(parent) || "-"}</td>



                    </tr>



                  );



                })



              )}



            </tbody>



          </table>



        </div>



      </div>



    );



}
