import type { CSSProperties } from "react";
import { SECURE_CONNECTION_MESSAGE, SECURE_CONNECTION_TITLE } from "./secureConnectionMessage";

const GOLD = "#c9a227";

type Props = {
  /** When false, renders nothing (secure context). */
  show: boolean;
  style?: CSSProperties;
};

/**
 * Owner-friendly insecure-connection notice.
 * Only render when window.isSecureContext is false.
 */
export default function SecureConnectionNotice({ show, style }: Props) {
  if (!show) return null;
  return (
    <div
      role="alert"
      data-testid="secure-connection-required"
      style={{
        marginTop: 12,
        borderRadius: 14,
        border: `1px solid ${GOLD}`,
        background: "#1a1508",
        padding: "12px 14px",
        ...style,
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 14, color: GOLD }}>{SECURE_CONNECTION_TITLE}</div>
      <p style={{ margin: "8px 0 0", color: "#e7e5e4", fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>
        {SECURE_CONNECTION_MESSAGE}
      </p>
    </div>
  );
}
