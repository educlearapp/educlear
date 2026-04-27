import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { clearParentPortalSession, getParentPortalSession } from "./parentPortalSession";

export default function ParentPortalDashboard() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [data, setData] = useState<any>(null);

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
        setData(dash);
      } catch (e: any) {
        setStatus(e?.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

  if (!session) return null;

  const parent = data?.parent;
  const learners: any[] = Array.isArray(data?.learners) ? data.learners : [];
  const outstanding = Number(data?.billing?.outstandingBalance || 0);
  const homework: any[] = Array.isArray(data?.latestHomework) ? data.latestHomework : [];
  const projects: any[] = Array.isArray(data?.latestProjects) ? data.latestProjects : [];
  const notices: any[] = Array.isArray(data?.latestNotices) ? data.latestNotices : [];
  const tuckshop = data?.tuckshopMenu || null;
  const threads: any[] = Array.isArray(data?.openMessageThreads) ? data.openMessageThreads : [];

  return (
    <div style={{ maxWidth: 1100, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Parent Portal Dashboard</h2>
          <div style={{ color: "#b48a00", fontWeight: 700 }}>
            {parent ? `${parent.firstName} ${parent.surname}` : session.parentEmail}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              clearParentPortalSession();
              navigate("/parent/login", { replace: true });
            }}
            style={{ padding: "10px 14px", borderRadius: 10, background: "transparent", border: "1px solid #ddd" }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 14, border: "1px solid rgba(212,175,55,0.25)" }}>
          <div style={{ color: "#d4af37", fontWeight: 900 }}>Outstanding Balance</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>R {outstanding.toFixed(2)}</div>
          <div style={{ marginTop: 8 }}>
            <Link to="/parent/statements" style={{ color: "#d4af37", fontWeight: 800 }}>
              View statements
            </Link>
          </div>
        </div>

        <div style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 14, border: "1px solid rgba(212,175,55,0.25)" }}>
          <div style={{ color: "#d4af37", fontWeight: 900 }}>Learners</div>
          {learners.length ? (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {learners.slice(0, 3).map((l) => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 800 }}>{l.firstName} {l.lastName}</span>
                  <span style={{ color: "#cbd5e1" }}>{l.grade}{l.className ? ` • ${l.className}` : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, color: "#cbd5e1" }}>No learners linked yet.</div>
          )}
        </div>

        <div style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 14, border: "1px solid rgba(212,175,55,0.25)" }}>
          <div style={{ color: "#d4af37", fontWeight: 900 }}>Quick Links</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <Link to="/parent/homework" style={{ color: "#f8fafc", fontWeight: 800 }}>Homework</Link>
            <Link to="/parent/projects" style={{ color: "#f8fafc", fontWeight: 800 }}>Projects</Link>
            <Link to="/parent/notices" style={{ color: "#f8fafc", fontWeight: 800 }}>Notices</Link>
            <Link to="/parent/tuckshop" style={{ color: "#f8fafc", fontWeight: 800 }}>Tuckshop</Link>
            <Link to="/parent/messages" style={{ color: "#f8fafc", fontWeight: 800 }}>Messages</Link>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading...</div>
      ) : status ? (
        <div style={{ padding: 16, color: "#b91c1c", fontWeight: 800 }}>{status}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 900 }}>Latest Homework</div>
              <Link to="/parent/homework" style={{ color: "#b48a00", fontWeight: 900 }}>View all</Link>
            </div>
            {homework.length ? (
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {homework.slice(0, 3).map((h) => (
                  <div key={h.id} style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>{h.title}</div>
                    <div style={{ color: "#475569", fontWeight: 700 }}>
                      {h.className}{h.subject ? ` • ${h.subject}` : ""} • Due {new Date(h.dueDate).toLocaleDateString()}
                    </div>
                    {h.description ? <div style={{ marginTop: 6, color: "#334155" }}>{h.description}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 10, color: "#475569" }}>No homework posted yet.</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Latest Projects</div>
                <Link to="/parent/projects" style={{ color: "#b48a00", fontWeight: 900 }}>View all</Link>
              </div>
              {projects.length ? (
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {projects.slice(0, 3).map((p) => (
                    <div key={p.id} style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: 10 }}>
                      <div style={{ fontWeight: 900 }}>{p.title || "Project"}</div>
                      <div style={{ color: "#475569", fontWeight: 700 }}>
                        {p.className ? p.className : ""}{p.subject ? ` • ${p.subject}` : ""}{p.dueDate ? ` • Due ${new Date(p.dueDate).toLocaleDateString()}` : ""}
                      </div>
                      {p.description ? <div style={{ marginTop: 6, color: "#334155" }}>{p.description}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 10, color: "#475569" }}>No projects posted yet.</div>
              )}
            </div>

            <div style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Latest Notice</div>
                <Link to="/parent/notices" style={{ color: "#b48a00", fontWeight: 900 }}>View all</Link>
              </div>
              {notices.length ? (
                <div style={{ marginTop: 10, border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: 10 }}>
                  <div style={{ fontWeight: 900 }}>{notices[0].title}</div>
                  <div style={{ color: "#475569", fontWeight: 700 }}>
                    {new Date(notices[0].date).toLocaleDateString()}
                  </div>
                  <div style={{ marginTop: 6, color: "#334155" }}>{notices[0].message}</div>
                </div>
              ) : (
                <div style={{ marginTop: 10, color: "#475569" }}>No notices yet.</div>
              )}
            </div>

            <div style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Tuckshop</div>
                <Link to="/parent/tuckshop" style={{ color: "#b48a00", fontWeight: 900 }}>View</Link>
              </div>
              {tuckshop ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ color: "#475569", fontWeight: 800 }}>
                    Menu date: {new Date(tuckshop.date).toLocaleDateString()}
                  </div>
                  <div style={{ marginTop: 6, color: "#334155" }}>
                    {Array.isArray(tuckshop.items) ? `${tuckshop.items.length} items` : "Menu available"}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10, color: "#475569" }}>No tuckshop menu published yet.</div>
              )}
            </div>

            <div style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>Messages</div>
                <Link to="/parent/messages" style={{ color: "#b48a00", fontWeight: 900 }}>Open inbox</Link>
              </div>
              {threads.length ? (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {threads.slice(0, 3).map((t) => (
                    <div key={t.id} style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: 10 }}>
                      <div style={{ fontWeight: 900 }}>{t.topic}</div>
                      <div style={{ color: "#475569", fontWeight: 700 }}>
                        {t.learner ? `${t.learner.firstName} ${t.learner.lastName}` : "Learner"} • {t.status}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 10, color: "#475569" }}>No open threads.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

