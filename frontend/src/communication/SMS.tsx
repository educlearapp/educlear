import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collectParentSmsContacts } from "./contactHelpers";
import {
  COMMUNICATION_SETTINGS_UPDATED,
  createSms,
  deleteSms,
  fetchCommunicationSettings,
  fetchSms,
  fetchSmsList,
  newContactId,
  sendSms,
  updateSms,
  type CommunicationSettings,
  type SmsContact,
  type SmsRecord,
} from "./communicationApi";
import { checkSchoolSmsCreditBalance } from "./schoolSmsApi";
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
  onOpenSmsSettings?: () => void;
};

type View = "list" | "compose";

const PAGE_SIZE = 10;
const SMS_LIMIT = 160;

export default function SMS({
  schoolId,
  learners,
  parents,
  schoolName = "School",
  onOpenSmsSettings,
}: Props) {
  const [view, setView] = useState<View>("list");
  const [records, setRecords] = useState<SmsRecord[]>([]);
  const [smsCredits, setSmsCredits] = useState(0);
  const [liveWinSmsBalance, setLiveWinSmsBalance] = useState<number | null>(null);
  const [liveBalanceLoading, setLiveBalanceLoading] = useState(false);
  const [sendNotice, setSendNotice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [contacts, setContacts] = useState<SmsContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualRelationship, setManualRelationship] = useState("Parent");
  const [manualCell, setManualCell] = useState("");
  const [settings, setSettings] = useState<CommunicationSettings | null>(null);

  const charCount = message.length;
  const segments = Math.max(1, Math.ceil(charCount / SMS_LIMIT));

  const refreshLiveWinSmsBalance = useCallback(async () => {
    if (!schoolId) {
      setLiveWinSmsBalance(null);
      return;
    }
    setLiveBalanceLoading(true);
    try {
      const res = await checkSchoolSmsCreditBalance(schoolId);
      setLiveWinSmsBalance(res.creditBalance);
    } catch {
      setLiveWinSmsBalance(null);
    } finally {
      setLiveBalanceLoading(false);
    }
  }, [schoolId]);

  const loadList = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const [listRes, settingsRes] = await Promise.all([
        fetchSmsList(schoolId),
        fetchCommunicationSettings(schoolId),
      ]);
      setRecords(listRes.sms || []);
      setSmsCredits(listRes.smsCredits ?? 0);
      setSettings(settingsRes.settings);
      if (settingsRes.settings?.standardSmsMessage && !message) {
        setMessage(settingsRes.settings.standardSmsMessage.replace(/\[school_name\]/g, schoolName));
      }
      void refreshLiveWinSmsBalance();
    } catch (e: any) {
      setError(e?.message || "Failed to load SMS");
    } finally {
      setLoading(false);
    }
  }, [schoolId, schoolName, refreshLiveWinSmsBalance]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        schoolId?: string;
        settings?: CommunicationSettings;
        school?: { schoolName?: string };
      };
      if (!detail?.settings || detail.schoolId !== schoolId) return;
      setSettings(detail.settings);
      const name = detail.school?.schoolName || schoolName;
      if (view === "compose" && !editId && detail.settings.standardSmsMessage) {
        setMessage(detail.settings.standardSmsMessage.replace(/\[school_name\]/g, name));
      }
    };
    window.addEventListener(COMMUNICATION_SETTINGS_UPDATED, onSettingsUpdated);
    return () => window.removeEventListener(COMMUNICATION_SETTINGS_UPDATED, onSettingsUpdated);
  }, [schoolId, view, editId, schoolName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.description.toLowerCase().includes(q) ||
        r.message.toLowerCase().includes(q) ||
        String(r.contacts?.length || 0).includes(q)
    );
  }, [records, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resetCompose = () => {
    setEditId(null);
    setDescription("");
    setMessage(
      (settings?.standardSmsMessage || "").replace(/\[school_name\]/g, schoolName)
    );
    setContacts([]);
    setSelectedContactIds([]);
    setContactSearch("");
    setMoreOpen(false);
  };

  const openAdd = () => {
    resetCompose();
    setView("compose");
  };

  const openManage = async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchSms(schoolId, id);
      const sms = res.sms;
      setEditId(sms.id);
      setDescription(sms.description);
      setMessage(sms.message);
      setContacts(sms.contacts || []);
      setView("compose");
    } catch (e: any) {
      setError(e?.message || "Failed to open SMS");
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    const payload = { schoolId, description: description || "SMS", message, contacts };
    if (editId) {
      const res = await updateSms(editId, payload);
      return res.sms;
    }
    const res = await createSms(payload);
    setEditId(res.sms.id);
    return res.sms;
  };

  const handleSend = async () => {
    setError("");
    setSendNotice("");
    setLoading(true);
    try {
      const saved = await saveDraft();
      if (!saved?.id) throw new Error("Could not save SMS before sending");
      if (!contacts.length) throw new Error("Add at least one contact before sending");
      const res = await sendSms(schoolId, saved.id);
      setSmsCredits(res.smsCredits ?? smsCredits);
      if (res.creditBalance != null) {
        setLiveWinSmsBalance(res.creditBalance);
      } else {
        await refreshLiveWinSmsBalance();
      }
      const deliveryLabel =
        res.simulated === false ? "Delivered via WinSMS (live send)." : "SMS send completed.";
      setSendNotice(res.warning ? `${deliveryLabel} ${res.warning}` : deliveryLabel);
      await loadList();
      setView("list");
    } catch (e: any) {
      if (e?.sms) {
        setContacts(e.sms.contacts || []);
        setEditId(e.sms.id);
      }
      if (e?.creditBalance != null) {
        setLiveWinSmsBalance(e.creditBalance);
      }
      setError(e?.message || "Failed to send SMS");
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (status: SmsRecord["status"]) => {
    if (status === "Sent") return "#15803d";
    if (status === "Failed") return "#b91c1c";
    return "#92400e";
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this SMS?")) return;
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
      await deleteSms(schoolId, editId);
      resetCompose();
      await loadList();
      setView("list");
    } catch (e: any) {
      setError(e?.message || "Failed to delete SMS");
    } finally {
      setLoading(false);
    }
  };

  const handleAutoAdd = () => {
    const added = collectParentSmsContacts(learners, parents);
    if (!added.length) {
      setError("No parent cell numbers found.");
      return;
    }
    const existing = new Set(contacts.map((c) => c.cellNo.replace(/\D/g, "")));
    const merged = [...contacts];
    for (const c of added) {
      const key = c.cellNo.replace(/\D/g, "");
      if (!existing.has(key)) merged.push(c);
    }
    setContacts(merged);
    setError("");
  };

  const addManualContact = () => {
    const cellNo = manualCell.trim();
    if (!cellNo) return;
    setContacts((prev) => [
      ...prev,
      {
        id: newContactId(),
        contactName: manualName.trim() || "Contact",
        relationship: manualRelationship.trim() || "Parent",
        cellNo,
        status: "Ready",
      },
    ]);
    setManualName("");
    setManualCell("");
    setContactModalOpen(false);
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
        c.cellNo.toLowerCase().includes(q) ||
        c.relationship.toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  if (view === "compose") {
    return (
      <div style={pageWrap}>
        <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>SMS</h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
              Compose SMS · {schoolName}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={() => { setView("list"); loadList(); }}>← Back</button>
            <button type="button" style={goldBtn} onClick={handleSend} disabled={loading}>Send</button>
            <div style={{ position: "relative" }}>
              <button type="button" style={ghostBtn} onClick={() => setMoreOpen((v) => !v)}>More Actions ▾</button>
              {moreOpen ? (
                <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.12)", zIndex: 10 }}>
                  <button type="button" style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 800 }} onClick={handleDelete}>Delete</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

        <div style={{ display: "grid", gap: 14, maxWidth: 720 }}>
          <label>
            Description
            <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            SMS Text
            <textarea
              style={{ ...fieldStyle, minHeight: 120 }}
              maxLength={640}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: charCount > SMS_LIMIT ? "#b91c1c" : "#64748b" }}>
              {charCount} / {SMS_LIMIT} characters · {segments} segment(s)
            </span>
          </label>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button type="button" style={goldBtn} onClick={() => setContactModalOpen(true)}>Add</button>
            <button type="button" style={ghostBtn} onClick={handleAutoAdd}>Auto Add</button>
            <button type="button" style={ghostBtn} onClick={removeSelected}>Remove</button>
            <button type="button" style={ghostBtn} onClick={() => setPreviewOpen(true)}>Preview</button>
            <input placeholder="Search contacts" style={{ ...fieldStyle, maxWidth: 260 }} value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} />
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12 }}>
            <thead>
              <tr>
                <th style={th} />
                {["Contact Name", "Relationship", "Cell No", "Status"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredContacts.length === 0 ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#64748b" }}>No contacts added</td></tr>
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
                    <td style={td}>{c.cellNo}</td>
                    <td style={td}>
                      <span style={{ color: statusColor(c.status as SmsRecord["status"]), fontWeight: 800 }}>
                        {c.status}
                      </span>
                    </td>
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
                <input style={fieldStyle} placeholder="Cell No" value={manualCell} onChange={(e) => setManualCell(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="button" style={goldBtn} onClick={addManualContact}>Add contact</button>
                <button type="button" style={ghostBtn} onClick={() => setContactModalOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : null}

        {previewOpen ? (
          <div style={modalOverlay}>
            <div style={{ ...modalPanel, padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>SMS preview</h3>
              <div style={{ whiteSpace: "pre-wrap", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, background: "#fafafa" }}>{message || "(empty)"}</div>
              <p style={{ fontSize: 13, color: "#64748b" }}>
                {contacts.length} recipient(s) · from {schoolName}
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
      <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>SMS</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>Send and view sms communications</p>
        </div>
        {onOpenSmsSettings ? (
          <button type="button" style={ghostBtn} onClick={onOpenSmsSettings}>
            SMS Settings / Connect WinSMS
          </button>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 1fr))", gap: 16, marginBottom: 22, maxWidth: 520 }}>
        <div style={summaryCard}>
          <div style={{ fontSize: 28, fontWeight: 950 }}>{smsCredits.toLocaleString()}</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>SMS CREDITS</div>
        </div>
        <div style={summaryCard}>
          <div style={{ fontSize: 28, fontWeight: 950 }}>
            {liveBalanceLoading
              ? "…"
              : liveWinSmsBalance !== null
                ? liveWinSmsBalance.toLocaleString("en-ZA")
                : "—"}
          </div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>LIVE WINSMS BALANCE</div>
        </div>
      </div>

      {sendNotice ? (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 10,
            background: "#ecfdf5",
            color: "#15803d",
            fontWeight: 700,
          }}
        >
          {sendNotice}
        </div>
      ) : null}

      {error ? <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <button type="button" style={goldBtn} onClick={openAdd}>Add</button>
        <button type="button" style={ghostBtn} onClick={() => pageRows[0] && openManage(pageRows[0].id)} disabled={!pageRows.length}>Manage</button>
        <input placeholder="Search…" style={{ ...fieldStyle, maxWidth: 280, marginLeft: "auto" }} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12 }}>
        <thead>
          <tr>
            {["Date", "Description", "Contacts", "Message", ""].map((h) => (
              <th key={h || "st"} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !pageRows.length ? (
            <tr><td colSpan={5} style={{ ...td, textAlign: "center" }}>Loading…</td></tr>
          ) : pageRows.length === 0 ? (
            <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#64748b" }}>No SMS yet. Click Add to compose.</td></tr>
          ) : (
            pageRows.map((row) => (
              <tr key={row.id} style={{ cursor: "pointer" }} onClick={() => openManage(row.id)}>
                <td style={td}>{row.date}</td>
                <td style={td}>{row.description}</td>
                <td style={td}>{row.contacts?.length || 0}</td>
                <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.message}</td>
                <td style={td}>
                  <span style={{ color: statusColor(row.status), fontWeight: 800 }}>{row.status}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button type="button" style={ghostBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
        <span style={{ fontWeight: 700, color: "#64748b" }}>Page {page} of {totalPages}</span>
        <button type="button" style={ghostBtn} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
      </div>
    </div>
  );
}
