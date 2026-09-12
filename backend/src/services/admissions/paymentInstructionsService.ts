/**
 * Applicant payment instructions view (OA-03E).
 * Bank details only after authenticated ownership + formal submission.
 * Fee amount/currency come from the application/fee snapshot — never live settings.
 */
import type { AdmissionPaymentStatus, Prisma, PrismaClient, SchoolAdmissionsSettings } from "@prisma/client";

import { loadOwnedApplicationForApplicant } from "./draftApplicationService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dec(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(2);
}

/** Same completeness rule as OA-03C submit (bankName, holder, number, branch). */
export function isAdmissionsBankConfigComplete(
  settings: Pick<
    SchoolAdmissionsSettings,
    "bankName" | "accountHolder" | "accountNumber" | "branchCode"
  >
): boolean {
  return Boolean(
    clean(settings.bankName) &&
      clean(settings.accountHolder) &&
      clean(settings.accountNumber) &&
      clean(settings.branchCode)
  );
}

export type ApplicantBankDetails = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
  accountType: string | null;
  paymentInstructions: string | null;
};

export type ApplicantProofMeta = {
  id: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
};

export type ApplicantPaymentGuidance = {
  /** Stable machine-readable status guidance key for the SPA. */
  code: string;
  message: string;
  /** True only when the applicant should still make/complete an EFT payment. */
  shouldPay: boolean;
  /** True when uploading/replacing proof of payment is appropriate. */
  canUploadProof: boolean;
};

export type ApplicantPaymentView = {
  applicationNumber: string;
  paymentReference: string | null;
  feeRequired: boolean;
  feeAmount: string | null;
  currency: string;
  paymentStatus: string;
  paymentInstructionsAvailable: boolean;
  bankConfigurationIncomplete: boolean;
  bank: ApplicantBankDetails | null;
  proofOfPayment: {
    uploaded: boolean;
    document: ApplicantProofMeta | null;
  };
  guidance: ApplicantPaymentGuidance;
};

export function buildApplicantPaymentGuidance(input: {
  paymentStatus: AdmissionPaymentStatus | string;
  feeRequired: boolean;
  bankConfigurationIncomplete: boolean;
  proofUploaded: boolean;
}): ApplicantPaymentGuidance {
  const status = String(input.paymentStatus || "");

  if (!input.feeRequired || status === "NOT_REQUIRED") {
    return {
      code: "NOT_REQUIRED",
      message: "No admission fee payment is required for this application.",
      shouldPay: false,
      canUploadProof: false,
    };
  }

  if (status === "WAIVED") {
    return {
      code: "WAIVED",
      message: "The admission fee has been waived for this application. No payment is required.",
      shouldPay: false,
      canUploadProof: false,
    };
  }

  if (status === "VERIFIED") {
    return {
      code: "VERIFIED",
      message:
        "Your admission fee payment has been verified. You do not need to pay again.",
      shouldPay: false,
      canUploadProof: false,
    };
  }

  if (input.bankConfigurationIncomplete) {
    return {
      code: "BANK_CONFIGURATION_INCOMPLETE",
      message:
        "Payment instructions are not available yet. Please contact the school for how to pay the admission fee.",
      shouldPay: false,
      canUploadProof: status === "AWAITING_PAYMENT" || status === "REJECTED" || status === "PROOF_UPLOADED",
    };
  }

  if (status === "REJECTED") {
    return {
      code: "REJECTED",
      message:
        "Your previous proof of payment was not accepted. Please check the payment details and upload a new proof of payment.",
      shouldPay: true,
      canUploadProof: true,
    };
  }

  if (status === "PROOF_UPLOADED" || status === "UNDER_VERIFICATION") {
    return {
      code: status === "UNDER_VERIFICATION" ? "UNDER_VERIFICATION" : "PROOF_UPLOADED",
      message:
        status === "UNDER_VERIFICATION"
          ? "Your proof of payment is being verified. You do not need to pay again unless the school contacts you."
          : "Proof of payment has been received and is awaiting verification. You do not need to pay again unless asked.",
      shouldPay: false,
      canUploadProof: true,
    };
  }

  // AWAITING_PAYMENT and any other payable states
  return {
    code: "AWAITING_PAYMENT",
    message:
      "Please pay the admission fee using the bank details below and use your payment reference exactly as shown. Then upload your proof of payment.",
    shouldPay: true,
    canUploadProof: true,
  };
}

