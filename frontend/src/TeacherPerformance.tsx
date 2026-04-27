import { useCallback, useEffect, useState } from "react";
import { useSchoolId } from "./useSchoolId";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";



type TeacherRecord = {

  id: string;

  teacherName: string;

  teacherEmail?: string;

  month: string;

  learnerResults: number;

  classroomManagement: number;

  teachingQuality: number;

  administration: number;

  professionalConduct: number;

  finalScore: number;

  performanceLevel: string;

  notes?: string;

};

function defaultMonth(): string {
  return new Date().toISOString().slice(0, 7);
}



export default function TeacherPerformance() {
  
  const schoolId = useSchoolId();

  const [form, setForm] = useState({
    teacherName: "",
    teacherEmail: "",
    month: defaultMonth(),
    learnerResults: 0,
    classroomManagement: 0,
    teachingQuality: 0,
    administration: 0,
    professionalConduct: 0,
    notes: "",
  });



  const [records, setRecords] = useState<TeacherRecord[]>([]);

  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isTopPerformerHovered, setIsTopPerformerHovered] = useState(false);
  const topPerformer =
    records.length > 0 ? [...records].sort((a, b) => b.finalScore - a.finalScore)[0] : null;

  const loadRecords = useCallback(async () => {
    if (!schoolId) return;
    try {
      const res = await fetch(`${API_URL}/api/teacher-performance/school/${schoolId}`);
      if (!res.ok) {
        throw new Error(`Failed to load records (${res.status})`);
      }
      const data = await res.json();
      setRecords([...data].sort((a, b) => b.finalScore - a.finalScore));
    } catch (error) {
      console.error("Failed to load records", error);
    }
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    loadRecords();
  }, [schoolId, loadRecords]);



  const handleSubmit = async () => {
    if (!schoolId) {
      alert('Missing schoolId. Please log in again so a school is selected.');
      return;
    }
    try {
      setLoading(true);
      const wasEditing = Boolean(editingId);
      const url = editingId
        ? `${API_URL}/api/teacher-performance/${editingId}`
        : `${API_URL}/api/teacher-performance`;
      const method = editingId ? "PUT" : "POST";
      const body: Record<string, unknown> = {
        teacherName: form.teacherName,
        teacherEmail: form.teacherEmail,
        month: form.month,
        learnerResults: form.learnerResults,
        classroomManagement: form.classroomManagement,
        teachingQuality: form.teachingQuality,
        administration: form.administration,
        professionalConduct: form.professionalConduct,
        notes: form.notes,
      };
      if (!wasEditing) {
        body.schoolId = schoolId;
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(
          (data as { details?: string; error?: string })?.details ||
            (data as { error?: string })?.error ||
            "Save failed"
        );
        return;
      }
      setForm({
        teacherName: "",
        teacherEmail: "",
        month: defaultMonth(),
        learnerResults: 0,
        classroomManagement: 0,
        teachingQuality: 0,
        administration: 0,
        professionalConduct: 0,
        notes: "",
      });
      setEditingId(null);
      await loadRecords();
      window.scrollTo({ top: 0, behavior: "smooth" });
      alert(wasEditing ? "Updated!" : "Saved!");
    } catch (error) {
      console.error("SAVE ERROR:", error);
      alert(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };



  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/teacher-performance/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { details?: string; error?: string })?.details || (data as { error?: string })?.error || "Failed to delete");
        return;
      }
      await loadRecords();
    } catch (error) {
      console.error(error);
      alert("Failed to delete");
    }
  };



  function getLevelColor(level: string) {

    if (level === "Excellent") return "green";

    if (level === "Acceptable") return "orange";

    if (level === "At Risk") return "darkorange";

    return "red";

  }

  function getPerformanceBadge(level: string | undefined, score: number | undefined) {
    const normalized = (level || "").trim().toLowerCase();

    let label: "Excellent" | "Good" | "Average" | "Poor" = "Average";
    if (normalized === "excellent") label = "Excellent";
    else if (normalized === "good") label = "Good";
    else if (normalized === "average") label = "Average";
    else if (normalized === "poor") label = "Poor";
    else if (normalized === "acceptable") label = "Average";
    else if (normalized === "at risk" || normalized === "critical") label = "Poor";
    else if (typeof score === "number") {
      if (score >= 9) label = "Excellent";
      else if (score >= 7) label = "Good";
      else if (score >= 5) label = "Average";
      else label = "Poor";
    }

    const stylesByLabel: Record<typeof label, { bg: string; border: string; text: string }> = {
      Excellent: { bg: "#ECFDF5", border: "#10B981", text: "#047857" },
      Good: { bg: "#EFF6FF", border: "#3B82F6", text: "#1D4ED8" },
      Average: { bg: "#FFF7ED", border: "#F97316", text: "#C2410C" },
      Poor: { bg: "#FEF2F2", border: "#EF4444", text: "#B91C1C" },
    };

    return { label, ...stylesByLabel[label] };
  }

  return (

    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>

      <h2>Teacher Performance</h2>

      {!schoolId && (
        <p style={{ color: "crimson", marginBottom: 12 }}>
          Missing school selection. Please log in again so a school is selected.
        </p>
      )}

      {topPerformer && (



<div
  onMouseEnter={() => setIsTopPerformerHovered(true)}
  onMouseLeave={() => setIsTopPerformerHovered(false)}
  style={{
    marginTop: 16,
    marginBottom: 20,
    padding: 16,
    borderRadius: 14,
    background: "linear-gradient(180deg, #ffffff 0%, #FFFBEB 100%)",
    border: "1px solid #FDE68A",
    borderLeft: "5px solid #D4AF37",
    boxShadow: isTopPerformerHovered
      ? "0 12px 28px rgba(15, 23, 42, 0.12)"
      : "0 6px 16px rgba(15, 23, 42, 0.08)",
    transform: isTopPerformerHovered ? "translateY(-2px)" : "translateY(0)",
    transition: "transform 160ms ease, box-shadow 160ms ease",
  }}
>
  {(() => {
    const badge = getPerformanceBadge(topPerformer.performanceLevel, topPerformer.finalScore);
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "rgba(212, 175, 55, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(212, 175, 55, 0.35)",
            flex: "0 0 auto",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" role="img" aria-label="Trophy">
            <path d="M8 4h8v2a4 4 0 0 1-4 4 4 4 0 0 1-4-4V4Z" fill="#D4AF37" />
            <path
              d="M6 4H4a1 1 0 0 0-1 1v1a5 5 0 0 0 5 5h.2A6 6 0 0 0 11 12.9V14H9a1 1 0 0 0-1 1v1h8v-1a1 1 0 0 0-1-1h-2v-1.1A6 6 0 0 0 15.8 11H16a5 5 0 0 0 5-5V5a1 1 0 0 0-1-1h-2"
              stroke="#D4AF37"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M10 20h4" stroke="#D4AF37" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M9 18h6" stroke="#D4AF37" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 13, letterSpacing: 0.2, color: "#6b7280" }}>Top Performer</div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                background: badge.bg,
                color: badge.text,
                border: `1px solid ${badge.border}`,
                whiteSpace: "nowrap",
              }}
            >
              {badge.label}
            </span>
          </div>

          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#0f172a",
              marginTop: 4,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {topPerformer.teacherName}
          </div>

          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            {topPerformer.teacherEmail || "No email"}
          </div>

          <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#6b7280" }}>Score</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
              {topPerformer.finalScore.toFixed(1)} / 10
            </span>
          </div>
        </div>
      </div>
    );
  })()}
