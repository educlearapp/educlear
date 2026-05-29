"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushPlaceholder = sendPushPlaceholder;
/** Web Push delivery — future: load subscriptions by parentId and fan out. */
async function sendPushPlaceholder(ctx) {
    void ctx;
    return { ok: true, simulated: true, reference: `push:${ctx.messageId}` };
}
