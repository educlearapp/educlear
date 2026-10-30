import { useCallback, useEffect, useMemo, useState } from "react";
import { staffApiFetch } from "../staffApi";

type Classroom = { id: string; name: string; grade?: string | null };

type Lifecycle = "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

type AudienceMode = "all_parents" | "by_class" | "individual";
type ClassScope = "grade" | "all_in_grade" | "classroom";

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
  audienceParentIds?: string[] | null;
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

type ParentOption = {
  id: string;
  name: string;
  idNumber?: string | null;
  cellNo?: string | null;
  learnerLabels?: string[];
};

type PreviewResponse = {
  success?: boolean;
  audience?: string;
  uniqueParentCount?: number;
  learnerCount?: number;
  recipients?: { parentId: string; parentName: string; learnerLabels: string[] }[];
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
  if (n.isDraft) return "DRAFT";
  if (n.lifecycleStatus) return n.lifecycleStatus;
  return "PUBLISHED";
}

function targetingLabel(n: NoticeRow): string {
  if (Array.isArray(n.audienceParentIds) && n.audienceParentIds.length) {
    return `Individual · ${n.audienceParentIds.length} parent(s)`;
  }
  if (n.className) return `Class · ${n.className}`;
  if (n.grade) return `Grade · ${n.grade}`;
  if (n.learnerId) return "Learner-specific";
  return "All Parents";
}

const EMPTY_FORM = {
  title: "",
  body: "",
  noticeType: "SCHOOL",
  audienceMode: "by_class" as AudienceMode,
  classScope: "classroom" as ClassScope,
  grade: "",
  className: "",
  parentIds: [] as string[],
  publishNow: false,
};

