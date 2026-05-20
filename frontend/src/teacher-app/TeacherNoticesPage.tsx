import { useEffect, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";

type Classroom = { id: string; name: string; learnerCount: number };

type Props = { defaultNoticeType?: "CLASS" | "ASSESSMENT" | "EXAM" };

export default function TeacherNoticesPage({ defaultNoticeType = "CLASS" }: Props) {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [className, setClassName] = useState("");
  const [noticeType, setNoticeType] = useState<string>(defaultNoticeType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [notices, setNotices] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setNoticeType(defaultNoticeType);
  }, [defaultNoticeType]);

  async function load() {
    try {
      const me = (await staffApiFetch("/api/teacher-app/me")) as { classrooms?: Classroom[] };
      setClassrooms(me.classrooms || []);
      const n = (await staffApiFetch("/api/teacher-app/notices")) as { notices?: unknown[] };
      setNotices(n.notices || []);
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
      form.append("noticeType", noticeType);
      form.append("title", title.trim());
      form.append("body", body.trim());
      if (dueDate) form.append("dueDate", dueDate);
      if (files) Array.from(files).forEach((f) => form.append("files", f));
      await staffFormPost("/api/teacher-app/notices", form);
      setOk("Notice published. Parents were notified through the Communication Engine.");
      setTitle("");
      setBody("");
      setDueDate("");
      setFiles(null);
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  const heading =
    defaultNoticeType === "ASSESSMENT" ? "Assessments / exams" : defaultNoticeType === "EXAM" ? "Exams" : "Notices";

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{heading}</h1>
      <p className="teacher-muted">
        Class notices, assessment alerts, and exam reminders. PDFs can be attached; due dates are included in the
        message body for parents.
      </p>
      {err && <p className="teacher-error">{err}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      <form onSubmit={submit}>
        <div className="teacher-field">
          <label>Notice type</label>
          <select value={noticeType} onChange={(e) => setNoticeType(e.target.value)}>
            <option value="CLASS">Class notice</option>
            <option value="SCHOOL">School notice (class-scoped)</option>
            <option value="ASSESSMENT">Assessment</option>
            <option value="EXAM">Exam</option>
          </select>
        </div>
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
          <label>Details</label>
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="teacher-field">
          <label>Due date / event date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="teacher-field">
          <label>PDF attachment (optional)</label>
          <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => setFiles(e.target.files)} />
        </div>
        <button type="submit" className="teacher-touch-btn primary" disabled={loading}>
          Publish notice
        </button>
      </form>
      <h2 style={{ marginTop: 32, fontSize: "1.1rem" }}>Recent</h2>
      <ul className="teacher-muted" style={{ paddingLeft: 18 }}>
        {(notices as { id: string; title: string; noticeType: string; publishedAt: string }[]).map((n) => (
          <li key={n.id} style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--t-text)" }}>{n.title}</strong> · {n.noticeType} ·{" "}
            {new Date(n.publishedAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
