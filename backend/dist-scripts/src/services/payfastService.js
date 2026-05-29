"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayFastConfigError = exports.PAYFAST_SANDBOX_HOST = exports.PAYFAST_LIVE_HOST = void 0;
exports.generatePayFastSignature = generatePayFastSignature;
exports.formatPayFastAmount = formatPayFastAmount;
exports.resolvePayFastHost = resolvePayFastHost;
exports.getMissingPayFastEnvVars = getMissingPayFastEnvVars;
exports.isPayFastConfigured = isPayFastConfigured;
exports.loadPayFastConfig = loadPayFastConfig;
exports.buildPayFastCheckout = buildPayFastCheckout;
exports.buildItnParamString = buildItnParamString;
exports.verifyPayFastItnSignature = verifyPayFastItnSignature;
exports.isPayFastNotifySourceIp = isPayFastNotifySourceIp;
exports.confirmPayFastItnWithServer = confirmPayFastItnWithServer;
exports.isPayFastPaymentComplete = isPayFastPaymentComplete;
exports.isPayFastPaymentFailed = isPayFastPaymentFailed;
exports.amountsMatch = amountsMatch;
exports.splitSchoolContactName = splitSchoolContactName;
exports.addOneCalendarMonth = addOneCalendarMonth;
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = __importDefault(require("dns/promises"));
const url_1 = require("url");
exports.PAYFAST_LIVE_HOST = "www.payfast.co.za";
exports.PAYFAST_SANDBOX_HOST = "sandbox.payfast.co.za";
const PAYFAST_VALID_HOSTS = [
    exports.PAYFAST_LIVE_HOST,
    exports.PAYFAST_SANDBOX_HOST,
    "w1w.payfast.co.za",
    "w2w.payfast.co.za",
];
/** Checkout fields in PayFast documentation order (not alphabetical). */
const CHECKOUT_SIGNATURE_FIELD_ORDER = [
    "merchant_id",
    "merchant_key",
    "return_url",
    "cancel_url",
    "notify_url",
    "name_first",
    "name_last",
    "email_address",
    "cell_number",
    "m_payment_id",
    "amount",
    "item_name",
    "item_description",
    "custom_int1",
    "custom_int2",
    "custom_int3",
    "custom_int4",
    "custom_int5",
    "custom_str1",
    "custom_str2",
    "custom_str3",
    "custom_str4",
    "custom_str5",
    "email_confirmation",
    "confirmation_address",
    "payment_method",
];
class PayFastConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "PayFastConfigError";
    }
}
exports.PayFastConfigError = PayFastConfigError;
function encodePayFastValue(value) {
    return encodeURIComponent(String(value).trim()).replace(/%20/g, "+");
}
function buildParamStringFromOrderedFields(data, fieldOrder) {
    const parts = [];
    for (const key of fieldOrder) {
        const value = data[key];
        if (value !== undefined && value !== "") {
            parts.push(`${key}=${encodePayFastValue(value)}`);
        }
    }
    return parts.join("&");
}
function generatePayFastSignature(data, passphrase, fieldOrder = CHECKOUT_SIGNATURE_FIELD_ORDER) {
    let paramString = buildParamStringFromOrderedFields(data, fieldOrder);
    if (passphrase) {
        paramString += `&passphrase=${encodePayFastValue(passphrase)}`;
    }
    return crypto_1.default.createHash("md5").update(paramString).digest("hex");
}
function formatPayFastAmount(amountCents) {
    return (amountCents / 100).toFixed(2);
}
function resolvePayFastHost(merchantId, notifyUrl) {
    try {
        const notifyHost = new url_1.URL(notifyUrl).hostname.toLowerCase();
        if (notifyHost.includes("sandbox.payfast")) {
            return exports.PAYFAST_SANDBOX_HOST;
        }
        if (notifyHost === "localhost" ||
            notifyHost === "127.0.0.1" ||
            notifyHost.includes("ngrok")) {
            return exports.PAYFAST_SANDBOX_HOST;
        }
    }
    catch {
        // fall through
    }
    if (String(merchantId || "").trim() === "10000100") {
        return exports.PAYFAST_SANDBOX_HOST;
    }
    return exports.PAYFAST_LIVE_HOST;
}
function getMissingPayFastEnvVars() {
    const merchantId = String(process.env.PAYFAST_MERCHANT_ID || "").trim();
    const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || "").trim();
    const passphrase = String(process.env.PAYFAST_PASSPHRASE || "").trim();
    const returnUrl = String(process.env.PAYFAST_RETURN_URL || "").trim();
    const cancelUrl = String(process.env.PAYFAST_CANCEL_URL || "").trim();
    const notifyUrl = String(process.env.PAYFAST_NOTIFY_URL || "").trim();
    const missing = [];
    if (!merchantId)
        missing.push("PAYFAST_MERCHANT_ID");
    if (!merchantKey)
        missing.push("PAYFAST_MERCHANT_KEY");
    if (!passphrase)
        missing.push("PAYFAST_PASSPHRASE");
    if (!returnUrl)
        missing.push("PAYFAST_RETURN_URL");
    if (!cancelUrl)
        missing.push("PAYFAST_CANCEL_URL");
    if (!notifyUrl)
        missing.push("PAYFAST_NOTIFY_URL");
    return missing;
}
function isPayFastConfigured() {
    return getMissingPayFastEnvVars().length === 0;
}
function loadPayFastConfig() {
    const missing = getMissingPayFastEnvVars();
    const merchantId = String(process.env.PAYFAST_MERCHANT_ID || "").trim();
    const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || "").trim();
    const passphrase = String(process.env.PAYFAST_PASSPHRASE || "").trim();
    const returnUrl = String(process.env.PAYFAST_RETURN_URL || "").trim();
    const cancelUrl = String(process.env.PAYFAST_CANCEL_URL || "").trim();
    const notifyUrl = String(process.env.PAYFAST_NOTIFY_URL || "").trim();
    if (missing.length > 0) {
        throw new PayFastConfigError(`Missing PayFast environment variables: ${missing.join(", ")}`);
    }
    const host = resolvePayFastHost(merchantId, notifyUrl);
    return {
        merchantId,
        merchantKey,
        passphrase,
        returnUrl,
        cancelUrl,
        notifyUrl,
        host,
        processUrl: `https://${host}/eng/process`,
        validateUrl: `https://${host}/eng/query/validate`,
    };
}
function buildPayFastCheckout(input) {
    const config = loadPayFastConfig();
    const amount = formatPayFastAmount(input.amountCents);
    const basePayload = {
        merchant_id: config.merchantId,
        merchant_key: config.merchantKey,
        return_url: config.returnUrl,
        cancel_url: config.cancelUrl,
        notify_url: config.notifyUrl,
        name_first: input.payerFirstName,
        name_last: input.payerLastName,
        email_address: input.payerEmail,
        m_payment_id: input.merchantPaymentId,
        amount,
        item_name: input.itemName,
    };
    if (input.itemDescription) {
        basePayload.item_description = input.itemDescription;
    }
    if (input.payerCell) {
        basePayload.cell_number = input.payerCell;
    }
    if (input.customStr1) {
        basePayload.custom_str1 = input.customStr1;
    }
    if (input.customStr2) {
        basePayload.custom_str2 = input.customStr2;
    }
    if (input.customStr3) {
        basePayload.custom_str3 = input.customStr3;
    }
    const signature = generatePayFastSignature(basePayload, config.passphrase);
    const payload = { ...basePayload, signature };
    return {
        paymentUrl: config.processUrl,
        payload,
    };
}
function buildItnParamString(postData) {
    const parts = [];
    for (const [key, rawValue] of Object.entries(postData)) {
        if (key === "signature") {
            break;
        }
        const value = String(rawValue ?? "").replace(/\\/g, "");
        parts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`);
    }
    return parts.join("&");
}
function verifyPayFastItnSignature(postData, passphrase) {
    const receivedSignature = String(postData.signature || "").trim().toLowerCase();
    if (!receivedSignature) {
        return false;
    }
    const paramString = buildItnParamString(postData);
    const expected = crypto_1.default
        .createHash("md5")
        .update(`${paramString}&passphrase=${encodePayFastValue(passphrase)}`)
        .digest("hex");
    return receivedSignature === expected;
}
let cachedValidPayFastIps = null;
async function loadValidPayFastIps() {
    if (cachedValidPayFastIps) {
        return cachedValidPayFastIps;
    }
    const ips = new Set();
    for (const host of PAYFAST_VALID_HOSTS) {
        try {
            const resolved = await promises_1.default.lookup(host, { all: true });
            for (const entry of resolved) {
                ips.add(entry.address);
            }
        }
        catch (error) {
            console.warn(`[payfast] Failed to resolve ${host}:`, error);
        }
    }
    cachedValidPayFastIps = [...ips];
    return cachedValidPayFastIps;
}
async function isPayFastNotifySourceIp(clientIp) {
    const normalizedIp = String(clientIp || "")
        .trim()
        .replace(/^::ffff:/, "");
    if (!normalizedIp) {
        return false;
    }
    const validIps = await loadValidPayFastIps();
    return validIps.includes(normalizedIp);
}
async function confirmPayFastItnWithServer(paramString, host) {
    const validateUrl = `https://${host}/eng/query/validate`;
    const response = await fetch(validateUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: paramString,
    });
    const body = (await response.text()).trim();
    return body === "VALID";
}
function isPayFastPaymentComplete(paymentStatus) {
    return String(paymentStatus || "").trim().toUpperCase() === "COMPLETE";
}
function isPayFastPaymentFailed(paymentStatus) {
    const status = String(paymentStatus || "").trim().toUpperCase();
    return status === "FAILED" || status === "CANCELLED";
}
function amountsMatch(expectedCents, amountGross) {
    const expected = expectedCents / 100;
    const received = Number.parseFloat(String(amountGross || "0"));
    if (!Number.isFinite(received)) {
        return false;
    }
    return Math.abs(expected - received) <= 0.01;
}
function splitSchoolContactName(schoolName) {
    const parts = String(schoolName || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length === 0) {
        return { first: "School", last: "Admin" };
    }
    if (parts.length === 1) {
        return { first: parts[0], last: "Admin" };
    }
    return {
        first: parts[0],
        last: parts.slice(1).join(" "),
    };
}
function addOneCalendarMonth(from) {
    const result = new Date(from);
    result.setMonth(result.getMonth() + 1);
    return result;
}
