export type ProviderSendContext = {
  schoolId: string;
  messageId: string;
  recipient: string;
  subject: string;
  body: string;
};

export type ProviderSendResult = {
  ok: boolean;
  simulated: boolean;
  reference?: string;
  error?: string;
};

/**
 * Adapter boundary for SMTP / transactional email.
 * Live transport is wired here later; returns a structured simulated outcome only.
 */
export async function sendEmailPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  return { ok: true, simulated: true, reference: `email:${ctx.messageId}` };
}
