import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchOwnerEduClockReadiness,
  fetchOwnerEduClockStaff,
  ownerBulkUpdateEmployeeNumbers,
  ownerLinkEduClock,
  ownerResetEduClock,
  ownerUnlinkEduClock,
} from "./educlockApi";
import {
  EduClockBadge,
  EduClockBadgeStack,
  OwnerSection,
  friendlyReadinessLabel,
  ownerButtonStyle,
  ownerCardStyle,
  ownerInputStyle,
  ownerSecondaryButtonStyle,
  toneForBucket,
} from "./educlockOwnerUi";

type StaffRow = {
  userId: string;
  loginEmail: string;
  userName: string;
  status: string;
  employeeId: string | null;
  employeeNumber: string | null;
  employeeName: string | null;
  identityMasked: string | null;
  identityType: string | null;
};

type UnlinkedEmployee = {
  employeeId: string;
  employeeNumber: string | null;
  employeeName: string;
  isActive: boolean;
  identityMasked: string | null;
};

type ReadinessEmployee = {
  employeeId: string;
  employeeName: string;
  email: string | null;
  employeeNumber: string | null;
  readiness: string;
  reasons: string[];
  isActive: boolean;
  identityMasked: string | null;
  identityType: string | null;
  linkedUserId?: string | null;
};

export type StaffReadinessCache = {
  counts: Record<string, number>;
  totals: Record<string, number>;
  employees: ReadinessEmployee[];
  usersWithoutEmployee: Array<Record<string, unknown>>;
};

const PAGE_SIZE = 20;

type FilterKey =
  | "ALL"
  | "readyToActivate"
  | "missingEmployeeNumber"
  | "missingUserLink"
  | "missingIdentityDocument"
  | "invalidIdentityDocument"
  | "alreadyActivated"
  | "inactive";

function matchesFilter(emp: ReadinessEmployee, filter: FilterKey): boolean {
  if (filter === "ALL") return true;
  if (filter === "inactive") return !emp.isActive;
  if (filter === "missingUserLink") return !emp.linkedUserId && emp.isActive;
  return emp.readiness === filter;
}

type Props = {
  embedded?: boolean;
  /** Optional cached readiness from parent — avoids refetch on tab switch. */
  readinessCache?: StaffReadinessCache | null;
  onReadinessUpdated?: (cache: StaffReadinessCache) => void;
};

