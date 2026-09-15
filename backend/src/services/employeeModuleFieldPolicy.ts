/**
 * Employee field policy for EduClear Core vs optional PAYROLL module.
 *
 * CORE keeps staff administration + EduClock linkage.
 * PAYROLL covers remuneration, tax, allowances/deductions, and payslip bank details.
 *
 * Phase 6E.1: fail-closed allowlists — unknown fields are NOT exposed or writable
 * merely because they are unclassified.
 */
import { MODULE_NOT_ENTITLED } from "../middleware/requireSchoolModule";
import { isSchoolModuleEnabled } from "./schoolModuleEntitlements";

/** Staff/HR/EduClock identity — available when PAYROLL is off. */
export const CORE_EMPLOYEE_API_FIELDS = [
  "id",
  "schoolId",
  "employeeNumber",
  "firstName",
  "lastName",
  "fullName",
  "idNumber",
  "identityType",
  "identityCountryCode",
  "dateOfBirth",
  "gender",
  "mobileNumber",
  "email",
  "physicalAddress",
  "jobTitle",
  "department",
  "employmentType",
  "startDate",
  "endDate",
  /** Active staff flag (EduClock / admin). Frontend may label this payrollEnabled. */
  "isActive",
  "notes",
  "userId",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Remuneration / tax / payslip banking — PAYROLL module only.
 * Classified from Prisma Employee model + buildEmployeeData usage (not name-guessing alone).
 */
export const PAYROLL_EMPLOYEE_API_FIELDS = [
  "salaryType",
  "payFrequency",
  "paymentMethod",
  "taxNumber",
  "uifApplicable",
  "incomeTaxApplicable",
  "basicSalary",
  "hourlyRate",
  "overtimeRate",
  "overtimeHours",
  "fixedHousingAllowance",
  "fixedTransportAllowance",
  "fixedCellphoneAllowance",
  "fixedOtherAllowance",
  "fixedPension",
  "fixedMedicalAid",
  "fixedStaffLoan",
  "fixedStaffAdvance",
  "fixedOtherDeduction",
  "employeeMedicalAid",
  "employerMedicalAid",
  "employeePension",
  "employerPension",
  "bankAccountHolder",
  "bankName",
  "bankAccountNumber",
  "bankBranchCode",
  "payslipDeliveryPreference",
  "sendPayslipByEmail",
] as const;

const PAYROLL_FIELD_SET = new Set<string>(PAYROLL_EMPLOYEE_API_FIELDS);
const CORE_FIELD_SET = new Set<string>(CORE_EMPLOYEE_API_FIELDS);
const ALLOWED_RELATION_STRIP = new Set([
  "payrollRunEmployees",
  "payslips",
  "school",
  "user",
]);

/** Write aliases that map onto known fields (not independent columns). */
const WRITE_ALIASES: Record<string, string> = {
  bankAccount: "bankAccountNumber",
};

/** Non-persisted client keys allowed on writes (mapped / ignored safely). */
const WRITE_PASSTHROUGH_KEYS = new Set(["payrollEnabled"]);

export type PayrollFieldViolation = {
  fields: string[];
  code: typeof MODULE_NOT_ENTITLED;
  module: "PAYROLL";
  error: string;
};

function canonicalWriteKey(key: string): string {
  return WRITE_ALIASES[key] || key;
}

function isAllowedEmployeeApiField(key: string, payrollEnabled: boolean): boolean {
  if (CORE_FIELD_SET.has(key)) return true;
  if (payrollEnabled && PAYROLL_FIELD_SET.has(key)) return true;
  return false;
}

/** Body keys that attempt to set payroll-only fields (including aliases). */
export function findPayrollMutationFields(body: Record<string, unknown> | null | undefined): string[] {
  if (!body || typeof body !== "object") return [];
  const found = new Set<string>();
  for (const key of Object.keys(body)) {
    const canonical = canonicalWriteKey(key);
    if (PAYROLL_FIELD_SET.has(canonical)) found.add(canonical);
  }
  return [...found].sort();
}

/**
 * Fail-closed write policy: only CORE (+ PAYROLL when enabled) fields may be set.
 * Unknown keys are rejected so future columns do not auto-become writable.
 */
export function findDisallowedEmployeeMutationFields(
  body: Record<string, unknown> | null | undefined,
  payrollEnabled: boolean
): string[] {
  if (!body || typeof body !== "object") return [];
  const found = new Set<string>();
  for (const key of Object.keys(body)) {
    if (WRITE_PASSTHROUGH_KEYS.has(key)) continue;
    const canonical = canonicalWriteKey(key);
    if (isAllowedEmployeeApiField(canonical, payrollEnabled)) continue;
    found.add(key);
  }
  return [...found].sort();
}

export function assertNoPayrollMutationWhenDisabled(
  body: Record<string, unknown>,
  payrollEnabled: boolean
): PayrollFieldViolation | null {
  const fields = findDisallowedEmployeeMutationFields(body, payrollEnabled);
  if (!fields.length) return null;
  const payrollOnly = fields.filter((f) => PAYROLL_FIELD_SET.has(canonicalWriteKey(f)));
  return {
    fields,
    code: MODULE_NOT_ENTITLED,
    module: "PAYROLL",
    error: payrollOnly.length
      ? "Payroll-specific employee fields cannot be set while the PAYROLL module is disabled for this school"
      : "Unrecognized employee fields cannot be set for this school's module entitlements",
  };
}

/**
 * Fail-closed read sanitizer.
 * - PAYROLL off → CORE allowlist only
 * - PAYROLL on → CORE ∪ PAYROLL allowlist only
 * Unknown/synthetic fields are never passed through.
 */
export function sanitizeEmployeeForModule<T extends Record<string, unknown>>(
  employee: T,
  payrollEnabled: boolean
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(employee)) {
    if (ALLOWED_RELATION_STRIP.has(key)) continue;
    if (key.startsWith("eduClock") || key.startsWith("payrollEduClock")) continue;
    if (!isAllowedEmployeeApiField(key, payrollEnabled)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

export function sanitizeEmployeesForModule<T extends Record<string, unknown>>(
  employees: T[],
  payrollEnabled: boolean
): Array<Partial<T>> {
  return employees.map((row) => sanitizeEmployeeForModule(row, payrollEnabled));
}

export async function resolvePayrollModuleEnabled(schoolId: string): Promise<boolean> {
  return isSchoolModuleEnabled(schoolId, "PAYROLL");
}

/** Strip disallowed keys from create/update data (defence in depth). */
export function stripPayrollFieldsFromWriteData<T extends Record<string, unknown>>(
  data: T,
  payrollEnabled: boolean
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (WRITE_PASSTHROUGH_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    const canonical = canonicalWriteKey(key);
    if (!isAllowedEmployeeApiField(canonical, payrollEnabled)) continue;
    out[key] = value;
  }
  return out as T;
}
