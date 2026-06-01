import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";



import { API_URL } from "../api";
import { clearEduClearMigrationCache } from "../utils/educlearStorageDebug";

const isDev = import.meta.env.DEV;



type BillingPlansProps = {



  learners: any[];



  setLearners: React.Dispatch<React.SetStateAction<any[]>>;



  plansSearch: string;



  setPlansSearch: React.Dispatch<React.SetStateAction<string>>;



  plansPage: number;



  setPlansPage: React.Dispatch<React.SetStateAction<number>>;



  selectedPlanLearner: any | null;



  setSelectedPlanLearner: React.Dispatch<React.SetStateAction<any | null>>;



  showFeePicker: boolean;



  setShowFeePicker: React.Dispatch<React.SetStateAction<boolean>>;



};



export default function BillingPlans({



  learners,



  setLearners,



  plansSearch,



  setPlansSearch,



  plansPage,



  setPlansPage,



  selectedPlanLearner,



  setSelectedPlanLearner,



  showFeePicker,



  setShowFeePicker,



}: BillingPlansProps) {



  const pageSize = 10;
  const feePickerPageSize = 10;

  const [feeSearch, setFeeSearch] = useState("");
  const [feePickerPage, setFeePickerPage] = useState(1);
  const [selectedFeeIds, setSelectedFeeIds] = useState<Set<string>>(() => new Set());
  const [allFees, setAllFees] = useState<any[]>([]);
  const feePickerWasOpenRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState("");
  const prevPlanLearnerKeyRef = useRef<string | null>(null);
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const learnerKey = selectedPlanLearner
      ? String(selectedPlanLearner?.id || selectedPlanLearner?.learnerId || "")
      : "";
    if (
      prevPlanLearnerKeyRef.current !== null &&
      prevPlanLearnerKeyRef.current !== learnerKey
    ) {
      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
        savedResetTimerRef.current = null;
      }
      setSaveStatus("idle");
      setSaveError("");
    }
    prevPlanLearnerKeyRef.current = learnerKey || null;
  }, [selectedPlanLearner?.id, selectedPlanLearner?.learnerId]);

  useEffect(() => {
    return () => {
      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const opening = showFeePicker && !feePickerWasOpenRef.current;
    if (opening) {
      setFeeSearch("");
      setFeePickerPage(1);
      setSelectedFeeIds(new Set());
    }
    feePickerWasOpenRef.current = showFeePicker;
  }, [showFeePicker]);

  const toggleFeeSelected = (feeId: string, checked: boolean) => {
    setSelectedFeeIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(feeId);
      else next.delete(feeId);
      return next;
    });
  };

  const getName = (learner: any) =>



    String(learner?.firstName || learner?.name || "").trim();



  const getSurname = (learner: any) =>



    String(learner?.surname || learner?.lastName || "").trim();



  const getClassroom = (learner: any) =>



    String(



      learner?.classroom ||



        learner?.classroomName ||



        learner?.grade ||



        learner?.gradeName ||



        "—"



    ).trim();



  const money = (value: any) =>



    `R ${Number(value || 0).toLocaleString("en-ZA", {



      minimumFractionDigits: 2,



      maximumFractionDigits: 2,



    })}`;



  const normalizeFee = (fee: any, index: number) => ({
    id: String(
      fee?.id ||
        fee?.feeId ||
        fee?.description ||
        fee?.feeDescription ||
        fee?.name ||
        `fee-${index}`
    ),
    description: String(
      fee?.description ||
        fee?.feeDescription ||
        fee?.name ||
        fee?.title ||
        "Fee"
    ),
    type: String(fee?.type || fee?.feeType || fee?.category || "Fee"),
    amount: Number(fee?.amount ?? fee?.price ?? fee?.value ?? 0),
    dueDate: fee?.dueDate || "",
  });

  const hasBillingPlanSetup = (learner: any) =>
    Array.isArray(learner?.billingPlan) && learner.billingPlan.length > 0;

  const resolveLearnerFromList = (learner: any) => {
    const learnerKey = String(learner?.id || learner?.learnerId || "");
    if (!learnerKey) return learner;
    const fromList = learners.find(
      (row: any) => String(row?.id || row?.learnerId || "") === learnerKey
    );
    if (!fromList) return learner;
    return {
      ...learner,
      ...fromList,
      billingPlan: Array.isArray(fromList.billingPlan)
        ? fromList.billingPlan
        : learner.billingPlan,
    };
  };

  const getPlan = (learner: any) => {
    if (Array.isArray(learner?.billingPlan) && learner.billingPlan.length > 0) {
      return learner.billingPlan.map(normalizeFee);
    }

    const legacyItems =
      (Array.isArray(learner?.billingPlan?.items) && learner.billingPlan.items) ||
      (Array.isArray(learner?.plan?.items) && learner.plan.items) ||
      (Array.isArray(learner?.billingItems) && learner.billingItems) ||
      (Array.isArray(learner?.fees) && learner.fees) ||
      null;
    if (legacyItems) {
      return legacyItems.map(normalizeFee);
    }

    const learnerKey = String(learner?.id || learner?.learnerId || "");
    if (!learnerKey) return [];

    try {
      const savedPlans = JSON.parse(
        localStorage.getItem("educlearBillingPlans") || "{}"
      );
      const savedPlan = savedPlans?.[learnerKey];
      if (Array.isArray(savedPlan) && savedPlan.length > 0) {
        return savedPlan.map(normalizeFee);
      }
    } catch {
      // ignore bad localStorage
    }

    return [];
  };

  const getPlanTotal = (learner: any) =>
    getPlan(learner).reduce((sum: number, fee: any) => sum + Number(fee.amount || 0), 0);

  const getFeeOptions = () => {



    try {



      const saved = localStorage.getItem("billingPlanFeeOptions");



      const parsed = saved ? JSON.parse(saved) : [];



      if (Array.isArray(parsed) && parsed.length > 0) {



        return parsed.map(normalizeFee);



      }



    } catch {



      // continue



    }



    return [];



  };

  const parseFeesApiList = (data: unknown): any[] => {
    if (!data || typeof data !== "object") return [];
    const payload = data as Record<string, unknown>;
    if (Array.isArray(data)) return data;
    if (Array.isArray(payload.fees)) return payload.fees;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  };

  const loadFeesThenOpen = async () => {
    try {
      localStorage.removeItem("billingPlanFeeOptions");
    } catch {
      // ignore storage errors
    }
    setAllFees([]);

    let loadedFees: any[] = [];

    const schoolIdForPlans =
      localStorage.getItem("schoolId") ||
      localStorage.getItem("selectedSchoolId") ||
      localStorage.getItem("currentSchoolId") ||
      "";

    if (schoolIdForPlans) {
      const apiPageSize = 100;
      let page = 1;
      let totalFromApi = 0;

      try {
        while (true) {
          const url = `${API_URL}/api/fees?schoolId=${encodeURIComponent(
            schoolIdForPlans
          )}&page=${page}&pageSize=${apiPageSize}`;
          const response = await fetch(url);
          if (!response.ok) break;

          const data = await response.json();
          const list = parseFeesApiList(data);
          const reportedTotal = Number((data as { total?: unknown })?.total);
          if (Number.isFinite(reportedTotal) && reportedTotal > 0) {
            totalFromApi = reportedTotal;
          }

          if (list.length > 0) {
            loadedFees = loadedFees.concat(list);
          }

          if (list.length === 0) break;
          if (totalFromApi > 0 && loadedFees.length >= totalFromApi) break;
          const responsePageSize = Number((data as { pageSize?: unknown })?.pageSize);
          const effectivePageSize =
            Number.isFinite(responsePageSize) && responsePageSize > 0
              ? responsePageSize
              : apiPageSize;
          if (totalFromApi <= 0 && list.length < effectivePageSize) break;
          page += 1;
        }
      } catch {
        // API unavailable; loadedFees may stay empty
      }
    }

    if (loadedFees.length > 0) {
      loadedFees = loadedFees.map(normalizeFee);
    }

    console.log("FEE PICKER LOADED FEES", loadedFees.length, loadedFees);

    setAllFees(loadedFees);

    try {
      localStorage.setItem("billingPlanFeeOptions", JSON.stringify(loadedFees));
    } catch {
      // ignore storage errors
    }

    setShowFeePicker(true);
  };



  const applyLearnerPlanLocally = (learner: any, plan: any[]) => {
    const learnerKey = String(learner?.id || learner?.learnerId || "");
    const updatedLearner = {
      ...learner,
      billingPlan: plan,
    };

    setLearners((prev: any[]) =>
      prev.map((item: any) =>
        String(item?.id || item?.learnerId) === learnerKey ? updatedLearner : item
      )
    );

    setSelectedPlanLearner(updatedLearner);

    try {
      const savedPlans = JSON.parse(
        localStorage.getItem("educlearBillingPlans") || "{}"
      );
      const updatedPlans = { ...savedPlans };
      if (plan.length === 0) {
        delete updatedPlans[learnerKey];
      } else {
        updatedPlans[learnerKey] = plan;
      }
      localStorage.setItem("educlearBillingPlans", JSON.stringify(updatedPlans));
      localStorage.setItem(
        "selectedBillingPlanLearner",
        JSON.stringify(updatedLearner)
      );
    } catch {
      // ignore storage error
    }

    return { learnerKey, updatedLearner };
  };

  const refreshLearnerFromApi = async (learnerKey: string) => {
    if (!learnerKey) return null;

    const response = await fetch(
      `${API_URL}/api/learners/${encodeURIComponent(learnerKey)}`
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        String((payload as { error?: string })?.error || "Failed to refresh billing plan")
      );
    }

    const loaded = (payload as { learner?: any })?.learner || payload;
    const refreshedLearner = {
      ...loaded,
      billingPlan: Array.isArray(loaded?.billingPlan) ? loaded.billingPlan : [],
    };

    setLearners((prev: any[]) =>
      prev.map((item: any) =>
        String(item?.id || item?.learnerId) === learnerKey ? refreshedLearner : item
      )
    );
    setSelectedPlanLearner(refreshedLearner);

    try {
      const savedPlans = JSON.parse(
        localStorage.getItem("educlearBillingPlans") || "{}"
      );
      const updatedPlans = { ...savedPlans };
      if (refreshedLearner.billingPlan.length === 0) {
        delete updatedPlans[learnerKey];
      } else {
        updatedPlans[learnerKey] = refreshedLearner.billingPlan;
      }
      localStorage.setItem("educlearBillingPlans", JSON.stringify(updatedPlans));
      localStorage.setItem(
        "selectedBillingPlanLearner",
        JSON.stringify(refreshedLearner)
      );
    } catch {
      // ignore storage error
    }

    return refreshedLearner;
  };

  const savePlan = async (
    learner: any,
    plan: any[],
    options?: { refreshFromApi?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    const { learnerKey, updatedLearner } = applyLearnerPlanLocally(learner, plan);

    if (!learnerKey) {
      return { ok: true };
    }

    let apiOk = true;
    let apiError = "";

    try {
      const response = await fetch(
        `${API_URL}/api/learners/${encodeURIComponent(learnerKey)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedLearner),
        }
      );

      if (!response.ok) {
        apiOk = false;
        const payload = await response.json().catch(() => ({}));
        apiError = String(
          (payload as { error?: string })?.error || `Save failed (${response.status})`
        );
      }
    } catch (error) {
      apiOk = false;
      apiError =
        error instanceof Error ? error.message : "Failed to save billing plan";
    }

    if (options?.refreshFromApi) {
      if (apiOk) {
        try {
          await refreshLearnerFromApi(learnerKey);
        } catch (error) {
          apiOk = false;
          apiError =
            error instanceof Error
              ? error.message
              : "Saved but could not refresh billing plan";
        }
      } else {
        try {
          await refreshLearnerFromApi(learnerKey);
        } catch {
          // keep displayed error from failed save
        }
      }
    }

    return { ok: apiOk, error: apiOk ? undefined : apiError };
  };

  const handleExplicitSave = async (learner: any) => {
    if (savedResetTimerRef.current) {
      clearTimeout(savedResetTimerRef.current);
      savedResetTimerRef.current = null;
    }
    setSaveError("");
    flushSync(() => {
      setSaveStatus("saving");
    });

    const plan = getPlan(learner);
    const result = await savePlan(learner, plan, { refreshFromApi: true });

    if (result.ok) {
      setSaveStatus("saved");
      setSaveError("");
      savedResetTimerRef.current = setTimeout(() => {
        setSaveStatus("idle");
        savedResetTimerRef.current = null;
      }, 2000);
    } else {
      setSaveStatus("idle");
      setSaveError(result.error || "Failed to save billing plan");
    }
  };



  const selectLearnerRow = (learner: any, event: any) => {



    localStorage.setItem(



      "selectedBillingPlanLearner",



      JSON.stringify({



        ...learner,



        billingPlan: Array.isArray(learner?.billingPlan)
          ? learner.billingPlan
          : getPlan(learner),



      })



    );



    document.querySelectorAll(".billing-plan-row").forEach((row: any) => {



      row.style.outline = "none";



      row.style.background =



        row.dataset.alt === "yes" ? "rgba(212,175,55,0.06)" : "#ffffff";



    });



    event.currentTarget.style.outline = "2px solid #d4af37";



    event.currentTarget.style.background = "rgba(212,175,55,0.18)";



  };



  const openSelectedLearner = () => {



    const raw = localStorage.getItem("selectedBillingPlanLearner");



    if (!raw) {



      alert("Click a learner row first, then click Manage.");



      return;



    }



    try {
      const parsed = JSON.parse(raw);
      setSelectedPlanLearner(resolveLearnerFromList(parsed));
    } catch {



      alert("Click a learner row first, then click Manage.");



    }



  };
  const btnGold: React.CSSProperties = {



    background: "#d4af37",



    color: "#020617",



    border: "1px solid #d4af37",



    borderRadius: "9px",



    padding: "8px 13px",



    fontWeight: 800,



    cursor: "pointer",



  };



  const btnLight: React.CSSProperties = {



    background: "#ffffff",



    color: "#0f172a",



    border: "1px solid #cbd5e1",



    borderRadius: "9px",



    padding: "8px 13px",



    fontWeight: 700,



    cursor: "pointer",



  };



  const btnDanger: React.CSSProperties = {



    background: "#ffffff",



    color: "#b91c1c",



    border: "1px solid #fecaca",



    borderRadius: "9px",



    padding: "8px 13px",



    fontWeight: 700,



    cursor: "pointer",



  };



  const th: React.CSSProperties = {



    padding: "9px 12px",



    textAlign: "left",



    fontSize: "12px",



    color: "#334155",



    fontWeight: 900,



    borderBottom: "1px solid #dbe3ee",



    whiteSpace: "nowrap",



  };



  const td: React.CSSProperties = {



    padding: "8px 12px",



    fontSize: "13px",



    color: "#0f172a",



    borderBottom: "1px solid #eef2f7",



    whiteSpace: "nowrap",



  };



  const feeOptions = allFees;

  const filteredFeeOptions = useMemo(() => {
    const q = feeSearch.trim().toLowerCase();
    if (!q) return feeOptions;
    return feeOptions.filter(
      (fee: any) =>
        String(fee.description || "").toLowerCase().includes(q) ||
        String(fee.type || "").toLowerCase().includes(q) ||
        String(fee.amount ?? "").includes(q) ||
        money(fee.amount).toLowerCase().includes(q)
    );
  }, [feeOptions, feeSearch]);

  const feePickerTotalPages = Math.max(1, Math.ceil(filteredFeeOptions.length / feePickerPageSize));
  const feePickerCurrentPage = Math.min(Math.max(1, feePickerPage), feePickerTotalPages);
  const pagedFeeOptions = useMemo(
    () =>
      filteredFeeOptions.slice(
        (feePickerCurrentPage - 1) * feePickerPageSize,
        feePickerCurrentPage * feePickerPageSize
      ),
    [filteredFeeOptions, feePickerCurrentPage, feePickerPageSize]
  );
  const pagedFeeIdSet = useMemo(
    () => new Set(pagedFeeOptions.map((fee: any) => String(fee.id))),
    [pagedFeeOptions]
  );
  const feePickerRangeStart =
    filteredFeeOptions.length === 0 ? 0 : (feePickerCurrentPage - 1) * feePickerPageSize + 1;
  const feePickerRangeEnd =
    filteredFeeOptions.length === 0
      ? 0
      : Math.min(feePickerCurrentPage * feePickerPageSize, filteredFeeOptions.length);

  const learnersForPlans = Array.isArray(learners)



    ? learners.filter((learner: any) => !learner?.unenrolled)



    : [];

  const filteredLearners = learnersForPlans.filter((learner: any) =>



    `${getName(learner)} ${getSurname(learner)} ${getClassroom(learner)}`



      .toLowerCase()



      .includes(String(plansSearch || "").toLowerCase())



  );



  const totalPages = Math.max(



    1,



    Math.ceil(filteredLearners.length / pageSize)



  );



  const currentPage = Math.min(plansPage || 1, totalPages);



  const pageLearners = filteredLearners.slice(



    (currentPage - 1) * pageSize,



    currentPage * pageSize



  );



  if (selectedPlanLearner) {
    const activePlanLearner = resolveLearnerFromList(selectedPlanLearner);
    const plan = getPlan(activePlanLearner);
    const total = getPlanTotal(activePlanLearner);



    return (



      <div style={{ padding: "20px", background: "#f8fafc", minHeight: "100vh" }}>



        <div style={{ maxWidth: "1500px", margin: "0 auto" }}>



          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px" }}>



            <div>



              <h1 style={{ margin: 0, fontSize: "30px", fontWeight: 900, color: "#0f172a" }}>



                Billing Plan



              </h1>



              <p style={{ margin: "4px 0 0", color: "#64748b" }}>



                Setup learner billing plan



              </p>



            </div>



            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>



              {saveError ? (
                <div
                  role="alert"
                  style={{ color: "#b91c1c", fontSize: "13px", fontWeight: 700, textAlign: "right" }}
                >
                  {saveError}
                </div>
              ) : null}



              <div style={{ display: "flex", gap: "8px" }}>



              <button style={btnLight} onClick={() => setSelectedPlanLearner(null)}>



                ← Back



              </button>



              <button
                type="button"
                style={{
                  ...btnGold,
                  opacity: saveStatus === "saving" ? 0.85 : 1,
                  cursor: saveStatus === "saving" ? "wait" : "pointer",
                }}
                disabled={saveStatus === "saving"}
                onClick={() => {
                  console.log("BILLING PLAN SAVE BUTTON CLICKED");
                  void handleExplicitSave(activePlanLearner);
                }}
              >
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "saved"
                    ? "Saved ✓"
                    : "Save"}
              </button>



              </div>



            </div>



          </div>



          <div style={{ display: "grid", gridTemplateColumns: "1fr 330px", gap: "16px" }}>



            <div style={{ background: "#fff", borderRadius: "16px", overflow: "hidden", border: "1px solid #e2e8f0" }}>



              <div style={{ background: "#020617", color: "#d4af37", padding: "12px 16px", fontWeight: 900 }}>



                Billing Plan



              </div>



              <div style={{ padding: "14px" }}>



                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>



                  <strong>



                    {getName(activePlanLearner)} {getSurname(activePlanLearner)}



                  </strong>



                  <label style={{ display: "flex", gap: "8px", alignItems: "center", color: "#475569", fontSize: "13px" }}>



                    <input type="checkbox" />



                    Exclude From Invoice Run



                  </label>



                </div>



                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>



                  <button style={btnGold} onClick={loadFeesThenOpen}>+ Add</button>



                  <button style={btnLight} onClick={loadFeesThenOpen}>+ New</button>



                  <button style={btnDanger} onClick={() => savePlan(activePlanLearner, [])}>



                    Remove All



                  </button>



                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>



<thead>



  <tr>



    <th style={th}>Description</th>



    <th style={th}>Type</th>



    <th style={th}>Amount</th>



    <th style={th}>Due Date</th>



    <th style={th}>Action</th>



  </tr>



</thead>



<tbody>



  {plan.length === 0 ? (



    <tr>



      <td colSpan={5} style={{ ...td, textAlign: "center", padding: "18px" }}>



        No fees added yet.



      </td>



    </tr>



  ) : (



    plan.map((fee: any, index: number) => (



      <tr key={`${fee.id}-${index}`}>



        <td style={td}>{fee.description}</td>



        <td style={td}>{fee.type}</td>



        <td style={td}>{money(fee.amount)}</td>



        <td style={td}>



          <input



            type="date"



            value={fee.dueDate || ""}



            onChange={(event) => {



              const updatedPlan = plan.map((item: any, itemIndex: number) =>



                itemIndex === index



                  ? { ...item, dueDate: event.target.value }



                  : item



              );



              savePlan(activePlanLearner, updatedPlan);



            }}



            style={{



              padding: "7px 8px",



              borderRadius: "8px",



              border: "1px solid #cbd5e1",



            }}



          />



        </td>



        <td style={td}>



          <button



            style={btnDanger}



            onClick={() => {



              const updatedPlan = plan.filter(



                (_: any, itemIndex: number) => itemIndex !== index



              );



              savePlan(activePlanLearner, updatedPlan);



            }}



          >



            Remove



          </button>



        </td>



      </tr>



    ))



  )}



</tbody>



<tfoot>



  <tr>



    <td style={td} colSpan={2}>



      <strong>Total</strong>



    </td>



    <td style={td}>



      <strong>{money(total)}</strong>



    </td>



    <td style={td} colSpan={2}></td>



  </tr>



</tfoot>



</table>



</div>



</div>



<div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", padding: "18px" }}>



<div style={{ textAlign: "center", fontWeight: 900, marginBottom: "14px" }}>



{getName(activePlanLearner)} {getSurname(activePlanLearner)}



</div>



<div style={{ display: "grid", gap: "9px", color: "#475569", fontSize: "13px" }}>



<div>Classroom: <strong>{getClassroom(activePlanLearner)}</strong></div>



<div>Status: <strong>Enrolled</strong></div>



<div>Plan Total: <strong>{money(total)}</strong></div>



</div>



</div>



</div>



{showFeePicker && (



<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.48)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>



<div style={{ width: "900px", maxWidth: "94vw", background: "#fff", borderRadius: "16px", overflow: "hidden" }}>



<div style={{ background: "#020617", color: "#d4af37", padding: "15px 18px", fontWeight: 900, fontSize: "18px" }}>



Add fees to billing plan



</div>



<div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>



  <input



    type="search"



    placeholder="Search fees…"



    value={feeSearch}



    onChange={(e) => {



      setFeeSearch(e.target.value);



      setFeePickerPage(1);



    }}



    style={{



      width: "100%",



      maxWidth: "320px",



      display: "block",



      marginLeft: "auto",



      padding: "8px 10px",



      border: "1px solid #d4af37",



      borderRadius: "8px",



      fontWeight: 700,



      fontSize: "13px",



      color: "#0f172a",



    }}



  />



</div>



<div style={{ padding: "16px", display: "grid", gap: "9px", maxHeight: "420px", overflowY: "auto" }}>



{feeOptions.length === 0 ? (



  <div style={{ color: "#64748b", padding: "14px" }}>



    No fees found. Open Fees once, then come back to Billing Plans.



  </div>



) : filteredFeeOptions.length === 0 ? (



  <div style={{ color: "#64748b", padding: "14px" }}>



    No fees match your search.



  </div>



) : (



  <>



  {feeOptions



    .filter(



      (fee: any) => selectedFeeIds.has(String(fee.id)) && !pagedFeeIdSet.has(String(fee.id))



    )



    .map((fee: any) => (



      <input



        key={`hidden-fee-check-${fee.id}`}



        id={`fee-check-${fee.id}`}



        type="checkbox"



        checked



        readOnly



        tabIndex={-1}



        aria-hidden="true"



        style={{ display: "none" }}



      />



    ))}



  {pagedFeeOptions.map((fee: any) => (



    <label



      key={fee.id}



      style={{



        display: "grid",



        gridTemplateColumns: "40px 1fr 160px",



        gap: "12px",



        alignItems: "center",



        padding: "12px",



        border: "1px solid #e2e8f0",



        borderRadius: "10px",



        cursor: "pointer",



        background: "#ffffff",



      }}



    >



      <input



        id={`fee-check-${fee.id}`}



        type="checkbox"



        checked={selectedFeeIds.has(String(fee.id))}



        onChange={(e) => toggleFeeSelected(String(fee.id), e.target.checked)}



        style={{ width: "18px", height: "18px", cursor: "pointer" }}



      />



      <div>



        <div style={{ fontWeight: 800, color: "#0f172a" }}>



          {fee.description}



        </div>



        <div style={{ color: "#64748b", fontSize: "12px", marginTop: "2px" }}>



          {fee.type}



        </div>



      </div>



      <div style={{ fontWeight: 900, textAlign: "right", color: "#0f172a" }}>



        {money(fee.amount)}



      </div>



    </label>



  ))}



  </>



)}



</div>



<div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>



  <span style={{ color: "#64748b", fontSize: "13px", fontWeight: 700 }}>



    {feePickerRangeStart === 0 ? "0" : `${feePickerRangeStart} - ${feePickerRangeEnd}`} / {allFees.length}



  </span>



  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>



    <button



      type="button"



      style={{ ...btnLight, padding: "6px 12px", opacity: feePickerCurrentPage <= 1 ? 0.55 : 1 }}



      disabled={feePickerCurrentPage <= 1}



      onClick={() => setFeePickerPage(1)}



      aria-label="First page"



    >



      {"<<"}



    </button>



    <button



      type="button"



      style={{ ...btnLight, padding: "6px 12px", opacity: feePickerCurrentPage <= 1 ? 0.55 : 1 }}



      disabled={feePickerCurrentPage <= 1}



      onClick={() => setFeePickerPage((page) => Math.max(1, page - 1))}



      aria-label="Previous page"



    >



      {"<"}



    </button>



    <span style={{ fontSize: "13px", fontWeight: 800, color: "#334155", minWidth: "96px", textAlign: "center" }}>



      Page {feePickerCurrentPage} / {feePickerTotalPages}



    </span>



    <button



      type="button"



      style={{ ...btnLight, padding: "6px 12px", opacity: feePickerCurrentPage >= feePickerTotalPages ? 0.55 : 1 }}



      disabled={feePickerCurrentPage >= feePickerTotalPages}



      onClick={() => setFeePickerPage((page) => Math.min(feePickerTotalPages, page + 1))}



      aria-label="Next page"



    >



      {">"}



    </button>



    <button



      type="button"



      style={{ ...btnLight, padding: "6px 12px", opacity: feePickerCurrentPage >= feePickerTotalPages ? 0.55 : 1 }}



      disabled={feePickerCurrentPage >= feePickerTotalPages}



      onClick={() => setFeePickerPage(feePickerTotalPages)}



      aria-label="Last page"



    >



      {">>"}



    </button>



  </div>



</div>



<div style={{ padding: "13px 16px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>



<button style={btnLight} onClick={() => setShowFeePicker(false)}>



  Cancel



</button>



<button



  style={btnGold}



  onClick={() => {



    const selectedFees = feeOptions.filter((fee: any) => {



      const box = document.getElementById(



        `fee-check-${fee.id}`



      ) as HTMLInputElement | null;



      return box?.checked;



    });



    if (selectedFees.length === 0) {



      alert("Please tick at least one fee.");



      return;



    }



    savePlan(activePlanLearner, [



      ...plan,



      ...selectedFees.map((fee: any) => ({



        ...fee,



        dueDate: "",



      })),



    ]);



    setShowFeePicker(false);



  }}



>



  Continue



</button>



</div>



</div>



</div>



)}



</div>



</div>



);



}



return (



<div style={{ padding: "20px", background: "#f8fafc", minHeight: "100vh" }}>



<div style={{ maxWidth: "1500px", margin: "0 auto" }}>



<h1 style={{ margin: 0, fontSize: "30px", fontWeight: 900, color: "#0f172a" }}>



Billing Plans



</h1>



<p style={{ margin: "4px 0 14px", color: "#64748b" }}>
Manage learner billing plans for invoice runs
</p>

{isDev && (
  <button
    type="button"
    style={{ ...btnLight, marginBottom: "12px", fontSize: "12px" }}
    onClick={() => {
      const removed = clearEduClearMigrationCache();
      alert(
        removed.length
          ? `Cleared ${removed.length} cached key(s). Reload the page to refresh billing plans from the server.`
          : "No migration/demo cache keys were stored."
      );
    }}
  >
    [Dev] Clear billing/migration localStorage cache
  </button>
)}



<div style={{ background: "#fff", padding: "12px", borderRadius: "16px", display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "14px", border: "1px solid rgba(212,175,55,0.18)" }}>



<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>



<button style={btnLight} onClick={openSelectedLearner}>



Manage



</button>



<button style={btnGold} onClick={loadFeesThenOpen}>



+ Add Fees To Multiple



</button>



<button style={btnDanger} onClick={() => alert("Click a learner row first, then manage the fees.")}>



Remove Fees From Multiple



</button>



<button style={btnLight} onClick={openSelectedLearner}>



Manage Multiple Fees



</button>



</div>



<input



value={plansSearch}



onChange={(event) => {



setPlansSearch(event.target.value);



setPlansPage(1);



}}



placeholder="Search learner..."



style={{



width: "250px",



padding: "9px 13px",



borderRadius: "10px",



border: "1px solid #cbd5e1",



outline: "none",



}}



/>



</div>
<div style={{ background: "#fff", borderRadius: "18px", overflow: "hidden", border: "1px solid rgba(15,23,42,0.08)" }}>



<div style={{ background: "#020617", color: "#d4af37", padding: "12px 18px", fontWeight: 900, fontSize: "18px" }}>



  Billing Plans



</div>



<div className="table-scroll-wrap">
<table style={{ width: "100%", borderCollapse: "collapse" }}>



  <thead>



    <tr>



      <th style={th}>Name</th>



      <th style={th}>Surname</th>



      <th style={th}>Classroom</th>



      <th style={th}>Total Amount</th>



      <th style={th}>Child Status</th>



      <th style={th}>Billing Plan Status</th>



    </tr>



  </thead>



  <tbody>



    {pageLearners.length === 0 ? (



      <tr>



        <td colSpan={6} style={{ ...td, textAlign: "center", padding: "20px" }}>



          No learners found.



        </td>



      </tr>



    ) : (



      pageLearners.map((learner: any, index: number) => {



        const plan = getPlan(learner);
        const total = getPlanTotal(learner);
        const hasPlan = plan.length > 0;



        return (



          <tr



            key={learner.id || learner.learnerId || index}



            className="billing-plan-row"



            data-alt={index % 2 === 0 ? "no" : "yes"}



            onClick={(event) => selectLearnerRow(learner, event)}



            onDoubleClick={() => setSelectedPlanLearner(resolveLearnerFromList(learner))}



            style={{



              background: index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.06)",



              cursor: "pointer",



              transition: "all 0.2s ease",



            }}



          >



            <td style={td}>{getName(learner)}</td>



            <td style={td}>{getSurname(learner)}</td>



            <td style={td}>{getClassroom(learner)}</td>



            <td style={td}>{money(total)}</td>



            <td style={{ ...td, color: "#15803d", fontWeight: 900 }}>



              Enrolled



            </td>



            <td style={{ ...td, color: hasPlan ? "#15803d" : "#b91c1c", fontWeight: 800 }}>



              {hasPlan



                ? `Billing plan setup (${plan.length} fee${plan.length === 1 ? "" : "s"})`



                : "No billing plan"}



            </td>



          </tr>



        );



      })



    )}



  </tbody>



</table>
</div>



<div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e2e8f0" }}>



  <span style={{ color: "#64748b", fontSize: "13px" }}>



    Showing {filteredLearners.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}



    {" - "}



    {Math.min(currentPage * pageSize, filteredLearners.length)}



    {" of "}



    {filteredLearners.length}



  </span>



  <div style={{ display: "flex", gap: "6px" }}>



    <button style={btnLight} onClick={() => setPlansPage(1)}>{"<<"}</button>



    <button style={btnLight} onClick={() => setPlansPage((page: number) => Math.max(1, page - 1))}>{"<"}</button>



    <button style={btnGold}>{currentPage}</button>



    <button style={btnLight} onClick={() => setPlansPage((page: number) => Math.min(totalPages, page + 1))}>{">"}</button>



    <button style={btnLight} onClick={() => setPlansPage(totalPages)}>{">>"}</button>



  </div>



</div>



</div>



</div>



</div>



);



}