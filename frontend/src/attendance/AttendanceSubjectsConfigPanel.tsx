import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

const GOLD = "#d4af37";
const NAVY = "#0f172a";

type SchoolSubject = {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

type ClassroomRow = {
  id: string;
  name: string;
  attendanceSessionDisplay?: "PERIODS" | "SUBJECTS" | null;
};

type SlotRow = {
  id?: string;
  dayOfWeek: number;
  sortOrder: number;
  subjectId: string;
  subjectName?: string;
};

type Props = {
  schoolId: string;
  defaultClassroomName?: string;
};

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(15,23,42,0.15)",
  fontWeight: 700,
  fontSize: 13,
  color: NAVY,
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 11,
  fontWeight: 800,
  color: "#64748b",
};

export default function AttendanceSubjectsConfigPanel({ schoolId, defaultClassroomName }: Props) {
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [subjects, setSubjects] = useState<SchoolSubject[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState("");
  const [displayMode, setDisplayMode] = useState<"PERIODS" | "SUBJECTS">("PERIODS");
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedClassroom = useMemo(
    () => classrooms.find((c) => c.id === selectedClassroomId) || null,
    [classrooms, selectedClassroomId]
  );

  const loadSubjects = useCallback(async () => {
    const data: any = await apiFetch(
      `/api/school-subjects?schoolId=${encodeURIComponent(schoolId)}`
    );
    if (data?.success && Array.isArray(data.subjects)) {
      setSubjects(data.subjects);
    }
  }, [schoolId]);

  const loadClassrooms = useCallback(async () => {
    const data: any = await apiFetch(
      `/api/classrooms?schoolId=${encodeURIComponent(schoolId)}`
    );
    const rows: ClassroomRow[] = Array.isArray(data?.classrooms)
      ? data.classrooms.map((c: any) => ({
          id: String(c.id),
          name: String(c.name || ""),
          attendanceSessionDisplay: c.attendanceSessionDisplay || "PERIODS",
        }))
      : Array.isArray(data)
        ? data.map((c: any) => ({
            id: String(c.id),
            name: String(c.name || ""),
            attendanceSessionDisplay: c.attendanceSessionDisplay || "PERIODS",
          }))
        : [];
    setClassrooms(rows.filter((c) => c.id && c.name));
  }, [schoolId]);

  const loadSlots = useCallback(
    async (classroomId: string) => {
      const data: any = await apiFetch(
        `/api/school-subjects/classroom-slots?schoolId=${encodeURIComponent(schoolId)}&classroomId=${encodeURIComponent(classroomId)}`
      );
      if (!data?.success) throw new Error(data?.error || "Could not load timetable slots.");
      const mode = data.classroom?.attendanceSessionDisplay;
      setDisplayMode(mode === "SUBJECTS" ? "SUBJECTS" : "PERIODS");
      setSlots(
        Array.isArray(data.slots)
          ? data.slots.map((s: any) => ({
              id: s.id,
              dayOfWeek: Number(s.dayOfWeek),
              sortOrder: Number(s.sortOrder ?? 0),
              subjectId: String(s.subjectId),
              subjectName: s.subjectName,
            }))
          : []
      );
    },
    [schoolId]
  );

  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await Promise.all([loadClassrooms(), loadSubjects()]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load configuration.");
      } finally {
        setLoading(false);
      }
    })();
  }, [schoolId, loadClassrooms, loadSubjects]);

  useEffect(() => {
    if (!classrooms.length) return;
    if (selectedClassroomId) return;
    const match = defaultClassroomName
      ? classrooms.find((c) => c.name === defaultClassroomName)
      : null;
    setSelectedClassroomId(match?.id || classrooms[0].id);
  }, [classrooms, defaultClassroomName, selectedClassroomId]);

  useEffect(() => {
    if (!selectedClassroomId) return;
    setError(null);
    void (async () => {
      try {
        await loadSlots(selectedClassroomId);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load slots.");
      }
    })();
  }, [selectedClassroomId, loadSlots]);

  const addSubject = async () => {
    const name = newSubjectName.trim();
    if (!name) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const data: any = await apiFetch("/api/school-subjects", {
        method: "POST",
        body: JSON.stringify({ schoolId, name }),
      });
      if (!data?.success) throw new Error(data?.error || "Could not create subject.");
      setNewSubjectName("");
      await loadSubjects();
      setMessage(`Subject "${name}" added.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create subject.");
    } finally {
      setSaving(false);
    }
  };

  const saveDisplayMode = async () => {
    if (!selectedClassroomId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const data: any = await apiFetch("/api/school-subjects/classroom-display-mode", {
        method: "PUT",
        body: JSON.stringify({
          schoolId,
          classroomId: selectedClassroomId,
          attendanceSessionDisplay: displayMode,
        }),
      });
      if (!data?.success) throw new Error(data?.error || "Could not save display mode.");
      await loadClassrooms();
      setMessage(`Display mode set to ${displayMode} for ${selectedClassroom?.name || "classroom"}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save display mode.");
    } finally {
      setSaving(false);
    }
  };

  const addSlot = (dayOfWeek: number) => {
    const firstSubject = subjects[0];
    if (!firstSubject) {
      setError("Add at least one school subject before creating timetable slots.");
      return;
    }
    const daySlots = slots.filter((s) => s.dayOfWeek === dayOfWeek);
    const sortOrder = daySlots.length ? Math.max(...daySlots.map((s) => s.sortOrder)) + 1 : 0;
    setSlots([...slots, { dayOfWeek, sortOrder, subjectId: firstSubject.id }]);
  };

  const updateSlot = (index: number, patch: Partial<SlotRow>) => {
    setSlots(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeSlot = (index: number) => {
    setSlots(slots.filter((_, i) => i !== index));
  };

  const saveSlots = async () => {
    if (!selectedClassroomId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const data: any = await apiFetch("/api/school-subjects/classroom-slots", {
        method: "PUT",
        body: JSON.stringify({
          schoolId,
          classroomId: selectedClassroomId,
          slots: slots.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            sortOrder: s.sortOrder,
            subjectId: s.subjectId,
          })),
        }),
      });
      if (!data?.success) throw new Error(data?.error || "Could not save timetable slots.");
      await loadSlots(selectedClassroomId);
      setMessage("Timetable slots saved.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save slots.");
    } finally {
      setSaving(false);
    }
  };

  const btn: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(15,23,42,0.12)",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 12,
    background: "#fff",
    color: NAVY,
  };

  if (loading) {
    return (
      <div style={{ fontWeight: 700, color: "#64748b", fontSize: 13 }}>
        Loading attendance session settings…
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(15,23,42,0.10)",
        borderTop: `3px solid ${GOLD}`,
        background: "#fffdf8",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 14, color: NAVY, marginBottom: 4 }}>
        Attendance session display & subjects
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>
        Set whether this classroom captures by standard periods or by subject timetable (Mon–Fri).
      </p>

      {error ? (
        <div style={{ marginBottom: 10, color: "#b91c1c", fontWeight: 700, fontSize: 12 }}>{error}</div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 10, color: "#166534", fontWeight: 700, fontSize: 12 }}>{message}</div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div>
          <label style={labelStyle}>Classroom</label>
          <select
            style={inputStyle}
            value={selectedClassroomId}
            onChange={(e) => setSelectedClassroomId(e.target.value)}
          >
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Session display mode</label>
          <select
            style={inputStyle}
            value={displayMode}
            onChange={(e) => setDisplayMode(e.target.value as "PERIODS" | "SUBJECTS")}
          >
            <option value="PERIODS">PERIODS</option>
            <option value="SUBJECTS">SUBJECTS</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" style={{ ...btn, background: GOLD, borderColor: GOLD }} onClick={() => void saveDisplayMode()} disabled={saving}>
            Save mode
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>School subjects</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {subjects.length === 0 ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>No subjects yet.</span>
          ) : (
            subjects.map((s) => (
              <span
                key={s.id}
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: "rgba(212,175,55,0.15)",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {s.name}
              </span>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            type="text"
            placeholder="New subject name"
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
          />
          <button type="button" style={btn} onClick={() => void addSubject()} disabled={saving}>
            Add subject
          </button>
        </div>
      </div>

      {displayMode === "SUBJECTS" ? (
        <div>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Mon–Fri subject slots</div>
          {WEEKDAYS.map((day) => {
            const daySlots = slots
              .map((s, index) => ({ s, index }))
              .filter(({ s }) => s.dayOfWeek === day.value);
            return (
              <div key={day.value} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, minWidth: 80 }}>{day.label}</span>
                  <button type="button" style={btn} onClick={() => addSlot(day.value)}>
                    + Slot
                  </button>
                </div>
                {daySlots.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginLeft: 80 }}>
                    No slots
                  </div>
                ) : (
                  daySlots.map(({ s, index }) => (
                    <div
                      key={`${day.value}-${index}`}
                      style={{ display: "flex", gap: 8, marginLeft: 80, marginBottom: 4, alignItems: "center" }}
                    >
                      <select
                        style={{ ...inputStyle, maxWidth: 220 }}
                        value={s.subjectId}
                        onChange={(e) => updateSlot(index, { subjectId: e.target.value })}
                      >
                        {subjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" style={btn} onClick={() => removeSlot(index)}>
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            );
          })}
          <button
            type="button"
            style={{ ...btn, background: NAVY, color: "#fff", borderColor: NAVY }}
            onClick={() => void saveSlots()}
            disabled={saving}
          >
            Save timetable slots
          </button>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          Period mode uses the standard EduClear period register. Switch to SUBJECTS to configure a
          subject timetable.
        </p>
      )}
    </div>
  );
}
