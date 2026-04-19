import { useMemo, useState } from "react";
import { apiFetch } from "./api";

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

function splitFullName(fullName: string): { firstName: string; surname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", surname: "" };
  if (parts.length === 1) return { firstName: parts[0], surname: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

export default function AddLearner() {
  const schoolId = useMemo(() => localStorage.getItem("schoolId") || "", []);

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

  const [parentFullName, setParentFullName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentIdNumber, setParentIdNumber] = useState("");

  const [siblings, setSiblings] = useState<SiblingDraft[]>([]);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    if (!parentFullName.trim() || !parentPhone.trim()) {
      setMessage("Please complete Parent Full Name and Phone.");
      return;
    }

    const parentName = splitFullName(parentFullName);

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
          admissionNo: admissionNo.trim() || null,
          idNumber: idNumber.trim() || null,
          birthDate: dateOfBirth ? new Date(dateOfBirth).toISOString() : null,
          gender: gender || null,
          homeLanguage: homeLanguage.trim() || null,
          nationality: nationality.trim() || null,
          enrollmentDate: enrollmentDate ? new Date(enrollmentDate).toISOString() : null,
          parent: {
            firstName: parentName.firstName.trim(),
            surname: parentName.surname.trim(),
            email: parentEmail.trim() || null,
            phone: parentPhone.trim(),
            idNumber: parentIdNumber.trim() || null,
          },
          siblings: siblings
            .map((s) => ({
              firstName: s.firstName.trim(),
              lastName: s.surname.trim(),
              grade: s.grade.trim(),
              className: s.className.trim() || null,
              admissionNo: s.admissionNo.trim() || null,
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
      setParentFullName("");
      setParentEmail("");
      setParentPhone("");
      setParentIdNumber("");
      setSiblings([]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save learner.");
    } finally {
      setSaving(false);
    }
  };

  const pageStyle: React.CSSProperties = {
    padding: "32px",
    background: "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
    minHeight: "100%",
    borderRadius: "28px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
  };

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
    padding: 20,
    border: "1px solid rgba(15, 23, 42, 0.06)",
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: 6,
    display: "block",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15, 23, 42, 0.14)",
    outline: "none",
    fontSize: 14,
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: "0 0 12px 0",
    fontSize: 18,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  };

  const buttonStyle: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(15, 23, 42, 0.16)",
    padding: "10px 14px",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: "#0f172a",
    color: "#fff",
    border: "1px solid #0f172a",
    padding: "12px 16px",
  };

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a" }}>
          Add Learner
        </h1>
        <p style={{ margin: "10px 0 0 0", fontSize: 15, color: "rgba(15, 23, 42, 0.72)" }}>
          Capture learner details and link them to a parent.
        </p>
      </div>

      {message ? (
        <div
          style={{
            ...cardStyle,
            marginBottom: 16,
            borderColor: message.toLowerCase().includes("success") ? "rgba(30, 126, 52, 0.25)" : "rgba(204, 0, 0, 0.18)",
            background: message.toLowerCase().includes("success") ? "rgba(30, 126, 52, 0.06)" : "rgba(204, 0, 0, 0.05)",
          }}
          role="status"
        >
          <div style={{ fontWeight: 800, color: "#0f172a" }}>{message}</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Learner Details</h2>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Learner First Name</label>
              <input style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Learner Surname</label>
              <input style={inputStyle} value={surname} onChange={(e) => setSurname(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Grade / Class</label>
              <input style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. Grade 3" />
            </div>
            <div>
              <label style={labelStyle}>Grade / Class (Optional Class Name)</label>
              <input
                style={inputStyle}
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="e.g. 3A"
              />
            </div>

            <div>
              <label style={labelStyle}>Admission Number</label>
              <input style={inputStyle} value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>ID Number</label>
              <input style={inputStyle} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Date of Birth</label>
              <input style={inputStyle} type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Gender</label>
              <select style={inputStyle} value={gender} onChange={(e) => setGender(e.target.value as GenderOption)}>
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Home Language</label>
              <input style={inputStyle} value={homeLanguage} onChange={(e) => setHomeLanguage(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Nationality</label>
              <input style={inputStyle} value={nationality} onChange={(e) => setNationality(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Enrollment Date</label>
              <input
                style={inputStyle}
                type="date"
                value={enrollmentDate}
                onChange={(e) => setEnrollmentDate(e.target.value)}
              />
            </div>
            <div />
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 style={sectionTitleStyle}>Parent Details</h2>
          </div>

          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Parent Full Name</label>
              <input style={inputStyle} value={parentFullName} onChange={(e) => setParentFullName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>ID Number</label>
              <input style={inputStyle} value={parentIdNumber} onChange={(e) => setParentIdNumber(e.target.value)} />
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 style={sectionTitleStyle}>Siblings</h2>
            <button type="button" style={buttonStyle} onClick={addSibling}>
              + Add Sibling
            </button>
          </div>

          {siblings.length === 0 ? (
            <p style={{ margin: 0, color: "rgba(15, 23, 42, 0.72)" }}>No siblings added.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {siblings.map((s, idx) => (
                <div key={idx} style={{ padding: 14, borderRadius: 14, border: "1px solid rgba(15, 23, 42, 0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>Sibling {idx + 1}</div>
                    <button type="button" style={buttonStyle} onClick={() => removeSibling(idx)}>
                      Remove
                    </button>
                  </div>

                  <div style={{ ...gridStyle, marginTop: 12 }}>
                    <div>
                      <label style={labelStyle}>Learner First Name</label>
                      <input
                        style={inputStyle}
                        value={s.firstName}
                        onChange={(e) => updateSibling(idx, { firstName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Learner Surname</label>
                      <input
                        style={inputStyle}
                        value={s.surname}
                        onChange={(e) => updateSibling(idx, { surname: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Grade / Class</label>
                      <input style={inputStyle} value={s.grade} onChange={(e) => updateSibling(idx, { grade: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelStyle}>Class</label>
                      <input
                        style={inputStyle}
                        value={s.className}
                        onChange={(e) => updateSibling(idx, { className: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Admission Number</label>
                      <input
                        style={inputStyle}
                        value={s.admissionNo}
                        onChange={(e) => updateSibling(idx, { admissionNo: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>ID Number</label>
                      <input
                        style={inputStyle}
                        value={s.idNumber}
                        onChange={(e) => updateSibling(idx, { idNumber: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Date of Birth</label>
                      <input
                        style={inputStyle}
                        type="date"
                        value={s.dateOfBirth}
                        onChange={(e) => updateSibling(idx, { dateOfBirth: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Gender</label>
                      <select
                        style={inputStyle}
                        value={s.gender}
                        onChange={(e) => updateSibling(idx, { gender: e.target.value as GenderOption })}
                      >
                        <option value="">Select…</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Home Language</label>
                      <input
                        style={inputStyle}
                        value={s.homeLanguage}
                        onChange={(e) => updateSibling(idx, { homeLanguage: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Nationality</label>
                      <input
                        style={inputStyle}
                        value={s.nationality}
                        onChange={(e) => updateSibling(idx, { nationality: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Enrollment Date</label>
                      <input
                        style={inputStyle}
                        type="date"
                        value={s.enrollmentDate}
                        onChange={(e) => updateSibling(idx, { enrollmentDate: e.target.value })}
                      />
                    </div>
                    <div />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={primaryButtonStyle} onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}