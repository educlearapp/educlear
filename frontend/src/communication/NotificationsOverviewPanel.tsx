import { useCallback, useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";

type Overview = {
  success?: boolean;
  inApp?: {
    created: number;
    unread: number;
    read: number;
    byType?: Record<string, number>;
  };
  push?: {
    byStatus?: Record<string, number>;
    queued: number;
    deferred: number;
    sent: number;
    failed: number;
    mock_ok: number;
    suppressed: number;
    externalSent: number;
    notExternallyDelivered: number;
    note?: string;
  };
  recent?: Array<{
    id: string;
    type: string;
    title: string;
    isRead: boolean;
    createdAt: string;
  }>;
  error?: string;
};

type Props = { schoolId: string };

export default function NotificationsOverviewPanel({ schoolId }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = (await staffApiFetch(
        `/api/school-notifications-overview?schoolId=${encodeURIComponent(schoolId)}`
      )) as Overview;
      setData(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load overview");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const inApp = data?.inApp;
  const push = data?.push;

  return (
    <div>
      <p className="communications-centre-hub__panel-note">
        Read-only school-scoped overview. Titles only — no private message bodies. No resend or send controls in
        this phase. Push <code>mock_ok</code> / <code>suppressed</code> are not externally delivered.
      </p>
      {err ? <p className="communications-centre-hub__status is-error">{err}</p> : null}
      {loading && !data ? <p className="communications-centre-hub__status">Loading…</p> : null}

      <div className="communications-centre-hub__announce-grid">
        <div className="communications-centre-hub__card">
          <h3>In-app notifications</h3>
          <p className="lead">ParentNotification rows created for this school.</p>
          <div className="communications-centre-hub__actions" style={{ gap: 12 }}>
            <Stat label="Created" value={inApp?.created ?? "—"} />
            <Stat label="Unread" value={inApp?.unread ?? "—"} />
            <Stat label="Read" value={inApp?.read ?? "—"} />
          </div>
          {inApp?.byType && Object.keys(inApp.byType).length ? (
            <ul className="communications-centre-hub__list" style={{ marginTop: 12, maxHeight: 200 }}>
              {Object.entries(inApp.byType).map(([type, count]) => (
                <li key={type}>
                  <strong>{type}</strong>
                  <span>{count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="communications-centre-hub__card">
          <h3>Web push delivery</h3>
          <p className="lead">{push?.note || "Status of ParentPushDelivery attempts."}</p>
          <div className="communications-centre-hub__actions" style={{ gap: 12, flexWrap: "wrap" }}>
            <Stat label="Queued / sending" value={push?.queued ?? "—"} />
            <Stat label="Deferred" value={push?.deferred ?? "—"} />
            <Stat label="Sent (status)" value={push?.sent ?? "—"} />
            <Stat label="Failed" value={push?.failed ?? "—"} />
            <Stat label="mock_ok" value={push?.mock_ok ?? "—"} />
            <Stat label="Suppressed" value={push?.suppressed ?? "—"} />
            <Stat label="External sent" value={push?.externalSent ?? "—"} />
            <Stat label="Not external" value={push?.notExternallyDelivered ?? "—"} />
          </div>
        </div>
      </div>

      <div className="communications-centre-hub__card" style={{ marginTop: 16 }}>
        <h3>Recent in-app (titles only)</h3>
        <ul className="communications-centre-hub__list">
          {(data?.recent || []).map((r) => (
            <li key={r.id}>
              <div className="communications-centre-hub__announce-item-head">
                <strong>{r.title}</strong>
                <span className={`communications-centre-hub__pill${r.isRead ? "" : " is-draft"}`}>
                  {r.isRead ? "Read" : "Unread"}
                </span>
              </div>
              <span>
                {r.type} · {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
              </span>
            </li>
          ))}
          {!loading && !(data?.recent || []).length ? (
            <li>
              <strong>No notifications yet</strong>
              <span>In-app rows appear when notices, homework, documents or messages notify parents.</span>
            </li>
          ) : null}
        </ul>
        <div className="communications-centre-hub__actions" style={{ marginTop: 10 }}>
          <button type="button" className="communications-centre-hub__btn communications-centre-hub__btn--ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        minWidth: 100,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(15, 32, 51, 0.1)",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: "#5b6b7c", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#0b1f3a", marginTop: 4 }}>{value}</div>
    </div>
  );
}
