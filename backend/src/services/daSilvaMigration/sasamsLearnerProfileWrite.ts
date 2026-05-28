import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { normalizeLearnerGender, resolveLearnerGender } from "../../utils/learnerGender";
import type { SasamsParsedLearner } from "./sasamsParsers";

export type SasamsLearnerProfileFields = {
  admissionNo: string | null;
  idNumber: string | null;
  birthDate: Date | null;
  gender: string | null;
  homeLanguage: string | null;
  citizenship: string | null;
};

export type SasamsRegisterLookupIndexes = {
  byAdmission: Map<string, SasamsParsedLearner>;
  byId: Map<string, SasamsParsedLearner>;
  byNormName: Map<string, SasamsParsedLearner[]>;
  byNormNameDob: Map<string, SasamsParsedLearner>;
  byMatchKey: Map<string, SasamsParsedLearner>;
};

function digitsOnly(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

function hasText(value: unknown): boolean {
  return Boolean(String(value ?? "").trim());
}

export function normSasamsLearnerNameKey(firstName: string, lastName: string): string {
  return normalizeMatchText(`${firstName} ${lastName}`.trim());
}

export function normSasamsLearnerNameDobKey(
  firstName: string,
  lastName: string,
  birthDate: Date | null | undefined
): string | null {
  if (!birthDate || Number.isNaN(birthDate.getTime())) return null;
  return `${normSasamsLearnerNameKey(firstName, lastName)}|${birthDate.toISOString().slice(0, 10)}`;
}

function pickBestRegisterCandidate(rows: SasamsParsedLearner[]): SasamsParsedLearner {
  return [...rows].sort((a, b) => registerProfileScore(b) - registerProfileScore(a))[0];
}

function registerProfileScore(row: SasamsParsedLearner): number {
  let score = 0;
  if (row.birthDate) score += 4;
  if (hasText(row.gender)) score += 4;
  if (hasText(row.idNumber)) score += 2;
  if (hasText(row.language)) score += 1;
  if (hasText(row.citizenship)) score += 1;
  if (hasText(row.admissionNo)) score += 1;
  return score;
}

export function buildSasamsRegisterLookupIndexes(
  registerLearners: SasamsParsedLearner[]
): SasamsRegisterLookupIndexes {
  const byAdmission = new Map<string, SasamsParsedLearner>();
  const byId = new Map<string, SasamsParsedLearner>();
  const byNormName = new Map<string, SasamsParsedLearner[]>();
  const byNormNameDob = new Map<string, SasamsParsedLearner>();
  const byMatchKey = new Map<string, SasamsParsedLearner>();

  for (const row of registerLearners) {
    if (row.admissionNo) {
      byAdmission.set(normalizeMatchText(row.admissionNo), row);
      const admDigits = digitsOnly(row.admissionNo);
      if (admDigits.length >= 6) byId.set(normalizeMatchText(admDigits), row);
    }
    if (row.sasamsLearnerNo && row.sasamsLearnerNo !== row.admissionNo) {
      byAdmission.set(normalizeMatchText(row.sasamsLearnerNo), row);
    }
    if (row.idNumber) {
      const idDigits = digitsOnly(row.idNumber);
      if (idDigits.length >= 6) byId.set(normalizeMatchText(idDigits), row);
    }

    const nameKey = normSasamsLearnerNameKey(row.firstName, row.lastName);
    const nameList = byNormName.get(nameKey) || [];
    nameList.push(row);
    byNormName.set(nameKey, nameList);

    const dobKey = normSasamsLearnerNameDobKey(row.firstName, row.lastName, row.birthDate);
    if (dobKey && !byNormNameDob.has(dobKey)) {
      byNormNameDob.set(dobKey, row);
    }

    byMatchKey.set(row.matchKey, row);
  }

  return { byAdmission, byId, byNormName, byNormNameDob, byMatchKey };
}

/**
 * Match a class-list learner to learner_register by:
 * ID number → admission/accession number → name+surname → name+surname+DOB.
 */
export function lookupSasamsRegisterForClassLearner(
  fromClass: SasamsParsedLearner,
  indexes: SasamsRegisterLookupIndexes
): SasamsParsedLearner | null {
  const classIdDigits = digitsOnly(fromClass.idNumber);
  if (classIdDigits.length >= 6) {
    const byClassId = indexes.byId.get(normalizeMatchText(classIdDigits));
    if (byClassId) return byClassId;
  }

  const classAdmDigits = digitsOnly(fromClass.admissionNo);
  if (classAdmDigits.length >= 6) {
    const byAdmAsId = indexes.byId.get(normalizeMatchText(classAdmDigits));
    if (byAdmAsId) return byAdmAsId;
  }

  if (fromClass.admissionNo) {
    const byAdmission = indexes.byAdmission.get(normalizeMatchText(fromClass.admissionNo));
    if (byAdmission) return byAdmission;
  }
  if (fromClass.sasamsLearnerNo) {
    const byAccession = indexes.byAdmission.get(normalizeMatchText(fromClass.sasamsLearnerNo));
    if (byAccession) return byAccession;
  }

  const nameKey = normSasamsLearnerNameKey(fromClass.firstName, fromClass.lastName);
  const dobKeyFromClass = normSasamsLearnerNameDobKey(
    fromClass.firstName,
    fromClass.lastName,
    fromClass.birthDate
  );
  if (dobKeyFromClass) {
    const byNameDob = indexes.byNormNameDob.get(dobKeyFromClass);
    if (byNameDob) return byNameDob;
  }

  const nameHits = indexes.byNormName.get(nameKey);
  if (nameHits?.length === 1) return nameHits[0];
  if (nameHits && nameHits.length > 1) {
    if (classIdDigits.length >= 6) {
      const narrowed = nameHits.find(
        (r) => digitsOnly(r.idNumber) === classIdDigits
      );
      if (narrowed) return narrowed;
    }
    if (fromClass.admissionNo) {
      const admKey = normalizeMatchText(fromClass.admissionNo);
      const narrowed = nameHits.find(
        (r) =>
          (r.admissionNo && normalizeMatchText(r.admissionNo) === admKey) ||
          (r.sasamsLearnerNo && normalizeMatchText(r.sasamsLearnerNo) === admKey)
      );
      if (narrowed) return narrowed;
    }
    return pickBestRegisterCandidate(nameHits);
  }

  if (fromClass.idNumber) {
    const byId = indexes.byId.get(normalizeMatchText(fromClass.idNumber));
    if (byId) return byId;
  }

  return indexes.byMatchKey.get(fromClass.matchKey) ?? null;
}

export function sasamsParsedToProfileFields(row: SasamsParsedLearner): SasamsLearnerProfileFields {
  return {
    admissionNo: row.admissionNo,
    idNumber: row.idNumber,
    birthDate: row.birthDate,
    gender: resolveLearnerGender({ gender: row.gender, idNumber: row.idNumber }),
    homeLanguage: row.language,
    citizenship: row.citizenship,
  };
}

function pickString(
  incoming: string | null | undefined,
  existing: string | null | undefined
): string | undefined {
  const inc = String(incoming ?? "").trim();
  if (!inc) return undefined;
  const cur = String(existing ?? "").trim();
  if (cur === inc) return undefined;
  return inc;
}

function pickDate(
  incoming: Date | null | undefined,
  existing: Date | null | undefined
): Date | undefined {
  if (!incoming || Number.isNaN(incoming.getTime())) return undefined;
  if (existing && incoming.getTime() === existing.getTime()) return undefined;
  return incoming;
}

/** Build Prisma learner update payload — never overwrite a real value with blank. */
export function buildSasamsLearnerProfileWriteData(
  incoming: SasamsLearnerProfileFields,
  existing?: Partial<SasamsLearnerProfileFields>
): Partial<SasamsLearnerProfileFields> {
  const genderIncoming =
    normalizeLearnerGender(incoming.gender) ||
    resolveLearnerGender({ gender: incoming.gender, idNumber: incoming.idNumber });

  const data: Partial<SasamsLearnerProfileFields> = {};
  const admissionNo = pickString(incoming.admissionNo, existing?.admissionNo);
  if (admissionNo) data.admissionNo = admissionNo;
  const idNumber = pickString(incoming.idNumber, existing?.idNumber);
  if (idNumber) data.idNumber = idNumber;
  const homeLanguage = pickString(incoming.homeLanguage, existing?.homeLanguage);
  if (homeLanguage) data.homeLanguage = homeLanguage;
  const citizenship = pickString(incoming.citizenship, existing?.citizenship);
  if (citizenship) data.citizenship = citizenship;
  const gender = pickString(genderIncoming, existing?.gender);
  if (gender) data.gender = gender;
  const birthDate = pickDate(incoming.birthDate, existing?.birthDate ?? null);
  if (birthDate) data.birthDate = birthDate;
  return data;
}

export type SasamsProfileWriteCounts = {
  dobWritten: number;
  genderWritten: number;
  idNumbersWritten: number;
  homeLanguageWritten: number;
  citizenshipWritten: number;
};

export function countProfileFieldsWritten(
  data: Partial<SasamsLearnerProfileFields>
): SasamsProfileWriteCounts {
  return {
    dobWritten: data.birthDate ? 1 : 0,
    genderWritten: data.gender ? 1 : 0,
    idNumbersWritten: data.idNumber ? 1 : 0,
    homeLanguageWritten: data.homeLanguage ? 1 : 0,
    citizenshipWritten: data.citizenship ? 1 : 0,
  };
}

export function mergeProfileWriteCounts(
  a: SasamsProfileWriteCounts,
  b: SasamsProfileWriteCounts
): SasamsProfileWriteCounts {
  return {
    dobWritten: a.dobWritten + b.dobWritten,
    genderWritten: a.genderWritten + b.genderWritten,
    idNumbersWritten: a.idNumbersWritten + b.idNumbersWritten,
    homeLanguageWritten: a.homeLanguageWritten + b.homeLanguageWritten,
    citizenshipWritten: a.citizenshipWritten + b.citizenshipWritten,
  };
}
