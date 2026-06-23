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
import LearnerBillingPlanTab from "./LearnerBillingPlanTab";
import { notifyLearnersRefresh } from "../billing/billingLedger";

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
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  fontSize: "13px",
  width: "100%",
  boxSizing: "border-box",
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
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

type GeneralFormState = {
  name: string;
  surname: string;
  idNumber: string;
  birthDate: string;
  gender: string;
  classroom: string;
  homeLanguage: string;
  nationality: string;
  enrollmentDate: string;
  notes: string;
};

const emptyGeneralForm: GeneralFormState = {
  name: "",
  surname: "",
  idNumber: "",
  birthDate: "",
  gender: "",
  classroom: "",
  homeLanguage: "",
  nationality: "",
  enrollmentDate: "",
  notes: "",
};

function learnerFirstName(learner: any) {
  return String(learner?.firstName || learner?.name || learner?.first_name || "").trim();
}

function learnerSurname(learner: any) {
  return String(learner?.lastName || learner?.surname || learner?.last_name || learner?.lastName || "").trim();
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
  const id = String(raw.id || raw.learnerId || "").trim();
  return {
    ...raw,
    id: id || raw.id,
    learnerId: id || raw.learnerId,
    firstName,
    name: firstName,
    lastName: surname,
    surname,
    classroom,
    className: raw.className || classroom,
    classroomName: raw.classroomName || classroom,
    idNumber: raw.idNumber || raw.idNo || raw.identityNumber || "",
    idNo: raw.idNumber || raw.idNo || raw.identityNumber || "",
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
    gender: raw.gender || raw.Gender || raw.sex || "",
    homeLanguage: raw.homeLanguage || raw.language || "",
    citizenship: raw.citizenship || raw.nationality || "",
    nationality: raw.citizenship || raw.nationality || "",
    enrollmentStatus: raw.enrollmentStatus || "",
    parents: Array.isArray(raw.parents) ? raw.parents : [],
    billingPlan: Array.isArray(raw.billingPlan) ? raw.billingPlan : [],
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
  const [form, setForm] = useState<GeneralFormState>(emptyGeneralForm);
  const [unenrolling, setUnenrolling] = useState(false);

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

  const learnerId = String(seedLearner?.id || seedLearner?.learnerId || "").trim();
  const learner = detailLearner || seedLearner;

  useEffect(() => {
    if (!learnerId) {
      setDetailLearner(null);
      setDetailError("");
      setForm(emptyGeneralForm);
      return;
    }

    let cancelled = false;
    setDetailLearner(null);
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

  useEffect(() => {
    const currentLearner = detailLearner || seedLearner;
    if (!currentLearner?.id) {
      setForm(emptyGeneralForm);
      return;
    }

    setForm({
      name: learnerFirstName(currentLearner),
      surname: learnerSurname(currentLearner),
      idNumber: currentLearner?.idNumber || currentLearner?.idNo || "",
      birthDate: normaliseDateForInput(
        currentLearner?.birthDate || currentLearner?.dob || currentLearner?.dateOfBirth || ""
      ),
      gender: String(currentLearner?.gender || currentLearner?.Gender || currentLearner?.sex || "").trim(),
      classroom: String(learnerClassroom(currentLearner) || "").trim(),
      homeLanguage: currentLearner?.homeLanguage || currentLearner?.language || "",
      nationality: currentLearner?.nationality || currentLearner?.citizenship || "",
      enrollmentDate: normaliseDateForInput(
        currentLearner?.enrollmentDate || currentLearner?.enrolmentDate || ""
      ),
      notes: currentLearner?.notes || "",
    });
  }, [detailLearner, seedLearner, learnerId]);




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
    const isHistoricalLearner =
      String(learner?.enrollmentStatus || "").trim().toUpperCase() === "HISTORICAL";
    const enrollmentAction = isHistoricalLearner ? "Re-enrol" : "Unenrol";

    const persistLearner = (updated: any) => {
      setSelectedLearner(updated);
      setDetailLearner(updated);
      localStorage.setItem("selectedLearnerForManage", JSON.stringify(updated));
    };

    const reloadLearnerProfile = async () => {
      if (!learnerId) return null;
      const response = await fetch(`${API_URL}/api/learners/${encodeURIComponent(learnerId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to reload learner profile");
      }
      const loaded = normalizeLearnerForManage(payload?.learner || payload);
      if (!loaded?.id) return null;
      persistLearner(loaded);
      setLearners((prev) =>
        prev.map((row) => (String(row.id) === String(loaded.id) ? { ...row, ...loaded } : row))
      );
      return loaded;
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

      const reloaded = await reloadLearnerProfile();
      const normalized = Array.isArray(reloaded?.parents)
        ? reloaded.parents.map((p: Record<string, unknown>) => normalizeParentRecord(p))
        : [];
      if (normalized.length) {
        syncParentsState(normalized);
      }
      const match =
        normalized.find((p: ParentRecord) => String(p.id) === String(draft.id)) ||
        normalized.find((p: ParentRecord) => draft.idNumber && p.idNumber === draft.idNumber) ||
        normalized[normalized.length - 1];
      return match || draft;
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

    const handleUnenrolLearner = async () => {
      if (!learner?.id || unenrolling) return;
      const confirmed = window.confirm(
        `Unenrol ${fullName || "this learner"}? Their profile and billing/payment history will be kept.`
      );
      if (!confirmed) return;

      setUnenrolling(true);
      try {
        const response = await fetch(
          `${API_URL}/api/learners/${encodeURIComponent(learner.id)}/enrollment-status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enrollmentStatus: "HISTORICAL" }),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to unenrol learner");
        }

        const updatedLearner = normalizeLearnerForManage(payload?.learner || {
          ...learner,
          enrollmentStatus: "HISTORICAL",
        });
        persistLearner(updatedLearner);
        setLearners((prevLearners: any[]) =>
          prevLearners.filter((item: any) => String(item.id) !== String(learner.id))
        );
        notifyLearnersRefresh();
        alert("Learner unenrolled successfully.");
        onBack();
      } catch (error) {
        console.error(error);
        alert(error instanceof Error ? error.message : "Failed to unenrol learner");
      } finally {
        setUnenrolling(false);
      }
    };

    const handleReenrolLearner = async () => {
      if (!learner?.id || unenrolling) return;
      const confirmed = window.confirm(`Re-enrol ${fullName || "this learner"} as active?`);
      if (!confirmed) return;

      setUnenrolling(true);
      try {
        const response = await fetch(
          `${API_URL}/api/learners/${encodeURIComponent(learner.id)}/enrollment-status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enrollmentStatus: "ACTIVE" }),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to re-enrol learner");
        }

        const updatedLearner = normalizeLearnerForManage(payload?.learner || {
          ...learner,
          enrollmentStatus: "ACTIVE",
        });
        persistLearner(updatedLearner);
        setLearners((prevLearners: any[]) => [
          updatedLearner,
          ...prevLearners.filter((item: any) => String(item.id) !== String(learner.id)),
        ]);
        notifyLearnersRefresh();
        alert("Learner re-enrolled successfully.");
        onBack();
      } catch (error) {
        console.error(error);
        alert(error instanceof Error ? error.message : "Failed to re-enrol learner");
      } finally {
        setUnenrolling(false);
      }
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

    const genderField = () => (
      <>
        <label style={labelStyle}>Gender</label>
        <select
          style={selectStyle}
          value={String(learner.gender || "").trim()}
          onChange={(e) => updateLearnerField("gender", e.target.value)}
        >
          <option value="">Select</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
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
  
  
  
              {["Send Email", "Send SMS", enrollmentAction, "Delete"].map((item) => (
  
  
  
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
  
  
  
                  disabled={(item === "Unenrol" || item === "Re-enrol") && unenrolling}
                  onClick={() => {
  
  
  
                    setProfileMoreOpen(false);
  
  
  
                    if (item === "Unenrol") {
                      void handleUnenrolLearner();
                      return;
                    }

                    if (item === "Re-enrol") {
                      void handleReenrolLearner();
                      return;
                    }

                    alert(`${item} will be connected in the next functionality pass.`);
  
  
  
                  }}
  
  
  
                >
  
  
  
                  {item === "Unenrol" && unenrolling
                    ? "Unenrolling..."
                    : item === "Re-enrol" && unenrolling
                      ? "Re-enrolling..."
                      : item}
  
  
  
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
  
  
  
                <label style={labelStyle}>* Name / Nickname</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, name: next }));
                    updateLearnerField("firstName", next);
                    updateLearnerField("name", next);
                  }}
                />

                <label style={labelStyle}>* Surname</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.surname}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, surname: next }));
                    updateLearnerField("lastName", next);
                    updateLearnerField("surname", next);
                  }}
                />

                <label style={labelStyle}>ID No</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.idNumber}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, idNumber: next }));
                    updateLearnerField("idNumber", next);
                  }}
                />

                <label style={labelStyle}>* Birth Date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, birthDate: next }));
                    updateLearnerField("birthDate", next);
                  }}
                />

                {accountNoField()}

                <label style={labelStyle}>Gender</label>
                <select
                  style={selectStyle}
                  value={form.gender}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, gender: next }));
                    updateLearnerField("gender", next);
                  }}
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>

                <label style={labelStyle}>Classroom</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.classroom}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, classroom: next }));
                    updateLearnerField("classroom", next);
                  }}
                />

                <label style={labelStyle}>Home Language</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.homeLanguage}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, homeLanguage: next }));
                    updateLearnerField("homeLanguage", next);
                  }}
                />

                <label style={labelStyle}>Nationality</label>
                <input
                  style={inputStyle}
                  type="text"
                  value={form.nationality}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, nationality: next }));
                    updateLearnerField("nationality", next);
                  }}
                />

                {field("Religion", "religion", learner.religion)}

                <label style={labelStyle}>Enrolment Date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.enrollmentDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, enrollmentDate: next }));
                    updateLearnerField("enrollmentDate", next);
                    updateLearnerField("enrolmentDate", next);
                  }}
                />

                <label style={labelStyle}>Notes</label>
                <textarea
                  style={{
                    ...inputStyle,
                    minHeight: "105px",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                  value={form.notes}
                  onChange={(e) => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, notes: next }));
                    updateLearnerField("notes", next);
                  }}
                />
  
  
  
              </div>
  
  
  
            ) : profileTab === "billing" ? (
              <LearnerBillingPlanTab
                learner={learner}
                onLearnerUpdated={persistLearner}
                setLearners={setLearners}
              />
            ) : (
              <div style={{ padding: "28px", color: "#64748b", fontWeight: 900 }}>
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
