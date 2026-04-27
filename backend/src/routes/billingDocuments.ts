import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { computeStatementBalances } from "../billing/statementBalances";
import { sendSchoolEmail } from "../email/schoolEmailSender";

const router = express.Router();

type DocumentType = "LETTER_OF_DEMAND" | "SECTION_41_NOTICE" | "FINAL_LETTER_OF_DEMAND";

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function parseIsoDate(value: unknown, field: string): Date {
  const s = asString(value);
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) throw new Error(`${field} must be a valid ISO date`);
  return d;
}

function money2(n: number) {
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toFixed(2);
}

function formatCurrencyZar(amount: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);
  } catch {
    return `R${money2(n)}`;
  }
}

function toDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function subjectForType(t: DocumentType) {
  switch (t) {
    case "SECTION_41_NOTICE":
      return "EduClear - Section 41 Notice";
    case "FINAL_LETTER_OF_DEMAND":
      return "EduClear - Final Letter of Demand";
    default:
      return "EduClear - Letter of Demand";
  }
}

function headingForType(t: DocumentType) {
  switch (t) {
    case "SECTION_41_NOTICE":
      return "SECTION 41 NOTICE";
    case "FINAL_LETTER_OF_DEMAND":
      return "FINAL LETTER OF DEMAND";
    default:
      return "LETTER OF DEMAND";
  }
}

