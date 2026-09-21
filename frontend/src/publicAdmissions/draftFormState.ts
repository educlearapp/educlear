import type {
  ApplicantApplicationView,
  DraftApplicationFormState,
  DraftGuardianFormRow,
  DraftGuardianPayload,
  PublicAdmissionsConfig,
  UpdateDraftApplicationBody,
} from "./publicAdmissionsTypes";

let clientKeySeq = 0;

export function newGuardianClientKey(): string {
  clientKeySeq += 1;
  return `g-${Date.now()}-${clientKeySeq}`;
}

export function emptyGuardianRow(
  opts?: Partial<Pick<DraftGuardianFormRow, "isPrimary" | "isPayingPerson">>
): DraftGuardianFormRow {
  return {
    clientKey: newGuardianClientKey(),
    title: "",
    firstName: "",
    surname: "",
    relationship: "",
    idNumber: "",
    cellNo: "",
    email: "",
    homeAddress: "",
    employer: "",
    isPrimary: Boolean(opts?.isPrimary),
    isPayingPerson: Boolean(opts?.isPayingPerson),
  };
}

export function createEmptyDraftForm(
  config: PublicAdmissionsConfig | null,
  application?: ApplicantApplicationView | null
): DraftApplicationFormState {
  const intakeYear =
    application?.intakeYear ??
    (config?.intakeYear != null ? Number(config.intakeYear) : null);
  const grades = Array.isArray(config?.acceptedGrades) ? config!.acceptedGrades : [];
  const requested =
    application?.requestedGrade ||
    (grades.length === 1 ? String(grades[0]) : "");

  return {
    intakeYear: intakeYear != null && Number.isFinite(intakeYear) ? intakeYear : null,
    requestedGrade: String(requested || ""),
    learner: {
      firstName: "",
      lastName: "",
      birthDate: "",
      gender: "",
      idNumber: "",
      previousSchoolName: "",
      homeAddress: "",
      homeLanguage: "",
      citizenship: "",
    },
    guardians: [emptyGuardianRow({ isPrimary: true, isPayingPerson: true })],
  };
}

export function hydrateDraftFormFromApplication(
  application: ApplicantApplicationView,
  config: PublicAdmissionsConfig | null
): DraftApplicationFormState {
  const base = createEmptyDraftForm(config, application);
  const learner = application.learner;
  const mapped =
    Array.isArray(application.guardians) && application.guardians.length > 0
      ? [...application.guardians]
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((g) => ({
            clientKey: g.id || newGuardianClientKey(),
            title: String(g.title || ""),
            firstName: String(g.firstName || ""),
            surname: String(g.surname || ""),
            relationship: String(g.relationship || ""),
            idNumber: String(g.idNumber || ""),
            cellNo: String(g.cellNo || ""),
            email: String(g.email || ""),
            homeAddress: String(g.homeAddress || ""),
            employer: String(g.employer || ""),
            isPrimary: Boolean(g.isPrimary),
            isPayingPerson: Boolean(g.isPayingPerson),
          }))
      : base.guardians;

  const withPrimary = mapped.some((g) => g.isPrimary)
    ? mapped
    : mapped.map((g, i) => ({ ...g, isPrimary: i === 0 }));
  const withPayer = withPrimary.some((g) => g.isPayingPerson)
    ? withPrimary
    : withPrimary.map((g, i) => ({ ...g, isPayingPerson: i === 0 }));

  return {
    intakeYear: application.intakeYear,
    requestedGrade: String(application.requestedGrade || base.requestedGrade || ""),
    learner: {
      firstName: String(learner?.firstName || ""),
      lastName: String(learner?.lastName || ""),
      birthDate: String(learner?.birthDate || ""),
      gender: String(learner?.gender || ""),
      idNumber: String(learner?.idNumber || ""),
      previousSchoolName: String(learner?.previousSchoolName || ""),
      homeAddress: String(learner?.homeAddress || ""),
      homeLanguage: String(learner?.homeLanguage || ""),
      citizenship: String(learner?.citizenship || ""),
    },
    guardians: withPayer,
  };
}

