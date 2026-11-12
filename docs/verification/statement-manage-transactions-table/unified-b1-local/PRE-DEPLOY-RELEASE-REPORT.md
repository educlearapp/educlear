# Unified B1 — Final pre-deployment release report

**Verdict: CONDITIONAL PASS — ready for owner deploy approval after release commit excludes DEV-only files**  
**Deployed:** **NO** — stopped for explicit owner approval  
**Date:** 2026-11-12  
**Verification method:** Authenticated Render CLI (`render services` / `render deploys list`) — read-only; no credential extraction; no deploys/restarts/settings/data changes

---

## 1. Production deployment status (live)

| Service | Service ID | Live commit | Deploy ID | Auto-deploy |
|---------|------------|-------------|-----------|-------------|
| **educlear-backend** | `srv-d6j8jvma2pns7397bghg` | `de5bac189b7860c026007fddc5d5cfd28ecac125` | `dep-dbqom1rrjlhs73a174dg` | **`no`** |
| **educlear-frontend** | `srv-d6j8svruibrs73age3d0` | `70b6740504af1b4dc38459aac6f4f33b94c653d8` | `dep-dbqp40m7bikc73aok370` | **`no`** |

Notes:
- Backend message: statement layout on live production base.  
- Frontend message: Kid-e-Sys Family Account transactions table.  
- Staging services also report `autoDeploy: no` (not part of this release pair).

---

## 2. Ancestry and rollback targets

| Item | Value |
|------|--------|
| FE live parent | `de5bac1…` (backend live) — **FE contains all BE live history** |
| Unified B1 worktree HEAD | `70b6740…` (= FE live tip) + **uncommitted B1 WIP** |
| Includes all current production changes? | **YES** — candidate is FE live + B1 delta only; no missing live commits |
| **Rollback if B1 FE+BE pair ships** | Redeploy **both** to `de5bac189b7860c026007fddc5d5cfd28ecac125` (pre–table-redesign pair) **or** FE→`70b6740` / BE→`de5bac1` if only rolling back B1 calc after a paired B1 deploy |
| **Current production pair rollback (today)** | FE → `de5bac1…`; BE already at `de5bac1…` |
| Older layout rollback | `603c1ece67628cbbcba86397a498e8ca81efb7b8` |

**Auto-deploy:** remains **OFF** on both production services.

---

## 3. Release scope (approved B1 only)

### Include in release commit

| Path | Role |
|------|------|
| `backend/src/services/statementAgeBaseline.ts` | Shared age-baseline helpers |
| `backend/src/services/statementAgeBaseline.b1.test.ts` | Unit test |
| `backend/src/services/statementTransactionBuilder.ts` | Shared B1 Manage+PDF builder |
| `backend/src/services/statementAccountTransactions.ts` | Mac Manage API wiring |
| `backend/src/services/statementPdfData.ts` | PDF input wiring (all PDF callers) |
| `backend/src/services/statementPdfService.ts` | Display-row section / chronoSeq order |
| `backend/src/services/statementPdfTypes.ts` | Section / chronoSeq types |
| `frontend/src/billing/StatementManage.tsx` | BBF display in Transactions |
| `frontend/src/billing/billingApi.ts` | BBF row typing |
| `frontend/src/billing/statementDocument.ts` | FE PDF display-row section order |
| Docs / verify script under `docs/verification/.../unified-b1-local/` | Evidence only |

### Exclude from release (must not ship)

| Path | Reason |
|------|--------|
| `frontend/src/App.tsx` DEV route | Local preview only |
| `frontend/src/dev/**` | Fixtures / B1 preview |
| `backend/storage/billing-ledger-production-backup-*.json` symlink | Local verify aid |

No ledger / Age Analysis / invoice / payment / credit / permission / RBAC / Prisma migration changes in the B1 delta.

---

## 4. Shared calculation — caller audit

Single source when Age Analysis snap exists:

