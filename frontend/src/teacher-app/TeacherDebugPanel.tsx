import { useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";

type MeResponse = {
  user?: { email?: string | null };
  school?: { id?: string };
  assignedClassrooms?: { id: string; name: string; teacherEmail?: string; learnerCount?: number }[];
};

type DebugResponse = {
  debug?: {
    schoolId?: string;
    loggedInTeacherEmail?: string;
    jwtEmailRaw?: string;
    assignedClassroomsFromMe?: unknown[];
    assignedClassrooms?: { id: string; name: string; teacherEmail?: string }[];
    allClassroomsWithTeacherEmail?: {
      name: string;
      teacherEmail: string;
      teacherEmailNormalized: string;
      matchesLoggedIn: boolean;
    }[];
  };
};

export default function TeacherDebugPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [debug, setDebug] = useState<DebugResponse["debug"] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [meData, debugData] = await Promise.all([
          staffApiFetch("/api/teacher-app/me") as Promise<MeResponse>,
          staffApiFetch("/api/teacher-app/me/debug") as Promise<DebugResponse>,
        ]);
        setMe(meData);
        setDebug(debugData.debug ?? null);
        setErr(null);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Debug load failed");
      }
    })();
  }, []);

  const jwtEmail = me?.user?.email || debug?.loggedInTeacherEmail || "—";
  const schoolId = debug?.schoolId || me?.school?.id || localStorage.getItem("schoolId") || "—";

  return (
    <details
      className="teacher-debug-panel"
      style={{
        marginTop: 16,
        padding: 12,
        border: "1px solid rgba(212,175,55,0.45)",
        borderRadius: 8,
        background: "rgba(0,0,0,0.35)",
        fontSize: "0.8rem",
      }}
    >
      <summary style={{ cursor: "pointer", color: "var(--t-gold)", fontWeight: 600 }}>
        Assignment debug (temporary)
      </summary>
      {err && <p className="teacher-error" style={{ marginTop: 8 }}>{err}</p>}
      <dl style={{ margin: "12px 0 0", display: "grid", gap: 8 }}>
        <div>
          <dt style={{ color: "#94a3b8" }}>Logged-in JWT email</dt>
          <dd style={{ margin: 0, fontFamily: "monospace" }}>{jwtEmail}</dd>
        </div>
        <div>
          <dt style={{ color: "#94a3b8" }}>schoolId</dt>
          <dd style={{ margin: 0, fontFamily: "monospace" }}>{schoolId}</dd>
        </div>
        <div>
          <dt style={{ color: "#94a3b8" }}>assignedClassrooms (/api/teacher-app/me)</dt>
          <dd style={{ margin: 0 }}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {JSON.stringify(me?.assignedClassrooms ?? [], null, 2)}
            </pre>
          </dd>
        </div>
        <div>
          <dt style={{ color: "#94a3b8" }}>All classrooms (school) with teacherEmail</dt>
          <dd style={{ margin: 0 }}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {JSON.stringify(debug?.allClassroomsWithTeacherEmail ?? [], null, 2)}
            </pre>
          </dd>
        </div>
      </dl>
      <p className="teacher-muted" style={{ marginTop: 8, marginBottom: 0 }}>
        Teacher assignment matches <code>Classroom.teacherEmail</code> to JWT email (trim + lowercase). Class
        name is only used for learners/homework, not assignment.
      </p>
    </details>
  );
}
