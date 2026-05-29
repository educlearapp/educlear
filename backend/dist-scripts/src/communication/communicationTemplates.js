"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYSTEM_TEMPLATE_SEED = void 0;
exports.applyTemplateString = applyTemplateString;
exports.findTemplateForSchool = findTemplateForSchool;
exports.resolveRenderedMessage = resolveRenderedMessage;
exports.ensureDefaultCommunicationTemplates = ensureDefaultCommunicationTemplates;
/** Interpolate `{{key}}` placeholders (simple, safe for school-controlled templates). */
function applyTemplateString(template, variables) {
    return String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, rawKey) => {
        const key = String(rawKey || "").trim();
        const v = variables[key];
        return v == null ? "" : String(v);
    });
}
async function findTemplateForSchool(prisma, schoolId, templateKey) {
    const schoolSpecific = await prisma.communicationTemplate.findFirst({
        where: { schoolId, templateKey, isActive: true },
    });
    if (schoolSpecific)
        return schoolSpecific;
    return prisma.communicationTemplate.findFirst({
        where: { schoolId: null, templateKey, isActive: true },
    });
}
async function resolveRenderedMessage(prisma, schoolId, templateKey, variables) {
    const tpl = await findTemplateForSchool(prisma, schoolId, templateKey);
    if (!tpl) {
        return {
            subject: "",
            body: "",
            found: false,
        };
    }
    return {
        subject: applyTemplateString(tpl.subjectTemplate, variables),
        body: applyTemplateString(tpl.bodyTemplate, variables),
        found: true,
        template: tpl,
    };
}
/** Built-in defaults (schoolId null). Idempotent create. */
exports.SYSTEM_TEMPLATE_SEED = [
    {
        templateKey: "invoice_ready",
        name: "Invoice ready",
        subjectTemplate: "{{schoolName}} — Invoice ready ({{month}})",
        bodyTemplate: "Your invoice for {{month}} is ready.\n\nOpen the Parent Portal to view and download it.\n\n{{portalUrl}}",
    },
    {
        templateKey: "statement_ready",
        name: "Statement ready",
        subjectTemplate: "{{schoolName}} — Statement ready ({{month}})",
        bodyTemplate: "Your statement for {{month}} is ready.\n\nOpen the Parent Portal to view it.\n\n{{portalUrl}}",
    },
    {
        templateKey: "onboarding_welcome",
        name: "Onboarding welcome",
        subjectTemplate: "{{schoolName}} — Parent Portal",
        bodyTemplate: "{{schoolName}} is now using the EduClear Parent Portal.\n\n" +
            "View invoices, statements, notices, homework, and message your child's class teacher.\n\n" +
            "Open: {{portalUrl}}\n\n" +
            "On your phone: open the link in your browser, then use Add to Home Screen to install the app.",
    },
    {
        templateKey: "teacher_reply",
        name: "Teacher reply",
        subjectTemplate: "{{schoolName}} — Message from class teacher",
        bodyTemplate: "{{messagePreview}}",
    },
    {
        templateKey: "incident_notice",
        name: "Incident notice",
        subjectTemplate: "{{schoolName}} — Incident recorded",
        bodyTemplate: "{{incidentSummary}}",
    },
    {
        templateKey: "assessment_reminder",
        name: "Assessment reminder",
        subjectTemplate: "{{schoolName}} — {{noticeTitle}}",
        bodyTemplate: "{{noticeBody}}",
    },
    {
        templateKey: "homework_uploaded",
        name: "Homework uploaded",
        subjectTemplate: "{{schoolName}} — Homework",
        bodyTemplate: "{{homeworkTitle}}",
    },
    {
        templateKey: "payment_reminder",
        name: "Payment reminder",
        subjectTemplate: "{{schoolName}} — Payment reminder",
        bodyTemplate: "{{reminderBody}}",
    },
];
async function ensureDefaultCommunicationTemplates(prisma) {
    for (const row of exports.SYSTEM_TEMPLATE_SEED) {
        const existing = await prisma.communicationTemplate.findFirst({
            where: { schoolId: null, templateKey: row.templateKey },
        });
        if (existing)
            continue;
        await prisma.communicationTemplate.create({
            data: {
                schoolId: null,
                templateKey: row.templateKey,
                name: row.name,
                subjectTemplate: row.subjectTemplate,
                bodyTemplate: row.bodyTemplate,
                isActive: true,
            },
        });
    }
}
