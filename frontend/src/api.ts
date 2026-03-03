const API_BASE = "http://localhost:3000";



export async function apiFetch(path: string, options: RequestInit = {}) {

  const token = localStorage.getItem("token"); // ✅ ADD THIS



  const headers = new Headers(options.headers || {});

  headers.set("Content-Type", "application/json");



  if (token) {

    headers.set("Authorization", `Bearer ${token}`);

  }



  const res = await fetch(`${API_BASE}${path}`, {

    ...options,

    headers,

  });



  if (!res.ok) {

    const text = await res.text();

    throw new Error(`API ${res.status}: ${text}`);

  }



  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {

    return res.json();

  }



  return res.text();

}