</div>



)}

      <div style={{ display: "grid", gap: 12, marginBottom: 30 }}>

        <input

          placeholder="Teacher Name"

          value={form.teacherName}

          onChange={(e) => setForm({ ...form, teacherName: e.target.value })}

          style={{ padding: 10 }}

        />



        <input

          placeholder="Email"

          value={form.teacherEmail}

          onChange={(e) => setForm({ ...form, teacherEmail: e.target.value })}

          style={{ padding: 10 }}

        />

        <label>Month</label>

        <input

          type="month"

          value={form.month}

          onChange={(e) => setForm({ ...form, month: e.target.value })}

          style={{ padding: 10 }}

        />

        <label>Learner Results</label>

        <input



  type="number"



  min={0}



  max={10}



  step={1}



  value={form.learnerResults}



  onChange={(e) =>



    setForm({



      ...form,



      learnerResults: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))),



    })



  }



  style={{ padding: 10 }}



/>



        <label>Classroom Management</label>

        <input



  type="number"



  min={0}



  max={10}



  step={1}



  value={form.classroomManagement}



  onChange={(e) =>



    setForm({



      ...form,



      classroomManagement: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))),



    })



  }



  style={{ padding: 10 }}



/>



        <label>Teaching Quality</label>

        <input



  type="number"



  min={0}



  max={10}



  step={1}



  value={form.teachingQuality}



  onChange={(e) =>



    setForm({



      ...form,



      teachingQuality: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))),



    })



  }



  style={{ padding: 10 }}



/>



        <label>Administration</label>

        <input



type="number"



min={0}



max={10}



step={1}



value={form.administration}



onChange={(e) =>



  setForm({



    ...form,



    administration: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))),



  })



}



style={{ padding: 10 }}



/>



        <label>Professional Conduct</label>

        <input



  type="number"



  min={0}



  max={10}



  step={1}



  value={form.professionalConduct}



  onChange={(e) =>



    setForm({



      ...form,



      professionalConduct: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))),



    })



  }



  style={{ padding: 10 }}



