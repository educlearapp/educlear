import { useCallback, useEffect, useMemo, useState } from "react";
import { staffApiFetch } from "../staffApi";

type Classroom = { id: string; name: string };

type Lifecycle = "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

type NoticeRow = {
  id: string;
  title: string;
  body?: string;
  noticeType?: string;
  publishedAt?: string;
  updatedAt?: string;
  className?: string | null;
  grade?: string | null;
  learnerId?: string | null;
  isDraft?: boolean;
  visibility?: string;
  lifecycleStatus?: Lifecycle;
};

type MeResponse = {
  user?: { role?: string | null; email?: string | null; fullName?: string | null; appRole?: string | null };
  school?: { id?: string };
  assignedClassrooms?: Classroom[];
  assignedClassNames?: string[];
};

type ListResponse = {
  success?: boolean;
  items?: NoticeRow[];
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
};

type Props = {
  schoolId: string;
};

type FilterLifecycle = "ALL" | Lifecycle;

function canPublishSchoolWide(role: string, appRole: string, isOwner: boolean): boolean {
  const r = String(role || "").trim();
  const a = String(appRole || "").trim();
  return isOwner || r === "SCHOOL_ADMIN" || a === "Owner" || a === "Admin" || r === "Owner" || r === "Admin";
}

function statusLabel(n: NoticeRow): Lifecycle {
  // Legacy safety: isDraft=true must never render as PUBLISHED even if lifecycleStatus is stale.
  if (n.isDraft) return "DRAFT";
  if (n.lifecycleStatus) return n.lifecycleStatus;
  return "PUBLISHED";
}

function targetingLabel(n: NoticeRow): string {
  if (n.className) return `Class · ${n.className}`;
  if (n.grade) return `Grade · ${n.grade}`;
  if (n.learnerId) return "Learner-specific";
  return "School-wide";
}

const EMPTY_FORM = {
  title: "",
  body: "",
  noticeType: "SCHOOL",
  grade: "",
  className: "",
  publishNow: false,
};

