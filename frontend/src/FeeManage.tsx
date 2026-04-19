import { useEffect, useMemo, useState } from "react";
import { API_URL } from "./api";

const frequencies = ["ONCE_OFF", "MONTHLY", "YEARLY"] as const;

type Fee = {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  grade?: string | null;
};

export default function FeeManage(props: { feeId: string; onDone: () => void }) {
  const schoolId = localStorage.getItem("schoolId") || "";
  const [fee, setFee] = useState<Fee | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<string>("0");
  const [frequency, setFrequency] = useState<(typeof frequencies)[number]>("MONTHLY");
  const [grade, setGrade] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) {
      setError("No school selected.");
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const url = new URL(`${API_URL}/api/fees/${encodeURIComponent(props.feeId)}`);
        url.searchParams.set("schoolId", schoolId);
        const res = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Failed to load fee");
        const f = data?.fee as Fee;
        if (cancelled) return;
        setFee(f);
        setName(String(f?.name || ""));
        setAmount(String(Number(f?.amount || 0)));
        setFrequency((String(f?.frequency || "MONTHLY") as any) || "MONTHLY");
        setGrade(String(f?.grade || ""));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load fee");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.feeId, schoolId]);

  const canSave = useMemo(() => {
    if (!schoolId) return false;
    if (!name.trim()) return false;
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return false;
    return true;
  }, [amount, name, schoolId]);

  const wrap = {
    padding: "32px",
    background: "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
    minHeight: "100%",
    borderRadius: "28px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
  } as const;

  const card = {
    background: "#ffffff",
    borderRadius: "18px",
    padding: "18px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
    overflow: "hidden",
    maxWidth: "760px",
  } as const;

  const label = {
    fontSize: "12px",
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: "8px",
  } as const;

  const input = {
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1px solid rgba(15, 23, 42, 0.10)",
    background: "#ffffff",
    fontSize: "14px",
    width: "100%",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
    outline: "none",
  } as const;

  const btn = (primary: boolean, disabled: boolean) =>
    ({
      padding: "10px 18px",
      borderRadius: "12px",
      border: primary ? "none" : "1px solid rgba(15, 23, 42, 0.10)",
      background: primary ? "linear-gradient(135deg, #d4af37, #f5d06f)" : "#ffffff",
      color: "#0f172a",
      fontWeight: 800,
      fontSize: "13px",
      boxShadow: primary ? "0 6px 18px rgba(212, 175, 55, 0.35)" : "0 4px 12px rgba(15, 23, 42, 0.05)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.6 : 1,
    }) as const;

  return (
    <div style={wrap}>
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: "38px",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "#0f172a",
          }}
        >
          Manage Fee
        </h1>
        <p style={{ margin: "10px 0 0 0", fontSize: "15px", color: "#475569", fontWeight: 500 }}>
          Update the fee details.
        </p>
      </div>

      <div style={card}>
        {error ? (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "14px",
              background: "#fff7ed",
              border: "1px solid rgba(234, 88, 12, 0.18)",
              color: "#9a3412",
              fontWeight: 650,
              marginBottom: "14px",
            }}
          >
            {error}
          </div>
        ) : null}

        {loading || !fee ? (
          <div style={{ color: "#475569", fontWeight: 700 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: "12px" }}>
              <div>
                <div style={label}>Description</div>
                <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
              </div>
              <div>
                <div style={label}>Amount</div>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={input} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
              <div>
                <div style={label}>Type</div>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as any)} style={input as any}>
                  {frequencies.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={label}>Category</div>
                <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Optional grade" style={input} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button type="button" style={btn(false, saving)} disabled={saving} onClick={props.onDone}>
                Back
              </button>
              <button
                type="button"
                style={btn(true, !canSave || saving)}
                disabled={!canSave || saving}
                onClick={async () => {
                  if (!canSave) return;
                  setSaving(true);
                  setError(null);
                  try {
                    const res = await fetch(`${API_URL}/api/fees/${encodeURIComponent(props.feeId)}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        schoolId,
                        name: name.trim(),
                        amount: Number(amount),
                        frequency,
                        grade: grade.trim() ? grade.trim() : null,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data?.message || "Failed to update fee");
                    props.onDone();
                  } catch (e: any) {
                    setError(e?.message || "Failed to update fee");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

