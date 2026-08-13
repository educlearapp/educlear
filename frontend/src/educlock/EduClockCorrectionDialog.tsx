import { useEffect, useRef, useState } from "react";
import { postOwnerEduClockCorrection } from "./educlockApi";
import {
  OWNER_CORRECTION_REASONS,
  canonicalizeHtmlTimeValue,
  correctionActionForStatus,
  correctionNotesRequired,
  correctionTimeInputResetKey,
  isMissingClockOutStatus,
  readCanonicalTimeFromInput,
  type EduClockCorrectionTarget,
} from "./educlockCorrectionUi";
import { ownerButtonStyle, ownerInputStyle, ownerSecondaryButtonStyle } from "./educlockOwnerUi";

export default function EduClockCorrectionDialog(props: {
  target: EduClockCorrectionTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { target } = props;
  const missing = isMissingClockOutStatus(target.currentStatus);
  const resetKey = correctionTimeInputResetKey(target);
  const [reason, setReason] = useState<string>(
    missing ? "Forgot to clock out" : OWNER_CORRECTION_REASONS[4]
  );
  const [note, setNote] = useState("");
  const [corrTime, setCorrTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const timeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCorrTime("");
    setNote("");
    setError("");
    setReason(isMissingClockOutStatus(target.currentStatus) ? "Forgot to clock out" : OWNER_CORRECTION_REASONS[4]);
    timeRef.current?.focus();
  }, [resetKey, target.currentStatus]);

  function captureTimeFromElement(el: HTMLInputElement | null) {
    const canonical = canonicalizeHtmlTimeValue(el?.value);
    setCorrTime(canonical || "");
  }

  async function submit() {
    const canonical = readCanonicalTimeFromInput(timeRef.current, corrTime);
    if (!canonical) {
      setError("Enter the correct clock-out time.");
      return;
    }
    if (correctionNotesRequired(reason) && !note.trim()) {
      setError("A note is required when reason is Other.");
      return;
    }
    setCorrTime(canonical);
    setSaving(true);
    setError("");
    try {
      await postOwnerEduClockCorrection({
        employeeId: target.employeeId,
        action: correctionActionForStatus(target.currentStatus),
        reason,
        note: note.trim() ? note.trim() : null,
        schoolLocalDate: target.affectedSchoolLocalDate,
        schoolLocalTime: canonical,
        targetEventId: target.clockInEventId || null,
      });
      await props.onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Correction failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="educlock-correction-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) props.onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 20,
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
        }}
      >
        <h3 id="educlock-correction-title" style={{ margin: 0, fontSize: 18 }}>
          Correct attendance
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>
          Original clock events are preserved. This saves an owner correction audit record.
        </p>

        <dl style={{ margin: "12px 0 0", fontSize: 14, display: "grid", gap: 6 }}>
          <div>
            <dt style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>Employee</dt>
            <dd style={{ margin: 0 }}>
              {target.employeeName}
              {target.employeeNumber ? ` · ${target.employeeNumber}` : ""}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>Attendance date</dt>
            <dd style={{ margin: 0 }}>{target.affectedSchoolLocalDate}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>Clock In</dt>
            <dd style={{ margin: 0 }}>{target.clockInTime || "—"}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>Clock Out</dt>
            <dd style={{ margin: 0 }}>{missing ? "Missing" : target.clockOutTime || "—"}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>Status</dt>
            <dd style={{ margin: 0 }}>{target.currentStatus || "—"}</dd>
          </div>
        </dl>

        {error ? (
          <p role="alert" style={{ color: "#b91c1c", marginTop: 12 }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Correct Clock Out time
            <input
              key={resetKey}
              ref={timeRef}
              type="time"
              defaultValue=""
              onChange={(e) => captureTimeFromElement(e.currentTarget)}
              onInput={(e) => captureTimeFromElement(e.currentTarget)}
              onBlur={(e) => captureTimeFromElement(e.currentTarget)}
              style={{ ...ownerInputStyle, width: "100%", marginTop: 6 }}
              required
            />
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Correction reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ ...ownerInputStyle, width: "100%", marginTop: 6 }}
            >
              {OWNER_CORRECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            {correctionNotesRequired(reason) ? "Notes (required)" : "Notes (optional)"}
            <textarea
              placeholder={correctionNotesRequired(reason) ? "Note required" : "Optional note"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              style={{ ...ownerInputStyle, width: "100%", marginTop: 6, minHeight: 64 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              style={ownerButtonStyle}
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "Saving…" : "Save correction"}
            </button>
            <button
              type="button"
              style={ownerSecondaryButtonStyle}
              disabled={saving}
              onClick={props.onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
