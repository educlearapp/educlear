export const HOMESAFE_COLLECTION_METHODS = [
  { value: "PARENT", label: "Parent" },
  { value: "UNCLE", label: "Uncle" },
  { value: "SIBLING", label: "Sibling" },
  { value: "GRANDPARENT", label: "Grandparent" },
  { value: "BOLT", label: "Bolt" },
  { value: "SCHOOL_TRANSPORT", label: "School Transport" },
  { value: "TAXI", label: "Taxi" },
  { value: "OTHER", label: "Other" },
] as const;

export type HomeSafeCollectionMethodValue = (typeof HOMESAFE_COLLECTION_METHODS)[number]["value"];

/** Display label including legacy TRANSPORT stored before expanded collectors. */
export function collectionMethodLabel(value: string | null | undefined): string {
  switch (String(value || "").trim().toUpperCase()) {
    case "PARENT":
      return "Parent";
    case "UNCLE":
      return "Uncle";
    case "SIBLING":
      return "Sibling";
    case "GRANDPARENT":
      return "Grandparent";
    case "BOLT":
      return "Bolt";
    case "SCHOOL_TRANSPORT":
      return "School Transport";
    case "TAXI":
      return "Taxi";
    case "OTHER":
      return "Other";
    case "TRANSPORT":
      return "Transport";
    default:
      return value ? String(value) : "—";
  }
}

export const HOMESAFE_EARLY_DEPARTURE_REASONS = [
  { value: "SICK", label: "Sick" },
  { value: "MEDICAL_APPOINTMENT", label: "Medical appointment" },
  { value: "FAMILY_EMERGENCY", label: "Family emergency" },
  { value: "PARENT_REQUEST", label: "Parent request" },
  { value: "OTHER", label: "Other" },
] as const;

export type HomeSafeLearnerRow = {
  learnerId: string;
  displayName: string;
  classroom: string;
  admissionNo: string | null;
  dismissedToday: boolean;
  dismissalToday: {
    eventId?: string;
    id?: string;
    schoolLocalTimeDisplay: string;
    departureType?: string;
    collectionMethod?: string;
  } | null;
};

export type HomeSafeDismissResponse = {
  success?: boolean;
  error?: string;
  dismissal?: {
    id: string;
    schoolLocalTimeDisplay: string;
    departureType?: string;
    earlyDepartureReason?: string | null;
    collectionMethod?: string;
  };
  notification?: { status: string; parentsNotified: number };
};

export function homesafeDepartureTypeLabel(value: string | null | undefined): string {
  return value === "EARLY_DEPARTURE" ? "Early departure" : "Normal dismissal";
}

export function physicalPresenceHint(
  status: string | undefined,
  leftAtDisplay: string | null | undefined,
  earlyReasonLabel?: string | null
): string | null {
  if (!status || status === "AT_SCHOOL") return null;
  if (status === "LEFT_EARLY") {
    return earlyReasonLabel
      ? `Left early at ${leftAtDisplay || "—"} (${earlyReasonLabel})`
      : `Left early at ${leftAtDisplay || "—"}`;
  }
  if (status === "DISMISSED") {
    return `Dismissed at ${leftAtDisplay || "—"}`;
  }
  return null;
}
