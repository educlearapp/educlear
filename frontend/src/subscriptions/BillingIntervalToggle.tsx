import type { CSSProperties } from "react";
import type { BillingInterval } from "../modules/educlearCommercialPackages";

const GOLD = "#d4af37";
const INK = "#111827";
const MUTED = "#64748b";

/**
 * Segmented Monthly/Annual control.
 *
 * Root cause of blank labels: App.css sets body/root color to #f5deb3 (dark-shell
 * wheat). Buttons with white/cream backgrounds inherited that color → near-invisible
 * text. This control always sets an explicit ink color.
 */
export function BillingIntervalToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
  disabled?: boolean;
}) {
  const track: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: 4,
    borderRadius: 12,
    border: "1px solid rgba(15, 23, 42, 0.12)",
    background: "#f1f5f9",
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  const segment = (active: boolean): CSSProperties => ({
    appearance: "none",
    WebkitAppearance: "none",
    margin: 0,
    border: active ? `1px solid ${GOLD}` : "1px solid transparent",
    borderRadius: 9,
    padding: "10px 18px",
    minWidth: 96,
    fontWeight: 800,
    fontSize: 14,
    lineHeight: 1.2,
    letterSpacing: "0.02em",
    cursor: disabled ? "not-allowed" : "pointer",
    color: active ? INK : MUTED,
    background: active
      ? "linear-gradient(135deg, #d4af37, #f5d06f)"
      : "transparent",
    boxShadow: active ? "0 6px 14px rgba(212, 175, 55, 0.28)" : "none",
    opacity: disabled ? 0.65 : 1,
    transition: "background 120ms ease, color 120ms ease, box-shadow 120ms ease",
  });

  return (
    <div
      role="group"
      aria-label="Billing interval"
      data-testid="billing-interval-toggle"
      style={track}
    >
      <button
        type="button"
        data-testid="billing-interval-monthly"
        aria-pressed={value === "monthly"}
        disabled={disabled}
        onClick={() => onChange("monthly")}
        style={segment(value === "monthly")}
      >
        Monthly
      </button>
      <button
        type="button"
        data-testid="billing-interval-annual"
        aria-pressed={value === "annual"}
        disabled={disabled}
        onClick={() => onChange("annual")}
        style={segment(value === "annual")}
      >
        Annual
      </button>
    </div>
  );
}
