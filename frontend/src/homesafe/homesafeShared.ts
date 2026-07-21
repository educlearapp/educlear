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
