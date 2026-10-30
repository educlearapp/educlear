import { apiFetch } from "./api";

export type AdminEmployee = Record<string, unknown>;

/** Legacy unscoped keys — never read for display/restore (cross-tenant leak vector). */
const LEGACY_CACHE_KEY = "educlearEmployees";
const LEGACY_BACKUP_KEY = "educlearEmployees_backup";
const LEGACY_SELECTED_KEY = "selectedEmployeeForManage";

/** Preserved copies of legacy unscoped caches for POPIA incident assessment — never used by UI. */
const LEGACY_EVIDENCE_PREFIX = "educlearEmployees_LEGACY_EVIDENCE:";

function resolveStorageUserKey(): string {
  if (typeof localStorage === "undefined") return "anonymous";
  const userId = String(localStorage.getItem("userId") || "").trim();
  if (userId) return userId;
  const email = String(localStorage.getItem("userEmail") || "")
    .trim()
    .toLowerCase();
  if (email) return email;
  return "anonymous";
}

/** Browser storage is scoped by school AND authenticated user. */
function cacheKey(schoolId: string): string {
  return `educlearEmployees:${schoolId}:${resolveStorageUserKey()}`;
}

function backupKey(schoolId: string): string {
  return `educlearEmployees_backup:${schoolId}:${resolveStorageUserKey()}`;
}

function selectedEmployeeKey(schoolId: string): string {
  return `selectedEmployeeForManage:${schoolId}:${resolveStorageUserKey()}`;
}

function requireSchoolId(schoolId: string): string {
  const sid = String(schoolId || "").trim();
  if (!sid) {
    throw new Error("schoolId is required for employee cache access");
  }
  return sid;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v === undefined || v === null || v === "" ? fallback : v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize Prisma Decimal / API numbers for form inputs. */
function decimalToInput(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

function parsePhysicalAddress(physicalAddress: unknown): {
  address1: string;
  address2: string;
  city: string;
  province: string;
  postalCode: string;
} {
  const raw = String(physicalAddress || "").trim();
  if (!raw) {
    return { address1: "", address2: "", city: "", province: "", postalCode: "" };
  }

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    address1: parts[0] || "",
    address2: parts[1] || "",
    city: parts[2] || "",
    province: parts[3] || "",
    postalCode: parts[4] || "",
  };
}

export function isServerEmployeeId(id: unknown): boolean {
  const s = String(id || "").trim();
  return s.length >= 20 && !s.startsWith("employee-");
}

export function isLocalOnlyEmployee(employee: AdminEmployee): boolean {
  return !isServerEmployeeId(employee.id);
}

/**
 * Quarantine legacy global employee caches that were not scoped by school/user.
 * Copies payloads to evidence keys first (POPIA assessment) then removes active keys
 * so they cannot leak across tenants. Evidence keys are never read by the UI.
 */
export function quarantineLegacyUnscopedEmployeeCaches(): string[] {
  const removed: string[] = [];
  if (typeof localStorage === "undefined") return removed;
  for (const key of [LEGACY_CACHE_KEY, LEGACY_BACKUP_KEY, LEGACY_SELECTED_KEY]) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const evidenceKey = `${LEGACY_EVIDENCE_PREFIX}${key}`;
    if (localStorage.getItem(evidenceKey) === null) {
      localStorage.setItem(
        evidenceKey,
        JSON.stringify({
          quarantinedAt: new Date().toISOString(),
          sourceKey: key,
          byteLength: raw.length,
          payload: raw,
        })
      );
    }
    localStorage.removeItem(key);
    removed.push(key);
  }
  return removed;
}

function employeeDedupeKey(employee: AdminEmployee): string {
  const id = String(employee.id || "").trim();
  if (id) return `id:${id}`;

  const firstName = String(employee.firstName || "").trim().toLowerCase();
  const surname = String(employee.surname || employee.lastName || "")
    .trim()
    .toLowerCase();
  if (firstName && surname) return `name:${firstName}|${surname}`;

  return "";
}

function dedupeEmployees(employees: AdminEmployee[]): AdminEmployee[] {
  const map = new Map<string, AdminEmployee>();
  for (const employee of employees) {
    const key = employeeDedupeKey(employee);
    if (!key) continue;
    map.set(key, employee);
  }
  return Array.from(map.values());
}

