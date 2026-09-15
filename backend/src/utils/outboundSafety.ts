/**
 * Staging / environment safety controls for outbound email, SMS, and CORS.
 * Kill switches are off unless explicitly set to "true" (case-insensitive).
 */

export const OUTBOUND_EMAIL_DISABLED_MESSAGE =
  "Outbound email is disabled (DISABLE_OUTBOUND_EMAIL=true).";

export const OUTBOUND_SMS_DISABLED_MESSAGE =
  "Outbound SMS is disabled (DISABLE_OUTBOUND_SMS=true).";

/** Hardcoded production + local origins — always retained; env origins are additive. */
export const DEFAULT_CORS_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://educlear-frontend.onrender.com",
  "https://educlear.co.za",
  "https://www.educlear.co.za",
];

export class OutboundEmailDisabledError extends Error {
  readonly code = "OUTBOUND_EMAIL_DISABLED" as const;

  constructor(message = OUTBOUND_EMAIL_DISABLED_MESSAGE) {
    super(message);
    this.name = "OutboundEmailDisabledError";
  }
}

export class OutboundSmsDisabledError extends Error {
  readonly code = "OUTBOUND_SMS_DISABLED" as const;

  constructor(message = OUTBOUND_SMS_DISABLED_MESSAGE) {
    super(message);
    this.name = "OutboundSmsDisabledError";
  }
}

function envFlagTrue(name: string): boolean {
  return String(process.env[name] || "")
    .trim()
    .toLowerCase() === "true";
}

export function isOutboundEmailDisabled(): boolean {
  return envFlagTrue("DISABLE_OUTBOUND_EMAIL");
}

export function isOutboundSmsDisabled(): boolean {
  return envFlagTrue("DISABLE_OUTBOUND_SMS");
}

export function assertOutboundEmailEnabled(): void {
  if (isOutboundEmailDisabled()) {
    throw new OutboundEmailDisabledError();
  }
}

export function assertOutboundSmsEnabled(): void {
  if (isOutboundSmsDisabled()) {
    throw new OutboundSmsDisabledError();
  }
}

/** True when value is an absolute http(s) origin (no path/query/hash, no wildcard). */
export function isAbsoluteHttpOrigin(value: string): boolean {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.includes("*")) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    // Reject paths/query/hash: only protocol + host (+ port) allowed.
    if (url.pathname !== "/" || url.search || url.hash) return false;
    return `${url.protocol}//${url.host}` === trimmed;
  } catch {
    return false;
  }
}

/**
 * Parse CORS_ALLOWED_ORIGINS: comma-separated absolute origins.
 * Trims, drops empties, rejects "*", rejects non-origins, deduplicates (order preserved).
 */
export function parseCorsAllowedOrigins(raw: string | undefined | null): string[] {
  if (raw == null || String(raw).trim() === "") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(",")) {
    const origin = part.trim();
    if (!origin) continue;
    if (!isAbsoluteHttpOrigin(origin)) continue;
    if (seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  return out;
}

/**
 * Default allowlist plus optional CORS_ALLOWED_ORIGINS extras (additive, never replaces).
 */
export function resolveCorsAllowedOrigins(
  envValue: string | undefined | null = process.env.CORS_ALLOWED_ORIGINS
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const origin of DEFAULT_CORS_ALLOWED_ORIGINS) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    merged.push(origin);
  }
  for (const origin of parseCorsAllowedOrigins(envValue)) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    merged.push(origin);
  }
  return merged;
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  opts?: { isDev?: boolean; allowPrivateLanInDev?: boolean }
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  const isDev = opts?.isDev ?? process.env.NODE_ENV !== "production";
  if (isDev && opts?.allowPrivateLanInDev !== false) {
    return /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
      origin
    );
  }
  return false;
}

export function buildHealthResponse(): { status: "ok" } {
  return { status: "ok" };
}
