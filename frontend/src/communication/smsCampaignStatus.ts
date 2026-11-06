/**
 * Display status for a stored Communication Centre SMS.
 * Historical rows are not rewritten. "Delivered" is used only when every
 * stored recipient already has provider delivery evidence.
 */

export type SmsCampaignContact = {
  status?: string | null;
  statusDetail?: string | null;
};

const PROVIDER_STATUSES = new Set(["Accepted", "Rejected", "Unknown", "Failed", "Pending", "Delivered"]);

export type DescribedSmsCampaign = {
  label: string;
  detail: string;
  tone: "accepted" | "partial" | "rejected" | "unconfirmed" | "delivered" | "stored";
};

function reasonKey(detail: string): string {
  const cleaned = detail.replace(/\d{6,}/g, "").replace(/\s+/g, " ").trim();
  const coded = cleaned.match(/\(([^)]+)\)/);
  return (coded?.[1] || cleaned).replace(/[.\s]+$/g, "").trim();
}

export function describeCommunicationSmsCampaign(record: {
  status?: string | null;
  contacts?: SmsCampaignContact[] | null;
}): DescribedSmsCampaign {
  const contacts = Array.isArray(record.contacts) ? record.contacts : [];
  const counts = { accepted: 0, rejected: 0, failed: 0, pending: 0, unknown: 0, delivered: 0 };
  const reasons = new Map<string, number>();
  let providerKnown = 0;
  for (const contact of contacts) {
    const status = String(contact?.status || "");
    if (!PROVIDER_STATUSES.has(status)) continue;
    providerKnown += 1;
    if (status === "Accepted") counts.accepted += 1;
    else if (status === "Rejected") counts.rejected += 1;
    else if (status === "Failed") counts.failed += 1;
    else if (status === "Pending") counts.pending += 1;
    else if (status === "Unknown") counts.unknown += 1;
    else if (status === "Delivered") counts.delivered += 1;
    if ((status === "Rejected" || status === "Failed") && contact?.statusDetail) {
      const key = reasonKey(String(contact.statusDetail));
      if (key) reasons.set(key, (reasons.get(key) || 0) + 1);
    }
  }

  if (!providerKnown) {
    const stored = String(record.status || "Unknown");
    const detail =
      stored === "Sent"
        ? "No provider recipient result is stored. This is not a delivery receipt."
        : "";
    return { label: stored, detail, tone: "stored" };
  }

  const positive = counts.accepted + counts.delivered;
  const negative = counts.rejected + counts.failed;
  const open = counts.pending + counts.unknown;
  let label = "Pending or unconfirmed";
  let tone: DescribedSmsCampaign["tone"] = "unconfirmed";
  if (counts.delivered > 0 && counts.delivered === providerKnown && negative === 0 && open === 0) {
    label = "Delivered";
    tone = "delivered";
  } else if (positive > 0 && (negative > 0 || open > 0)) {
    label = "Partially accepted";
    tone = "partial";
  } else if (positive > 0) {
    label = "Accepted by provider";
    tone = "accepted";
  } else if (negative > 0 && open === 0) {
    label = "All rejected";
    tone = "rejected";
  }

  const parts = [
    counts.accepted ? `${counts.accepted} accepted` : "",
    counts.delivered ? `${counts.delivered} delivered` : "",
    counts.rejected ? `${counts.rejected} rejected` : "",
    counts.failed ? `${counts.failed} failed` : "",
    counts.pending ? `${counts.pending} pending` : "",
    counts.unknown ? `${counts.unknown} unconfirmed` : "",
  ].filter(Boolean);
  const reasonText = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`)
    .join("; ");
  return {
    label,
    detail: reasonText ? `${parts.join(", ")}. ${reasonText}` : parts.join(", "),
    tone,
  };
}
