const BASE_URL = import.meta.env.VITE_API_BASE || "http://localhost:3000";



export async function apiFetch(path: string, options: RequestInit = {}) {

  const res = await fetch(`${BASE_URL}${path}`, {

    headers: {

      "Content-Type": "application/json",

      ...(options.headers || {}),

    },

    ...options,

  });



  if (!res.ok) {

    const text = await res.text();

    throw new Error(text || `Request failed: ${res.status}`);

  }