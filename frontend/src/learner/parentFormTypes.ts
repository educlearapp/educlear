export type ParentFormTab = "general" | "contact" | "address" | "billing" | "other" | "extra";

export type ParentRecord = {
  id?: string;
  relationship?: string;
  title?: string;
  firstName?: string;
  surname?: string;
  name?: string;
  lastName?: string;
  idNumber?: string;
  cellNo?: string;
  cell?: string;
  phone?: string;
  mobile?: string;
  workNo?: string;
  work?: string;
  workPhone?: string;
  email?: string;
  homeAddress?: string;
  homeNo?: string;
  notes?: string;
  communicationAdministration?: boolean;
  communicationBilling?: boolean;
  communicationByEmail?: boolean;
  communicationBySMS?: boolean;
  communicationByPrint?: boolean;
  isPayingPerson?: boolean;
  billingStatement?: boolean;
  billingInvoice?: boolean;
  billingReceipt?: boolean;
  isPrimary?: boolean;
  learnerId?: string;
  familyAccountId?: string;
};

export const PARENT_FORM_TABS: { id: ParentFormTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "contact", label: "Contact" },
  { id: "address", label: "Address" },
  { id: "billing", label: "Billing" },
  { id: "other", label: "Other" },
  { id: "extra", label: "Extra" },
];

export const RELATIONSHIP_OPTIONS = [
  "Parent",
  "Mother",
  "Father",
  "Guardian",
  "Grandparent",
  "Aunt",
  "Uncle",
  "Sponsor",
  "Other",
];

export const TITLE_OPTIONS = ["", "Mr", "Mrs", "Ms", "Dr", "Prof", "Rev"];
