# SIL007 — Summary vs running balance investigation (read-only)

**Date:** 2026-11-12  
**Account:** SIL007 (Da Silva · `cmpideqeq0000108xb6ouv9zi`)  
**Scope:** Investigation only — **no ledger writes, no calc changes, no deploy**

Owner observation (production UI after frontend table redesign):

| Figure | Value |
|--------|------:|
| Summary balance | **−R3,000.00** (Overpaid) |
| Latest txn | 2026-11-04 payment **−R450.00** |
| Latest running balance | **R54,600.00** |
| Difference (running − summary) | **R57,600.00** |

---

## 1. Data sources and calculation methods

### Summary balance (authoritative)

**Source:** Kid-e-Sys Age Analysis snapshot + live EduClear ledger delta  
**Code:** `resolveAuthoritativeAccountBalanceFromSnapshot` in `backend/src/services/statementAccounts.ts`  
**UI binding:** Statement list / Family Account `selected.balance` → Summary (unchanged by redesign)

```text
authoritative = ageSnapshot.balance + sum(postImportEntries)
```

For Da Silva sentinel `importedAt = 2099-12-31…`:

- Imported `kideesys-transaction` rows are **non-posting** (`countsTowardPostImportBalanceDelta` / `isNonPostingImportedLedgerEntry`) → **excluded** from delta  
- `kidesys_topup` also excluded under sentinel (`isTopupLedgerPaymentAlreadyInAgeBaseline`)  
- Only live EduClear postings (manual / bank_import / empty-source EduClear invoices, etc.) add to the age balance

SIL007 Age Analysis record (`family-account-age-analysis.json`):

| Field | Value |
|-------|--------|
| `accountRef` | SIL007 |
| `accountHolder` | Adrien Martins Da Silva |
| `balance` | **−45,600** |
| `kidesysSection` | Over Paid |
| `source` | `kideesys-age-analysis` |
| `importedAt` | `2099-12-31T23:59:59.999Z` (sentinel) |
| Opening-balance ledger row | **None** |

Implied live delta from owner Summary −R3,000:

```text
live_delta = −3,000 − (−45,600) = +42,600
```

### Transaction running balances

**Source:** Statement Manage / PDF builder rolls a running total over **statement-visible ledger rows**  
**Code:** `buildStatementManageTransactions` in `backend/src/services/statementTransactionBuilder.ts`

```text
running = openingBalance   # All Time → 0 (no migration opening row for SIL007)
for each visible posting row (including kideesys-transaction + top-up):
  running += signed(amount)   # invoice/penalty +, payment −
```

Imported history **does** advance the running column, even though those same rows are excluded from the Summary/authoritative balance.

Frontend redesign (`70b6740`) only **formats** `row.balance` from the API (`formatStatementTableMoney`). It does **not** recalculate balances.

---

## 2. Exact explanation of the R57,600 discrepancy

Same dual-identity structure as WOL001’s R3,500.

### Import-era identity (constant residual)

From local production ledger backups (history rows stable across June / Oct-26 / current repo ledger):

| Component | Net |
|-----------|----:|
| Age Analysis balance | **−R45,600.00** |
| Imported `kideesys-transaction` net (52 rows) | **+R12,000.00** |
| `kidesys_topup` for SIL007 | **R0.00** (none) |
| **Residual = age − (history + top-up)** | **−R57,600.00** |

There is **no** ledger row for R57,600. It is the mismatch between:

1. Kid-e-Sys **Age Analysis balance field** (−45,600), and  
2. Net of imported **transaction history** (+12,000)

### Why live UI numbers still differ by exactly R57,600

Live activity moves Summary and last running **together**:

```text
Summary      = age + live_delta
Last running = (history + top-up) + live_delta
────────────────────────────────────────────
Summary − last running = age − (history + top-up) = −57,600
```

With owner figures:

```text
live_delta     = −3,000 − (−45,600) = +42,600
last running   = 12,000 + 42,600    = 54,600   ← matches observed
54,600 − (−3,000)                 = 57,600   ← matches observed gap
```

Oct-26 backup check (pre–Nov payment): auth ≈ −R2,550, last run ≈ R55,050, gap still **−R57,600**.

---

## 3. Same transactions / dates / account scope?

| Layer | Scope |
|-------|--------|
| Summary | Age baseline for **SIL007** + **live** EduClear postings only |
| Running | **All Time** statement-visible SIL007 ledger including imported history |
| Shared | Live EduClear invoices/payments/penalties after import |
| Not shared in balance math | Imported `kideesys-transaction` (in running, not in Summary delta) |

No migration opening-balance row exists for SIL007, so All Time running starts at **0**, not at Age Analysis.

---

## 4. Did the frontend redesign introduce this?

**No.**

- Redesign commit `70b6740` changes presentation only (`StatementManage.tsx` columns / signed amount display).  
- Running values still come from existing backend builder / API `balance` field.  
- Residual **R57,600** is present on Oct-26 production ledger backup vs Age Analysis — **before** this redesign.  
- Same class of issue already documented for **WOL001** (R3,500) under statement layout redesign verification.

The new table made the mismatch **more visible** (compact Amount + Balance columns, signed payments).

---

## 5. Comparison with WOL001 and other accounts

| Account | Age | History+top-up net | Residual (age − hist/top-up) |
|---------|----:|-------------------:|-----------------------------:|
| **SIL007** | −45,600 | +12,000 | **−57,600** |
| **WOL001** | +3,670 | +170 | **+3,500** |

Using Oct-26 production ledger backup vs current Age Analysis (344 snapshot accounts):

| Metric | Count |
|--------|------:|
| Accounts with non-zero residual (≥ R1) | **210** |
| Accounts with \|residual\| ≥ R100 | **210** |

So this is **not** SIL007-only; it is a widespread Kid-e-Sys age-vs-history identity issue. SIL007 currently has the **largest** \|residual\| in that scan.

---

## 6. Can latest running be reconciled via opening-balance **presentation** only?

**Yes, in principle — display/calc presentation only; no stored balance changes.**  
(Requires separate owner approval before any implementation.)

Safest evidenced options (same family as WOL001 B1/B2 notes):

### Option A — Seed running from Age Analysis (recommended direction)

1. Keep Summary = authoritative (age + live) — **do not change**.  
2. Treat imported `kideesys-transaction` as informational for running (null / “—”), **or** show them but do not advance running.  
3. Seed live running from Age Analysis baseline (−45,600 at import era), then apply only live postings.  
4. Last running converges to Summary (−3,000 today).  

No ledger writes; residual becomes an explicit baseline, not a silent gap.

### Option B — Statement-only reconciling line

Insert a **non-ledger** display line for residual **−R57,600** labeled e.g.  
`Kid-e-Sys Age Analysis vs imported history residual`, then continue running as today so last running = Summary.

### Not acceptable (out of scope / forbidden here)

- Changing Summary / Age Analysis / ledger amounts  
- Artificial invoice/payment/credit to “fix” the gap  
- Deploying calc changes without owner approval  

---

## 7. Verdict

| Question | Answer |
|----------|--------|
| Summary source | Age Analysis (−45,600) + live delta → **−R3,000** |
| Running source | Sum of visible ledger from **0**, including imported history → **R54,600** |
| R57,600 source | Constant residual **age − history net** = −45,600 − 12,000 |
| Pre-existing? | **Yes** — redesign exposed it |
| Other accounts? | **~210** with non-zero residual on Oct-26 vs age scan |
| Opening-balance presentation fix? | **Supported by evidence**; await owner approval |

**STOP — no code or deploy changes from this investigation.**
