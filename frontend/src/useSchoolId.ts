import { useEffect, useState } from "react";
import { API_URL } from "./api";

type SchoolListItem = { id: string };

async function fetchFirstSchoolId(): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/schools`);
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  const list = Array.isArray(data) ? (data as SchoolListItem[]) : [];
  const first = list.find((s) => s && typeof (s as any).id === "string");
  return first?.id ? String(first.id) : null;
}

/**
 * Single source of truth for schoolId in the frontend.
 * - Reads from localStorage
 * - If missing, attempts to infer by loading the newest school and persisting it
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

      const inferred = await fetchFirstSchoolId();
      if (!inferred) return;

      localStorage.setItem("schoolId", inferred);
      if (!cancelled) setSchoolId(inferred);
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

