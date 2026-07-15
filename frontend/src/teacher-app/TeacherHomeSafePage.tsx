import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "../api";
import { getStaffToken } from "../staffApi";

type CollectionMethod = "PARENT" | "TRANSPORT";

type DismissalSummary = {
  displayName: string;
  schoolLocalTimeDisplay: string;
  collectionMethod: CollectionMethod;
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
  const [collectionMethod, setCollectionMethod] = useState<CollectionMethod>("PARENT");
  const [searching, setSearching] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForNext = useCallback(() => {
    setSelected(null);
    setCollectionMethod("PARENT");
    setSearch("");
    setResults([]);
    setErr(null);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

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
    setCollectionMethod("PARENT");
    setSuccess(null);
    setErr(null);
  };

  const dismissLearner = async () => {
    if (!selected || dismissing) return;
    if (selected.dismissedToday) {
      setErr(`${selected.displayName} was already dismissed today.`);
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
          }),
        }
      );

      if (status === 409 && data.code === "ALREADY_DISMISSED") {
        const existing = data.existingDismissal;
        const time = existing?.schoolLocalTimeDisplay || "";
        const teacher = existing?.teacherName ? ` by ${existing.teacherName}` : "";
        setErr(
          `${selected.displayName} was already dismissed today at ${time}${teacher}.`
        );
        return;
      }

      if (!data.success || !data.dismissal) {
        setErr(data.error || "Could not save dismissal");
        return;
      }

      const methodLabel = data.dismissal.collectionMethod === "TRANSPORT" ? "Transport" : "Parent";
      setSuccess(
        `${data.dismissal.displayName} dismissed at ${data.dismissal.schoolLocalTimeDisplay} (${methodLabel}).`
      );
      resetForNext();
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

          <fieldset className="teacher-homesafe-methods">
            <legend>Collection method</legend>
            <label className="teacher-homesafe-method-option">
              <input
                type="radio"
                name="collectionMethod"
                value="PARENT"
                checked={collectionMethod === "PARENT"}
                onChange={() => setCollectionMethod("PARENT")}
                disabled={dismissing}
              />
              Parent
            </label>
            <label className="teacher-homesafe-method-option">
              <input
                type="radio"
                name="collectionMethod"
                value="TRANSPORT"
                checked={collectionMethod === "TRANSPORT"}
                onChange={() => setCollectionMethod("TRANSPORT")}
                disabled={dismissing}
              />
              Transport
            </label>
          </fieldset>

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
              disabled={dismissing || selected.dismissedToday}
            >
              {dismissing ? "Saving…" : "Dismiss Learner"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
