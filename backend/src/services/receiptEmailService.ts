import PDFDocument from "pdfkit";

import { sendEmailWithAttachment } from "../routes/emailService";
import { prisma } from "../prisma";
import {
  listPaymentAllocations,
  type StoredPaymentAllocation,
} from "../utils/paymentAllocationStore";
import {
  listPayments,
  normaliseAmount,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { loadSchoolLogoBuffer, toAbsoluteSchoolLogoUrl } from "../utils/schoolLogo";

const FEE_CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration",
  school_fees: "School Fees",
  transport: "Transport",
  leadership_camp: "Leadership Camp",
  uniform: "Uniform",
  stationery: "Stationery",
  aftercare: "Aftercare",
  other_fees: "Other Fees",
  account_credit: "Account Credit",
};

type ReceiptParentContact = {
  name: string;
  email: string;
  relationship: string;
};

type ReceiptSchoolBranding = {
  name: string;
  email?: string;
  phone?: string;
  logoUrl?: string;
};

export type ReceiptEmailResult = {
  messageId?: string;
  to: string;
  receiptNumber: string;
};

function feeCategoryLabel(key: string | null | undefined): string {
  const k = String(key || "").trim();
  if (!k) return "Allocation";
  return FEE_CATEGORY_LABELS[k] || k.replace(/_/g, " ");
}

