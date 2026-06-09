import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { staffApiFetch } from "../staffApi";
import {
  ATTENDANCE_PERIOD_OPTIONS,
  DEFAULT_ATTENDANCE_PERIOD,
  type AttendancePeriodValue,
} from "../attendance/periodOptions";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";

const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Excused"] as const;

type LearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  grade?: string;
  className?: string | null;
};

type MarkRow = {
  learnerId: string;
  status: string;
  reason?: string | null;
};

export default function TeacherAttendancePage() {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState<AttendancePeriodValue>(DEFAULT_ATTENDANCE_PERIOD);
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingMarks, setLoadingMarks] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get("class");
    if (fromUrl) setClassName(fromUrl);
  }, [searchParams, setClassName]);

  useEffect(() => {
    if (!className) return;
    void (async () => {
      setLoadingMarks(true);
      setErr(null);
      setNotice(null);
      try {
        const qs = new URLSearchParams({ className, date, period });
        const data = (await staffApiFetch(`/api/teacher-app/attendance?${qs}`)) as {
          learners?: LearnerRow[];
          marks?: MarkRow[];
        };
        setLearners(data.learners || []);
        setMarks(data.marks || []);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not load attendance");
      } finally {
        setLoadingMarks(false);
      }
    })();
  }, [className, date, period]);

  const markByLearner = useMemo(() => {
    const map = new Map<string, MarkRow>();
    for (const m of marks) map.set(m.learnerId, m);
    return map;
  }, [marks]);

  const updateMark = (learnerId: string, field: "status" | "reason", value: string) => {
    setMarks((prev) => {
      const existing = prev.find((m) => m.learnerId === learnerId);
      if (existing) {
        return prev.map((m) => (m.learnerId === learnerId ? { ...m, [field]: value } : m));
      }
      return [...prev, { learnerId, status: field === "status" ? value : "", reason: field === "reason" ? value : "" }];
    });
  };

  const setAllPresent = () => {
    setMarks(
      learners.map((l) => ({
        learnerId: l.id,
        status: "Present",
        reason: markByLearner.get(l.id)?.reason || "",
      }))
    );
  };

  const clearAllMarks = () => {
    setMarks([]);
  };

  const saveAttendance = async () => {
    if (!className) return;
    if (!learners.length) {
      setErr("No learners in this class.");
      return;
    }
    const missing = learners.filter((l) => !markByLearner.get(l.id)?.status);
    if (missing.length) {
      setErr("Please set a status for every learner before saving.");
      return;
    }

    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      const payload = {
        className,
        date,
        period,
        marks: learners.map((l) => {
          const mark = markByLearner.get(l.id)!;
          return {
            learnerId: l.id,
            status: mark.status,
            reason: mark.reason || "",
          };
        }),
      };
      const data = (await staffApiFetch("/api/teacher-app/attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as { success?: boolean; error?: string };
      if (!data?.success) throw new Error(data?.error || "Save failed");
      setNotice(`Attendance saved for ${className} (${date}).`);
      const qs = new URLSearchParams({ className, date, period });
      const refreshed = (await staffApiFetch(`/api/teacher-app/attendance?${qs}`)) as {
        marks?: MarkRow[];
      };
      setMarks(refreshed.marks || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">Attendance</h1>
      <p className="teacher-muted">
        Capture attendance for your assigned classes. All assigned teachers see the same register.
      </p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {notice && <p className="teacher-pwa-hint">{notice}</p>}
      {noAssigned && <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>}

      {!noAssigned && (
        <>
          <div className="teacher-field">
            <label>Class</label>
            <select
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              disabled={loading || classrooms.length === 0}
            >
              <option value="">{loading ? "Loading classes…" : "Select class"}</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} ({c.learnerCount} learners)
                </option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Register</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as AttendancePeriodValue)}
            >
              {ATTENDANCE_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </>
      )}

      {className && (
        <div className="teacher-attendance-actions">
          <button type="button" className="teacher-touch-btn" onClick={setAllPresent}>
            Mark all present
          </button>
          <button type="button" className="teacher-touch-btn" onClick={clearAllMarks}>
            Clear all
          </button>
          <button
            type="button"
            className="teacher-touch-btn primary"
            disabled={saving || loadingMarks}
            onClick={() => void saveAttendance()}
          >
            {saving ? "Saving…" : "Save attendance"}
          </button>
        </div>
      )}

      {loadingMarks && className ? <p className="teacher-muted">Loading attendance…</p> : null}

      {className && !loadingMarks ? (
        <ul className="teacher-record-list" style={{ marginTop: 16 }}>
          {learners.length === 0 ? (
            <li className="teacher-muted">No active learners in this class.</li>
          ) : (
            learners.map((l) => {
              const mark = markByLearner.get(l.id);
              const currentStatus = mark?.status || "";
              return (
                <li key={l.id} className="teacher-record-card teacher-attendance-card">
                  <div>
                    <strong>
                      {l.firstName} {l.lastName}
                    </strong>
                    <span className="teacher-muted">
                      {" "}
                      · {l.grade || l.className || "—"}
                    </span>
                  </div>
                  <div className="teacher-attendance-status-row">
                    {ATTENDANCE_STATUSES.map((status) => {
                      const active = currentStatus === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          className={`teacher-attendance-status-btn${active ? " is-active" : ""}`}
                          onClick={() => updateMark(l.id, "status", status)}
                        >
                          {status}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    className="teacher-attendance-reason"
                    placeholder="Reason (optional)"
                    value={mark?.reason || ""}
                    onChange={(e) => updateMark(l.id, "reason", e.target.value)}
                  />
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
