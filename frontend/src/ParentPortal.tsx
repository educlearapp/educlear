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
  learnerId?: string;
  familyAccountId?: string;
  accountNo: string;
  name: string;
  surname: string;
  balance: number;
  lastInvoice: number;
  lastPayment: number;
  status: string;
};

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

  const canLookup = useMemo(() => {
    return Boolean(schoolId && String(cellNo || "").trim());
  }, [schoolId, cellNo]);

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
      const learnerIds = new Set((Array.isArray(data.learners) ? data.learners : []).map((x) => String(x.learner.id)));
      setAccounts(allAccounts.filter((a) => (a.learnerId ? learnerIds.has(String(a.learnerId)) : false)));
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
                        {accounts.find((a) => String(a.learnerId || "") === String(x.learner.id)) ? (
                          <div style={{ marginTop: 6, fontWeight: 900, color: "#0f172a" }}>
                            Balance:{" "}
                            <span style={{ color: GOLD }}>
                              R{" "}
                              {Number(
                                accounts.find((a) => String(a.learnerId || "") === String(x.learner.id))?.balance || 0
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
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ParentPortal;

