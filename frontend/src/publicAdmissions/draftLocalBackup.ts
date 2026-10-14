/**
 * Same-device backup of unsaved draft details for public admissions.
 *
 * Scoped to one school (publicSlug) and one draft (publicAccessId). Holds only typed form
 * text and tick-box selections that have not yet been confirmed by the server — never the
 * access token, identity numbers, documents, signatures or any uploaded attachment.
 * Cleared once the server confirms a save, on submission, and after expiry.
 */
import type {
  ApplicantAgreementSelections,
  DraftApplicationFormState,
  DraftGuardianFormRow,
} from "./publicAdmissionsTypes";

const STORAGE_PREFIX = "educlear.publicAdmissions.draftBackup.";
const BACKUP_VERSION = 1;
export const DRAFT_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export type DraftLocalBackup = {
  v: number;
  publicSlug: string;
  publicAccessId: string;
  savedAt: string;
  expiresAt: string;
  form: DraftApplicationFormState;
  agreements: ApplicantAgreementSelections;
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function normSlug(publicSlug: string): string {
  return String(publicSlug || "").trim().toLowerCase();
}

export function draftBackupStorageKey(publicSlug: string, publicAccessId: string): string {
  return `${STORAGE_PREFIX}${normSlug(publicSlug)}.${String(publicAccessId || "").trim()}`;
}

/** Removes identity numbers before anything is written to browser storage. */
export function stripSensitiveDraftFields(
  form: DraftApplicationFormState
): DraftApplicationFormState {
  return {
    ...form,
    learner: { ...form.learner, idNumber: "" },
    guardians: form.guardians.map((g) => ({ ...g, idNumber: "" })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseGuardian(raw: unknown, index: number): DraftGuardianFormRow | null {
  if (!isRecord(raw)) return null;
  return {
    clientKey: str(raw.clientKey) || `restored-${index}`,
    title: str(raw.title),
    firstName: str(raw.firstName),
    surname: str(raw.surname),
    relationship: str(raw.relationship),
    idNumber: "",
    cellNo: str(raw.cellNo),
    email: str(raw.email),
    homeAddress: str(raw.homeAddress),
    employer: str(raw.employer),
    isPrimary: raw.isPrimary === true,
    isPayingPerson: raw.isPayingPerson === true,
  };
}

function parseForm(raw: unknown): DraftApplicationFormState | null {
  if (!isRecord(raw) || !isRecord(raw.learner) || !Array.isArray(raw.guardians)) return null;
  const learner = raw.learner;
  const guardians = raw.guardians
    .map((g, i) => parseGuardian(g, i))
    .filter((g): g is DraftGuardianFormRow => g != null);
  if (!guardians.length) return null;
  const intakeYear = typeof raw.intakeYear === "number" && Number.isFinite(raw.intakeYear)
    ? raw.intakeYear
    : null;
  return {
    intakeYear,
    requestedGrade: str(raw.requestedGrade),
    learner: {
      firstName: str(learner.firstName),
      lastName: str(learner.lastName),
      birthDate: str(learner.birthDate),
      gender: str(learner.gender),
      idNumber: "",
      previousSchoolName: str(learner.previousSchoolName),
      homeAddress: str(learner.homeAddress),
      homeLanguage: str(learner.homeLanguage),
      citizenship: str(learner.citizenship),
    },
    guardians,
  };
}

export function emptyAgreementSelections(): ApplicantAgreementSelections {
  return {
    privacyAccepted: false,
    declarationsAccepted: false,
    financialPolicyAccepted: false,
    financialDeclarationAccepted: false,
    financialTypedName: "",
  };
}

function parseAgreements(raw: unknown): ApplicantAgreementSelections {
  if (!isRecord(raw)) return emptyAgreementSelections();
  return {
    privacyAccepted: raw.privacyAccepted === true,
    declarationsAccepted: raw.declarationsAccepted === true,
    financialPolicyAccepted: raw.financialPolicyAccepted === true,
    financialDeclarationAccepted: raw.financialDeclarationAccepted === true,
    financialTypedName: str(raw.financialTypedName),
  };
}

export function writeDraftBackup(
  input: {
    publicSlug: string;
    publicAccessId: string;
    form: DraftApplicationFormState;
    agreements: ApplicantAgreementSelections;
  },
  now: Date = new Date(),
  storage: StorageLike | null = defaultStorage()
): boolean {
  if (!storage) return false;
  const slug = normSlug(input.publicSlug);
  const accessId = String(input.publicAccessId || "").trim();
  if (!slug || !accessId) return false;
  const payload: DraftLocalBackup = {
    v: BACKUP_VERSION,
    publicSlug: slug,
    publicAccessId: accessId,
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_BACKUP_TTL_MS).toISOString(),
    form: stripSensitiveDraftFields(input.form),
    agreements: { ...input.agreements },
  };
  try {
    storage.setItem(draftBackupStorageKey(slug, accessId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readDraftBackup(
  publicSlug: string,
  publicAccessId: string,
  now: Date = new Date(),
  storage: StorageLike | null = defaultStorage()
): DraftLocalBackup | null {
  if (!storage) return null;
  const slug = normSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  if (!slug || !accessId) return null;
  const key = draftBackupStorageKey(slug, accessId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.v !== BACKUP_VERSION) {
      storage.removeItem(key);
      return null;
    }
    if (str(parsed.publicSlug) !== slug || str(parsed.publicAccessId) !== accessId) {
      return null;
    }
    const expiresAt = new Date(str(parsed.expiresAt));
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      storage.removeItem(key);
      return null;
    }
    const form = parseForm(parsed.form);
    if (!form) {
      storage.removeItem(key);
      return null;
    }
    return {
      v: BACKUP_VERSION,
      publicSlug: slug,
      publicAccessId: accessId,
      savedAt: str(parsed.savedAt),
      expiresAt: expiresAt.toISOString(),
      form,
      agreements: parseAgreements(parsed.agreements),
    };
  } catch {
    return null;
  }
}

export function clearDraftBackup(
  publicSlug: string,
  publicAccessId: string,
  storage: StorageLike | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(draftBackupStorageKey(publicSlug, publicAccessId));
  } catch {
    /* storage unavailable */
  }
}

/** Removes expired or unreadable backups for any school on this device. */
export function pruneExpiredDraftBackups(
  now: Date = new Date(),
  storage: StorageLike | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      let expired = true;
      try {
        const parsed = JSON.parse(storage.getItem(key) || "null") as unknown;
        const exp = isRecord(parsed) ? new Date(str(parsed.expiresAt)) : new Date(NaN);
        expired = Number.isNaN(exp.getTime()) || exp.getTime() <= now.getTime();
      } catch {
        expired = true;
      }
      if (expired) storage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

function guardianNameKey(g: { firstName: string; surname: string }): string {
  return `${g.firstName.trim().toLowerCase()}|${g.surname.trim().toLowerCase()}`;
}

/**
 * Applies backed-up (unsaved) entries over the server copy. Identity numbers are never
 * stored locally, so they are taken from the server: by unique guardian name, otherwise by
 * position when the guardian count is unchanged.
 */
export function mergeBackupIntoServerForm(
  serverForm: DraftApplicationFormState,
  backupForm: DraftApplicationFormState
): DraftApplicationFormState {
  const serverGuardians = serverForm.guardians;
  const sameCount = serverGuardians.length === backupForm.guardians.length;
  const guardians = backupForm.guardians.map((g, index) => {
    const key = guardianNameKey(g);
    const byName = serverGuardians.filter((s) => guardianNameKey(s) === key && key !== "|");
    const source =
      byName.length === 1 ? byName[0] : sameCount ? serverGuardians[index] : undefined;
    return { ...g, idNumber: source?.idNumber || "" };
  });
  return {
    ...backupForm,
    intakeYear: serverForm.intakeYear ?? backupForm.intakeYear,
    learner: { ...backupForm.learner, idNumber: serverForm.learner.idNumber },
    guardians,
  };
}
