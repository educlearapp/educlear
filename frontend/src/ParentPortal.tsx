import type React from "react";
import { useMemo, useState } from "react";
import { apiFetch } from "./api";

type LookupParent = {
  id: string;
  firstName: string;
  surname: string;
  cellNo: string;
  email: string | null;
  school: { id: string; name: string } | null;
};

type LookupLearner = {
  linkId: string;
  isPrimary: boolean;
  relation: string | null;
  learner: {
    id: string;
    firstName: string;
    lastName: string;
    grade: string;
    className: string | null;
    admissionNo: string | null;
  };
};

type StatementAccount = {
  accountNo: string;
  name: string;
  surname: string;
  balance: number;
  lastInvoice: number;
  lastPayment: number;
  status: string;
};

type MessageSender = "PARENT" | "TEACHER";
type MessageCategory = "BEHAVIOUR" | "HOMEWORK" | "GENERAL" | "ACCOUNT_QUERY";
type ThreadMessage = { id: string; sender: MessageSender; body: string; createdAt: string };

export type ParentPortalProps = {
  schoolId: string;
  onBack: () => void;
  onOpenLearnerProfile: (learner: any) => void;
  onGoToStatements: () => void;
  onGoToInvoices: () => void;
  onGoToPayments: () => void;
  onGoToIncidents: () => void;
};

