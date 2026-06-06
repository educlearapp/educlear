import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

let devKeyWarningShown = false;

function getEncryptionKey(): Buffer {
  const raw = String(process.env.EDUCLEAR_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "").trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) {
      throw new Error("EDUCLEAR_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    }
    return buf;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("EDUCLEAR_ENCRYPTION_KEY is required in production");
  }

  if (!devKeyWarningShown) {
    devKeyWarningShown = true;
    console.warn(
      "[secretCrypto] EDUCLEAR_ENCRYPTION_KEY not set — using dev-only derived key. Set a production key before deploy."
    );
  }

  return crypto.scryptSync(
    process.env.JWT_SECRET || "dev_secret_change_me",
    "educlear-secret-salt-v1",
    32
  );
}

export const MASKED_SECRET = "********";

export function maskSecret(value: string) {
  if (!value) return "";
  return MASKED_SECRET;
}

export function encryptSecret(plaintext: string): string {
  const value = String(plaintext || "").trim();
  if (!value) return "";

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const payload = String(stored || "").trim();
  if (!payload) return "";

  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) return "";

  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const SENSITIVE_KEY_RE = /apikey|api_key|authorization|password|smtpPass|winSmsPassword/i;

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactSensitiveValues(nested);
      }
    }
    return out;
  }
  return value;
}
