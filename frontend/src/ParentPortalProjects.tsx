import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { getParentPortalSession } from "./parentPortalSession";

type Project = {
  id?: string;
  title?: string;
  description?: string;
  className?: string;
  subject?: string;
  dueDate?: string;
  createdAt?: string;
  [key: string]: any;
};

function getProjectTitle(p: Project) {
  return String(p.title || p.name || p.projectTitle || "Project");
}

function getProjectId(p: Project, idx: number) {
  const raw = p.id ?? p.projectId ?? p._id;
  return raw ? String(raw) : `project-${idx}`;
}

export default function ParentPortalProjects() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [dashboard, setDashboard] = useState<any>(null);

  const [className, setClassName] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  useEffect(() => {
    if (!session) {
      navigate("/parent/login", { replace: true });
      return;
    }
    (async () => {
      setLoading(true);
      setStatus("");
      try {
        const dash = await apiFetch(`/api/parent-portal/dashboard/${session.parentId}`);
        setDashboard(dash);
        const learners: any[] = Array.isArray(dash?.learners) ? dash.learners : [];
        const classes = Array.from(new Set(learners.map((l) => l.className).filter(Boolean))) as string[];
        setClassName((prev) => prev || classes[0] || "");
      } catch (e: any) {
        setStatus(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

  useEffect(() => {
    if (!session) return;
    const schoolId = String(dashboard?.parent?.schoolId || session.schoolId || "");
    if (!schoolId) return;

    (async () => {
      setProjectsLoading(true);
      setStatus("");
      try {
        const qs = new URLSearchParams();
        qs.set("schoolId", schoolId);
        if (className) qs.set("className", className);

        const res: any = await apiFetch(`/api/parent-portal/projects?${qs.toString()}`);
        const list = Array.isArray(res?.projects) ? res.projects : Array.isArray(res) ? res : [];
        setProjects(list);
      } catch (e: any) {
        setStatus(e?.message || "Failed to fetch projects");
        setProjects([]);
      } finally {
        setProjectsLoading(false);
      }
    })();
  }, [className, dashboard?.parent?.schoolId, session, dashboard]);

  if (!session) return null;

  const learners: any[] = Array.isArray(dashboard?.learners) ? dashboard.learners : [];
  const classes = Array.from(new Set(learners.map((l) => l.className).filter(Boolean))) as string[];

  return (
    <div style={{ maxWidth: 1000, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Projects</h2>
        <div style={{ marginLeft: "auto" }}>
          <Link to="/parent/dashboard" style={{ color: "#b48a00", fontWeight: 900 }}>
            Back to dashboard
          </Link>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading...</div>
      ) : status ? (
        <div style={{ padding: 16, color: "#b91c1c", fontWeight: 800 }}>{status}</div>
      ) : (
        <>
          <div style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 14, border: "1px solid rgba(212,175,55,0.25)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ color: "#d4af37", fontWeight: 900 }}>Class</div>
              <select
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(212,175,55,0.35)",
                  background: "#0b0b0b",
                  color: "#f8fafc",
                }}
              >
                <option value="">{classes.length ? "All classes" : "No class info"}</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div style={{ marginLeft: "auto", color: "#cbd5e1", fontWeight: 700 }}>
                {projectsLoading ? "Loading projects..." : `${projects.length} projects`}
              </div>
            </div>
          </div>

          {projectsLoading ? (
            <div style={{ marginTop: 12, padding: 16, background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)" }}>
              Loading...
            </div>
          ) : projects.length ? (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {projects.map((p, idx) => (
                <div key={getProjectId(p, idx)} style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>{getProjectTitle(p)}</div>
                    <div style={{ color: "#475569", fontWeight: 800 }}>
                      {p.dueDate ? `Due ${new Date(p.dueDate).toLocaleDateString()}` : p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                  <div style={{ marginTop: 4, color: "#475569", fontWeight: 700 }}>
                    {p.subject ? `${p.subject} • ` : ""}{p.className ? p.className : className ? className : ""}
                  </div>
                  {p.description ? <div style={{ marginTop: 8, color: "#334155" }}>{p.description}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 12, padding: 16, background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ fontWeight: 900 }}>No projects yet</div>
              <div style={{ marginTop: 6, color: "#475569" }}>
                When the school publishes projects, they will appear here.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

