import { useEffect, useState } from "react";
import { postOwnerEduClockCorrection } from "./educlockApi";
import {
  CLOCK_HOURS_12,
  CLOCK_MERIDIEMS,
  CLOCK_MINUTES,
  OWNER_CORRECTION_REASONS,
  canonicalizeTwelveHourClockParts,
  correctionActionForStatus,
  correctionNotesRequired,
  correctionTimeInputResetKey,
  isClockOutBeforeClockIn,
  isMissingClockOutStatus,
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
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [meridiem, setMeridiem] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setHour("");
    setMinute("");
    setMeridiem("");
    setNote("");
    setError("");
    setReason(isMissingClockOutStatus(target.currentStatus) ? "Forgot to clock out" : OWNER_CORRECTION_REASONS[4]);
  }, [resetKey, target.currentStatus]);

  const canonical = canonicalizeTwelveHourClockParts({ hour, minute, meridiem });

  async function submit() {
    const selected = canonicalizeTwelveHourClockParts({ hour, minute, meridiem });
    if (!selected) {
      setError("Enter the correct clock-out time.");
      return;
    }
    if (isClockOutBeforeClockIn(target.clockInTime, selected)) {
      setError("Clock-out time must be after clock-in.");
      return;
    }
    if (correctionNotesRequired(reason) && !note.trim()) {
      setError("A note is required when reason is Other.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await postOwnerEduClockCorrection({
        employeeId: target.employeeId,
        action: correctionActionForStatus(target.currentStatus),
        reason,
        note: note.trim() ? note.trim() : null,
        schoolLocalDate: target.affectedSchoolLocalDate,
        schoolLocalTime: selected,
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
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 700 }}>Correct Clock Out time</legend>
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <select
                aria-label="Hour"
                value={hour}
                onChange={(e) => setHour(e.target.value)}
                style={{ ...ownerInputStyle, flex: 1 }}
              >
                <option value="">HH</option>
                {CLOCK_HOURS_12.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span style={{ fontWeight: 700 }}>:</span>
              <select
                aria-label="Minute"
                value={minute}
                onChange={(e) => setMinute(e.target.value)}
                style={{ ...ownerInputStyle, flex: 1 }}
              >
                <option value="">MM</option>
                {CLOCK_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                aria-label="AM/PM"
                value={meridiem}
                onChange={(e) => setMeridiem(e.target.value)}
                style={{ ...ownerInputStyle, flex: 1 }}
              >
                <option value="">AM/PM</option>
                {CLOCK_MERIDIEMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            {canonical ? (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#334155" }}>
                Will save as {canonical}
              </p>
            ) : (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b" }}>
                Select hour, minute, and AM/PM.
              </p>
            )}
          </fieldset>
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
