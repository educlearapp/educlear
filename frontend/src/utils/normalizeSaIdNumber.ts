/** Strip spaces, dashes, and non-digits — matches backend fee-check normalization. */
export function normalizeSaIdNumber(value: unknown): string {
  return String(value ?? "").trim().replace(/\D/g, "");
}
