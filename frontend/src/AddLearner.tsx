import { useEffect, useState } from "react";
import { apiFetch, API_URL } from "./api";
import { getBirthDateFromSouthAfricanId } from "./learner/learnerIdentity";
import ParentsSection, { parentToApiPayload } from "./learner/ParentsSection";
import {
  normalizeParentRecord,
  parentsFromLearner,
  validateParentForSave,
} from "./learner/parentFormUtils";
import type { ParentRecord } from "./learner/parentFormTypes";
import { useSchoolId } from "./useSchoolId";
import "./AddLearner.css";

type AddLearnerProps = {
  onBack?: () => void;
  schoolParents?: ParentRecord[];
};



type GenderOption = "" | "Male" | "Female" | "Other";



type SiblingDraft = {



  firstName: string;



  surname: string;



  grade: string;



  className: string;



  admissionNo: string;



  idNumber: string;



  dateOfBirth: string;



  gender: GenderOption;



  homeLanguage: string;



  nationality: string;



  enrollmentDate: string;



};



function parentsOfLearner(learner: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(learner?.parents) ? (learner.parents as Record<string, unknown>[]) : [];
}

function primaryParentOfLearner(learner: Record<string, unknown>): Record<string, unknown> | null {
  const parents = parentsOfLearner(learner);
  return (parents.find((p) => p.isPrimary) as Record<string, unknown> | undefined) || parents[0] || null;
}

function learnerSurnameFromBase(learner: Record<string, unknown>): string {
  return String(learner?.surname || learner?.lastName || "").trim();
}

function learnerClassFromBase(learner: Record<string, unknown>): string {
  return String(learner?.classroom || learner?.className || learner?.grade || "").trim();
}

