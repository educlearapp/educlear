import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyEmailTemplateTokens,
  COMMUNICATION_SETTINGS_UPDATED,
  createEmail,
  formatComposeSenderLabel,
  deleteEmail,
  fetchCommunicationSettings,
  fetchCommunicationContacts,
  fetchEmail,
  fetchEmails,
  newContactId,
  resolveSchoolReplyToEmail,
  sendEmail,
  smtpSenderFromSettings,
  updateEmail,
  type CommunicationAudienceMode,
  type CommunicationClassScope,
  type CommunicationSettings,
  type CommunicationRecipientKind,
  type EmailContact,
  type EmailRecord,
  type SchoolSenderContext,
  type SchoolSmtpSender,
} from "./communicationApi";
import { isCommunicationSchoolAdmin } from "./communicationAudience";
import { fetchSchoolEmailSettings } from "./schoolEmailApi";
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
  const [recipientKind, setRecipientKind] = useState<CommunicationRecipientKind>("parents");
  const [audienceMode, setAudienceMode] = useState<CommunicationAudienceMode>("individual");
  const [classScope, setClassScope] = useState<CommunicationClassScope>("classroom");
  const [classFilter, setClassFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilters, setClassFilters] = useState<string[]>([]);
  const [gradeFilters, setGradeFilters] = useState<string[]>([]);
  const [classroomsByGrade, setClassroomsByGrade] = useState<Record<string, string[]>>({});
  const [isSchoolAdmin] = useState(() => isCommunicationSchoolAdmin());
  const [canManualAdd, setCanManualAdd] = useState(() => isCommunicationSchoolAdmin());

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualRelationship, setManualRelationship] = useState("Parent");
  const [manualEmail, setManualEmail] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [resolvedSchoolName, setResolvedSchoolName] = useState(schoolName);
  const [resolvedSchoolEmail, setResolvedSchoolEmail] = useState(schoolEmail);
  const [smtpSender, setSmtpSender] = useState<SchoolSmtpSender | null>(null);
  const [serverReplyTo, setServerReplyTo] = useState("");

  const schoolCtx = useMemo<SchoolSenderContext>(
    () => ({
      schoolName: resolvedSchoolName || schoolName,
      schoolEmail: resolvedSchoolEmail || schoolEmail,
    }),
    [resolvedSchoolName, resolvedSchoolEmail, schoolName, schoolEmail]
  );

  const composeSenderLabel = useMemo(
    () => formatComposeSenderLabel(settings, schoolCtx, smtpSender),
    [settings, schoolCtx, smtpSender]
  );

  const replyToEmail = useMemo(
    () => serverReplyTo || resolveSchoolReplyToEmail(settings, schoolCtx, smtpSender),
    [serverReplyTo, settings, schoolCtx, smtpSender]
  );

  const finalRecipients = useMemo(() => {
    if (audienceMode === "individual") {
      return contacts.filter((c) => selectedContactIds.includes(c.id));
    }
    return contacts;
  }, [audienceMode, contacts, selectedContactIds]);

  const visibleClassFilters = useMemo(() => {
    if (audienceMode === "by_class" && gradeFilter) {
      return classroomsByGrade[gradeFilter] || classFilters;
    }
    return classFilters;
  }, [audienceMode, gradeFilter, classroomsByGrade, classFilters]);

  const audiencePayload = useMemo(
    () => ({
      audience: audienceMode,
      classScope: audienceMode === "by_class" ? classScope : undefined,
      grade: gradeFilter || undefined,
      className: classFilter || undefined,
      kind: recipientKind,
    }),
    [audienceMode, classScope, gradeFilter, classFilter, recipientKind]
  );

  const loadList = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const [listRes, settingsRes, smtpRes] = await Promise.all([
        fetchEmails(schoolId),
        fetchCommunicationSettings(schoolId),
        fetchSchoolEmailSettings(schoolId).catch(() => null),
      ]);
      setRecords(listRes.emails || []);
      setEmailBalance(listRes.emailBalance ?? 0);
      setSettings(settingsRes.settings);
      setResolvedSchoolName(String(settingsRes.schoolName || schoolName || "").trim() || schoolName);
      setResolvedSchoolEmail(String(settingsRes.schoolEmail || schoolEmail || "").trim());
      setServerReplyTo(String(settingsRes.replyToEmail || "").trim());
      setSmtpSender(smtpRes?.settings ? smtpSenderFromSettings(smtpRes.settings) : null);
    } catch (e: any) {
      setError(e?.message || "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [schoolId, schoolName, schoolEmail]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        schoolId?: string;
        settings?: CommunicationSettings;
        school?: SchoolSenderContext;
        smtp?: SchoolSmtpSender | null;
      };
      if (!detail?.settings || detail.schoolId !== schoolId) return;
      setSettings(detail.settings);
      if (detail.school?.schoolName) setResolvedSchoolName(detail.school.schoolName);
      if (detail.school?.schoolEmail !== undefined) setResolvedSchoolEmail(detail.school.schoolEmail);
      if (detail.smtp !== undefined) setSmtpSender(detail.smtp);
      if (view === "compose" && !editId) {
        const ctx: SchoolSenderContext = {
          schoolName: detail.school?.schoolName || resolvedSchoolName || schoolName,
          schoolEmail: detail.school?.schoolEmail ?? resolvedSchoolEmail ?? schoolEmail,
        };
        setFrom(formatComposeSenderLabel(detail.settings, ctx, detail.smtp ?? smtpSender));
      }
    };
    window.addEventListener(COMMUNICATION_SETTINGS_UPDATED, onSettingsUpdated);
    return () => window.removeEventListener(COMMUNICATION_SETTINGS_UPDATED, onSettingsUpdated);
  }, [schoolId, view, editId, schoolName, schoolEmail, resolvedSchoolName, resolvedSchoolEmail, smtpSender]);

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

  const resetCompose = (
    s?: CommunicationSettings | null,
    ctxOverride?: SchoolSenderContext,
    smtpOverride?: SchoolSmtpSender | null
  ) => {
    const activeSettings = s || settings;
    const ctx = ctxOverride || schoolCtx;
    const smtp = smtpOverride !== undefined ? smtpOverride : smtpSender;
    const displaySchoolName = String(ctx.schoolName || "School").trim() || "School";
    setEditId(null);
    setDescription("");
    setFrom(formatComposeSenderLabel(activeSettings, ctx, smtp));
    setSubject(
      applyEmailTemplateTokens(activeSettings?.standardEmailSubject || "", {
        schoolName: displaySchoolName,
        settings: activeSettings,
      })
    );
    setMessage(
      applyEmailTemplateTokens(activeSettings?.standardEmailMessage || "", {
        schoolName: displaySchoolName,
        settings: activeSettings,
      })
    );
    setContacts([]);
    setSelectedContactIds([]);
    setContactSearch("");
    setMoreOpen(false);
  };

  const openAdd = async () => {
    let s = settings;
    let smtp = smtpSender;
    let ctx = schoolCtx;
    if (schoolId) {
      try {
        const [settingsRes, smtpRes] = await Promise.all([
          fetchCommunicationSettings(schoolId),
          fetchSchoolEmailSettings(schoolId).catch(() => null),
        ]);
        s = settingsRes.settings;
        const name = String(settingsRes.schoolName || schoolName || "").trim() || schoolName;
        const email = String(settingsRes.schoolEmail || schoolEmail || "").trim();
        smtp = smtpRes?.settings ? smtpSenderFromSettings(smtpRes.settings) : null;
        ctx = { schoolName: name, schoolEmail: email };
        setSettings(s);
        setResolvedSchoolName(name);
        setResolvedSchoolEmail(email);
        setServerReplyTo(String(settingsRes.replyToEmail || "").trim());
        setSmtpSender(smtp);
        const contactRes = await fetchCommunicationContacts({
          schoolId,
          channel: "email",
          kind: "parents",
          audience: "individual",
        }).catch(() => null);
        if (contactRes?.classFilters) setClassFilters(contactRes.classFilters);
        if (contactRes?.gradeFilters) setGradeFilters(contactRes.gradeFilters);
        if (contactRes?.classroomsByGrade) setClassroomsByGrade(contactRes.classroomsByGrade || {});
        if (contactRes?.actor) setCanManualAdd(Boolean(contactRes.actor.canManualAdd));
      } catch {
        /* use cached settings */
      }
    }
    setAudienceMode("individual");
    setClassScope("classroom");
    setGradeFilter("");
    setClassFilter("");
    setRecipientKind("parents");
    resetCompose(s, ctx, smtp);
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
      from: from || formatComposeSenderLabel(settings, schoolCtx, smtpSender),
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
    if (!finalRecipients.length) {
      setError(
        audienceMode === "individual"
          ? "Select at least one parent before sending."
          : "Add at least one contact before sending."
      );
      return;
    }
    setSendConfirmOpen(false);
    setLoading(true);
    try {
      const payloadContacts = finalRecipients;
      const payload = {
        schoolId,
        description: description || "Email",
        from: from || formatComposeSenderLabel(settings, schoolCtx, smtpSender),
        subject,
        message,
        contacts: payloadContacts,
      };
      const saved = editId
        ? (await updateEmail(editId, payload)).email
        : (await createEmail(payload)).email;
      setEditId(saved.id);
      setContacts(payloadContacts);
      if (!saved?.id) throw new Error("Could not save email before sending");
      const res = await sendEmail(schoolId, saved.id, audiencePayload);
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

  const handleAutoAdd = async () => {
    if (!schoolId) return;
    if (audienceMode === "by_class") {
      if (classScope === "classroom" && !classFilter) {
        setError("Select a classroom before loading contacts.");
        return;
      }
      if ((classScope === "grade" || classScope === "all_in_grade") && !gradeFilter) {
        setError("Select a grade before loading contacts.");
        return;
      }
    }
    if (!isSchoolAdmin && audienceMode === "all_parents") {
      setError("Teachers may only message parents of their assigned classrooms.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const kindForLoad =
        audienceMode === "individual" || audienceMode === "all_parents" || audienceMode === "by_class"
          ? "parents"
          : recipientKind;
      const res = await fetchCommunicationContacts({
        schoolId,
        channel: "email",
        kind: kindForLoad,
        className: classFilter || undefined,
        grade: gradeFilter || undefined,
        audience: audienceMode,
        classScope: audienceMode === "by_class" ? classScope : undefined,
      });
      setClassFilters(res.classFilters || []);
      setGradeFilters(res.gradeFilters || []);
      setClassroomsByGrade(res.classroomsByGrade || {});
      if (res.actor) setCanManualAdd(Boolean(res.actor.canManualAdd));
      const added: EmailContact[] = (res.contacts || []).map((contact) => ({
        id: contact.id,
        contactName: contact.contactName,
        relationship: contact.relationship,
        email: String(contact.email || "").trim(),
        attachments: [],
        status: "Ready",
        source: contact.source,
        sourceId: contact.sourceId,
        classNames: contact.classNames || [],
      }));
      if (!added.length) {
        setError("No valid email contacts found for the selected filters.");
        return;
      }
      if (audienceMode === "individual" || audienceMode === "all_parents" || audienceMode === "by_class") {
        setContacts(added);
        setSelectedContactIds(added.map((c) => c.id));
      } else {
        const existing = new Set(contacts.map((c) => c.email.toLowerCase()));
        const merged = [...contacts];
        for (const c of added) {
          if (!existing.has(c.email.toLowerCase())) merged.push(c);
        }
        setContacts(merged);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  };

  const addManualContact = () => {
    if (!canManualAdd) {
      setError("Only school administrators may add contacts manually.");
      setContactModalOpen(false);
      return;
    }
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
              Parents reply to <strong>{replyToEmail || "your school email"}</strong>
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={ghostBtn} onClick={() => { setView("list"); loadList(); }}>
              ← Back
            </button>
            <button
              type="button"
              style={goldBtn}
              onClick={() => {
                if (!finalRecipients.length) {
                  setError(
                    audienceMode === "individual"
                      ? "Select at least one parent before sending."
                      : "Add at least one contact before sending."
                  );
                  return;
                }
                setSendConfirmOpen(true);
              }}
              disabled={loading}
            >
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
              Sender uses EduClear&apos;s verified platform address. Replies go to the school email address.
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
          <p style={{ margin: "0 0 10px", color: "#0f172a", fontWeight: 800, fontSize: 13 }}>
            Final selection: {finalRecipients.length} unique recipient{finalRecipients.length === 1 ? "" : "s"}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            {canManualAdd ? (
              <button type="button" style={goldBtn} onClick={() => setContactModalOpen(true)}>Add</button>
            ) : null}
            <select
              style={{ ...fieldStyle, maxWidth: 200 }}
              value={audienceMode}
              onChange={(e) => {
                const next = e.target.value as CommunicationAudienceMode;
                setAudienceMode(next);
                setContacts([]);
                setSelectedContactIds([]);
                if (next === "all_parents") {
                  setRecipientKind("parents");
                  setClassFilter("");
                  setGradeFilter("");
                }
                if (next === "by_class") {
                  setRecipientKind("parents");
                  setClassScope("classroom");
                }
                if (next === "individual") setRecipientKind("parents");
              }}
            >
              <option value="individual">Individual Parents</option>
              {isSchoolAdmin ? <option value="all_parents">All Parents</option> : null}
              <option value="by_class">By Class</option>
              {isSchoolAdmin ? <option value="legacy">Other contacts (teachers/employees)</option> : null}
            </select>
            {audienceMode === "legacy" ? (
              <select
                style={{ ...fieldStyle, maxWidth: 180 }}
                value={recipientKind}
                onChange={(e) => setRecipientKind(e.target.value as CommunicationRecipientKind)}
              >
                <option value="parents">Parents</option>
                <option value="learners">Learners</option>
                <option value="teachers">Teachers</option>
                <option value="employees">Employees</option>
                <option value="all">All Contacts</option>
              </select>
            ) : null}
            {audienceMode === "by_class" && isSchoolAdmin ? (
              <select
                style={{ ...fieldStyle, maxWidth: 220 }}
                value={classScope}
                onChange={(e) => {
                  setClassScope(e.target.value as CommunicationClassScope);
                  setClassFilter("");
                }}
              >
                <option value="classroom">One classroom</option>
                <option value="grade">Entire grade</option>
                <option value="all_in_grade">All classrooms in grade</option>
              </select>
            ) : null}
            {audienceMode === "by_class" && (classScope === "grade" || classScope === "all_in_grade") ? (
              <select
                style={{ ...fieldStyle, maxWidth: 160 }}
                value={gradeFilter}
                onChange={(e) => {
                  setGradeFilter(e.target.value);
                  setClassFilter("");
                }}
              >
                <option value="">Select grade</option>
                {gradeFilters.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            ) : null}
            {audienceMode === "by_class" && classScope === "classroom" ? (
              <>
                {isSchoolAdmin ? (
                  <select
                    style={{ ...fieldStyle, maxWidth: 160 }}
                    value={gradeFilter}
                    onChange={(e) => {
                      setGradeFilter(e.target.value);
                      setClassFilter("");
                    }}
                  >
                    <option value="">Any grade</option>
                    {gradeFilters.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                ) : null}
                <select
                  style={{ ...fieldStyle, maxWidth: 180 }}
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                >
                  <option value="">Select classroom</option>
                  {(gradeFilter ? visibleClassFilters : classFilters).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </>
            ) : null}
            {audienceMode === "legacy" ? (
              <select
                style={{ ...fieldStyle, maxWidth: 180 }}
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                disabled={recipientKind === "employees"}
              >
                <option value="">All Classes</option>
                {classFilters.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : null}
            <button type="button" style={ghostBtn} onClick={() => void handleAutoAdd()} disabled={loading}>
              Load Contacts
            </button>
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
          {audienceMode === "individual" ? (
            <p style={{ margin: "0 0 10px", color: "#64748b", fontWeight: 600, fontSize: 13 }}>
              Tick the parents to include. Only checked recipients are sent.
            </p>
          ) : null}

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
              <p style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                {finalRecipients.length} unique recipient(s) · reply-to {replyToEmail || "not set"}
              </p>
              <button type="button" style={goldBtn} onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
          </div>
        ) : null}

        {sendConfirmOpen ? (
          <div style={modalOverlay} role="dialog" aria-modal="true">
            <div style={{ ...modalPanel, padding: 24 }}>
              <h3 style={{ marginTop: 0 }}>Confirm email send</h3>
              <p style={{ color: "#64748b", fontWeight: 600, lineHeight: 1.45 }}>
                Send to <strong>{finalRecipients.length}</strong> unique recipient
                {finalRecipients.length === 1 ? "" : "s"}?
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="button" style={ghostBtn} onClick={() => setSendConfirmOpen(false)} disabled={loading}>
                  Cancel
                </button>
                <button type="button" style={goldBtn} onClick={() => void handleSend()} disabled={loading}>
                  {loading ? "Sending…" : "Confirm send"}
                </button>
              </div>
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
