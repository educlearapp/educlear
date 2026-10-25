import { useCallback, useEffect, useMemo, useState } from "react";
import { staffApiFetch } from "../staffApi";

type Classroom = { id: string; name: string };
type Lifecycle = "DRAFT" | "PUBLISHED" | "CANCELLED" | "ARCHIVED";
type FilterLifecycle = "ALL" | Lifecycle;

type EventRow = {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  grade?: string | null;
  className?: string | null;
  learnerId?: string | null;
  lifecycleStatus?: Lifecycle;
  cancellationReason?: string | null;
};

type MeResponse = {
  user?: { role?: string | null; email?: string | null; appRole?: string | null };
  assignedClassrooms?: Classroom[];
  assignedClassNames?: string[];
};

type Props = { schoolId: string };

function canManageSchoolWide(role: string, appRole: string, isOwner: boolean): boolean {
  const r = String(role || "").trim();
  const a = String(appRole || "").trim();
  return isOwner || r === "SCHOOL_ADMIN" || a === "Owner" || a === "Admin" || r === "Owner" || r === "Admin";
}

function targetingLabel(e: EventRow): string {
  if (e.className) return `Class · ${e.className}`;
  if (e.grade) return `Grade · ${e.grade}`;
  if (e.learnerId) return "Learner-specific";
  return "School-wide";
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}

const EMPTY = {
  title: "",
  description: "",
  startsAt: "",
  endsAt: "",
  location: "",
  grade: "",
  className: "",
  publishNow: false,
};

