/** Authorization header for staff dashboard API calls. */
export function staffAuthHeaders(): Record<string, string> {
  const token = String(localStorage.getItem("token") || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
