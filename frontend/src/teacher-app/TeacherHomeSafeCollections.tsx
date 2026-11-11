import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import { getStaffToken } from "../staffApi";

type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
type GroupKind = "TRANSPORT" | "ACTIVITY";
type Attendance =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "EXCUSED"
  | "UNCONFIRMED";
type Progress =
  | "WAITING"
  | "CALLED"
  | "READY"
  | "COLLECTED"
  | "HANDED_OVER"
  | "RETURNED"
  | "PARTICIPATING"
  | "COMPLETED"
  | "AWAY";

type Session = {
  id: string;
  groupId: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  responsibleAdult: string;
  location?: string | null;
  learnerIds: string[];
};

type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  driverName?: string | null;
  driverContact?: string | null;
  vehicleReg?: string | null;
  sessions: Session[];
};

type Learner = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  className: string;
  photoUrl: string | null;
};

type RegisterRow = {
  id: string;
  sessionId: string;
  learnerId: string;
  schoolLocalDate: string;
  attendance: Attendance;
  progress: Progress;
  note?: string | null;
};

type Capabilities = {
  canPatchRegister: boolean;
  hasRegisterActorAudit: boolean;
  hasCallAckWorkflow: boolean;
  hasLearnerPhotos: boolean;
  canManageGroups: boolean;
};

type BootstrapResponse = {
  success?: boolean;
  error?: string;
  schoolLocalDate?: string;
  weekday?: Weekday;
  groups?: Group[];
  learners?: Learner[];
  registers?: RegisterRow[];
  capabilities?: Capabilities;
};

const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

async function teacherCollectionsFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; data: T }> {
  const token = getStaffToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data: T = {} as T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    data = {} as T;
  }
  return { status: res.status, data };
}

function hueForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 17) % 360;
  return h;
}

function initials(first: string, last: string): string {
  return `${(first[0] || "").toUpperCase()}${(last[0] || "").toUpperCase()}` || "?";
}

/** Shift an ISO date (YYYY-MM-DD) by weekday delta within the same Mon–Fri week. */
export function isoDateForWeekday(baseIso: string, target: Weekday): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseIso);
  if (!m) return null;
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(utc.getTime())) return null;
  const map: Array<Weekday | null> = [null, "Mon", "Tue", "Wed", "Thu", "Fri", null];
  const current = map[utc.getUTCDay()];
  if (!current) return null;
  const delta = WEEKDAYS.indexOf(target) - WEEKDAYS.indexOf(current);
  utc.setUTCDate(utc.getUTCDate() + delta);
  const y = utc.getUTCFullYear();
  const mo = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function nextProgressForGroup(
  kind: GroupKind,
  progress: Progress
): Progress | null {
  if (kind === "TRANSPORT") {
    if (progress === "WAITING" || progress === "CALLED") return "READY";
    if (progress === "READY") return "COLLECTED";
    return null;
  }
  if (progress === "WAITING" || progress === "CALLED" || progress === "READY") {
    return "PARTICIPATING";
  }
  if (progress === "PARTICIPATING" || progress === "HANDED_OVER" || progress === "AWAY") {
    return "RETURNED";
  }
  return null;
}

export function progressActionLabel(kind: GroupKind, progress: Progress): string | null {
  const next = nextProgressForGroup(kind, progress);
  if (!next) return null;
  if (next === "READY") return "Mark ready";
  if (next === "COLLECTED") return "Mark collected";
  if (next === "PARTICIPATING") return "Mark participating";
  if (next === "RETURNED") return "Mark returned";
  return `Mark ${next.toLowerCase()}`;
}

