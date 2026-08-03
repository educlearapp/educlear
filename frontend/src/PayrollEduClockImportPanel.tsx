/**
 * Minimal EduClock hours import panel for the existing Payroll page.
 * Backend calculates all durations; this UI only displays and confirms.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  confirmEduClockImport,
  createPayrollRun,
  finalizePayrollRun,
  formatWorkedHours,
  getCurrentEduClockImport,
  listPayrollRuns,
  previewEduClockImport,
  recalculateEduClockImport,
  reopenPayrollRun,
  summarizeLineWarnings,
  PayrollEduClockApiError,
  type ConfirmedImport,
  type EduClockPreview,
  type PayrollRunSummary,
} from "./payrollEduClockImportApi";

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

type Props = {
  schoolId: string;
};

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  border: "1px solid #d6c17a",
  boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  background: "#111827",
  color: "#d4af37",
  padding: "12px 16px",
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: 0.3,
};

const btn: React.CSSProperties = {
  border: "1px solid #d6c17a",
  background: "#fff",
  color: "#111827",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};

const goldBtn: React.CSSProperties = {
  ...btn,
  background: "#d4af37",
  borderColor: "#b8962e",
};

const input: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  minWidth: 0,
};

function statusLabel(status: string): string {
  if (status === "FINALIZED") return "Finalized";
  if (status === "CANCELLED") return "Cancelled";
  return "Draft (open)";
}

export default function PayrollEduClockImportPanel({ schoolId }: Props) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [runs, setRuns] = useState<PayrollRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [preview, setPreview] = useState<EduClockPreview | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcReason, setRecalcReason] = useState("");
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) || null,
    [runs, selectedRunId]
  );
  const isFinalized = selectedRun?.status === "FINALIZED";

  const clearPreview = useCallback(() => {
    setPreview(null);
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const list = await listPayrollRuns({ payrollMonth: month, payrollYear: year });
      setRuns(list);
      setSelectedRunId((prev) => {
        if (prev && list.some((r) => r.id === prev)) return prev;
        return list[0]?.id || "";
      });
    } catch (e) {
      setError(e instanceof PayrollEduClockApiError ? e.message : "Could not load payroll runs.");
    }
  }, [month, year]);

  const loadConfirmed = useCallback(async (runId: string) => {
    if (!runId) {
      setConfirmed(null);
      return;
    }
    try {
      const cur = await getCurrentEduClockImport({ payrollRunId: runId });
      setConfirmed(cur);
    } catch {
      setConfirmed(null);
    }
  }, []);

  useEffect(() => {
    clearPreview();
    setMessage("");
    setError("");
    void loadRuns();
  }, [month, year, loadRuns, clearPreview]);

  useEffect(() => {
    clearPreview();
    setMessage("");
    setError("");
    void loadConfirmed(selectedRunId);
  }, [selectedRunId, loadConfirmed, clearPreview]);

  async function handlePreview() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = selectedRunId
        ? await previewEduClockImport({ payrollRunId: selectedRunId })
        : await previewEduClockImport({ payrollMonth: month, payrollYear: year });
      setPreview(result);
      if (!result.confirmable) {
        setMessage("Preview only — select or create a Payroll Run before confirming.");
      } else {
        setMessage("Preview ready. Review the results before confirming.");
      }
    } catch (e) {
      setError(e instanceof PayrollEduClockApiError ? e.message : "Preview failed.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRun() {
    setBusy(true);
    setError("");
    try {
      const created = await createPayrollRun({ month, year });
      await loadRuns();
      setSelectedRunId(created.payrollRunId);
      clearPreview();
      if (created.reusedExisting) {
        setMessage(
          created.status === "FINALIZED"
            ? "A finalized payroll run already exists for this period and has been selected."
            : "A payroll run already exists and has been selected."
        );
      } else {
        setMessage("Payroll run created. Preview EduClock hours for this run next.");
      }
      // Fresh run-bound preview after create/reuse (read-only if finalized)
      if (created.payrollRunId) {
        try {
          const result = await previewEduClockImport({ payrollRunId: created.payrollRunId });
          setPreview(result);
        } catch {
          /* preview optional after create */
        }
      }
    } catch (e) {
      setError(e instanceof PayrollEduClockApiError ? e.message : "Could not create payroll run.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview?.confirmable || !preview.payrollRunId || !preview.previewHash || busy || isFinalized) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Confirm never creates a PayrollRun — only sends run id + preview hash.
      const result = await confirmEduClockImport({
        payrollRunId: preview.payrollRunId,
        previewHash: preview.previewHash,
      });
      setConfirmOpen(false);
      setMessage(
        result.idempotent
          ? "EduClock hours were already imported for this run. Showing the current import."
          : "EduClock hours imported successfully."
      );
      clearPreview();
      await loadConfirmed(result.import.payrollRunId);
      await loadRuns();
    } catch (e) {
      if (e instanceof PayrollEduClockApiError && e.code === "STALE_PREVIEW") {
        setError(e.message);
        setConfirmOpen(false);
      } else if (e instanceof PayrollEduClockApiError && e.code === "IMPORT_ALREADY_CONFIRMED") {
        setConfirmOpen(false);
        setMessage(e.message);
        if (preview.payrollRunId) await loadConfirmed(preview.payrollRunId);
        clearPreview();
      } else {
        setError(e instanceof PayrollEduClockApiError ? e.message : "Confirm failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRecalculate() {
    if (!selectedRunId || !confirmed || !recalcReason.trim() || busy || isFinalized) return;
    setBusy(true);
    setError("");
    try {
      const fresh = await previewEduClockImport({ payrollRunId: selectedRunId });
      const result = await recalculateEduClockImport({
        payrollRunId: selectedRunId,
        previousConfirmedImportId: confirmed.id,
        previewHash: fresh.previewHash,
        reason: recalcReason.trim(),
      });
      setRecalcOpen(false);
      setRecalcReason("");
      if (result.outcome === "NO_CHANGES") {
        setMessage("No EduClock time changes were found. The current import remains unchanged.");
        setConfirmed(result.import);
      } else {
        setMessage(
          "EduClock hours recalculated. The previous import snapshot was preserved as superseded."
        );
        setConfirmed(result.import);
      }
      clearPreview();
    } catch (e) {
      setError(e instanceof PayrollEduClockApiError ? e.message : "Recalculate failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    if (!selectedRunId || busy) return;
    setBusy(true);
    setError("");
    try {
      await finalizePayrollRun({ payrollRunId: selectedRunId });
      setFinalizeOpen(false);
      setMessage("Payroll run finalized. EduClock import and recalculation are locked.");
      await loadRuns();
      clearPreview();
    } catch (e) {
      setError(e instanceof PayrollEduClockApiError ? e.message : "Finalize failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!selectedRunId || !reopenReason.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await reopenPayrollRun({ payrollRunId: selectedRunId, reason: reopenReason.trim() });
      setReopenOpen(false);
      setReopenReason("");
      setMessage("Payroll run reopened. Import and recalculation are available again.");
      clearPreview();
      await loadRuns();
      // Refresh selected run state before any new preview
      await loadConfirmed(selectedRunId);
    } catch (e) {
      setError(e instanceof PayrollEduClockApiError ? e.message : "Reopen failed.");
    } finally {
      setBusy(false);
    }
  }

  const warningCount = preview
    ? preview.lines.filter((l) => l.status === "WARNING").length
    : confirmed?.totalWarningCount ?? 0;
  const blockedCount = preview ? preview.lines.filter((l) => l.status === "BLOCKED").length : 0;
  const shiftCount = preview
    ? preview.lines.reduce((s, l) => s + l.sourcePairCount, 0)
    : 0;
  const canConfirm = Boolean(preview?.confirmable && preview.payrollRunId && !isFinalized && !busy);

  return (
    <div style={{ ...card, marginBottom: 22 }}>
      <div style={header}>Import EduClock Hours</div>
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <p style={{ margin: 0, color: "#4b5563", fontSize: 13, lineHeight: 1.5 }}>
          Import verified Clock In / Clock Out hours into a payroll run. Salaries, PAYE, UIF,
          allowances, deductions and manual overtime are not changed automatically.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
            Month
            <select
              style={input}
              value={month}
              disabled={busy}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
            Year
            <input
              style={input}
              type="number"
              value={year}
              disabled={busy}
              onChange={(e) => setYear(Number(e.target.value) || year)}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
            Payroll run
            <select
              style={input}
              value={selectedRunId}
              disabled={busy}
              onChange={(e) => setSelectedRunId(e.target.value)}
            >
              <option value="">No run selected</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {MONTH_OPTIONS[r.payrollMonth - 1]?.label} {r.payrollYear} — {statusLabel(r.status)} (
                  {r.id.slice(-6)})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 8,
            fontSize: 13,
            background: "#f9fafb",
            borderRadius: 12,
            padding: 12,
            border: "1px solid #eee",
          }}
        >
          <div>
            <strong>Run status:</strong> {selectedRun ? statusLabel(selectedRun.status) : "—"}
          </div>
          <div>
            <strong>Timezone:</strong>{" "}
            {preview?.schoolTimezone || confirmed?.schoolTimezone || "Africa/Johannesburg"}
          </div>
          <div>
            <strong>Import:</strong>{" "}
            {confirmed ? "Confirmed" : "None yet"}
          </div>
          <div>
            <strong>Last import:</strong>{" "}
            {confirmed?.confirmedAt ? new Date(confirmed.confirmedAt).toLocaleString() : "—"}
          </div>
          <div>
            <strong>Verified hours:</strong>{" "}
            {confirmed
              ? formatWorkedHours(confirmed.totalWorkedMinutes)
              : preview
                ? formatWorkedHours(preview.totalWorkedMinutes)
                : "—"}
          </div>
          <div>
            <strong>Warnings:</strong> {confirmed?.totalWarningCount ?? warningCount}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button style={btn} disabled={busy} onClick={() => void handleCreateRun()}>
            Create payroll run for this period
          </button>
          <button style={goldBtn} disabled={busy} onClick={() => void handlePreview()}>
            Preview EduClock Hours
          </button>
          <button
            style={goldBtn}
            disabled={!canConfirm}
            onClick={() => setConfirmOpen(true)}
            title={
              isFinalized
                ? "This payroll run is finalized and cannot be changed."
                : preview && !preview.confirmable
                  ? "Select a payroll run and refresh preview first"
                  : undefined
            }
          >
            Confirm Import
          </button>
          <button
            style={btn}
            disabled={busy || !confirmed || isFinalized || !selectedRunId}
            onClick={() => setRecalcOpen(true)}
          >
            Recalculate
          </button>
          {!isFinalized ? (
            <button
              style={btn}
              disabled={busy || !selectedRunId}
              onClick={() => setFinalizeOpen(true)}
            >
              Finalize Payroll
            </button>
          ) : (
            <button style={btn} disabled={busy || !selectedRunId} onClick={() => setReopenOpen(true)}>
              Reopen Payroll
            </button>
          )}
        </div>

        {message ? (
          <div style={{ color: "#065f46", background: "#ecfdf5", padding: 10, borderRadius: 10, fontSize: 13 }}>
            {message}
          </div>
        ) : null}
        {error ? (
          <div style={{ color: "#991b1b", background: "#fef2f2", padding: 10, borderRadius: 10, fontSize: 13 }}>
            {error}
            {error.toLowerCase().includes("out of date") || error.toLowerCase().includes("stale") ? (
              <div style={{ marginTop: 8 }}>
                <button style={btn} disabled={busy} onClick={() => void handlePreview()}>
                  Refresh Preview
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <div style={{ display: "grid", gap: 12 }}>
            {!preview.confirmable ? (
              <div style={{ background: "#fffbeb", border: "1px solid #f59e0b", padding: 10, borderRadius: 10, fontSize: 13 }}>
                Preview only — select or create a Payroll Run before confirming.
              </div>
            ) : null}
            <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
              <div>
                <strong>Period:</strong> {MONTH_OPTIONS[preview.payrollMonth - 1]?.label}{" "}
                {preview.payrollYear}
              </div>
              <div>
                <strong>Window:</strong> {new Date(preview.periodStartUtc).toLocaleString()} →{" "}
                {new Date(preview.periodEndUtc).toLocaleString()} ({preview.schoolTimezone})
              </div>
              <div>
                <strong>Employees with time:</strong> {preview.totalEmployees} ·{" "}
                <strong>Shifts:</strong> {shiftCount} · <strong>Verified:</strong>{" "}
                {formatWorkedHours(preview.totalWorkedMinutes)} · <strong>Warnings:</strong>{" "}
                {warningCount} · <strong>Blocked:</strong> {blockedCount}
              </div>
              <div style={{ color: "#6b7280" }}>
                EduClock verified hours and manually entered overtime are shown separately. Overtime
                rules have not yet been configured for automatic calculation.
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {preview.lines.map((line) => (
                <div
                  key={line.employeeId}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: line.status === "BLOCKED" ? "#fff1f2" : "#fff",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{line.employeeNameSnapshot}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {line.employeeNumberSnapshot || "Missing employee number"}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      {line.status === "READY" ? "Ready" : line.status === "WARNING" ? "Warning" : "Blocked"}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                      gap: 6,
                      fontSize: 12,
                    }}
                  >
                    <div>Verified worked: {formatWorkedHours(line.workedMinutes)}</div>
                    <div>Valid shifts: {line.sourcePairCount}</div>
                    <div>
                      Manual overtime: {Number(line.existingManualOvertimeHoursSnapshot || 0)}h
                    </div>
                    <div>Imported overtime: Not calculated</div>
                  </div>
                  {line.warningCodes.length ? (
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#7c2d12" }}>
                      {summarizeLineWarnings(line.warningCodes).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              {preview.lines.length === 0 ? (
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  No EduClock events found for this period.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {confirmOpen ? (
        <Modal
          title="Confirm EduClock import"
          onClose={() => !busy && setConfirmOpen(false)}
        >
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            Import verified EduClock hours into payroll run{" "}
            <strong>{preview?.payrollRunId?.slice(-8)}</strong> for{" "}
            <strong>
              {preview ? `${MONTH_OPTIONS[preview.payrollMonth - 1]?.label} ${preview.payrollYear}` : ""}
            </strong>
            .
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            Verified worked time will be linked to this payroll run. Salaries, PAYE, UIF, allowances,
            deductions and manual overtime will <strong>not</strong> be changed automatically.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btn} disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button style={goldBtn} disabled={busy || !canConfirm} onClick={() => void handleConfirm()}>
              {busy ? "Importing…" : "Confirm Import"}
            </button>
          </div>
        </Modal>
      ) : null}

      {recalcOpen ? (
        <Modal title="Recalculate EduClock hours" onClose={() => !busy && setRecalcOpen(false)}>
          <p style={{ fontSize: 13 }}>
            Enter a reason. A fresh preview will be calculated. Manual payroll money fields stay unchanged.
          </p>
          <textarea
            style={{ ...input, width: "100%", minHeight: 80 }}
            value={recalcReason}
            disabled={busy}
            onChange={(e) => setRecalcReason(e.target.value)}
            placeholder="Reason for recalculation"
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <button style={btn} disabled={busy} onClick={() => setRecalcOpen(false)}>
              Cancel
            </button>
            <button
              style={goldBtn}
              disabled={busy || !recalcReason.trim()}
              onClick={() => void handleRecalculate()}
            >
              {busy ? "Working…" : "Recalculate"}
            </button>
          </div>
        </Modal>
      ) : null}

      {finalizeOpen ? (
        <Modal title="Finalize payroll run" onClose={() => !busy && setFinalizeOpen(false)}>
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            This payroll run will be locked. EduClock hours cannot be imported or recalculated afterward,
            and payroll values cannot be changed until the run is reopened.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btn} disabled={busy} onClick={() => setFinalizeOpen(false)}>
              Cancel
            </button>
            <button style={goldBtn} disabled={busy} onClick={() => void handleFinalize()}>
              Finalize
            </button>
          </div>
        </Modal>
      ) : null}

      {reopenOpen ? (
        <Modal title="Reopen payroll run" onClose={() => !busy && setReopenOpen(false)}>
          <p style={{ fontSize: 13 }}>A reason is required. Recalculation will not run automatically.</p>
          <textarea
            style={{ ...input, width: "100%", minHeight: 80 }}
            value={reopenReason}
            disabled={busy}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="Reason for reopening"
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <button style={btn} disabled={busy} onClick={() => setReopenOpen(false)}>
              Cancel
            </button>
            <button
              style={goldBtn}
              disabled={busy || !reopenReason.trim()}
              onClick={() => void handleReopen()}
            >
              Reopen
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          maxWidth: 480,
          width: "100%",
          padding: 16,
          border: "1px solid #d6c17a",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 700, marginBottom: 10, color: "#111827" }}>{title}</div>
        {children}
      </div>
    </div>
  );
}