export default function AddLearner({ onBack, schoolParents: schoolParentsProp }: AddLearnerProps = {}) {



  const schoolId = useSchoolId();



  const [firstName, setFirstName] = useState("");



  const [surname, setSurname] = useState("");



  const [grade, setGrade] = useState("");



  const [className, setClassName] = useState("");



  const [admissionNo, setAdmissionNo] = useState("");



  const [idNumber, setIdNumber] = useState("");



  const [dateOfBirth, setDateOfBirth] = useState("");



  const [gender, setGender] = useState<GenderOption>("");



  const [homeLanguage, setHomeLanguage] = useState("");



  const [nationality, setNationality] = useState("");



  const [enrollmentDate, setEnrollmentDate] = useState("");



  const [parents, setParents] = useState<ParentRecord[]>([]);
  const [schoolParents, setSchoolParents] = useState<ParentRecord[]>(
    Array.isArray(schoolParentsProp) ? schoolParentsProp : []
  );



  const [siblings, setSiblings] = useState<SiblingDraft[]>([]);



  const [saving, setSaving] = useState(false);



  const [message, setMessage] = useState<string | null>(null);

  const [siblingBaseName, setSiblingBaseName] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem("selectedLearnerForSibling");
    if (!raw) return;

    localStorage.removeItem("selectedLearnerForSibling");

    try {
      const base = JSON.parse(raw) as Record<string, unknown>;
      if (!base || typeof base !== "object") return;

      const baseFirst = String(base.firstName || base.name || "").trim();
      const baseLast = learnerSurnameFromBase(base);
      if (baseFirst || baseLast) {
        setSiblingBaseName(`${baseFirst} ${baseLast}`.trim());
      }

      if (baseLast) setSurname(baseLast);

      const baseClass = learnerClassFromBase(base);
      if (baseClass) {
        setGrade(baseClass);
        setClassName(baseClass);
      }

      const prefilled = parentsFromLearner(base);
      if (prefilled.length) {
        setParents(prefilled.map((p) => ({ ...p, surname: p.surname || baseLast })));
      } else {
        const parent = primaryParentOfLearner(base);
        if (parent) {
          setParents([
            normalizeParentRecord({
              ...parent,
              surname: String(parent.surname || parent.lastName || baseLast).trim(),
            }),
          ]);
        }
      }
    } catch {
      // ignore invalid stored sibling context
    }
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    if (Array.isArray(schoolParentsProp) && schoolParentsProp.length) {
      setSchoolParents(schoolParentsProp);
      return;
    }
    let cancelled = false;
    void fetch(`${API_URL}/api/parents?schoolId=${encodeURIComponent(schoolId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.parents) ? data.parents : [];
        setSchoolParents(rows.map((p: Record<string, unknown>) => normalizeParentRecord(p)));
      })
      .catch(() => {
        if (!cancelled) setSchoolParents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, schoolParentsProp]);

  const handleMainIdNumberChange = (value: string) => {



    setIdNumber(value);



    const extractedBirthDate = getBirthDateFromSouthAfricanId(value);



    if (extractedBirthDate) {



      setDateOfBirth(extractedBirthDate);



    }



  };



  const addSibling = () => {



    setSiblings((prev) => [



      ...prev,



      {



        firstName: "",



        surname: "",



        grade: "",



        className: "",



        admissionNo: "",



        idNumber: "",



        dateOfBirth: "",



        gender: "",



        homeLanguage: "",



        nationality: "",



        enrollmentDate: "",



      },



    ]);



  };



  const updateSibling = (idx: number, patch: Partial<SiblingDraft>) => {



    setSiblings((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));



  };



  const updateSiblingIdNumber = (idx: number, value: string) => {



    const extractedBirthDate = getBirthDateFromSouthAfricanId(value);



    updateSibling(idx, {



      idNumber: value,



      ...(extractedBirthDate ? { dateOfBirth: extractedBirthDate } : {}),



    });



  };



  const removeSibling = (idx: number) => {



    setSiblings((prev) => prev.filter((_, i) => i !== idx));



  };



  const onSave = async () => {



    setMessage(null);



    if (!schoolId) {



      setMessage("Missing schoolId. Please log in again.");



      return;



    }



    if (!firstName.trim() || !surname.trim() || !grade.trim()) {



      setMessage("Please complete Learner First Name, Learner Surname, and Grade / Class.");



      return;



    }



    if (parents.length === 0) {
      setMessage("Please add at least one parent with contact details.");
      return;
    }

    const primaryParent = parents[0];
    const parentErr = validateParentForSave(primaryParent);
    if (parentErr) {
      setMessage(parentErr);
      return;
    }

    const parentPayloads = parents.map((p) => parentToApiPayload(p));

    setSaving(true);



    try {



      await apiFetch("/api/learners", {



        method: "POST",



        body: JSON.stringify({



          schoolId,



          firstName: firstName.trim(),



          lastName: surname.trim(),



          grade: grade.trim(),



          className: className.trim() || null,






          idNumber: idNumber.trim() || null,



          birthDate: dateOfBirth ? new Date(dateOfBirth).toISOString() : null,



          gender: gender || null,



          homeLanguage: homeLanguage.trim() || null,



          nationality: nationality.trim() || null,



          enrollmentDate: enrollmentDate ? new Date(enrollmentDate).toISOString() : null,



          parent: parentPayloads[0],
          parents: parentPayloads,



          siblings: siblings



            .map((s) => ({



              firstName: s.firstName.trim(),



              lastName: s.surname.trim(),



              grade: s.grade.trim(),



              className: s.className.trim() || null,






              idNumber: s.idNumber.trim() || null,



              birthDate: s.dateOfBirth ? new Date(s.dateOfBirth).toISOString() : null,



              gender: s.gender || null,



              homeLanguage: s.homeLanguage.trim() || null,



              nationality: s.nationality.trim() || null,



              enrollmentDate: s.enrollmentDate ? new Date(s.enrollmentDate).toISOString() : null,



            }))



            .filter((s) => s.firstName && s.lastName && s.grade),



        }),



      });



      setMessage("Learner saved successfully.");



      setFirstName("");



      setSurname("");



      setGrade("");



      setClassName("");



      setAdmissionNo("");



      setIdNumber("");



      setDateOfBirth("");



      setGender("");



      setHomeLanguage("");



      setNationality("");



      setEnrollmentDate("");



      setParents([]);
      setSiblings([]);



    } catch (e) {



      setMessage(e instanceof Error ? e.message : "Failed to save learner.");



    } finally {



      setSaving(false);



    }



  };



  const messageIsSuccess = message ? message.toLowerCase().includes("success") : false;

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    window.history.back();
  };

  return (
    <div className="add-learner-page">
      <header className="add-learner-header">
        <span className="add-learner-badge">New registration</span>
        <h1 className="add-learner-title">Add Learner</h1>
        <p
          className={`add-learner-subtitle${siblingBaseName ? " add-learner-subtitle--sibling" : ""}`}
        >
          {siblingBaseName
            ? `Adding a sibling for ${siblingBaseName}. Surname, class, and parent details are pre-filled from the selected learner.`
            : "Capture learner details and link parent information"}
        </p>
        <div className="add-learner-accent-line" aria-hidden="true" />
      </header>

      {message ? (
        <div
          className={`add-learner-message ${
            messageIsSuccess ? "add-learner-message--success" : "add-learner-message--error"
          }`}
          role="status"
        >
          {message}
        </div>
      ) : null}

      <div className="add-learner-form-stack">
        <section className="add-learner-card" aria-labelledby="add-learner-learner-heading">
          <div className="add-learner-section-header">
            <div className="add-learner-section-header-main">
              <span className="add-learner-section-accent" aria-hidden="true" />
              <h2 id="add-learner-learner-heading" className="add-learner-section-title">
                Learner Details
              </h2>
            </div>
          </div>

          <div className="add-learner-grid">
            <div className="add-learner-field">
              <label className="add-learner-label">Learner First Name</label>
              <input
                className="add-learner-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter first name"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Learner Surname</label>
              <input
                className="add-learner-input"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                placeholder="Enter surname"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Grade / Class</label>
              <input
                className="add-learner-input"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="e.g. Grade 3"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Grade / Class (Optional Class Name)</label>
              <input
                className="add-learner-input"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="e.g. 3A"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Account / Admission No</label>
              <input
                className="add-learner-input add-learner-input--readonly"
                value="Auto-generated on save"
                readOnly
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">ID Number</label>
              <input
                className="add-learner-input"
                value={idNumber}
                onChange={(e) => handleMainIdNumberChange(e.target.value)}
                placeholder="13-digit ID number"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Date of Birth</label>
              <input
                className="add-learner-input"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Gender</label>
              <select
                className="add-learner-select"
                value={gender}
                onChange={(e) => setGender(e.target.value as GenderOption)}
              >
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Home Language</label>
              <input
                className="add-learner-input"
                value={homeLanguage}
                onChange={(e) => setHomeLanguage(e.target.value)}
                placeholder="e.g. isiZulu"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Nationality</label>
              <input
                className="add-learner-input"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="e.g. South African"
              />
            </div>
            <div className="add-learner-field">
              <label className="add-learner-label">Enrollment Date</label>
              <input
                className="add-learner-input"
                type="date"
                value={enrollmentDate}
                onChange={(e) => setEnrollmentDate(e.target.value)}
              />
            </div>
          </div>
        </section>

        <ParentsSection
          parents={parents}
          onChange={setParents}
          schoolParents={schoolParents}
          defaultSurname={surname}
          onSendEmail={(p) => {
            const email = (p.email || "").trim();
            if (!email) {
              setMessage("Add an email address for this parent first.");
              return;
            }
            window.location.href = `mailto:${encodeURIComponent(email)}`;
          }}
          onSendSms={(p) => {
            const cell = (p.cellNo || p.cell || p.phone || "").trim();
            if (!cell) {
              setMessage("Add a cell number for this parent first.");
              return;
            }
            window.location.href = `sms:${encodeURIComponent(cell)}`;
          }}
        />

        <section className="add-learner-card" aria-labelledby="add-learner-siblings-heading">
          <div className="add-learner-section-header">
            <div className="add-learner-section-header-main">
              <span className="add-learner-section-accent" aria-hidden="true" />
              <h2 id="add-learner-siblings-heading" className="add-learner-section-title">
                Additional Details — Siblings
              </h2>
            </div>
            <button type="button" className="add-learner-btn add-learner-btn--gold-outline" onClick={addSibling}>
              + Add Sibling
            </button>
          </div>

          {siblings.length === 0 ? (
            <p className="add-learner-empty-hint">No siblings added.</p>
          ) : (
            <div className="add-learner-siblings-stack">
              {siblings.map((s, idx) => (
                <div key={idx} className="add-learner-sibling-block">
                  <div className="add-learner-sibling-block-header">
                    <div className="add-learner-sibling-label">Sibling {idx + 1}</div>
                    <button
                      type="button"
                      className="add-learner-btn add-learner-btn--secondary"
                      onClick={() => removeSibling(idx)}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="add-learner-grid">
                    <div className="add-learner-field">
                      <label className="add-learner-label">Learner First Name</label>
                      <input
                        className="add-learner-input"
                        value={s.firstName}
                        onChange={(e) => updateSibling(idx, { firstName: e.target.value })}
                        placeholder="Enter first name"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Learner Surname</label>
                      <input
                        className="add-learner-input"
                        value={s.surname}
                        onChange={(e) => updateSibling(idx, { surname: e.target.value })}
                        placeholder="Enter surname"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Grade / Class</label>
                      <input
                        className="add-learner-input"
                        value={s.grade}
                        onChange={(e) => updateSibling(idx, { grade: e.target.value })}
                        placeholder="e.g. Grade 3"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Class</label>
                      <input
                        className="add-learner-input"
                        value={s.className}
                        onChange={(e) => updateSibling(idx, { className: e.target.value })}
                        placeholder="e.g. 3A"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Account / Admission No</label>
                      <input
                        className="add-learner-input add-learner-input--readonly"
                        value="Auto-generated on save"
                        readOnly
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">ID Number</label>
                      <input
                        className="add-learner-input"
                        value={s.idNumber}
                        onChange={(e) => updateSiblingIdNumber(idx, e.target.value)}
                        placeholder="13-digit ID number"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Date of Birth</label>
                      <input
                        className="add-learner-input"
                        type="date"
                        value={s.dateOfBirth}
                        onChange={(e) => updateSibling(idx, { dateOfBirth: e.target.value })}
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Gender</label>
                      <select
                        className="add-learner-select"
                        value={s.gender}
                        onChange={(e) => updateSibling(idx, { gender: e.target.value as GenderOption })}
                      >
                        <option value="">Select…</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Home Language</label>
                      <input
                        className="add-learner-input"
                        value={s.homeLanguage}
                        onChange={(e) => updateSibling(idx, { homeLanguage: e.target.value })}
                        placeholder="e.g. isiZulu"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Nationality</label>
                      <input
                        className="add-learner-input"
                        value={s.nationality}
                        onChange={(e) => updateSibling(idx, { nationality: e.target.value })}
                        placeholder="e.g. South African"
                      />
                    </div>
                    <div className="add-learner-field">
                      <label className="add-learner-label">Enrollment Date</label>
                      <input
                        className="add-learner-input"
                        type="date"
                        value={s.enrollmentDate}
                        onChange={(e) => updateSibling(idx, { enrollmentDate: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="add-learner-actions">
          <button type="button" className="add-learner-btn add-learner-btn--outline" onClick={handleBack}>
            Cancel / Back
          </button>
          <button
            type="button"
            className="add-learner-btn add-learner-btn--save"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Learner"}
          </button>
        </div>
      </div>
    </div>
  );
}