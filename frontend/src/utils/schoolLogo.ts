import { API_URL } from "../api";

/** School.logoUrl only — no EduClear or legacy field fallbacks. */
export function resolveSchoolLogoUrl(school?: { logoUrl?: string | null } | null): string {
  const fromSchool = String(school?.logoUrl || "").trim();
  if (fromSchool) return absolutizeSchoolLogoUrl(fromSchool);
  return "";
}

export function absolutizeSchoolLogoUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${API_URL}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export async function uploadSchoolLogoFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("logo", file);
  const res = await fetch(`${API_URL}/api/upload-logo`, { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; url?: string; error?: string };
  if (!res.ok || !data?.success || !data?.url) {
    throw new Error(data?.error || "Logo upload failed");
  }
  return absolutizeSchoolLogoUrl(String(data.url));
}

export function cacheSchoolLogoUrl(logoUrl: string): string {
  const absolute = absolutizeSchoolLogoUrl(logoUrl);
  if (absolute) localStorage.setItem("schoolLogoUrl", absolute);
  return absolute;
}
