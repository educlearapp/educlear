export function resolveLearnerAccountNo(learner: {
  familyAccount?: { accountRef?: string | null } | null;
  accountNo?: string | null;
  accountNumber?: string | null;
} | null | undefined): string {
  if (!learner) return "";
  return (
    String(learner.familyAccount?.accountRef || "").trim() ||
    String(learner.accountNo || learner.accountNumber || "").trim() ||
    ""
  );
}

export function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getSurnamePrefix(surname: string): string {
  const parts = cleanString(surname).toUpperCase().split(/\s+/).filter(Boolean);
  const lastWord = parts[parts.length - 1] || "ACC";
  return lastWord.replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "X");
}

export function normaliseDateForInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const d = new Date(raw.includes("/") ? raw.replace(/\//g, "-") : raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function calculateLearnerAge(value: unknown): string {
  const birthDate = normaliseDateForInput(value);
  if (!birthDate) return "-";

  const dob = new Date(birthDate);
  const today = new Date();
  if (Number.isNaN(dob.getTime())) return "-";

  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();

  if (months < 0 || (months === 0 && today.getDate() < dob.getDate())) {
    years -= 1;
    months += 12;
  }
  if (today.getDate() < dob.getDate()) {
    months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
  }

  if (years < 0) return "-";
  if (years <= 0) return `${months} months`;
  return `${years} years${months > 0 ? ` and ${months} months` : ""}`;
}