/**
 * GET payment instructions for an owned application.
 * Read-only. Requires formal submission (application number present).
 */
export async function getApplicantPaymentView(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined
): Promise<ApplicantPaymentView> {
  const { app, schoolId, settings } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken
  );

  if (!app.applicationNumber || app.status === "DRAFT") {
    throw new PublicAdmissionsError(
      "Payment instructions are available after you submit your application",
      409,
      "PAYMENT_REQUIRES_SUBMISSION"
    );
  }

  const fee =
    app.feeRecord ||
    (await prisma.admissionFeeRecord.findUnique({ where: { applicationId: app.id } }));

  const feeRequired = Boolean(fee?.required ?? app.feeRequired);
  // Snapshot only — never settings.defaultAdmissionFeeAmount
  const feeAmount = dec(fee?.amount ?? app.feeAmount);
  const currency = clean(fee?.currency) || clean(app.feeCurrency) || "ZAR";
  const paymentStatus = (fee?.paymentStatus || (feeRequired ? "AWAITING_PAYMENT" : "NOT_REQUIRED")) as string;
  const paymentReference = fee?.paymentReference || app.applicationNumber;

  const bankComplete = isAdmissionsBankConfigComplete(settings);
  const bankConfigurationIncomplete = feeRequired && !bankComplete;
  const paymentInstructionsAvailable = feeRequired && bankComplete;

  let bank: ApplicantBankDetails | null = null;
  if (paymentInstructionsAvailable) {
    bank = {
      bankName: clean(settings.bankName),
      accountHolder: clean(settings.accountHolder),
      accountNumber: clean(settings.accountNumber),
      branchCode: clean(settings.branchCode),
      accountType: clean(settings.accountType) || null,
      paymentInstructions: clean(settings.paymentInstructions) || null,
    };
  }

  let proofDoc: ApplicantProofMeta | null = null;
  if (fee?.latestProofDocumentId) {
    const doc = await prisma.admissionDocument.findFirst({
      where: {
        id: fee.latestProofDocumentId,
        applicationId: app.id,
        schoolId,
        deletedAt: null,
        documentType: "proof_of_payment",
      },
      select: {
        id: true,
        originalFileName: true,
        contentType: true,
        byteSize: true,
        uploadedAt: true,
      },
    });
    if (doc) {
      proofDoc = {
        id: doc.id,
        originalFileName: doc.originalFileName,
        contentType: doc.contentType,
        byteSize: doc.byteSize,
        uploadedAt: doc.uploadedAt.toISOString(),
      };
    }
  }

  const proofUploaded = Boolean(proofDoc) || paymentStatus === "PROOF_UPLOADED" || paymentStatus === "UNDER_VERIFICATION" || paymentStatus === "VERIFIED";

  const guidance = buildApplicantPaymentGuidance({
    paymentStatus,
    feeRequired,
    bankConfigurationIncomplete,
    proofUploaded,
  });

  return {
    applicationNumber: app.applicationNumber,
    paymentReference,
    feeRequired,
    feeAmount,
    currency,
    paymentStatus,
    paymentInstructionsAvailable,
    bankConfigurationIncomplete,
    bank,
    proofOfPayment: {
      uploaded: Boolean(proofDoc) || ["PROOF_UPLOADED", "UNDER_VERIFICATION", "VERIFIED"].includes(paymentStatus),
      document: proofDoc,
    },
    guidance,
  };
}
