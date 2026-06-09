import { useEffect, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";
import {
  NO_ASSIGNED_CLASSROOMS_MSG,
  useTeacherAssignedClassrooms,
} from "./useTeacherAssignedClassrooms";
import { formatTeacherUploadError } from "./teacherUploadErrors";

type Props = { defaultNoticeType?: "CLASS" | "ASSESSMENT" | "EXAM" };

export default function TeacherNoticesPage({ defaultNoticeType = "CLASS" }: Props) {
  const { classrooms, className, setClassName, loading, err: loadErr, noAssigned } =
    useTeacherAssignedClassrooms();
  const [noticeType, setNoticeType] = useState<string>(defaultNoticeType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [notices, setNotices] = useState<unknown[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setNoticeType(defaultNoticeType);
  }, [defaultNoticeType]);

  async function loadNotices() {
    try {
      const n = (await staffApiFetch("/api/teacher-app/notices")) as { notices?: unknown[] };
      setNotices(n.notices || []);
    } catch (e: unknown) {
      console.error("[teacher-app] Failed to load notices:", e instanceof Error ? e.message : e);
    }
  }

  useEffect(() => {
    void loadNotices();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      setOk("Notice published. Parents were notified through the Communication Engine.");
      setTitle("");
      setBody("");
      setDueDate("");
      setFiles(null);
      void loadNotices();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setErr(formatTeacherUploadError(msg));
    } finally {
      setSubmitting(false);
    }
  }

  const heading =
    defaultNoticeType === "ASSESSMENT" ? "Assessments / exams" : defaultNoticeType === "EXAM" ? "Exams" : "Notices";

  const displayErr = loadErr || err;

  return (
    <div>
      <h1 className="teacher-page-heading">{heading}</h1>
      <p className="teacher-muted">
        Class notices, assessment alerts, and exam reminders. PDFs can be attached; due dates are included in the
        message body for parents.
      </p>
      {displayErr && <p className="teacher-error">{displayErr}</p>}
      {noAssigned && <p className="teacher-pwa-hint">{NO_ASSIGNED_CLASSROOMS_MSG}</p>}
      {ok && <p style={{ color: "var(--t-gold)" }}>{ok}</p>}
      {!noAssigned && (
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
          <div className="teacher-form-actions">
            <button type="submit" className="teacher-touch-btn primary" disabled={submitting || !className}>
              Publish notice
            </button>
          </div>
        </form>
      )}
      <h2 className="teacher-section-title">Recent</h2>
      <ul className="teacher-record-list">
        {(notices as { id: string; title: string; noticeType: string; publishedAt: string }[]).map((n) => (
          <li key={n.id} className="teacher-record-card">
            <strong>{n.title}</strong>
            {n.noticeType} · {new Date(n.publishedAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
