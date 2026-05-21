import {
  buildSetupRequiredPayload,
  isSchoolEmailConfigured,
  sendSchoolEmail,
  type SendSchoolEmailInput,
} from "../services/schoolEmailService";

export type SendEmailWithAttachmentInput = SendSchoolEmailInput & {
  schoolId: string;
};

/**
 * Sends billing/statement mail using the school's saved SMTP settings (scoped by schoolId).
 */
export async function sendEmailWithAttachment(input: SendEmailWithAttachmentInput) {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new Error("Missing schoolId for email delivery.");
  }

  if (!(await isSchoolEmailConfigured(schoolId))) {
    const payload = buildSetupRequiredPayload();
    const err = new Error(payload.error) as Error & { setupRequired?: boolean };
    err.setupRequired = true;
    throw err;
  }

  return sendSchoolEmail(schoolId, {
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  });
}