export default function AnnouncementsPanel({ schoolId }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [items, setItems] = useState<NoticeRow[]>([]);
  const [lifecycleFilter, setLifecycleFilter] = useState<FilterLifecycle>("ALL");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    action: "publish" | "unpublish" | "republish" | "archive";
    title: string;
  } | null>(null);

  const role = me?.user?.role ?? localStorage.getItem("userRole") ?? "";
  const appRole = me?.user?.appRole ?? localStorage.getItem("appRole") ?? "";
  const isOwner = localStorage.getItem("isOwner") === "true";
  const schoolWideAllowed = canPublishSchoolWide(role, appRole, isOwner);
  const hasAssignedClasses = classrooms.length > 0;
  const canManage = schoolWideAllowed || hasAssignedClasses;

  const loadList = useCallback(async () => {
    if (!schoolId) return;
    const params = new URLSearchParams({
      schoolId,
      lifecycle: lifecycleFilter,
      limit: "60",
    });
    if (qApplied) params.set("q", qApplied);
    const res = (await staffApiFetch(`/api/school-announcements?${params.toString()}`)) as ListResponse;
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
      setErr(e instanceof Error ? e.message : "Failed to load announcements");
      setMe(null);
      setClassrooms([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [loadList]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editingId) {
      setForm((f) => ({
        ...f,
        className: f.className || classrooms[0]?.name || "",
        noticeType: f.noticeType || (schoolWideAllowed ? "SCHOOL" : "CLASS"),
      }));
    }
  }, [classrooms, schoolWideAllowed, editingId]);

  useEffect(() => {
    if (!loading) {
      void loadList().catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : "Failed to refresh list");
      });
    }
  }, [lifecycleFilter, qApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  const permissionBlurb = useMemo(() => {
    if (schoolWideAllowed && hasAssignedClasses) {
      return "You can manage school-wide, grade and class announcements. Teachers without admin rights only see their assigned classes.";
    }
    if (schoolWideAllowed) {
      return "School-admin: manage school-wide and grade announcements. Assign classrooms to also manage class-scoped notices.";
    }
    if (hasAssignedClasses) {
      return "Class-scoped management only for your assigned classrooms. Drafts, unpublished and archived never reach parents.";
    }
    return "No assigned classrooms and no school-admin role — announcement management is locked.";
  }, [schoolWideAllowed, hasAssignedClasses]);

  function resetForm() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      className: classrooms[0]?.name || "",
      noticeType: schoolWideAllowed ? "SCHOOL" : "CLASS",
    });
  }

  function startEdit(n: NoticeRow) {
    setEditingId(n.id);
    setForm({
      title: n.title || "",
      body: n.body || "",
      noticeType: n.noticeType || "SCHOOL",
      grade: n.grade || "",
      className: n.className || "",
      publishNow: false,
    });
    setOk(null);
    setErr(null);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const payload = {
        schoolId,
        title: form.title.trim(),
        body: form.body.trim(),
        noticeType: form.noticeType,
        grade: form.grade.trim() || null,
        className: form.className.trim() || null,
        learnerId: null,
        publishNow: form.publishNow,
      };
      if (editingId) {
        await staffApiFetch(`/api/school-announcements/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            schoolId,
            title: payload.title,
            body: payload.body,
            noticeType: payload.noticeType,
            grade: payload.grade,
            className: payload.className,
            learnerId: null,
          }),
        });
        setOk("Announcement updated. Ordinary edits do not re-notify parents.");
      } else {
        await staffApiFetch("/api/school-announcements", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setOk(
          form.publishNow
            ? "Announcement published. Authorised parents notified in-app (deduped)."
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

  async function runTransition(
    id: string,
    action: "publish" | "unpublish" | "republish" | "archive"
  ) {
    setErr(null);
    setOk(null);
    setBusy(true);
    setConfirmAction(null);
    try {
      await staffApiFetch(`/api/school-announcements/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ schoolId }),
      });
      const labels: Record<typeof action, string> = {
        publish: "Published. Parents notified in-app when first published from draft.",
        unpublish: "Unpublished. Hidden from parents.",
        republish: "Republished. Deduped in-app notify attempted for restored content.",
        archive: "Archived. Hidden from parents and locked from edit.",
      };
      setOk(labels[action]);
      await loadList();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="communications-centre-hub__announce">
      <p className="communications-centre-hub__panel-note">{permissionBlurb}</p>
      {loading ? <p className="communications-centre-hub__panel-note">Loading announcements…</p> : null}
      {err ? <p className="communications-centre-hub__status is-error">{err}</p> : null}
      {ok ? <p className="communications-centre-hub__status is-ok">{ok}</p> : null}

      {!canManage ? (
        <div className="communications-centre-hub__locked">
          Announcement management requires school admin or assigned classrooms. Messages remain available in the
          Messages tab when authorised.
        </div>
      ) : (
        <div className="communications-centre-hub__announce-grid">
          <div className="communications-centre-hub__card">
            <h3>{editingId ? "Edit announcement" : "Create announcement"}</h3>
            <p className="lead">
              Drafts stay staff-only. Publishing notifies authorised parents in-app once (Phase 0 dedupe). No SMS or
              email from this panel.
            </p>
            <form onSubmit={submitForm}>
              <div className="communications-centre-hub__field">
                <label>Type</label>
                <select
                  value={form.noticeType}
                  onChange={(e) => setForm((f) => ({ ...f, noticeType: e.target.value }))}
                >
                  <option value="SCHOOL">School</option>
                  <option value="GRADE">Grade</option>
                  <option value="CLASS">Class</option>
                  <option value="ASSESSMENT">Assessment</option>
                  <option value="EXAM">Exam</option>
                </select>
              </div>
              {schoolWideAllowed ? (
                <div className="communications-centre-hub__field">
                  <label>Grade (optional — blank = not grade-scoped)</label>
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
                    : "Class (required for teachers)"}
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
                {!schoolWideAllowed && !hasAssignedClasses ? (
                  <span className="lead">No assigned classes available.</span>
                ) : null}
              </div>
              <div className="communications-centre-hub__field">
                <label>Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>
              <div className="communications-centre-hub__field">
                <label>Body</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  rows={5}
                />
              </div>
              {!editingId ? (
                <div className="communications-centre-hub__field communications-centre-hub__field--check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.publishNow}
                      onChange={(e) => setForm((f) => ({ ...f, publishNow: e.target.checked }))}
                    />{" "}
                    Publish immediately (otherwise save as draft)
                  </label>
                </div>
              ) : null}
              <div className="communications-centre-hub__actions">
                <button
                  type="submit"
                  className="communications-centre-hub__btn"
                  disabled={busy || !form.title.trim()}
                >
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
          </div>

          <div className="communications-centre-hub__card">
            <h3>Announcement library</h3>
            <p className="lead">Filter by lifecycle. Parents only ever see PUBLISHED items that match their learners.</p>
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
                  <option value="UNPUBLISHED">Unpublished</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div className="communications-centre-hub__field communications-centre-hub__field--grow">
                <label>Search</label>
                <div className="communications-centre-hub__search-row">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Title or body"
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
              <p className="lead">No announcements in this filter.</p>
            ) : (
              <ul className="communications-centre-hub__list">
                {items.map((n) => {
                  const st = statusLabel(n);
                  return (
                    <li key={n.id} className="communications-centre-hub__announce-item">
                      <div className="communications-centre-hub__announce-item-head">
                        <strong>{n.title}</strong>
                        <span className={`communications-centre-hub__pill is-${st.toLowerCase()}`}>{st}</span>
                      </div>
                      <span>
                        {n.noticeType || "NOTICE"} · {targetingLabel(n)}
                        {n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleString()}` : ""}
                      </span>
                      <div className="communications-centre-hub__actions">
                        {st !== "ARCHIVED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                            disabled={busy}
                            onClick={() => startEdit(n)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {st === "DRAFT" || st === "UNPUBLISHED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn"
                            disabled={busy}
                            onClick={() =>
                              setConfirmAction({
                                id: n.id,
                                action: st === "UNPUBLISHED" ? "republish" : "publish",
                                title: n.title,
                              })
                            }
                          >
                            {st === "UNPUBLISHED" ? "Republish" : "Publish"}
                          </button>
                        ) : null}
                        {st === "PUBLISHED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                            disabled={busy}
                            onClick={() =>
                              setConfirmAction({ id: n.id, action: "unpublish", title: n.title })
                            }
                          >
                            Unpublish
                          </button>
                        ) : null}
                        {st !== "ARCHIVED" ? (
                          <button
                            type="button"
                            className="communications-centre-hub__btn communications-centre-hub__btn--danger"
                            disabled={busy}
                            onClick={() =>
                              setConfirmAction({ id: n.id, action: "archive", title: n.title })
                            }
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

      {confirmAction ? (
        <div className="communications-centre-hub__modal" role="dialog" aria-modal="true">
          <div className="communications-centre-hub__modal-card">
            <h3>Confirm {confirmAction.action}</h3>
            <p className="lead">
              {confirmAction.action === "archive"
                ? `Archive “${confirmAction.title}”? It will be hidden from parents and cannot be edited.`
                : confirmAction.action === "unpublish"
                  ? `Unpublish “${confirmAction.title}”? Parents will no longer see it.`
                  : confirmAction.action === "republish"
                    ? `Republish “${confirmAction.title}”? It becomes visible to authorised parents again.`
                    : `Publish “${confirmAction.title}”? Authorised parents will be notified in-app.`}
            </p>
            <div className="communications-centre-hub__actions">
              <button
                type="button"
                className="communications-centre-hub__btn"
                disabled={busy}
                onClick={() => void runTransition(confirmAction.id, confirmAction.action)}
              >
                Confirm
              </button>
              <button
                type="button"
                className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                disabled={busy}
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
