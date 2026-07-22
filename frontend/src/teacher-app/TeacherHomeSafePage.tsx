import { useEffect, useRef, useState } from "react";
import { API_URL } from "../api";
import { getStaffToken } from "../staffApi";
import {
  HOMESAFE_COLLECTION_METHODS,
  collectionMethodLabel,
  type HomeSafeCollectionMethodValue,
} from "../homesafe/homesafeShared";

type CollectionMethod = HomeSafeCollectionMethodValue;

/** Includes legacy TRANSPORT that may be stored on today's dismissal. */
type StoredCollectionMethod = CollectionMethod | "TRANSPORT";

type DismissalSummary = {
  displayName: string;
  schoolLocalTimeDisplay: string;
  collectionMethod: StoredCollectionMethod | string;
};

type LearnerResult = {
  learnerId: string;
  firstName: string;
  surname: string;
  displayName: string;
  classroom: string;
  dismissedToday: boolean;
  dismissalToday: DismissalSummary | null;
};

/**
 * Dropdown value when opening a learner card.
 * Already-dismissed learners must show today's stored method — never reset to PARENT.
 */
export function collectionMethodForTeacherHomeSafeSelection(
  learner: Pick<LearnerResult, "dismissedToday" | "dismissalToday">
): StoredCollectionMethod {
  if (!learner.dismissedToday) return "PARENT";
  const raw = String(learner.dismissalToday?.collectionMethod || "")
    .trim()
    .toUpperCase();
  if (!raw) return "PARENT";
  if (raw === "TRANSPORT") return "TRANSPORT";
  if ((HOMESAFE_COLLECTION_METHODS as readonly { value: string }[]).some((m) => m.value === raw)) {
    return raw as CollectionMethod;
  }
  // Unknown non-empty value: keep raw out of the controlled select by falling back
  // only when we cannot render it — still never invent Parent for a known selectable.
  return "PARENT";
}

type SearchResponse = {
  success?: boolean;
  learners?: LearnerResult[];
};

type DismissResponse = {
  success?: boolean;
  dismissal?: DismissalSummary & { schoolLocalTimeDisplay: string };
  error?: string;
  code?: string;
  existingDismissal?: DismissalSummary & {
    schoolLocalTimeDisplay: string;
    teacherName?: string | null;
    collectionMethod: CollectionMethod;
  };
};

async function homesafeFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; data: T }> {
  const token = getStaffToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data: T = {} as T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    data = {} as T;
  }
  return { status: res.status, data };
}

