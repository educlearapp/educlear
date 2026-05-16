import { Router } from "express";

const router = Router();

const DOCUMENT_CATALOG = [
  {
    id: "invoices",
    name: "Invoices",
    description: "Print or email learner invoices.",
    actions: ["print", "send", "manage"],
  },
  {
    id: "statements",
    name: "Statements",
    description: "Bulk send statement of account to parent contacts.",
    actions: ["print", "send", "manage"],
  },
  {
    id: "late-penalty-fine",
    name: "Late Penalty Fine",
    description: "Apply a late payment penalty to overdue accounts.",
    actions: ["print", "send", "manage"],
  },
  {
    id: "section-41-notice",
    name: "Section 41 Notice",
    description: "Formal overdue notice for school-fee recovery (Section 41 context).",
    actions: ["print", "send", "manage"],
  },
  {
    id: "letter-of-demand",
    name: "Letter of Demand",
    description: "Stern 7-day demand for overdue school fees.",
    actions: ["print", "send", "manage"],
  },
  {
    id: "final-demand",
    name: "Final Demand",
    description: "Final 48-hour demand before handover for recovery.",
    actions: ["print", "send", "manage"],
  },
];

router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    return res.json({ success: true, schoolId, documents: DOCUMENT_CATALOG });
  } catch (error) {
    console.error("[billing-documents] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/send-statements", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const schoolId = String(body.schoolId || "").trim();
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    const simulate = body.simulate !== false;

    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const results = contacts.map((raw: any) => {
      const email = String(raw?.email || "").trim();
      const accountNo = String(raw?.accountNo || "").trim();
      const contactName = String(raw?.contactName || raw?.name || "").trim();
      if (!email) {
        return {
          contactName,
          email: "",
          accountNo,
          status: "Failed",
          error: "Missing email",
        };
      }
      if (!accountNo || accountNo === "-") {
        return {
          contactName,
          email,
          accountNo,
          status: "Failed",
          error: "Unassigned account number",
        };
      }
      if (simulate) {
        return {
          contactName,
          email,
          accountNo,
          attachment: raw?.attachment || `statement-${accountNo}.pdf`,
          status: "Sent",
        };
      }
      return {
        contactName,
        email,
        accountNo,
        attachment: raw?.attachment || `statement-${accountNo}.pdf`,
        status: "Ready",
      };
    });

    return res.json({ success: true, results });
  } catch (error) {
    console.error("[billing-documents] POST /send-statements failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