const ParentPortal: React.FC<ParentPortalProps> = ({
  schoolId,
  onBack,
  onOpenLearnerProfile,
  onGoToStatements,
  onGoToInvoices,
  onGoToPayments,
  onGoToIncidents,
}) => {

  const [cellNo, setCellNo] = useState("");
  const [idNumber, setIdNumber] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parent, setParent] = useState<LookupParent | null>(null);
  const [learners, setLearners] = useState<LookupLearner[]>([]);
  const [accounts, setAccounts] = useState<StatementAccount[]>([]);

  const [messageOpen, setMessageOpen] = useState(false);
  const [messageLearner, setMessageLearner] = useState<LookupLearner["learner"] | null>(null);
  const [messageCategory, setMessageCategory] = useState<MessageCategory>("GENERAL");
  const [messageTeacher, setMessageTeacher] = useState<{ name: string | null; email: string } | null>(null);
  const [messageClassroomName, setMessageClassroomName] = useState<string>("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const accountByAccountNo = useMemo(() => {
    const map = new Map<string, StatementAccount>();
    for (const a of accounts) {
      const key = String(a.accountNo || "").trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, a);
    }
    return map;
  }, [accounts]);

  function accountForLearner(learner: LookupLearner["learner"]) {
    const admissionNo = String(learner?.admissionNo || "").trim().toLowerCase();
    if (admissionNo && accountByAccountNo.has(admissionNo)) return accountByAccountNo.get(admissionNo) || null;

    const firstName = String(learner?.firstName || "").trim().toLowerCase();
    const lastName = String(learner?.lastName || "").trim().toLowerCase();
    if (firstName && lastName) {
      const byName = accounts.find(
        (a) =>
          String(a?.name || "").trim().toLowerCase() === firstName &&
          String(a?.surname || "").trim().toLowerCase() === lastName
      );
      if (byName) return byName;
    }
    return null;
  }

  const canLookup = useMemo(() => {
    return Boolean(schoolId && String(cellNo || "").trim());
  }, [schoolId, cellNo]);

  async function loadThread(opts?: { category?: MessageCategory; learnerId?: string }) {
    if (!schoolId || !cellNo.trim() || !idNumber.trim()) {
      setMessageError("Please enter both mobile number and ID number to message a teacher.");
      return;
    }
    const learnerId = opts?.learnerId || messageLearner?.id || "";
    const category = opts?.category || messageCategory;
    if (!learnerId) return;

    setMessageLoading(true);
    setMessageError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("schoolId", schoolId);
      qs.set("cellNo", cellNo.trim());
      qs.set("idNumber", idNumber.trim());
      qs.set("learnerId", learnerId);
      qs.set("category", category);
      const data = (await apiFetch(`/parent-portal/thread?${qs.toString()}`)) as any;

      const teacher = data?.teacher?.email ? { name: data.teacher.name ?? null, email: String(data.teacher.email) } : null;
      setMessageTeacher(teacher);
      setMessageClassroomName(String(data?.classroomName || ""));

      const t = data?.thread;
      setThreadId(t?.id ? String(t.id) : null);
      setThreadMessages(Array.isArray(t?.messages) ? t.messages : []);
    } catch (e: any) {
      setThreadId(null);
      setThreadMessages([]);
      setMessageTeacher(null);
      setMessageClassroomName("");
      setMessageError(String(e?.message || "Failed to load messages"));
    } finally {
      setMessageLoading(false);
    }
  }

  async function sendMessage() {
    if (!messageLearner) return;
    if (!schoolId || !cellNo.trim() || !idNumber.trim()) {
      setMessageError("Please enter both mobile number and ID number to message a teacher.");
      return;
    }
    if (!String(messageDraft || "").trim()) {
      setMessageError("Please type a message first.");
      return;
    }
    setMessageLoading(true);
    setMessageError(null);
    try {
      await apiFetch("/parent-portal/send-message", {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          cellNo: cellNo.trim(),
          idNumber: idNumber.trim(),
          learnerId: messageLearner.id,
          category: messageCategory,
          body: messageDraft.trim(),
        }),
      });
      setMessageDraft("");
      await loadThread({ learnerId: messageLearner.id, category: messageCategory });
    } catch (e: any) {
      setMessageError(String(e?.message || "Failed to send message"));
    } finally {
      setMessageLoading(false);
    }
  }

  async function onLookup() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("schoolId", schoolId);
      qs.set("cellNo", cellNo.trim());
      if (idNumber.trim()) qs.set("idNumber", idNumber.trim());

      const data = (await apiFetch(`/parent-portal/lookup?${qs.toString()}`)) as {
        success: boolean;
        parent: LookupParent;
        learners: LookupLearner[];
      };

      setParent(data.parent);
      setLearners(Array.isArray(data.learners) ? data.learners : []);

      const statementData = (await apiFetch(
        `/statements/accounts?schoolId=${encodeURIComponent(schoolId)}`
      )) as { success?: boolean; accounts?: StatementAccount[] };
      const allAccounts = Array.isArray(statementData?.accounts) ? statementData.accounts : [];
      setAccounts(allAccounts);
    } catch (e: any) {
      setParent(null);
      setLearners([]);
      setAccounts([]);
      setError(String(e?.message || "Lookup failed"));
    } finally {
      setLoading(false);
    }
  }

  const GOLD = "#d4af37";

  return (
    <div
      style={{
        padding: "26px",
        background: "#f8fafc",
        minHeight: "100%",
        borderRadius: "20px",
        border: "1px solid rgba(15,23,42,0.08)",
        color: "#0f172a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: GOLD, letterSpacing: 4, fontSize: 12, fontWeight: 900 }}>
              PARENT PORTAL
            </div>
            <h1 style={{ margin: "10px 0 8px", fontSize: 40, lineHeight: 1.1 }}>
              Parent Portal
            </h1>
            <div style={{ color: "#64748b", maxWidth: 720, lineHeight: 1.6, fontWeight: 700 }}>
              Enter the mobile number used at registration. If your school requires it, also enter the
              parent/guardian ID number.
            </div>
          </div>

          <button
            onClick={onBack}
            style={{
              height: 44,
              padding: "0 16px",
              borderRadius: 12,
              border: "1px solid rgba(212,175,55,0.35)",
              background: "#ffffff",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
              alignSelf: "flex-start",
            }}
          >
            ← Back
          </button>
        </div>

        <div
          style={{
            marginTop: 22,
            borderRadius: 18,
            border: "1px solid rgba(212,175,55,0.28)",
            background: "#ffffff",
            padding: 18,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 900 }}>
                Mobile number
              </div>
              <input
                value={cellNo}
                onChange={(e) => setCellNo(e.target.value)}
                placeholder="+27..."
                style={{
                  width: "100%",
                  height: 44,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#ffffff",
                  color: "#0f172a",
                  padding: "0 12px",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 900 }}>
                ID number (optional)
              </div>
              <input
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                placeholder="South African ID"
                style={{
                  width: "100%",
                  height: 44,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#ffffff",
                  color: "#0f172a",
                  padding: "0 12px",
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button
              disabled={!canLookup || loading}
              onClick={onLookup}
              style={{
                height: 44,
                padding: "0 18px",
                borderRadius: 12,
                border: "1px solid rgba(212,175,55,0.7)",
                background: "linear-gradient(135deg, #d4af37, #f5d06f)",
                color: "#111827",
                fontWeight: 900,
                cursor: !canLookup || loading ? "not-allowed" : "pointer",
                opacity: !canLookup || loading ? 0.6 : 1,
              }}
            >
              {loading ? "Looking up..." : "Continue"}
            </button>

            {!schoolId ? (
              <div style={{ color: "#ffb4b4", fontWeight: 800 }}>
                School not selected yet. Please sign in via your school first.
              </div>
            ) : null}

            {error ? <div style={{ color: "#b91c1c", fontWeight: 900 }}>{error}</div> : null}
          </div>
        </div>

        {parent ? (
          <div style={{ marginTop: 22 }}>
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(212,175,55,0.28)",
                background: "#ffffff",
                padding: 18,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: GOLD, letterSpacing: 3, fontSize: 12, fontWeight: 900 }}>
                    ACCOUNT
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
                    {parent.firstName} {parent.surname}
                  </div>
                  <div style={{ color: "#475569", marginTop: 6, lineHeight: 1.5, fontWeight: 700 }}>
                    {parent.school?.name ? <div>School: {parent.school.name}</div> : null}
                    <div>Mobile: {parent.cellNo}</div>
                    {parent.email ? <div>Email: {parent.email}</div> : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <button
                    onClick={onGoToStatements}
                    style={{
                      height: 40,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(15,23,42,0.14)",
                      background: "#ffffff",
                      color: "#0f172a",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Statements
                  </button>
                  <button
                    onClick={onGoToInvoices}
                    style={{
                      height: 40,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(15,23,42,0.14)",
                      background: "#ffffff",
                      color: "#0f172a",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Invoices
                  </button>
                  <button
                    onClick={onGoToPayments}
                    style={{
                      height: 40,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(15,23,42,0.14)",
                      background: "#ffffff",
                      color: "#0f172a",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Payments
                  </button>
                  <button
                    onClick={onGoToIncidents}
                    style={{
                      height: 40,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(15,23,42,0.14)",
                      background: "#ffffff",
                      color: "#0f172a",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Incidents
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 16, fontWeight: 900, fontSize: 16 }}>Linked learners</div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                {learners.length === 0 ? (
                  <div style={{ color: "#64748b", fontWeight: 800 }}>
                    No learners are linked to this parent account yet.
                  </div>
                ) : (
                  learners.map((x) => (
                    <div
                      key={x.linkId}
                      style={{
                        borderRadius: 14,
                        border: "1px solid rgba(15,23,42,0.10)",
                        background: "#ffffff",
                        padding: 14,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>
                          {x.learner.firstName} {x.learner.lastName}{" "}
                          {x.isPrimary ? <span style={{ color: GOLD }}>(Primary)</span> : null}
                        </div>
                        <div style={{ color: "#475569", marginTop: 4, fontWeight: 700 }}>
                          Grade: {x.learner.grade}
                          {x.learner.className ? ` • Class: ${x.learner.className}` : ""}
                          {x.learner.admissionNo ? ` • Admission: ${x.learner.admissionNo}` : ""}
                        </div>
                        {accountForLearner(x.learner) ? (
                          <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>
                            Balance:{" "}
                            <span style={{ color: GOLD }}>
                              R{" "}
                              {Number(
                                accountForLearner(x.learner)?.balance || 0
                              ).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          onClick={() => onOpenLearnerProfile(x.learner)}
                          style={{
                            height: 40,
                            padding: "0 14px",
                            borderRadius: 12,
                            border: "1px solid rgba(15,23,42,0.14)",
                            background: "#ffffff",
                            color: "#0f172a",
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          View profile
                        </button>
                        <button
                          onClick={async () => {
                            setMessageOpen(true);
                            setMessageLearner(x.learner);
                            setMessageCategory("GENERAL");
                            setMessageTeacher(null);
                            setMessageClassroomName("");
                            setThreadId(null);
                            setThreadMessages([]);
                            setMessageDraft("");
                            setMessageError(null);
                            await loadThread({ learnerId: x.learner.id, category: "GENERAL" });
                          }}
                          style={{
                            height: 40,
                            padding: "0 14px",
                            borderRadius: 12,
                            border: "1px solid rgba(212,175,55,0.7)",
                            background: "linear-gradient(135deg, #0b1220, #111827)",
                            color: GOLD,
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          Message teacher
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {messageOpen ? (
        <div
          onClick={() => setMessageOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(980px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: 18,
              border: "1px solid rgba(212,175,55,0.28)",
              background: "#ffffff",
              padding: 18,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: GOLD, letterSpacing: 3, fontSize: 12, fontWeight: 900 }}>MESSAGING</div>
                <div style={{ fontSize: 20, fontWeight: 900, marginTop: 6 }}>
                  {messageLearner ? `${messageLearner.firstName} ${messageLearner.lastName}` : "Message teacher"}
                </div>
                <div style={{ color: "#475569", marginTop: 6, lineHeight: 1.5, fontWeight: 700 }}>
                  {messageClassroomName ? <div>Classroom: {messageClassroomName}</div> : null}
                  {messageTeacher ? (
                    <div>
                      Teacher: {messageTeacher.name ? `${messageTeacher.name} • ` : ""}
                      {messageTeacher.email}
                    </div>
                  ) : (
                    <div style={{ color: "#b45309" }}>
                      No teacher assigned yet (ask the school admin to assign a teacher to this classroom).
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => setMessageOpen(false)}
                style={{
                  height: 40,
                  padding: "0 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(15,23,42,0.14)",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 900,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 900 }}>Category</div>
                <select
                  value={messageCategory}
                  onChange={async (e) => {
                    const v = e.target.value as MessageCategory;
                    setMessageCategory(v);
                    await loadThread({ category: v });
                  }}
                  style={{
                    width: "100%",
                    height: 44,
                    borderRadius: 12,
                    border: "1px solid rgba(15,23,42,0.12)",
                    background: "#ffffff",
                    color: "#0f172a",
                    padding: "0 12px",
                    outline: "none",
                    fontWeight: 800,
                  }}
                >
                  <option value="BEHAVIOUR">Behaviour</option>
                  <option value="HOMEWORK">Homework</option>
                  <option value="GENERAL">General</option>
                  <option value="ACCOUNT_QUERY">Account query</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 900 }}>Thread</div>
                <div style={{ height: 44, display: "flex", alignItems: "center", fontWeight: 900, color: "#0f172a" }}>
                  {threadId ? `Thread #${threadId.slice(0, 8)}` : "New thread"}
                </div>
              </div>
            </div>

            {messageError ? <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900 }}>{messageError}</div> : null}

            <div
              style={{
                marginTop: 14,
                borderRadius: 14,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "#ffffff",
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Message history</div>
              {messageLoading ? (
                <div style={{ color: "#64748b", fontWeight: 800 }}>Loading…</div>
              ) : threadMessages.length === 0 ? (
                <div style={{ color: "#64748b", fontWeight: 800 }}>
                  No messages yet. Send the first message to start the conversation.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                  {threadMessages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        borderRadius: 12,
                        border: "1px solid rgba(15,23,42,0.10)",
                        background: m.sender === "PARENT" ? "rgba(212,175,55,0.10)" : "rgba(15,23,42,0.06)",
                        padding: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>
                          {m.sender === "PARENT" ? "You" : "Teacher"}
                        </div>
                        <div style={{ fontWeight: 800, color: "#64748b", fontSize: 12 }}>
                          {new Date(m.createdAt).toLocaleString("en-ZA")}
                        </div>
                      </div>
                      <div style={{ marginTop: 6, fontWeight: 800, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                        {m.body}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 900 }}>New message</div>
              <textarea
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="Type your message…"
                style={{
                  width: "100%",
                  minHeight: 96,
                  borderRadius: 12,
                  border: "1px solid rgba(15,23,42,0.12)",
                  background: "#ffffff",
                  color: "#0f172a",
                  padding: 12,
                  outline: "none",
                  fontWeight: 800,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
                <button
                  disabled={!messageTeacher || messageLoading}
                  onClick={sendMessage}
                  style={{
                    height: 44,
                    padding: "0 18px",
                    borderRadius: 12,
                    border: "1px solid rgba(212,175,55,0.7)",
                    background: "linear-gradient(135deg, #d4af37, #f5d06f)",
                    color: "#111827",
                    fontWeight: 900,
                    cursor: !messageTeacher || messageLoading ? "not-allowed" : "pointer",
                    opacity: !messageTeacher || messageLoading ? 0.6 : 1,
                  }}
                >
                  {messageLoading ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ParentPortal;

