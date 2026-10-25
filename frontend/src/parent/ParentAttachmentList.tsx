import { useState } from "react";
import { API_URL } from "../api";
import { getParentToken } from "./parentApi";
import {
  authorisedAttachments,
  downloadAuthenticatedBlob,
  type AttachmentRef,
} from "../utils/authenticatedBlobDownload";

type Props = {
  attachments: unknown;
  label?: string;
};

/**
 * Parent-portal attachment buttons — only when downloadPath is an /api/ path.
 * Blob download with Bearer; never navigates to /uploads.
 */
export default function ParentAttachmentList({ attachments, label = "Attachments" }: Props) {
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
        mode: "parent",
        token: getParentToken(),
        apiBase: API_URL,
      });
      setStatus(`Downloaded ${a.name || "attachment"}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ marginTop: 6 }} aria-label={label}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        {items.map((a, i) => {
          const key = `${a.downloadPath}:${i}`;
          const busy = busyKey === key;
          return (
            <button
              key={key}
              type="button"
              className="parent-portal-link"
              style={{
                display: "block",
                background: "none",
                border: 0,
                padding: 0,
                marginTop: 2,
                cursor: busy || busyKey !== null ? "wait" : "pointer",
                textAlign: "left",
                fontSize: 12,
              }}
              disabled={busy || busyKey !== null}
              onClick={() => void onDownload(a, i)}
              aria-busy={busy}
            >
              {busy ? "Downloading…" : a.name || `Attachment ${i + 1}`}
            </button>
          );
        })}
      </div>
      {err ? (
        <p className="parent-portal-muted" role="alert" style={{ marginTop: 4, fontSize: 12, color: "#b91c1c" }}>
          {err}
        </p>
      ) : null}
      {status && !err ? (
        <p className="parent-portal-muted" role="status" style={{ marginTop: 4, fontSize: 12 }}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