function wordingForType(t: DocumentType, input: { totalOutstanding: string; overdue: string; deadline: string }) {
  const common = `
    <p style="margin: 0 0 12px;">
      This letter serves as formal correspondence regarding your school fee account.
    </p>
    <p style="margin: 0 0 12px;">
      <strong>Current total outstanding balance:</strong> ${input.totalOutstanding}<br/>
      <strong>Overdue balance:</strong> ${input.overdue}
    </p>
    <p style="margin: 0 0 12px;">
      Kindly ensure full settlement of the outstanding amount by <strong>${input.deadline}</strong>.
    </p>
  `.trim();

  if (t === "SECTION_41_NOTICE") {
    return `
      <p style="margin: 0 0 12px;">
        <strong>Notice in terms of Section 41</strong>
      </p>
      ${common}
      <p style="margin: 0 0 12px;">
        If payment is not received by the deadline, the school may proceed with further steps in line with its policies,
        which may include restricting access to certain services or escalating the matter for additional action.
      </p>
      <p style="margin: 0;">
        If you have already made payment, please disregard this notice and forward proof of payment to the school office.
      </p>
    `.trim();
  }

  if (t === "FINAL_LETTER_OF_DEMAND") {
    return `
      ${common}
      <p style="margin: 0 0 12px;">
        This is a final letter of demand. Failure to settle the outstanding balance by the deadline may result in the
        matter being escalated in accordance with school policy and applicable procedures.
      </p>
      <p style="margin: 0;">
        Please contact the school should you require a payment arrangement proposal for consideration.
      </p>
    `.trim();
  }

  return `
    ${common}
    <p style="margin: 0 0 12px;">
      Should the outstanding balance not be settled by the deadline, the school may take further steps in accordance with
      school policy.
    </p>
    <p style="margin: 0;">
      Please contact the school office if you require clarity or wish to discuss a payment arrangement.
    </p>
  `.trim();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function buildLetterHtml(input: {
  documentType: DocumentType;
  letterDate: Date;
  deadlineDate: Date;
  note?: string | null;
  school: { name: string; address?: string | null; phone?: string | null; email?: string | null; logoUrl?: string | null };
  parent: { fullName: string; email?: string | null; cellNo?: string | null };
  learnerNames: string[];
  accountRef?: string | null;
  balances: { totalOutstanding: number; overdue: number };
}) {
  const heading = headingForType(input.documentType);
  const schoolName = escapeHtml(input.school.name || "School");
  const logoUrl = (input.school.logoUrl || "").trim();
  const schoolAddress = (input.school.address || "").trim();
  const schoolPhone = (input.school.phone || "").trim();
  const schoolEmail = (input.school.email || "").trim();

  const parentName = escapeHtml(input.parent.fullName || "Parent/Guardian");
  const parentEmail = escapeHtml((input.parent.email || "").trim());
  const parentCell = escapeHtml((input.parent.cellNo || "").trim());
  const learners = input.learnerNames.length ? escapeHtml(input.learnerNames.join(", ")) : "—";
  const accountRef = escapeHtml((input.accountRef || "").trim() || "—");

  const letterDate = toDateOnly(input.letterDate);
  const deadline = toDateOnly(input.deadlineDate);

  const totalOutstandingFmt = formatCurrencyZar(input.balances.totalOutstanding);
  const overdueFmt = formatCurrencyZar(input.balances.overdue);

  const wording = wordingForType(input.documentType, {
    totalOutstanding: escapeHtml(totalOutstandingFmt),
    overdue: escapeHtml(overdueFmt),
    deadline: escapeHtml(deadline),
  });

  const note = (input.note || "").trim();
  const noteBlock = note
    ? `<div style="margin-top: 14px; padding: 12px; border: 1px solid #e7dcc4; background: #fff8e1; border-radius: 10px;">
         <div style="font-weight: 800; margin-bottom: 6px;">Note</div>
         <div style="white-space: pre-wrap;">${escapeHtml(note)}</div>
       </div>`
    : "";

  const schoolContactParts = [schoolAddress, schoolPhone ? `Tel: ${schoolPhone}` : "", schoolEmail ? `Email: ${schoolEmail}` : ""]
    .filter(Boolean)
    .map((x) => `<div>${escapeHtml(String(x))}</div>`)
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:24px; background:#f7f4ef; font-family: Arial, Helvetica, sans-serif; color:#111827;">
    <div style="max-width: 820px; margin: 0 auto; background:#ffffff; border:1px solid #ece7dc; border-radius: 16px; overflow:hidden;">
      <div style="padding: 18px 20px; border-bottom: 2px solid #d4af37; display:flex; gap:16px; align-items:center;">
        ${
          logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="School logo" style="width:64px; height:64px; object-fit:contain; border-radius: 10px; background:#fff;" />`
            : `<div style="width:64px; height:64px; border-radius: 10px; background:#111827;"></div>`
        }
        <div style="display:grid; gap:4px;">
          <div style="font-size: 18px; font-weight: 900; letter-spacing: 0.2px;">${schoolName}</div>
          <div style="font-size: 12.5px; color:#475569; line-height: 1.35;">${schoolContactParts || ""}</div>
        </div>
        <div style="margin-left:auto; text-align:right; font-size: 12.5px; color:#475569;">
          <div><strong>Letter date:</strong> ${escapeHtml(letterDate)}</div>
          <div><strong>Payment deadline:</strong> ${escapeHtml(deadline)}</div>
        </div>
      </div>

      <div style="padding: 22px 22px 10px;">
        <div style="font-size: 22px; font-weight: 1000; letter-spacing: 0.5px; margin-bottom: 16px;">${escapeHtml(
          heading
        )}</div>

        <div style="display:grid; gap:10px; border:1px solid #e5e7eb; border-radius: 12px; padding: 14px;">
          <div style="display:flex; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
            <div>
              <div style="font-weight: 900;">To:</div>
              <div>${parentName}</div>
              ${parentEmail ? `<div>${parentEmail}</div>` : ""}
              ${parentCell ? `<div>${parentCell}</div>` : ""}
            </div>
            <div style="text-align:right;">
              <div><strong>Account no/reference:</strong> ${accountRef}</div>
              <div><strong>Learner(s):</strong> ${learners}</div>
            </div>
          </div>
        </div>

        <div style="margin-top: 16px; font-size: 14px; line-height: 1.55; color:#111827;">
          ${wording}
          ${noteBlock}
        </div>
      </div>

      <div style="padding: 14px 22px 22px; color:#475569; font-size: 12px; border-top:1px solid #f1f5f9;">
        This document was generated by EduClear for internal school administration purposes.
      </div>
    </div>
  </body>
</html>`;
}

router.get("/overdue-accounts", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, address: true, phone: true, email: true, logoUrl: true },
    });
    if (!school) return res.status(404).json({ ok: false, error: "School not found" });

    const parents = await prisma.parent.findMany({
      where: { schoolId, outstandingAmount: { gt: 0 } },
      orderBy: [{ outstandingAmount: "desc" }, { surname: "asc" }, { firstName: "asc" }],
      include: {
        familyAccount: true,
        links: { include: { learner: true } },
      },
      take: 5000,
    });

    const parentIds = parents.map((p) => p.id);
    const [invoices, payments, lastPayments] = await Promise.all([
      parentIds.length
        ? prisma.invoice.findMany({
            where: { schoolId, parentId: { in: parentIds } },
            select: {
              id: true,
              parentId: true,
              invoiceDate: true,
              dueDate: true,
              amountCents: true,
              createdAt: true,
              lines: { select: { id: true, description: true, amountCents: true, sortOrder: true, dueDate: true } },
            },
            orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
            take: 200000,
          })
        : [],
      parentIds.length
        ? prisma.payment.findMany({
            where: { schoolId, parentId: { in: parentIds } },
            select: { parentId: true, amount: true, createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 200000,
          })
        : [],
      parentIds.length
        ? prisma.payment.groupBy({
            by: ["parentId"],
            where: { schoolId, parentId: { in: parentIds } },
            _max: { createdAt: true },
          })
        : [],
    ]);

    const invoicesByParentId = new Map<string, any[]>();
    for (const inv of invoices as any[]) {
      const pid = String(inv.parentId || "");
      if (!pid) continue;
      const list = invoicesByParentId.get(pid) ?? [];
      list.push(inv);
      invoicesByParentId.set(pid, list);
    }

    const paymentsByParentId = new Map<string, any[]>();
    for (const p of payments as any[]) {
      const pid = String(p.parentId || "");
      if (!pid) continue;
      const list = paymentsByParentId.get(pid) ?? [];
      list.push(p);
      paymentsByParentId.set(pid, list);
    }

    const lastPaymentByParentId = new Map<string, Date>();
    for (const row of lastPayments as any[]) {
      if (row?.parentId && row?._max?.createdAt) lastPaymentByParentId.set(row.parentId, row._max.createdAt);
    }

    const accounts = parents
      .map((p) => {
        const learners = Array.isArray(p.links) ? p.links.map((l) => l.learner).filter(Boolean) : [];
        const learnerNames = learners
          .map((l: any) => `${l.firstName || ""} ${l.lastName || ""}`.trim())
          .filter((x: string) => x);

        const computed = computeStatementBalances({
          invoices: invoicesByParentId.get(p.id) ?? [],
          payments: paymentsByParentId.get(p.id) ?? [],
        });

        const totalOutstandingBalance = computed.totalOutstandingBalanceCents / 100;
        const overdueBalance = computed.overdueBalanceCents / 100;

        return {
          parentId: p.id,
          accountId: p.familyAccountId ?? null,
          accountRef: p.familyAccount?.accountRef || null,
          parentName: `${p.firstName || ""} ${p.surname || ""}`.trim(),
          parentEmail: p.email ?? null,
          parentCellNo: p.cellNo ?? null,
          learnerNames,
          totalOutstandingBalance,
          overdueBalance,
          lastPaymentDate: lastPaymentByParentId.get(p.id)?.toISOString() ?? null,
          status: p.status ?? null,
        };
      })
      .filter((a: any) => Number(a.overdueBalance || 0) > 0);

    return res.json({ ok: true, school, accounts });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load overdue accounts" });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const body = req.body ?? {};
    const schoolId = asString(body.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const documentTypeRaw = asString(body.documentType) as DocumentType;
    const documentType: DocumentType =
      documentTypeRaw === "SECTION_41_NOTICE" || documentTypeRaw === "FINAL_LETTER_OF_DEMAND"
        ? documentTypeRaw
        : "LETTER_OF_DEMAND";

    const letterDate = parseIsoDate(body.letterDate, "letterDate");
    const deadlineDate = parseIsoDate(body.deadlineDate, "deadlineDate");
    const note = asString(body.note) || null;
    const dryRun = Boolean(body.dryRun);

    const itemsRaw: any[] = Array.isArray(body.items) ? body.items : [];
    const parentIds: string[] = itemsRaw.map((x: any) => asString(x?.parentId)).filter((x: string) => Boolean(x));
    if (!parentIds.length) return res.status(400).json({ ok: false, error: "At least 1 account is required" });

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, address: true, phone: true, email: true, logoUrl: true },
    });
    if (!school) return res.status(404).json({ ok: false, error: "School not found" });

    const parents = await prisma.parent.findMany({
      where: { schoolId, id: { in: parentIds } },
      include: { familyAccount: true, links: { include: { learner: true } } },
      take: 5000,
    });

    const foundById = new Map<string, any>();
    for (const p of parents as any[]) foundById.set(String(p.id), p);

    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({
        where: { schoolId, parentId: { in: parentIds } },
        select: {
          id: true,
          parentId: true,
          invoiceDate: true,
          dueDate: true,
          amountCents: true,
          createdAt: true,
          lines: { select: { id: true, description: true, amountCents: true, sortOrder: true, dueDate: true } },
        },
        orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
        take: 200000,
      }),
      prisma.payment.findMany({
        where: { schoolId, parentId: { in: parentIds } },
        select: { parentId: true, amount: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 200000,
      }),
    ]);

    const invoicesByParentId = new Map<string, any[]>();
    for (const inv of invoices as any[]) {
      const pid = String(inv.parentId || "");
      if (!pid) continue;
      const list = invoicesByParentId.get(pid) ?? [];
      list.push(inv);
      invoicesByParentId.set(pid, list);
    }

    const paymentsByParentId = new Map<string, any[]>();
    for (const p of payments as any[]) {
      const pid = String(p.parentId || "");
      if (!pid) continue;
      const list = paymentsByParentId.get(pid) ?? [];
      list.push(p);
      paymentsByParentId.set(pid, list);
    }

    const rendered = parentIds.map((parentId) => {
      const parent = foundById.get(parentId);
      if (!parent) throw new Error(`Parent not found for school (${parentId})`);

      const learners = Array.isArray(parent.links) ? parent.links.map((l: any) => l.learner).filter(Boolean) : [];
      const learnerNames = learners
        .map((l: any) => `${l.firstName || ""} ${l.lastName || ""}`.trim())
        .filter((x: string) => x);

      const computed = computeStatementBalances({
        invoices: invoicesByParentId.get(parentId) ?? [],
        payments: paymentsByParentId.get(parentId) ?? [],
      });
      const totalOutstandingBalance = computed.totalOutstandingBalanceCents / 100;
      const overdueBalance = computed.overdueBalanceCents / 100;

      if (!(overdueBalance > 0)) {
        throw new Error(`Selected account is not overdue (${parentId})`);
      }

      const html = buildLetterHtml({
        documentType,
        letterDate,
        deadlineDate,
        note,
        school,
        parent: {
          fullName: `${parent.firstName || ""} ${parent.surname || ""}`.trim(),
          email: parent.email ?? null,
          cellNo: parent.cellNo ?? null,
        },
        learnerNames,
        accountRef: parent.familyAccount?.accountRef ?? null,
        balances: { totalOutstanding: totalOutstandingBalance, overdue: overdueBalance },
      });

      return {
        parentId,
        parentEmail: parent.email ?? null,
        accountId: parent.familyAccountId ?? null,
        accountRef: parent.familyAccount?.accountRef ?? null,
        learnerNames,
        totalOutstandingBalance,
        overdueBalance,
        generatedHtml: html,
      };
    });

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, documentType, school, items: rendered });
    }

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.billingDocumentRun.create({
        data: {
          schoolId,
          documentType,
          letterDate,
          deadlineDate,
          note,
        },
      });

      const createdItems = [];
      for (const it of rendered) {
        const created = await tx.billingDocumentRunItem.create({
          data: {
            runId: run.id,
            schoolId,
            parentId: it.parentId,
            learnerId: null,
            accountId: it.accountId,
            parentEmail: it.parentEmail,
            totalOutstandingBalance: new Prisma.Decimal(money2(it.totalOutstandingBalance)),
            overdueBalance: new Prisma.Decimal(money2(it.overdueBalance)),
            generatedHtml: it.generatedHtml,
            emailStatus: "NOT_SENT",
          },
        });
        createdItems.push({
          id: created.id,
          parentId: created.parentId,
          accountId: created.accountId,
          parentEmail: created.parentEmail,
          totalOutstandingBalance: it.totalOutstandingBalance,
          overdueBalance: it.overdueBalance,
          generatedHtml: created.generatedHtml,
          emailStatus: created.emailStatus,
          sentAt: created.sentAt,
        });
      }

      return { run, createdItems };
    });

    return res.json({
      ok: true,
      dryRun: false,
      run: {
        id: result.run.id,
        schoolId: result.run.schoolId,
        documentType: result.run.documentType,
        letterDate: result.run.letterDate,
        deadlineDate: result.run.deadlineDate,
        note: result.run.note ?? null,
        createdAt: result.run.createdAt,
        itemsCount: result.createdItems.length,
      },
      items: result.createdItems,
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.includes("required") || msg.includes("must be a valid ISO date") || msg.includes("not found") || msg.includes("overdue")) {
      return res.status(400).json({ ok: false, error: msg });
    }
    return res.status(500).json({ ok: false, error: msg || "Failed to generate letters" });
  }
});

