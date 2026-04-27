import { useEffect, useState } from "react";
import { API_URL } from "./api";

const STORAGE_KEY = "schoolId";
const FALLBACK_SCHOOL_ID = "demo-school";

async function schoolExists(id: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/schools/${encodeURIComponent(id)}/exists`);
  return res.ok;
}

/**
 * Single source of truth for schoolId in the frontend.
 * - Reads from localStorage
 * - If missing, empty, or invalid, falls back to "demo-school" and persists it
 * - Keeps state in sync with localStorage (including cross-tab changes)
 */
export function useSchoolId(): string {
  // Never expose a stale/deleted stored id before validating it.
  const [schoolId, setSchoolId] = useState<string>(() => FALLBACK_SCHOOL_ID);

  useEffect(() => {
    let cancelled = false;

    function persistFallback() {
      localStorage.setItem(STORAGE_KEY, FALLBACK_SCHOOL_ID);
      if (!cancelled) setSchoolId(FALLBACK_SCHOOL_ID);
    }

    async function ensureValidSchoolId(raw: string | null) {
      const candidate = String(raw || "").trim();

      if (!candidate) {
        persistFallback();
        return;
      }

      if (candidate === FALLBACK_SCHOOL_ID) {
        localStorage.setItem(STORAGE_KEY, FALLBACK_SCHOOL_ID);
        if (!cancelled) setSchoolId(FALLBACK_SCHOOL_ID);
        return;
      }

      const ok = await schoolExists(candidate);
      if (!ok) {
        persistFallback();
        return;
      }

      localStorage.setItem(STORAGE_KEY, candidate);
      if (!cancelled) setSchoolId(candidate);
    }

    ensureValidSchoolId(localStorage.getItem(STORAGE_KEY)).catch(() => {
      // Treat as invalid (e.g. DB reset / backend unavailable) to avoid using a stale id.
      persistFallback();
    });

    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      ensureValidSchoolId(e.newValue).catch(() => {
        persistFallback();
      });
    }

    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return schoolId;
}