`buildStatementManageTransactionsWithAgeBaseline` ← Manage API **and** `buildStatementTransactions` (PDF)

| Surface | Entry | Uses shared B1? |
|---------|-------|-----------------|
| Mac Transactions | `GET /api/statements/transactions` → `buildAccountStatementTransactions` | **Yes** |
| Download / print PDF | `buildAndGenerateStatementPdf` ← `routes/statements.ts` | **Yes** |
| Email statement | `statementEmailService` → `buildAndGenerateStatementPdf` | **Yes** |
| Bulk / invoice-run PDF | `invoiceRunStatementsPdfService` → `buildAndGenerateStatementPdf` | **Yes** |
| Parent portal PDF | `routes/parentPortal.ts` → `buildAndGenerateStatementPdf` | **Yes** |
| Non-migrated accounts | No age snap → legacy path | Unchanged |

Historical + labelled Age Analysis BBF: confirmed locally (Mac page-2 boundary screenshot; PDF section order historical → BBF → active).

---

## 5. Regression tests

| Test | Result | Notes |
|------|--------|-------|
| `statementAgeBaseline.b1.test.ts` | **PASS** | Clarified B1 unit |
| `verify-unified-b1-mac-pdf-local.ts` | **PASS** | 344/344; SIL007 −3000; WOL001 3190.70; Mac↔PDF match |
| `statementAmountFormat.test.ts` | **PASS** | |
| `invoiceRunStatementsPdf.stress.test.ts` | **PASS** | 340 + 500 synthetic |
| `bulkStatementEmailJobSafety.unit.test.ts` | **PASS** | |
| `bulkStatementEmailJobService.unit.test.ts` | **PASS** | |
| `frontend tsc -b` | **PASS** | |
| `billingStatementDisplay.test.ts` (tsx) | **PASS** | Vitest “no suite” noise only — script-style test |
| `bulkStatementSendLogic.test.ts` (tsx) | **PASS** | Same |

No B1-related functional test failures observed.

---

## 6. Snapshot distinction (mandatory)

| Evidence class | What it is | What it is **not** |
|----------------|------------|---------------------|
| **October freeze** | `billing-ledger-production-backup-2026-10-26T07-40-16Z-pre-d71309c.json` + local Age Analysis | Live November production ledger |
| **November overlays** | In-memory only: SIL007 R450 (2026-11-04), WOL001 R3,000 (2026-11-06) for target Summary checks | Authorised November production snapshot |
| **Production verification** | **Not performed** for Nov live balances in this report | — |

SIL007 −R3,000 / WOL001 R3,190.70 targets are **overlay-assisted local checks**, not live production freeze proof.

---

## 7. Gate checklist

| # | Gate | Status |
|---|------|--------|
| 1 | Scope = approved running-balance reconciliation only | **PASS** (if DEV files excluded at commit) |
| 2 | Shared calc Mac + all PDF paths | **PASS** |
| 3 | Historical + labelled Age Analysis BBF | **PASS** (local evidence) |
| 4 | No financial records / auth balances / permissions / unrelated features | **PASS** |
| 5 | Live SHAs + ancestry + rollback + auto-deploy OFF | **PASS** |
| 6 | Relevant regression tests | **PASS** |
| 7 | Oct vs Nov overlay vs production clearly distinguished | **PASS** |
| — | Release commit created / pushed | **NOT DONE** (WIP uncommitted) |
| — | Production deploy | **NOT DONE** |

---

## Overall

**CONDITIONAL PASS** for deploy readiness:

1. Create a clean release commit from FE live `70b6740` + B1 files only (**exclude** DEV App route / `frontend/src/dev` / ledger symlink).  
2. Deploy **backend + frontend together** from that commit.  
3. Rollback plan: pair back to `de5bac1` (or FE `70b6740` + BE `de5bac1` if rolling back only B1 after a paired ship).  
4. Auto-deploy stays **OFF**.

**STOP — awaiting explicit owner production approval. No deploy performed.**
