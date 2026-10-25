import { useState } from "react";
import { API_URL, authenticatedFetch } from "../api";
import {
  authorisedAttachments,
  downloadAuthenticatedBlob,
  type AttachmentRef,
} from "../utils/authenticatedBlobDownload";

type Props = {
  attachments: unknown;
  /** Optional status line id prefix for a11y */
  label?: string;
};

/**
 * Renders download buttons only for attachments with authenticated downloadPath.
 * Uses blob download — never navigates to /uploads.
 */
export default function TeacherAttachmentList({ attachments, label = "Attachments" }: Props) {
  const items = authorisedAttachments(attachments);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!items.length) return null;

  async function onDownload(a: AttachmentRef, index: number) {
    const path = String(a.downloadPath || "").trim();
    const key = `${path}:${index}`;
    setBusyKey(key);
    setErr(null);
    setStatus(null);
    try {
      await downloadAuthenticatedBlob(path, a.name || "attachment", {
        mode: "staff",
        // authenticatedFetch accepts absolute URL or /api path
        fetch: (p, init) => authenticatedFetch(p.startsWith("http") ? p : `${API_URL}${p}`, init),
      });
      setStatus(`Downloaded ${a.name || "attachment"}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ marginTop: 8 }} aria-label={label}>
      <div className="teacher-muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        {items.map((a, i) => {
          const key = `${a.downloadPath}:${i}`;
          const busy = busyKey === key;
          return (
            <button
              key={key}
              type="button"
              className="teacher-touch-btn"
              disabled={busy || busyKey !== null}
              onClick={() => void onDownload(a, i)}
              aria-busy={busy}
            >
              {busy ? "Downloading…" : a.name || `Attachment ${i + 1}`}
            </button>
          );
        })}
      </div>
      {err ? <p className="teacher-error" style={{ marginTop: 6 }}>{err}</p> : null}
      {status && !err ? <p style={{ color: "var(--t-gold)", marginTop: 6, fontSize: 12 }}>{status}</p> : null}
    </div>
  );
}