function formatMoney(value: unknown): string {
  return `R ${normaliseAmount(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parentDisplayName(parent: { firstName?: string | null; surname?: string | null }) {
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent / Guardian";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadReceiptSchoolBranding(schoolId: string): Promise<ReceiptSchoolBranding> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true, email: true, phone: true, cellNo: true, logoUrl: true },
  });
  return {
    name: String(school?.name || "School").trim() || "School",
    email: String(school?.email || "").trim() || undefined,
    phone: String(school?.phone || school?.cellNo || "").trim() || undefined,
    logoUrl: String(school?.logoUrl || "").trim() || undefined,
  };
}

async function resolveLearnersForAccount(schoolId: string, accountRef: string) {
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!ref) return [];

  const byAccountRef = await prisma.learner.findMany({
    where: { schoolId, familyAccount: { accountRef: ref } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true } },
    },
    orderBy: { lastName: "asc" },
  });
  if (byAccountRef.length) return byAccountRef;

  const family = await prisma.familyAccount.findFirst({
    where: { schoolId, accountRef: ref },
    select: { id: true },
  });
  if (!family) return [];

  return prisma.learner.findMany({
    where: { schoolId, familyAccountId: family.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true } },
    },
    orderBy: { lastName: "asc" },
  });
}

function learnerName(learner: { firstName?: string | null; lastName?: string | null }) {
  return `${learner.firstName || ""} ${learner.lastName || ""}`.trim();
}

async function resolveReceiptParentContact(
  schoolId: string,
  learnerIds: string[],
  accountRef: string
): Promise<ReceiptParentContact | null> {
  const ids = learnerIds.map((id) => String(id || "").trim()).filter(Boolean);
  const candidates: {
    parent: {
      id: string;
      firstName: string | null;
      surname: string | null;
      email: string | null;
      communicationBilling: boolean;
      communicationByEmail: boolean;
    };
    link: {
      isPrimary: boolean;
      isPayingPerson: boolean;
      billingReceipt: boolean;
      relation: string | null;
    };
    score: number;
  }[] = [];

  if (ids.length) {
    const links = await prisma.parentLearnerLink.findMany({
      where: { schoolId, learnerId: { in: ids } },
      include: {
        parent: {
          select: {
            id: true,
            firstName: true,
            surname: true,
            email: true,
            communicationBilling: true,
            communicationByEmail: true,
          },
        },
      },
    });

    for (const link of links) {
      const email = String(link.parent.email || "").trim();
      if (!email) continue;
      if (link.billingReceipt === false) continue;
      if (link.parent.communicationBilling === false) continue;
      if (link.parent.communicationByEmail === false) continue;
      candidates.push({
        parent: link.parent,
        link,
        score:
          (link.isPayingPerson ? 20 : 0) +
          (link.isPrimary ? 10 : 0) +
          4,
      });
    }
  }

  const ref = String(accountRef || "").trim().toUpperCase();
  const familyParents = ref
    ? await prisma.parent.findMany({
        where: { schoolId, familyAccount: { accountRef: ref } },
        select: {
          id: true,
          firstName: true,
          surname: true,
          email: true,
          relationship: true,
          communicationBilling: true,
          communicationByEmail: true,
        },
      })
    : [];

  for (const parent of familyParents) {
    const email = String(parent.email || "").trim();
    if (!email) continue;
    if (parent.communicationBilling === false) continue;
    if (parent.communicationByEmail === false) continue;
    candidates.push({
      parent,
      link: {
        isPrimary: false,
        isPayingPerson: false,
        billingReceipt: true,
        relation: parent.relationship,
      },
      score: 2,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    name: parentDisplayName(best.parent),
    email: String(best.parent.email || "").trim(),
    relationship: String(best.link.relation || "Parent"),
  };
}

function receiptPdfFilename(payment: BillingLedgerEntry) {
  const receiptNumber = String(payment.reference || payment.id || "receipt").trim();
  return `receipt-${receiptNumber.replace(/[^\w.-]+/g, "_")}.pdf`;
}

export async function generatePaymentReceiptPdfBuffer(input: {
  schoolId: string;
  payment: BillingLedgerEntry;
  allocations?: StoredPaymentAllocation[];
  school?: ReceiptSchoolBranding;
  learnerNames?: string[];
}): Promise<Buffer> {
  const school = input.school || (await loadReceiptSchoolBranding(input.schoolId));
  const allocations = input.allocations ?? listPaymentAllocations(input.schoolId, input.payment.id);
  const learnerNames = input.learnerNames || [];
  const logoBuf = await loadSchoolLogoBuffer(school.logoUrl);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    if (logoBuf) {
      try {
        doc.image(logoBuf, 50, 42, { fit: [72, 72] });
      } catch (err) {
        console.warn("[receipt-email] receipt logo embed failed:", err);
      }
    }
    doc.fontSize(13).text(school.name, 132, 48, { width: 280 });
    const contactLine = [school.email, school.phone]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(" · ");
    if (contactLine) doc.fontSize(9).text(contactLine, 132, 66, { width: 280 });
    doc.fontSize(18).text("Payment Receipt", 50, 106, { align: "center" });
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`Receipt: ${input.payment.reference || input.payment.id}`);
    doc.text(`Account: ${input.payment.accountNo || ""}`);
    if (learnerNames.length) doc.text(`Learner(s): ${learnerNames.join(", ")}`);
    doc.text(`Date: ${input.payment.date || ""}`);
    doc.text(`Reference: ${input.payment.reference || input.payment.id}`);
    doc.text(`Amount: ${formatMoney(input.payment.amount)}`);
    doc.text(`Method: ${input.payment.method || "Payment"}`);
    doc.moveDown();
    doc.text("Allocations:");
    if (!allocations.length) {
      doc.text("  (No line allocations recorded)");
    } else {
      for (const row of allocations) {
        const label = row.invoiceId ? `Invoice ${row.invoiceId}` : feeCategoryLabel(row.feeCategory);
        doc.text(`  ${label}: ${formatMoney(row.allocatedAmount)}`);
      }
    }
    doc.end();
  });
}

function buildReceiptEmailHtml(input: {
  school: ReceiptSchoolBranding;
  contact: ReceiptParentContact;
  payment: BillingLedgerEntry;
  learnerNames: string[];
}) {
  const logoUrl = toAbsoluteSchoolLogoUrl(input.school.logoUrl);
  const schoolName = escapeHtml(input.school.name);
  const receiptNumber = escapeHtml(input.payment.reference || input.payment.id);
  const learnerLine = input.learnerNames.length
    ? `<p style="margin:0 0 10px"><strong>Learner(s):</strong> ${escapeHtml(input.learnerNames.join(", "))}</p>`
    : "";
  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" style="display:block;max-width:120px;max-height:96px;object-fit:contain;margin:0 auto 14px" />`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f0ea;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f0ea;padding:28px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e8e2d6;border-radius:14px;overflow:hidden">
          <tr>
            <td style="background:#111827;padding:22px 28px;text-align:center">
              ${logoBlock}
              <div style="font-size:20px;font-weight:900;color:#d4af37">${schoolName}</div>
            </td>
          </tr>
          <tr><td style="height:4px;background:#d4af37;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr>
            <td style="padding:28px;font-size:15px;line-height:1.65">
              <p style="margin:0 0 14px">Dear ${escapeHtml(input.contact.name)},</p>
              <p style="margin:0 0 14px">Receipt ${receiptNumber} has been saved and is attached to this email.</p>
              ${learnerLine}
              <p style="margin:0 0 10px"><strong>Account:</strong> ${escapeHtml(input.payment.accountNo)}</p>
              <p style="margin:0 0 10px"><strong>Amount:</strong> ${escapeHtml(formatMoney(input.payment.amount))}</p>
              <p style="margin:0 0 10px"><strong>Payment method:</strong> ${escapeHtml(input.payment.method || "Payment")}</p>
              <p style="margin:18px 0 0">Kind regards,<br />${schoolName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendSavedPaymentReceiptEmail(input: {
  schoolId: string;
  paymentId: string;
}): Promise<ReceiptEmailResult> {
  const schoolId = String(input.schoolId || "").trim();
  const paymentId = String(input.paymentId || "").trim();
  if (!schoolId || !paymentId) {
    throw new Error("Missing schoolId or paymentId");
  }

  const payment = listPayments(schoolId).find((row) => row.id === paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  const accountRef = String(payment.accountNo || "").trim().toUpperCase();
  const [school, learners, allocations] = await Promise.all([
    loadReceiptSchoolBranding(schoolId),
    resolveLearnersForAccount(schoolId, accountRef),
    Promise.resolve(listPaymentAllocations(schoolId, paymentId)),
  ]);

  const learnerNames = learners.map(learnerName).filter(Boolean);
  const contact = await resolveReceiptParentContact(
    schoolId,
    learners.map((learner) => learner.id),
    accountRef
  );
  if (!contact?.email) {
    const err = new Error("No parent email found for this account.") as Error & { noParentEmail?: boolean };
    err.noParentEmail = true;
    throw err;
  }

  const pdfBuffer = await generatePaymentReceiptPdfBuffer({
    schoolId,
    payment,
    allocations,
    school,
    learnerNames,
  });
  const magic = pdfBuffer.subarray(0, 5).toString("utf8");
  if (!magic.startsWith("%PDF")) {
    throw new Error("Receipt PDF could not be generated.");
  }

  const receiptNumber = String(payment.reference || payment.id).trim();
  const result = await sendEmailWithAttachment({
    schoolId,
    to: contact.email,
    subject: `${school.name} - Receipt ${receiptNumber}`,
    html: buildReceiptEmailHtml({ school, contact, payment, learnerNames }),
    attachments: [
      {
        filename: receiptPdfFilename(payment),
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return {
    messageId: (result as { messageId?: string })?.messageId,
    to: contact.email,
    receiptNumber,
  };
}
