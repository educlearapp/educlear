import { apiFetch } from "./api";

export type AdminEmployee = Record<string, unknown>;

const CACHE_KEY = "educlearEmployees";
const BACKUP_KEY = "educlearEmployees_backup";
const SELECTED_EMPLOYEE_KEY = "selectedEmployeeForManage";

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

/** Map Administration UI employee → backend Employee payload. */
export function adminEmployeeToApiPayload(
  employee: AdminEmployee,
  schoolId: string
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

  return {
    schoolId,
    firstName,
    lastName,
    email: String(employee.email || "").trim() || null,
    idNumber: String(employee.idNumber || "").trim() || null,
    mobileNumber: String(employee.cell || employee.mobileNumber || "").trim() || null,
    jobTitle: String(employee.occupation || employee.jobTitle || "").trim() || null,
    employeeNumber: String(employee.employeeNumber || "").trim() || null,
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

  const unsyncedLocal = localEmployees.filter((employee) => {
    if (backendEmployees.some((backendEmployee) => namesMatch(employee, backendEmployee))) {
      return false;
    }

    const id = String(employee.id || "").trim();
    if (!id) return true;
    if (isLocalOnlyEmployee(employee)) return true;
    return !backendIds.has(id);
  });

  return dedupeEmployees([...backendEmployees, ...unsyncedLocal]);
}

export function collectRecoverableLocalEmployees(): AdminEmployee[] {
  const combined = [
    ...readEmployeesCache(),
    ...readEmployeesBackup(),
    ...readSelectedEmployeeForManage(),
  ];
  return dedupeEmployees(combined);
}

export function readSelectedEmployeeForManage(): AdminEmployee[] {
  try {
    const raw = localStorage.getItem(SELECTED_EMPLOYEE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? [parsed as AdminEmployee] : [];
  } catch {
    return [];
  }
}

export type EmployeesLoadResult = {
  employees: AdminEmployee[];
  needsSync: boolean;
  unsyncedLocalCount: number;
  canRestoreFromBackup: boolean;
  backupCount: number;
};

export async function loadEmployeesForSchool(schoolId: string): Promise<EmployeesLoadResult> {
  const cached = readEmployeesCache();
  const backup = readEmployeesBackup();
  const recoverable = collectRecoverableLocalEmployees();

  let backend: AdminEmployee[] = [];
  try {
    backend = await fetchSchoolEmployees(schoolId);
  } catch {
    const fallback = recoverable.length ? recoverable : cached.length ? cached : backup;
    return {
      employees: dedupeEmployees(fallback),
      needsSync: dedupeEmployees(fallback).some(isLocalOnlyEmployee),
      unsyncedLocalCount: dedupeEmployees(fallback).filter(isLocalOnlyEmployee).length,
      canRestoreFromBackup: cached.length === 0 && backup.length > 0,
      backupCount: backup.length,
    };
  }

  if (backend.length === 0 && recoverable.length > 0) {
    return {
      employees: recoverable,
      needsSync: true,
      unsyncedLocalCount: recoverable.filter(isLocalOnlyEmployee).length,
      canRestoreFromBackup: cached.length === 0 && backup.length > 0,
      backupCount: backup.length,
    };
  }

  const merged = mergeEmployees(backend, recoverable);
  writeEmployeesCache(merged);

  return {
    employees: merged,
    needsSync: merged.some(isLocalOnlyEmployee),
    unsyncedLocalCount: merged.filter(isLocalOnlyEmployee).length,
    canRestoreFromBackup: cached.length === 0 && backup.length > 0,
    backupCount: backup.length,
  };
}

/** Reload employees from backend and refresh local cache (source of truth after save/refresh). */
export async function reloadEmployeesFromBackend(schoolId: string): Promise<AdminEmployee[]> {
  const backend = await fetchSchoolEmployees(schoolId);
  if (backend.length > 0) {
    writeEmployeesCache(backend);
  }
  return backend;
}

export async function createSchoolEmployee(
  schoolId: string,
  employee: AdminEmployee
): Promise<AdminEmployee> {
  const payload = adminEmployeeToApiPayload(employee, schoolId);
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
  employee: AdminEmployee
): Promise<AdminEmployee> {
  if (isServerEmployeeId(employee.id)) {
    return updateSchoolEmployee(schoolId, employee);
  }
  return createSchoolEmployee(schoolId, employee);
}

export async function deleteSchoolEmployee(schoolId: string, employeeId: string): Promise<void> {
  await apiFetch(
    `/api/payroll/employee/${encodeURIComponent(employeeId)}?schoolId=${encodeURIComponent(schoolId)}`,
    { method: "DELETE" }
  );
}

export function removeEmployeeFromCache(employeeId: string): AdminEmployee[] {
  const id = String(employeeId || "").trim();
  const updated = readEmployeesCache().filter((e) => String(e.id || "").trim() !== id);
  writeEmployeesCache(updated);
  return updated;
}

export type RestoreLocalEmployeesResult = {
  restored: number;
  failed: number;
  errors: string[];
};

export async function refreshEmployeesCacheFromBackend(
  schoolId: string
): Promise<AdminEmployee[]> {
  const backend = await fetchSchoolEmployees(schoolId);
  if (backend.length > 0) {
    writeEmployeesCache(backend);
  }
  return backend;
}

export async function restoreLocalEmployeesToBackend(
  schoolId: string,
  employees?: AdminEmployee[]
): Promise<RestoreLocalEmployeesResult> {
  const source = employees ?? collectRecoverableLocalEmployees();
  const candidates = dedupeEmployees(source).filter((employee) => {
    const firstName = String(employee.firstName || "").trim();
    const surname = String(employee.surname || employee.lastName || "").trim();
    return Boolean(firstName && surname);
  });

  let restored = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const employee of candidates) {
    const label =
      `${String(employee.firstName || "").trim()} ${String(employee.surname || employee.lastName || "").trim()}`.trim() ||
      "Employee";

    try {
      if (isServerEmployeeId(employee.id)) {
        await updateSchoolEmployee(schoolId, employee);
      } else {
        await createSchoolEmployee(schoolId, employee);
      }
      restored += 1;
    } catch (e: unknown) {
      failed += 1;
      const message = e instanceof Error ? e.message : "Restore failed";
      errors.push(`${label}: ${message}`);
    }
  }

  return { restored, failed, errors };
}

export function readEmployeesCache(): AdminEmployee[] {
  return parseEmployeeList(localStorage.getItem(CACHE_KEY));
}

export function readEmployeesBackup(): AdminEmployee[] {
  return parseEmployeeList(localStorage.getItem(BACKUP_KEY));
}

export function restoreEmployeesFromBackupToCache(): AdminEmployee[] {
  const backup = readEmployeesBackup();
  if (!backup.length) return [];
  writeEmployeesCache(backup);
  return backup;
}

export function writeEmployeesCache(employees: AdminEmployee[]): void {
  const existing = readEmployeesCache();
  if (existing.length > 0) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(existing));
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(employees));
}