export function setPrimaryGuardian(
  guardians: DraftGuardianFormRow[],
  clientKey: string
): DraftGuardianFormRow[] {
  return guardians.map((g) => ({
    ...g,
    isPrimary: g.clientKey === clientKey,
  }));
}

export function setPayingGuardian(
  guardians: DraftGuardianFormRow[],
  clientKey: string
): DraftGuardianFormRow[] {
  return guardians.map((g) => ({
    ...g,
    isPayingPerson: g.clientKey === clientKey,
  }));
}

export function buildUpdateDraftBody(
  form: DraftApplicationFormState
): UpdateDraftApplicationBody {
  const guardians: DraftGuardianPayload[] = form.guardians.map((g, index) => ({
    title: g.title.trim() || null,
    firstName: g.firstName.trim(),
    surname: g.surname.trim(),
    relationship: g.relationship.trim() || null,
    idNumber: g.idNumber.trim() || null,
    cellNo: g.cellNo.trim() || null,
    email: g.email.trim() || null,
    homeAddress: g.homeAddress.trim() || null,
    employer: g.employer.trim() || null,
    isPrimary: Boolean(g.isPrimary),
    isPayingPerson: Boolean(g.isPayingPerson),
    sortOrder: index,
  }));

  return {
    intakeYear: form.intakeYear,
    requestedGrade: form.requestedGrade.trim() || null,
    learner: {
      firstName: form.learner.firstName.trim(),
      lastName: form.learner.lastName.trim(),
      birthDate: form.learner.birthDate.trim() || null,
      gender: form.learner.gender.trim() || null,
      idNumber: form.learner.idNumber.trim() || null,
      previousSchoolName: form.learner.previousSchoolName.trim() || null,
      homeAddress: form.learner.homeAddress.trim() || null,
      homeLanguage: form.learner.homeLanguage.trim() || null,
      citizenship: form.learner.citizenship.trim() || null,
    },
    guardians,
  };
}

export type DraftFormClientErrors = {
  learnerFirstName?: string;
  learnerLastName?: string;
  learnerCitizenship?: string;
  requestedGrade?: string;
  guardians?: string;
  primary?: string;
  payer?: string;
};

/** Soft UX validation — server remains authoritative. */
export function validateDraftFormClient(
  form: DraftApplicationFormState,
  acceptedGrades: string[],
  options?: { requireCitizenship?: boolean }
): DraftFormClientErrors {
  const errors: DraftFormClientErrors = {};
  if (!form.learner.firstName.trim()) {
    errors.learnerFirstName = "Learner first name is required.";
  }
  if (!form.learner.lastName.trim()) {
    errors.learnerLastName = "Learner surname is required.";
  }
  if (options?.requireCitizenship && !form.learner.citizenship.trim()) {
    errors.learnerCitizenship =
      "Learner citizenship is required for document requirements.";
  }
  if (acceptedGrades.length > 0 && !form.requestedGrade.trim()) {
    errors.requestedGrade = "Please select a grade.";
  }
  if (acceptedGrades.length > 0 && form.requestedGrade) {
    if (!acceptedGrades.includes(form.requestedGrade)) {
      errors.requestedGrade = "Please select a grade from the list.";
    }
  }
  if (!form.guardians.length) {
    errors.guardians = "Add at least one parent or guardian.";
  } else {
    const incomplete = form.guardians.some(
      (g) => !g.firstName.trim() || !g.surname.trim()
    );
    if (incomplete) {
      errors.guardians = "Each guardian needs a first name and surname.";
    }
    if (!form.guardians.some((g) => g.isPrimary)) {
      errors.primary = "Select one primary guardian.";
    }
    if (!form.guardians.some((g) => g.isPayingPerson)) {
      errors.payer = "Select who will be responsible for fees.";
    }
  }
  return errors;
}

export function hasClientErrors(errors: DraftFormClientErrors): boolean {
  return Object.keys(errors).length > 0;
}
