export type SchoolProfileRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  logoUrl: string;
  primaryColor: string;
  package?: string;
  packageUntil?: string;
  automaticRenew?: string;
  automaticBilling?: string;
};

export type SchoolProfileFormState = {
  businessName: string;
  registeredEmail: string;
  package: string;
  packageUntil: string;
  automaticRenew: string;
  automaticBilling: string;
  telNo: string;
  cellNo: string;
  faxNo: string;
  contactEmail: string;
  physicalAddress1: string;
  physicalAddress2: string;
  physicalAddress3: string;
  physicalAddress4: string;
  postalAddress1: string;
  postalAddress2: string;
  postalAddress3: string;
  postalAddress4: string;
  bankingLine1: string;
  bankingLine2: string;
  bankingLine3: string;
  bankingLine4: string;
  newPassword: string;
  confirmPassword: string;
};

function formatPackageUntilDisplay(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return raw;
}

function formatYesNoDisplay(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const raw = String(value).trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "1") return "Yes";
  if (lower === "false" || lower === "no" || lower === "0") return "No";
  return raw;
}

export function createEmptySchoolProfileForm(): SchoolProfileFormState {
  return {
    businessName: "",
    registeredEmail: "",
    package: "",
    packageUntil: "",
    automaticRenew: "",
    automaticBilling: "",
    telNo: "",
    cellNo: "",
    faxNo: "",
    contactEmail: "",
    physicalAddress1: "",
    physicalAddress2: "",
    physicalAddress3: "",
    physicalAddress4: "",
    postalAddress1: "",
    postalAddress2: "",
    postalAddress3: "",
    postalAddress4: "",
    bankingLine1: "",
    bankingLine2: "",
    bankingLine3: "",
    bankingLine4: "",
    newPassword: "",
    confirmPassword: "",
  };
}

function splitAddressLines(address: string | null | undefined, count = 4): string[] {
  const lines = String(address || "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(lines[i] || "");
  }
  return result;
}

function joinAddressLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

export function schoolRecordToForm(record: SchoolProfileRecord | null): SchoolProfileFormState {
  const empty = createEmptySchoolProfileForm();
  if (!record) return empty;

  const physical = splitAddressLines(record.address);
  return {
    ...empty,
    businessName: record.name || "",
    registeredEmail: record.email || "",
    package: String(record.package || "").trim(),
    packageUntil: formatPackageUntilDisplay(record.packageUntil),
    automaticRenew: formatYesNoDisplay(record.automaticRenew),
    automaticBilling: formatYesNoDisplay(record.automaticBilling),
    telNo: record.phone || "",
    contactEmail: record.email || "",
    physicalAddress1: physical[0] || "",
    physicalAddress2: physical[1] || "",
    physicalAddress3: physical[2] || "",
    physicalAddress4: physical[3] || "",
  };
}

export function formToSchoolUpdatePayload(form: SchoolProfileFormState) {
  return {
    name: form.businessName.trim(),
    email: form.registeredEmail.trim() || form.contactEmail.trim() || null,
    phone: form.telNo.trim() || null,
    address:
      joinAddressLines([
        form.physicalAddress1,
        form.physicalAddress2,
        form.physicalAddress3,
        form.physicalAddress4,
      ]) || null,
  };
}
