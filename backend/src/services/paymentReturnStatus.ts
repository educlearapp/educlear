/**
 * PayFast browser-return status (read-only). No secrets / rawNotify exposure.
 */
import {
  SchoolSubscriptionStatus,
  SubscriptionPaymentStatus,
} from "@prisma/client";

import { readModularPaymentIntent } from "./modularPayfastCheckout";

export type PaymentReturnPaymentStatus = "PENDING" | "PAID" | "FAILED" | "UNKNOWN";
export type PaymentReturnActivationStatus =
  | "PENDING"
  | "ACTIVE"
  | "FAILED"
  | "NOT_FOUND";

export type PaymentReturnStatusView = {
  paymentStatus: PaymentReturnPaymentStatus;
  activationStatus: PaymentReturnActivationStatus;
  commercialSku: string | null;
  billingCycle: "MONTHLY" | "ANNUAL" | null;
  uiState: "activated" | "pending" | "unconfirmed";
};

export function mapPaymentLogStatus(
  status: SubscriptionPaymentStatus | string | null | undefined
): PaymentReturnPaymentStatus {
  const key = String(status || "").trim().toUpperCase();
  if (key === "PAID") return "PAID";
  if (key === "FAILED") return "FAILED";
  if (key === "PENDING") return "PENDING";
  return "UNKNOWN";
}

/**
 * Derive safe UI state from payment log + subscription row (tenant already authorized).
 */
export function resolvePaymentReturnStatusView(input: {
  paymentFound: boolean;
  paymentStatus: SubscriptionPaymentStatus | string | null | undefined;
  subscriptionStatus: SchoolSubscriptionStatus | string | null | undefined;
  rawRequest: unknown;
}): PaymentReturnStatusView {
  if (!input.paymentFound) {
    return {
      paymentStatus: "UNKNOWN",
      activationStatus: "NOT_FOUND",
      commercialSku: null,
      billingCycle: null,
      uiState: "unconfirmed",
    };
  }

  const paymentStatus = mapPaymentLogStatus(input.paymentStatus);
  const intent = readModularPaymentIntent(input.rawRequest);
  const commercialSku = intent?.commercialSku ?? null;
  const billingCycle = intent?.billingCycle ?? null;
  const sub = String(input.subscriptionStatus || "").trim().toUpperCase();

  if (paymentStatus === "FAILED") {
    return {
      paymentStatus,
      activationStatus: "FAILED",
      commercialSku,
      billingCycle,
      uiState: "unconfirmed",
    };
  }

  if (paymentStatus === "PAID" && sub === "ACTIVE") {
    return {
      paymentStatus,
      activationStatus: "ACTIVE",
      commercialSku,
      billingCycle,
      uiState: "activated",
    };
  }

  // PayFast return happened / checkout exists but ITN not confirmed yet.
  return {
    paymentStatus,
    activationStatus: "PENDING",
    commercialSku,
    billingCycle,
    uiState: "pending",
  };
}
