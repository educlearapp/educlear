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
    <div className="parent-portal-attach-list" aria-label={label}>
      {items.map((a, i) => {
        const key = `${a.downloadPath}:${i}`;
        const busy = busyKey === key;
        const name = a.name || `Attachment ${i + 1}`;
        return (
          <div key={key} className="parent-portal-attach-row">
            <span className="parent-portal-attach-name" title={name}>
              {name}
            </span>
            <button
              type="button"
              className="parent-portal-attach-btn"
              disabled={busy || busyKey !== null}
              onClick={() => void onDownload(a, i)}
              aria-busy={busy}
              aria-label={busy ? `Downloading ${name}` : `Download ${name}`}
            >
              {busy ? "Downloading…" : "Download"}
            </button>
          </div>
        );
      })}
      {err ? (
        <p className="parent-portal-muted parent-portal-attach-status" role="alert">
          {err}
        </p>
      ) : null}
      {status && !err ? (
        <p className="parent-portal-muted parent-portal-attach-status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
