/** South African ID validation: 13 digits, valid birth date, Luhn checksum. */

export function normalizeSaIdDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function maskSaIdNumber(value: unknown): string {
  const clean = normalizeSaIdDigits(value);
  if (!clean) return "";
  if (clean.length <= 4) return "*".repeat(clean.length);
  return `${"*".repeat(clean.length - 4)}${clean.slice(-4)}`;
}

function isValidSaIdBirthDate(yy: number, mm: number, dd: number): boolean {
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  const currentYear = new Date().getFullYear() % 100;
  const fullYear = yy <= currentYear ? 2000 + yy : 1900 + yy;
  const date = new Date(fullYear, mm - 1, dd);
  return (
    date.getFullYear() === fullYear &&
    date.getMonth() === mm - 1 &&
    date.getDate() === dd
  );
}

function passesSaIdChecksum(clean: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let digit = parseInt(clean[i]!, 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateSouthAfricanIdNumber(value: unknown): { valid: boolean; error?: string } {
  const clean = normalizeSaIdDigits(value);
  if (!clean) return { valid: true };
  if (clean.length !== 13) {
    return { valid: false, error: "ID number must be exactly 13 digits." };
  }
  const yy = parseInt(clean.slice(0, 2), 10);
  const mm = parseInt(clean.slice(2, 4), 10);
  const dd = parseInt(clean.slice(4, 6), 10);
  if (!isValidSaIdBirthDate(yy, mm, dd)) {
    return { valid: false, error: "ID number contains an invalid birth date." };
  }
  if (!passesSaIdChecksum(clean)) {
    return { valid: false, error: "ID number checksum is invalid." };
  }
  return { valid: true };
}
