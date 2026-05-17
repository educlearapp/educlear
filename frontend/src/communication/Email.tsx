import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collectParentEmailContacts } from "./contactHelpers";
import {
  COMMUNICATION_SETTINGS_UPDATED,
  createEmail,
  formatComposeSenderLabel,
  deleteEmail,
  fetchCommunicationSettings,
  fetchEmail,
  fetchEmails,
  newContactId,
  resolveSchoolSenderEmail,
  sendEmail,
  updateEmail,
  type CommunicationSettings,
  type EmailContact,
  type EmailRecord,
  type SchoolSenderContext,
} from "./communicationApi";
import {
  fieldStyle,
  ghostBtn,
  goldBtn,
  modalOverlay,
  modalPanel,
  pageWrap,
  summaryCard,
  td,
  th,
} from "./communicationStyles";

type Props = {
  schoolId: string;
  learners: any[];
  parents: any[];
  schoolName?: string;
  schoolEmail?: string;
};

type View = "list" | "compose";

const PAGE_SIZE = 10;

export default function Email({ schoolId, learners, parents, schoolName = "School", schoolEmail = "" }: Props) {
  const [view, setView] = useState<View>("list");
  const [records, setRecords] = useState<EmailRecord[]>([]);
  const [emailBalance, setEmailBalance] = useState(0);
  const [settings, setSettings] = useState<CommunicationSettings | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contacts, setContacts] = useState<EmailContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualRelationship, setManualRelationship] = useState("Parent");
  const [manualEmail, setManualEmail] = useState("");
  const [attachmentName, setAttachmentName] = useState("");

  const schoolCtx = useMemo<SchoolSenderContext>(
    () => ({ schoolName, schoolEmail }),
    [schoolName, schoolEmail]
  );

  const composeSenderLabel = useMemo(
    () => formatComposeSenderLabel(settings, schoolCtx),
    [settings, schoolCtx]
  );

  const loadList = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const [listRes, settingsRes] = await Promise.all([
        fetchEmails(schoolId),
        fetchCommunicationSettings(schoolId),
      ]);
      setRecords(listRes.emails || []);
      setEmailBalance(listRes.emailBalance ?? 0);
      setSettings(settingsRes.settings);
    } catch (e: any) {
      setError(e?.message || "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        schoolId?: string;
        settings?: CommunicationSettings;
        school?: SchoolSenderContext;
      };
      if (!detail?.settings || detail.schoolId !== schoolId) return;
      setSettings(detail.settings);
      if (view === "compose" && !editId) {
        setFrom(
          formatComposeSenderLabel(detail.settings, {
            schoolName: detail.school?.schoolName || schoolName,
            schoolEmail: detail.school?.schoolEmail || schoolEmail,
          })
        );
      }
    };
    window.addEventListener(COMMUNICATION_SETTINGS_UPDATED, onSettingsUpdated);
    return () => window.removeEventListener(COMMUNICATION_SETTINGS_UPDATED, onSettingsUpdated);
  }, [schoolId, view, editId, schoolName, schoolEmail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.description.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        String(r.contacts?.length || 0).includes(q)
    );
  }, [records, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resetCompose = (s?: CommunicationSettings | null) => {
    setEditId(null);
    setDescription("");
    setFrom(formatComposeSenderLabel(s || settings, schoolCtx));
    setSubject(s?.standardEmailSubject?.replace(/\[school_name\]/g, schoolName) || "");
    setMessage(
      (s?.standardEmailMessage || "")
        .replace(/\[school_name\]/g, schoolName)
        .replace(/\[signature\]/g, s?.signature?.replace(/\[school_name\]/g, schoolName) || "")
    );
    setContacts([]);
    setSelectedContactIds([]);
    setContactSearch("");
    setMoreOpen(false);
  };

  const openAdd = async () => {
    let s = settings;
    if (!s && schoolId) {
      try {
        const res = await fetchCommunicationSettings(schoolId);
        s = res.settings;
        setSettings(s);
      } catch {
        /* use defaults */
      }
    }
    resetCompose(s);
    setView("compose");
  };

  const openManage = async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchEmail(schoolId, id);
      const email = res.email;
      setEditId(email.id);
      setDescription(email.description);
      setFrom(email.from);
      setSubject(email.subject);
      setMessage(email.message);
      setContacts(email.contacts || []);
      setSelectedContactIds([]);
      setView("compose");
    } catch (e: any) {
      setError(e?.message || "Failed to open email");
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!schoolId) return null;
    const payload = {
      schoolId,
      description: description || "Email",
      from: from || formatComposeSenderLabel(settings, schoolCtx),
      subject,
      message,
      contacts,
    };
    if (editId) {
      const res = await updateEmail(editId, payload);
      return res.email;
    }
    const res = await createEmail(payload);
    setEditId(res.email.id);
    return res.email;
  };

  const handleSend = async () => {
    setError("");
    setLoading(true);
    try {
      const saved = await saveDraft();
      if (!saved?.id) throw new Error("Could not save email before sending");
      if (!contacts.length) throw new Error("Add at least one contact before sending");
      const res = await sendEmail(schoolId, saved.id);
      setEmailBalance(res.emailBalance ?? emailBalance);
      await loadList();
      setView("list");
    } catch (e: any) {
      setError(e?.message || "Failed to send email");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this email?")) return;
    setMoreOpen(false);
    if (!editId) {
      resetCompose();
      setView("list");
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await deleteEmail(schoolId, editId);
      resetCompose();
      await loadList();
      setView("list");
    } catch (e: any) {
      setError(e?.message || "Failed to delete email");
    } finally {
      setLoading(false);
    }
  };

  const handleAutoAdd = () => {
    const added = collectParentEmailContacts(learners, parents);
    if (!added.length) {
      setError("No parent emails found on learners or parents.");
      return;
    }
    const existing = new Set(contacts.map((c) => c.email.toLowerCase()));
    const merged = [...contacts];
    for (const c of added) {
      if (!existing.has(c.email.toLowerCase())) merged.push(c);
    }
    setContacts(merged);
    setError("");
  };

  const addManualContact = () => {
    const email = manualEmail.trim();
    if (!email) return;
    setContacts((prev) => [
      ...prev,
      {
        id: newContactId(),
        contactName: manualName.trim() || "Contact",
        relationship: manualRelationship.trim() || "Parent",
        email,
        attachments: [],
        status: "Ready",
      },
    ]);
    setManualName("");
    setManualEmail("");
    setContactModalOpen(false);
  };

  const addAttachment = () => {
    const name = attachmentName.trim();
    if (!name) return;
    const ids = selectedContactIds.length ? selectedContactIds : contacts.map((c) => c.id);
    if (!ids.length) {
      setError("Select contacts or add contacts before attaching files.");
      return;
    }
    setContacts((prev) =>
      prev.map((c) =>
        ids.includes(c.id) ? { ...c, attachments: [...(c.attachments || []), name] } : c
      )
    );
    setAttachmentName("");
    setAttachmentModalOpen(false);
  };

  const removeSelected = () => {
    if (!selectedContactIds.length) return;
    setContacts((prev) => prev.filter((c) => !selectedContactIds.includes(c.id)));
    setSelectedContactIds([]);
  };

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.contactName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.relationship.toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  if (view === "compose") {
    return (
      <div style={pageWrap}>
        <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>Email</h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
              {editId ? "Manage email" : "Compose email"} · {composeSenderLabel}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
              Parents reply to {resolveSchoolSenderEmail(settings, schoolCtx)}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={ghostBtn} onClick={() => { setView("list"); loadList(); }}>
              ← Back
            </button>
            <button type="button" style={goldBtn} onClick={handleSend} disabled={loading}>
              Send
            </button>
            <div style={{ position: "relative" }}>
              <button type="button" style={ghostBtn} onClick={() => setMoreOpen((v) => !v)}>
                More Actions ▾
              </button>
              {moreOpen ? (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: 6,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                    zIndex: 10,
                    minWidth: 140,
                  }}
                >
                  <button
                    type="button"
                    style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 800 }}
                    onClick={handleDelete}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
          <label>
            From
            <input style={fieldStyle} value={from} readOnly />
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              Update billing or administration email in Communication Settings to change the sender.
            </span>
          </label>
          <label>
            Description
            <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Subject
            <input style={fieldStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Message
            <textarea
              style={{ ...fieldStyle, minHeight: 180, fontFamily: "inherit" }}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button type="button" style={goldBtn} onClick={() => setContactModalOpen(true)}>Add</button>
            <button type="button" style={ghostBtn} onClick={handleAutoAdd}>Auto Add</button>
            <button type="button" style={ghostBtn} onClick={() => setAttachmentModalOpen(true)}>Add Attachment</button>
            <button type="button" style={ghostBtn} onClick={removeSelected}>Remove</button>
            <button type="button" style={ghostBtn} onClick={() => setPreviewOpen(true)}>Preview</button>
            <input
              placeholder="Search contacts"
              style={{ ...fieldStyle, maxWidth: 260 }}
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
            />
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12 }}>
            <thead>
              <tr>
                <th style={th} />
                {["Contact Name", "Relationship", "Email", "Attachment(s)", "Status"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredContacts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: "center", color: "#64748b" }}>No contacts added</td>
                </tr>
              ) : (
                filteredContacts.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(c.id)}
                        onChange={(e) =>
                          setSelectedContactIds((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                          )
                        }
                      />
                    </td>
                    <td style={td}>{c.contactName}</td>
                    <td style={td}>{c.relationship}</td>
                    <td style={td}>{c.email}</td>
                    <td style={td}>{(c.attachments || []).join(", ") || "-"}</td>
                    <td style={td}>{c.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {contactModalOpen ? (
          <div style={modalOverlay}>
            <div style={{ ...modalPanel, padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>Add contact</h3>
              <div style={{ display: "grid", gap: 12 }}>
                <input style={fieldStyle} placeholder="Contact name" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                <input style={fieldStyle} placeholder="Relationship" value={manualRelationship} onChange={(e) => setManualRelationship(e.target.value)} />
                <input style={fieldStyle} placeholder="Email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="button" style={goldBtn} onClick={addManualContact}>Add contact</button>
                <button type="button" style={ghostBtn} onClick={() => setContactModalOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : null}

        {attachmentModalOpen ? (
          <div style={modalOverlay}>
            <div style={{ ...modalPanel, padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>Add attachment (placeholder)</h3>
              <p style={{ color: "#64748b", fontSize: 13 }}>Simulated attachment name — file upload integration can be added later.</p>
              <input style={fieldStyle} placeholder="e.g. statement-march.pdf" value={attachmentName} onChange={(e) => setAttachmentName(e.target.value)} />
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="button" style={goldBtn} onClick={addAttachment}>Attach</button>
                <button type="button" style={ghostBtn} onClick={() => setAttachmentModalOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : null}

        {previewOpen ? (
          <div style={modalOverlay}>
            <div style={{ ...modalPanel, padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>Email preview</h3>
              <p><strong>From:</strong> {from}</p>
              <p><strong>Subject:</strong> {subject}</p>
              <div style={{ whiteSpace: "pre-wrap", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, background: "#fafafa" }}>{message}</div>
              <p style={{ fontSize: 13, color: "#64748b" }}>
                {contacts.length} recipient(s) · reply-to {resolveSchoolSenderEmail(settings, schoolCtx)}
              </p>
              <button type="button" style={goldBtn} onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>Email</h1>
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Send and view email communications</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 280px)", gap: 16, marginBottom: 22 }}>
        <div style={summaryCard}>
          <div style={{ fontSize: 28, fontWeight: 950 }}>{emailBalance.toLocaleString()}</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>EMAIL BALANCE</div>
        </div>
      </div>

      {error ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>{error}</div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <button type="button" style={goldBtn} onClick={openAdd}>Add</button>
        <button
          type="button"
          style={ghostBtn}
          onClick={() => pageRows[0] && openManage(pageRows[0].id)}
          disabled={!pageRows.length}
        >
          Manage
        </button>
        <input
          placeholder="Search…"
          style={{ ...fieldStyle, maxWidth: 280, marginLeft: "auto" }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12 }}>
        <thead>
          <tr>
            {["Date", "Description", "Contacts", ""].map((h) => (
              <th key={h || "action"} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !pageRows.length ? (
            <tr><td colSpan={4} style={{ ...td, textAlign: "center" }}>Loading…</td></tr>
          ) : pageRows.length === 0 ? (
            <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "#64748b" }}>No emails yet. Click Add to compose.</td></tr>
          ) : (
            pageRows.map((row) => (
              <tr key={row.id} style={{ cursor: "pointer" }} onClick={() => openManage(row.id)}>
                <td style={td}>{row.date}</td>
                <td style={td}>{row.description}</td>
                <td style={td}>{row.contacts?.length || 0}</td>
                <td style={td}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: row.status === "Sent" ? "#15803d" : "#92400e" }}>{row.status}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
        <button type="button" style={ghostBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
        <span style={{ fontWeight: 700, color: "#64748b" }}>Page {page} of {totalPages}</span>
        <button type="button" style={ghostBtn} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
      </div>
    </div>
  );
}
