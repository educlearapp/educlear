"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppPlaceholder = sendWhatsAppPlaceholder;
async function sendWhatsAppPlaceholder(ctx) {
    void ctx;
    return { ok: true, simulated: true, reference: `whatsapp:${ctx.messageId}` };
}
