import { apiFetch } from "./api";

export type AdminEmployee = Record<string, unknown>;

const CACHE_KEY = "educlearEmployees";

function num(v: unknown, fallback = 0): number {
  const n = Number(v === undefined || v === null || v === "" ? fallback : v);
  return Number.isFinite(n) ? n : fallback;
}

function isServerEmployeeId(id: unknown): boolean {
  const s = String(id || "").trim();
  return s.length >= 20 && !s.startsWith("employee-");
}

/** Map backend Employee row → Administration UI shape. */
export function apiEmployeeToAdmin(emp: Record<string, unknown>): AdminEmployee {
  const employmentDate = emp.startDate ? String(emp.startDate).slice(0, 10) : "";

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
    basicSalary: emp.basicSalary ?? "",
    taxNumber: emp.taxNumber || "",
    uifNumber: "",
    bankName: emp.bankName || "",
    bankAccount: emp.bankAccountNumber || "",
    branchCode: emp.bankBranchCode || "",
    address1: emp.physicalAddress || "",
    address2: "",
    city: "",
    province: "",
    postalCode: "",
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
    basicSalary: num(employee.basicSalary),
    taxNumber: String(employee.taxNumber || "").trim() || null,
    bankName: String(employee.bankName || "").trim() || null,
    bankAccountNumber: String(employee.bankAccount || employee.bankAccountNumber || "").trim() || null,
    bankBranchCode: String(employee.branchCode || employee.bankBranchCode || "").trim() || null,
    physicalAddress,
    notes: String(employee.notes || "").trim() || null,
    isActive: employee.payrollEnabled !== false,
    startDate: employee.employmentDate ? String(employee.employmentDate) : null,
  };
}

export async function fetchSchoolEmployees(schoolId: string): Promise<AdminEmployee[]> {
  const data = await apiFetch(`/api/payroll/employees/${encodeURIComponent(schoolId)}`);
  if (!Array.isArray(data)) return [];
  return data.map((row) => apiEmployeeToAdmin(row as Record<string, unknown>));
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

export function readEmployeesCache(): AdminEmployee[] {
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function writeEmployeesCache(employees: AdminEmployee[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(employees));
}