export default function TeacherHomeSafeCollections() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [schoolLocalDate, setSchoolLocalDate] = useState("");
  const [weekday, setWeekday] = useState<Weekday | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [registers, setRegisters] = useState<RegisterRow[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [patchingKey, setPatchingKey] = useState<string | null>(null);

  const learnerById = useMemo(() => {
    const map = new Map<string, Learner>();
    for (const l of learners) map.set(l.id, l);
    return map;
  }, [learners]);

  const load = useCallback(async (date?: string, opts?: { soft?: boolean }) => {
    if (opts?.soft) setRefreshing(true);
    else setLoading(true);
    setErr(null);
    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : "";
      const { status, data } = await teacherCollectionsFetch<BootstrapResponse>(
        `/api/teacher-app/homesafe/collections/bootstrap${qs}`
      );
      if (status === 401) {
        setErr("Sign in again to view Collections.");
        return;
      }
      if (status === 400 && /weekend|weekday/i.test(String(data.error || ""))) {
        setErr(data.error || "Collections runs Monday–Friday only.");
        setGroups([]);
        setRegisters([]);
        setLearners([]);
        setWeekday(null);
        if (data.schoolLocalDate) setSchoolLocalDate(data.schoolLocalDate);
        return;
      }
      if (!data.success) {
        setErr(data.error || "Could not load Collections");
        return;
      }
      setSchoolLocalDate(data.schoolLocalDate || date || "");
      setWeekday(data.weekday || null);
      setGroups(data.groups || []);
      setLearners(data.learners || []);
      setRegisters(data.registers || []);
      setCapabilities(data.capabilities || null);
      const daySessions = (data.groups || []).flatMap((g) =>
        g.sessions.filter((s) => s.weekday === data.weekday)
      );
      setActiveSessionId((prev) => {
        if (prev && daySessions.some((s) => s.id === prev)) return prev;
        return daySessions[0]?.id || null;
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load Collections");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectWeekday = (day: Weekday) => {
    if (!schoolLocalDate) return;
    const nextDate = isoDateForWeekday(schoolLocalDate, day);
    if (!nextDate) {
      setErr("Could not resolve that weekday for the current week.");
      return;
    }
    setFlash(null);
    void load(nextDate);
  };

  const sessionsForDay = useMemo(() => {
    if (!weekday) return [] as Array<Session & { group: Group }>;
    const rows: Array<Session & { group: Group }> = [];
    for (const g of groups) {
      for (const s of g.sessions) {
        if (s.weekday === weekday) rows.push({ ...s, group: g });
      }
    }
    return rows.sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime) ||
        a.group.name.localeCompare(b.group.name)
    );
  }, [groups, weekday]);

  const active = sessionsForDay.find((s) => s.id === activeSessionId) || null;
  const sessionRows = registers
    .filter((r) => r.sessionId === activeSessionId && r.schoolLocalDate === schoolLocalDate)
    .slice()
    .sort((a, b) => {
      const la = learnerById.get(a.learnerId);
      const lb = learnerById.get(b.learnerId);
      const na = la?.displayName || a.learnerId;
      const nb = lb?.displayName || b.learnerId;
      return na.localeCompare(nb);
    });

  const patchRegister = async (
    row: RegisterRow,
    patch: { progress?: Progress; attendance?: Attendance }
  ) => {
    if (!capabilities?.canPatchRegister) return;
    const key = `${row.sessionId}:${row.learnerId}`;
    setPatchingKey(key);
    setErr(null);
    setFlash(null);
    try {
      const { status, data } = await teacherCollectionsFetch<{
        success?: boolean;
        row?: RegisterRow;
        error?: string;
        warning?: string;
      }>("/api/teacher-app/homesafe/collections/registers", {
        method: "PATCH",
        body: JSON.stringify({
          sessionId: row.sessionId,
          learnerId: row.learnerId,
          date: schoolLocalDate,
          ...patch,
        }),
      });
      if (!data.success || !data.row) {
        setErr(data.error || `Update failed (${status})`);
        return;
      }
      setRegisters((prev) =>
        prev.map((r) =>
          r.sessionId === data.row!.sessionId &&
          r.learnerId === data.row!.learnerId &&
          r.schoolLocalDate === data.row!.schoolLocalDate
            ? { ...r, ...data.row! }
            : r
        )
      );
      setFlash(
        data.warning ||
          "Status saved. Note: changes are persisted without a staff audit trail yet."
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPatchingKey(null);
    }
  };

  if (loading) {
    return <p className="teacher-muted teacher-hs-cg-loading">Loading Collections…</p>;
  }

  return (
    <div className="teacher-hs-cg">
      <p className="teacher-muted">
        School transport and activity groups for this week. Group setup stays with management.
      </p>

      <div className="teacher-hs-cg-toolbar">
        <div className="teacher-hs-cg-days" role="tablist" aria-label="Weekday">
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              role="tab"
              aria-selected={weekday === day}
              className={weekday === day ? "active" : ""}
              onClick={() => selectWeekday(day)}
              disabled={refreshing}
            >
              {day}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="teacher-touch-btn teacher-hs-cg-refresh"
          onClick={() => void load(schoolLocalDate || undefined, { soft: true })}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {schoolLocalDate && (
        <p className="teacher-muted teacher-hs-cg-date">
          {weekday || "—"} · {schoolLocalDate}
        </p>
      )}

      {flash && <p className="teacher-homesafe-success">{flash}</p>}
      {err && <p className="teacher-error">{err}</p>}

      {capabilities && !capabilities.hasCallAckWorkflow && (
        <p className="teacher-muted teacher-hs-cg-gap">
          Live Call / Ready classroom acknowledgements are not available yet (no backend workflow).
          Status below uses the existing register API.
        </p>
      )}

      {groups.length === 0 ? (
        <div className="teacher-hs-cg-empty" role="status">
          <p>No transport or activity groups yet.</p>
          <p className="teacher-muted">
            When management creates Collections groups, they will appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <section className="teacher-hs-cg-session-list" aria-label="Sessions today">
            {sessionsForDay.length === 0 ? (
              <p className="teacher-muted">No sessions scheduled for {weekday}.</p>
            ) : (
              sessionsForDay.map((s) => {
                const count = registers.filter(
                  (r) => r.sessionId === s.id && r.schoolLocalDate === schoolLocalDate
                ).length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={
                      activeSessionId === s.id
                        ? "teacher-hs-cg-session-card active"
                        : "teacher-hs-cg-session-card"
                    }
                    onClick={() => setActiveSessionId(s.id)}
                  >
                    <span className="teacher-hs-cg-session-kind">{s.group.kind}</span>
                    <span className="teacher-hs-cg-session-name">{s.group.name}</span>
                    <span className="teacher-hs-cg-session-meta">
                      {s.startTime}–{s.endTime}
                      {s.location ? ` · ${s.location}` : ""}
                      {` · ${count} learner${count === 1 ? "" : "s"}`}
                    </span>
                  </button>
                );
              })
            )}
          </section>

          {active && (
            <section className="teacher-hs-cg-detail" aria-label="Session roster">
              <header className="teacher-hs-cg-detail-head">
                <div>
                  <h2>{active.group.name}</h2>
                  <p className="teacher-muted">
                    {active.weekday} {active.startTime}–{active.endTime}
                    {active.responsibleAdult ? ` · ${active.responsibleAdult}` : ""}
                    {active.location ? ` · ${active.location}` : ""}
                  </p>
                </div>
                {active.group.kind === "TRANSPORT" && (
                  <div className="teacher-hs-cg-driver">
                    <strong>Driver / vehicle</strong>
                    <span>{active.group.driverName || "—"}</span>
                    {active.group.driverContact ? (
                      <span>{active.group.driverContact}</span>
                    ) : null}
                    {active.group.vehicleReg ? (
                      <span className="teacher-hs-cg-reg">{active.group.vehicleReg}</span>
                    ) : null}
                  </div>
                )}
              </header>

              {sessionRows.length === 0 ? (
                <p className="teacher-muted">No learners assigned to this session.</p>
              ) : (
                <ul className="teacher-hs-cg-roster">
                  {sessionRows.map((row) => {
                    const learner = learnerById.get(row.learnerId);
                    const name = learner?.displayName || "Unknown learner";
                    const className = learner?.className || "—";
                    const hue = hueForId(row.learnerId);
                    const key = `${row.sessionId}:${row.learnerId}`;
                    const busy = patchingKey === key;
                    const nextLabel = progressActionLabel(active.group.kind, row.progress);
                    const next = nextProgressForGroup(active.group.kind, row.progress);
                    return (
                      <li key={key} className="teacher-hs-cg-roster-row">
                        <div className="teacher-hs-cg-learner">
                          {learner?.photoUrl ? (
                            <img
                              className="teacher-hs-cg-avatar photo"
                              src={learner.photoUrl}
                              alt=""
                            />
                          ) : (
                            <span
                              className="teacher-hs-cg-avatar"
                              style={{ background: `hsl(${hue} 48% 38%)` }}
                              aria-hidden
                            >
                              {initials(learner?.firstName || "", learner?.lastName || "")}
                            </span>
                          )}
                          <div>
                            <div className="teacher-hs-cg-learner-name">{name}</div>
                            <div className="teacher-muted">{className}</div>
                          </div>
                        </div>
                        <div className="teacher-hs-cg-status">
                          <span className="teacher-hs-cg-chip">{row.attendance}</span>
                          <span className="teacher-hs-cg-chip progress">{row.progress}</span>
                        </div>
                        <div className="teacher-hs-cg-row-actions">
                          {capabilities?.canPatchRegister && (
                            <label className="teacher-hs-cg-attendance">
                              <span className="sr-only">Attendance</span>
                              <select
                                value={row.attendance}
                                disabled={busy}
                                onChange={(e) =>
                                  void patchRegister(row, {
                                    attendance: e.target.value as Attendance,
                                  })
                                }
                              >
                                <option value="PRESENT">Present</option>
                                <option value="ABSENT">Absent</option>
                                <option value="LATE">Late</option>
                                <option value="EXCUSED">Excused</option>
                                <option value="UNCONFIRMED">Unconfirmed</option>
                              </select>
                            </label>
                          )}
                          {capabilities?.canPatchRegister && next && nextLabel && (
                            <button
                              type="button"
                              className="teacher-touch-btn primary"
                              disabled={busy || row.attendance === "ABSENT"}
                              onClick={() => void patchRegister(row, { progress: next })}
                            >
                              {busy ? "Saving…" : nextLabel}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section className="teacher-hs-cg-week" aria-label="Week schedule">
            <h3>Week schedule</h3>
            <p className="teacher-muted">
              All Mon–Fri slots for school-created groups. Rosters differ by session.
            </p>
            <div className="teacher-hs-cg-week-grid">
              {WEEKDAYS.map((day) => {
                const daySessions = groups.flatMap((g) =>
                  g.sessions
                    .filter((s) => s.weekday === day)
                    .map((s) => ({ ...s, group: g }))
                );
                return (
                  <div key={day} className="teacher-hs-cg-week-col">
                    <h4>{day}</h4>
                    {daySessions.length === 0 ? (
                      <p className="teacher-muted">—</p>
                    ) : (
                      daySessions
                        .sort((a, b) => a.startTime.localeCompare(b.startTime))
                        .map((s) => (
                          <div key={s.id} className="teacher-hs-cg-week-slot">
                            <strong>{s.group.name}</strong>
                            <span>
                              {s.startTime}–{s.endTime} · {s.learnerIds.length} learner
                              {s.learnerIds.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
