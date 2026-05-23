import { apiFetch, API_URL } from "../api";

const MIGRATION_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Authenticated API calls for super-admin routes (migration, etc.). */
export async function superAdminApiFetch(path: string, options: RequestInit = {}) {
  const { headers: incomingHeaders, ...rest } = options;
  return apiFetch(path, {
    ...rest,
    headers: {
      ...authHeaders(),
      ...(incomingHeaders || {}),
    },
  });
}

/**
 * Multipart upload for large Kid-e-Sys migration validates.
 * Uses XHR (no AbortSignal) so the browser keeps the connection open until the backend responds.
 */
export function superAdminApiUpload(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.timeout = MIGRATION_UPLOAD_TIMEOUT_MS;

    const token = localStorage.getItem("token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      const text = xhr.responseText || "";
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }

      const message =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: string }).error)
          : typeof data === "string" && data
            ? data
            : `Request failed with status ${xhr.status}`;
      reject(new Error(message));
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "Upload failed — network error. Keep this tab open until validation finishes."
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          "Upload timed out. Kid-e-Sys exports are large — wait for upload to finish before leaving this page."
        )
      );
    };

    xhr.onabort = () => {
      reject(new Error("Upload was interrupted. Do not refresh until validation completes."));
    };

    xhr.send(formData);
  });
}

export function superAdminAuthHeaders(): Record<string, string> {
  return authHeaders();
}

export { API_URL };
