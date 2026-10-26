/**
 * Readable South African local date/time for parent–teacher message bubbles.
 * Preserves the original ISO timestamp; formatting only.
 */
export function formatParentMessageDateTime(iso: string | Date | null | undefined): string {
  if (iso == null || iso === "") return "";
  const d = iso instanceof Date ? iso : new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
