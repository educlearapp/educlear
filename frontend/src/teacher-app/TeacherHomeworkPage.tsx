import { useEffect, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";

type Classroom = { id: string; name: string; learnerCount: number };

export default function TeacherHomeworkPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [className, setClassName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [posts, setPosts] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const me = (await staffApiFetch("/api/teacher-app/me")) as { classrooms?: Classroom[] };
      setClassrooms(me.classrooms || []);
      const hw = (await staffApiFetch("/api/teacher-app/homework")) as { posts?: unknown[] };
      setPosts(hw.posts || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setLoading(true);
    try {
      const form = new FormData();
      form.append("className", className);
      form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      if (dueDate) form.append("dueDate", new Date(dueDate).toISOString());
      if (files) Array.from(files).forEach((f) => form.append("files", f));
      await staffFormPost("/api/teacher-app/homework", form);
      setOk("Homework posted. Parents were notified through the Communication Engine.");
      setTitle("");
      setDescription("");
      setDueDate("");
      setFiles(null);
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Homework</h1>
      <p className="teacher-muted">Create homework for an assigned class. Parents receive in-app notifications.</p>
      {err && <p className="teacher-error">{err}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      <form onSubmit={submit}>
        <div className="teacher-field">
          <label>Class</label>
          <select value={className} onChange={(e) => setClassName(e.target.value)} required>
            <option value="">Select class</option>
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
        <div className="teacher-field">
          <label>Attachments (PDF / images)</label>
          <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => setFiles(e.target.files)} />
        </div>
        <button type="submit" className="teacher-touch-btn primary" disabled={loading}>
          Publish homework
        </button>
      </form>
      <h2 style={{ marginTop: 32, fontSize: "1.1rem" }}>Recent (your classes)</h2>
      <ul className="teacher-muted" style={{ paddingLeft: 18 }}>
        {(posts as { id: string; title: string; className?: string | null; createdAt: string }[]).map((p) => (
          <li key={p.id} style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--t-text)" }}>{p.title}</strong> · {p.className || "—"} ·{" "}
            {new Date(p.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
