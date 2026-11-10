/**
 * Node/undici reject HTTP header values containing non-ASCII (and many CTL chars).
 * Use for custom response headers only — PDF/body content may keep human typography.
 */

const NON_ASCII_OR_CTL = /[^\t\x20-\x7E]/g;

/** Replace non-ASCII / control characters so setHeader never throws. */
export function toAsciiHttpHeaderValue(value: unknown, fallback = ""): string {
  const raw = String(value ?? "");
  const cleaned = raw.replace(NON_ASCII_OR_CTL, (ch) => {
    // Common typography that appears in EduClear period labels / notes.
    if (ch === "\u2013" || ch === "\u2014" || ch === "\u2212") return "-"; // en/em/minus dash
    if (ch === "\u2018" || ch === "\u2019") return "'";
    if (ch === "\u201C" || ch === "\u201D") return '"';
    if (ch === "\u00A0") return " ";
    return "";
  });
  const collapsed = cleaned.replace(/\s+/g, " ").trim();
  return collapsed || fallback;
}

export function assertAsciiHttpHeaderValue(value: string): void {
  if (NON_ASCII_OR_CTL.test(value)) {
    throw new Error(`Header value is not ASCII-safe: ${JSON.stringify(value)}`);
  }
}
