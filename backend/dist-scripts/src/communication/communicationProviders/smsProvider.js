"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSmsPlaceholder = sendSmsPlaceholder;
async function sendSmsPlaceholder(ctx) {
    void ctx;
    return { ok: true, simulated: true, reference: `sms:${ctx.messageId}` };
}
