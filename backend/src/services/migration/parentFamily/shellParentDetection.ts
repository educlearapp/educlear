/**
 * Shell / junk parent detection — never auto-create garbage Parent rows.
 */

export function isShellOrJunkParent(input: {
  firstName: string;
  surname: string;
  idNumber: string | null;
  cellNo: string | null;
  email: string | null;
  learnerName?: string | null;
}): { junk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const first = String(input.firstName || "").trim();
  const surname = String(input.surname || "").trim();
  const full = `${first} ${surname}`.trim().toLowerCase();
  const learner = String(input.learnerName || "").trim().toLowerCase();

  if (!first && !surname) {
    reasons.push("No parent name supplied.");
  }
  if (learner && full && full === learner) {
    reasons.push("Parent name equals learner name.");
  }
  if (/^(parent|mother|father|guardian|n\/a|na|none|unknown|test|xxx+)$/i.test(full)) {
    reasons.push("Generic placeholder parent name.");
  }
  const hasId = Boolean(input.idNumber);
  const hasCell = Boolean(input.cellNo);
  const hasEmail = Boolean(input.email);
  const hasSurname = Boolean(surname);
  if (!hasId && !hasCell && !hasEmail && (!hasSurname || first.length < 2)) {
    reasons.push("No adult identity or contact information.");
  }

  const junk =
    reasons.some((r) => /equals learner|Generic placeholder|No parent name/i.test(r)) ||
    (reasons.some((r) => /No adult identity/i.test(r)) && !hasSurname);

  return { junk, reasons };
}
