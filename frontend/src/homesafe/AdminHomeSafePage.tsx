import { useCallback, useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";
import {
  HOMESAFE_COLLECTION_METHODS,
  HOMESAFE_EARLY_DEPARTURE_REASONS,
  collectionMethodLabel,
  type HomeSafeCollectionMethodValue,
  type HomeSafeDismissResponse,
  type HomeSafeLearnerRow,
} from "./homesafeShared";
import "../teacher-app/teacherApp.css";
import "./homesafe.css";

type SearchResponse = {
  success?: boolean;
  learners?: HomeSafeLearnerRow[];
  schoolLocalDate?: string;
};

export default function AdminHomeSafePage() {
  const [search, setSearch] = useState("");
  const [learners, setLearners] = useState<HomeSafeLearnerRow[]>([]);
  const [selected, setSelected] = useState<HomeSafeLearnerRow | null>(null);
  const [collectionMethod, setCollectionMethod] = useState<HomeSafeCollectionMethodValue>("PARENT");
  const [collectionNote, setCollectionNote] = useState("");
  const [earlyReason, setEarlyReason] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [schoolLocalDate, setSchoolLocalDate] = useState("");

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setLearners([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        setErr(null);
        try {
          const qs = new URLSearchParams({ search: term });
          const data = (await staffApiFetch(
            `/api/teacher-app/homesafe/learners?${qs}`
          )) as SearchResponse;
          setLearners(data.learners || []);
          setSchoolLocalDate(data.schoolLocalDate || "");
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : "Search failed");
          setLearners([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const resetForm = useCallback(() => {
    setSelected(null);
    setCollectionMethod("PARENT");
    setCollectionNote("");
    setEarlyReason("");
    setStaffNote("");
    setSuccess(null);
    setErr(null);
  }, []);

  const confirmEarlyDeparture = async () => {
    if (!selected) return;
    if (!earlyReason) {
      setErr("Select a reason for early departure.");
      return;
    }
    if (earlyReason === "OTHER" && !staffNote.trim()) {
      setErr("A note is required when reason is Other.");
      return;
    }
    if (collectionMethod === "OTHER" && !collectionNote.trim()) {
      setErr("Enter a short description for Other collection.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    setSuccess(null);
    try {
      const notePayload =
        collectionMethod === "OTHER"
          ? collectionNote.trim()
          : earlyReason === "OTHER"
            ? staffNote.trim()
            : staffNote.trim() || undefined;
      const data = (await staffApiFetch("/api/teacher-app/homesafe/dismiss", {
        method: "POST",
        body: JSON.stringify({
          learnerId: selected.learnerId,
          collectionMethod,
          departureType: "EARLY_DEPARTURE",
          earlyDepartureReason: earlyReason,
          staffNote: notePayload,
          ...(collectionMethod === "OTHER" ? { collectionNote: collectionNote.trim() } : {}),
        }),
      })) as HomeSafeDismissResponse;

      if (!data.success) throw new Error(data.error || "Could not record early departure");

      const time = data.dismissal?.schoolLocalTimeDisplay || "—";
      const notif =
        data.notification?.status === "sent"
          ? ` · ${data.notification.parentsNotified} parent(s) notified`
          : "";
      setSuccess(
        `${selected.displayName} left early at ${time} (${collectionMethodLabel(collectionMethod)})${notif}`
      );
      setSelected(null);
      setSearch("");
      setLearners([]);
      setEarlyReason("");
      setStaffNote("");
      setCollectionNote("");
      setCollectionMethod("PARENT");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not record early departure");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-homesafe">
      <div className="admin-homesafe-head">
        <h1>HomeSafe — Early Departure</h1>
        <p className="admin-homesafe-muted">
          Record authorised early collection · Today: {schoolLocalDate || "—"}
        </p>
      </div>

      <div className="teacher-field teacher-homesafe-search-wrap">
        <label htmlFor="admin-homesafe-search">Find learner</label>
        <input
          id="admin-homesafe-search"
          type="search"
          autoComplete="off"
          className="teacher-homesafe-search"
          placeholder="Name, admission no, or class"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSuccess(null);
            setSelected(null);
          }}
        />
        {searching && <p className="teacher-muted teacher-homesafe-hint">Searching…</p>}
      </div>

      {success && <p className="teacher-homesafe-success">{success}</p>}
      {err && <p className="teacher-error">{err}</p>}

      {!selected && (
        <ul className="teacher-homesafe-results" aria-label="Search results">
          {search.trim().length >= 2 && learners.length === 0 && !searching && (
            <li className="teacher-muted teacher-homesafe-empty">No active learners found.</li>
          )}
          {learners.map((learner) => (
            <li key={learner.learnerId}>
              <button
                type="button"
                className="teacher-homesafe-result-btn"
                onClick={() => {
                  setSelected(learner);
                  setErr(null);
                  setSuccess(null);
                }}
              >
                <span className="teacher-homesafe-result-name">{learner.displayName}</span>
                <span className="teacher-homesafe-result-meta">
                  {learner.classroom}
                  {learner.admissionNo ? ` · ${learner.admissionNo}` : ""}
                  {learner.dismissedToday && (
                    <span className="teacher-homesafe-dismissed-badge">Already left today</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section className="teacher-homesafe-confirm" aria-label="Early departure">
          <h2 className="teacher-homesafe-confirm-title">{selected.displayName}</h2>
          <p className="teacher-muted">{selected.classroom}</p>
          {selected.dismissedToday ? (
            <p className="teacher-error">
              This learner already has an active departure today (
              {selected.dismissalToday?.schoolLocalTimeDisplay || "—"}).
            </p>
          ) : (
            <>
              <div className="teacher-field teacher-homesafe-collector">
                <label htmlFor="admin-homesafe-collected-by">Collected by</label>
                <select
                  id="admin-homesafe-collected-by"
                  className="teacher-homesafe-select"
                  value={collectionMethod}
                  onChange={(e) => {
                    const next = e.target.value as HomeSafeCollectionMethodValue;
                    setCollectionMethod(next);
                    if (next !== "OTHER") setCollectionNote("");
                  }}
                >
                  {HOMESAFE_COLLECTION_METHODS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {collectionMethod === "OTHER" && (
                <div className="admin-homesafe-reason-grid">
                  <label htmlFor="admin-collection-note">Describe who collected (required)</label>
                  <input
                    id="admin-collection-note"
                    type="text"
                    maxLength={80}
                    value={collectionNote}
                    onChange={(e) => setCollectionNote(e.target.value)}
                    placeholder="e.g. Neighbour, Aunt"
                  />
                </div>
              )}

              <div className="admin-homesafe-reason-grid">
                <label htmlFor="admin-early-reason">Reason (required)</label>
                <select
                  id="admin-early-reason"
                  value={earlyReason}
                  onChange={(e) => setEarlyReason(e.target.value)}
                >
                  <option value="">Select reason…</option>
                  {HOMESAFE_EARLY_DEPARTURE_REASONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {earlyReason === "OTHER" && (
                <div className="admin-homesafe-reason-grid">
                  <label htmlFor="admin-staff-note">Note (required for Other)</label>
                  <textarea
                    id="admin-staff-note"
                    rows={2}
                    value={staffNote}
                    onChange={(e) => setStaffNote(e.target.value)}
                    placeholder="Brief internal note (not sent to parents)"
                  />
                </div>
              )}

              {earlyReason && earlyReason !== "OTHER" && (
                <div className="admin-homesafe-reason-grid">
                  <label htmlFor="admin-staff-note-opt">Optional note</label>
                  <textarea
                    id="admin-staff-note-opt"
                    rows={2}
                    value={staffNote}
                    onChange={(e) => setStaffNote(e.target.value)}
                    placeholder="Internal note (not sent to parents)"
                  />
                </div>
              )}

              <div className="teacher-homesafe-actions">
                <button type="button" className="teacher-touch-btn" onClick={resetForm} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="teacher-touch-btn primary teacher-homesafe-dismiss-btn"
                  disabled={
                    submitting ||
                    !earlyReason ||
                    (collectionMethod === "OTHER" && !collectionNote.trim()) ||
                    (earlyReason === "OTHER" && !staffNote.trim() && collectionMethod !== "OTHER")
                  }
                  onClick={() => void confirmEarlyDeparture()}
                >
                  {submitting ? "Saving…" : "Confirm early departure"}
                </button>
              </div>
            </>
          )}
          {selected.dismissedToday && (
            <div className="teacher-homesafe-actions">
              <button type="button" className="teacher-touch-btn" onClick={resetForm}>
                Back
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
