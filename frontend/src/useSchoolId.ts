import { useEffect, useState } from "react";

/**
 * Single source of truth for schoolId in the frontend.
 * - Reads from localStorage
 * - Keeps state in sync with localStorage (including cross-tab changes)
 */
export function useSchoolId(): string {
  const [schoolId, setSchoolId] = useState(() => localStorage.getItem("schoolId") || "");

  useEffect(() => {
    let cancelled = false;

    async function ensure() {
      const current = localStorage.getItem("schoolId") || "";
      if (current) {
        if (!cancelled) setSchoolId(current);
        return;
      }
    }

    ensure().catch(() => {});

    function onStorage(e: StorageEvent) {
      if (e.key !== "schoolId") return;
      setSchoolId(String(e.newValue || ""));
    }

    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return schoolId;
}

