import React from "react";



import { API_URL } from "../api";



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



        fee?.name ||



        `fee-${index}`



    ),



    description: String(



      fee?.description || fee?.name || fee?.title || "Fee"



    ),



    type: String(fee?.type || fee?.feeType || fee?.category || "Fee"),



    amount: Number(fee?.amount || fee?.price || fee?.value || 0),



    dueDate: fee?.dueDate || "",



  });



  const getPlan = (learner: any) => {



    try {



      const savedPlans = JSON.parse(



        localStorage.getItem("educlearBillingPlans") || "{}"



      );



      const learnerKey = String(learner?.id || learner?.learnerId || "");



      const savedPlan = savedPlans?.[learnerKey];



      if (Array.isArray(savedPlan)) return savedPlan;



    } catch {



      // ignore bad localStorage



    }



    return Array.isArray(learner?.billingPlan) ? learner.billingPlan : [];



  };



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
  const loadFeesThenOpen = async () => {



    let loadedFees: any[] = [];



    const schoolIdForPlans =



      localStorage.getItem("schoolId") ||



      localStorage.getItem("selectedSchoolId") ||



      localStorage.getItem("currentSchoolId") ||



      "";



    



        const endpoints = [



            `${API_URL}/api/fees?schoolId=${encodeURIComponent(schoolIdForPlans)}`,
          
          
          
          ];





    for (const url of endpoints) {



      try {



        const response = await fetch(url);



        if (!response.ok) continue;



        const data = await response.json();



        const list = Array.isArray(data)



          ? data



          : Array.isArray(data?.fees)



          ? data.fees



          : Array.isArray(data?.data)



          ? data.data



          : Array.isArray(data?.items)



          ? data.items



          : [];



        if (list.length > 0) {



          loadedFees = list.map(normalizeFee);



          break;



        }



      } catch {



        // try next endpoint



      }



    }



    localStorage.setItem(



      "billingPlanFeeOptions",



      JSON.stringify(loadedFees)



    );



    setShowFeePicker(true);



  };



  const savePlan = async (learner: any, plan: any[]) => {



    const learnerKey = String(learner?.id || learner?.learnerId || "");



    const updatedLearner = {



      ...learner,



      billingPlan: plan,



    };



    setLearners((prev: any[]) =>



      prev.map((item: any) =>



        String(item?.id || item?.learnerId) === learnerKey



          ? updatedLearner



          : item



      )



    );



    setSelectedPlanLearner(updatedLearner);



    try {



      const savedPlans = JSON.parse(



        localStorage.getItem("educlearBillingPlans") || "{}"



      );



      const updatedPlans = {



        ...savedPlans,



        [learnerKey]: plan,



      };



      localStorage.setItem(



        "educlearBillingPlans",



        JSON.stringify(updatedPlans)



      );



      localStorage.setItem(



        "selectedBillingPlanLearner",



        JSON.stringify(updatedLearner)



      );



    } catch {



      // ignore storage error



    }



    try {



      if (learnerKey) {



        await fetch(`${API_URL}/api/learners/${learnerKey}`, {



          method: "PUT",



          headers: { "Content-Type": "application/json" },



          body: JSON.stringify(updatedLearner),



        });



      }



    } catch {



      // local save already done



    }



  };



  const selectLearnerRow = (learner: any, event: any) => {



    localStorage.setItem(



      "selectedBillingPlanLearner",



      JSON.stringify({



        ...learner,



        billingPlan: getPlan(learner),



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



      setSelectedPlanLearner(JSON.parse(raw));



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



  const feeOptions = getFeeOptions();



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



    const plan = getPlan(selectedPlanLearner);



    const total = plan.reduce(



      (sum: number, fee: any) => sum + Number(fee.amount || 0),



      0



    );



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



            <div style={{ display: "flex", gap: "8px" }}>



              <button style={btnLight} onClick={() => setSelectedPlanLearner(null)}>



                ← Back



              </button>



              <button style={btnGold} onClick={() => alert("Billing plan saved")}>



                Save



              </button>



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



                    {getName(selectedPlanLearner)} {getSurname(selectedPlanLearner)}



                  </strong>



                  <label style={{ display: "flex", gap: "8px", alignItems: "center", color: "#475569", fontSize: "13px" }}>



                    <input type="checkbox" />



                    Exclude From Invoice Run



                  </label>



                </div>



                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>



                  <button style={btnGold} onClick={loadFeesThenOpen}>+ Add</button>



                  <button style={btnLight} onClick={loadFeesThenOpen}>+ New</button>



                  <button style={btnDanger} onClick={() => savePlan(selectedPlanLearner, [])}>



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



              savePlan(selectedPlanLearner, updatedPlan);



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



              savePlan(selectedPlanLearner, updatedPlan);



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



{getName(selectedPlanLearner)} {getSurname(selectedPlanLearner)}



</div>



<div style={{ display: "grid", gap: "9px", color: "#475569", fontSize: "13px" }}>



<div>Classroom: <strong>{getClassroom(selectedPlanLearner)}</strong></div>



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



<div style={{ padding: "16px", display: "grid", gap: "9px", maxHeight: "520px", overflowY: "auto" }}>



{feeOptions.length === 0 ? (



  <div style={{ color: "#64748b", padding: "14px" }}>



    No fees found. Open Fees once, then come back to Billing Plans.



  </div>



) : (



  feeOptions.map((fee: any) => (



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



  ))



)}



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



    savePlan(selectedPlanLearner, [



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



        const total = plan.reduce(



          (sum: number, fee: any) => sum + Number(fee.amount || 0),



          0



        );



        return (



          <tr



            key={learner.id || learner.learnerId || index}



            className="billing-plan-row"



            data-alt={index % 2 === 0 ? "no" : "yes"}



            onClick={(event) => selectLearnerRow(learner, event)}



            onDoubleClick={() => setSelectedPlanLearner(learner)}



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



            <td style={{ ...td, color: plan.length ? "#15803d" : "#b91c1c", fontWeight: 800 }}>



              {plan.length



                ? `Billing plan setup (${plan.length} fee${plan.length === 1 ? "" : "s"})`



                : "No billing plan"}



            </td>



          </tr>



        );



      })



    )}



  </tbody>



</table>



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