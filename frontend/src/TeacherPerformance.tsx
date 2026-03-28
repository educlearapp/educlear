import { useEffect, useState } from "react";



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



export default function TeacherPerformance() {

    const schoolId = "cmnacgg6b0000tusy4b8e6tku";



  const [form, setForm] = useState({

    teacherName: "",

    teacherEmail: "",

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



  async function loadRecords() {

    try {

      const res = await fetch(

        `http://localhost:3000/teacher-performance/school/${schoolId}`

      );

      const data = await res.json();



      setRecords([...data].sort((a, b) => b.finalScore - a.finalScore));

    } catch (error) {

      console.error("Failed to load records", error);

    }

  }



  useEffect(() => {

    loadRecords();

  }, []);



  const handleSubmit = async () => {

    try {

      setLoading(true);



      const url = editingId

        ? `http://localhost:3000/teacher-performance/${editingId}`

        : "http://localhost:3000/teacher-performance";



      const method = editingId ? "PUT" : "POST";



      const res = await fetch(url, {

        method,

        headers: {

          "Content-Type": "application/json",

        },

        body: JSON.stringify({

          ...form,

          schoolId,

          month: "2026-04",

        }),

      });



      const data = await res.json();

      console.log("SAVE/UPDATE RESPONSE", data);



      alert(editingId ? "Updated!" : "Saved!");



      setForm({

        teacherName: "",

        teacherEmail: "",

        learnerResults: 0,

        classroomManagement: 0,

        teachingQuality: 0,

        administration: 0,

        professionalConduct: 0,

        notes: "",

      });



      setEditingId(null);

      loadRecords();

      window.scrollTo({ top: 0, behavior: "smooth" });

    } catch (error) {

      console.error(error);

      alert("Failed to save");

    } finally {

      setLoading(false);

    }

  };



  const handleDelete = async (id: string) => {

    try {

      const res = await fetch(`http://localhost:3000/teacher-performance/${id}`, {

        method: "DELETE",

      });



      const data = await res.json();

      console.log(data);



      loadRecords();

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



  return (

    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>

      <h2>Teacher Performance</h2>



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



        <label>Learner Results</label>

        <input

          type="number"

          value={form.learnerResults}

          onChange={(e) =>

            setForm({ ...form, learnerResults: Number(e.target.value) })

          }

          style={{ padding: 10 }}

        />



        <label>Classroom Management</label>

        <input

          type="number"

          value={form.classroomManagement}

          onChange={(e) =>

            setForm({ ...form, classroomManagement: Number(e.target.value) })

          }

          style={{ padding: 10 }}

        />



        <label>Teaching Quality</label>

        <input

          type="number"

          value={form.teachingQuality}

          onChange={(e) =>

            setForm({ ...form, teachingQuality: Number(e.target.value) })

          }

          style={{ padding: 10 }}

        />



        <label>Administration</label>

        <input

          type="number"

          value={form.administration}

          onChange={(e) =>

            setForm({ ...form, administration: Number(e.target.value) })

          }

          style={{ padding: 10 }}

        />



        <label>Professional Conduct</label>

        <input

          type="number"

          value={form.professionalConduct}

          onChange={(e) =>

            setForm({ ...form, professionalConduct: Number(e.target.value) })

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

          disabled={loading}

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

                    record.finalScore >= 80

                      ? "green"

                      : record.finalScore >= 60

                      ? "orange"

                      : "red",

                }}

              >

                Final Score: {record.finalScore}

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