export default function EventsPanel({ schoolId }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [items, setItems] = useState<EventRow[]>([]);
  const [lifecycleFilter, setLifecycleFilter] = useState<FilterLifecycle>("ALL");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [audit, setAudit] = useState<Array<{ id: string; action: string; createdAt: string; actorEmail?: string }>>(
    []
  );
  const [confirm, setConfirm] = useState<{
    id: string;
    action: "publish" | "cancel" | "archive";
    title: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const role = me?.user?.role ?? localStorage.getItem("userRole") ?? "";
  const appRole = me?.user?.appRole ?? localStorage.getItem("appRole") ?? "";
  const isOwner = localStorage.getItem("isOwner") === "true";
  const schoolWideAllowed = canManageSchoolWide(role, appRole, isOwner);
  const hasAssignedClasses = classrooms.length > 0;
  const canManage = schoolWideAllowed || hasAssignedClasses;

  const loadList = useCallback(async () => {
    if (!schoolId) return;
    const params = new URLSearchParams({ schoolId, lifecycle: lifecycleFilter, limit: "60" });
    if (qApplied) params.set("q", qApplied);
    const res = (await staffApiFetch(`/api/school-events?${params}`)) as {
      items?: EventRow[];
    };
    setItems(Array.isArray(res.items) ? res.items : []);
  }, [schoolId, lifecycleFilter, qApplied]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const profile = (await staffApiFetch("/api/teacher-app/me")) as MeResponse;
      setMe(profile);
      const rooms =
        Array.isArray(profile.assignedClassrooms) && profile.assignedClassrooms.length
          ? profile.assignedClassrooms
          : (profile.assignedClassNames || []).map((name, i) => ({ id: `name-${i}`, name }));
      setClassrooms(rooms);
      await loadList();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load events");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [loadList]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) {
      void loadList().catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : "Failed to refresh events");
      });
    }
  }, [lifecycleFilter, qApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  const blurb = useMemo(() => {
    if (schoolWideAllowed) {
      return "Admins can manage school-wide and grade events. Class events use assigned classrooms. Cancelled events stay visible to parents with a cancelled status — no re-publish in this phase.";
    }
    if (hasAssignedClasses) {
      return "You can manage events for your assigned classes only. Drafts and archived events never reach parents.";
    }
    return "Event management requires school admin or assigned classrooms.";
  }, [schoolWideAllowed, hasAssignedClasses]);

  function resetForm() {
    setEditingId(null);
    setAudit([]);
    setForm({
      ...EMPTY,
      className: classrooms[0]?.name || "",
    });
  }

  async function startEdit(e: EventRow) {
    setEditingId(e.id);
    setForm({
      title: e.title || "",
      description: e.description || "",
      startsAt: toLocalInputValue(e.startsAt),
      endsAt: toLocalInputValue(e.endsAt),
      location: e.location || "",
      grade: e.grade || "",
      className: e.className || "",
      publishNow: false,
    });
    setOk(null);
    setErr(null);
    try {
      const detail = (await staffApiFetch(
        `/api/school-events/${encodeURIComponent(e.id)}?schoolId=${encodeURIComponent(schoolId)}`
      )) as { audit?: typeof audit };
      setAudit(Array.isArray(detail.audit) ? detail.audit : []);
    } catch {
      setAudit([]);
    }
  }

  async function submitForm(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload = {
        schoolId,
        title: form.title.trim(),
        description: form.description.trim(),
        startsAt: fromLocalInputValue(form.startsAt),
        endsAt: fromLocalInputValue(form.endsAt),
        location: form.location.trim() || null,
        grade: form.grade.trim() || null,
        className: form.className.trim() || null,
        learnerId: null,
        publishNow: form.publishNow,
      };
      if (editingId) {
        await staffApiFetch(`/api/school-events/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setOk("Event updated. Ordinary edits do not re-notify parents.");
      } else {
        await staffApiFetch("/api/school-events", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setOk(
          form.publishNow
            ? "Event published. Authorised parents notified in-app (deduped)."
            : "Draft saved. Parents cannot see drafts."
        );
      }
      resetForm();
      await loadList();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runTransition(id: string, action: "publish" | "cancel" | "archive") {
    setBusy(true);
    setErr(null);
    setOk(null);
    setConfirm(null);
    try {
      await staffApiFetch(`/api/school-events/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          cancellationReason: action === "cancel" ? cancelReason.trim() || null : undefined,
        }),
      });
      setCancelReason("");
      setOk(
        action === "publish"
          ? "Published. Parents notified in-app."
          : action === "cancel"
            ? "Cancelled. Parents will see cancelled status — no new alert."
            : "Archived. Hidden from parents."
      );
      await loadList();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="communications-centre-hub__announce">
      <p className="communications-centre-hub__panel-note">{blurb}</p>
      {loading ? <p className="communications-centre-hub__panel-note">Loading events…</p> : null}
      {err ? <p className="communications-centre-hub__status is-error">{err}</p> : null}
      {ok ? <p className="communications-centre-hub__status is-ok">{ok}</p> : null}

      {!canManage ? (
        <div className="communications-centre-hub__locked">
          Event management is locked for this account. Messages and announcements remain available when authorised.
        </div>
      ) : (
        <div className="communications-centre-hub__announce-grid">
          <div className="communications-centre-hub__card">
            <h3>{editingId ? "Edit event" : "Create event"}</h3>
            <p className="lead">Times are stored in UTC from your local input. startsAt must be ≤ endsAt.</p>
            <form onSubmit={submitForm}>
              <div className="communications-centre-hub__field">
                <label>Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>
              <div className="communications-centre-hub__field">
                <label>Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={4}
                />
              </div>
              <div className="communications-centre-hub__field">
                <label>Starts</label>
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                  required
                />
              </div>
              <div className="communications-centre-hub__field">
                <label>Ends</label>
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                  required
                />
              </div>
              <div className="communications-centre-hub__field">
                <label>Location (optional)</label>
                <input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              {schoolWideAllowed ? (
                <div className="communications-centre-hub__field">
                  <label>Grade (optional — blank unless grade-scoped)</label>
                  <input
                    value={form.grade}
                    onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                    placeholder="e.g. 3"
                  />
                </div>
              ) : null}
              <div className="communications-centre-hub__field">
                <label>
                  {schoolWideAllowed
                    ? "Class (optional — blank = school-wide / grade)"
                    : "Class (required)"}
                </label>
                <select
                  value={form.className}
                  onChange={(e) => setForm((f) => ({ ...f, className: e.target.value }))}
                  required={!schoolWideAllowed}
                >
                  {schoolWideAllowed ? <option value="">— School-wide / grade —</option> : null}
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {!editingId ? (
                <div className="communications-centre-hub__field communications-centre-hub__field--check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.publishNow}
                      onChange={(e) => setForm((f) => ({ ...f, publishNow: e.target.checked }))}
                    />{" "}
                    Publish immediately
                  </label>
                </div>
              ) : null}
              <div className="communications-centre-hub__actions">
                <button type="submit" className="communications-centre-hub__btn" disabled={busy || !form.title.trim()}>
                  {busy ? "Saving…" : editingId ? "Save changes" : form.publishNow ? "Create & publish" : "Save draft"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                    onClick={resetForm}
                    disabled={busy}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
            {editingId && audit.length ? (
              <>
                <h3 style={{ marginTop: 16 }}>Audit</h3>
                <ul className="communications-centre-hub__list">
                  {audit.slice(0, 12).map((a) => (
                    <li key={a.id}>
                      <strong>{a.action}</strong>
                      <span>
                        {a.actorEmail || "—"} · {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="communications-centre-hub__card">
            <h3>Event library</h3>
            <div className="communications-centre-hub__toolbar">
              <div className="communications-centre-hub__field">
                <label>Status</label>
                <select
                  value={lifecycleFilter}
                  onChange={(e) => setLifecycleFilter(e.target.value as FilterLifecycle)}
                >
                  <option value="ALL">All</option>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div className="communications-centre-hub__field communications-centre-hub__field--grow">
                <label>Search</label>
                <div className="communications-centre-hub__search-row">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Title, description, location"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setQApplied(q.trim());
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                    onClick={() => setQApplied(q.trim())}
                  >
                    Search
                  </button>
                </div>
              </div>
            </div>
            {items.length === 0 ? (
              <p className="lead">No events in this filter.</p>
            ) : (
              <ul className="communications-centre-hub__list">
                {items.map((n) => {
                  const st = n.lifecycleStatus || "DRAFT";
                  return (
                    <li key={n.id} className="communications-centre-hub__announce-item">
                      <div className="communications-centre-hub__announce-item-head">
                        <strong>{n.title}</strong>
                        <span className={`communications-centre-hub__pill is-${st.toLowerCase()}`}>{st}</span>
                      </div>
                      <span>
                        {new Date(n.startsAt).toLocaleString()} → {new Date(n.endsAt).toLocaleString()}
                        {n.location ? ` · ${n.location}` : ""} · {targetingLabel(n)}
                      </span>
                      <div className="communications-centre-hub__actions">
                        {st === "DRAFT" || st === "PUBLISHED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                            disabled={busy}
                            onClick={() => void startEdit(n)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {st === "DRAFT" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn"
                            disabled={busy}
                            onClick={() => setConfirm({ id: n.id, action: "publish", title: n.title })}
                          >
                            Publish
                          </button>
                        ) : null}
                        {st === "PUBLISHED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                            disabled={busy}
                            onClick={() => setConfirm({ id: n.id, action: "cancel", title: n.title })}
                          >
                            Cancel event
                          </button>
                        ) : null}
                        {st !== "ARCHIVED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn communications-centre-hub__btn--danger"
                            disabled={busy}
                            onClick={() => setConfirm({ id: n.id, action: "archive", title: n.title })}
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {confirm ? (
        <div className="communications-centre-hub__modal" role="dialog" aria-modal="true">
          <div className="communications-centre-hub__modal-card">
            <h3>Confirm {confirm.action}</h3>
            <p className="lead">
              {confirm.action === "cancel"
                ? `Cancel “${confirm.title}”? Parents will see it as cancelled. No new alert is sent.`
                : confirm.action === "archive"
                  ? `Archive “${confirm.title}”? It will be hidden from parents.`
                  : `Publish “${confirm.title}”? Authorised parents will be notified in-app.`}
            </p>
            {confirm.action === "cancel" ? (
              <div className="communications-centre-hub__field">
                <label>Cancellation reason (optional)</label>
                <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </div>
            ) : null}
            <div className="communications-centre-hub__actions">
              <button
                type="button"
                className="communications-centre-hub__btn"
                disabled={busy}
                onClick={() => void runTransition(confirm.id, confirm.action)}
              >
                Confirm
              </button>
              <button
                type="button"
                className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
