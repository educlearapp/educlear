import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";

type StepKey =
  | "start"
  | "settings"
  | "children"
  | "fees"
  | "preview"
  | "create"
  | "summary"
  | "finish";

type LearnerRow = {
  learnerId: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  familyAccountId: string | null;
  accountRef: string | null;
  parentId: string | null;
  parentName: string | null;
  currentBalance: number;
  billingPlanAmount: number;
  hasBillingPlan: boolean;
  billingPlanLines?: FeeLine[];
};

type FeeLine = {
  id: string;
  description: string;
  amount: number; // ZAR
  dueDate?: string | null; // ISO
};

type CreatedInvoice = {
  id: string;
  parentId: string;
  learnerId: string;
  accountRef: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  lines: { id: string; description: string; amount: number }[];
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

function monthFromIso(iso: string) {
  const s = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s.slice(0, 7);
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function InvoiceRunWizard() {
  const schoolId = useSchoolId();

  const [step, setStep] = useState<StepKey>("start");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<string[]>([]);

  const [description, setDescription] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const [invoiceMonth, setInvoiceMonth] = useState(monthFromIso(todayIso()));
  const [messageOnInvoice, setMessageOnInvoice] = useState("");

  // Per learner fee lines (first line = base plan, can be edited)
  const [feeLinesByLearner, setFeeLinesByLearner] = useState<Record<string, FeeLine[]>>({});

  const [created, setCreated] = useState<{
    invoicesCreated: number;
    totalAmount: number;
    invoices: CreatedInvoice[];
    invoiceRunId: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) {
      setLearners([]);
      setSelectedLearnerIds([]);
      setFeeLinesByLearner({});
      setError("No school selected.");
      return;
    }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = (await apiFetch(
          `/api/invoice-runs/learners?schoolId=${encodeURIComponent(schoolId)}`
        )) as any;
        const list = Array.isArray(data?.learners) ? (data.learners as LearnerRow[]) : [];
        if (cancelled) return;
        setLearners(list);
        setSelectedLearnerIds(list.map((l) => l.learnerId));

        const nextLines: Record<string, FeeLine[]> = {};
        for (const l of list) {
          if (l.hasBillingPlan && Array.isArray((l as any).billingPlanLines) && (l as any).billingPlanLines.length) {
            nextLines[l.learnerId] = (l as any).billingPlanLines.map((x: any, idx: number) => ({
              id: String(x?.id || uid(`bp-${idx}`)),
              description: String(x?.description || "Billing plan"),
              amount: Number(x?.amount || 0),
              dueDate: x?.dueDate || null,
            }));
          } else {
            nextLines[l.learnerId] = [
              {
                id: uid("base"),
                description: l.hasBillingPlan ? "Billing plan" : "No billing plan",
                amount: Number(l.hasBillingPlan ? l.billingPlanAmount : 0),
                dueDate: null,
              },
            ];
          }
        }
        setFeeLinesByLearner(nextLines);
      } catch (e: any) {
        // Only show an error if the request actually failed.
        if (!cancelled) setError("Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  useEffect(() => {
    // Keep invoiceMonth in sync when invoiceDate changes (unless user cleared it).
    const auto = monthFromIso(invoiceDate);
    if (auto) setInvoiceMonth(auto);
  }, [invoiceDate]);

  const selectedLearners = useMemo(() => {
    const set = new Set(selectedLearnerIds);
    return learners.filter((l) => set.has(l.learnerId));
  }, [learners, selectedLearnerIds]);

  const previewRows = useMemo(() => {
    return selectedLearners.map((l) => {
      const lines = feeLinesByLearner[l.learnerId] || [];
      const invoiceAmount = lines.reduce((sum, x) => sum + Number(x.amount || 0), 0);
      const newBalance = Number(l.currentBalance || 0) + invoiceAmount;
      return {
        ...l,
        invoiceAmount,
        newBalance,
      };
    });
  }, [selectedLearners, feeLinesByLearner]);

  const totalPreviewAmount = useMemo(() => previewRows.reduce((sum, r) => sum + Number(r.invoiceAmount || 0), 0), [previewRows]);

  function canGoNext(): { ok: boolean; reason?: string } {
    if (step === "start") return { ok: true };
    if (step === "settings") {
      if (!invoiceDate) return { ok: false, reason: "Invoice date is required." };
      if (!dueDate) return { ok: false, reason: "Due date is required." };
      if (!invoiceMonth) return { ok: false, reason: "Invoice month is required." };
      return { ok: true };
    }
    if (step === "children") {
      if (selectedLearnerIds.length === 0) return { ok: false, reason: "Select at least 1 learner." };
      return { ok: true };
    }
    if (step === "fees") {
      const missing = selectedLearners.find((l) => {
        const lines = feeLinesByLearner[l.learnerId] || [];
        const total = lines.reduce((sum, x) => sum + Number(x.amount || 0), 0);
        return total <= 0;
      });
      if (missing) {
        return {
          ok: false,
          reason:
            "A learner has no invoice amount. Learners with 'No billing plan' must have an amount manually added before creating invoices.",
        };
      }
      return { ok: true };
    }
    if (step === "preview") return { ok: true };
    if (step === "create") return { ok: true };
    if (step === "summary") return { ok: true };
    if (step === "finish") return { ok: true };
    return { ok: true };
  }

  const steps: { key: StepKey; label: string }[] = [
    { key: "start", label: "Start" },
    { key: "settings", label: "Settings" },
    { key: "children", label: "Children" },
    { key: "fees", label: "Fees" },
    { key: "preview", label: "Preview" },
    { key: "create", label: "Create Invoices" },
    { key: "summary", label: "Summary" },
    { key: "finish", label: "Finish" },
  ];

  const stepIndex = steps.findIndex((s) => s.key === step);

  function goNext() {
    const v = canGoNext();
    if (!v.ok) {
      alert(v.reason || "Please complete this step before continuing.");
      return;
    }
    const next = steps[Math.min(steps.length - 1, stepIndex + 1)]?.key;
    if (next) setStep(next);
  }

  function goBack() {
    const prev = steps[Math.max(0, stepIndex - 1)]?.key;
    if (prev) setStep(prev);
  }

  async function createInvoices() {
    if (!schoolId) return;

    const learnersPayload = selectedLearners.map((l) => ({
      learnerId: l.learnerId,
      parentId: l.parentId,
      familyAccountId: l.familyAccountId,
      accountRef: l.accountRef,
      lines: (feeLinesByLearner[l.learnerId] || [])
        .filter((x) => Number(x.amount || 0) !== 0)
        .map((x, idx) => ({
          description: x.description,
          amount: Number(x.amount || 0),
          sortOrder: idx,
          // Safe due-date logic:
          // - carry forward per fee line dueDate when provided
          // - default to invoiceDate if not set
          dueDate: x.dueDate || `${invoiceDate}T00:00:00.000Z`,
        })),
    }));

    // Backend enforces parentId exists; surface it early.
    const missingParent = learnersPayload.find((x) => !x.parentId);
    if (missingParent) {
      alert("One or more learners are not linked to a parent account yet. Please link a parent before running invoices.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = (await apiFetch("/api/invoice-runs", {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          description: description.trim() || null,
          invoiceDate,
          dueDate,
          invoiceMonth,
          message: messageOnInvoice.trim() || null,
          learners: learnersPayload,
        }),
      })) as any;

      const invoices: CreatedInvoice[] = Array.isArray(data?.invoices) ? data.invoices : [];
      const invoicesCreated = Number(data?.summary?.invoicesCreated || invoices.length || 0);
      const totalAmount = Number(data?.summary?.totalAmount || 0);
      const invoiceRunId = String(data?.invoiceRun?.id || "");

      setCreated({
        invoicesCreated,
        totalAmount,
        invoices,
        invoiceRunId: invoiceRunId || null,
      });

      setStep("summary");
    } catch (e: any) {
      setError(e?.message || "Failed to create invoices.");
    } finally {
      setLoading(false);
    }
  }

  const pageWrap: React.CSSProperties = {
    padding: "24px",
    background: "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
    minHeight: "100%",
    borderRadius: "28px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
  };

  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.06)",
  };

  const label: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "6px",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid rgba(15, 23, 42, 0.14)",
    outline: "none",
    fontSize: "14px",
    background: "#fff",
  };

  function StepHeader() {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.03em" }}>Invoice Run</h1>
          <div style={{ marginTop: 8, color: "#475569", fontWeight: 600 }}>
            Step {stepIndex + 1} of {steps.length}: <span style={{ fontWeight: 900 }}>{steps[stepIndex]?.label}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {steps.map((s, idx) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                // allow jumping backwards, but not forward past validation
                if (idx <= stepIndex) setStep(s.key);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(15, 23, 42, 0.10)",
                background: idx === stepIndex ? "linear-gradient(135deg, #d4af37, #f5d06f)" : "#fff",
                color: "#0f172a",
                fontWeight: 850,
                fontSize: 12,
                cursor: idx <= stepIndex ? "pointer" : "not-allowed",
                opacity: idx <= stepIndex ? 1 : 0.55,
              }}
              disabled={idx > stepIndex}
              aria-disabled={idx > stepIndex}
              title={idx > stepIndex ? "Complete current step first" : "Go to step"}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function FooterButtons() {
    const nextLabel = step === "preview" ? "Create invoices" : step === "create" ? "View summary" : "Next";
    const isCreate = step === "preview";
    const disableBack = stepIndex === 0 || loading;
    const disableNext = loading || (step === "create") || (step === "summary") || (step === "finish");

    return (
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={goBack}
          disabled={disableBack}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(15, 23, 42, 0.14)",
            background: "#fff",
            fontWeight: 850,
            cursor: disableBack ? "not-allowed" : "pointer",
            opacity: disableBack ? 0.6 : 1,
          }}
        >
          Back
        </button>

        {step === "preview" ? (
          <button
            type="button"
            onClick={() => {
              const v = canGoNext();
              if (!v.ok) return alert(v.reason || "Please complete this step.");
              setStep("create");
              void (async () => {
                await createInvoices();
              })();
            }}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #16a34a, #22c55e)",
              color: "#fff",
              fontWeight: 900,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
            title="Create and save invoices"
          >
            Create invoices
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (disableNext) return;
              if (isCreate) return;
              goNext();
            }}
            disabled={disableNext}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #d4af37, #f5d06f)",
              color: "#0f172a",
              fontWeight: 900,
              cursor: disableNext ? "not-allowed" : "pointer",
              opacity: disableNext ? 0.7 : 1,
            }}
          >
            {nextLabel}
          </button>
        )}
      </div>
    );
  }

  function StartStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Start</div>
        {!loading && !error && learners.length === 0 ? (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 14,
              background: "#eff6ff",
              border: "1px solid rgba(37,99,235,0.18)",
              color: "#1d4ed8",
              fontWeight: 850,
              lineHeight: 1.6,
            }}
          >
            No learners found yet. Add learners and billing plans before running invoices.
          </div>
        ) : null}
        <div style={{ marginTop: 10, color: "#475569", fontWeight: 600, lineHeight: 1.6 }}>
          This wizard will generate invoices for the selected school. Learners are loaded from the database for your current
          <span style={{ fontWeight: 900 }}> schoolId</span>.
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
            <div style={{ ...label, marginBottom: 2 }}>Learners loaded</div>
            <div style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>{learners.length}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
            <div style={{ ...label, marginBottom: 2 }}>Selected</div>
            <div style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>{selectedLearnerIds.length}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
            <div style={{ ...label, marginBottom: 2 }}>Total (preview)</div>
            <div style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>{money(totalPreviewAmount)}</div>
          </div>
        </div>
      </div>
    );
  }

  function SettingsStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Settings</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <div>
            <div style={label}>Description</div>
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={input} placeholder="e.g. April invoice run" />
          </div>
          <div>
            <div style={label}>Invoice month (YYYY-MM)</div>
            <input value={invoiceMonth} onChange={(e) => setInvoiceMonth(e.target.value)} style={input} placeholder="2026-04" />
          </div>
          <div>
            <div style={label}>Invoice date</div>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={input} />
          </div>
          <div>
            <div style={label}>Due date</div>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={label}>Message on invoice</div>
            <textarea
              value={messageOnInvoice}
              onChange={(e) => setMessageOnInvoice(e.target.value)}
              style={{ ...input, minHeight: 90, resize: "vertical" as const }}
              placeholder="Optional message to appear on invoices"
            />
          </div>
        </div>
      </div>
    );
  }

  function ChildrenStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Children</div>
        <div style={{ marginTop: 10, color: "#475569", fontWeight: 600 }}>
          Learners selected for this run. Remove learners here before creating invoices.
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setSelectedLearnerIds(learners.map((l) => l.learnerId))}
            style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.14)", background: "#fff", fontWeight: 850 }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelectedLearnerIds([])}
            style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.14)", background: "#fff", fontWeight: 850 }}
          >
            Clear
          </button>
        </div>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ ...label, textAlign: "left" }}>Selected</th>
                <th style={{ ...label, textAlign: "left" }}>Learner</th>
                <th style={{ ...label, textAlign: "left" }}>Class/Group</th>
                <th style={{ ...label, textAlign: "left" }}>Account</th>
                <th style={{ ...label, textAlign: "right" }}>Current balance</th>
                <th style={{ ...label, textAlign: "left" }}>Billing plan</th>
                <th style={{ ...label, textAlign: "left" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {selectedLearners.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, background: "#fff", borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)" }}>
                    No learners selected.
                  </td>
                </tr>
              ) : (
                selectedLearners.map((l) => (
                  <tr key={l.learnerId} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(15,23,42,0.08)" }}>
                    <td style={{ padding: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedLearnerIds.includes(l.learnerId)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedLearnerIds((prev) => {
                            if (checked) return prev.includes(l.learnerId) ? prev : [...prev, l.learnerId];
                            return prev.filter((id) => id !== l.learnerId);
                          });
                        }}
                      />
                    </td>
                    <td style={{ padding: 12, fontWeight: 850 }}>
                      {l.firstName} {l.lastName}
                    </td>
                    <td style={{ padding: 12 }}>{l.className || l.grade || "-"}</td>
                    <td style={{ padding: 12 }}>{l.accountRef || "-"}</td>
                    <td style={{ padding: 12, textAlign: "right", fontWeight: 850 }}>{money(l.currentBalance)}</td>
                    <td style={{ padding: 12 }}>
                      {l.hasBillingPlan ? (
                        <span style={{ fontWeight: 900 }}>{money(l.billingPlanAmount)}</span>
                      ) : (
                        <span style={{ fontWeight: 900, color: "#b45309" }}>No billing plan</span>
                      )}
                    </td>
                    <td style={{ padding: 12 }}>
                      <button
                        type="button"
                        onClick={() => setSelectedLearnerIds((prev) => prev.filter((id) => id !== l.learnerId))}
                        style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.14)", background: "#fff", fontWeight: 850 }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function FeesStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Fees</div>
        <div style={{ marginTop: 10, color: "#475569", fontWeight: 600, lineHeight: 1.6 }}>
          Billing plan fees are loaded per learner. You can add extra fee lines. Learners with{" "}
          <span style={{ fontWeight: 900, color: "#b45309" }}>No billing plan</span> will not be invoiced unless you enter an amount.
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {selectedLearners.map((l) => {
            const lines = feeLinesByLearner[l.learnerId] || [];
            const total = lines.reduce((sum, x) => sum + Number(x.amount || 0), 0);
            const warnNoPlan = !l.hasBillingPlan && total <= 0;
            return (
              <div
                key={l.learnerId}
                style={{
                  borderRadius: 16,
                  border: warnNoPlan ? "2px solid rgba(180,83,9,0.35)" : "1px solid rgba(15,23,42,0.10)",
                  background: "#fff",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 950, color: "#0f172a" }}>
                    {l.firstName} {l.lastName} • {l.className || l.grade || "-"}{" "}
                    {!l.hasBillingPlan ? <span style={{ color: "#b45309" }}>• No billing plan</span> : null}
                  </div>
                  <div style={{ fontWeight: 950, color: "#0f172a" }}>Total: {money(total)}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {lines.map((lineItem) => (
                    <div key={lineItem.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 170px 90px", gap: 8, alignItems: "center" }}>
                      <input
                        value={lineItem.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFeeLinesByLearner((prev) => ({
                            ...prev,
                            [l.learnerId]: (prev[l.learnerId] || []).map((x) => (x.id === lineItem.id ? { ...x, description: v } : x)),
                          }));
                        }}
                        style={input}
                        placeholder="Description"
                      />
                      <input
                        value={String(lineItem.amount ?? "")}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setFeeLinesByLearner((prev) => ({
                            ...prev,
                            [l.learnerId]: (prev[l.learnerId] || []).map((x) =>
                              x.id === lineItem.id ? { ...x, amount: Number.isFinite(n) ? n : 0 } : x
                            ),
                          }));
                        }}
                        style={input}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                      <input
                        type="date"
                        value={lineItem.dueDate ? String(lineItem.dueDate).slice(0, 10) : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFeeLinesByLearner((prev) => ({
                            ...prev,
                            [l.learnerId]: (prev[l.learnerId] || []).map((x) =>
                              x.id === lineItem.id ? { ...x, dueDate: v ? `${v}T00:00:00.000Z` : null } : x
                            ),
                          }));
                        }}
                        style={input}
                        title="Payment Due Date"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setFeeLinesByLearner((prev) => ({
                            ...prev,
                            [l.learnerId]: (prev[l.learnerId] || []).filter((x) => x.id !== lineItem.id),
                          }));
                        }}
                        style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.14)", background: "#fff", fontWeight: 900 }}
                        title="Remove line"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setFeeLinesByLearner((prev) => ({
                        ...prev,
                        [l.learnerId]: [
                          ...(prev[l.learnerId] || []),
                          { id: uid("extra"), description: "Extra fee", amount: 0 },
                        ],
                      }));
                    }}
                    style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.14)", background: "#fff", fontWeight: 900 }}
                  >
                    + Add fee line
                  </button>
                  {warnNoPlan ? (
                    <div style={{ color: "#b45309", fontWeight: 850 }}>No billing plan: add an amount to invoice this learner.</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function PreviewStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Preview</div>
        <div style={{ marginTop: 10, color: "#475569", fontWeight: 600 }}>
          Review the balances and invoice amounts before creating invoices.
        </div>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ ...label, textAlign: "left" }}>Account number</th>
                <th style={{ ...label, textAlign: "left" }}>Learner name</th>
                <th style={{ ...label, textAlign: "left" }}>Surname</th>
                <th style={{ ...label, textAlign: "left" }}>Class/Group</th>
                <th style={{ ...label, textAlign: "right" }}>Current balance</th>
                <th style={{ ...label, textAlign: "right" }}>Invoice amount</th>
                <th style={{ ...label, textAlign: "right" }}>New balance</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, background: "#fff", borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)" }}>
                    Nothing to preview.
                  </td>
                </tr>
              ) : (
                previewRows.map((r) => (
                  <tr key={r.learnerId} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(15,23,42,0.08)" }}>
                    <td style={{ padding: 12, fontWeight: 900 }}>{r.accountRef || "-"}</td>
                    <td style={{ padding: 12, fontWeight: 850 }}>{r.firstName}</td>
                    <td style={{ padding: 12, fontWeight: 850 }}>{r.lastName}</td>
                    <td style={{ padding: 12 }}>{r.className || r.grade || "-"}</td>
                    <td style={{ padding: 12, textAlign: "right", fontWeight: 850 }}>{money(r.currentBalance)}</td>
                    <td style={{ padding: 12, textAlign: "right", fontWeight: 950 }}>{money(r.invoiceAmount)}</td>
                    <td style={{ padding: 12, textAlign: "right", fontWeight: 950 }}>{money(r.newBalance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
            <div style={label}>Total</div>
            <div style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>{money(totalPreviewAmount)}</div>
          </div>
        </div>
      </div>
    );
  }

  function CreateStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Create Invoices</div>
        <div style={{ marginTop: 10, color: "#475569", fontWeight: 600, lineHeight: 1.6 }}>
          Creating invoices… this will save real invoices in the database and update account balances.
        </div>
        <div style={{ marginTop: 12, fontWeight: 900, color: "#0f172a" }}>{loading ? "Working…" : "Done."}</div>
      </div>
    );
  }

  function SummaryStep() {
    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Summary</div>
        {!created ? (
          <div style={{ marginTop: 12, color: "#475569", fontWeight: 650 }}>No invoices created yet.</div>
        ) : (
          <>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
                <div style={label}>Invoices created</div>
                <div style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>{created.invoicesCreated}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
                <div style={label}>Total amount</div>
                <div style={{ fontWeight: 950, fontSize: 18, color: "#0f172a" }}>{money(created.totalAmount)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
                <div style={label}>Invoice run ID</div>
                <div style={{ fontWeight: 950, fontSize: 14, color: "#0f172a" }}>{created.invoiceRunId || "-"}</div>
              </div>
            </div>

            <div style={{ marginTop: 14, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ ...label, textAlign: "left" }}>Invoice ID</th>
                    <th style={{ ...label, textAlign: "left" }}>Account</th>
                    <th style={{ ...label, textAlign: "left" }}>Learner</th>
                    <th style={{ ...label, textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {created.invoices.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, background: "#fff", borderRadius: 12, border: "1px solid rgba(15,23,42,0.10)" }}>
                        No invoices returned.
                      </td>
                    </tr>
                  ) : (
                    created.invoices.map((inv) => {
                      const learner = learners.find((l) => l.learnerId === inv.learnerId);
                      return (
                        <tr key={inv.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(15,23,42,0.08)" }}>
                          <td style={{ padding: 12, fontWeight: 900 }}>{inv.id}</td>
                          <td style={{ padding: 12 }}>{inv.accountRef || "-"}</td>
                          <td style={{ padding: 12, fontWeight: 850 }}>
                            {learner ? `${learner.firstName} ${learner.lastName}` : inv.learnerId}
                          </td>
                          <td style={{ padding: 12, textAlign: "right", fontWeight: 950 }}>{money(inv.amount)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setStep("finish")}
            className="btn-gold-dark"
          >
            Finish
          </button>
        </div>
      </div>
    );
  }

  function FinishStep() {
    const actions = [
      "Email Invoices",
      "Email Statements",
      "Email Both",
      "Print Invoices",
      "Print Statements",
      "Print Both",
    ];

    return (
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Finish</div>
        <div style={{ marginTop: 10, color: "#475569", fontWeight: 650, lineHeight: 1.6 }}>
          Invoices have been created. Choose an action below.
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className="btn-gold-light"
              onClick={() => alert(`${a} is not implemented yet in EduClear. The invoices are saved and balances are updated.`)}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function Body() {
    if (step === "start") return <StartStep />;
    if (step === "settings") return <SettingsStep />;
    if (step === "children") return <ChildrenStep />;
    if (step === "fees") return <FeesStep />;
    if (step === "preview") return <PreviewStep />;
    if (step === "create") return <CreateStep />;
    if (step === "summary") return <SummaryStep />;
    if (step === "finish") return <FinishStep />;
    return null;
  }

  return (
    <div style={pageWrap}>
      <StepHeader />

      {error ? (
        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: "#fff7ed", border: "1px solid rgba(234,88,12,0.22)", color: "#9a3412", fontWeight: 800 }}>
          {error}
        </div>
      ) : null}

      {loading && step !== "create" ? (
        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: "#eff6ff", border: "1px solid rgba(37,99,235,0.18)", color: "#1d4ed8", fontWeight: 800 }}>
          Loading…
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Body />
      </div>

      {step !== "summary" && step !== "finish" ? <FooterButtons /> : null}
    </div>
  );
}

