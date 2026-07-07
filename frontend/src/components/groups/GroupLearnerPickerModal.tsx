import { useEffect, useMemo, useState } from "react";

export type GroupLearnerPickerRow = {
  id: string;
  firstName: string;
  lastName: string;
  grade?: string;
};

type Props = {
  open: boolean;
  title?: string;
  learners: GroupLearnerPickerRow[];
  excludedLearnerIds?: string[];
  saving?: boolean;
  onClose: () => void;
  onConfirm: (learnerIds: string[]) => void | Promise<void>;
};

export default function GroupLearnerPickerModal({
  open,
  title = "Add learners to group",
  learners,
  excludedLearnerIds = [],
  saving = false,
  onClose,
  onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedIds(new Set());
    }
  }, [open]);

  const excluded = useMemo(() => new Set(excludedLearnerIds.map(String)), [excludedLearnerIds]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return learners
      .filter((learner) => learner.id && !excluded.has(String(learner.id)))
      .filter((learner) => {
        if (!q) return true;
        const name = `${learner.firstName || ""} ${learner.lastName || ""}`.toLowerCase();
        const grade = String(learner.grade || "").toLowerCase();
        return name.includes(q) || grade.includes(q);
      })
      .sort((a, b) =>
        `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(
          `${b.lastName || ""} ${b.firstName || ""}`,
          undefined,
          { sensitivity: "base" }
        )
      );
  }, [learners, excluded, search]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!selectedIds.size || saving) return;
    void onConfirm(Array.from(selectedIds));
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: "20px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-learner-picker-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "80vh",
          background: "#fff",
          borderRadius: "14px",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 24px 60px rgba(15,23,42,0.22)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #e5e7eb" }}>
          <h2 id="group-learner-picker-title" style={{ margin: 0, fontSize: "20px", fontWeight: 900, color: "#0f172a" }}>
            {title}
          </h2>
        </div>

        <div style={{ padding: "12px 18px", borderBottom: "1px solid #e5e7eb" }}>
          <input
            type="search"
            placeholder="Search by name or grade…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "10px",
              border: "1px solid rgba(15,23,42,0.14)",
              fontSize: "14px",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {candidates.length === 0 ? (
            <div style={{ padding: "24px 18px", color: "#64748b", fontWeight: 700, textAlign: "center" }}>
              No learners available to add.
            </div>
          ) : (
            candidates.map((learner) => {
              const id = String(learner.id);
              const checked = selectedIds.has(id);
              return (
                <label
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 18px",
                    cursor: "pointer",
                    background: checked ? "rgba(212,175,55,0.12)" : "transparent",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
                  <span style={{ fontWeight: 700, color: "#0f172a" }}>
                    {learner.firstName} {learner.lastName}
                  </span>
                  {learner.grade ? (
                    <span style={{ marginLeft: "auto", color: "#64748b", fontSize: "12px", fontWeight: 700 }}>
                      {learner.grade}
                    </span>
                  ) : null}
                </label>
              );
            })
          )}
        </div>

        <div style={{ padding: "14px 18px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#fff", fontWeight: 800 }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || selectedIds.size === 0}
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #d4af37, #f5d06f)",
              color: "#111827",
              fontWeight: 900,
              opacity: saving || selectedIds.size === 0 ? 0.6 : 1,
            }}
          >
            {saving ? "Adding…" : `Add ${selectedIds.size || ""} learner${selectedIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