export default function TeacherHomeSafePage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<LearnerResult[]>([]);
  const [selected, setSelected] = useState<LearnerResult | null>(null);
  const [collectionMethod, setCollectionMethod] = useState<StoredCollectionMethod>("PARENT");
  const [collectionNote, setCollectionNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const collectorOptions =
    collectionMethod === "TRANSPORT"
      ? ([
          ...HOMESAFE_COLLECTION_METHODS,
          { value: "TRANSPORT" as const, label: "Transport" },
        ] as const)
      : HOMESAFE_COLLECTION_METHODS;

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ search: term });
          const { data } = await homesafeFetch<SearchResponse>(
            `/api/teacher-app/homesafe/learners?${qs}`
          );
          setResults(data.learners || []);
          setErr(null);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : "Search failed");
        } finally {
          setSearching(false);
        }
      })();
    }, 220);

    return () => window.clearTimeout(handle);
  }, [search]);

  const selectLearner = (learner: LearnerResult) => {
    setSelected(learner);
    setCollectionMethod(collectionMethodForTeacherHomeSafeSelection(learner));
    setCollectionNote("");
    setSuccess(null);
    setErr(null);
  };

  const dismissLearner = async () => {
    if (!selected || dismissing) return;
    if (selected.dismissedToday) {
      setErr(`${selected.displayName} was already dismissed today.`);
      return;
    }
    if (collectionMethod === "OTHER" && !collectionNote.trim()) {
      setErr("Enter a short description for Other.");
      return;
    }

    setDismissing(true);
    setErr(null);
    setSuccess(null);

    try {
      const { status, data } = await homesafeFetch<DismissResponse>(
        "/api/teacher-app/homesafe/dismiss",
        {
          method: "POST",
          body: JSON.stringify({
            learnerId: selected.learnerId,
            collectionMethod,
            ...(collectionMethod === "OTHER"
              ? { collectionNote: collectionNote.trim(), staffNote: collectionNote.trim() }
              : {}),
          }),
        }
      );

      if (status === 409 && data.code === "ALREADY_DISMISSED") {
        const existing = data.existingDismissal;
        const time = existing?.schoolLocalTimeDisplay || "";
        const teacher = existing?.teacherName ? ` by ${existing.teacherName}` : "";
        const updated: LearnerResult = {
          ...selected,
          dismissedToday: true,
          dismissalToday: existing
            ? {
                displayName: existing.displayName || selected.displayName,
                schoolLocalTimeDisplay: existing.schoolLocalTimeDisplay || time,
                collectionMethod: existing.collectionMethod,
              }
            : selected.dismissalToday,
        };
        setSelected(updated);
        setCollectionMethod(collectionMethodForTeacherHomeSafeSelection(updated));
        setErr(
          `${selected.displayName} was already dismissed today at ${time}${teacher}.`
        );
        return;
      }

      if (!data.success || !data.dismissal) {
        setErr(data.error || "Could not save dismissal");
        return;
      }

      const methodLabel = collectionMethodLabel(data.dismissal.collectionMethod);
      const updated: LearnerResult = {
        ...selected,
        dismissedToday: true,
        dismissalToday: {
          displayName: data.dismissal.displayName,
          schoolLocalTimeDisplay: data.dismissal.schoolLocalTimeDisplay,
          collectionMethod: data.dismissal.collectionMethod,
        },
      };
      setSelected(updated);
      setCollectionMethod(collectionMethodForTeacherHomeSafeSelection(updated));
      setSuccess(
        `${data.dismissal.displayName} dismissed at ${data.dismissal.schoolLocalTimeDisplay} (${methodLabel}).`
      );
      // Keep the card visible so Collected by shows the method just saved.
      // Clear search list only — teacher can Cancel or search the next learner.
      setResults([]);
      setSearch("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save dismissal");
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="teacher-homesafe">
      <h1 className="teacher-page-heading">HomeSafe</h1>
      <p className="teacher-muted">Search for a learner, confirm collection method, and dismiss.</p>

      <div className="teacher-field teacher-homesafe-search-wrap">
        <label htmlFor="homesafe-search">Find learner</label>
        <input
          id="homesafe-search"
          ref={searchRef}
          type="search"
          className="teacher-homesafe-search"
          placeholder="Type learner name…"
          value={search}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setSuccess(null);
            setSelected(null);
            setSearch(e.target.value);
          }}
        />
        {searching && <p className="teacher-muted teacher-homesafe-hint">Searching…</p>}
      </div>

      {success && <p className="teacher-homesafe-success">{success}</p>}
      {err && <p className="teacher-error">{err}</p>}

      {!selected && search.trim().length > 0 && (
        <ul className="teacher-homesafe-results" aria-label="Search results">
          {results.length === 0 && !searching && (
            <li className="teacher-muted teacher-homesafe-empty">No active learners found.</li>
          )}
          {results.map((learner) => (
            <li key={learner.learnerId}>
              <button
                type="button"
                className="teacher-homesafe-result-btn"
                onClick={() => selectLearner(learner)}
              >
                <span className="teacher-homesafe-result-name">{learner.displayName}</span>
                <span className="teacher-homesafe-result-meta">
                  {learner.classroom || "No class"}
                  {learner.dismissedToday && (
                    <span className="teacher-homesafe-dismissed-badge">Dismissed today</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section className="teacher-homesafe-confirm" aria-label="Dismiss learner">
          <h2 className="teacher-homesafe-confirm-title">{selected.displayName}</h2>
          <p className="teacher-muted">{selected.classroom || "No class"}</p>
          {selected.dismissedToday && (
            <p className="teacher-error">Already dismissed today — choose another learner.</p>
          )}

          <div className="teacher-field teacher-homesafe-collector">
            <label htmlFor="homesafe-collected-by">Collected by</label>
            <select
              id="homesafe-collected-by"
              className="teacher-homesafe-select"
              value={collectionMethod}
              onChange={(e) => {
                const next = e.target.value as StoredCollectionMethod;
                setCollectionMethod(next);
                if (next !== "OTHER") setCollectionNote("");
              }}
              disabled={dismissing || selected.dismissedToday}
            >
              {collectorOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {collectionMethod === "OTHER" && (
            <div className="teacher-field">
              <label htmlFor="homesafe-other-note">Describe who collected (required)</label>
              <input
                id="homesafe-other-note"
                type="text"
                className="teacher-homesafe-search"
                maxLength={80}
                placeholder="e.g. Neighbour, Aunt"
                value={collectionNote}
                onChange={(e) => setCollectionNote(e.target.value)}
                disabled={dismissing || selected.dismissedToday}
              />
            </div>
          )}

          <div className="teacher-homesafe-actions">
            <button
              type="button"
              className="teacher-touch-btn"
              onClick={() => {
                setSelected(null);
                setErr(null);
                searchRef.current?.focus();
              }}
              disabled={dismissing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="teacher-touch-btn primary teacher-homesafe-dismiss-btn"
              onClick={() => void dismissLearner()}
              disabled={
                dismissing ||
                selected.dismissedToday ||
                (collectionMethod === "OTHER" && !collectionNote.trim())
              }
            >
              {dismissing ? "Saving…" : "Dismiss Learner"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
