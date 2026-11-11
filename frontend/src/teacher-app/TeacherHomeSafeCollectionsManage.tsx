import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import { getStaffToken } from "../staffApi";

type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
type GroupKind = "TRANSPORT" | "ACTIVITY";

type Session = {
  id: string;
  groupId: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  responsibleAdult: string;
  location?: string | null;
  learnerIds?: string[];
  learnerCount?: number;
  updatedAt?: string;
};

type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  driverName?: string | null;
  driverContact?: string | null;
  vehicleReg?: string | null;
  sessions: Session[];
  sessionCount?: number;
  learnerCount?: number;
  updatedAt?: string;
};

type DirectoryLearner = {
  id: string;
  firstName: string;
  lastName: string;
  className: string;
};

type DeletionImpact = {
  groupId: string;
  name: string;
  sessionCount: number;
  membershipCount: number;
  registerRowCount: number;
  canDelete: boolean;
  blockReason: string | null;
};

const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

async function api<T>(
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

function displayName(l: DirectoryLearner): string {
  return `${l.firstName} ${l.lastName}`.trim();
}

type Props = {
  onChanged?: () => void;
};

export default function TeacherHomeSafeCollectionsManage({ onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [kindFilter, setKindFilter] = useState<"ALL" | GroupKind>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [directory, setDirectory] = useState<DirectoryLearner[]>([]);
  const [learnerSearch, setLearnerSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [rosterSessionId, setRosterSessionId] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<GroupKind>("ACTIVITY");
  const [draftDriver, setDraftDriver] = useState("");
  const [draftContact, setDraftContact] = useState("");
  const [draftReg, setDraftReg] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [deletionImpact, setDeletionImpact] = useState<DeletionImpact | null>(null);

  const [sessionDays, setSessionDays] = useState<Weekday[]>(["Tue"]);
  const [sessionStart, setSessionStart] = useState("14:00");
  const [sessionEnd, setSessionEnd] = useState("14:30");
  const [sessionAdult, setSessionAdult] = useState("");
  const [sessionLocation, setSessionLocation] = useState("");
  const [rosterSelected, setRosterSelected] = useState<Set<string>>(new Set());

  const selected = groups.find((g) => g.id === selectedId) || null;

  const filteredGroups = useMemo(
    () => groups.filter((g) => (kindFilter === "ALL" ? true : g.kind === kindFilter)),
    [groups, kindFilter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [gRes, lRes] = await Promise.all([
        api<{ success?: boolean; groups?: Group[]; error?: string }>(
          "/api/teacher-app/homesafe/collections/groups"
        ),
        api<{ success?: boolean; learners?: DirectoryLearner[]; error?: string }>(
          "/api/teacher-app/homesafe/collections/learners"
        ),
      ]);
      if (!gRes.data.success) {
        setErr(gRes.data.error || `Could not load groups (${gRes.status})`);
        return;
      }
      const nextGroups = gRes.data.groups || [];
      setGroups(nextGroups);
      setDirectory(lRes.data.learners || []);
      setSelectedId((prev) => {
        if (prev && nextGroups.some((g) => g.id === prev)) return prev;
        return nextGroups[0]?.id || null;
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notify = (msg: string) => {
    setFlash(msg);
    onChanged?.();
  };

  const openCreate = () => {
    setDraftName("");
    setDraftKind("ACTIVITY");
    setDraftDriver("");
    setDraftContact("");
    setDraftReg("");
    setCreateOpen(true);
    setErr(null);
    setFlash(null);
  };

  const openEdit = () => {
    if (!selected) return;
    setDraftName(selected.name);
    setDraftDriver(selected.driverName || "");
    setDraftContact(selected.driverContact || "");
    setDraftReg(selected.vehicleReg || "");
    setEditOpen(true);
    setErr(null);
    setFlash(null);
  };

  const openDelete = async () => {
    if (!selected) return;
    setConfirmName("");
    setDeletionImpact(null);
    setDeleteOpen(true);
    setErr(null);
    setFlash(null);
    const { data } = await api<{ success?: boolean; impact?: DeletionImpact; error?: string }>(
      `/api/teacher-app/homesafe/collections/groups/${selected.id}/deletion-impact`
    );
    if (data.success && data.impact) setDeletionImpact(data.impact);
    else setErr(data.error || "Could not load deletion impact");
  };

  const createGroup = async () => {
    const name = draftName.trim();
    if (!name) {
      setErr("Group name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await api<{ success?: boolean; group?: Group; error?: string }>(
        "/api/teacher-app/homesafe/collections/groups",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            kind: draftKind,
            driverName: draftDriver.trim() || undefined,
            driverContact: draftContact.trim() || undefined,
            vehicleReg: draftReg.trim() || undefined,
          }),
        }
      );
      if (!data.success || !data.group) {
        setErr(data.error || `Create failed (${status})`);
        return;
      }
      setCreateOpen(false);
      notify(`Created “${data.group.name}”.`);
      await load();
      setSelectedId(data.group.id);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!selected) return;
    const name = draftName.trim();
    if (!name) {
      setErr("Group name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await api<{ success?: boolean; group?: Group; error?: string }>(
        `/api/teacher-app/homesafe/collections/groups/${selected.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name,
            driverName: draftDriver.trim() || undefined,
            driverContact: draftContact.trim() || undefined,
            vehicleReg: draftReg.trim() || undefined,
            expectedUpdatedAt: selected.updatedAt,
          }),
        }
      );
      if (!data.success || !data.group) {
        setErr(data.error || `Update failed (${status})`);
        return;
      }
      setEditOpen(false);
      notify(`Updated “${data.group.name}”.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await api<{ success?: boolean; error?: string }>(
        `/api/teacher-app/homesafe/collections/groups/${selected.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            confirmName,
            expectedUpdatedAt: selected.updatedAt,
          }),
        }
      );
      if (!data.success) {
        setErr(data.error || `Delete failed (${status})`);
        return;
      }
      setDeleteOpen(false);
      notify(`Deleted “${selected.name}”.`);
      setSelectedId(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addSessions = async () => {
    if (!selected) return;
    if (!sessionDays.length) {
      setErr("Select at least one weekday.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await api<{
        success?: boolean;
        session?: Session;
        sessions?: Session[];
        error?: string;
      }>(`/api/teacher-app/homesafe/collections/groups/${selected.id}/sessions`, {
        method: "POST",
        body: JSON.stringify({
          weekdays: sessionDays,
          startTime: sessionStart,
          endTime: sessionEnd,
          responsibleAdult:
            selected.kind === "TRANSPORT"
              ? sessionAdult.trim() || selected.driverName || "Driver"
              : sessionAdult.trim(),
          location: sessionLocation.trim() || undefined,
        }),
      });
      if (!data.success) {
        setErr(data.error || `Add session failed (${status})`);
        return;
      }
      setSessionOpen(false);
      notify(`Added ${sessionDays.length} session slot(s) to “${selected.name}”.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeSession = async (session: Session) => {
    if (
      !window.confirm(
        `Remove ${session.weekday} ${session.startTime}–${session.endTime}? ` +
          `This is blocked if register history exists for this slot.`
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await api<{ success?: boolean; error?: string }>(
        `/api/teacher-app/homesafe/collections/sessions/${session.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedUpdatedAt: session.updatedAt }),
        }
      );
      if (!data.success) {
        setErr(data.error || `Remove session failed (${status})`);
        return;
      }
      notify(`Removed ${session.weekday} ${session.startTime}–${session.endTime}.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openRoster = (session: Session) => {
    const ids = new Set(session.learnerIds || []);
    setRosterSelected(ids);
    setRosterSessionId(session.id);
    setLearnerSearch("");
    setErr(null);
    setFlash(null);
    void (async () => {
      const { data } = await api<{ success?: boolean; learnerIds?: string[] }>(
        `/api/teacher-app/homesafe/collections/sessions/${session.id}/learners`
      );
      if (data.success && Array.isArray(data.learnerIds)) {
        setRosterSelected(new Set(data.learnerIds));
      }
    })();
  };

  const saveRoster = async () => {
    if (!rosterSessionId) return;
    setBusy(true);
    setErr(null);
    try {
      const { status, data } = await api<{ success?: boolean; error?: string }>(
        `/api/teacher-app/homesafe/collections/sessions/${rosterSessionId}/learners`,
        {
          method: "PUT",
          body: JSON.stringify({ learnerIds: Array.from(rosterSelected) }),
        }
      );
      if (!data.success) {
        setErr(data.error || `Save learners failed (${status})`);
        return;
      }
      setRosterSessionId(null);
      notify("Session learners saved.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const searchable = useMemo(() => {
    const q = learnerSearch.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter((l) => {
      const hay = `${l.firstName} ${l.lastName} ${l.className}`.toLowerCase();
      return hay.includes(q);
    });
  }, [directory, learnerSearch]);

  if (loading) {
    return <p className="teacher-muted teacher-hs-cg-loading">Loading group management…</p>;
  }

  return (
    <div className="teacher-hs-cg-manage">
      <div className="teacher-hs-cg-manage-toolbar">
        <div className="teacher-hs-cg-filters" role="group" aria-label="Group type filter">
          {(["ALL", "TRANSPORT", "ACTIVITY"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={kindFilter === k ? "active" : ""}
              onClick={() => setKindFilter(k)}
            >
              {k === "ALL" ? "All" : k === "TRANSPORT" ? "Transport" : "Activity"}
            </button>
          ))}
        </div>
        <button type="button" className="teacher-touch-btn primary" onClick={openCreate}>
          Create Group
        </button>
      </div>

      {flash && <p className="teacher-homesafe-success">{flash}</p>}
      {err && <p className="teacher-error">{err}</p>}

      {filteredGroups.length === 0 ? (
        <div className="teacher-hs-cg-empty" role="status">
          <p>No groups yet.</p>
          <p className="teacher-muted">Create a Transport or Activity group to get started.</p>
        </div>
      ) : (
        <div className="teacher-hs-cg-manage-layout">
          <section className="teacher-hs-cg-group-list" aria-label="Groups">
            {filteredGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                className={
                  selectedId === g.id
                    ? "teacher-hs-cg-group-card active"
                    : "teacher-hs-cg-group-card"
                }
                onClick={() => setSelectedId(g.id)}
              >
                <span className="teacher-hs-cg-session-kind">{g.kind}</span>
                <span className="teacher-hs-cg-session-name">{g.name}</span>
                <span className="teacher-hs-cg-session-meta">
                  {(g.sessionCount ?? g.sessions?.length ?? 0)} session
                  {(g.sessionCount ?? g.sessions?.length ?? 0) === 1 ? "" : "s"}
                  {typeof g.learnerCount === "number" ? ` · ${g.learnerCount} learners` : ""}
                </span>
              </button>
            ))}
          </section>

          {selected && (
            <section className="teacher-hs-cg-detail" aria-label="Selected group">
              <header className="teacher-hs-cg-detail-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="teacher-muted">
                    {selected.kind === "TRANSPORT" ? "Transport" : "Activity"}
                    {selected.kind === "TRANSPORT"
                      ? ` · ${selected.driverName || "—"} · ${selected.vehicleReg || "—"}`
                      : ""}
                  </p>
                </div>
                <div className="teacher-hs-cg-manage-actions">
                  <button type="button" className="teacher-touch-btn" onClick={openEdit}>
                    Edit Group
                  </button>
                  <button
                    type="button"
                    className="teacher-touch-btn"
                    onClick={() => {
                      setSessionDays(["Tue"]);
                      setSessionStart("14:00");
                      setSessionEnd("14:30");
                      setSessionAdult(
                        selected.kind === "TRANSPORT" ? selected.driverName || "" : ""
                      );
                      setSessionLocation(selected.kind === "TRANSPORT" ? "Front gate" : "");
                      setSessionOpen(true);
                      setErr(null);
                      setFlash(null);
                    }}
                  >
                    Add Sessions
                  </button>
                  <button type="button" className="teacher-touch-btn danger" onClick={() => void openDelete()}>
                    Delete Group
                  </button>
                </div>
              </header>

              <h3 className="teacher-hs-cg-subhead">Sessions</h3>
              <p className="teacher-muted">
                Each weekday/time has its own learner roster. Changing one session never changes
                another.
              </p>
              {(selected.sessions || []).length === 0 ? (
                <p className="teacher-muted">No sessions yet. Add Mon–Fri slots above.</p>
              ) : (
                <ul className="teacher-hs-cg-session-manage-list">
                  {(selected.sessions || [])
                    .slice()
                    .sort(
                      (a, b) =>
                        WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) ||
                        a.startTime.localeCompare(b.startTime)
                    )
                    .map((s) => (
                      <li key={s.id} className="teacher-hs-cg-session-manage-row">
                        <div>
                          <strong>
                            {s.weekday} {s.startTime}–{s.endTime}
                          </strong>
                          <div className="teacher-muted">
                            {s.responsibleAdult}
                            {s.location ? ` · ${s.location}` : ""}
                            {` · ${(s.learnerIds || []).length || s.learnerCount || 0} learners`}
                          </div>
                        </div>
                        <div className="teacher-hs-cg-row-actions">
                          <button
                            type="button"
                            className="teacher-touch-btn"
                            onClick={() => openRoster(s)}
                          >
                            Manage Learners
                          </button>
                          <button
                            type="button"
                            className="teacher-touch-btn danger"
                            disabled={busy}
                            onClick={() => void removeSession(s)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {createOpen && (
        <div className="teacher-hs-cg-modal" role="dialog" aria-modal="true" aria-label="Create group">
          <div className="teacher-hs-cg-modal-card">
            <h3>Create Group</h3>
            <label>
              Type
              <select
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value as GroupKind)}
              >
                <option value="ACTIVITY">Activity</option>
                <option value="TRANSPORT">Transport</option>
              </select>
            </label>
            <label>
              Group name
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </label>
            {draftKind === "TRANSPORT" && (
              <>
                <label>
                  Driver
                  <input value={draftDriver} onChange={(e) => setDraftDriver(e.target.value)} />
                </label>
                <label>
                  Driver contact
                  <input value={draftContact} onChange={(e) => setDraftContact(e.target.value)} />
                </label>
                <label>
                  Vehicle registration
                  <input value={draftReg} onChange={(e) => setDraftReg(e.target.value)} />
                </label>
              </>
            )}
            <div className="teacher-hs-cg-modal-actions">
              <button type="button" className="teacher-touch-btn" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="teacher-touch-btn primary"
                disabled={busy}
                onClick={() => void createGroup()}
              >
                {busy ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && selected && (
        <div className="teacher-hs-cg-modal" role="dialog" aria-modal="true" aria-label="Edit group">
          <div className="teacher-hs-cg-modal-card">
            <h3>Edit Group</h3>
            <label>
              Group name
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </label>
            {selected.kind === "TRANSPORT" && (
              <>
                <label>
                  Driver
                  <input value={draftDriver} onChange={(e) => setDraftDriver(e.target.value)} />
                </label>
                <label>
                  Driver contact
                  <input value={draftContact} onChange={(e) => setDraftContact(e.target.value)} />
                </label>
                <label>
                  Vehicle registration
                  <input value={draftReg} onChange={(e) => setDraftReg(e.target.value)} />
                </label>
              </>
            )}
            <div className="teacher-hs-cg-modal-actions">
              <button type="button" className="teacher-touch-btn" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="teacher-touch-btn primary"
                disabled={busy}
                onClick={() => void saveEdit()}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && selected && (
        <div className="teacher-hs-cg-modal" role="dialog" aria-modal="true" aria-label="Delete group">
          <div className="teacher-hs-cg-modal-card">
            <h3>Delete Group</h3>
            <p>
              You are about to delete <strong>{selected.name}</strong>.
            </p>
            {deletionImpact && (
              <ul className="teacher-hs-cg-impact">
                <li>{deletionImpact.sessionCount} session(s)</li>
                <li>{deletionImpact.membershipCount} membership(s)</li>
                <li>{deletionImpact.registerRowCount} register history row(s)</li>
              </ul>
            )}
            {deletionImpact && !deletionImpact.canDelete && (
              <p className="teacher-error">{deletionImpact.blockReason}</p>
            )}
            {deletionImpact?.canDelete && (
              <label>
                Type the group name to confirm
                <input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={selected.name}
                />
              </label>
            )}
            <div className="teacher-hs-cg-modal-actions">
              <button type="button" className="teacher-touch-btn" onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="teacher-touch-btn danger"
                disabled={
                  busy ||
                  !deletionImpact?.canDelete ||
                  confirmName.trim() !== selected.name
                }
                onClick={() => void confirmDelete()}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionOpen && selected && (
        <div className="teacher-hs-cg-modal" role="dialog" aria-modal="true" aria-label="Add sessions">
          <div className="teacher-hs-cg-modal-card">
            <h3>Add Sessions · {selected.name}</h3>
            <p className="teacher-muted">Select one or more weekdays. Same times create independent slots.</p>
            <div className="teacher-hs-cg-days" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((d) => {
                const on = sessionDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={on ? "active" : ""}
                    onClick={() =>
                      setSessionDays((prev) =>
                        on ? prev.filter((x) => x !== d) : [...prev, d]
                      )
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <label>
              Start
              <input value={sessionStart} onChange={(e) => setSessionStart(e.target.value)} />
            </label>
            <label>
              End
              <input value={sessionEnd} onChange={(e) => setSessionEnd(e.target.value)} />
            </label>
            <label>
              Responsible adult
              <input value={sessionAdult} onChange={(e) => setSessionAdult(e.target.value)} />
            </label>
            <label>
              Location
              <input value={sessionLocation} onChange={(e) => setSessionLocation(e.target.value)} />
            </label>
            <div className="teacher-hs-cg-modal-actions">
              <button type="button" className="teacher-touch-btn" onClick={() => setSessionOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="teacher-touch-btn primary"
                disabled={busy}
                onClick={() => void addSessions()}
              >
                {busy ? "Saving…" : "Add sessions"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rosterSessionId && (
        <div className="teacher-hs-cg-modal" role="dialog" aria-modal="true" aria-label="Manage learners">
          <div className="teacher-hs-cg-modal-card wide">
            <h3>Manage Learners</h3>
            <p className="teacher-muted">
              School learners only. This updates one session roster; other sessions stay unchanged.
            </p>
            <label>
              Search
              <input
                value={learnerSearch}
                onChange={(e) => setLearnerSearch(e.target.value)}
                placeholder="Name or class"
              />
            </label>
            <ul className="teacher-hs-cg-learner-picker">
              {searchable.map((l) => {
                const checked = rosterSelected.has(l.id);
                return (
                  <li key={l.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setRosterSelected((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(l.id);
                            else next.add(l.id);
                            return next;
                          });
                        }}
                      />
                      <span>
                        <strong>{displayName(l)}</strong>
                        <span className="teacher-muted"> · {l.className}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="teacher-hs-cg-modal-actions">
              <button
                type="button"
                className="teacher-touch-btn"
                onClick={() => setRosterSessionId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="teacher-touch-btn primary"
                disabled={busy}
                onClick={() => void saveRoster()}
              >
                {busy ? "Saving…" : `Save ${rosterSelected.size} learner(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
