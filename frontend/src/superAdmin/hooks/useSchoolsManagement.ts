import { useCallback, useMemo, useState } from "react";
import { INITIAL_SCHOOLS } from "../data/schoolsData";
import type { SchoolPackage, SchoolRecord, SchoolStatus, SchoolsSummary } from "../types/schools";

export type SchoolsStatusFilter = "all" | SchoolStatus;
export type SchoolsPackageFilter = "all" | SchoolPackage;

function computeSummary(schools: SchoolRecord[]): SchoolsSummary {
  return {
    total: schools.length,
    active: schools.filter((s) => s.status === "Active").length,
    suspended: schools.filter((s) => s.status === "Suspended").length,
    trial: schools.filter((s) => s.status === "Trial").length,
  };
}

function matchesSearch(school: SchoolRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    school.schoolName.toLowerCase().includes(q) ||
    school.ownerName.toLowerCase().includes(q) ||
    school.email.toLowerCase().includes(q)
  );
}

export function useSchoolsManagement() {
  const [schools] = useState<SchoolRecord[]>(INITIAL_SCHOOLS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SchoolsStatusFilter>("all");
  const [packageFilter, setPackageFilter] = useState<SchoolsPackageFilter>("all");

  const summary = useMemo(() => computeSummary(schools), [schools]);

  const filteredSchools = useMemo(() => {
    return schools.filter((school) => {
      if (statusFilter !== "all" && school.status !== statusFilter) return false;
      if (packageFilter !== "all" && school.package !== packageFilter) return false;
      return matchesSearch(school, search);
    });
  }, [schools, search, statusFilter, packageFilter]);

  const hasRegisteredSchools = schools.length > 0;

  const onViewSchool = useCallback((_school: SchoolRecord) => {
    /* API: navigate to school detail */
  }, []);

  const onActivateSchool = useCallback((_school: SchoolRecord) => {
    /* API: PATCH status → Active */
  }, []);

  const onSuspendSchool = useCallback((_school: SchoolRecord) => {
    /* API: PATCH status → Suspended */
  }, []);

  const onChangePackage = useCallback((_school: SchoolRecord) => {
    /* API: open change-package flow */
  }, []);

  const onResetPassword = useCallback((_school: SchoolRecord) => {
    /* API: trigger owner password reset */
  }, []);

  const onAddSchool = useCallback(() => {
    /* API: open create-school flow */
  }, []);

  return {
    schools,
    filteredSchools,
    summary,
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
  };
}
