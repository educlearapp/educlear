# Unified B1 running balances — local reconciliation report

**Status:** LOCAL VERIFY ONLY — **NO DEPLOY**  
**Date:** 2026-11-12  
**Worktree:** `/tmp/educlear-wt-stmt-on-live` (on live FE baseline + local B1)

---

## Owner requirement

Mac/browser Family Account Transactions, downloaded/printed PDFs, and bulk/emailed PDFs must show identical transaction amounts and running balances for the same account, period, and data snapshot — via **one shared calculation**.

---

## Architecture (implemented locally)

| Layer | Behaviour |
|-------|-----------|
| Shared core | `buildStatementManageTransactionsWithAgeBaseline` in `statementTransactionBuilder.ts` |
| Mac Manage API | `statementAccountTransactions.ts` passes `ageAnalysisBaseline` when Age Analysis snap exists |
| PDF / print / download / email / bulk | `buildStatementPdfInput` → `buildStatementTransactions` **delegates to the same Manage B1 builder** when baseline set |
| Non-migrated accounts | No age snap → legacy opening/running path unchanged |
| Stored data | **No** ledger, Age Analysis, invoice, payment, or credit changes |

Clarified B1 rules:

1. Imported history/top-up: reconstructed chronological running within the imported set.  
2. Labelled display-only **Balance brought forward at migration (Age Analysis)**.  
3. Live EduClear postings advance from that BBF → last live running = authoritative Summary.  
4. Summary / closing helpers preserved (`resolveAuthoritativeAccountBalanceFromSnapshot` / age-baseline opening+closing).

Same-day newest-first tie-break uses chronological sequence so the top live row’s running balance is the final closing.

Manage display bands (newest-first within each): **live → labelled Age Analysis BBF → historical** (no date interleaving across bands). PDF remains chronological: historical → BBF → active.

---

## Snapshot used

| Item | Value |
|------|--------|
| Ledger | `billing-ledger-production-backup-2026-10-26T07-40-16Z-pre-d71309c.json` (**authorised October freeze**) |
| Age Analysis | `backend/data/family-account-age-analysis.json` (344 accounts) |
| November targets | **In-memory overlays only** (not an authorised November production freeze): `PAY-20261104-SIL007-001` R450; `PAY-20261106-WOL001-001` R3,000 |

October data is **not** treated as November verification without overlays.

---

## Verification results

Machine JSON: `UNIFIED-B1-VERIFY.json`

| Check | Result |
|-------|--------|
| Fleet 344 Age Analysis accounts — last live running = auth Summary | **344 / 344 PASS** |
| SIL007 Summary / last running | **−R3,000** PASS |
| WOL001 Summary / last running | **R3,190.70** PASS |
| SIL007 Mac ↔ PDF amount/balance fingerprint | **MATCH** |
| WOL001 Mac ↔ PDF amount/balance fingerprint | **MATCH** |
| Opening (BBF) + live postings = closing | PASS (closing helper = auth) |
| Unit test `statementAgeBaseline.b1.test.ts` | **PASS** |
| Production deploy | **NOT DONE** (awaiting owner approval) |

---

## Evidence artefacts

| Artefact | Path |
|----------|------|
| SIL007 Mac preview | `SIL007-mac-b1-preview.png` |
| SIL007 BBF boundary (page 2) | `SIL007-mac-b1-bbf-boundary.png` |
| WOL001 Mac preview | `WOL001-mac-b1-preview.png` |
| SIL007 PDF sample | `SIL007-unified-b1-all-time.pdf` |
| WOL001 PDF sample | `WOL001-unified-b1-all-time.pdf` |
| PDF page-1 thumbnails | `*-page1.png` |
| Machine verify | `UNIFIED-B1-VERIFY.json` |

Local Mac preview route (DEV only):  
`http://127.0.0.1:5177/__local/statement-manage-b1-preview?account=SIL007|WOL001`

---

## Restrictions confirmed

- No stored balance changes  
- No ledger modifications  
- No new invoices / payments / credits persisted  
- No migration data changes  
- No automatic adjustments  
- Approved Summary / PDF chrome preserved (BBF embedded in stream; legacy period BBF flag off when B1 active to avoid double BBF)  
- **No production deployment**

---

## STOP

Awaiting **explicit owner approval** before any deploy (backend + frontend pair).
