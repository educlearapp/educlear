# GO / NO-GO — Family Account Transactions table (Kid-e-Sys style)

**Date:** 2026-11-12  
**Branch:** `feature/statement-manage-transactions-kidesys-table`  
**Deploy:** **NOT authorised yet — stop after this report**

## Release commit

- **Branch tip SHA:** run `git rev-parse HEAD` on `feature/statement-manage-transactions-kidesys-table` (do not trust an embedded hash after amend).
- **Parent / live base:** `de5bac189b7860c026007fddc5d5cfd28ecac125`
- **Changed application file:** `frontend/src/billing/StatementManage.tsx` (+ verification docs under `docs/verification/statement-manage-transactions-table/`)
- **Backend files:** none

## Live production baseline (Render metadata)

| Service | ID | Live commit | Auto-deploy |
|---|---|---|---|
| educlear-backend | `srv-d6j8jvma2pns7397bghg` | `de5bac189b7860c026007fddc5d5cfd28ecac125` | **no / off** |
| educlear-frontend | `srv-d6j8svruibrs73age3d0` | `de5bac189b7860c026007fddc5d5cfd28ecac125` | **no / off** |

**Rollback target (current live):** `de5bac189b7860c026007fddc5d5cfd28ecac125`  
Previous deactivated pair: `603c1ece67628cbbcba86397a498e8ca81efb7b8`

## Release scope

| Item | Status |
|---|---|
| Base | Latest verified live `de5bac1` |
| Code change | **Frontend only** — `frontend/src/billing/StatementManage.tsx` presentation |
| Backend / migrations / ledger / calcs | **None** |
| Approved statement PDF design | **Unchanged** |
| HomeSafe | **Unchanged** |
| Summary card | **Byte-identical vs `de5bac1`** |

## Application integration verification (real `StatementManage`)

Not the standalone HTML mock. Real React screen via Vite + `StatementManage` with authorised read-only WOL001 evidence (`WOL001-original-parsed-rows.json` / Age Analysis Summary balance R3 500).

| Check | Result |
|---|---|
| Columns Date \| Type \| Ref \| Description \| Amount \| Balance | **PASS** |
| Dark ink headers `#111827` | **PASS** |
| Payments negative (`-R…`), invoices/penalties positive (`R…`) | **PASS** |
| Running balances preserved (e.g. `-R309.30`, `R2,690.70`) — no recalculation | **PASS** |
| Newest-first (`PAY-20261106-WOL001-001` first) | **PASS** |
| Summary: learner, R 3 500,00, Recently Owing, Account WOL001 | **PASS** |
| Manage / Undo enable after row select; Show corrections / audit present | **PASS** |
| Desktop + mobile screenshots | **PASS** |

Evidence:

- `family-account-app-integration-desktop.png`
- `family-account-app-integration-desktop-selected.png`
- `family-account-app-integration-mobile.png`
- `APP-INTEGRATION-EVIDENCE.json`

## Build / tests

| Check | Result |
|---|---|
| `frontend` `npm run build` | **PASS** (recorded on this branch) |
| `billingStatementDisplay.test.ts` (tsx) | **PASS** |
| `statementAccountIdentity.test.ts` (tsx) | **PASS** |
| `statementSourceAgnostic.test.ts` (tsx) | **PASS** |

## Recommendation

**GO for owner-authorised frontend-only deploy** of this release commit onto live `de5bac1`, with rollback to `de5bac1` if needed.

**NO-GO for deploy in this step** — awaiting explicit owner deployment authorisation.
