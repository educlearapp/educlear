import type { SupplierInvoice, Supplier } from "@prisma/client";

export type SupplierInvoiceMatchInput = Pick<
  SupplierInvoice,
  "id" | "invoiceNumber" | "totalAmount" | "outstandingAmount" | "supplierId" | "status"
> & {
  supplierName: string;
};

export type SupplierInvoiceMatchResult = {
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  score: number;
  reason: string;
};

function normaliseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function normaliseBlob(description: string, reference: string) {
  return normaliseText(`${description || ""} ${reference || ""}`).replace(/\s+/g, " ").trim();
}

function amountMatches(bankAmount: number, outstanding: number, total: number) {
  const amt = Math.round(bankAmount * 100) / 100;
  const out = Math.round(Number(outstanding) * 100) / 100;
  const tot = Math.round(Number(total) * 100) / 100;
  if (amt <= 0) return false;
  if (Math.abs(amt - out) < 0.02) return true;
  if (Math.abs(amt - tot) < 0.02) return true;
  if (out > 0 && amt <= out + 0.02) return true;
  return false;
}

export function matchSupplierInvoicesForBankLine(
  description: string,
  reference: string,
  amount: number,
  suppliers: Pick<Supplier, "id" | "supplierName">[],
  openInvoices: SupplierInvoiceMatchInput[]
): SupplierInvoiceMatchResult | null {
  const blob = normaliseBlob(description, reference);
  const bankAmount = Math.abs(amount);
  if (!blob || bankAmount <= 0 || !openInvoices.length) return null;

  const supplierById = new Map(suppliers.map((s) => [s.id, s.supplierName]));

  let best: SupplierInvoiceMatchResult | null = null;

  for (const inv of openInvoices) {
    if (inv.status === "paid") continue;
    const outstanding = Number(inv.outstandingAmount);
    if (outstanding <= 0) continue;

    const supplierName = supplierById.get(inv.supplierId) || "";
    let score = 0;
    const reasons: string[] = [];

    const invNo = String(inv.invoiceNumber || "").trim();
    if (invNo.length >= 3) {
      const invKey = normaliseText(invNo).replace(/\s+/g, "");
      const blobCompact = blob.replace(/\s+/g, "");
      if (blobCompact.includes(invKey) || blob.includes(normaliseText(invNo))) {
        score += 50;
        reasons.push(`Invoice number "${invNo}" found`);
      }
    }

    if (supplierName.length >= 3) {
      const nameKey = normaliseText(supplierName).replace(/\s+/g, " ");
      if (nameKey && blob.includes(nameKey)) {
        score += 35;
        reasons.push(`Supplier "${supplierName}" found`);
      }
    }

    if (amountMatches(bankAmount, outstanding, Number(inv.totalAmount))) {
      score += 30;
      reasons.push("Amount matches outstanding balance");
    }

    if (score < 40) continue;

    const hit: SupplierInvoiceMatchResult = {
      invoiceId: inv.id,
      invoiceNumber: invNo,
      supplierId: inv.supplierId,
      supplierName,
      score: Math.min(100, score),
      reason: reasons.join("; "),
    };

    if (!best || hit.score > best.score) best = hit;
  }

  return best;
}

export function suggestSupplierInvoicesForBankLine(
  description: string,
  reference: string,
  amount: number,
  suppliers: Pick<Supplier, "id" | "supplierName">[],
  openInvoices: SupplierInvoiceMatchInput[]
): SupplierInvoiceMatchResult[] {
  const blob = normaliseBlob(description, reference);
  const bankAmount = Math.abs(amount);
  const supplierById = new Map(suppliers.map((s) => [s.id, s.supplierName]));
  const hits: SupplierInvoiceMatchResult[] = [];

  for (const inv of openInvoices) {
    if (inv.status === "paid") continue;
    const outstanding = Number(inv.outstandingAmount);
    if (outstanding <= 0) continue;

    let score = 0;
    const reasons: string[] = [];
    const supplierName = supplierById.get(inv.supplierId) || "";
    const invNo = String(inv.invoiceNumber || "").trim();

    if (invNo.length >= 3 && blob.includes(normaliseText(invNo))) {
      score += 40;
      reasons.push("Invoice number match");
    }
    if (supplierName.length >= 3 && blob.includes(normaliseText(supplierName))) {
      score += 25;
      reasons.push("Supplier name match");
    }
    if (amountMatches(bankAmount, outstanding, Number(inv.totalAmount))) {
      score += 25;
      reasons.push("Amount match");
    }
    if (score < 25) continue;

    hits.push({
      invoiceId: inv.id,
      invoiceNumber: invNo,
      supplierId: inv.supplierId,
      supplierName,
      score: Math.min(100, score),
      reason: reasons.join("; "),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}
