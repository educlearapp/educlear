"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGoLiveMode = isGoLiveMode;
exports.isProductionRuntime = isProductionRuntime;
exports.isProductionOrGoLive = isProductionOrGoLive;
/** Owner-requested go-live: unlock dashboard + billing without migration gates. */
function isGoLiveMode() {
    return String(process.env.EDU_CLEAR_GO_LIVE || "").trim().toLowerCase() === "true";
}
/** True on Render and other production hosts (not local dev). */
function isProductionRuntime() {
    if (process.env.NODE_ENV === "production")
        return true;
    if (String(process.env.RENDER || "").trim())
        return true;
    if (String(process.env.RENDER_SERVICE_ID || "").trim())
        return true;
    return false;
}
/** Production host or explicit go-live flag (local smoke tests). */
function isProductionOrGoLive() {
    return isProductionRuntime() || isGoLiveMode();
}