function parseEmployeeList(raw: string | null): AdminEmployee[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Map backend Employee row → Administration UI shape. */
export function apiEmployeeToAdmin(emp: Record<string, unknown>): AdminEmployee {
  const employmentDate = emp.startDate ? String(emp.startDate).slice(0, 10) : "";
  const address = parsePhysicalAddress(emp.physicalAddress);

  return {
    id: emp.id,
    firstName: emp.firstName || "",
    surname: emp.lastName || "",
    occupation: emp.jobTitle || "",
    title: "",
    cell: emp.mobileNumber || "",
    phone: "",
    email: emp.email || "",
    idNumber: emp.idNumber || "",
    employmentDate,
    notes: emp.notes || "",
    payrollEnabled: emp.isActive !== false,
    uifEnabled: emp.uifApplicable !== false,
    incomeTaxEnabled: emp.incomeTaxApplicable !== false,
    basicSalary: decimalToInput(emp.basicSalary),
    taxNumber: emp.taxNumber || "",
    uifNumber: "",
    bankName: emp.bankName || "",
    bankAccountHolder: emp.bankAccountHolder || "",
    bankAccount: emp.bankAccountNumber || "",
    branchCode: emp.bankBranchCode || "",
    employeeNumber: emp.employeeNumber || "",
    employeePension: decimalToInput(emp.employeePension),
    employeeMedicalAid: decimalToInput(emp.employeeMedicalAid),
    employerMedicalAid: decimalToInput(emp.employerMedicalAid),
    overtimeHours: decimalToInput(emp.overtimeHours),
    overtimeRate: decimalToInput(emp.overtimeRate),
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    physicalAddress: emp.physicalAddress || "",
  };
}

export type EmployeeApiPayloadOptions = {
  /** Add Employee only — server allocates Employee.employeeNumber and ignores any client number. */
  autoAssignEmployeeNumber?: boolean;
};

export function wantsAutoAssignEmployeeNumber(
  options?: EmployeeApiPayloadOptions | null
): boolean {
  return options?.autoAssignEmployeeNumber === true;
}

/** Map Administration UI employee → backend Employee payload. */
export function adminEmployeeToApiPayload(
  employee: AdminEmployee,
  schoolId: string,
  options?: EmployeeApiPayloadOptions
): Record<string, unknown> {
  const firstName = String(employee.firstName || "").trim();
  const lastName = String(employee.surname || employee.lastName || "").trim();

  const addressParts = [employee.address1, employee.address2, employee.city, employee.province, employee.postalCode]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const physicalAddress =
    addressParts.length > 0
      ? addressParts.join(", ")
      : String(employee.physicalAddress || employee.address1 || "").trim() || null;

  const payload: Record<string, unknown> = {
    schoolId,
    firstName,
    lastName,
    email: String(employee.email || "").trim() || null,
    idNumber: String(employee.idNumber || "").trim() || null,
    mobileNumber: String(employee.cell || employee.mobileNumber || "").trim() || null,
    jobTitle: String(employee.occupation || employee.jobTitle || "").trim() || null,
    basicSalary: num(employee.basicSalary),
    taxNumber: String(employee.taxNumber || "").trim() || null,
    bankName: String(employee.bankName || "").trim() || null,
    bankAccountHolder: String(employee.bankAccountHolder || "").trim() || null,
    bankAccountNumber: String(employee.bankAccount || employee.bankAccountNumber || "").trim() || null,
    bankBranchCode: String(employee.branchCode || employee.bankBranchCode || "").trim() || null,
    physicalAddress,
    notes: String(employee.notes || "").trim() || null,
    isActive: employee.payrollEnabled !== false,
    uifApplicable: employee.uifEnabled !== false,
    incomeTaxApplicable: employee.incomeTaxEnabled !== false,
    employeePension: num(employee.employeePension),
    employeeMedicalAid: num(employee.employeeMedicalAid),
    employerMedicalAid: num(employee.employerMedicalAid),
    overtimeHours: num(employee.overtimeHours),
    overtimeRate: num(employee.overtimeRate),
    startDate: employee.employmentDate ? String(employee.employmentDate) : null,
  };

  if (wantsAutoAssignEmployeeNumber(options)) {
    payload.autoAssignEmployeeNumber = true;
  } else {
    payload.employeeNumber = String(employee.employeeNumber || "").trim() || null;
  }

  return payload;
}

export async function fetchSchoolEmployees(schoolId: string): Promise<AdminEmployee[]> {
  const data = await apiFetch(`/api/payroll/employees/${encodeURIComponent(schoolId)}`);
  if (!Array.isArray(data)) return [];
  return data.map((row) => apiEmployeeToAdmin(row as Record<string, unknown>));
}

function namesMatch(a: AdminEmployee, b: AdminEmployee): boolean {
  const aFirst = String(a.firstName || "").trim().toLowerCase();
  const aLast = String(a.surname || a.lastName || "")
    .trim()
    .toLowerCase();
  const bFirst = String(b.firstName || "").trim().toLowerCase();
  const bLast = String(b.surname || b.lastName || "")
    .trim()
    .toLowerCase();
  return Boolean(aFirst && aLast && aFirst === bFirst && aLast === bLast);
}

export function mergeEmployees(
  backendEmployees: AdminEmployee[],
  localEmployees: AdminEmployee[]
): AdminEmployee[] {
  const backendIds = new Set(
    backendEmployees.map((e) => String(e.id || "").trim()).filter(Boolean)
  );

  // Only merge local-only drafts. Never re-attach server IDs missing from this school's API
  // (those are other-tenant or deleted rows and must not reappear in the UI).
  const unsyncedLocal = localEmployees.filter((employee) => {
    if (!isLocalOnlyEmployee(employee)) return false;
    if (backendEmployees.some((backendEmployee) => namesMatch(employee, backendEmployee))) {
      return false;
    }
    const id = String(employee.id || "").trim();
    if (!id) return true;
    return !backendIds.has(id);
  });

  return dedupeEmployees([...backendEmployees, ...unsyncedLocal]);
}

/** Recoverable drafts for ONE school only — never legacy unscoped keys. */
export function collectRecoverableLocalEmployees(schoolId: string): AdminEmployee[] {
  const sid = requireSchoolId(schoolId);
  const combined = [
    ...readEmployeesCache(sid),
    ...readEmployeesBackup(sid),
    ...readSelectedEmployeeForManage(sid),
  ];
  return dedupeEmployees(combined).filter(isLocalOnlyEmployee);
}

export function readSelectedEmployeeForManage(schoolId: string): AdminEmployee[] {
  const sid = requireSchoolId(schoolId);
  try {
    const raw = localStorage.getItem(selectedEmployeeKey(sid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? [parsed as AdminEmployee] : [];
  } catch {
    return [];
  }
}

export function writeSelectedEmployeeForManage(schoolId: string, employee: AdminEmployee): void {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();
  localStorage.setItem(selectedEmployeeKey(sid), JSON.stringify(employee));
}

export function clearSelectedEmployeeForManage(schoolId: string): void {
  const sid = requireSchoolId(schoolId);
  localStorage.removeItem(selectedEmployeeKey(sid));
  localStorage.removeItem(LEGACY_SELECTED_KEY);
}

export type EmployeesLoadResult = {
  employees: AdminEmployee[];
  needsSync: boolean;
  unsyncedLocalCount: number;
  canRestoreFromBackup: boolean;
  backupCount: number;
};

export async function loadEmployeesForSchool(schoolId: string): Promise<EmployeesLoadResult> {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();

  const cached = readEmployeesCache(sid);
  const backup = readEmployeesBackup(sid);
  const localOnlyDrafts = collectRecoverableLocalEmployees(sid);

  let backend: AdminEmployee[] = [];
  try {
    backend = await fetchSchoolEmployees(sid);
  } catch {
    // Network failure: fall back ONLY to this school's scoped cache — never another tenant.
    const fallback = cached.length ? cached : backup;
    const scoped = dedupeEmployees(fallback);
    return {
      employees: scoped,
      needsSync: scoped.some(isLocalOnlyEmployee),
      unsyncedLocalCount: scoped.filter(isLocalOnlyEmployee).length,
      canRestoreFromBackup: cached.length === 0 && backup.length > 0,
      backupCount: backup.length,
    };
  }

  // Authoritative empty school: show empty (plus any local-only drafts for THIS school).
  // Never resurrect unscoped/other-tenant server rows.
  if (backend.length === 0) {
    writeEmployeesCache(sid, localOnlyDrafts);
    return {
      employees: localOnlyDrafts,
      needsSync: localOnlyDrafts.length > 0,
      unsyncedLocalCount: localOnlyDrafts.length,
      canRestoreFromBackup: false,
      backupCount: 0,
    };
  }

  const merged = mergeEmployees(backend, localOnlyDrafts);
  writeEmployeesCache(sid, merged);

  return {
    employees: merged,
    needsSync: merged.some(isLocalOnlyEmployee),
    unsyncedLocalCount: merged.filter(isLocalOnlyEmployee).length,
    canRestoreFromBackup: false,
    backupCount: readEmployeesBackup(sid).length,
  };
}

/** Reload employees from backend and refresh local cache (source of truth after save/refresh). */
export async function reloadEmployeesFromBackend(schoolId: string): Promise<AdminEmployee[]> {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();
  const backend = await fetchSchoolEmployees(sid);
  writeEmployeesCache(sid, backend);
  return backend;
}

export async function createSchoolEmployee(
  schoolId: string,
  employee: AdminEmployee,
  options?: EmployeeApiPayloadOptions
): Promise<AdminEmployee> {
  const payload = adminEmployeeToApiPayload(employee, schoolId, options);
  const created = await apiFetch("/api/payroll/employee", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return apiEmployeeToAdmin(created as Record<string, unknown>);
}

export async function updateSchoolEmployee(
  schoolId: string,
  employee: AdminEmployee
): Promise<AdminEmployee> {
  const id = String(employee.id || "");
  const payload = adminEmployeeToApiPayload(employee, schoolId);
  const updated = await apiFetch(`/api/payroll/employee/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return apiEmployeeToAdmin(updated as Record<string, unknown>);
}

export async function saveSchoolEmployee(
  schoolId: string,
  employee: AdminEmployee,
  options?: EmployeeApiPayloadOptions
): Promise<AdminEmployee> {
  if (isServerEmployeeId(employee.id)) {
    return updateSchoolEmployee(schoolId, employee);
  }
  return createSchoolEmployee(
    schoolId,
    employee,
    wantsAutoAssignEmployeeNumber(options) ? { autoAssignEmployeeNumber: true } : undefined
  );
}

export async function deleteSchoolEmployee(schoolId: string, employeeId: string): Promise<void> {
  await apiFetch(
    `/api/payroll/employee/${encodeURIComponent(employeeId)}?schoolId=${encodeURIComponent(schoolId)}`,
    { method: "DELETE" }
  );
}

export function removeEmployeeFromCache(schoolId: string, employeeId: string): AdminEmployee[] {
  const sid = requireSchoolId(schoolId);
  const id = String(employeeId || "").trim();
  const updated = readEmployeesCache(sid).filter((e) => String(e.id || "").trim() !== id);
  writeEmployeesCache(sid, updated);
  return updated;
}

export type RestoreLocalEmployeesResult = {
  restored: number;
  failed: number;
  skippedForeign: number;
  errors: string[];
};

export async function refreshEmployeesCacheFromBackend(
  schoolId: string
): Promise<AdminEmployee[]> {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();
  const backend = await fetchSchoolEmployees(sid);
  writeEmployeesCache(sid, backend);
  return backend;
}

/**
 * Restore ONLY local-only drafts for this schoolId.
 * Never imports server-owned rows (other tenants / deleted server employees).
 */
export async function restoreLocalEmployeesToBackend(
  schoolId: string,
  employees?: AdminEmployee[]
): Promise<RestoreLocalEmployeesResult> {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();

  const source = employees ?? collectRecoverableLocalEmployees(sid);
  let skippedForeign = 0;
  const candidates = dedupeEmployees(source).filter((employee) => {
    const firstName = String(employee.firstName || "").trim();
    const surname = String(employee.surname || employee.lastName || "").trim();
    if (!firstName || !surname) return false;
    // Block cross-tenant / deleted server rows from being re-created under this school.
    if (!isLocalOnlyEmployee(employee)) {
      skippedForeign += 1;
      return false;
    }
    return true;
  });

  let restored = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const employee of candidates) {
    const label =
      `${String(employee.firstName || "").trim()} ${String(employee.surname || employee.lastName || "").trim()}`.trim() ||
      "Employee";

    try {
      await createSchoolEmployee(sid, employee);
      restored += 1;
    } catch (e: unknown) {
      failed += 1;
      const message = e instanceof Error ? e.message : "Restore failed";
      errors.push(`${label}: ${message}`);
    }
  }

  if (skippedForeign > 0) {
    errors.push(
      `Skipped ${skippedForeign} employee(s) that belong to another school or the server (not imported).`
    );
  }

  return { restored, failed, skippedForeign, errors };
}

export function readEmployeesCache(schoolId: string): AdminEmployee[] {
  const sid = requireSchoolId(schoolId);
  return parseEmployeeList(localStorage.getItem(cacheKey(sid)));
}

export function readEmployeesBackup(schoolId: string): AdminEmployee[] {
  const sid = requireSchoolId(schoolId);
  return parseEmployeeList(localStorage.getItem(backupKey(sid)));
}

export function restoreEmployeesFromBackupToCache(schoolId: string): AdminEmployee[] {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();
  const backup = readEmployeesBackup(sid).filter(isLocalOnlyEmployee);
  if (!backup.length) return [];
  writeEmployeesCache(sid, backup);
  return backup;
}

export function writeEmployeesCache(schoolId: string, employees: AdminEmployee[]): void {
  const sid = requireSchoolId(schoolId);
  quarantineLegacyUnscopedEmployeeCaches();

  if (employees.length === 0) {
    localStorage.removeItem(cacheKey(sid));
    localStorage.removeItem(backupKey(sid));
    return;
  }

  const existing = readEmployeesCache(sid);
  if (existing.length > 0) {
    localStorage.setItem(backupKey(sid), JSON.stringify(existing));
  }
  localStorage.setItem(cacheKey(sid), JSON.stringify(employees));
}
