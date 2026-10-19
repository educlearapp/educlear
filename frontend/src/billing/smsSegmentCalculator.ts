/**
 * Same GSM 03.38 / UCS-2 rules as backend/src/services/smsSegmentCalculator.ts.
 * Keep the two files in step. Message text is never shortened here.
 */

export const GSM_SINGLE_SEPTETS = 160;
export const GSM_CONCAT_SEPTETS = 153;
export const UCS2_SINGLE_UNITS = 70;
export const UCS2_CONCAT_UNITS = 67;
export const STATEMENT_SMS_MAX_CHARS = 480;
export const STATEMENT_SMS_MAX_SEGMENTS = 8;
export const SMS_CREDITS_PER_SEGMENT = 1;
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
