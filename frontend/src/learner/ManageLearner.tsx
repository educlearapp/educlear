import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import ParentsSection from "./ParentsSection";
import type { ParentRecord } from "./parentFormTypes";
import { normalizeParentRecord, parentToApiPayload } from "./parentFormUtils";
import {
  calculateLearnerAge,
  getBirthDateFromSouthAfricanId,
  getLearnerAccountNo,
  normaliseDateForInput,
} from "./learnerIdentity";
import "../AddLearner.css";

const GOLD = "#d4af37";

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

function learnerFirstName(learner: any) {
  return String(learner?.firstName || learner?.name || "").trim();
}

function learnerSurname(learner: any) {
  return String(learner?.lastName || learner?.surname || "").trim();
}

function learnerFullName(learner: any) {
  return `${learnerFirstName(learner)} ${learnerSurname(learner)}`.trim();
}

function learnerClassroom(learner: any) {
  return learner?.classroom || learner?.className || learner?.classroomName || learner?.grade || "";
}

function normalizeLearnerForManage(raw: any) {
  if (!raw || typeof raw !== "object") return raw;
  const firstName = learnerFirstName(raw);
  const surname = learnerSurname(raw);
  const classroom = learnerClassroom(raw);
  return {
    ...raw,
    firstName,
    name: firstName,
    lastName: surname,
    surname,
    classroom,
    className: raw.className || classroom,
    classroomName: raw.classroomName || classroom,
    idNumber: raw.idNumber || raw.idNo || "",
    idNo: raw.idNumber || raw.idNo || "",
    admissionNo:
      raw.admissionNo ||
      raw.accountNo ||
      raw.accountNumber ||
      raw.familyAccount?.accountRef ||
      "",
    accountNo:
      raw.accountNo ||
      raw.accountNumber ||
      raw.admissionNo ||
      raw.familyAccount?.accountRef ||
      "",
    birthDate: raw.birthDate || raw.dateOfBirth || raw.dob || "",
    dateOfBirth: raw.birthDate || raw.dateOfBirth || raw.dob || "",
    dob: raw.birthDate || raw.dateOfBirth || raw.dob || "",
    parents: Array.isArray(raw.parents) ? raw.parents : [],
  };
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
  const [detailLearner, setDetailLearner] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const seedLearner = useMemo(() => {
    if (learnerProp) return normalizeLearnerForManage(learnerProp);
    const saved = localStorage.getItem("selectedLearnerForManage");
    if (!saved) return null;
    try {
      return normalizeLearnerForManage(JSON.parse(saved));
    } catch {
      return null;
    }
  }, [learnerProp]);

  const learnerId = String(seedLearner?.id || "").trim();
  const learner = detailLearner || seedLearner;

  useEffect(() => {
    if (!learnerId) {
      setDetailLearner(null);
      setDetailError("");
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");

    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/learners/${encodeURIComponent(learnerId)}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load learner profile");
        }
        const loaded = normalizeLearnerForManage(payload?.learner || payload);
        if (cancelled || !loaded?.id) return;
        setDetailLearner(loaded);
        setSelectedLearner(loaded);
        localStorage.setItem("selectedLearnerForManage", JSON.stringify(loaded));
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Failed to load learner profile");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [learnerId, setSelectedLearner]);

  useEffect(() => {
    if (!learnerId) return;
    setProfileTab("general");
    setProfileMoreOpen(false);
  }, [learnerId]);




    if (!learner && detailLoading) {
      return (
        <div style={{ padding: "32px" }}>
          <h1 className="page-title">Registration</h1>
          <p>Loading learner profile…</p>
        </div>
      );
    }

    if (!learner) {
  
  
  
      return (
  
  
  
        <div style={{ padding: "32px" }}>
  
  
  
          <h1 className="page-title">Registration</h1>
  
  
  
          <p>{detailError || "No learner selected."}</p>
  
  
  
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

    const linkedParents: ParentRecord[] =
      Array.isArray(learner?.parents) && learner.parents.length
        ? learner.parents.map((p: Record<string, unknown>) => normalizeParentRecord(p))
        : visibleParents.map((p: Record<string, unknown>) => normalizeParentRecord(p));

    const syncParentsState = (next: ParentRecord[]) => {
      persistLearner({ ...learner, parents: next });
      const nextIds = new Set(next.map((p) => String(p.id || "")).filter(Boolean));
      setParents((prev) => {
        const kept = prev.filter((p) => !nextIds.has(String(p.id || "")));
        return [...next, ...kept];
      });
    };

    const persistParentsToApi = async (draft: ParentRecord) => {
      if (!learner?.id) return draft;
      const draftPayload = parentToApiPayload(draft);
      const isNew =
        !draft.id || String(draft.id).startsWith("local-parent-");
      const payloads = isNew
        ? [...linkedParents.map((p) => parentToApiPayload(p)), draftPayload]
        : linkedParents.map((p) =>
            String(p.id) === String(draft.id) ? draftPayload : parentToApiPayload(p)
          );

      const response = await fetch(`${API_URL}/api/learners/${learner.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parents: payloads }),
      });
      if (!response.ok) throw new Error("Failed to save parent");
      const result = await response.json();
      const updated = result.learner || result;
      if (updated?.parents) {
        const normalized = updated.parents.map((p: Record<string, unknown>) => normalizeParentRecord(p));
        syncParentsState(normalized);
        const match =
          normalized.find((p: ParentRecord) => String(p.id) === String(draft.id)) ||
          normalized.find((p: ParentRecord) => draft.idNumber && p.idNumber === draft.idNumber) ||
          normalized[normalized.length - 1];
        return match || draft;
      }
      return draft;
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

                    parents: linkedParents.map((p) => parentToApiPayload(p)),
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
  
  
  
                {field("Name / Nickname", "firstName", learnerFirstName(learner), true)}
  
  
  
                {field("Surname", "lastName", learnerSurname(learner), true)}
  
  
  
                {field("ID No", "idNumber", learner.idNumber || learner.idNo || "")}
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
  
  
  
        <ParentsSection
          parents={linkedParents}
          onChange={syncParentsState}
          schoolParents={parents.map((p: Record<string, unknown>) => normalizeParentRecord(p))}
          defaultSurname={learner.lastName || learner.surname || ""}
          onPersistParent={persistParentsToApi}
          onSendEmail={(p) => {
            const email = (p.email || "").trim();
            if (!email) {
              alert("Add an email address for this parent first.");
              return;
            }
            window.location.href = `mailto:${encodeURIComponent(email)}`;
          }}
          onSendSms={(p) => {
            const cell = (p.cellNo || p.cell || p.phone || "").trim();
            if (!cell) {
              alert("Add a cell number for this parent first.");
              return;
            }
            window.location.href = `sms:${encodeURIComponent(cell)}`;
          }}
        />



      </div>



    );



}
