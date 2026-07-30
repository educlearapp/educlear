/**
 * EduClock identity-document verification helpers.
 * Never log or return raw identity numbers from this module's public API surface
 * without going through maskIdentityNumber first.
 */
import {
  normalizeSaIdDigits,
  validateSouthAfricanIdNumber,
} from "../utils/saIdValidation";

export const EMPLOYEE_IDENTITY_TYPES = ["SA_ID", "PASSPORT", "PERMIT", "OTHER"] as const;
export type EmployeeIdentityTypeValue = (typeof EMPLOYEE_IDENTITY_TYPES)[number];

export type IdentityValidationResult =
  | { valid: true; normalized: string; identityType: EmployeeIdentityTypeValue; countryCode: string | null }
  | { valid: false; errorCode: "EDUCLOCK_IDENTITY_REQUIRED" | "EDUCLOCK_IDENTITY_INVALID" };

/** Mask for display/API — show last 3 characters only (e.g. **********082). */
export function maskIdentityNumber(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const visible = raw.slice(-3);
  const stars = Math.max(raw.length - 3, 0);
  return `${"*".repeat(stars)}${visible}`;
}

export function isMaskedIdentityPlaceholder(value: unknown): boolean {
  const s = String(value ?? "");
  return s.includes("*");
}

export function parseIdentityType(value: unknown): EmployeeIdentityTypeValue | null {
  const t = String(value ?? "").trim().toUpperCase();
  if ((EMPLOYEE_IDENTITY_TYPES as readonly string[]).includes(t)) {
    return t as EmployeeIdentityTypeValue;
  }
  return null;
}

export function normalizeCountryCode(value: unknown): string | null {
  const c = String(value ?? "").trim().toUpperCase();
  if (!c) return null;
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return c;
}

/** Normalize for equality comparison — never log the result in callers. */
export function normalizeIdentityForComparison(
  identityType: EmployeeIdentityTypeValue,
  identityNumber: unknown,
  identityCountryCode?: unknown
): { normalized: string; countryCode: string | null } | null {
  const raw = String(identityNumber ?? "").trim();
  if (!raw) return null;

  if (identityType === "SA_ID") {
    const digits = normalizeSaIdDigits(raw);
    if (!digits) return null;
    return { normalized: digits, countryCode: "ZA" };
  }

  const country = normalizeCountryCode(identityCountryCode);
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (!compact) return null;
  return { normalized: compact, countryCode: country };
}

export function validateIdentityInput(input: {
  identityType: unknown;
  identityNumber: unknown;
  identityCountryCode?: unknown;
}): IdentityValidationResult {
  const identityType = parseIdentityType(input.identityType);
  if (!identityType) {
    return { valid: false, errorCode: "EDUCLOCK_IDENTITY_INVALID" };
  }

  const rawNumber = String(input.identityNumber ?? "").trim();
  if (!rawNumber) {
    return { valid: false, errorCode: "EDUCLOCK_IDENTITY_REQUIRED" };
  }

  if (identityType === "SA_ID") {
    const check = validateSouthAfricanIdNumber(rawNumber);
    if (!check.valid) {
      return { valid: false, errorCode: "EDUCLOCK_IDENTITY_INVALID" };
    }
    const digits = normalizeSaIdDigits(rawNumber);
    return {
      valid: true,
      normalized: digits,
      identityType,
      countryCode: "ZA",
    };
  }

  if (identityType === "PASSPORT" || identityType === "PERMIT") {
    const country = normalizeCountryCode(input.identityCountryCode);
    if (!country) {
      return { valid: false, errorCode: "EDUCLOCK_IDENTITY_INVALID" };
    }
    const compact = rawNumber.replace(/\s+/g, "").toUpperCase();
    if (compact.length < 4 || compact.length > 32) {
      return { valid: false, errorCode: "EDUCLOCK_IDENTITY_INVALID" };
    }
    if (!/^[A-Z0-9\-_/]+$/i.test(compact)) {
      return { valid: false, errorCode: "EDUCLOCK_IDENTITY_INVALID" };
    }
    return {
      valid: true,
      normalized: compact.toUpperCase(),
      identityType,
      countryCode: country,
    };
  }

  // OTHER
  const compact = rawNumber.replace(/\s+/g, "").toUpperCase();
  if (compact.length < 3 || compact.length > 64) {
    return { valid: false, errorCode: "EDUCLOCK_IDENTITY_INVALID" };
  }
  const country = normalizeCountryCode(input.identityCountryCode);
  return {
    valid: true,
    normalized: compact,
    identityType,
    countryCode: country,
  };
}

/**
 * Compare submitted identity to a stored Employee.idNumber (+ type/country).
 * Does not reveal which field mismatched.
 */
export function identityEqualsStored(input: {
  submittedType: EmployeeIdentityTypeValue;
  submittedNormalized: string;
  submittedCountry: string | null;
  storedIdNumber: string | null | undefined;
  storedIdentityType: EmployeeIdentityTypeValue | null | undefined;
  storedCountryCode: string | null | undefined;
}): boolean {
  if (!input.storedIdNumber) return false;

  let effectiveType: EmployeeIdentityTypeValue = input.storedIdentityType || "SA_ID";
  if (!input.storedIdentityType) {
    const digits = normalizeSaIdDigits(input.storedIdNumber);
    if (digits.length === 13 && validateSouthAfricanIdNumber(digits).valid) {
      effectiveType = "SA_ID";
    } else {
      effectiveType = "OTHER";
    }
  }

  if (effectiveType !== input.submittedType) return false;

  const stored = normalizeIdentityForComparison(
    effectiveType,
    input.storedIdNumber,
    input.storedCountryCode || (effectiveType === "SA_ID" ? "ZA" : null)
  );
  if (!stored) return false;

  if (stored.normalized !== input.submittedNormalized) return false;

  if (input.submittedType === "PASSPORT" || input.submittedType === "PERMIT") {
    return stored.countryCode === input.submittedCountry;
  }

  return true;
}

/** Public employee payload: idNumber always masked when present. */
export function sanitizeEmployeeIdentityFields<T extends Record<string, unknown>>(employee: T): T {
  const next = { ...employee };
  if ("idNumber" in next) {
    const raw = next.idNumber;
    (next as Record<string, unknown>).idNumberMasked = maskIdentityNumber(raw);
    (next as Record<string, unknown>).idNumber = maskIdentityNumber(raw) || null;
    (next as Record<string, unknown>).hasIdentityDocument = Boolean(String(raw ?? "").trim());
  }
  return next;
}
