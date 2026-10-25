import { useCallback, useEffect, useMemo, useState } from "react";
import { parentApiFetch } from "./parentApi";

export type ParentEventRow = {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  lifecycleStatus?: string;
  cancellationReason?: string | null;
  isSchoolWide?: boolean;
  grade?: string | null;
  className?: string | null;
  matchedLearners?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    grade?: string;
    className?: string | null;
  }>;
};

type Props = {
  /** Reserved for future single-child filter; Phase 3 uses combined multi-child calendar. */
  selectedLearnerId?: string;
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function monthKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

export default function ParentEventsPanel(_props: Props) {
  const [range, setRange] = useState<"upcoming" | "past" | "all">("upcoming");
  const [events, setEvents] = useState<ParentEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      const append = Boolean(opts?.append);
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setErr(null);
      }
      try {
        // Combined calendar for all authorised linked children (no learnerId filter).
        const qs = new URLSearchParams({ limit: "40", range });
        if (opts?.cursor) qs.set("cursor", opts.cursor);
        const data = await parentApiFetch(`/api/parent-portal/events?${qs}`);
        const rows = Array.isArray(data?.events) ? (data.events as ParentEventRow[]) : [];
        setEvents((prev) => (append ? [...prev, ...rows] : rows));
        setHasMore(Boolean(data?.hasMore));
        setCursor(data?.nextCursor || null);
      } catch (e: unknown) {
        if (!append) {
          setEvents([]);
          setErr(e instanceof Error ? e.message : "Failed to load events");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [range]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, ParentEventRow[]>();
    for (const ev of events) {
      const key = monthKey(ev.startsAt);
      const list = map.get(key) || [];
      list.push(ev);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <div className="parent-portal-events">
      <div className="parent-portal-events-toolbar">
        <div className="parent-portal-section-label">School events</div>
        <div className="parent-portal-events-filters" role="group" aria-label="Event range">
          {(
            [
              ["upcoming", "Upcoming"],
              ["past", "Past"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`parent-portal-events-filter${range === value ? " is-active" : ""}`}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="parent-portal-muted" style={{ marginTop: 0 }}>
        Combined calendar for your linked children. School-wide events appear once. Cancelled events stay listed with a
        clear cancelled status.
      </p>
      {err ? <p className="parent-portal-error">{err}</p> : null}
      {loading ? <p className="parent-portal-muted">Loading events…</p> : null}
      {!loading && events.length === 0 ? <p className="parent-portal-muted">No events in this view.</p> : null}

      {grouped.map(([month, rows]) => (
        <section key={month} className="parent-portal-events-month">
          <h3 className="parent-portal-events-month-title">{month}</h3>
          <ul className="parent-portal-events-list">
            {rows.map((ev) => {
              const cancelled = String(ev.lifecycleStatus || "").toUpperCase() === "CANCELLED";
              const childLabel =
                ev.isSchoolWide || !ev.matchedLearners?.length
                  ? "All children"
                  : ev.matchedLearners
                      .map((l) => `${l.firstName} ${l.lastName}`.trim())
                      .filter(Boolean)
                      .join(", ");
              return (
                <li
                  key={ev.id}
                  className={`parent-portal-event-card${cancelled ? " is-cancelled" : ""}`}
                >
                  <div className="parent-portal-event-card-head">
                    <strong>{ev.title}</strong>
                    {cancelled ? <span className="parent-portal-event-badge">Cancelled</span> : null}
                  </div>
                  <div className="parent-portal-event-meta">
                    {formatWhen(ev.startsAt)}
                    {ev.endsAt ? ` – ${formatWhen(ev.endsAt)}` : ""}
                  </div>
                  {ev.location ? <div className="parent-portal-event-meta">📍 {ev.location}</div> : null}
                  <div className="parent-portal-event-meta">{childLabel}</div>
                  {ev.description ? <p className="parent-portal-event-body">{ev.description}</p> : null}
                  {cancelled && ev.cancellationReason ? (
                    <p className="parent-portal-event-cancel-reason">{ev.cancellationReason}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasMore ? (
        <button
          type="button"
          className="parent-portal-btn-ghost"
          disabled={loadingMore || !cursor}
          onClick={() => void load({ append: true, cursor })}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
