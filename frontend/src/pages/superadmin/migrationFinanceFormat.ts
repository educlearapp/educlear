/** Local display helper — mirrors backend cents formatting for UI. */
export function formatRandFromCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const withSep = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}R${withSep}.${frac}`;
}
