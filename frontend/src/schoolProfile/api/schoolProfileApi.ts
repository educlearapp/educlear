import { API_URL } from "../../api";
import type { SchoolProfileRecord } from "../types/schoolProfile";

function parseJsonBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function recordFromRow(row: Record<string, unknown>, schoolId: string): SchoolProfileRecord {
  return {
    id: String(row.id || schoolId),
    name: String(row.name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    address: String(row.address || ""),
    logoUrl: String(row.logoUrl || ""),
    primaryColor: String(row.primaryColor || ""),
    package: pickString(row, ["package", "packageName", "schoolPackage"]),
    packageUntil: pickString(row, ["packageUntil", "package_until", "subscriptionEndsAt"]),
    automaticRenew: pickString(row, ["automaticRenew", "automatic_renew", "autoRenew"]),
    automaticBilling: pickString(row, ["automaticBilling", "automatic_billing", "autoBilling"]),
  };
}

/** Loads school profile; returns null on missing school or failed request (no HTML error text). */
export async function fetchSchoolProfile(schoolId: string): Promise<SchoolProfileRecord | null> {
  const id = String(schoolId || "").trim();
  if (!id) return null;

  try {
    const res = await fetch(`${API_URL}/api/schools/${encodeURIComponent(id)}`, {
      headers: { "Content-Type": "application/json" },
    });

    const text = await res.text();
    const data = parseJsonBody(text);

    if (res.status === 404) return null;
    if (!res.ok) return null;
    if (!data || typeof data !== "object") return null;

    return recordFromRow(data as Record<string, unknown>, id);
  } catch {
    return null;
  }
}

function errorMessageFromResponse(status: number, data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return `Request failed with status ${status}`;
}

export async function saveSchoolProfile(
  schoolId: string,
  payload: { name: string; email: string | null; phone: string | null; address: string | null }
): Promise<SchoolProfileRecord> {
  const id = String(schoolId || "").trim();
  if (!id) throw new Error("No school selected");

  const res = await fetch(`${API_URL}/api/schools/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const data = parseJsonBody(text);

  if (!res.ok) {
    throw new Error(errorMessageFromResponse(res.status, data));
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from server");
  }

  return recordFromRow(data as Record<string, unknown>, id);
}