export default function AnnouncementsPanel({ schoolId }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);
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
  const [parentQuery, setParentQuery] = useState("");
  const [parentHits, setParentHits] = useState<ParentOption[]>([]);
  const [selectedParents, setSelectedParents] = useState<ParentOption[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
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

      // Admins: load school classroom directory for grade/class pickers when available.
      if (canPublishSchoolWide(profile.user?.role || "", profile.user?.appRole || "", localStorage.getItem("isOwner") === "true")) {
        try {
          const dir = (await staffApiFetch(
            `/api/classrooms?schoolId=${encodeURIComponent(schoolId)}`
          )) as { classrooms?: Classroom[]; items?: Classroom[] } | Classroom[];
          const list = Array.isArray(dir)
            ? dir
            : dir.classrooms || dir.items || [];
          if (list.length) {
            setClassrooms(list);
            const grades = [
              ...new Set(list.map((c) => String(c.grade || "").trim()).filter(Boolean)),
            ].sort();
            setGradeOptions(grades);
          }
        } catch {
          // Keep assigned classrooms fallback.
        }
      }

      await loadList();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load announcements");
      setMe(null);
      setClassrooms([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [loadList, schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editingId) {
      setForm((f) => ({
        ...f,
        className: f.className || classrooms[0]?.name || "",
        audienceMode: schoolWideAllowed ? f.audienceMode : "by_class",
        classScope: schoolWideAllowed ? f.classScope : "classroom",
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
    if (schoolWideAllowed) {
      return "Admin: All Parents, grade, class and individual parents. Preview recipients before publishing. No SMS or email.";
    }
    if (hasAssignedClasses) {
      return "Teachers: class-scoped or individual parents linked to assigned classrooms only. Drafts stay staff-only until published.";
    }
    return "No assigned classrooms and no school-admin role — announcement management is locked.";
  }, [schoolWideAllowed, hasAssignedClasses]);

  function resetForm() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      className: classrooms[0]?.name || "",
      audienceMode: schoolWideAllowed ? "all_parents" : "by_class",
      classScope: "classroom",
    });
    setSelectedParents([]);
    setParentHits([]);
    setParentQuery("");
    setPreview(null);
    setConfirmPublish(false);
  }

  function startEdit(n: NoticeRow) {
    setEditingId(n.id);
    const individual = Array.isArray(n.audienceParentIds) && n.audienceParentIds.length > 0;
    setForm({
      title: n.title || "",
      body: n.body || "",
      noticeType: n.noticeType || "SCHOOL",
      audienceMode: individual ? "individual" : n.className || n.grade ? "by_class" : "all_parents",
      classScope: n.className ? "classroom" : "grade",
      grade: n.grade || "",
      className: n.className || "",
      parentIds: individual ? [...n.audienceParentIds!] : [],
      publishNow: false,
    });
    setSelectedParents(
      individual
        ? n.audienceParentIds!.map((id) => ({ id, name: id }))
        : []
    );
    setPreview(null);
    setOk(null);
    setErr(null);
  }

  function targetingPayload() {
    if (form.audienceMode === "all_parents") {
      return { audienceMode: "all_parents" as const };
    }
    if (form.audienceMode === "individual") {
      return {
        audienceMode: "individual" as const,
        parentIds: selectedParents.map((p) => p.id),
      };
    }
    return {
      audienceMode: "by_class" as const,
      classScope: form.classScope,
      grade: form.classScope === "classroom" ? null : form.grade.trim() || null,
      className: form.classScope === "classroom" ? form.className.trim() || null : null,
    };
  }

  async function runPreview() {
    setErr(null);
    setOk(null);
    setBusy(true);
    setConfirmPublish(false);
    try {
      const res = (await staffApiFetch("/api/school-announcements/preview", {
        method: "POST",
        body: JSON.stringify({ schoolId, ...targetingPayload() }),
      })) as PreviewResponse;
      setPreview(res);
      setOk(`Preview ready: ${res.uniqueParentCount ?? 0} unique parents.`);
    } catch (e: unknown) {
      setPreview(null);
      setErr(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function searchParents(query: string) {
    setParentQuery(query);
    if (!schoolId) return;
    try {
      const params = new URLSearchParams({ schoolId, q: query });
      const res = (await staffApiFetch(
        `/api/school-announcements/parents/search?${params.toString()}`
      )) as { parents?: ParentOption[] };
      setParentHits(Array.isArray(res.parents) ? res.parents : []);
    } catch {
      setParentHits([]);
    }
  }

  function toggleParent(p: ParentOption) {
    setSelectedParents((prev) => {
      const exists = prev.some((x) => x.id === p.id);
      const next = exists ? prev.filter((x) => x.id !== p.id) : [...prev, p];
      setForm((f) => ({ ...f, parentIds: next.map((x) => x.id) }));
      setPreview(null);
      return next;
    });
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    if (form.publishNow && !confirmPublish) {
      setErr("Preview recipients and confirm before publishing.");
      return;
    }
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const payload = {
        schoolId,
        title: form.title.trim(),
        body: form.body.trim(),
        noticeType: form.noticeType,
        publishNow: form.publishNow,
        ...targetingPayload(),
      };
      if (editingId) {
        await staffApiFetch(`/api/school-announcements/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            schoolId,
            title: payload.title,
            body: payload.body,
            noticeType: payload.noticeType,
            ...targetingPayload(),
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
            ? `Published to ${preview?.uniqueParentCount ?? "authorised"} parent(s). In-app notify + push enqueue used existing pipelines.`
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
              Delivers to Parent Portal <strong>Notices</strong> (and Alerts / push via existing pipelines). Does not
              create teacher chat threads. No SMS or email.
            </p>
            <form onSubmit={submitForm}>
              <div className="communications-centre-hub__field">
                <label>Recipients</label>
                <select
                  value={form.audienceMode}
                  onChange={(e) => {
                    const audienceMode = e.target.value as AudienceMode;
                    setForm((f) => ({
                      ...f,
                      audienceMode,
                      classScope: audienceMode === "by_class" ? f.classScope || "classroom" : f.classScope,
                    }));
                    setPreview(null);
                    setConfirmPublish(false);
                  }}
                >
                  {schoolWideAllowed ? <option value="all_parents">All Parents</option> : null}
                  <option value="by_class">By Class</option>
                  <option value="individual">Individual Parents</option>
                </select>
              </div>

              {form.audienceMode === "by_class" ? (
                <>
                  <div className="communications-centre-hub__field">
                    <label>Class scope</label>
                    <select
                      value={form.classScope}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, classScope: e.target.value as ClassScope }));
                        setPreview(null);
                        setConfirmPublish(false);
                      }}
                    >
                      <option value="classroom">One classroom</option>
                      {schoolWideAllowed ? <option value="grade">Entire grade</option> : null}
                      {schoolWideAllowed ? (
                        <option value="all_in_grade">All classrooms in a grade</option>
                      ) : null}
                    </select>
                  </div>
                  {form.classScope === "classroom" ? (
                    <div className="communications-centre-hub__field">
                      <label>Classroom</label>
                      <select
                        value={form.className}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, className: e.target.value }));
                          setPreview(null);
                          setConfirmPublish(false);
                        }}
                        required
                      >
                        <option value="">Select classroom</option>
                        {classrooms.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="communications-centre-hub__field">
                      <label>Grade</label>
                      {gradeOptions.length ? (
                        <select
                          value={form.grade}
                          onChange={(e) => {
                            setForm((f) => ({ ...f, grade: e.target.value }));
                            setPreview(null);
                            setConfirmPublish(false);
                          }}
                          required
                        >
                          <option value="">Select grade</option>
                          {gradeOptions.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={form.grade}
                          onChange={(e) => {
                            setForm((f) => ({ ...f, grade: e.target.value }));
                            setPreview(null);
                            setConfirmPublish(false);
                          }}
                          required
                          placeholder="e.g. 1 or Grade 1"
                        />
                      )}
                    </div>
                  )}
                </>
              ) : null}

              {form.audienceMode === "individual" ? (
                <div className="communications-centre-hub__field">
                  <label>Search parents</label>
                  <input
                    value={parentQuery}
                    onChange={(e) => void searchParents(e.target.value)}
                    placeholder="Name, ID number or cell"
                  />
                  {parentHits.length ? (
                    <ul className="communications-centre-hub__list" style={{ maxHeight: 160, overflow: "auto" }}>
                      {parentHits.map((p) => {
                        const on = selectedParents.some((s) => s.id === p.id);
                        return (
                          <li key={p.id}>
                            <label className="communications-centre-hub__field--check">
                              <input type="checkbox" checked={on} onChange={() => toggleParent(p)} />{" "}
                              {p.name}
                              {p.learnerLabels?.length ? ` — ${p.learnerLabels.join(", ")}` : ""}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {selectedParents.length ? (
                    <p className="lead">
                      Selected: {selectedParents.map((p) => p.name).join(", ")}
                    </p>
                  ) : (
                    <p className="lead">Select one or more parents.</p>
                  )}
                </div>
              ) : null}

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

              <div className="communications-centre-hub__actions">
                <button
                  type="button"
                  className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                  disabled={busy}
                  onClick={() => void runPreview()}
                >
                  Preview recipients
                </button>
              </div>

              {preview ? (
                <div className="communications-centre-hub__card" style={{ marginTop: 12 }}>
                  <h3>Recipient preview</h3>
                  <p className="lead">
                    {preview.audience}
                    <br />
                    Unique parents: <strong>{preview.uniqueParentCount ?? 0}</strong>
                    <br />
                    Learners represented: <strong>{preview.learnerCount ?? 0}</strong>
                  </p>
                  <ul className="communications-centre-hub__list" style={{ maxHeight: 180, overflow: "auto" }}>
                    {(preview.recipients || []).map((r) => (
                      <li key={r.parentId}>
                        {r.parentName}
                        {r.learnerLabels?.length ? ` — ${r.learnerLabels.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!editingId ? (
                <div className="communications-centre-hub__field communications-centre-hub__field--check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.publishNow}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, publishNow: e.target.checked }));
                        setConfirmPublish(false);
                      }}
                    />{" "}
                    Publish immediately (otherwise save as draft)
                  </label>
                </div>
              ) : null}

              {form.publishNow && !editingId ? (
                <div className="communications-centre-hub__field communications-centre-hub__field--check">
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmPublish}
                      disabled={!preview}
                      onChange={(e) => setConfirmPublish(e.target.checked)}
                    />{" "}
                    I confirm publishing to{" "}
                    <strong>{preview?.uniqueParentCount ?? "—"}</strong> unique parent(s)
                    {preview?.audience ? ` (${preview.audience})` : ""}. Preview required first.
                  </label>
                </div>
              ) : null}

              <div className="communications-centre-hub__actions">
                <button
                  type="submit"
                  className="communications-centre-hub__btn"
                  disabled={
                    busy ||
                    !form.title.trim() ||
                    (form.publishNow && !editingId && (!preview || !confirmPublish))
                  }
                >
                  {busy
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : form.publishNow
                        ? "Create & publish"
                        : "Save draft"}
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
            <p className="lead">Filter by lifecycle. Parents only ever see PUBLISHED items that match their audience.</p>
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
