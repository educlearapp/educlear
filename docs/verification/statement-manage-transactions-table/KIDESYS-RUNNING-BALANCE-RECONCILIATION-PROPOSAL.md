# Kid-e-Sys running-balance reconciliation — investigation & proposal

**Status:** Investigation complete — **not implemented, not deployed**  
**Date:** 2026-11-12  
**Restrictions observed:** No ledger/Age/Summary/PDF-design changes; no artificial financial postings

---

## A. Acceptance identity (target)

For a chosen period and posting scope:

```text
Opening + Σ posting transactions = Closing
Last chronological running balance = Authoritative Summary
```

Signs: invoices/penalties **increase** balance; payments **decrease**; negative = credit.

UI may still show **newest-first**; running must be computed **oldest → newest**.

---

## B. What is wrong today (production Manage / PDF path)

| Layer | Method |
|-------|--------|
| **Summary (authoritative)** | `age.balance + live EduClear delta` (`resolveAuthoritativeAccountBalanceFromSnapshot`) |
| **Running column** | Starts at **0** for All Time; rolls through **imported history + live** |

Imported `kideesys-transaction` (and sentinel `kidesys_topup`) are treated as **already inside Age Analysis** for Summary, but still **advance running**. Whenever:

```text
age.balance ≠ net(imported history + top-up)
```

a **constant residual** appears:

```text
Summary − last_running = age − (history + top-up)
```

Live EduClear activity cancels out of the gap.

---

## C. SIL007 — exact cause of R57,600

### Authoritative data

| Item | Value |
|------|------:|
| Age Analysis | **−R45,600** (Over Paid, sentinel `importedAt`) |
| Owner Summary (live) | **−R3,000** ⇒ implied live delta **+R42,600** |
| Imported history | **52** `kideesys-transaction` rows, net **+R12,000** |
| History date span | **2023-01-11 → 2026-05-15** (no Aug 2026 history rows) |
| Top-up rows | **0** |
| Migration opening ledger row | **None** |
| Residual `age − history` | **−R57,600** |

### Reconstruction of owner UI

```text
last_running = 12,000 + 42,600 = 54,600
54,600 − (−3,000) = 57,600
```

### Why history ≠ Age Analysis (and vs original Kid-e-Sys statement)

Owner evidence: original **15-page** Kid-e-Sys statement (12 Nov 2026 print) ends **18 Aug 2026** at **−R9,000**, with true chronological running (`prev + invoice − payment`).

Imported EduClear history **stops at 15 May 2026** with running-from-zero **+R12,000**.

Checkpoint arithmetic (matches residual exactly):

| Segment | Net |
|---------|----:|
| Import end (+12,000 on 15 May) → original end (−9,000 on 18 Aug) | **−R21,000** |
| Original end (−9,000) → Age Analysis (−45,600) | **−R36,600** |
| **Total missing vs age (if start from 0)** | **−R57,600** |

**Cause:** Age Analysis embeds Kid-e-Sys account position through the migration baseline; the imported transaction copy is **incomplete** relative to that baseline (notably activity after 15 May 2026 visible on the original statement, and further movement through the age cut). This is **missing / truncated history relative to age**, not a Summary calculation bug and not introduced by the table redesign.

*(Original 15-page PDF was not found in the repo/Downloads during this pass; Aug-18 −R9,000 is taken as owner-verified evidence. Line-by-line PDF vs import matching should be run once that file is attached.)*

### Classification findings (imported ledger)

| Class | SIL007 |
|-------|--------|
| Missing vs original/age after 15 May | **Yes** — residual −R57,600 unexplained by imported lines |
| Duplicates in import | Not required to explain residual (52 history lines net cleanly to +12,000) |
| Misclassified | Empty-source EduClear invoice-run rows correctly count as **live** postings |

---

## D. Proposed display-only calculation (no ledger writes)

Align Manage + PDF running with the **existing** authoritative partition already used for Summary.  
Local **B1** design (`statementAgeBaseline.ts` + `buildStatementTransactions` with `ageAnalysisBaseline`) already encodes this for PDF review; **Manage UI is not on B1 in production** (`70b6740` only reformatted amounts).

### Recommended model (B1)

1. **Do not change** Summary / Age Analysis / ledger / permissions / approved table chrome.  
2. Partition rows with existing helpers (`filterPostImportBalanceEntries` / non-posting import rules):  
   - **Historical (baseline-included):** imported history (+ sentinel top-up)  
   - **Live postings:** EduClear activity that already feeds Summary  