export default function EduClockOwnerStaffPage({
  embedded: embeddedProp,
  readinessCache,
  onReadinessUpdated,
}: Props = {}) {
  const embedded = Boolean(embeddedProp);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedEmployee[]>([]);
  const [linkPick, setLinkPick] = useState<Record<string, string>>({});
  const [busyUserId, setBusyUserId] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [employees, setEmployees] = useState<ReadinessEmployee[]>([]);
  const [usersWithoutEmployee, setUsersWithoutEmployee] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterKey>("ALL");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [draftNumbers, setDraftNumbers] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [validationPreview, setValidationPreview] = useState<string[]>([]);
  const [savingNumbers, setSavingNumbers] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const applyReadiness = useCallback(
    (readiness: {
      counts?: Record<string, number>;
      totals?: Record<string, number>;
      employees?: Array<Record<string, unknown>>;
      usersWithoutEmployee?: Array<Record<string, unknown>>;
    }) => {
      const nextCounts = readiness.counts || {};
      const nextTotals = readiness.totals || {};
      const nextEmployees = (readiness.employees || []) as ReadinessEmployee[];
      const nextUsers = readiness.usersWithoutEmployee || [];
      setCounts(nextCounts);
      setTotals(nextTotals);
      setEmployees(nextEmployees);
      setUsersWithoutEmployee(nextUsers);
      const drafts: Record<string, string> = {};
      for (const emp of nextEmployees) {
        drafts[String(emp.employeeId)] = String(emp.employeeNumber || "");
      }
      setDraftNumbers(drafts);
      onReadinessUpdated?.({
        counts: nextCounts,
        totals: nextTotals,
        employees: nextEmployees,
        usersWithoutEmployee: nextUsers,
      });
    },
    [onReadinessUpdated]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [staffData, readiness] = await Promise.all([
        fetchOwnerEduClockStaff(),
        fetchOwnerEduClockReadiness(),
      ]);
      setStaff((staffData.staff || []) as StaffRow[]);
      setUnlinked((staffData.unlinkedEmployees || []) as UnlinkedEmployee[]);
      applyReadiness(readiness);
      setSelected({});
      setRowErrors({});
      setValidationPreview([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load EduClock staff");
    } finally {
      setLoading(false);
    }
  }, [applyReadiness]);

  useEffect(() => {
    if (readinessCache) {
      setCounts(readinessCache.counts);
      setTotals(readinessCache.totals);
      setEmployees(readinessCache.employees);
      setUsersWithoutEmployee(readinessCache.usersWithoutEmployee);
      const drafts: Record<string, string> = {};
      for (const emp of readinessCache.employees) {
        drafts[String(emp.employeeId)] = String(emp.employeeNumber || "");
      }
      setDraftNumbers(drafts);
    }
    void (async () => {
      setLoading(true);
      try {
        const staffData = await fetchOwnerEduClockStaff();
        setStaff((staffData.staff || []) as StaffRow[]);
        setUnlinked((staffData.unlinkedEmployees || []) as UnlinkedEmployee[]);
        if (!readinessCache) {
          const readiness = await fetchOwnerEduClockReadiness();
          applyReadiness(readiness);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load EduClock staff");
      } finally {
        setLoading(false);
      }
    })();
    // Load once on mount; parent cache avoids readiness refetch on tab return.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missingUserLinkCount = useMemo(
    () => employees.filter((e) => e.isActive && !e.linkedUserId).length,
    [employees]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (!matchesFilter(e, statusFilter)) return false;
      if (!q) return true;
      const hay = `${e.employeeName} ${e.email || ""} ${e.employeeNumber || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [employees, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function runAction(userId: string, action: () => Promise<unknown>) {
    setBusyUserId(userId);
    setError("");
    try {
      await action();
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyUserId("");
    }
  }

  function validateDraftInline(employeeId: string, value: string) {
    const trimmed = value.trim();
    const nextErrors = { ...rowErrors };
    if (!trimmed) {
      delete nextErrors[employeeId];
      setRowErrors(nextErrors);
      return;
    }
    const clash = employees.find(
      (e) =>
        e.employeeId !== employeeId &&
        String(e.employeeNumber || "").trim() === trimmed
    );
    if (clash) {
      nextErrors[employeeId] = `Already used by ${clash.employeeName}`;
    } else {
      const draftClash = Object.entries(draftNumbers).find(
        ([id, num]) => id !== employeeId && String(num || "").trim() === trimmed
      );
      if (draftClash) {
        nextErrors[employeeId] = "Duplicate in current edits";
      } else {
        delete nextErrors[employeeId];
      }
    }
    setRowErrors(nextErrors);
  }

  function previewBulkSave() {
    const selectedIds = Object.keys(selected).filter((id) => selected[id]);
    const issues: string[] = [];
    const seen = new Map<string, string>();
    if (!selectedIds.length) {
      setValidationPreview(["Select at least one employee."]);
      return [];
    }
    const updates: Array<{ employeeId: string; employeeNumber: string }> = [];
    for (const id of selectedIds) {
      const value = String(draftNumbers[id] || "").trim();
      if (!value) {
        issues.push("Enter an employee number for each selected employee.");
        continue;
      }
      if (seen.has(value)) {
        issues.push(`Duplicate in selection: “${value}”`);
        continue;
      }
      seen.set(value, id);
      updates.push({ employeeId: id, employeeNumber: value });
    }
    for (const emp of employees) {
      const current = String(emp.employeeNumber || "").trim();
      if (!current) continue;
      if (selected[emp.employeeId]) continue;
      const clash = seen.get(current);
      if (clash && clash !== emp.employeeId) {
        issues.push(`“${current}” is already used by another employee`);
      }
    }
    setValidationPreview(issues.length ? issues : [`Ready to save ${updates.length} employee number(s).`]);
    return issues.length ? [] : updates;
  }

  async function saveBulkNumbers() {
    const updates = previewBulkSave();
    if (!updates.length) return;
    setSavingNumbers(true);
    setError("");
    try {
      const result = await ownerBulkUpdateEmployeeNumbers(updates);
      // Show saved numbers immediately in drafts before full reload
      setDraftNumbers((prev) => {
        const next = { ...prev };
        for (const row of result.updated || updates) {
          next[row.employeeId] = row.employeeNumber;
        }
        return next;
      });
      await reload();
      setValidationPreview([`Saved ${updates.length} employee number(s).`]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save employee numbers";
      setError(message);
      setValidationPreview([message]);
    } finally {
      setSavingNumbers(false);
    }
  }

  return (
    <div style={{ padding: embedded ? 0 : 16, maxWidth: 1200 }}>
      {!embedded ? <h1 className="page-title">EduClock staff readiness</h1> : null}
      <p style={{ color: "#64748b", marginTop: embedded ? 0 : 8, maxWidth: 800, lineHeight: 1.5 }}>
        Prepare employee numbers and identity documents before staff activate EduClock. Identity
        documents are only used for first-time activation. Numbers are school-defined strings
        (leading zeroes preserved) and are never generated automatically.
      </p>

      {error && (
        <p role="alert" style={{ color: "#b91c1c", marginTop: 12 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p style={{ marginTop: 24 }}>Loading…</p>
      ) : (
        <>
          <section
            style={{
              marginTop: 20,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 12,
            }}
            aria-label="Preparation summary"
          >
            {[
              ["Ready", counts.readyToActivate, "readyToActivate"],
              ["Missing Employee Number", counts.missingEmployeeNumber, "missingEmployeeNumber"],
              ["Missing User Link", missingUserLinkCount, "missingUserLink"],
              ["Missing Identity Verification", counts.missingIdentityDocument, "missingIdentityDocument"],
              ["Invalid Identity", counts.invalidIdentityDocument, "invalidIdentityDocument"],
              [
                "Active Employees",
                Math.max(0, Number(totals.employees || 0) - Number(totals.inactiveEmployees || 0)),
                "active",
              ],
            ].map(([label, value, key]) => (
              <div key={String(key)} style={ownerCardStyle}>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{Number(value || 0)}</div>
              </div>
            ))}
          </section>

          <OwnerSection
            title="Employee Preparation"
            subtitle="Prepare employees for EduClock activation. Employee numbers are school-defined and are never generated automatically."
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
              <input
                placeholder="Search employee, email or employee number…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                style={{ ...ownerInputStyle, minWidth: 260, flex: "1 1 240px" }}
                aria-label="Search employees"
              />
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as FilterKey);
                  setPage(0);
                }}
                style={{ ...ownerInputStyle, minWidth: 200 }}
                aria-label="Filter by readiness status"
              >
                <option value="ALL">All</option>
                <option value="readyToActivate">Ready</option>
                <option value="missingEmployeeNumber">Missing Employee Number</option>
                <option value="missingUserLink">Missing User Link</option>
                <option value="missingIdentityDocument">Missing Identity</option>
                <option value="invalidIdentityDocument">Invalid Identity</option>
                <option value="alreadyActivated">Activated</option>
                <option value="inactive">Inactive</option>
              </select>
              <button type="button" style={ownerSecondaryButtonStyle} onClick={() => previewBulkSave()}>
                Validate selection
              </button>
              <button
                type="button"
                style={ownerButtonStyle}
                disabled={savingNumbers}
                onClick={() => void saveBulkNumbers()}
              >
                {savingNumbers ? "Saving…" : "Save selected numbers"}
              </button>
            </div>
            {validationPreview.length > 0 && (
              <ul style={{ marginBottom: 12, color: "#334155", lineHeight: 1.5 }}>
                {validationPreview.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            )}

            {narrow ? (
              <div style={{ display: "grid", gap: 12 }}>
                {pageRows.map((row) => (
                  <article key={row.employeeId} style={{ ...ownerCardStyle, padding: 14 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[row.employeeId])}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [row.employeeId]: e.target.checked }))
                        }
                        aria-label={`Select ${row.employeeName}`}
                        style={{ marginTop: 4 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>{row.employeeName}</div>
                        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                          {row.email || "No email"}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <input
                            value={draftNumbers[row.employeeId] ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setDraftNumbers((prev) => ({ ...prev, [row.employeeId]: value }));
                              validateDraftInline(row.employeeId, value);
                            }}
                            placeholder="Enter employee number"
                            style={{ ...ownerInputStyle, width: "100%" }}
                            inputMode="text"
                            autoComplete="off"
                            aria-label={`Employee number for ${row.employeeName}`}
                          />
                          {rowErrors[row.employeeId] ? (
                            <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 4 }}>
                              {rowErrors[row.employeeId]}
                            </div>
                          ) : row.employeeNumber ? (
                            <div style={{ color: "#047857", fontSize: 12, marginTop: 4 }}>
                              Saved: {row.employeeNumber}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                          <EduClockBadge
                            label={row.isActive ? "Active" : "Inactive"}
                            tone={row.isActive ? "blue" : "grey"}
                          />
                          <EduClockBadge
                            label={row.linkedUserId ? "User Linked" : "User Account Not Linked"}
                            tone={row.linkedUserId ? "green" : "orange"}
                          />
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <EduClockBadgeStack
                            labels={
                              row.reasons?.length
                                ? row.reasons
                                : [friendlyReadinessLabel(row.readiness)]
                            }
                          />
                        </div>
                        <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                          Identity: {row.identityMasked || "—"}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                    minWidth: 720,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ padding: "12px 10px" }} />
                      <th style={{ padding: "12px 10px" }}>Employee</th>
                      <th style={{ padding: "12px 10px" }}>Email</th>
                      <th style={{ padding: "12px 10px" }}>Employee Number</th>
                      <th style={{ padding: "12px 10px" }}>Status</th>
                      <th style={{ padding: "12px 10px" }}>Readiness</th>
                      <th style={{ padding: "12px 10px" }}>Identity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={row.employeeId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[row.employeeId])}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [row.employeeId]: e.target.checked,
                              }))
                            }
                            aria-label={`Select ${row.employeeName}`}
                          />
                        </td>
                        <td style={{ padding: "14px 10px", verticalAlign: "top", fontWeight: 600 }}>
                          {row.employeeName}
                        </td>
                        <td style={{ padding: "14px 10px", verticalAlign: "top", color: "#64748b" }}>
                          {row.email || "—"}
                        </td>
                        <td style={{ padding: "14px 10px", verticalAlign: "top", minWidth: 180 }}>
                          <input
                            value={draftNumbers[row.employeeId] ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setDraftNumbers((prev) => ({ ...prev, [row.employeeId]: value }));
                              validateDraftInline(row.employeeId, value);
                            }}
                            placeholder="Enter employee number"
                            style={{ ...ownerInputStyle, width: "100%" }}
                            inputMode="text"
                            autoComplete="off"
                          />
                          {rowErrors[row.employeeId] ? (
                            <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 4 }}>
                              {rowErrors[row.employeeId]}
                            </div>
                          ) : row.employeeNumber ? (
                            <div style={{ color: "#047857", fontSize: 12, marginTop: 4 }}>
                              Saved: {row.employeeNumber}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <EduClockBadge
                              label={row.isActive ? "Active" : "Inactive"}
                              tone={row.isActive ? "blue" : "grey"}
                            />
                            <EduClockBadge
                              label={row.linkedUserId ? "User Linked" : "User Account Not Linked"}
                              tone={row.linkedUserId ? "green" : "orange"}
                            />
                          </div>
                        </td>
                        <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                          <EduClockBadgeStack
                            labels={
                              row.reasons?.length
                                ? row.reasons
                                : [friendlyReadinessLabel(row.readiness)]
                            }
                          />
                        </td>
                        <td style={{ padding: "14px 10px", verticalAlign: "top" }}>
                          {row.identityMasked || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
              <button
                type="button"
                style={ownerSecondaryButtonStyle}
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: 13 }}>
                Page {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                style={ownerSecondaryButtonStyle}
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          </OwnerSection>

          {usersWithoutEmployee.length > 0 && (
            <OwnerSection
              title="Users Requiring Employee Link"
              subtitle="These users have login accounts but are not linked to an employee record. Link them before EduClock activation."
            >
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {usersWithoutEmployee.map((u) => (
                  <li key={String(u.userId)}>
                    {String(u.loginEmail)} ({String(u.userName)})
                  </li>
                ))}
              </ul>
            </OwnerSection>
          )}

          <OwnerSection title="Activation Links" subtitle="Link, reset, or unlink staff logins to employee records.">
            {narrow ? (
              <div style={{ display: "grid", gap: 12 }}>
                {staff.map((row) => (
                  <article key={row.userId} style={ownerCardStyle}>
                    <div style={{ fontWeight: 800 }}>{row.loginEmail}</div>
                    <div style={{ marginTop: 8 }}>
                      <EduClockBadge
                        label={friendlyReadinessLabel(row.status)}
                        tone={
                          row.status === "ACTIVE"
                            ? "green"
                            : row.status === "NOT_ACTIVATED"
                              ? "grey"
                              : toneForBucket(row.status)
                        }
                      />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, color: "#475569" }}>
                      Linked employee: {row.employeeName || "—"}
                      <br />
                      Employee number: {row.employeeNumber || "—"}
                      <br />
                      Identity: {row.identityMasked || "—"}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                      {row.status === "ACTIVE" || row.employeeId ? (
                        <>
                          <button
                            type="button"
                            style={ownerSecondaryButtonStyle}
                            disabled={busyUserId === row.userId}
                            onClick={() =>
                              void runAction(row.userId, () => ownerResetEduClock(row.userId))
                            }
                          >
                            Reset
                          </button>
                          <button
                            type="button"
                            style={ownerSecondaryButtonStyle}
                            disabled={busyUserId === row.userId}
                            onClick={() =>
                              void runAction(row.userId, () => ownerUnlinkEduClock(row.userId))
                            }
                          >
                            Unlink
                          </button>
                        </>
                      ) : null}
                      {!row.employeeId && (
                        <>
                          <select
                            value={linkPick[row.userId] || ""}
                            onChange={(e) =>
                              setLinkPick((prev) => ({ ...prev, [row.userId]: e.target.value }))
                            }
                            style={ownerInputStyle}
                            aria-label={`Link employee for ${row.loginEmail}`}
                          >
                            <option value="">Link employee…</option>
                            {unlinked.map((emp) => (
                              <option key={emp.employeeId} value={emp.employeeId}>
                                {(emp.employeeNumber || "no-number") + " — " + emp.employeeName}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            style={ownerButtonStyle}
                            disabled={!linkPick[row.userId] || busyUserId === row.userId}
                            onClick={() =>
                              void runAction(row.userId, () =>
                                ownerLinkEduClock(row.userId, linkPick[row.userId])
                              )
                            }
                          >
                            Link
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 720 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ padding: "12px 10px" }}>Login Email</th>
                      <th style={{ padding: "12px 10px" }}>Activation Status</th>
                      <th style={{ padding: "12px 10px" }}>Linked Employee</th>
                      <th style={{ padding: "12px 10px" }}>Employee Number</th>
                      <th style={{ padding: "12px 10px" }}>Identity Status</th>
                      <th style={{ padding: "12px 10px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((row) => (
                      <tr key={row.userId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "14px 10px" }}>{row.loginEmail}</td>
                        <td style={{ padding: "14px 10px" }}>
                          <EduClockBadge
                            label={friendlyReadinessLabel(row.status)}
                            tone={
                              row.status === "ACTIVE"
                                ? "green"
                                : row.status === "NOT_ACTIVATED"
                                  ? "grey"
                                  : "amber"
                            }
                          />
                        </td>
                        <td style={{ padding: "14px 10px" }}>{row.employeeName || "—"}</td>
                        <td style={{ padding: "14px 10px" }}>{row.employeeNumber || "—"}</td>
                        <td style={{ padding: "14px 10px" }}>{row.identityMasked || "—"}</td>
                        <td style={{ padding: "14px 10px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            {row.status === "ACTIVE" || row.employeeId ? (
                              <>
                                <button
                                  type="button"
                                  style={ownerSecondaryButtonStyle}
                                  disabled={busyUserId === row.userId}
                                  onClick={() =>
                                    void runAction(row.userId, () => ownerResetEduClock(row.userId))
                                  }
                                >
                                  Reset
                                </button>
                                <button
                                  type="button"
                                  style={ownerSecondaryButtonStyle}
                                  disabled={busyUserId === row.userId}
                                  onClick={() =>
                                    void runAction(row.userId, () => ownerUnlinkEduClock(row.userId))
                                  }
                                >
                                  Unlink
                                </button>
                              </>
                            ) : null}
                            {!row.employeeId && (
                              <>
                                <select
                                  value={linkPick[row.userId] || ""}
                                  onChange={(e) =>
                                    setLinkPick((prev) => ({ ...prev, [row.userId]: e.target.value }))
                                  }
                                  style={ownerInputStyle}
                                >
                                  <option value="">Link employee…</option>
                                  {unlinked.map((emp) => (
                                    <option key={emp.employeeId} value={emp.employeeId}>
                                      {(emp.employeeNumber || "no-number") + " — " + emp.employeeName}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  style={ownerButtonStyle}
                                  disabled={!linkPick[row.userId] || busyUserId === row.userId}
                                  onClick={() =>
                                    void runAction(row.userId, () =>
                                      ownerLinkEduClock(row.userId, linkPick[row.userId])
                                    )
                                  }
                                >
                                  Link
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </OwnerSection>
        </>
      )}
    </div>
  );
}
