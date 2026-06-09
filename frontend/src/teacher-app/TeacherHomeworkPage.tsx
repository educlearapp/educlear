import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { staffApiFetch, staffFormPost } from "../staffApi";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";
import TeacherVisibilitySelect, {
  visibilityBadge,
  type TeacherVisibility,
} from "./TeacherVisibilitySelect";
import { formatTeacherUploadError } from "./teacherUploadErrors";

type HomeworkPost = {
  id: string;
  title: string;
  className?: string | null;
  createdAt: string;
  visibility?: string;
  createdBy?: string;
};

export default function TeacherHomeworkPage() {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [visibility, setVisibility] = useState<TeacherVisibility>("CLASS_TEACHERS");
  const [files, setFiles] = useState<FileList | null>(null);
  const [posts, setPosts] = useState<HomeworkPost[]>([]);
  const [listScope, setListScope] = useState<"all" | "mine" | "shared">("all");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const fromUrl = searchParams.get("class");
    if (fromUrl) setClassName(fromUrl);
  }, [searchParams, setClassName]);

  async function loadPosts(scope = listScope) {
    try {
      const qs = scope !== "all" ? `?scope=${scope}` : "";
      const hw = (await staffApiFetch(`/api/teacher-app/homework${qs}`)) as { posts?: HomeworkPost[] };
      setPosts(hw.posts || []);
    } catch (e: unknown) {
      console.error("[teacher-app] Failed to load homework:", e instanceof Error ? e.message : e);
    }
  }

  useEffect(() => {
    void loadPosts(listScope);
  }, [listScope]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("className", className);
      form.append("title", title.trim());
      form.append("visibility", visibility);
      if (visibility === "CLASS_TEACHERS") form.append("publish", "true");
      if (description.trim()) form.append("description", description.trim());
      if (dueDate) form.append("dueDate", new Date(dueDate).toISOString());
      if (files) Array.from(files).forEach((f) => form.append("files", f));
      await staffFormPost("/api/teacher-app/homework", form);
      setOk(
        visibility === "CLASS_TEACHERS"
          ? "Homework posted. Parents were notified through the Communication Engine."
          : "Homework saved with your chosen visibility."
      );
      setTitle("");
      setDescription("");
      setDueDate("");
      setFiles(null);
      void loadPosts(listScope);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setErr(formatTeacherUploadError(msg));
    } finally {
      setSubmitting(false);
    }
  }

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">Homework</h1>
      <p className="teacher-muted">
        Create homework for an assigned class. Choose who can see it among teachers; parents are notified
        only for shared class homework.
      </p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {noAssigned && <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      {!noAssigned && (
        <form onSubmit={submit}>
          <div className="teacher-field">
            <label>Class</label>
            <select
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
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
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="teacher-field">
            <label>Description</label>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="teacher-field">
            <label>Due date</label>
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <TeacherVisibilitySelect value={visibility} onChange={setVisibility} />
          <div className="teacher-field">
            <label>Attachments (PDF / images)</label>
            <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => setFiles(e.target.files)} />
          </div>
          <div className="teacher-form-actions">
            <button type="submit" className="teacher-touch-btn primary" disabled={submitting || !className}>
              Publish homework
            </button>
          </div>
        </form>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 24, marginBottom: 8, flexWrap: "wrap" }}>
        {(["all", "mine", "shared"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`teacher-touch-btn${listScope === s ? " primary" : ""}`}
            onClick={() => setListScope(s)}
          >
            {s === "all" ? "All visible" : s === "mine" ? "My homework" : "Shared class"}
          </button>
        ))}
      </div>
      <h2 className="teacher-section-title">Recent (your classes)</h2>
      <ul className="teacher-record-list">
        {posts.map((p) => (
          <li key={p.id} className="teacher-record-card">
            <strong>{p.title}</strong>
            {p.className || "—"} · {visibilityBadge(p.visibility)} · {new Date(p.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