3. **Display-only opening / BBF** = Age Analysis baseline for All Time (period variants: age + live before cutoff).  
   Label clearly, e.g. **“Balance brought forward (Kid-e-Sys Age Analysis)”** — **not** posted to `billing-ledger.json`.  
4. Historical lines: show Date/Type/Ref/Description/Amount; **running blank or “—”** (informational; incomplete vs age).  
5. Live lines: chronological running from BBF; invoices + / payments −.  
6. **Last live running = Summary.**  
7. Newest-first UI: sort for display only after computing chronological running.  
8. Optional footer note when `age ≠ history net`:  
   `Imported history is incomplete relative to Age Analysis (residual R…). Account balance follows Age Analysis + live activity.`

### Alternative (continuous running)

Insert a **single display-only** line equal to residual `age − history net`, labelled  
`Kid-e-Sys Age Analysis vs imported history residual` (non-ledger), then roll all visible rows. Last running still = Summary; residual is explicit, not silent.

### Not proposed

- Changing Summary or stored balances  
- Fabricating invoice/payment/credit rows  
- Hiding the residual without labelling  
- Deploy without owner approval  

---

## E. Test results (read-only math on Oct-26 production ledger backup + current age JSON)

Identity checked: `B1_last = age + live = auth` and `display_adj + history + live = auth`.

| Account | Auth (freeze) | Current last run | Gap | B1 OK | Display adj |
|---------|--------------:|-----------------:|----:|:-----:|------------:|
| **SIL007** | −2,550 | +55,050 | −57,600 | Yes | −57,600 |
| **SIL007** (prod Summary −3,000 reconstructed) | −3,000 | +54,600 | −57,600 | Yes | −57,600 |
| **WOL001** | +6,190.70 | +2,690.70 | +3,500 | Yes | +3,500 |
| ADA004 | +1,600 | +2,640 | −1,040 | Yes | −1,040 |
| BOG005 | 0 | 0 | 0 | Yes | 0 |
| KGA004 | −29,240 | +5,160 | −34,400 | Yes | −34,400 |
| HAI002 | +9,750 | +1,350 | +8,400 | Yes | +8,400 |
| MAN012 | −7,200 | −13,250 | +6,050 | Yes | +6,050 |
| MAD001 | *(no age snap in file)* | — | — | N/A (pure ledger) | — |

Fleet (344 age accounts on that freeze): **B1 reconciles 344/344**; **210** have non-zero residual under the current (broken) running method.

Prior B1 local review JSON already showed SIL007 credit reconciling (`B1-owing-credit-zero.json`: auth = lastRunning = −2,550 on Oct-26 freeze).

---

## F. Risks

| Risk | Mitigation |
|------|------------|
| Historical section no longer shows a continuous Kid-e-Sys-style running through incomplete import | Label BBF; optional residual note; original PDF remains the full historical story |
| Users expect every history line to carry a balance | Explain incomplete import; blank running on history is honest |
| Scope creep into financial “fixes” | Keep Summary/ledger untouched; statement/Manage presentation only |
| PDF vs Manage divergence if only one path updated | Apply same builder rules to **Manage transactions API** and PDF |
| Original 15-page PDF not yet line-matched | Attach PDF for formal missing-row inventory before implementation sign-off |

---

## G. Implementation scope (when approved — not now)

1. Wire Manage `/api/statements/transactions` (and PDF if not already) through B1 baseline path.  
2. Preserve approved Kid-e-Sys table columns, Summary card, PDF visual layout, permissions.  
3. Regression: SIL007, WOL001, ADA004/BOG005/KGA004 sample, plus a non-age account.  
4. Owner approval required before deploy.

---

## H. Verdict

| Question | Answer |
|----------|--------|
| Exact cause of R57,600 | Age (−45,600) vs incomplete imported history (+12,000 through 15 May only) |
| Original statement role | Ends −R9,000 on 18 Aug — proves history continued after import cut; arithmetic closes residual |
| Redesign fault? | **No** — presentation exposed dual identity |
| Can running reconcile to Summary without changing Summary? | **Yes** — display-only BBF = age; live-only running (B1) |
| Ready to implement? | **Awaiting owner approval** |

**STOP.**