/>



        <label>Notes</label>

        <input

          placeholder="Optional notes"

          value={form.notes}

          onChange={(e) => setForm({ ...form, notes: e.target.value })}

          style={{ padding: 10 }}

        />



        <button

          type="button"

          onClick={handleSubmit}

          disabled={loading || !schoolId}

          style={{

            padding: "12px 16px",

            cursor: "pointer",

            fontWeight: "bold",

          }}

        >

          {loading ? "Saving..." : editingId ? "Update" : "Save"}

        </button>

      </div>



      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>

        <div

          style={{

            border: "1px solid #ddd",

            borderRadius: 12,

            padding: 16,

            minWidth: 180,

            background: "#fff",

          }}

        >

          <div style={{ fontSize: 14, color: "#666" }}>Total Teachers</div>

          <div style={{ fontSize: 28, fontWeight: "bold" }}>{records.length}</div>

        </div>



        <div

          style={{

            border: "1px solid #ddd",

            borderRadius: 12,

            padding: 16,

            minWidth: 180,

            background: "#fff",

          }}

        >

          <div style={{ fontSize: 14, color: "#666" }}>Excellent</div>

          <div style={{ fontSize: 28, fontWeight: "bold", color: "green" }}>

            {records.filter((r) => r.performanceLevel === "Excellent").length}

          </div>

        </div>



        <div

          style={{

            border: "1px solid #ddd",

            borderRadius: 12,

            padding: 16,

            minWidth: 180,

            background: "#fff",

          }}

        >

          <div style={{ fontSize: 14, color: "#666" }}>Acceptable</div>

          <div style={{ fontSize: 28, fontWeight: "bold", color: "orange" }}>

            {records.filter((r) => r.performanceLevel === "Acceptable").length}

          </div>

        </div>



        <div

          style={{

            border: "1px solid #ddd",

            borderRadius: 12,

            padding: 16,

            minWidth: 180,

            background: "#fff",

          }}

        >

          <div style={{ fontSize: 14, color: "#666" }}>At Risk / Critical</div>

          <div style={{ fontSize: 28, fontWeight: "bold", color: "red" }}>

            {

              records.filter(

                (r) =>

                  r.performanceLevel === "At Risk" ||

                  r.performanceLevel === "Critical"

              ).length

            }

          </div>

        </div>

      </div>



      <h3>Saved Teacher Records</h3>



      {records.length === 0 ? (

        <p>No records yet.</p>

      ) : (

        <div style={{ display: "grid", gap: 12 }}>

          {records.map((record, index) => (

            <div

              key={record.id}

              style={{

                border: "1px solid #ddd",

                borderRadius: 12,

                padding: 16,

                background: "#fff",

                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",

              }}

            >

              <h4 style={{ margin: 0 }}>

                {index === 0 ? "🏆 " : ""}

                {index + 1}. {record.teacherName}

              </h4>



              <p style={{ margin: "8px 0" }}>{record.teacherEmail || "No email"}</p>

              <p style={{ margin: "8px 0" }}>Month: {record.month}</p>



              <p

                style={{

                  margin: "8px 0",

                  fontWeight: "bold",

                  color:

                    record.finalScore >= 8 

                      ? "green"

                      : record.finalScore >= 6 

                      ? "orange"

                      : "red",

                }}

              >

                Final Score: {record.finalScore.toFixed(1)} / 10

              </p>



              <p

                style={{

                  margin: "8px 0",

                  fontWeight: "bold",

                  color: getLevelColor(record.performanceLevel),

                }}

              >

                {record.performanceLevel}

              </p>



              {record.performanceLevel === "At Risk" ||

              record.performanceLevel === "Critical" ? (

                <p style={{ margin: "8px 0", color: "red", fontWeight: "bold" }}>

                  ⚠️ Intervention Required

                </p>

              ) : null}



              {record.notes ? (

                <p style={{ margin: "8px 0" }}>Notes: {record.notes}</p>

              ) : null}



              <div style={{ marginTop: 10 }}>

                <button

                  type="button"

                  onClick={() => {

                    setForm({

                      teacherName: record.teacherName || "",

                      teacherEmail: record.teacherEmail || "",

                      month: record.month || defaultMonth(),

                      learnerResults: Number(record.learnerResults) || 0,

                      classroomManagement: Number(record.classroomManagement) || 0,

                      teachingQuality: Number(record.teachingQuality) || 0,

                      administration: Number(record.administration) || 0,

                      professionalConduct: Number(record.professionalConduct) || 0,

                      notes: record.notes || "",

                    });



                    setEditingId(record.id);

                    window.scrollTo({ top: 0, behavior: "smooth" });

                  }}

                  style={{

                    marginRight: 10,

                    padding: "8px 12px",

                    background: "orange",

                    color: "white",

                    border: "none",

                    borderRadius: 8,

                    cursor: "pointer",

                  }}

                >

                  Edit

                </button>



                <button

                  type="button"

                  onClick={() => handleDelete(record.id)}

                  style={{

                    padding: "8px 12px",

                    background: "red",

                    color: "white",

                    border: "none",

                    borderRadius: 8,

                    cursor: "pointer",

                  }}

                >

                  Delete

                </button>

              </div>

            </div>

          ))}

        </div>

      )}

    </div>

  );

}