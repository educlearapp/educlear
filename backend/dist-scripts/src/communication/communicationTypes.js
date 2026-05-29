"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.communicationCategoryFromParentNotificationType = communicationCategoryFromParentNotificationType;
exports.outreachChannelToCommunicationChannel = outreachChannelToCommunicationChannel;
/** Map Parent Portal notification enum → engine taxonomy */
function communicationCategoryFromParentNotificationType(t) {
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
function outreachChannelToCommunicationChannel(ch) {
    if (ch === "SMS")
        return "sms";
    if (ch === "EMAIL")
        return "email";
    return "whatsapp";
}
