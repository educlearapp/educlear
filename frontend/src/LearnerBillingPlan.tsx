import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";

type BillingPlanItem = {
  id: string;
  feeStructureId: string;
  description: string;
  type: string | null;
  amount: number;
  sortOrder: number;
  dueDate?: string | null;
};

type LearnerSummary = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  admissionNo: string | null;
  familyAccountId: string | null;
  accountRef: string | null;
};

type ProfileSummary = {
  parentId: string | null;
  parentName: string | null;
  childStatus: string;
  currentBalance: number;
};

type FeeRow = {
  id: string;
  description: string;
  type: string | null;
  amount: number;
};

function money(value: number) {
  const n = Number(value || 0);
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div style={{ width: "min(920px, 100%)", background: "white", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center" }}>
          <div style={{ fontWeight: 800, flex: 1 }}>{title}</div>
          <button onClick={onClose}>X</button>
        </div>
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export default function LearnerBillingPlanPage({
  learnerId,
  onBack,
}: {
  learnerId: string;
  onBack: () => void;
}) {
  const schoolId = useSchoolId();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [learner, setLearner] = useState<LearnerSummary | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);

  const [excludeFromInvoiceRun, setExcludeFromInvoiceRun] = useState(false);
  const [items, setItems] = useState<BillingPlanItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [availableFees, setAvailableFees] = useState<FeeRow[]>([]);
  const [selectedFeeIds, setSelectedFeeIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) return;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = (await apiFetch(
          `/api/billing-plans/learners/${encodeURIComponent(learnerId)}?schoolId=${encodeURIComponent(schoolId)}`
        )) as any;
        if (cancelled) return;
        setLearner(data?.learner ?? null);
        setProfile(data?.profile ?? null);
        setExcludeFromInvoiceRun(Boolean(data?.billingPlan?.excludeFromInvoiceRun));
        setItems(Array.isArray(data?.billingPlan?.items) ? data.billingPlan.items : []);
        setSelectedItemIds([]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load billing plan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId, learnerId]);

  const totalAmount = useMemo(() => items.reduce((sum, it) => sum + Number(it.amount || 0), 0), [items]);

  useEffect(() => {
    let cancelled = false;
    if (!addOpen || !schoolId) return;

    setAddLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ schoolId, q: addSearch.trim() });
        const data = (await apiFetch(`/api/billing-plans/fees?${params.toString()}`)) as any;
        if (cancelled) return;
        setAvailableFees(Array.isArray(data?.fees) ? data.fees : []);
      } catch {
        if (!cancelled) setAvailableFees([]);
      } finally {
        if (!cancelled) setAddLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addOpen, addSearch, schoolId]);

  async function save() {
    if (!schoolId) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        schoolId,
        excludeFromInvoiceRun,
        items: items
          .slice()
          .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
          .map((it, idx) => ({
            feeStructureId: it.feeStructureId,
            amount: Number(it.amount || 0),
            sortOrder: idx,
            dueDate: it.dueDate || null,
          })),
      };
      const data = (await apiFetch(`/api/billing-plans/learners/${encodeURIComponent(learnerId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      })) as any;
      setItems(Array.isArray(data?.billingPlan?.items) ? data.billingPlan.items : items);
      alert("Saved.");
    } catch (e: any) {
      setError(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function removeSelected() {
    const set = new Set(selectedItemIds);
    const next = items.filter((it) => !set.has(it.id));
    setItems(next.map((it, idx) => ({ ...it, sortOrder: idx })));
    setSelectedItemIds([]);
  }

  function move(delta: -1 | 1) {
    if (selectedItemIds.length !== 1) return;
    const id = selectedItemIds[0];
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const to = idx + delta;
    if (to < 0 || to >= items.length) return;
    const copy = items.slice();
    const [row] = copy.splice(idx, 1);
    copy.splice(to, 0, row);
    setItems(copy.map((it, i) => ({ ...it, sortOrder: i })));
  }

  function addFeesContinue() {
    const byId = new Map(availableFees.map((f) => [f.id, f]));
    const existing = new Set(items.map((it) => it.feeStructureId));
    const selected = selectedFeeIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((f) => !existing.has(String(f!.id))) as FeeRow[];

    const baseSort = items.length;
    const next: BillingPlanItem[] = [
      ...items,
      ...selected.map((f, idx) => ({
        id: `new-${f.id}-${Date.now()}-${idx}`,
        feeStructureId: f.id,
        description: f.description,
        type: f.type ?? null,
        amount: Number(f.amount || 0),
        sortOrder: baseSort + idx,
      })),
    ].map((it, i) => ({ ...it, sortOrder: i }));

    setItems(next);
    setSelectedFeeIds([]);
    setAddOpen(false);
  }

  const childName = learner ? `${learner.firstName} ${learner.lastName}` : "Learner";

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={onBack}>Back</button>
        <button onClick={save} disabled={saving || !schoolId}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, border: "1px solid #f0b4b4", background: "#fff5f5", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{childName}</div>

          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={excludeFromInvoiceRun}
              onChange={(e) => setExcludeFromInvoiceRun(e.target.checked)}
            />
            Exclude From Invoice Run
          </label>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                  <th style={{ padding: 10, width: 30 }} />
                  <th style={{ padding: 10 }}>Description</th>
                  <th style={{ padding: 10 }}>Type</th>
                  <th style={{ padding: 10 }}>Amount</th>
                  <th style={{ padding: 10 }}>Payment Due Date</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 12 }}>
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 12 }}>
                      No fees in billing plan.
                    </td>
                  </tr>
                ) : (
                  items
                    .slice()
                    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
                    .map((it) => {
                      const checked = selectedItemIds.includes(it.id);
                      return (
                        <tr key={it.id} style={{ borderTop: "1px solid #e5e7eb", cursor: "pointer" }}>
                          <td style={{ padding: 10 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedItemIds((prev) => [...prev, it.id]);
                                else setSelectedItemIds((prev) => prev.filter((x) => x !== it.id));
                              }}
                            />
                          </td>
                          <td style={{ padding: 10 }}>{it.description}</td>
                          <td style={{ padding: 10 }}>{it.type || "-"}</td>
                          <td style={{ padding: 10 }}>{money(it.amount)}</td>
                          <td style={{ padding: 10 }}>
                            <input
                              type="date"
                              value={it.dueDate ? String(it.dueDate).slice(0, 10) : ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setItems((prev) =>
                                  prev.map((x) => (x.id === it.id ? { ...x, dueDate: v ? `${v}T00:00:00.000Z` : null } : x))
                                );
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => {
                setAddSearch("");
                setSelectedFeeIds([]);
                setAddOpen(true);
              }}
            >
              Add
            </button>
            <button onClick={() => alert("Coming soon")} disabled>
              New
            </button>
            <button onClick={removeSelected} disabled={selectedItemIds.length === 0}>
              Remove
            </button>
            <button onClick={() => move(-1)} disabled={selectedItemIds.length !== 1}>
              Move Up
            </button>
            <button onClick={() => move(1)} disabled={selectedItemIds.length !== 1}>
              Move Down
            </button>

            <div style={{ marginLeft: "auto", fontWeight: 800 }}>Total: {money(totalAmount)}</div>
          </div>
        </div>

        <div style={{ width: 320, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Learner profile summary</div>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            <div>
              <b>Classroom</b>: {learner?.className || "-"}
            </div>
            <div>
              <b>Group</b>: {learner?.grade || "-"}
            </div>
            <div>
              <b>Admission No</b>: {learner?.admissionNo || "-"}
            </div>
            <div>
              <b>Account Ref</b>: {learner?.accountRef || "-"}
            </div>
            <div>
              <b>Parent</b>: {profile?.parentName || "-"}
            </div>
            <div>
              <b>Child Status</b>: {profile?.childStatus || "-"}
            </div>
            <div>
              <b>Current Balance</b>: {money(profile?.currentBalance || 0)}
            </div>
          </div>
        </div>
      </div>

      <Modal
        title="Add fees to billing plan"
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setSelectedFeeIds([]);
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            placeholder="Search fees…"
            style={{ flex: 1 }}
          />
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                <th style={{ padding: 10, width: 30 }} />
                <th style={{ padding: 10 }}>Description</th>
                <th style={{ padding: 10 }}>Type</th>
                <th style={{ padding: 10 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {addLoading ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12 }}>
                    Loading…
                  </td>
                </tr>
              ) : availableFees.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12 }}>
                    No fees found.
                  </td>
                </tr>
              ) : (
                availableFees.map((f) => {
                  const checked = selectedFeeIds.includes(f.id);
                  return (
                    <tr key={f.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={{ padding: 10 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedFeeIds((prev) => [...prev, f.id]);
                            else setSelectedFeeIds((prev) => prev.filter((x) => x !== f.id));
                          }}
                        />
                      </td>
                      <td style={{ padding: 10 }}>{f.description}</td>
                      <td style={{ padding: 10 }}>{f.type || "-"}</td>
                      <td style={{ padding: 10 }}>{money(f.amount)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button
            onClick={() => {
              setAddOpen(false);
              setSelectedFeeIds([]);
            }}
          >
            Cancel
          </button>
          <button onClick={addFeesContinue} disabled={selectedFeeIds.length === 0}>
            Continue
          </button>
        </div>
      </Modal>
    </div>
  );
}