router.post("/email", async (req, res) => {
  try {
    const body = req.body ?? {};
    const schoolId = asString(body.schoolId);
    const runId = asString(body.runId);
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((x: any) => asString(x)).filter(Boolean) : [];
    if (!schoolId || !runId || !itemIds.length) {
      return res.status(400).json({ ok: false, error: "schoolId, runId and itemIds are required" });
    }

    const run = await prisma.billingDocumentRun.findFirst({
      where: { id: runId, schoolId },
      select: { id: true, schoolId: true, documentType: true },
    });
    if (!run) return res.status(404).json({ ok: false, error: "Run not found for this school" });
    const subject = subjectForType(run.documentType as DocumentType);

    const items = await prisma.billingDocumentRunItem.findMany({
      where: { id: { in: itemIds }, runId: runId, schoolId },
      select: { id: true, parentId: true, generatedHtml: true, emailStatus: true },
      take: 5000,
    });
    if (!items.length) return res.status(404).json({ ok: false, error: "No matching run items found" });

    const results: any[] = [];

    for (const it of items) {
      if (!it.generatedHtml) {
        results.push({ itemId: it.id, ok: false, error: "Letter not generated yet" });
        continue;
      }
      if (!it.parentId) {
        results.push({ itemId: it.id, ok: false, error: "Missing parent link" });
        continue;
      }

      const parent = await prisma.parent.findFirst({
        where: { id: it.parentId, schoolId },
        select: { id: true, email: true, firstName: true, surname: true },
      });
      if (!parent) {
        results.push({ itemId: it.id, ok: false, error: "Parent not found for school" });
        continue;
      }
      const to = String(parent.email || "").trim();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      if (!to || !emailOk) {
        results.push({ itemId: it.id, ok: false, error: "Parent has no valid email address on file" });
        continue;
      }

      try {
        await sendSchoolEmail(schoolId, {
          to,
          subject,
          html: it.generatedHtml,
          text: `Dear ${parent.firstName || ""} ${parent.surname || ""}`.trim(),
        });

        await prisma.billingDocumentRunItem.update({
          where: { id: it.id },
          data: { emailStatus: "SENT", sentAt: new Date() },
        });

        results.push({ itemId: it.id, ok: true, to });
      } catch (err: any) {
        await prisma.billingDocumentRunItem.update({
          where: { id: it.id },
          data: { emailStatus: "FAILED" },
        });
        results.push({ itemId: it.id, ok: false, error: String(err?.message || "Failed to send") });
      }
    }

    return res.json({ ok: true, results });
  } catch (e: any) {
    const msg = String(e?.message || "Failed to email letters");
    const code = String((e as any)?.code || "");
    const status = code === "EMAIL_NOT_CONFIGURED" ? 503 : 500;
    return res.status(status).json({ ok: false, error: msg });
  }
});

router.get("/runs", async (req, res) => {
  try {
    const schoolId = asString(req.query.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const runs = await prisma.billingDocumentRun.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        _count: { select: { items: true } },
        items: { select: { emailStatus: true } },
      },
    });

    return res.json({
      ok: true,
      runs: runs.map((r: any) => {
        const statuses = Array.isArray(r.items) ? r.items.map((x: any) => String(x.emailStatus || "")) : [];
        const sentCount = statuses.filter((s: string) => s === "SENT").length;
        const failedCount = statuses.filter((s: string) => s === "FAILED").length;
        return {
          id: r.id,
          schoolId: r.schoolId,
          documentType: r.documentType,
          letterDate: r.letterDate,
          deadlineDate: r.deadlineDate,
          note: r.note ?? null,
          createdAt: r.createdAt,
          itemsCount: (r as any)?._count?.items ?? 0,
          sentCount,
          failedCount,
        };
      }),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load runs" });
  }
});

export default router;

