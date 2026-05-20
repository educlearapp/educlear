import { useEffect, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";

export default function TeacherDocumentsPage() {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadDocs() {
    try {
      const d = (await staffApiFetch("/api/teacher-app/documents")) as { documents?: unknown[] };
      setDocs(d.documents || []);
    } catch (e: unknown) {
      console.error("[teacher-app] Failed to load documents:", e instanceof Error ? e.message : e);
    }
  }

  useEffect(() => {
    void loadDocs();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Choose a file to upload.");
      return;
    }
    setErr(null);
    setOk(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("className", className);
      form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      form.append("file", file);
      await staffFormPost("/api/teacher-app/documents", form);
      setOk("Document uploaded. Parents see it in the Parent Portal with a notification.");
      setTitle("");
      setDescription("");
      setFile(null);
      void loadDocs();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">Documents</h1>
      <p className="teacher-muted">Upload class documents. Linked parents receive a document notification.</p>
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
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="teacher-field">
            <label>Description (optional)</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="teacher-field">
            <label>File</label>
            <input type="file" accept="application/pdf,image/*,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="teacher-form-actions">
            <button type="submit" className="teacher-touch-btn primary" disabled={submitting || !className}>
              Upload
            </button>
          </div>
        </form>
      )}
      <h2 className="teacher-section-title">Uploaded</h2>
      <ul className="teacher-record-list">
        {(docs as { id: string; title: string; fileUrl: string; createdAt: string }[]).map((d) => (
          <li key={d.id} className="teacher-record-card">
            <a href={d.fileUrl} target="_blank" rel="noreferrer">
              {d.title}
            </a>
            {new Date(d.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
