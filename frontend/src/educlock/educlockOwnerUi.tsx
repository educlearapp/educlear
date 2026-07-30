import type { CSSProperties, ReactNode } from "react";

/** Friendly labels — never show raw enum keys in the UI. */
export const READINESS_BUCKET_LABELS: Record<string, string> = {
  readyToActivate: "Ready",
  missingEmployeeNumber: "Missing Employee Number",
  missingIdentityDocument: "Missing Identity Document",
  invalidIdentityDocument: "Invalid Identity",
  alreadyActivated: "Already Activated",
  requiresManualReview: "Needs Review",
};

export const STAFF_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  NOT_ACTIVATED: "Not Activated",
  MISSING_IDENTITY_DOCUMENT: "Missing Identity Document",
  MISSING_EMPLOYEE_NUMBER: "Missing Employee Number",
  DUPLICATE_IDENTITY_MATCH: "Duplicate Identity",
  EMPLOYEE_ALREADY_LINKED: "Employee Already Linked",
  INACTIVE_EMPLOYEE: "Inactive",
  INVALID_LINK: "Invalid Link",
};

export function friendlyReadinessLabel(code: string): string {
  const key = String(code || "").trim();
  if (READINESS_BUCKET_LABELS[key]) return READINESS_BUCKET_LABELS[key];
  // Reasons from API are often already human-readable
  if (key.includes(" ") || key.includes("-")) return key;
  // camelCase / SCREAMING_SNAKE fallback without exposing raw enums
  const mapped =
    READINESS_BUCKET_LABELS[key] ||
    STAFF_STATUS_LABELS[key] ||
    key
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return mapped;
}

type BadgeTone = "green" | "blue" | "amber" | "orange" | "red" | "grey";

const BADGE_TONES: Record<
  BadgeTone,
  { bg: string; fg: string; border: string }
> = {
  green: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },
  blue: { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
  amber: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
  orange: { bg: "#fff7ed", fg: "#c2410c", border: "#fed7aa" },
  red: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
  grey: { bg: "#f8fafc", fg: "#475569", border: "#e2e8f0" },
};

export function toneForReadinessReason(reason: string): BadgeTone {
  const r = friendlyReadinessLabel(reason).toLowerCase();
  if (r.includes("ready") || r === "already activated") return "green";
  if (r.includes("active") && !r.includes("inactive")) return "blue";
  if (r.includes("employee number")) return "amber";
  if (r.includes("user account") || r.includes("not linked") || r.includes("link")) return "orange";
  if (r.includes("invalid") || r.includes("inactive")) return "red";
  if (r.includes("missing identity") || r.includes("identity document")) return "amber";
  if (r.includes("not activated")) return "grey";
  return "grey";
}

export function toneForBucket(bucket: string): BadgeTone {
  switch (bucket) {
    case "readyToActivate":
    case "alreadyActivated":
      return "green";
    case "missingEmployeeNumber":
      return "amber";
    case "missingIdentityDocument":
      return "amber";
    case "invalidIdentityDocument":
      return "red";
    case "requiresManualReview":
      return "orange";
    default:
      return "grey";
  }
}

export function EduClockBadge(props: {
  label: string;
  tone?: BadgeTone;
  title?: string;
}) {
  const tone = props.tone || toneForReadinessReason(props.label);
  const colors = BADGE_TONES[tone];
  return (
    <span
      title={props.title}
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.35,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {props.label}
    </span>
  );
}

export function EduClockBadgeStack(props: { labels: string[] }) {
  if (!props.labels.length) {
    return <EduClockBadge label="—" tone="grey" />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      {props.labels.map((label) => (
        <EduClockBadge key={label} label={friendlyReadinessLabel(label)} />
      ))}
    </div>
  );
}

export const ownerCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

export const ownerInputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
  minHeight: 42,
  boxSizing: "border-box",
};

export const ownerButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #d4af37",
  background: "#111827",
  color: "#fbbf24",
  fontWeight: 700,
  cursor: "pointer",
  minHeight: 42,
};

export const ownerSecondaryButtonStyle: CSSProperties = {
  ...ownerButtonStyle,
  background: "#fff",
  color: "#334155",
  border: "1px solid #d1d5db",
};

export function OwnerSection(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, margin: 0, fontWeight: 800 }}>{props.title}</h2>
      {props.subtitle ? (
        <p style={{ color: "#64748b", marginTop: 6, marginBottom: 12, maxWidth: 720, lineHeight: 1.5 }}>
          {props.subtitle}
        </p>
      ) : (
        <div style={{ height: 12 }} />
      )}
      {props.children}
    </section>
  );
}

export function PreparationProgress(props: {
  ready: number;
  total: number;
  needingPrep: number;
}) {
  const total = Math.max(0, props.total);
  const ready = Math.max(0, props.ready);
  const pct = total === 0 ? 0 : Math.min(100, Math.round((ready / total) * 100));
  return (
    <div style={{ ...ownerCardStyle, marginTop: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>EduClock Preparation</div>
      <div style={{ fontSize: 14, color: "#334155" }}>
        Ready: <strong>{ready}</strong> of <strong>{total}</strong> employees
      </div>
      <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
        Employees requiring preparation: {props.needingPrep}
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="EduClock preparation progress"
        style={{
          marginTop: 12,
          height: 12,
          borderRadius: 999,
          background: "#f1f5f9",
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, #d4af37 0%, #b45309 100%)",
            transition: "width 0.35s ease",
          }}
        />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginTop: 6 }}>{pct}%</div>
    </div>
  );
}
