import { useCallback, useEffect, useState } from "react";
import { API_URL, authenticatedFetch } from "../api";
import { staffApiFetch, staffFormPost } from "../staffApi";

type Classroom = { id: string; name: string };

type DocRow = {
  id: string;
  title: string;
  description?: string | null;
  grade?: string | null;
  className?: string | null;
  learnerId?: string | null;
  fileName?: string;
  createdAt?: string;
  targeting?: string;
  downloadPath?: string;
};

type MeResponse = {
  user?: { role?: string | null; appRole?: string | null };
  assignedClassrooms?: Classroom[];
  assignedClassNames?: string[];
};

type ListResponse = {
  success?: boolean;
  documents?: DocRow[];
  total?: number;
  actor?: { isSchoolWideAdmin?: boolean; assignedClassNames?: string[] };
  error?: string;
};

type Props = { schoolId: string };

function canPublishSchoolWide(role: string, appRole: string, isOwner: boolean): boolean {
  const r = String(role || "").trim();
  const a = String(appRole || "").trim();
  return isOwner || r === "SCHOOL_ADMIN" || a === "Owner" || a === "Admin" || r === "Owner" || r === "Admin";
}

export default function DocumentsPanel({ schoolId }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetMode, setTargetMode] = useState<"school" | "grade" | "class">("class");
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const role = me?.user?.role ?? localStorage.getItem("userRole") ?? "";
  const appRole = me?.user?.appRole ?? localStorage.getItem("appRole") ?? "";
  const isOwner = localStorage.getItem("isOwner") === "true";
  const schoolWideAllowed = canPublishSchoolWide(role, appRole, isOwner);
  const hasAssigned = classrooms.length > 0;
  const canUpload = schoolWideAllowed || hasAssigned;

  const load = useCallback(async () => {
    if (!schoolId) return;
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

      const res = (await staffApiFetch(
        `/api/school-parent-documents?schoolId=${encodeURIComponent(schoolId)}&limit=80`
      )) as ListResponse;
      setDocs(Array.isArray(res.documents) ? res.documents : []);
      setTotal(Number(res.total) || 0);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load documents");
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!schoolWideAllowed) setTargetMode("class");
  }, [schoolWideAllowed]);

  async function downloadDoc(d: DocRow) {
    if (!d.downloadPath) return;
    try {
      const res = await authenticatedFetch(`${API_URL}${d.downloadPath}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = d.fileName || d.title || "document";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Choose a file to upload.");
      return;
    }
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("schoolId", schoolId);
      form.append("title", title.trim());
      if (description.trim()) form.append("description", description.trim());
      if (targetMode === "grade") form.append("grade", grade.trim());
      if (targetMode === "class") form.append("className", className.trim());
      form.append("file", file);
      await staffFormPost("/api/school-parent-documents", form);
      setOk("Document uploaded. Targeted parents are notified in-app.");
      setTitle("");
      setDescription("");
      setFile(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="communications-centre-hub__announce-grid">
      <div className="communications-centre-hub__card">
        <h3>Upload document</h3>
        <p className="lead">
          Reuses ParentDocument storage (same as Teacher App). Admin/Owner: school-wide, grade or class.
          Teachers: assigned classes only. Downloads use an authenticated school-scoped route.
        </p>
        {!canUpload ? (
          <div className="communications-centre-hub__locked">
            No assigned classrooms and no school-admin role — document upload is locked.
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            {schoolWideAllowed ? (
              <div className="communications-centre-hub__field">
                <label>Target</label>
                <select
                  value={targetMode}
                  onChange={(e) => setTargetMode(e.target.value as "school" | "grade" | "class")}
                >
                  <option value="school">School-wide</option>
                  <option value="grade">Grade</option>
                  <option value="class">Class</option>
                </select>
              </div>
            ) : null}
            {targetMode === "grade" && schoolWideAllowed ? (
              <div className="communications-centre-hub__field">
                <label>Grade</label>
                <input value={grade} onChange={(e) => setGrade(e.target.value)} required placeholder="e.g. Grade 4" />
              </div>
            ) : null}
            {(targetMode === "class" || !schoolWideAllowed) && (
              <div className="communications-centre-hub__field">
                <label>Class</label>
                <select
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  required
                  disabled={!hasAssigned}
                >
                  <option value="">{hasAssigned ? "Select class" : "No assigned classes"}</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="communications-centre-hub__field">
              <label>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="communications-centre-hub__field">
              <label>Description (optional)</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="communications-centre-hub__field">
              <label>File</label>
              <input
                type="file"
                accept="application/pdf,image/*,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="communications-centre-hub__actions">
              <button type="submit" className="communications-centre-hub__btn" disabled={busy}>
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="communications-centre-hub__card">
        <h3>School documents</h3>
        <p className="lead">
          {loading ? "Loading…" : `${total} document(s) in your scope. Teacher App uploads remain available.`}
        </p>
        {err ? <p className="communications-centre-hub__status is-error">{err}</p> : null}
        {ok ? <p className="communications-centre-hub__status is-ok">{ok}</p> : null}
        <ul className="communications-centre-hub__list">
          {docs.map((d) => (
            <li key={d.id}>
              <div className="communications-centre-hub__announce-item-head">
                <strong>{d.title}</strong>
                <span className="communications-centre-hub__pill">{d.targeting || "Document"}</span>
              </div>
              <span>
                {d.fileName || "file"} · {d.createdAt ? new Date(d.createdAt).toLocaleString() : ""}
              </span>
              <div className="communications-centre-hub__actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="communications-centre-hub__btn communications-centre-hub__btn--ghost"
                  onClick={() => void downloadDoc(d)}
                >
                  Download
                </button>
              </div>
            </li>
          ))}
          {!loading && !docs.length ? (
            <li>
              <strong>No documents yet</strong>
              <span>Upload above or via Teacher App Documents.</span>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
