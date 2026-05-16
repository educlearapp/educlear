export function getBirthDateFromSouthAfricanId(idNumber: string): string {
  const clean = String(idNumber || "").replace(/\D/g, "");
  if (clean.length < 6) return "";

  const yy = Number(clean.slice(0, 2));
  const mm = Number(clean.slice(2, 4));
  const dd = Number(clean.slice(4, 6));

  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return "";
  if (mm < 1 || mm > 12) return "";
  if (dd < 1 || dd > 31) return "";

  const currentYear = new Date().getFullYear();
  const currentYY = currentYear % 100;
  const fullYear = yy <= currentYY ? 2000 + yy : 1900 + yy;

  const testDate = new Date(fullYear, mm - 1, dd);
  if (
    testDate.getFullYear() !== fullYear ||
    testDate.getMonth() !== mm - 1 ||
    testDate.getDate() !== dd
  ) {
    return "";
  }

  return `${fullYear}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function normaliseDateForInput(value: any): string {
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

export function calculateLearnerAge(value: any): string {
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

export function getLearnerAccountNo(learner: any): string {
  const account =
    learner?.familyAccount?.accountRef ||
    learner?.accountNo ||
    learner?.accountNumber ||
    "";
  const trimmed = String(account || "").trim();
  return trimmed || "-";
}
