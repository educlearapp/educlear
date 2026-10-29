import { analyseSmsMessage, SMS_CREDITS_PER_SEGMENT } from "../billing/smsSegmentCalculator";

/** Unique recipient count × message segments (1 credit per segment). */
export function estimateSmsCreditsForRecipients(message: string, recipientCount: number) {
  const segments = analyseSmsMessage(String(message || "").trim()).segments || 0;
  const recipients = Math.max(0, Math.floor(Number(recipientCount) || 0));
  return {
    segments,
    recipientCount: recipients,
    estimatedCredits: segments * recipients * SMS_CREDITS_PER_SEGMENT,
  };
}
