import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { staffApiFetch } from "../staffApi";
import {
  ATTENDANCE_PERIOD_OPTIONS,
  DEFAULT_ATTENDANCE_PERIOD,
} from "../attendance/periodOptions";
import {
  SUBJECTS_EMPTY_MESSAGE,
  type CaptureSessionMode,
  type CaptureSessionOption,
  resolveSelectedSessionLabel,
} from "../attendance/captureSessions";
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
  const [period, setPeriod] = useState<string>(DEFAULT_ATTENDANCE_PERIOD);
  const [captureMode, setCaptureMode] = useState<CaptureSessionMode>("PERIODS");
  const [captureSessions, setCaptureSessions] = useState<CaptureSessionOption[]>([]);
  const [captureEmptyMessage, setCaptureEmptyMessage] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
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
    if (!className) {
      setCaptureMode("PERIODS");
      setCaptureSessions([]);
      setCaptureEmptyMessage(null);
      setSubjectId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setSessionsLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({ className, date });
        const data = (await staffApiFetch(
          `/api/teacher-app/attendance/capture-sessions?${qs}`
        )) as {
          success?: boolean;
          mode?: CaptureSessionMode;
          sessions?: CaptureSessionOption[];
          emptyMessage?: string | null;
          error?: string;
        };
        if (cancelled) return;
        if (!data?.success) throw new Error(data?.error || "Could not load sessions");
        const mode = data.mode === "SUBJECTS" ? "SUBJECTS" : "PERIODS";
        setCaptureMode(mode);
        if (mode === "SUBJECTS") {
          const sessions = Array.isArray(data.sessions) ? data.sessions : [];
          setCaptureSessions(sessions);
          setCaptureEmptyMessage(
            sessions.length === 0 ? data.emptyMessage || SUBJECTS_EMPTY_MESSAGE : null
          );
          setPeriod((prev) => {
            const stillValid = sessions.some((s) => s.period === prev);
            if (stillValid) {
              const current = sessions.find((s) => s.period === prev);
              setSubjectId(current?.subjectId || null);
              return prev;
            }
            const first = sessions[0];
            setSubjectId(first?.subjectId || null);
            setMarks([]);
            return first?.period || "";
          });
        } else {
          setCaptureSessions([]);
          setCaptureEmptyMessage(null);
          setPeriod((prev) => {
            if (!prev || String(prev).startsWith("SLOT_")) {
              setSubjectId(null);
              setMarks([]);
              return DEFAULT_ATTENDANCE_PERIOD;
            }
            setSubjectId(null);
            return prev;
          });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not load capture sessions");
          setCaptureMode("PERIODS");
          setCaptureSessions([]);
        }
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [className, date]);

  useEffect(() => {
    if (!className) return;
    if (captureMode === "SUBJECTS" && !period) {
      setLearners([]);
      setMarks([]);
      return;
    }
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
  }, [className, date, period, captureMode]);

  const markByLearner = useMemo(() => {
    const map = new Map<string, MarkRow>();
    for (const m of marks) map.set(m.learnerId, m);
    return map;
  }, [marks]);

  const sessionLabel = resolveSelectedSessionLabel(period, captureSessions, captureMode);

  const updateMark = (learnerId: string, field: "status" | "reason", value: string) => {
    setMarks((prev) => {
      const existing = prev.find((m) => m.learnerId === learnerId);
      if (existing) {
        return prev.map((m) => (m.learnerId === learnerId ? { ...m, [field]: value } : m));
      }
      return [
        ...prev,
        {
          learnerId,
          status: field === "status" ? value : "",
          reason: field === "reason" ? value : "",
        },
      ];
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
    if (captureMode === "SUBJECTS" && !period) {
      setErr(SUBJECTS_EMPTY_MESSAGE);
      return;
    }
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
        subjectId: subjectId || undefined,
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
      const summary = (
        data as {
          summary?: {
            present?: number;
            absent?: number;
            late?: number;
            excused?: number;
            saved?: number;
          };
        }
      ).summary;
      const summaryText = summary
        ? ` Present ${summary.present ?? 0}, Absent ${summary.absent ?? 0}, Late ${summary.late ?? 0}, Excused ${summary.excused ?? 0}.`
        : "";
      setNotice(
        `Attendance saved successfully for ${className} · ${sessionLabel} on ${date}.${summaryText}`
      );
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
  const noSubjectSessions = captureMode === "SUBJECTS" && !period;

  return (
    <div>
      <h1 className="teacher-page-heading">Attendance</h1>
      <p className="teacher-muted">
        Capture attendance for your assigned classes. All assigned teachers see the same register.
      </p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {notice && (
        <p className="teacher-success-banner" role="status" aria-live="polite">
          {notice}
        </p>
      )}
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
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="teacher-field">
            <label>{captureMode === "SUBJECTS" ? "Subject session" : "Register"}</label>
            <select
              value={period}
              disabled={sessionsLoading || noSubjectSessions}
              onChange={(e) => {
                const next = e.target.value;
                setPeriod(next);
                const session = captureSessions.find((s) => s.period === next);
                setSubjectId(session?.subjectId || null);
                setMarks([]);
              }}
            >
              {captureMode === "SUBJECTS" ? (
                captureSessions.length === 0 ? (
                  <option value="">No sessions scheduled</option>
                ) : (
                  captureSessions.map((opt) => (
                    <option key={opt.period} value={opt.period}>
                      {opt.label}
                    </option>
                  ))
                )
              ) : (
                ATTENDANCE_PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              )}
            </select>
            {captureMode === "SUBJECTS" && period ? (
              <p className="teacher-muted" style={{ marginTop: 6 }}>
                Capturing: <strong>{sessionLabel}</strong>
              </p>
            ) : null}
          </div>
        </>
      )}

      {captureEmptyMessage ? (
        <p className="teacher-error" role="status">
          {captureEmptyMessage}
        </p>
      ) : null}

      {className && !noSubjectSessions && (
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
            disabled={saving || loadingMarks || sessionsLoading}
            onClick={() => void saveAttendance()}
          >
            {saving ? "Saving…" : "Save attendance"}
          </button>
        </div>
      )}

      {(loadingMarks || sessionsLoading) && className ? (
        <p className="teacher-muted">Loading attendance…</p>
      ) : null}

      {className && !loadingMarks && !sessionsLoading && !noSubjectSessions ? (
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
                    placeholder="Reason (optional) e.g. S, SN - note"
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
