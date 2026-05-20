import { Router } from "express";

import { readSchoolLedger } from "../utils/billingLedgerStore";
import { buildAccountsFromLearners } from "../services/statementAccounts";

const router = Router();

// GET /api/statements?schoolId=...
router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const ledger = readSchoolLedger(schoolId);
    const accounts = await buildAccountsFromLearners(schoolId, ledger);
    return res.json({ success: true, statements: accounts, accounts });
  } catch (error) {
    console.error("[statements] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/statements/accounts?schoolId=...
router.get("/accounts", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const ledger = readSchoolLedger(schoolId);
    const accounts = await buildAccountsFromLearners(schoolId, ledger);
    return res.json({ success: true, accounts });
  } catch (error) {
    console.error("[statements] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
