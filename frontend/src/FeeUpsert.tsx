import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "./api";

const CATEGORY_OPTIONS = [
  { value: "SCHOOL_CHARGE", label: "School Charge" },
  { value: "EXTRAMURAL_CHARGE", label: "Extramural Charge" },
] as const;

const TYPE_OPTIONS = [
  { value: "MONTHLY", label: "Monthly Fee" },
  { value: "MONTHLY_EXCL_DEC", label: "Monthly Fee (Excl. Dec)" },
  { value: "MONTHLY_EXCL_NOV_DEC", label: "Monthly Fee (Excl. Nov and Dec)" },
  { value: "ONCE_OFF", label: "Once Off" },
  { value: "ANNUALLY", label: "Annually" },
  { value: "TERMLY", label: "Termly" },
  { value: "DAILY", label: "Daily" },
] as const;

type FeeDto = {
  id: string;
  schoolId: string;
  name: string;
  amount: number;
  frequency: string;
  category?: string | null;
  notes?: string | null;
};

function parseMoneyInput(input: string): number | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  // If user typed both '.' and ',', assume last occurrence is decimal separator.
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const decimalIdx = Math.max(lastDot, lastComma);
  const normalized =
    decimalIdx >= 0
      ? `${cleaned.slice(0, decimalIdx).replace(/[.,]/g, "")}.${cleaned.slice(decimalIdx + 1).replace(/[.,]/g, "")}`
      : cleaned.replace(/[.,]/g, "");

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

