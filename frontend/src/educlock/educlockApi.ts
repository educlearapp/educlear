import { apiFetch } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";
import { sanitizeClockGpsBody } from "./educlockStaffGeolocation";

export type EduClockMeResponse = {
  status: string;
  schoolId?: string;
  schoolName?: string | null;
  loginEmail?: string;
  userId?: string;
  employeeId?: string;
  employeeNumber?: string;
  employeeName?: string;
  error?: string;
  code?: string;
};

export type EduClockActivateResponse = {
  status: string;
  activationStatus?: string;
  userId: string;
  schoolId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  identityMasked: string;
};

export async function fetchEduClockMe(): Promise<EduClockMeResponse> {
  return apiFetch("/api/educlock/me", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<EduClockMeResponse>;
}

export async function activateEduClock(input: {
  identityType: string;
  identityNumber: string;
  identityCountryCode?: string;
}): Promise<EduClockActivateResponse> {
  return apiFetch("/api/educlock/activate", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      identityType: input.identityType,
      identityNumber: input.identityNumber,
      ...(input.identityCountryCode
        ? { identityCountryCode: input.identityCountryCode }
        : {}),
    }),
  }) as Promise<EduClockActivateResponse>;
}

export async function fetchOwnerEduClockStaff(): Promise<{
  schoolId: string;
  staff: Array<Record<string, unknown>>;
  unlinkedEmployees: Array<Record<string, unknown>>;
}> {
  return apiFetch("/api/educlock/owner/staff", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{
    schoolId: string;
    staff: Array<Record<string, unknown>>;
    unlinkedEmployees: Array<Record<string, unknown>>;
  }>;
}

export async function fetchOwnerEduClockReadiness(): Promise<{
  schoolId: string;
  counts: Record<string, number>;
  totals: Record<string, number>;
  employees: Array<Record<string, unknown>>;
  usersWithoutEmployee: Array<Record<string, unknown>>;
}> {
  return apiFetch("/api/educlock/owner/readiness", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{
    schoolId: string;
    counts: Record<string, number>;
    totals: Record<string, number>;
    employees: Array<Record<string, unknown>>;
    usersWithoutEmployee: Array<Record<string, unknown>>;
  }>;
}

export async function ownerBulkUpdateEmployeeNumbers(
  updates: Array<{ employeeId: string; employeeNumber: string }>
): Promise<{ updatedCount: number; updated: Array<{ employeeId: string; employeeNumber: string }> }> {
  return apiFetch("/api/educlock/owner/employees/numbers", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  }) as Promise<{ updatedCount: number; updated: Array<{ employeeId: string; employeeNumber: string }> }>;
}

export async function ownerResetEduClock(userId: string): Promise<unknown> {
  return apiFetch(`/api/educlock/owner/staff/${encodeURIComponent(userId)}/reset`, {
    method: "POST",
    headers: { ...staffAuthHeaders() },
  });
}

export async function ownerLinkEduClock(userId: string, employeeId: string): Promise<unknown> {
  return apiFetch(`/api/educlock/owner/staff/${encodeURIComponent(userId)}/link`, {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
}

export async function ownerUnlinkEduClock(userId: string): Promise<unknown> {
  return apiFetch(`/api/educlock/owner/staff/${encodeURIComponent(userId)}/unlink`, {
    method: "POST",
    headers: { ...staffAuthHeaders() },
  });
}

export type EduClockEntranceRow = {
  id: string;
  schoolId?: string;
  campusId?: string;
  name: string;
  description: string | null;
  entranceType?: string | null;
  entranceTypeLabel?: string | null;
  customTypeLabel?: string | null;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMetres?: number;
  gpsReady?: boolean;
  gpsReadinessCode?: string;
  gpsReadinessReasons?: string[];
  boundaryStatus?: string | null;
  boundaryZoneId?: string | null;
  polygonValidationEnabled?: boolean;
};

export type EduClockGeofenceSummary = {
  totalCampuses: number;
  activeCampuses: number;
  totalEntrances: number;
  gpsReadyEntrances: number;
  notReadyEntrances: number;
};

export type EduClockCampusRow = {
  id: string;
  schoolId: string;
  name: string;
  description: string | null;
  timezone: string;
  toleranceMetres: number;
  isActive: boolean;
  perimeterStatus: string;
  entranceCount: number;
  gpsReadyEntranceCount?: number;
  perimeterNote: string | null;
  entrances: EduClockEntranceRow[];
};

export async function fetchOwnerEduClockCampuses(): Promise<{
  schoolId: string;
  campuses: EduClockCampusRow[];
  summary?: EduClockGeofenceSummary;
}> {
  return apiFetch("/api/educlock/owner/campuses", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{
    schoolId: string;
    campuses: EduClockCampusRow[];
    summary?: EduClockGeofenceSummary;
  }>;
}

export async function createEduClockCampus(input: {
  name: string;
  description?: string | null;
  timezone?: string | null;
  toleranceMetres?: number | null;
}): Promise<EduClockCampusRow> {
  return apiFetch("/api/educlock/owner/campuses", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<EduClockCampusRow>;
}

export async function updateEduClockCampus(
  campusId: string,
  input: {
    name?: string;
    description?: string | null;
    timezone?: string | null;
    toleranceMetres?: number | null;
    isActive?: boolean;
  }
): Promise<EduClockCampusRow> {
  return apiFetch(`/api/educlock/owner/campuses/${encodeURIComponent(campusId)}`, {
    method: "PATCH",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<EduClockCampusRow>;
}

export async function createEduClockEntrance(
  campusId: string,
  input: {
    name: string;
    description?: string | null;
    entranceType?: string;
    customTypeLabel?: string | null;
    captureAccuracyMetres?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    allowedRadiusMetres?: number;
    isActive?: boolean;
    confirmOutsideBoundary?: boolean;
  }
): Promise<EduClockEntranceRow> {
  return apiFetch(`/api/educlock/owner/campuses/${encodeURIComponent(campusId)}/entrances`, {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<EduClockEntranceRow>;
}

export async function updateEduClockEntrance(
  entranceId: string,
  input: {
    name?: string;
    description?: string | null;
    entranceType?: string;
    customTypeLabel?: string | null;
    captureAccuracyMetres?: number | null;
    isActive?: boolean;
    latitude?: number | null;
    longitude?: number | null;
    allowedRadiusMetres?: number;
    confirmOutsideBoundary?: boolean;
  }
): Promise<EduClockEntranceRow> {
  return apiFetch(`/api/educlock/owner/entrances/${encodeURIComponent(entranceId)}`, {
    method: "PATCH",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<EduClockEntranceRow>;
}

export type EduClockStaffStatus = {
  readiness: string;
  readinessReasons?: string[];
  readinessReason?: string;
  canClock?: boolean;
  currentStatus: string;
  employeeId?: string;
  employeeName?: string | null;
  employeeFirstName?: string;
  employeeLastName?: string;
  employeeNumber?: string | null;
  schoolLocalDate: string;
  schoolLocalTime: string;
  schoolLocalTimeDisplay?: string;
  timezone: string;
  serverTimeUtc?: string;
  activeClockIn?: Record<string, unknown> | null;
  currentShiftDurationMs?: number | null;
  currentShiftDurationDisplay?: string | null;
  missingClockOut?: boolean;
  recentShifts?: Array<Record<string, unknown>>;
};

export async function fetchStaffClockStatus(): Promise<EduClockStaffStatus> {
  return apiFetch("/api/educlock/me/status", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<EduClockStaffStatus>;
}

export async function postStaffClockIn(input?: {
  idempotencyKey?: string;
  gps?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const body = sanitizeClockGpsBody(input?.gps);
  return apiFetch("/api/educlock/me/clock-in", {
    method: "POST",
    headers: {
      ...staffAuthHeaders(),
      "Content-Type": "application/json",
      ...(input?.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  }) as Promise<Record<string, unknown>>;
}

export async function postStaffClockOut(input?: {
  idempotencyKey?: string;
  gps?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const body = sanitizeClockGpsBody(input?.gps);
  return apiFetch("/api/educlock/me/clock-out", {
    method: "POST",
    headers: {
      ...staffAuthHeaders(),
      "Content-Type": "application/json",
      ...(input?.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  }) as Promise<Record<string, unknown>>;
}

export async function fetchStaffClockHistory(): Promise<{
  shifts: Array<Record<string, unknown>>;
}> {
  return apiFetch("/api/educlock/me/history", {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{ shifts: Array<Record<string, unknown>> }>;
}

export type EduClockAttendanceResponse = {
  schoolId: string;
  schoolLocalDate: string;
  timezone: string;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<string, number>;
  rows: Array<Record<string, unknown>>;
};

export async function fetchOwnerEduClockAttendance(params?: {
  schoolLocalDate?: string;
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<EduClockAttendanceResponse> {
  const q = new URLSearchParams();
  if (params?.schoolLocalDate) q.set("schoolLocalDate", params.schoolLocalDate);
  if (params?.search) q.set("search", params.search);
  if (params?.status) q.set("status", params.status);
  if (params?.page != null) q.set("page", String(params.page));
  if (params?.pageSize != null) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  return apiFetch(`/api/educlock/owner/attendance${qs ? `?${qs}` : ""}`, {
    headers: { ...staffAuthHeaders() },
  }) as Promise<EduClockAttendanceResponse>;
}

export async function fetchOwnerEduClockExceptions(params?: {
  schoolLocalDate?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
  const q = new URLSearchParams();
  if (params?.schoolLocalDate) q.set("schoolLocalDate", params.schoolLocalDate);
  if (params?.status) q.set("status", params.status);
  if (params?.page != null) q.set("page", String(params.page));
  if (params?.pageSize != null) q.set("pageSize", String(params.pageSize));
  const qs = q.toString();
  return apiFetch(`/api/educlock/owner/exceptions${qs ? `?${qs}` : ""}`, {
    headers: { ...staffAuthHeaders() },
  }) as Promise<{ total: number; rows: Array<Record<string, unknown>> }>;
}

export async function postOwnerEduClockCorrection(input: {
  employeeId: string;
  action: string;
  reason: string;
  note?: string | null;
  schoolLocalDate: string;
  schoolLocalTime: string;
  targetEventId?: string | null;
}): Promise<Record<string, unknown>> {
  return apiFetch("/api/educlock/owner/corrections", {
    method: "POST",
    headers: { ...staffAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }) as Promise<Record<string, unknown>>;
}


