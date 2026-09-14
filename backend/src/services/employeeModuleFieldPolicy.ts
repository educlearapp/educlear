/**
 * Employee field policy for EduClear Core vs optional PAYROLL module.
 *
 * CORE keeps staff administration + EduClock linkage.
 * PAYROLL covers remuneration, tax, allowances/deductions, and payslip bank details.
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

export type PayrollFieldViolation = {
  fields: string[];
  code: typeof MODULE_NOT_ENTITLED;
  module: "PAYROLL";
  error: string;
};

/** Body keys that attempt to set payroll-only fields (including aliases). */
export function findPayrollMutationFields(body: Record<string, unknown> | null | undefined): string[] {
  if (!body || typeof body !== "object") return [];
  const found = new Set<string>();
  for (const key of Object.keys(body)) {
    if (PAYROLL_FIELD_SET.has(key)) found.add(key);
  }
  // Frontend alias for bankAccountNumber
  if (Object.prototype.hasOwnProperty.call(body, "bankAccount")) {
    found.add("bankAccountNumber");
  }
  // Explicit payrollEnabled is a payroll UI concept mapped to isActive — allow isActive via Core;
  // reject only if client sends payrollEnabled as a distinct payroll config key alongside salary fields.
  if (Object.prototype.hasOwnProperty.call(body, "payrollEnabled")) {
    // payrollEnabled alone maps to isActive (Core). Do not treat as payroll-only.
  }
  return [...found].sort();
}

export function assertNoPayrollMutationWhenDisabled(
  body: Record<string, unknown>,
  payrollEnabled: boolean
): PayrollFieldViolation | null {
  if (payrollEnabled) return null;
  const fields = findPayrollMutationFields(body);
  if (!fields.length) return null;
  return {
    fields,
    code: MODULE_NOT_ENTITLED,
    module: "PAYROLL",
    error:
      "Payroll-specific employee fields cannot be set while the PAYROLL module is disabled for this school",
  };
}

export function sanitizeEmployeeForModule<T extends Record<string, unknown>>(
  employee: T,
  payrollEnabled: boolean
): Partial<T> {
  if (payrollEnabled) return { ...employee };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(employee)) {
    if (PAYROLL_FIELD_SET.has(key)) continue;
    // Keep unknown non-payroll keys that are not in PAYROLL set (relations stripped separately)
    if (CORE_FIELD_SET.has(key) || !PAYROLL_FIELD_SET.has(key)) {
      if (key === "payrollRunEmployees" || key === "payslips" || key === "school") continue;
      if (key.startsWith("eduClock") || key.startsWith("payrollEduClock")) continue;
      if (key === "user") continue;
      out[key] = value;
    }
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

/** Strip payroll keys from create/update data object when PAYROLL is off (defence in depth). */
export function stripPayrollFieldsFromWriteData<T extends Record<string, unknown>>(
  data: T,
  payrollEnabled: boolean
): T {
  if (payrollEnabled) return data;
  const out: Record<string, unknown> = { ...data };
  for (const key of PAYROLL_EMPLOYEE_API_FIELDS) {
    delete out[key];
  }
  return out as T;
}
