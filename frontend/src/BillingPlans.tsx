import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";
import LearnerBillingPlanPage from "./LearnerBillingPlan";

type LearnerRow = {
  learnerId: string;
  firstName: string;
  lastName: string;
  classroom: string;
  totalAmount: number;
  childStatus: string;
  billingPlanStatus: string;
  grade: string;
  admissionNo: string | null;
};

function money(value: number) {
  const n = Number(value || 0);
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BillingPlans() {
  const schoolId = useSchoolId();

  const [mode, setMode] = useState<"list" | "manage">("list");
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [classrooms, setClassrooms] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);

  const [filterClassroom, setFilterClassroom] = useState("ALL");
  const [filterGroup, setFilterGroup] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) {
      setLearners([]);
      setClassrooms([]);
      setGroups([]);
      setError("No school selected.");
      return;
    }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const params = new URLSearchParams({
          schoolId,
          classroom: filterClassroom,
          group: filterGroup,
          q: search.trim(),
        });
        const data = (await apiFetch(`/api/billing-plans/learners?${params.toString()}`)) as any;
        if (cancelled) return;
        setLearners(Array.isArray(data?.learners) ? data.learners : []);
        setClassrooms(Array.isArray(data?.classrooms) ? data.classrooms : []);
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
      } catch (e: any) {
        // Only treat actual request failures as an error state.
        if (!cancelled) setError("Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId, filterClassroom, filterGroup, search]);

  const selectedLearner = useMemo(
    () => learners.find((l) => l.learnerId === selectedLearnerId) ?? null,
    [learners, selectedLearnerId]
  );

  if (mode === "manage" && selectedLearnerId) {
    return (
      <LearnerBillingPlanPage
        learnerId={selectedLearnerId}
        onBack={() => setMode("list")}
      />
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (!selectedLearnerId) return;
                setMode("manage");
              }}
              disabled={!selectedLearnerId}
              className="btn-gold-dark"
            >
              Manage
            </button>
            <button onClick={() => alert("Coming soon")} disabled className="btn-gold-light">
              Add Fees To Multiple
            </button>
            <button onClick={() => alert("Coming soon")} disabled className="btn-gold-light btn-danger-light">
              Remove Fees From Multiple
            </button>
            <button onClick={() => alert("Coming soon")} disabled className="btn-gold-light">
              Manage Multiple Fees
            </button>
          </div>

          {error && (
            <div style={{ padding: 12, border: "1px solid #f0b4b4", background: "#fff5f5", marginBottom: 12 }}>
              {error}
            </div>
          )}

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                  <th style={{ padding: 10, width: 30 }} />
                  <th style={{ padding: 10 }}>Name</th>
                  <th style={{ padding: 10 }}>Surname</th>
                  <th style={{ padding: 10 }}>Classroom</th>
                  <th style={{ padding: 10 }}>Total Amount</th>
                  <th style={{ padding: 10 }}>Child Status</th>
                  <th style={{ padding: 10 }}>Billing Plan Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 12 }}>
                      Loading…
                    </td>
                  </tr>
                ) : learners.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 12 }}>
                      No learners found yet. Add learners before setting up billing plans.
                    </td>
                  </tr>
                ) : (
                  learners.map((l) => {
                    const isSelected = l.learnerId === selectedLearnerId;
                    return (
                      <tr
                        key={l.learnerId}
                        style={{
                          background: isSelected ? "#eef2ff" : "white",
                          cursor: "pointer",
                          borderTop: "1px solid #e5e7eb",
                        }}
                        onClick={() => setSelectedLearnerId(l.learnerId)}
                      >
                        <td style={{ padding: 10 }}>
                          <input
                            type="radio"
                            checked={isSelected}
                            onChange={() => setSelectedLearnerId(l.learnerId)}
                          />
                        </td>
                        <td style={{ padding: 10 }}>{l.firstName}</td>
                        <td style={{ padding: 10 }}>{l.lastName}</td>
                        <td style={{ padding: 10 }}>{l.classroom || "-"}</td>
                        <td style={{ padding: 10 }}>{money(l.totalAmount)}</td>
                        <td style={{ padding: 10 }}>{l.childStatus}</td>
                        <td style={{ padding: 10 }}>{l.billingPlanStatus}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ width: 280, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Filters</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div>All Classrooms</div>
              <select value={filterClassroom} onChange={(e) => setFilterClassroom(e.target.value)}>
                <option value="ALL">All Classrooms</option>
                {classrooms.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div>All Groups</div>
              <select value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
                <option value="ALL">All Groups</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div>Search</div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name / Surname / Admission no" />
            </label>

            {selectedLearner && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e5e7eb" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Selected</div>
                <div style={{ fontSize: 13 }}>
                  <div>
                    {selectedLearner.firstName} {selectedLearner.lastName}
                  </div>
                  <div style={{ opacity: 0.8 }}>{selectedLearner.classroom || "-"}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

