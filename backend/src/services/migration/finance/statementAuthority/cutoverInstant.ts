/**
 * Normalize cutover to an explicit ISO instant to avoid date-only ambiguity.
 * Date-only values (YYYY-MM-DD) become end-of-day UTC on that calendar date.
 */

export function normalizeCutoverAt(raw: string | undefined | null): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T23:59:59.999Z`;
  }
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export function cutoverDateOnly(cutoverAt: string): string {
  return cutoverAt.slice(0, 10);
}

export function compareInstantToCutover(
  instantRaw: string | undefined | null,
  cutoverAt: string
): "before" | "same_day" | "after" | "unknown" {
  const instant = String(instantRaw || "").trim();
  if (!instant) return "unknown";
  const cutoverDay = cutoverDateOnly(cutoverAt);
  const instantDay = instant.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(instantDay) && instantDay === cutoverDay) {
    return "same_day";
  }
  const a = new Date(instant).getTime();
  const b = new Date(cutoverAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "unknown";
  if (a < b) return "before";
  if (a > b) return "after";
  return "same_day";
}