export default function FeeUpsert(props: { feeId?: string | null; onBack: () => void; onSaved: () => void }) {
  const schoolId = localStorage.getItem("schoolId") || "";
  const isEdit = Boolean(props.feeId);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]["value"] | "">("");
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]["value"] | "">("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuWrapRef.current) return;
      if (!menuWrapRef.current.contains(e.target as any)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isEdit) return;
    if (!schoolId) {
      setError("No school selected.");
      return;
    }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = new URL(`${API_URL}/api/fees/${encodeURIComponent(String(props.feeId))}`);
        url.searchParams.set("schoolId", schoolId);
        const res = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Failed to load fee");
        const fee = (data?.fee || null) as FeeDto | null;
        if (cancelled) return;

        setCategory((fee?.category as any) || "");
        setType(String(fee?.frequency || "") as any);
        setDescription(String(fee?.name || ""));
        setAmount(String(Number(fee?.amount || 0)));
        setNotes(String(fee?.notes || ""));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load fee");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEdit, props.feeId, schoolId]);

  const amountNumber = useMemo(() => parseMoneyInput(amount), [amount]);

  const validation = useMemo(() => {
    const fieldErrors: Record<string, string> = {};
    if (!schoolId) fieldErrors.schoolId = "No school selected.";
    if (!category) fieldErrors.category = "Category is required.";
    if (!type) fieldErrors.type = "Type is required.";
    if (!description.trim()) fieldErrors.description = "Description is required.";
    if (amountNumber === null) fieldErrors.amount = "Amount is required.";
    else if (amountNumber < 0) fieldErrors.amount = "Amount must be 0 or more.";

    const ok = Object.keys(fieldErrors).length === 0;
    return { ok, fieldErrors };
  }, [amountNumber, category, description, schoolId, type]);

  const pageWrap = {
    padding: "32px",
    background: "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
    minHeight: "100%",
    borderRadius: "28px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
  } as const;

  const titleStyle = {
    margin: 0,
    fontSize: "38px",
    fontWeight: 800,
    letterSpacing: "-0.03em",
    color: "#0f172a",
  } as const;

  const subtitleStyle = {
    margin: "10px 0 0 0",
    fontSize: "15px",
    color: "#475569",
    fontWeight: 500,
  } as const;

  const btnBase = {
    padding: "10px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(15, 23, 42, 0.10)",
    background: "#ffffff",
    fontWeight: 800,
    fontSize: "13px",
    color: "#0f172a",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
    cursor: "pointer",
  } as const;

  const btnPrimary = (disabled: boolean) =>
    ({
      padding: "10px 18px",
      borderRadius: "12px",
      border: "none",
      background: "linear-gradient(135deg, #d4af37, #f5d06f)",
      color: "#0f172a",
      fontWeight: 900,
      fontSize: "13px",
      boxShadow: "0 6px 18px rgba(212, 175, 55, 0.35)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.65 : 1,
    }) as const;

  const card = {
    background: "#ffffff",
    borderRadius: "18px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
    overflow: "hidden",
    maxWidth: "980px",
  } as const;

  const cardHeader = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px",
    borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  } as const;

  const cardTitle = {
    fontSize: "14px",
    fontWeight: 900,
    letterSpacing: "0.02em",
    color: "#0f172a",
    textTransform: "uppercase" as const,
  } as const;

  const tabPill = {
    padding: "7px 12px",
    borderRadius: "999px",
    border: "1px solid rgba(15, 23, 42, 0.10)",
    background: "#ffffff",
    fontSize: "12px",
    fontWeight: 900,
    color: "#0f172a",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
  } as const;

  const label = {
    fontSize: "12px",
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: "8px",
  } as const;

  const input = (invalid: boolean) =>
    ({
      padding: "12px 14px",
      borderRadius: "12px",
      border: invalid ? "1px solid rgba(239, 68, 68, 0.55)" : "1px solid rgba(15, 23, 42, 0.10)",
      background: "#ffffff",
      fontSize: "14px",
      width: "100%",
      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
      outline: "none",
    }) as const;

  const helpError = {
    marginTop: "8px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#b91c1c",
  } as const;

  const saveDisabled = !validation.ok || saving || loading;

  return (
    <div style={pageWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 style={titleStyle}>Fee</h1>
          <p style={subtitleStyle}>Add or change the fees you charge</p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "6px" }}>
          <button type="button" style={btnBase} onClick={props.onBack} disabled={saving}>
            Back
          </button>
          <button
            type="button"
            style={btnPrimary(saveDisabled)}
            disabled={saveDisabled}
            onClick={async () => {
              if (saveDisabled) return;
              setSaving(true);
              setError(null);
              try {
                const payload = {
                  schoolId,
                  category,
                  frequency: type,
                  name: description.trim(),
                  amount: amountNumber ?? 0,
                  notes: notes.trim() ? notes.trim() : null,
                };

                const res = await fetch(
                  isEdit ? `${API_URL}/api/fees/${encodeURIComponent(String(props.feeId))}` : `${API_URL}/api/fees`,
                  {
                    method: isEdit ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  }
                );
                const data = await res.json();
                if (!res.ok) throw new Error(data?.message || (isEdit ? "Failed to update fee" : "Failed to create fee"));
                props.onSaved();
              } catch (e: any) {
                setError(e?.message || "Failed to save fee");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <div style={{ position: "relative" }} ref={menuWrapRef}>
            <button
              type="button"
              style={btnBase}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={saving}
            >
              More Actions
            </button>
            {menuOpen ? (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 10px)",
                  minWidth: "220px",
                  background: "#ffffff",
                  border: "1px solid rgba(15, 23, 42, 0.10)",
                  borderRadius: "14px",
                  boxShadow: "0 22px 60px rgba(15, 23, 42, 0.16)",
                  padding: "8px",
                  zIndex: 50,
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#ffffff",
                    cursor: "not-allowed",
                    opacity: 0.65,
                    fontWeight: 800,
                    color: "#0f172a",
                  }}
                  disabled
                  title="Coming soon"
                >
                  Deactivate (coming soon)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#ffffff",
                    cursor: "not-allowed",
                    opacity: 0.65,
                    fontWeight: 800,
                    color: "#b91c1c",
                  }}
                  disabled
                  title="Coming soon"
                >
                  Delete (coming soon)
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: "14px",
            background: "#fff7ed",
            border: "1px solid rgba(234, 88, 12, 0.18)",
            color: "#9a3412",
            fontWeight: 700,
            marginBottom: "14px",
            maxWidth: "980px",
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={card}>
        <div style={cardHeader}>
          <div style={cardTitle}>{isEdit ? "Edit Fee" : "Create Fee"}</div>
          <div style={tabPill}>General</div>
        </div>

        <div style={{ padding: "20px" }}>
          {loading ? <div style={{ color: "#475569", fontWeight: 800 }}>Loading…</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", opacity: loading ? 0.55 : 1 }}>
            <div>
              <div style={label}>Category *</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                style={input(Boolean(validation.fieldErrors.category)) as any}
                disabled={loading || saving}
              >
                <option value="">Select category</option>
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {validation.fieldErrors.category ? <div style={helpError}>{validation.fieldErrors.category}</div> : null}
            </div>

            <div>
              <div style={label}>Type *</div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                style={input(Boolean(validation.fieldErrors.type)) as any}
                disabled={loading || saving}
              >
                <option value="">Select type</option>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {validation.fieldErrors.type ? <div style={helpError}>{validation.fieldErrors.type}</div> : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "14px", marginTop: "14px", opacity: loading ? 0.55 : 1 }}>
            <div>
              <div style={label}>Description *</div>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Tuition fee"
                style={input(Boolean(validation.fieldErrors.description))}
                disabled={loading || saving}
              />
              {validation.fieldErrors.description ? <div style={helpError}>{validation.fieldErrors.description}</div> : null}
            </div>

            <div>
              <div style={label}>Amount *</div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                style={input(Boolean(validation.fieldErrors.amount))}
                disabled={loading || saving}
              />
              {validation.fieldErrors.amount ? <div style={helpError}>{validation.fieldErrors.amount}</div> : null}
            </div>
          </div>

          <div style={{ marginTop: "14px", opacity: loading ? 0.55 : 1 }}>
            <div style={label}>Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              style={{
                ...input(false),
                minHeight: "110px",
                resize: "vertical",
                lineHeight: 1.4,
              }}
              disabled={loading || saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

