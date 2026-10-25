/**
 * Authenticated binary download helper (staff or parent Bearer).
 * Never navigates to public /uploads paths — blob only (Safari/PWA friendly).
 */

export type BlobDownloadAuth =
  | { mode: "staff"; fetch: (url: string, init?: RequestInit) => Promise<Response> }
  | { mode: "parent"; token: string; apiBase: string };

function assertApiDownloadPath(path: string): string {
  const p = String(path || "").trim();
  if (!p) throw new Error("Download unavailable");
  if (p.includes("/uploads/")) {
    throw new Error("Public upload URLs are not allowed");
  }
  const normalized = p.startsWith("/") ? p : `/${p}`;
  if (!normalized.startsWith("/api/")) {
    throw new Error("Invalid download path");
  }
  return normalized;
}

/** Trigger a file save from a Blob; keeps object URL briefly for iOS Safari. */
export function triggerBlobFileSave(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "attachment";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

export async function downloadAuthenticatedBlob(
  downloadPath: string,
  fileName: string,
  auth: BlobDownloadAuth
): Promise<void> {
  const path = assertApiDownloadPath(downloadPath);
  let res: Response;
  if (auth.mode === "staff") {
    res = await auth.fetch(path, { cache: "no-store" });
  } else {
    const url = `${auth.apiBase.replace(/\/$/, "")}${path}`;
    res = await fetch(url, {
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
      cache: "no-store",
    });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ||
        (res.status === 404 ? "File not found" : res.status === 403 ? "Access denied" : "Download failed")
    );
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error("Empty file");
  }
  triggerBlobFileSave(blob, fileName || "attachment");
}

export type AttachmentRef = {
  name?: string | null;
  downloadPath?: string | null;
  url?: string | null;
};

/** Only attachments with an API downloadPath (never raw /uploads urls). */
export function authorisedAttachments(list: unknown): AttachmentRef[] {
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is AttachmentRef => {
    if (!a || typeof a !== "object") return false;
    const path = String((a as AttachmentRef).downloadPath || "").trim();
    return Boolean(path) && path.startsWith("/api/") && !path.includes("/uploads/");
  });
}
