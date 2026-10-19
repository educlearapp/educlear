/**
 * Per-recipient WinSMS acceptance for Communication Centre SMS.
 * HTTP 200 is not treated as acceptance. Existing history rows are not rewritten here.
 */

export type CommunicationSmsRecipientStatus =
  | "Accepted"
  | "Rejected"
  | "Unknown"
  | "Failed"
  | "Pending"
  | "Delivered";

export type CommunicationSmsCampaignStatus = "Sent" | "Failed" | "Unknown";

export type ClassifiedCommunicationContact = {
  contactId: string;
  status: CommunicationSmsRecipientStatus | "Failed";
  /** Short staff-facing reason. No phone numbers. */
  detail: string | null;
};

export type CommunicationSmsAcceptanceSummary = {
  contacts: ClassifiedCommunicationContact[];
  accepted: number;
  rejected: number;
  unknown: number;
  pending: number;
  delivered: number;
  failed: number;
  campaignStatus: CommunicationSmsCampaignStatus;
};

type PreparedContact = { contactId: string; clientMessageId: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function providerRows(response: unknown): unknown[] {
  const data = asRecord(response);
  if (!data) return [];
  const rows: unknown[] = [];
  if (Array.isArray(data.recipients)) rows.push(...data.recipients);
  if (Array.isArray(data.messages)) {
    for (const message of data.messages) {
      const recipients = asRecord(message)?.recipients;
      if (Array.isArray(recipients)) rows.push(...recipients);
    }
  }
  return rows;
}

const SUCCESSFUL_DELIVERY = new Set(["delivered", "delivrd", "delivery success", "delivery successful", "delivered to handset"]);
const FAILED_DELIVERY = new Set([
  "undelivered",
  "undeliv",
  "delivery failed",
  "failed",
  "rejected",
  "expired",
  "not delivered",
]);
const PENDING_DELIVERY = new Set(["pending", "queued", "submitted", "buffered", "delivery pending"]);

function normaliseProviderStatus(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function deliveryMark(row: Record<string, unknown>): "delivered" | "pending" | "failed" | null {
  const raw = normaliseProviderStatus(row.deliveryStatus || row.statusDescription || "");
  if (!raw) return null;
  if (SUCCESSFUL_DELIVERY.has(raw)) return "delivered";
  if (FAILED_DELIVERY.has(raw) || raw.startsWith("undeliver")) return "failed";
  if (PENDING_DELIVERY.has(raw)) return "pending";
  return null;
}

function statusForRow(row: Record<string, unknown> | null): { status: CommunicationSmsRecipientStatus; detail: string | null } {
  const delivery = row ? deliveryMark(row) : null;
  if (!row || (row.accepted !== true && row.accepted !== false && !delivery)) {
    return {
      status: "Unknown",
      detail: "WinSMS did not say whether this recipient was accepted. Do not send this contact again until sent history is checked.",
    };
  }
  if (row.accepted === false) {
    const code = String(row.acceptError || "")
      .replace(/[^A-Za-z0-9 _.-]/g, "")
      .trim()
      .slice(0, 40);
    return {
      status: "Rejected",
      detail: code ? `WinSMS rejected this recipient (${code}).` : "WinSMS rejected this recipient.",
    };
  }
  if (delivery === "failed") {
    return {
      status: "Failed",
      detail: "WinSMS reported that this message was not delivered.",
    };
  }
  if (delivery === null && row.accepted === true && normaliseProviderStatus(row.deliveryStatus || row.statusDescription)) {
    return {
      status: "Unknown",
      detail: "WinSMS returned a delivery status EduClear does not recognise. It was not marked delivered.",
    };
  }
  if (delivery === "delivered") {
    return { status: "Delivered", detail: "WinSMS reported this recipient as delivered." };
  }
  if (delivery === "pending") {
    return {
      status: "Pending",
      detail: "WinSMS accepted this recipient and delivery is still pending. This is not a handset receipt.",
    };
  }
  if (row.accepted === true) {
    return {
      status: "Accepted",
      detail: "WinSMS accepted this recipient. This is not a handset delivery receipt.",
    };
  }
  return {
    status: "Unknown",
    detail: "WinSMS did not say whether this recipient was accepted. Do not send this contact again until sent history is checked.",
  };
}

function matchRow(rows: unknown[], prepared: PreparedContact, index: number): Record<string, unknown> | null {
  const byId = rows.find((row) => String(asRecord(row)?.clientMessageId || "") === prepared.clientMessageId);
  if (byId) return asRecord(byId);
  if (rows.length === 1 && prepared) return asRecord(rows[0]);
  const sameIndex = rows[index];
  const indexed = asRecord(sameIndex);
  if (indexed && !indexed.clientMessageId) return indexed;
  return null;
}

export function classifyCommunicationSmsSend(input: {
  prepared: PreparedContact[];
  invalidContactIds?: string[];
  providerResponse?: unknown;
  providerError?: { statusCode?: number } | null;
}): CommunicationSmsAcceptanceSummary {
  const contacts: ClassifiedCommunicationContact[] = [];
  for (const contactId of input.invalidContactIds || []) {
    contacts.push({
      contactId,
      status: "Failed",
      detail: "This number could not be used, so it was not sent to WinSMS.",
    });
  }

  const errorCode = Number(input.providerError?.statusCode || 0);
  const providerFailed = Boolean(input.providerError);
  const rows = providerRows(input.providerResponse);

  for (let index = 0; index < input.prepared.length; index += 1) {
    const prepared = input.prepared[index];
    if (providerFailed) {
      const uncertain = !errorCode || errorCode >= 500 || errorCode === 408 || errorCode === 429;
      contacts.push(
        uncertain
          ? {
              contactId: prepared.contactId,
              status: "Unknown",
              detail:
                "WinSMS did not return a result for this recipient. The message may already have been submitted, so it was not marked rejected.",
            }
          : {
              contactId: prepared.contactId,
              status: "Rejected",
              detail: "WinSMS refused the send before accepting this recipient.",
            }
      );
      continue;
    }
    if (!rows.length) {
      contacts.push({
        contactId: prepared.contactId,
        status: "Unknown",
        detail:
          "WinSMS returned a response without a recipient result. HTTP success was not treated as acceptance.",
      });
      continue;
    }
    const matched = statusForRow(matchRow(rows, prepared, index));
    contacts.push({ contactId: prepared.contactId, ...matched });
  }

  const count = (status: CommunicationSmsRecipientStatus | "Failed") =>
    contacts.filter((contact) => contact.status === status).length;
  const accepted = count("Accepted");
  const rejected = count("Rejected");
  const unknown = count("Unknown");
  const pending = count("Pending");
  const delivered = count("Delivered");
  const failed = count("Failed");
  const campaignStatus: CommunicationSmsCampaignStatus =
    accepted + delivered > 0 ? "Sent" : pending + unknown > 0 ? "Unknown" : "Failed";

  return { contacts, accepted, rejected, unknown, pending, delivered, failed, campaignStatus };
}
