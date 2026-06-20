import {
  parseKideesysSpreadsheetFile,
  splitFullName,
} from "../../../../utils/kideesysSpreadsheet";

export type ParsedEmployee = {
  fullName: string;
  firstName: string;
  lastName: string;
  mobileNumber: string;
  physicalAddress: string;
  email: string;
};

function rowText(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

export function parseEmployeesFile(filePath: string): ParsedEmployee[] {
  const sheet = parseKideesysSpreadsheetFile(filePath);
  const employees: ParsedEmployee[] = [];
  let current: ParsedEmployee | null = null;

  for (const row of sheet.rows) {
    const c0 = rowText(row, 0);
    const c1 = rowText(row, 1);
    const c3 = rowText(row, 3);
    const c4 = rowText(row, 4);

    if (c0 && c0 === c0.toUpperCase() && c0.length > 3 && !/^\d+$/.test(c0)) {
      if (current) employees.push(current);
      const { firstName, lastName } = splitFullName(
        c0
          .toLowerCase()
          .replace(/\b\w/g, (ch) => ch.toUpperCase())
      );
      current = {
        fullName: c0,
        firstName,
        lastName,
        mobileNumber: "",
        physicalAddress: "",
        email: "",
      };
      if (/^\d{9,}$/.test(c1.replace(/\s/g, ""))) {
        current.mobileNumber = c1;
      }
      if (c3) current.physicalAddress = c3;
      if (c4 && c4.includes("@")) current.email = c4;
      continue;
    }

    if (current && /^\d{9,}$/.test(c1.replace(/\s/g, "")) && !current.mobileNumber) {
      current.mobileNumber = c1;
    }
  }
  if (current) employees.push(current);
  return employees;
}
