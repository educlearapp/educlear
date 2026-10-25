import { useCallback, useEffect, useMemo, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";

type Classroom = { id: string; name: string };

type NoticeRow = {
  id: string;
  title: string;
  noticeType?: string;
  publishedAt?: string;
  className?: string | null;
  isDraft?: boolean;
  visibility?: string;
};

type MeResponse = {
  user?: { role?: string | null; email?: string | null; fullName?: string | null };
  school?: { id?: string };
  assignedClassrooms?: Classroom[];
  assignedClassNames?: string[];
};

type Props = {
  schoolId: string;
};

function canPublishSchoolWide(role: string, isOwner: boolean): boolean {
  const r = String(role || "").trim();
  return isOwner || r === "SCHOOL_ADMIN" || r === "Owner" || r === "Admin";
}

export default function AnnouncementsPanel({ schoolId }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [className, setClassName] = useState("");
  const [noticeType, setNoticeType] = useState("CLASS");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [adminTitle, setAdminTitle] = useState("");
  const [adminBody, setAdminBody] = useState("");
  const [adminGrade, setAdminGrade] = useState("");
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const role = me?.user?.role ?? localStorage.getItem("userRole") ?? "";
  const isOwner = localStorage.getItem("isOwner") === "true";
  const schoolWideAllowed = canPublishSchoolWide(role, isOwner);
  const hasAssignedClasses = classrooms.length > 0;

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
      setClassName((prev) => prev || rooms[0]?.name || "");

      try {
        const n = (await staffApiFetch("/api/teacher-app/notices")) as { notices?: NoticeRow[] };
        setNotices(Array.isArray(n.notices) ? n.notices : []);
      } catch {
        setNotices([]);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load announcement permissions");
      setMe(null);
      setClassrooms([]);
      setNotices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const permissionBlurb = useMemo(() => {
    if (schoolWideAllowed && hasAssignedClasses) {
      return "School admins can publish school-wide announcements. Class notices use your assigned classrooms (teacher permissions).";
    }
    if (schoolWideAllowed) {
      return "School-wide announcements use admin permissions. Assign classrooms to also publish class-scoped notices.";
    }
    if (hasAssignedClasses) {
      return "You can publish class-scoped notices for your assigned classrooms. School-wide publish requires school admin.";
    }
    return "No assigned classrooms and no school-admin role — announcement publish is locked. You can still read messages in the Messages tab when authorised.";
  }, [schoolWideAllowed, hasAssignedClasses]);

  async function submitClassNotice(e: React.FormEvent) {
    e.preventDefault();
    if (!hasAssignedClasses) return;
    setErr(null);
    setOk(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("className", className);
      form.append("noticeType", noticeType);
      form.append("title", title.trim());
      form.append("body", body.trim());
      if (dueDate) form.append("dueDate", dueDate);
      if (files) Array.from(files).forEach((f) => form.append("files", f));
      await staffFormPost("/api/teacher-app/notices", form);
      setOk("Class notice published. Authorised parents were notified (in-app).");
      setTitle("");
      setBody("");
      setDueDate("");
      setFiles(null);
      const n = (await staffApiFetch("/api/teacher-app/notices")) as { notices?: NoticeRow[] };
      setNotices(Array.isArray(n.notices) ? n.notices : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSchoolWide(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolWideAllowed) return;
    setErr(null);
    setOk(null);
    setAdminSubmitting(true);
    try {
      await staffApiFetch("/api/parent-portal/staff/notices", {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          title: adminTitle.trim(),
          body: adminBody.trim(),
          noticeType: "SCHOOL",
          grade: adminGrade.trim() || null,
          createdBy: me?.user?.email || localStorage.getItem("userEmail") || "admin",
        }),
      });
      setOk("School announcement published. Matching parents received one alert each (deduped for multi-child families).");
      setAdminTitle("");
      setAdminBody("");
      setAdminGrade("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "School-wide publish failed");
    } finally {
      setAdminSubmitting(false);
    }
  }

  return (
    <div>
      <p className="communications-centre-hub__panel-note">{permissionBlurb}</p>
      {loading ? <p className="communications-centre-hub__panel-note">Loading permissions…</p> : null}
      {err ? <p className="communications-centre-hub__status is-error">{err}</p> : null}
      {ok ? <p className="communications-centre-hub__status is-ok">{ok}</p> : null}

      <div className="communications-centre-hub__announce-grid">
        <div className="communications-centre-hub__card">
          <h3>Class announcement</h3>
          <p className="lead">
            Uses teacher-app notice APIs. Publish is blocked by the backend unless the class is assigned to you.
            Drafts and private teacher visibility never reach parents.
          </p>
          {!hasAssignedClasses ? (
            <div className="communications-centre-hub__locked">
              No assigned classrooms on this staff account. Class publish is unavailable.
            </div>
          ) : (
            <form onSubmit={submitClassNotice}>
              <div className="communications-centre-hub__field">
                <label>Type</label>
                <select value={noticeType} onChange={(e) => setNoticeType(e.target.value)}>
                  <option value="CLASS">Class notice</option>
                  <option value="SCHOOL">School notice (still class-scoped)</option>
                  <option value="ASSESSMENT">Assessment</option>
                  <option value="EXAM">Exam</option>
                </select>
              </div>
              <div className="communications-centre-hub__field">
                <label>Class</label>
                <select value={className} onChange={(e) => setClassName(e.target.value)} required>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="communications-centre-hub__field">
                <label>Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="communications-centre-hub__field">
                <label>Details</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
              </div>
              <div className="communications-centre-hub__field">
                <label>Due / event date (optional)</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="communications-centre-hub__field">
                <label>Attachments (optional)</label>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  onChange={(e) => setFiles(e.target.files)}
                />
              </div>
              <div className="communications-centre-hub__actions">
                <button
                  type="submit"
                  className="communications-centre-hub__btn"
                  disabled={submitting || !className || !title.trim()}
                >
                  {submitting ? "Publishing…" : "Publish class notice"}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="communications-centre-hub__card">
          <h3>School-wide announcement</h3>
          <p className="lead">
            Admin-only. Optional grade target; leave blank for whole school. Backend rejects non-admin staff.
          </p>
          {!schoolWideAllowed ? (
            <div className="communications-centre-hub__locked">
              School-wide publish requires Owner / Admin / SCHOOL_ADMIN. Teachers use class announcements instead.
            </div>
          ) : (
            <form onSubmit={submitSchoolWide}>
              <div className="communications-centre-hub__field">
                <label>Title</label>
                <input value={adminTitle} onChange={(e) => setAdminTitle(e.target.value)} required />
              </div>
              <div className="communications-centre-hub__field">
                <label>Message</label>
                <textarea value={adminBody} onChange={(e) => setAdminBody(e.target.value)} rows={4} required />
              </div>
              <div className="communications-centre-hub__field">
                <label>Grade (optional)</label>
                <input
                  value={adminGrade}
                  onChange={(e) => setAdminGrade(e.target.value)}
                  placeholder="e.g. 3 — blank = all grades"
                />
              </div>
              <div className="communications-centre-hub__actions">
                <button
                  type="submit"
                  className="communications-centre-hub__btn"
                  disabled={adminSubmitting || !adminTitle.trim() || !adminBody.trim()}
                >
                  {adminSubmitting ? "Publishing…" : "Publish school announcement"}
                </button>
              </div>
            </form>
          )}

          <h3 style={{ marginTop: 18 }}>Recent class notices</h3>
          <p className="lead">From your teacher-app visibility scope (assigned classes / admin view).</p>
          {notices.length === 0 ? (
            <p className="lead">No recent notices in scope.</p>
          ) : (
            <ul className="communications-centre-hub__list">
              {notices.slice(0, 40).map((n) => (
                <li key={n.id}>
                  <strong>{n.title}</strong>
                  <span>
                    {n.noticeType || "NOTICE"}
                    {n.className ? ` · ${n.className}` : ""}
                    {n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleString()}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
