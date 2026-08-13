import { useEffect, useState } from "react";
import { postOwnerEduClockCorrection } from "./educlockApi";
import {
  CLOCK_HOURS_12,
  CLOCK_MERIDIEMS,
  CLOCK_MINUTES,
  OWNER_CORRECTION_REASONS,
  buildOwnerCorrectionRequest,
  canonicalizeTwelveHourClockParts,
  correctionFieldsForStatus,
  correctionNotesRequired,
  correctionTimeInputResetKey,
  defaultCorrectionReason,
  type EduClockCorrectionTarget,
} from "./educlockCorrectionUi";
import { ownerButtonStyle, ownerInputStyle, ownerSecondaryButtonStyle } from "./educlockOwnerUi";

function TimePartsSelect(props: {
  legend: string;
  hour: string;
  minute: string;
  meridiem: string;
  hourLabel: string;
  minuteLabel: string;
  meridiemLabel: string;
  onHour: (value: string) => void;
  onMinute: (value: string) => void;
  onMeridiem: (value: string) => void;
}) {
  const canonical = canonicalizeTwelveHourClockParts({
    hour: props.hour,
    minute: props.minute,
    meridiem: props.meridiem,
  });
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend style={{ fontSize: 13, fontWeight: 700 }}>{props.legend}</legend>
      <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
        <select
          aria-label={props.hourLabel}
          value={props.hour}
          onChange={(e) => props.onHour(e.target.value)}
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
          aria-label={props.minuteLabel}
          value={props.minute}
          onChange={(e) => props.onMinute(e.target.value)}
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
          aria-label={props.meridiemLabel}
          value={props.meridiem}
          onChange={(e) => props.onMeridiem(e.target.value)}
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
  );
}

export default function EduClockCorrectionDialog(props: {
  target: EduClockCorrectionTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { target } = props;
  const fields = correctionFieldsForStatus(target.currentStatus);
  const resetKey = correctionTimeInputResetKey(target);
  const [reason, setReason] = useState<string>(defaultCorrectionReason(target.currentStatus));
  const [note, setNote] = useState("");
  const [clockInHour, setClockInHour] = useState("");
  const [clockInMinute, setClockInMinute] = useState("");
  const [clockInMeridiem, setClockInMeridiem] = useState("");
  const [clockOutHour, setClockOutHour] = useState("");
  const [clockOutMinute, setClockOutMinute] = useState("");
  const [clockOutMeridiem, setClockOutMeridiem] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setClockInHour("");
    setClockInMinute("");
    setClockInMeridiem("");
    setClockOutHour("");
    setClockOutMinute("");
    setClockOutMeridiem("");
    setNote("");
    setError("");
    setReason(defaultCorrectionReason(target.currentStatus));
  }, [resetKey, target.currentStatus]);

  async function submit() {
    const built = buildOwnerCorrectionRequest({
      target,
      reason,
      note,
      clockInHour,
      clockInMinute,
      clockInMeridiem,
      clockOutHour,
      clockOutMinute,
      clockOutMeridiem,
    });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await postOwnerEduClockCorrection(built.payload);
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
            <dd style={{ margin: 0 }}>{target.clockInTime || "Missing"}</dd>
          </div>
          <div>
            <dt style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>Clock Out</dt>
            <dd style={{ margin: 0 }}>{target.clockOutTime || "Missing"}</dd>
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
          {fields.clockIn ? (
            <TimePartsSelect
              legend="Correct Clock In time"
              hour={clockInHour}
              minute={clockInMinute}
              meridiem={clockInMeridiem}
              hourLabel={fields.clockOut ? "Clock in hour" : "Hour"}
              minuteLabel={fields.clockOut ? "Clock in minute" : "Minute"}
              meridiemLabel={fields.clockOut ? "Clock in AM/PM" : "AM/PM"}
              onHour={setClockInHour}
              onMinute={setClockInMinute}
              onMeridiem={setClockInMeridiem}
            />
          ) : null}
          {fields.clockOut ? (
            <TimePartsSelect
              legend="Correct Clock Out time"
              hour={clockOutHour}
              minute={clockOutMinute}
              meridiem={clockOutMeridiem}
              hourLabel={fields.clockIn ? "Clock out hour" : "Hour"}
              minuteLabel={fields.clockIn ? "Clock out minute" : "Minute"}
              meridiemLabel={fields.clockIn ? "Clock out AM/PM" : "AM/PM"}
              onHour={setClockOutHour}
              onMinute={setClockOutMinute}
              onMeridiem={setClockOutMeridiem}
            />
          ) : null}
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
