import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSuperAdminSchools, updateSuperAdminSchool } from "../api/schoolsApi";
import type { SchoolPackage, SchoolRecord, SchoolStatus, SchoolsSummary } from "../types/schools";

export type SchoolsStatusFilter = "all" | SchoolStatus;
export type SchoolsPackageFilter = "all" | SchoolPackage;

const EMPTY_SUMMARY: SchoolsSummary = {
  total: 0,
  active: 0,
  suspended: 0,
  trial: 0,
};

function matchesSearch(school: SchoolRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    school.schoolName.toLowerCase().includes(q) ||
    school.ownerName.toLowerCase().includes(q) ||
    school.email.toLowerCase().includes(q) ||
    String(school.contactPhone || "").toLowerCase().includes(q)
  );
}

export function useSchoolsManagement() {
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [summary, setSummary] = useState<SchoolsSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SchoolsStatusFilter>("all");
  const [packageFilter, setPackageFilter] = useState<SchoolsPackageFilter>("all");

  const loadSchools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSuperAdminSchools();
      setSchools(result.schools);
      setSummary(result.summary);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not load registered schools. Please try again.";
      setSchools([]);
      setSummary(EMPTY_SUMMARY);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchools();
  }, [loadSchools]);

  const filteredSchools = useMemo(() => {
    return schools.filter((school) => {
      if (statusFilter !== "all" && school.status !== statusFilter) return false;
      if (packageFilter !== "all" && school.package !== packageFilter) return false;
      return matchesSearch(school, search);
    });
  }, [schools, search, statusFilter, packageFilter]);

  const hasRegisteredSchools = schools.length > 0;

  const onViewSchool = useCallback((_school: SchoolRecord) => {
    /* handled in page */
  }, []);

  const onActivateSchool = useCallback(async (school: SchoolRecord) => {
    await updateSuperAdminSchool(school.id, { status: "Active" });
    await loadSchools();
  }, [loadSchools]);

  const onSuspendSchool = useCallback(async (school: SchoolRecord) => {
    await updateSuperAdminSchool(school.id, { status: "Suspended" });
    await loadSchools();
  }, [loadSchools]);

  const onChangePackage = useCallback(async (school: SchoolRecord) => {
    const current = String(school.package || "").trim();
    const next = current === "Starter" ? "Unlimited" : "Starter";
    await updateSuperAdminSchool(school.id, { package: next as SchoolPackage });
    await loadSchools();
  }, [loadSchools]);

  const onResetPassword = useCallback((_school: SchoolRecord) => {
    /* API: trigger owner password reset */
  }, []);

  const onAddSchool = useCallback(() => {
    /* API: open create-school flow */
  }, []);

  const onOpenDashboard = useCallback((school: SchoolRecord) => {
    if (school.canOpenDashboard) {
      window.location.assign("/dashboard");
    }
  }, []);

  return {
    schools,
    filteredSchools,
    summary,
    loading,
    error,
    reload: loadSchools,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    packageFilter,
    setPackageFilter,
    hasRegisteredSchools,
    onViewSchool,
    onActivateSchool,
    onSuspendSchool,
    onChangePackage,
    onResetPassword,
    onAddSchool,
    onOpenDashboard,
  };
}
