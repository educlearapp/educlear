import {
  sendSchoolEmail,
  type SendSchoolEmailInput,
} from "../services/schoolEmailService";

export type SendEmailWithAttachmentInput = SendSchoolEmailInput & {
  schoolId: string;
};

/**
 * Sends billing/statement mail using EduClear's central platform email service.
 */
export async function sendEmailWithAttachment(input: SendEmailWithAttachmentInput) {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new Error("Missing schoolId for email delivery.");
  }

  return sendSchoolEmail(schoolId, {
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  });
}
