import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";

type AccountRow = {
  parentId: string;
  accountRef: string | null;
  name: string;
  outstandingBalance: number;
  overdueBalance?: number;
  nextDueDate?: string | null;
  lastPaymentDate: string | null;
  familyAccountId: string | null;
};

type UiRow = AccountRow & {
  selected: boolean;
  fineAmount: number;
};

function money(value: number) {
  const n = Number(value || 0);
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatDateOrDash(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-ZA");
}

export default function LatePaymentFines() {
  const schoolId = useSchoolId();

  const [description, setDescription] = useState("Late payment fine");
  const [fineAmount, setFineAmount] = useState<number>(50);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [rows, setRows] = useState<UiRow[]>([]);
  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);

  async function loadAccounts() {
    if (!schoolId) {
      setError("No school selected.");
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const data = (await apiFetch(
        `/api/billing/late-fines/accounts?schoolId=${encodeURIComponent(schoolId)}`
      )) as { ok: boolean; accounts?: AccountRow[] };
      const accounts: AccountRow[] = Array.isArray(data?.accounts) ? data.accounts : [];
      setRows(
        accounts.map((a) => ({
          ...a,
          selected: true,
          fineAmount: Number.isFinite(Number(fineAmount)) ? Number(fineAmount) : 0,
        }))
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load accounts";
      setError(msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function applyFine() {
    if (!schoolId) return setError("No school selected.");
    const items = rows.filter((r) => r.selected);
    if (!items.length) return setError("Select at least 1 account.");
    if (!description.trim()) return setError("Fine description is required.");
    if (!invoiceDate) return setError("Invoice date is required.");

    setApplying(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        schoolId,
        description: description.trim(),
        fineAmount: Number(fineAmount),
        invoiceDate,
        note: note.trim() || null,
        items: items.map((r) => ({
          parentId: r.parentId,
          fineAmount: Number(r.fineAmount),
        })),
      };

      const data = (await apiFetch(`/api/billing/late-fines/run`, {
        method: "POST",
        body: JSON.stringify(payload),
      })) as { alreadyApplied?: boolean; summary?: { invoicesCreated?: number } };

      if (data?.alreadyApplied) {
        setInfo("This fine run was already applied (duplicate prevented).");
      } else {
        const created = Number(data?.summary?.invoicesCreated || 0);
        setInfo(`Fine applied. Invoices created: ${created}.`);
      }

      await loadAccounts();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to apply fine";
      setError(msg);
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    setRows((prev) => prev.map((r) => ({ ...r, fineAmount: Number(fineAmount) })));
  }, [fineAmount]);

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            Late Payment Fines
          </h1>
          <div style={{ color: "#64748b", fontWeight: 700, fontSize: 13 }}>
            Apply a once-off fine to accounts with outstanding balances.
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          border: "1px solid rgba(15, 23, 42, 0.12)",
          borderRadius: 8,
          background: "#ffffff",
          padding: 14,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Fine description</div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Late payment fine"
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(15, 23, 42, 0.14)", fontWeight: 800 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Fine amount (R)</div>
            <input
              type="number"
              inputMode="decimal"
              value={String(fineAmount)}
              onChange={(e) => setFineAmount(Number(e.target.value))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(15, 23, 42, 0.14)", fontWeight: 800 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Invoice date</div>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(15, 23, 42, 0.14)", fontWeight: 800 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Optional note</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note shown on invoice"
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(15, 23, 42, 0.14)", fontWeight: 800 }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn-gold" onClick={loadAccounts} disabled={loading || !schoolId}>
            {loading ? "Loading..." : "Load accounts with balances"}
          </button>

          <div style={{ color: "#64748b", fontWeight: 800, fontSize: 13 }}>
            Showing accounts with overdue balance &gt; 0
          </div>
        </div>

        {error ? (
          <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(220, 38, 38, 0.25)", background: "rgba(220, 38, 38, 0.05)", color: "#991b1b", fontWeight: 800 }}>
            {error}
          </div>
        ) : null}
        {info ? (
          <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(2, 132, 199, 0.25)", background: "rgba(2, 132, 199, 0.06)", color: "#075985", fontWeight: 800 }}>
            {info}
          </div>
        ) : null}
      </div>

      {rows.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn-gold-light" onClick={() => setRows((p) => p.map((r) => ({ ...r, selected: true })))}>
                Select All
              </button>
              <button className="btn-gold-light" onClick={() => setRows((p) => p.map((r) => ({ ...r, selected: false })))}>
                Untick All
              </button>
            </div>

            <button className="btn-gold" onClick={applyFine} disabled={applying || selectedCount === 0}>
              {applying ? "Applying..." : `Apply Fine to Selected Accounts (${selectedCount})`}
            </button>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid rgba(15, 23, 42, 0.12)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#ffffff" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid rgba(15, 23, 42, 0.08)" }}>
                  <th style={{ padding: 10, textAlign: "left" }} />
                  <th style={{ padding: 10, textAlign: "left" }}>Account #</th>
                  <th style={{ padding: 10, textAlign: "left" }}>Parent / Learner</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Total outstanding</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Overdue</th>
                  <th style={{ padding: 10, textAlign: "left" }}>Next due</th>
                  <th style={{ padding: 10, textAlign: "left" }}>Last payment</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Fine amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.parentId} style={{ borderBottom: "1px solid rgba(15, 23, 42, 0.06)" }}>
                    <td style={{ padding: 10 }}>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) =>
                          setRows((p) => p.map((x) => (x.parentId === r.parentId ? { ...x, selected: e.target.checked } : x)))
                        }
                      />
                    </td>
                    <td style={{ padding: 10, fontWeight: 800, color: "#0f172a" }}>{r.accountRef || "—"}</td>
                    <td style={{ padding: 10, fontWeight: 800, color: "#0f172a" }}>{r.name}</td>
                    <td style={{ padding: 10, textAlign: "right", fontWeight: 900, color: "#0f172a" }}>
                      {money(r.outstandingBalance)}
                    </td>
                    <td style={{ padding: 10, textAlign: "right", fontWeight: 900, color: "#0f172a" }}>
                      {money(Number(r.overdueBalance || 0))}
                    </td>
                    <td style={{ padding: 10, fontWeight: 800, color: "#334155" }}>{formatDateOrDash(r.nextDueDate || null)}</td>
                    <td style={{ padding: 10, fontWeight: 800, color: "#334155" }}>{formatDateOrDash(r.lastPaymentDate)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={String(r.fineAmount)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRows((p) => p.map((x) => (x.parentId === r.parentId ? { ...x, fineAmount: v } : x)));
                        }}
                        style={{
                          width: 140,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid rgba(15, 23, 42, 0.14)",
                          fontWeight: 900,
                          textAlign: "right",
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

