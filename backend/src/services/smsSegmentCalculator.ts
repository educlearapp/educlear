/**
 * SMS segment counts using GSM 03.38 and UCS-2 rules.
 * A single GSM SMS holds 160 septets. Concatenated GSM SMS hold 153 septets each.
 * Extension-table characters take two septets. Any character outside GSM 03.38
 * switches the whole message to UCS-2: 70 UTF-16 code units, or 67 when concatenated.
 * Surrogate pairs count as two UCS-2 units, which is JavaScript string length.
 * The message text is never shortened here.
 */

export const GSM_SINGLE_SEPTETS = 160;
export const GSM_CONCAT_SEPTETS = 153;
export const UCS2_SINGLE_UNITS = 70;
export const UCS2_CONCAT_UNITS = 67;

/** Staff may compose up to this many characters. The text is rejected, not cut, past this. */
export const STATEMENT_SMS_MAX_CHARS = 480;

/**
 * Highest segment count a message inside the character cap can need
 * (480 UCS-2 units is 8 concatenated segments). A correctly counted
 * 4-segment GSM message is inside this limit.
 */
export const STATEMENT_SMS_MAX_SEGMENTS = 8;

/** WinSMS charges one credit per segment. */
export const SMS_CREDITS_PER_SEGMENT = 1;

/** Kept for existing previews. Real segment size depends on encoding and concatenation. */
export const STATEMENT_SMS_SEGMENT_CHARS = GSM_SINGLE_SEPTETS;

const GSM_BASIC = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
  )
);

const GSM_EXTENSION = new Set(Array.from("\f^{}\\[~]|€"));

export type SmsEncoding = "gsm" | "ucs2";

export type SmsSegmentAnalysis = {
  encoding: SmsEncoding;
  /** GSM septets, or UCS-2 code units. */
  units: number;
  segments: number;
  credits: number;
};

function segmentCount(units: number, single: number, concatenated: number): number {
  if (units <= 0) return 0;
  if (units <= single) return 1;
  return Math.ceil(units / concatenated);
}

export function analyseSmsMessage(raw: string): SmsSegmentAnalysis {
  const message = String(raw ?? "");
  if (!message) {
    return { encoding: "gsm", units: 0, segments: 0, credits: 0 };
  }

  let septets = 0;
  let gsm = true;
  for (let i = 0; i < message.length; ) {
    const codePoint = message.codePointAt(i) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    i += width;
    if (!gsm) continue;
    const character = String.fromCodePoint(codePoint);
    if (GSM_BASIC.has(character)) septets += 1;
    else if (GSM_EXTENSION.has(character)) septets += 2;
    else gsm = false;
  }

  if (!gsm) {
    const units = message.length;
    const segments = segmentCount(units, UCS2_SINGLE_UNITS, UCS2_CONCAT_UNITS);
    return { encoding: "ucs2", units, segments, credits: segments * SMS_CREDITS_PER_SEGMENT };
  }

  const segments = segmentCount(septets, GSM_SINGLE_SEPTETS, GSM_CONCAT_SEPTETS);
  return { encoding: "gsm", units: septets, segments, credits: segments * SMS_CREDITS_PER_SEGMENT };
}

/** Provider text safe to show to staff. Drops credentials and phone-like numbers. */
export function publicSmsProviderError(raw: unknown): string {
  let text = String(raw || "").replace(/\s+/g, " ").trim();
  text = text.replace(/\b(?:\+?27|0)\d{8,11}\b/g, "[number]");
  text = text.replace(/(api[_-]?key|authorization|bearer)\s*[:=]?\s*\S+/gi, "$1 [redacted]");
  if (!text) return "WinSMS rejected the message.";
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}
