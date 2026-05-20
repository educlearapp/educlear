import type {
  CommunicationCategory,
  CommunicationChannel,
  ParentNotificationType,
} from "@prisma/client";

export type { CommunicationCategory, CommunicationChannel };

/** Map Parent Portal notification enum → engine taxonomy */
export function communicationCategoryFromParentNotificationType(
  t: ParentNotificationType
): CommunicationCategory {
  switch (t) {
    case "INVOICE_READY":
      return "invoice_ready";
    case "STATEMENT_READY":
      return "statement_ready";
    case "TEACHER_MESSAGE":
      return "teacher_reply";
    case "INCIDENT":
      return "incident_created";
    case "HOMEWORK":
      return "homework_added";
    case "ASSESSMENT":
      return "assessment_notice";
    case "EXAM":
      return "exam_notice";
    case "SCHOOL_NOTICE":
      return "school_notice";
    case "DOCUMENT":
      return "document_shared";
    case "ONBOARDING":
      return "onboarding_invite";
    default:
      return "school_notice";
  }
}

export function outreachChannelToCommunicationChannel(
  ch: "SMS" | "EMAIL" | "WHATSAPP"
): CommunicationChannel {
  if (ch === "SMS") return "sms";
  if (ch === "EMAIL") return "email";
  return "whatsapp";
}
