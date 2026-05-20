import { useEffect, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";

type Classroom = { id: string; name: string };

export default function TeacherDocumentsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [className, setClassName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const me = (await staffApiFetch("/api/teacher-app/me")) as { classrooms?: Classroom[] };
    setClassrooms(me.classrooms || []);
    const d = (await staffApiFetch("/api/teacher-app/documents")) as { documents?: unknown[] };
    setDocs(d.documents || []);
  }

  useEffect(() => {
    void load().catch((e: unknown) => setErr(e instanceof Error ? e.message : "Load failed"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Choose a file to upload.");
      return;
    }
    setErr(null);
    setOk(null);
    setLoading(true);
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
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Documents</h1>
      <p className="teacher-muted">Upload class documents. Linked parents receive a document notification.</p>
      {err && <p className="teacher-error">{err}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      <form onSubmit={submit}>
        <div className="teacher-field">
          <label>Class</label>
          <select value={className} onChange={(e) => setClassName(e.target.value)} required>
            <option value="">Select class</option>
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
        <button type="submit" className="teacher-touch-btn primary" disabled={loading}>
          Upload
        </button>
      </form>
      <h2 style={{ marginTop: 32, fontSize: "1.1rem" }}>Uploaded</h2>
      <ul className="teacher-muted" style={{ paddingLeft: 18 }}>
        {(docs as { id: string; title: string; fileUrl: string; createdAt: string }[]).map((d) => (
          <li key={d.id} style={{ marginBottom: 8 }}>
            <a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--t-gold)" }}>
              {d.title}
            </a>{" "}
            · {new Date(d.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
