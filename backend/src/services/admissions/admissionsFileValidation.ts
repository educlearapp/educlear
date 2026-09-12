/**
 * Admissions file sniffing + sanitization (OA-03D).
 * Magic-byte detection — do not trust client MIME/extension alone.
 */
import path from "path";

export const ADMISSIONS_MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MiB

export type AdmissionsAllowedMime = "application/pdf" | "image/jpeg" | "image/png";

const MIME_TO_EXT: Record<AdmissionsAllowedMime, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

const EXT_TO_MIME: Record<string, AdmissionsAllowedMime> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export function detectAdmissionsMimeFromBuffer(buf: Buffer): AdmissionsAllowedMime | null {
  if (!buf || buf.length < 4) return null;
  // %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  // JPEG
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

export function sanitizeOriginalFileName(raw: string): string {
  const base = path.basename(String(raw || "document")).replace(/[\u0000-\u001f\u007f]/g, "");
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").trim() || "document";
  return cleaned.slice(0, 180);
}

export function extensionForMime(mime: AdmissionsAllowedMime): string {
  return MIME_TO_EXT[mime];
}

export function mimeFromExtension(fileName: string): AdmissionsAllowedMime | null {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return EXT_TO_MIME[ext] || null;
}

/**
 * Validate buffer + claimed name. Returns canonical MIME and safe storage extension.
 */
export function validateAdmissionsUploadBuffer(input: {
  buffer: Buffer;
  originalFileName: string;
  claimedMime?: string | null;
}): { contentType: AdmissionsAllowedMime; storageExt: string; originalFileName: string } {
  if (!input.buffer?.length) {
    throw Object.assign(new Error("Empty file"), { code: "EMPTY_FILE" });
  }
  if (input.buffer.length > ADMISSIONS_MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error("File too large"), { code: "FILE_TOO_LARGE" });
  }

  const detected = detectAdmissionsMimeFromBuffer(input.buffer);
  if (!detected) {
    throw Object.assign(new Error("Unsupported or unsafe file type"), { code: "INVALID_FILE_TYPE" });
  }

  const fromName = mimeFromExtension(input.originalFileName);
  if (fromName && fromName !== detected) {
    throw Object.assign(new Error("File extension does not match file contents"), {
      code: "EXTENSION_MISMATCH",
    });
  }

  const claimed = String(input.claimedMime || "")
    .trim()
    .toLowerCase();
  if (claimed) {
    const normalized =
      claimed === "image/jpg" ? "image/jpeg" : claimed;
    if (normalized !== detected) {
      throw Object.assign(new Error("Declared MIME type does not match file contents"), {
        code: "MIME_MISMATCH",
      });
    }
  }

  return {
    contentType: detected,
    storageExt: extensionForMime(detected),
    originalFileName: sanitizeOriginalFileName(input.originalFileName),
  };
}
