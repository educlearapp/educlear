import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import { appendInvoiceRunTransactions } from "./billingLedger";
import {



  fetchInvoices,



  fetchPayments,



} from "./billingApi";



import { calculateLastPayment } from "./billingCalculations";
import {
  BILLING_UPDATED_EVENT,
  calculateAccountBalance,
  getAccountLedger,
} from "./billingLedger";
import { syncBillingLedgerFromApi } from "./billingApi";



import type {



  Invoice,



  Payment,



} from "./billingTypes";


export default function InvoiceRuns(props: any) {



  const {



    learners,



    invoiceRunSearch,



    setInvoiceRunSearch,



    invoiceRunPage,



    setInvoiceRunPage,



    invoiceRunSettings,



    setInvoiceRunSettings,



    invoiceRunView,



    setInvoiceRunView,



    storedRuns = [],



    setStoredRuns,



  } = props;

  const [invoices, setInvoices] = useState<Invoice[]>([]);



  const [payments, setPayments] = useState<Payment[]>([]);
  
  
  
  const [billingLoading, setBillingLoading] = useState(false);
  
  const [statementEmailOpen, setStatementEmailOpen] = useState(false);



  const [statementEmailRows, setStatementEmailRows] = useState<any[]>([]);



  const [statementEmailSubject, setStatementEmailSubject] = useState("");



  const [statementEmailMessage, setStatementEmailMessage] = useState("");



  const [statementEmailSending, setStatementEmailSending] = useState(false);

  useEffect(() => {



    loadBillingData();
  
  
  
  }, []);
  
  
  
  const loadBillingData = async () => {
  
  
  
    try {
  
  
  
      setBillingLoading(true);
  
  
  
      const schoolId =
  
  
  
        localStorage.getItem("schoolId") || "";
  
  
  
      const invoicesData =
  
  
  
        await fetchInvoices(schoolId);
  
  
  
      const paymentsData =
  
  
  
        await fetchPayments(schoolId);
  
  
  
      setInvoices(invoicesData || []);
  
  
  
      setPayments(paymentsData || []);
  
  
  
    } catch (error) {
  
  
  
      console.error(
  
  
  
        "Failed to load billing data",
  
  
  
        error
  
  
  
      );
  
  
  
    } finally {
  
  
  
      setBillingLoading(false);
  
  
  
    }
  
  
  
  };

  const schoolIdForLedger = localStorage.getItem("schoolId") || "";

  const getLearnerOutstandingBalance = (learnerId: string, accountNo = "") => {
    const ledger = getAccountLedger(schoolIdForLedger, learnerId, accountNo);
    return calculateAccountBalance(ledger, learnerId, accountNo);
  };

  useEffect(() => {
    if (!schoolIdForLedger) return;
    syncBillingLedgerFromApi(schoolIdForLedger).catch(() => {});
    const refresh = () => loadBillingData();
    window.addEventListener(BILLING_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(BILLING_UPDATED_EVENT, refresh);
  }, [schoolIdForLedger]);
  
  
  
  const getLearnerLastPayment = (
  
  
  
    learnerId: string
  
  
  
  ) => {
  
  
  
    return calculateLastPayment(
  
  
  
      payments,
  
  
  
      learnerId
  
  
  
    );
  
  
  
  };

  const schoolName =



    props?.school?.name ||



    props?.selectedSchool?.name ||



    props?.schoolName ||



    "School";



  const schoolEmail =



    props?.school?.email ||



    props?.selectedSchool?.email ||



    props?.schoolEmail ||



    "";



  const schoolPhone =



    props?.school?.phone ||



    props?.selectedSchool?.phone ||



    props?.schoolPhone ||



    "";



  const schoolAddress =



    props?.school?.address ||



    props?.selectedSchool?.address ||



    props?.schoolAddress ||



    "";



  const money = (value: any) =>



    `R ${Number(value || 0).toLocaleString("en-ZA", {



      minimumFractionDigits: 2,



      maximumFractionDigits: 2,



    })}`;



  const readJson = (keys: string[], fallback: any) => {



    for (const key of keys) {



      try {



        const raw = localStorage.getItem(key);



        if (!raw) continue;



        const parsed = JSON.parse(raw);



        if (parsed) return parsed;



      } catch {}



    }



    return fallback;



  };



  const writeJson = (key: string, value: any) => {



    localStorage.setItem(key, JSON.stringify(value));



  };



  const toArray = (value: any) => {



    if (Array.isArray(value)) return value;



    if (Array.isArray(value?.data)) return value.data;



    if (Array.isArray(value?.learners)) return value.learners;



    if (Array.isArray(value?.parents)) return value.parents;



    if (Array.isArray(value?.accounts)) return value.accounts;



    if (Array.isArray(value?.items)) return value.items;



    return [];



  };



  const normalizedLearners = toArray(learners);



  const storedParents = toArray(



    readJson(



      [



        "educlearParents",



        "parents",



        "parentRecords",



        "educlearParentRecords",



        "educlearAccounts",



        "accounts",



      ],



      []



    )



  );



  const savedBillingPlans = readJson(["educlearBillingPlans"], {});



  const btn = {



    padding: "10px 14px",



    borderRadius: "10px",



    border: "1px solid #cbd5e1",



    background: "#ffffff",



    color: "#111827",



    fontSize: "13px",



    fontWeight: 900,



    cursor: "pointer",



  };



  const goldBtn = {



    ...btn,



    background: "linear-gradient(135deg, #f7d56a, #d4af37)",



    border: "1px solid #b89329",



    color: "#111827",



  };



  const dangerBtn = {



    ...btn,



    background: "#fee2e2",



    border: "1px solid #fecaca",



    color: "#991b1b",



  };



  const th = {



    padding: "11px",



    border: "1px solid #d8dee8",



    background: "#f8fafc",



    color: "#111827",



    fontSize: "12px",



    fontWeight: 900,



    textAlign: "left" as const,



  };



  const td = {



    padding: "10px 11px",



    border: "1px solid #e5eaf2",



    color: "#0f172a",



    fontSize: "13px",



  };



  const input = {



    width: "100%",



    padding: "10px",



    border: "1px solid #cbd5e1",



    borderRadius: "10px",



    background: "#ffffff",



    fontSize: "13px",



    color: "#111827",



  };



  const learnerFullName = (learner: any) =>



    `${learner?.firstName || learner?.name || ""} ${



      learner?.surname || learner?.lastName || ""



    }`.trim() || "Learner";



  const getLearnerBillingPlan = (learner: any) => {



    const saved = savedBillingPlans?.[learner?.id];



    if (Array.isArray(saved)) return saved;



    if (Array.isArray(learner?.billingPlan)) return learner.billingPlan;



    return [];



  };
  const findParent = (learner: any) => {



    const embedded =
  
  
  
      learner?.parent ||
  
  
  
      learner?.primaryParent ||
  
  
  
      learner?.guardian ||
  
  
  
      learner?.accountHolder ||
  
  
  
      (Array.isArray(learner?.parents) ? learner.parents[0] : null);
  
  
  
    if (embedded) return embedded;
  
  
  
    const learnerId = String(learner?.id || "");
  
  
  
    const learnerName = learnerFullName(learner).toLowerCase();
  
  
  
    return (
  
  
  
      storedParents.find((parent: any) => {
  
  
  
        const childIds = [
  
  
  
          parent?.learnerId,
  
  
  
          parent?.childId,
  
  
  
          parent?.studentId,
  
  
  
          parent?.child?.id,
  
  
  
          parent?.learner?.id,
  
  
  
          ...(Array.isArray(parent?.learnerIds) ? parent.learnerIds : []),
  
  
  
          ...(Array.isArray(parent?.children)
  
  
  
            ? parent.children.map((child: any) => child?.id)
  
  
  
            : []),
  
  
  
          ...(Array.isArray(parent?.learners)
  
  
  
            ? parent.learners.map((child: any) => child?.id)
  
  
  
            : []),
  
  
  
        ].map((x: any) => String(x || ""));
  
  
  
        const childNames = [
  
  
  
          parent?.learnerName,
  
  
  
          parent?.childName,
  
  
  
          parent?.studentName,
  
  
  
          parent?.child?.name,
  
  
  
          parent?.learner?.name,
  
  
  
          ...(Array.isArray(parent?.children)
  
  
  
            ? parent.children.map((child: any) => learnerFullName(child))
  
  
  
            : []),
  
  
  
          ...(Array.isArray(parent?.learners)
  
  
  
            ? parent.learners.map((child: any) => learnerFullName(child))
  
  
  
            : []),
  
  
  
        ].map((x: any) => String(x || "").toLowerCase().trim());
  
  
  
        return childIds.includes(learnerId) || childNames.includes(learnerName);
  
  
  
      }) || {}
  
  
  
    );
  
  
  
  };



  const selectedRows = normalizedLearners.map(



    (learner: any, index: number) => {



      const parent = findParent(learner);



      const fees = getLearnerBillingPlan(learner);



      const invoiceAmount = fees.reduce(



        (total: number, fee: any) =>



          total +



          Number(



            fee?.amount ||



              fee?.feeAmount ||



              fee?.monthlyAmount ||



              0



          ),



        0



      );



      const parentName =



        parent?.name ||



        parent?.fullName ||



        `${



          parent?.firstName || ""



        } ${parent?.surname || parent?.lastName || ""}`.trim() ||



        learner?.parentName ||



        learner?.guardianName ||



        "Parent / Guardian";



      const parentEmail =



        parent?.email ||



        parent?.parentEmail ||



        learner?.parentEmail ||



        learner?.guardianEmail ||



        "";



      return {



        id: learner?.id || index,



        learnerName: learnerFullName(learner),



        firstName:



          learner?.firstName || learner?.name || "",



        surname:



          learner?.surname || learner?.lastName || "",



        classroom:



          learner?.classroom ||



          learner?.className ||



          learner?.grade ||



          learner?.gradeName ||



          "Classroom",



        accountNo: getLearnerAccountNo(learner),



        parentName,



        parentEmail,



        invoiceNo: 65000 + index,



        statementNo: `ST${String(index + 1).padStart(



          4,



          "0"



        )}`,



        balance: getLearnerOutstandingBalance(
          learner.id || learner.learnerId,
          getLearnerAccountNo(learner)
        ),




        invoiceAmount,



        newBalance:

  getLearnerOutstandingBalance(
    learner.id || learner.learnerId,
    getLearnerAccountNo(learner)
  ) + invoiceAmount,



        status:



          invoiceAmount <= 0 ? "Paid" : "Unpaid",



        fees,



      };



    }



  );



  const selectedRun = readJson(



    ["educlearSelectedInvoiceRun"],



    null



  );



  const runRows = Array.isArray(selectedRun?.rows)



  ? selectedRun.rows.map((row: any) => {



      const fresh = selectedRows.find(



        (item: any) =>



          String(item.id) === String(row.id) ||



          String(item.learnerName).toLowerCase() ===



            String(row.learnerName).toLowerCase()



      );



      return fresh



        ? {



            ...row,



            parentName: fresh.parentName,



            parentEmail: fresh.parentEmail,



          }



        : row;



    })



  : selectedRows;



  const filteredRows = runRows.filter((row: any) => {



    if (!invoiceRunSearch) return true;



    const q = invoiceRunSearch.toLowerCase();



    return (



      String(row?.learnerName || "")



        .toLowerCase()



        .includes(q) ||



      String(row?.parentName || "")



        .toLowerCase()



        .includes(q) ||



      String(row?.accountNo || "")



        .toLowerCase()



        .includes(q)



    );



  });



  const paginatedRows = filteredRows.slice(



    (invoiceRunPage - 1) * 10,



    invoiceRunPage * 10



  );



  const runTotalPages = Math.max(



    1,



    Math.ceil(filteredRows.length / 10)



  );



  const runTotalAmount = runRows.reduce(



    (sum: number, row: any) =>



      sum + Number(row.invoiceAmount || 0),



    0



  );



  const saveRun = (run: any) => {



    const existingRuns = toArray(



      readJson(["educlearInvoiceRuns"], [])



    );



    const updatedRuns = existingRuns.some(



      (item: any) =>



        String(item.id) === String(run.id)



    )



      ? existingRuns.map((item: any) =>



          String(item.id) === String(run.id)



            ? run



            : item



        )



      : [run, ...existingRuns];



    writeJson("educlearInvoiceRuns", updatedRuns);



    setStoredRuns(updatedRuns);
    const schoolId = localStorage.getItem("schoolId") || "";
    appendInvoiceRunTransactions(run, schoolId);
    loadBillingData();


    writeJson("educlearSelectedInvoiceRun", run);



  };
  const createNewRun = (original = false) => {



    const now = new Date();



    const runMonthDate = new Date(



      now.getFullYear(),



      now.getMonth() + 1,



      1



    );



    const month = runMonthDate.toLocaleString("en-ZA", {



      month: "long",



      year: "numeric",



    });



    const run: any = {



      id: `RUN-${Date.now()}`,



      date: now.toISOString().slice(0, 10).replaceAll("-", "/"),



      month,



      period: month,



      invoiceDate: now.toISOString().slice(0, 10),



      dueDate: now.toISOString().slice(0, 10),



      invoiceMessage:



        "School fees to be paid in full by the 3rd of the month.\nPlease keep all receipts safe if there might be any enquiries.",



      rows: selectedRows,



      totalInvoices: selectedRows.length,



      totalAmount: selectedRows.reduce(



        (sum: number, row: any) =>



          sum + Number(row.invoiceAmount || 0),



        0



      ),



      original,



      createdAt: now.toISOString(),



    };



    run.description = `Invoice Run For ${month}`;



    saveRun(run);



    setInvoiceRunSettings((prev: any) => ({



      ...prev,



      month,



      description: run.description,



      invoiceDate: run.invoiceDate,



      dueDate: run.dueDate,



      message: run.invoiceMessage,



    }));



    setInvoiceRunView("wizardStart");



  };



  const openRun = (run: any) => {



    saveRun(run);



    setInvoiceRunSettings((prev: any) => ({



      ...prev,



      description:



        run.description ||



        `Invoice Run For ${run.month || run.period || ""}`,



      month: run.month || run.period || prev.month,



      invoiceDate: run.invoiceDate || prev.invoiceDate,



      dueDate: run.dueDate || prev.dueDate,



      message: run.invoiceMessage || prev.message,



    }));



    setInvoiceRunView("manage");



  };



  const updateCurrentRun = (patch: any) => {



    const current = readJson(



      ["educlearSelectedInvoiceRun"],



      null



    );



    if (!current) return;



    const updatedRows = Array.isArray(patch.rows)



      ? patch.rows



      : Array.isArray(current.rows)



        ? current.rows



        : runRows;



    const updated = {



      ...current,



      ...patch,



      rows: updatedRows,



      totalInvoices: updatedRows.length,



      totalAmount: updatedRows.reduce(



        (sum: number, row: any) =>



          sum + Number(row.invoiceAmount || 0),



        0



      ),



    };



    saveRun(updated);



  };



  const deleteCurrentRun = () => {



    const current = readJson(



      ["educlearSelectedInvoiceRun"],



      null



    );



    if (!current) {



      alert("No invoice run selected.");



      return;



    }



    if (!window.confirm("Delete this invoice run?")) return;



    const existingRuns = toArray(



      readJson(["educlearInvoiceRuns"], [])



    );



    const updatedRuns = existingRuns.filter(



      (item: any) =>



        String(item.id) !== String(current.id)



    );



    writeJson("educlearInvoiceRuns", updatedRuns);



    setStoredRuns(updatedRuns);



    localStorage.removeItem("educlearSelectedInvoiceRun");



    setInvoiceRunView("list");



  };



  const escapeHtml = (value: any) =>



    String(value ?? "")



      .replaceAll("&", "&amp;")



      .replaceAll("<", "&lt;")



      .replaceAll(">", "&gt;")



      .replaceAll('"', "&quot;")



      .replaceAll("'", "&#039;");



  const buildStatementHtml = (row: any) => {



    const period =



      invoiceRunSettings?.month ||



      selectedRun?.period ||



      selectedRun?.month ||



      "Selected period";



    const invoiceDate =



      invoiceRunSettings?.invoiceDate ||



      selectedRun?.invoiceDate ||



      new Date().toISOString().slice(0, 10);



    const dueDate =



      invoiceRunSettings?.dueDate ||



      selectedRun?.dueDate ||



      invoiceDate;



    return `



      <!doctype html>



      <html>



        <head>



          <meta charset="utf-8" />



          <title>Statement - ${escapeHtml(row.learnerName)}</title>



          <style>



            body {



              font-family: Arial, sans-serif;



              color: #111827;



              margin: 0;



              padding: 32px;



              background: #ffffff;



            }



            .header {



              display: flex;



              justify-content: space-between;



              border-bottom: 3px solid #d4af37;



              padding-bottom: 18px;



              margin-bottom: 24px;



            }



            .school-name {



              font-size: 26px;



              font-weight: 900;



              color: #111827;



              margin-bottom: 6px;



            }



            .muted {



              color: #6b7280;



              font-size: 12px;



              line-height: 1.5;



            }



            .title {



              text-align: right;



              font-size: 28px;



              font-weight: 900;



            }



            .grid {



              display: grid;



              grid-template-columns: 1fr 1fr;



              gap: 16px;



              margin-bottom: 20px;



            }



            .box {



              border: 1px solid #e5e7eb;



              border-radius: 12px;



              padding: 14px;



              background: #fafafa;



            }



            .box-title {



              font-size: 13px;



              font-weight: 900;



              margin-bottom: 8px;



              text-transform: uppercase;



            }



            table {



              width: 100%;



              border-collapse: collapse;



              margin-top: 12px;



            }



            th {



              background: #111827;



              color: #ffffff;



              padding: 10px;



              font-size: 12px;



              text-align: left;



            }



            td {



              border: 1px solid #e5e7eb;



              padding: 10px;



              font-size: 12px;



            }



            .totals {



              margin-top: 18px;



              display: flex;



              justify-content: flex-end;



            }



            .total-box {



              width: 320px;



              border: 2px solid #d4af37;



              border-radius:
               padding: 14px;



              background: #fffbeb;



            }



            .total-row {



              display: flex;



              justify-content: space-between;



              font-weight: 800;



              margin-bottom: 8px;



            }



            .closing {



              font-size: 18px;



              font-weight: 900;



              color: #991b1b;



            }



            .footer {



              margin-top: 32px;



              padding-top: 12px;



              border-top: 1px solid #e5e7eb;



              font-size: 11px;



              color: #6b7280;



              text-align: center;



            }



          </style>



        </head>



        <body>



          <div class="header">



            <div>



              <div class="school-name">${escapeHtml(schoolName)}</div>



              <div class="muted">



                ${escapeHtml(schoolAddress)}<br />



                ${escapeHtml(schoolEmail)}



                ${schoolPhone ? " | " + escapeHtml(schoolPhone) : ""}



              </div>



            </div>



            <div>



              <div class="title">STATEMENT</div>



              <div class="muted">



                Statement No: ${escapeHtml(row.statementNo)}<br />



                Period: ${escapeHtml(period)}<br />



                Date: ${escapeHtml(invoiceDate)}



              </div>



            </div>



          </div>



          <div class="grid">



            <div class="box">



              <div class="box-title">Learner Details</div>



              <div><b>Learner:</b> ${escapeHtml(row.learnerName)}</div>



              <div><b>Classroom:</b> ${escapeHtml(row.classroom)}</div>



              <div><b>Account No:</b> ${escapeHtml(row.accountNo)}</div>



            </div>



            <div class="box">



              <div class="box-title">Parent / Account Holder</div>



              <div><b>Parent:</b> ${escapeHtml(row.parentName)}</div>



              <div><b>Email:</b> ${escapeHtml(row.parentEmail)}</div>



              <div><b>Due Date:</b> ${escapeHtml(dueDate)}</div>



            </div>



          </div>



          <table>



            <thead>



              <tr>



                <th>Date</th>



                <th>Description</th>



                <th style="text-align:right;">Debit</th>



                <th style="text-align:right;">Credit</th>



                <th style="text-align:right;">Balance</th>



              </tr>



            </thead>



            <tbody>



              <tr>



                <td>${escapeHtml(invoiceDate)}</td>



                <td>Invoice Run - ${escapeHtml(period)}</td>



                <td style="text-align:right;">${money(row.invoiceAmount || 0)}</td>



                <td style="text-align:right;">${money(0)}</td>



                <td style="text-align:right;">${money(row.newBalance || 0)}</td>



              </tr>



            </tbody>



          </table>



          <div class="totals">



            <div class="total-box">



              <div class="total-row">



                <span>Previous Balance</span>



                <span>${money(row.balance || 0)}</span>



              </div>



              <div class="total-row">



                <span>Invoice Amount</span>



                <span>${money(row.invoiceAmount || 0)}</span>



              </div>



              <div class="total-row closing">



                <span>Closing Balance</span>



                <span>${money(row.newBalance || 0)}</span>



              </div>



            </div>



          </div>



          <div class="footer">



            This statement was generated by EduClear for ${escapeHtml(schoolName)}.



          </div>



        </body>



      </html>



    `;



  };



  const htmlToBase64 = (html: string) =>



    btoa(unescape(encodeURIComponent(html)));



  const openStatementPreview = () => {



    const validEmails = filteredRows.filter((row: any) => row.parentEmail);



    if (!validEmails.length) {



      alert("No parent emails found.");



      return;



    }



    setStatementEmailRows(validEmails);



    const firstLearner =



      validEmails.length === 1



        ? validEmails[0]?.learnerName || "Learner"



        : `${validEmails.length} Learners`;



    setStatementEmailSubject(`${schoolName} Statement - ${firstLearner}`);



    setStatementEmailMessage(



      `Dear Parent,



Please find attached the latest statement.



Kind regards,



${schoolName}`



    );



    setStatementEmailOpen(true);



  };



  const sendStatementEmails = async () => {



    if (!statementEmailRows.length) {



      alert("No statements selected.");



      return;



    }



    if (!statementEmailSubject.trim()) {



      alert("Please enter an email subject.");



      return;



    }



    setStatementEmailSending(true);



    try {



      for (const row of statementEmailRows) {



        const statementHtml = buildStatementHtml(row);



        const pdfBase64 = htmlToBase64(statementHtml);



        await fetch(`${API_URL}/emails/send-statement`, {



          method: "POST",



          headers: {



            "Content-Type": "application/json",



          },



          body: JSON.stringify({



            to: row.parentEmail,



            subject:



              statementEmailRows.length === 1



                ? statementEmailSubject



                : `${schoolName} Statement - ${row.learnerName}`,



            message: statementEmailMessage,



            learnerName: row.learnerName,



            parentName: row.parentName,



            statementNo: row.statementNo,



            pdfBase64,



            filename: `${row.learnerName || "learner"}-statement.html`,



          }),



        });



      }



      alert(`${statementEmailRows.length} statement email(s) sent.`);



      setStatementEmailOpen(false);



    } catch (error) {



      console.error(error);



      alert("Email sending failed. Please check the backend email endpoint.");



    } finally {



      setStatementEmailSending(false);



    }



  };



  const stepNames = [



    "Start",



    "Settings",



    "Children",



    "Fees",



    "Preview",



    "Create Invoices",



    "Summary",



    "Finish",



  ];
  const Stepper = ({ step }: { step: number }) => (



    <div style={{ padding: "18px 10px 26px" }}>



      <div



        style={{



          display: "grid",



          gridTemplateColumns: "repeat(8, 1fr)",



          alignItems: "center",



        }}



      >



        {stepNames.map((name, index) => {



          const n = index + 1;



          const done = n < step;



          const active = n === step;



          return (



            <div



              key={name}



              style={{ textAlign: "center", position: "relative" }}



            >



              {index > 0 && (



                <div



                  style={{



                    position: "absolute",



                    top: 20,



                    left: "-50%",



                    width: "100%",



                    height: 4,



                    background: n <= step ? "#2563eb" : "#cbd5e1",



                    zIndex: 0,



                  }}



                />



              )}



              <div



                style={{



                  width: 42,



                  height: 42,



                  borderRadius: 999,



                  margin: "0 auto",



                  display: "grid",



                  placeItems: "center",



                  position: "relative",



                  zIndex: 1,



                  border: `4px solid ${



                    done || active ? "#2563eb" : "#cbd5e1"



                  }`,



                  background: done ? "#dcfce7" : "#ffffff",



                  color: done ? "#15803d" : "#334155",



                  fontWeight: 950,



                }}



              >



                {done ? "✓" : n}



              </div>



              <div



                style={{



                  marginTop: 8,



                  fontSize: 13,



                  fontWeight: 800,



                  color: "#334155",



                }}



              >



                {name}



              </div>



            </div>



          );



        })}



      </div>



    </div>



  );



  const saveSettingsToCurrentRun = () => {



    const current = readJson(



      ["educlearSelectedInvoiceRun"],



      selectedRun



    );



    if (!current) return;



    const updatedMonth =



      invoiceRunSettings.month ||



      current.month ||



      current.period ||



      "";



    saveRun({



      ...current,



      description: `Invoice Run For ${updatedMonth}`,



      month: updatedMonth,



      period: updatedMonth,



      invoiceDate:



        invoiceRunSettings.invoiceDate ||



        current.invoiceDate ||



        "",



      dueDate:



        invoiceRunSettings.dueDate ||



        current.dueDate ||



        "",



      invoiceMessage:



        invoiceRunSettings.message ||



        current.invoiceMessage ||



        "",



      rows: Array.isArray(current.rows)



        ? current.rows



        : runRows,



    });



  };



  const WizardShell = ({



    step,



    title,



    description,



    previous,



    next,



    nextLabel = "Next ➜",



    children,



  }: any) => (



    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>



      <h1 className="page-title">



        Invoice Run{" "}



        <span style={{ color: "#64748b", fontSize: 18 }}>



          » Perform a new invoice run



        </span>



      </h1>



      <Stepper step={step} />



      <div



        style={{



          display: "flex",



          justifyContent: "space-between",



          gap: 10,



        }}



      >



        <button



          style={btn}



          onClick={() => setInvoiceRunView(previous || "list")}



        >



          ← Previous



        </button>



        <button



          style={btn}



          onClick={() => {



            if (step === 2) saveSettingsToCurrentRun();



            setInvoiceRunView(next);



          }}



        >



          {nextLabel}



        </button>



      </div>



      <div



        style={{



          border: "1px solid #d8dee8",



          background: "#ffffff",



          padding: 24,



          borderRadius: 14,



          textAlign: "center",



        }}



      >



        <h2 style={{ margin: 0, color: "#2563eb", fontWeight: 800 }}>



          {title}



        </h2>



        <p style={{ color: "#334155", fontWeight: 600 }}>



          {description}



        </p>



      </div>



      {children}



    </div>



  );



  if (invoiceRunView === "wizardStart") {



    return (



      <WizardShell



        step={1}



        title="Start"



        description="You are about to start the invoice run wizard. Choose from one of the options below to get started."



        previous="list"



        next="wizardSettings"



      >



        <div



          style={{



            padding: "14px 18px",



            background: "#dbeafe",



            border: "1px solid #bfdbfe",



            color: "#1e3a8a",



            fontWeight: 700,



            borderRadius: 10,



          }}



        >



          <b>New!</b> As you can see we have enhanced the invoice run process to



          give you more flexibility.



        </div>



        <div



          style={{



            maxWidth: 680,



            margin: "0 auto",



            display: "grid",



            gap: 18,



          }}



        >



          <div



            style={{



              border: "1px solid #d8dee8",



              borderRadius: 12,



              background: "#ffffff",



              padding: 20,



              display: "grid",



              gridTemplateColumns: "1fr 170px",



              gap: 18,



              alignItems: "start",



            }}



          >



            <div>



              <h2 style={{ color: "#2563eb", marginTop: 0 }}>



                Standard



              </h2>



              <div



                style={{



                  fontWeight: 900,



                  color: "#64748b",



                  marginBottom: 10,



                }}



              >



                All Children + Billing Plan Fees



              </div>



              <ul



                style={{



                  marginTop: 0,



                  color: "#334155",



                  lineHeight: 1.6,



                }}



              >



                <li>



                  All enrolled children will be selected for this invoice run.



                </li>



                <li>



                  The fees on each child&apos;s billing plan will be used for



                  each invoice.



                </li>



                <li>



                  You will have the option to add extra fees to all invoices.



                </li>



              </ul>



            </div>



            <button



              style={goldBtn}



              onClick={() => setInvoiceRunView("wizardSettings")}



            >



              This one!



            </button>



          </div>



        </div>



      </WizardShell>



    );



  }
  if (invoiceRunView === "wizardSettings") {



    return (



      <WizardShell



        step={2}



        title="Settings"



        description="Please fill in the required settings for this invoice run and then click on Next to continue."



        previous="wizardStart"



        next="wizardChildren"



      >



        <div



          style={{



            maxWidth: 720,



            margin: "0 auto",



            border: "1px solid #d8dee8",



            background: "#ffffff",



            borderRadius: 14,



            padding: 22,



          }}



        >



          <div



            style={{



              display: "grid",



              gridTemplateColumns: "180px 1fr",



              gap: 12,



              alignItems: "start",



            }}



          >



            <label style={{ fontWeight: 900, color: "#334155" }}>



              * Description



            </label>



            <input



              style={input}



              value={`Invoice Run For ${invoiceRunSettings.month || ""}`}



              readOnly



            />



            <label style={{ fontWeight: 900, color: "#334155" }}>



              * Date On Invoices



            </label>



            <input



              type="date"



              style={input}



              defaultValue={invoiceRunSettings.invoiceDate || ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  invoiceDate: e.target.value,



                })



              }



            />



            <label style={{ fontWeight: 900, color: "#334155" }}>



              * Due Date On Invoices



            </label>



            <input



              type="date"



              style={input}



              defaultValue={invoiceRunSettings.dueDate || ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  dueDate: e.target.value,



                })



              }



            />



            <label style={{ fontWeight: 900, color: "#334155" }}>



              * For The Month Of



            </label>



            <input



              style={input}



              defaultValue={invoiceRunSettings.month ?? ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  month: e.target.value,



                  description: `Invoice Run For ${e.target.value}`,



                })



              }



            />



            <label style={{ fontWeight: 900, color: "#334155" }}>



              Message On Invoices



            </label>



            <textarea



              style={{ ...input, minHeight: 170, resize: "vertical" }}



              defaultValue={invoiceRunSettings.message || ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  message: e.target.value,



                })



              }



            />



          </div>



        </div>



      </WizardShell>



    );



  }



  if (invoiceRunView === "wizardChildren") {



    return (



      <WizardShell



        step={3}



        title="Children"



        description="The following children are selected to be invoiced. You can add and remove children as you wish. Once you are happy click on Next to continue."



        previous="wizardSettings"



        next="wizardFees"



      >



        <div



          style={{



            border: "1px solid #d8dee8",



            background: "#ffffff",



            borderRadius: 14,



            overflow: "hidden",



          }}



        >



          <div style={{ padding: 12, display: "flex", gap: 10 }}>



            <button



              style={goldBtn}



              onClick={() =>



                alert("All enrolled children are already included.")



              }



            >



              + Add



            </button>



            <button



              style={goldBtn}



              onClick={() => alert("Auto Add completed.")}



            >



              + Auto Add



            </button>



          </div>



          {runRows.length === 0 ? (



            <div



              style={{



                padding: 30,



                textAlign: "center",



                color: "#991b1b",



                fontWeight: 900,



              }}



            >



              No learners found for this invoice run.



            </div>



          ) : (



            <table style={{ width: "100%", borderCollapse: "collapse" }}>



              <thead>



                <tr>



                  <th style={th}>Account No</th>



                  <th style={th}>Name</th>



                  <th style={th}>Surname</th>



                  <th style={th}>Classroom / Group</th>



                  <th style={{ ...th, textAlign: "right" }}>Balance</th>



                  <th style={th}>Last Invoice</th>



                  <th style={th}>Account Status</th>



                  <th style={th}></th>



                </tr>



              </thead>



              <tbody>



                {runRows.map((row: any, index: number) => (



                  <tr



                    key={String(row.id || index)}



                    style={{



                      background:



                        index % 2 === 0



                          ? "#ffffff"



                          : "rgba(212,175,55,0.05)",



                    }}



                  >



                    <td style={td}>{row.accountNo}</td>



                    <td style={td}>{row.firstName || row.learnerName}</td>



                    <td style={td}>{row.surname || ""}</td>



                    <td style={td}>{row.classroom}</td>



                    <td style={{ ...td, textAlign: "right" }}>



                    {money(getLearnerOutstandingBalance(row.id || row.learnerId, row.accountNo || getLearnerAccountNo(row)))}



                    </td>



                    <td style={td}>



                      {money(row.invoiceAmount)} on{" "}



                      {invoiceRunSettings.invoiceDate || selectedRun?.invoiceDate}



                    </td>



                    <td



                      style={{



                        ...td,



                        fontWeight: 900,



                        color:



                          row.balance < 0



                            ? "#15803d"



                            : row.balance > 5000



                              ? "#b91c1c"



                              : "#ca8a04",



                      }}



                    >



                      {row.balance < 0



                        ? "Over Paid"



                        : row.balance > 5000



                          ? "Bad Debt"



                          : "Recently Owing"}



                    </td>



                    <td style={td}>



                      <button



                        style={dangerBtn}



                        onClick={() => {



                          const current = readJson(



                            ["educlearSelectedInvoiceRun"],



                            selectedRun



                          );



                          const rows = (



                            Array.isArray(current?.rows)



                              ? current.rows



                              : runRows



                          ).filter(



                            (item: any) => String(item.id) !== String(row.id)



                          );



                          updateCurrentRun({ rows });



                        }}



                      >



                        ×



                      </button>



                    </td>



                  </tr>



                ))}



              </tbody>



            </table>



          )}



        </div>



      </WizardShell>



    );



  }
  if (invoiceRunView === "wizardFees") {



    return (



      <WizardShell



        step={4}



        title="Fees"



        description="The fees on each child's billing plan will be used for each of the invoices. If you would like to add any extra fees on to all of the invoices click on Add Extra Fees below. Click on Next to continue."



        previous="wizardChildren"



        next="wizardPreview"



      >



        <div style={{ maxWidth: 720, margin: "0 auto" }}>



          <button



            style={{ ...btn, width: "100%", padding: 14 }}



            onClick={() => {



              const description = window.prompt("Extra fee description:");



              if (!description) return;



              const amount = Number(window.prompt("Extra fee amount:") || 0);



              if (!amount || amount <= 0) {



                alert("Please enter a valid amount.");



                return;



              }



              const current = readJson(["educlearSelectedInvoiceRun"], selectedRun);



              const rows = (Array.isArray(current?.rows) ? current.rows : runRows).map(



                (row: any) => {



                  const extraFee = {



                    id: `extra-${Date.now()}`,



                    description,



                    name: description,



                    type: "EXTRA",



                    amount,



                  };



                  const fees = Array.isArray(row.fees)



                    ? [...row.fees, extraFee]



                    : [extraFee];



                  const invoiceAmount = fees.reduce(



                    (sum: number, fee: any) => sum + Number(fee.amount || 0),



                    0



                  );



                  return {



                    ...row,



                    fees,



                    invoiceAmount,



                    newBalance: Number(row.balance || 0) + invoiceAmount,



                    status: invoiceAmount <= 0 ? "Paid" : "Unpaid",



                  };



                }



              );



              updateCurrentRun({ rows });



              alert("Extra fee added to all invoices.");



            }}



          >



            Add Extra Fees



          </button>



        </div>



      </WizardShell>



    );



  }



  if (invoiceRunView === "wizardPreview") {



    return (



      <WizardShell



        step={5}



        title="Preview"



        description={`An invoice WILL be made for the following ${runRows.length} children. You can also see what they will be charged for. If you are happy with this click on Next to continue.`}



        previous="wizardFees"



        next="wizardCreate"



      >



        <div



          style={{



            border: "1px solid #d8dee8",



            background: "#ffffff",



            borderRadius: 14,



            overflow: "hidden",



          }}



        >



          {runRows.length === 0 ? (



            <div



              style={{



                padding: 30,



                textAlign: "center",



                color: "#991b1b",



                fontWeight: 900,



              }}



            >



              No learners found. Go back and make sure learners are loaded.



            </div>



          ) : (



            <table style={{ width: "100%", borderCollapse: "collapse" }}>



              <thead>



                <tr>



                  <th style={th}>Account No</th>



                  <th style={th}>Name</th>



                  <th style={th}>Surname</th>



                  <th style={th}>Classroom / Group</th>



                  <th style={{ ...th, textAlign: "right" }}>Balance</th>



                  <th style={{ ...th, textAlign: "center" }}>Items</th>



                  <th style={{ ...th, textAlign: "right" }}>Invoice</th>



                  <th style={{ ...th, textAlign: "right" }}>New Balance</th>



                </tr>



              </thead>



              <tbody>



                {runRows.map((row: any, index: number) => (



                  <tr



                    key={String(row.id || index)}



                    style={{



                      background:



                        index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.05)",



                    }}



                  >



                    <td style={td}>{row.accountNo}</td>



                    <td style={td}>{row.firstName || row.learnerName}</td>



                    <td style={td}>{row.surname || ""}</td>



                    <td style={td}>{row.classroom}</td>



                    <td style={{ ...td, textAlign: "right" }}>{money(getLearnerOutstandingBalance(row.id || row.learnerId, row.accountNo || getLearnerAccountNo(row)))}</td>



                    <td style={{ ...td, textAlign: "center" }}>



                      {Array.isArray(row.fees) ? row.fees.length : 0} 👁



                    </td>



                    <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>



                      {money(row.invoiceAmount)}



                    </td>



                    <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>



                      {money(row.newBalance)}



                    </td>



                  </tr>



                ))}



              </tbody>



            </table>



          )}



        </div>



      </WizardShell>



    );



  }
  if (invoiceRunView === "wizardCreate") {



    return (



      <WizardShell



        step={6}



        title="Create Invoices"



        description="You are now ready to create invoices! When you click on Next invoices will be made."



        previous="wizardPreview"



        next="wizardSummary"



      >



        <div



          style={{



            maxWidth: 620,



            margin: "0 auto",



            padding: 22,



            borderRadius: 14,



            border: "1px solid rgba(212,175,55,0.45)",



            background: "rgba(212,175,55,0.08)",



            textAlign: "center",



            fontWeight: 800,



            color: "#0f172a",



          }}



        >



          Ready to create {runRows.length} invoices with a total value of{" "}



          <span style={{ color: "#b45309", fontWeight: 950 }}>



            {money(runTotalAmount)}



          </span>



          .



        </div>



      </WizardShell>



    );



  }



  if (invoiceRunView === "wizardSummary") {



    return (



      <WizardShell



        step={7}



        title="Summary"



        description={`Invoice run completed successfully! A total of ${runRows.length} invoices were created. Below you can see a list of these invoices.`}



        previous="wizardCreate"



        next="wizardFinish"



      >



        <div



          style={{



            border: "1px solid #d8dee8",



            background: "#ffffff",



            borderRadius: 14,



            overflow: "hidden",



          }}



        >



          {runRows.length === 0 ? (



            <div



              style={{



                padding: 30,



                textAlign: "center",



                color: "#991b1b",



                fontWeight: 900,



              }}



            >



              No invoices were created because no learners were found.



            </div>



          ) : (



            <table style={{ width: "100%", borderCollapse: "collapse" }}>



              <thead>



                <tr>



                  <th style={th}>Invoice No</th>



                  <th style={th}>Date</th>



                  <th style={th}>Children</th>



                  <th style={th}>Parents</th>



                  <th style={{ ...th, textAlign: "right" }}>Amount</th>



                </tr>



              </thead>



              <tbody>



                {runRows.map((row: any, index: number) => (



                  <tr



                    key={String(row.id || index)}



                    style={{



                      background:



                        index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.05)",



                    }}



                  >



                    <td style={td}>{row.invoiceNo}</td>



                    <td style={td}>



                      {invoiceRunSettings.invoiceDate || selectedRun?.invoiceDate}



                    </td>



                    <td style={td}>{row.learnerName}</td>



                    <td style={td}>{row.parentName}</td>



                    <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>



                      {money(row.invoiceAmount)}



                    </td>



                  </tr>



                ))}



              </tbody>



            </table>



          )}



        </div>



      </WizardShell>



    );



  }



  if (invoiceRunView === "wizardFinish") {



    return (



      <WizardShell



        step={8}



        title="Finish"



        description="You have now finished your invoice run! You may find the shortcut buttons and explanations below helpful."



        previous="wizardSummary"



        next="list"



        nextLabel="Finish"



      >



        <div



          style={{



            maxWidth: 760,



            margin: "0 auto",



            display: "grid",



            gap: 18,



          }}



        >



          <div



            style={{



              border: "1px solid #d8dee8",



              borderRadius: 12,



              background: "#ffffff",



              padding: 22,



              display: "grid",



              gridTemplateColumns: "1fr 190px",



              gap: 18,



              alignItems: "center",



            }}



          >



            <div>



              <h2 style={{ color: "#2563eb", marginTop: 0 }}>Email</h2>



              <ul



                style={{



                  color: "#334155",



                  lineHeight: 1.6,



                  marginBottom: 0,



                }}



              >



                <li>



                  Choose one of these options to email invoices and / or



                  statements to parents.



                </li>



                <li>You will be able to review the mail before sending.</li>



                <li>



                  You can also do this later by going to Billing ➜ Invoice Runs.



                </li>



              </ul>



            </div>



            <div style={{ display: "grid", gap: 8 }}>



              <button



                style={btn}



                onClick={() => setInvoiceRunView("emailInvoices")}



              >



                Email Invoices



              </button>



              <button



                style={btn}



                onClick={() => setInvoiceRunView("emailStatements")}



              >



                Email Statements



              </button>



              <button



                style={btn}



                onClick={() => setInvoiceRunView("emailBoth")}



              >



                Email Both



              </button>



            </div>



          </div>



        </div>



      </WizardShell>



    );



  }
  if (



    invoiceRunView === "emailInvoices" ||



    invoiceRunView === "emailStatements" ||



    invoiceRunView === "emailBoth"



  ) {



    const emailTitle =



      invoiceRunView === "emailInvoices"



        ? "Email Invoices"



        : invoiceRunView === "emailStatements"



          ? "Email Statements"



          : "Email Invoices & Statements";



    return (



      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>



        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>



          <div>



            <h1 className="page-title">{emailTitle}</h1>



            <div style={{ fontSize: 13, color: "#64748b" }}>



              Review recipients before sending.



            </div>



          </div>



          <div style={{ display: "flex", gap: 10 }}>



            <button style={btn} onClick={() => setInvoiceRunView("manage")}>



              ← Back



            </button>



            <button style={goldBtn} onClick={openStatementPreview}>



              Send Emails



            </button>



          </div>



        </div>



        <div



          className="premium-card"



          style={{ padding: 20, borderRadius: 20, background: "#ffffff" }}



        >



          <table style={{ width: "100%", borderCollapse: "collapse" }}>



            <thead>



              <tr>



                <th style={th}>Parent</th>



                <th style={th}>Learner</th>



                <th style={th}>Email</th>



                <th style={th}>Documents</th>



                <th style={th}>Status</th>



              </tr>



            </thead>



            <tbody>



              {filteredRows.map((row: any, index: number) => (



                <tr



                  key={String(row.id || index)}



                  style={{



                    background:



                      index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.05)",



                  }}



                >



                  <td style={td}>{row.parentName}</td>



                  <td style={td}>{row.learnerName}</td>



                  <td style={td}>{row.parentEmail || "Missing Email"}</td>



                  <td style={td}>



                    {invoiceRunView === "emailInvoices" &&



                      `Invoice #${row.invoiceNo}`}



                    {invoiceRunView === "emailStatements" &&



                      `Statement #${row.statementNo}`}



                    {invoiceRunView === "emailBoth" &&



                      `Invoice #${row.invoiceNo} + Statement #${row.statementNo}`}



                  </td>



                  <td



                    style={{



                      ...td,



                      fontWeight: 900,



                      color: row.parentEmail ? "#15803d" : "#b91c1c",



                    }}



                  >



                    {row.parentEmail ? "Ready" : "Missing Email"}



                  </td>



                </tr>



              ))}



            </tbody>



          </table>



        </div>



        {statementEmailOpen && (



          <div



            style={{



              position: "fixed",



              inset: 0,



              background: "rgba(0,0,0,0.65)",



              display: "flex",



              alignItems: "center",



              justifyContent: "center",



              zIndex: 9999,



              padding: 20,



            }}



          >



            <div



              style={{



                width: "100%",



                maxWidth: 900,



                background: "#ffffff",



                borderRadius: 20,



                padding: 24,



                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",



              }}



            >



              <h2 style={{ marginTop: 0 }}>Email Statements</h2>



              <input



                value={statementEmailSubject}



                onChange={(e) => setStatementEmailSubject(e.target.value)}



                style={{ ...input, marginBottom: 12 }}



              />



              <textarea



                value={statementEmailMessage}



                onChange={(e) => setStatementEmailMessage(e.target.value)}



                rows={9}



                style={{ ...input, minHeight: 180, resize: "vertical" }}



              />



              <div



                style={{



                  marginTop: 16,



                  display: "flex",



                  justifyContent: "space-between",



                  alignItems: "center",



                }}



              >



                <strong>{statementEmailRows.length} statement(s) selected</strong>



                <div style={{ display: "flex", gap: 10 }}>



                  <button



                    type="button"



                    style={btn}



                    onClick={() => setStatementEmailOpen(false)}



                    disabled={statementEmailSending}



                  >



                    Cancel



                  </button>



                  <button



                    type="button"



                    style={goldBtn}



                    onClick={sendStatementEmails}



                    disabled={statementEmailSending}



                  >



                    {statementEmailSending ? "Sending..." : "Send Statements"}



                  </button>



                </div>



              </div>



            </div>



          </div>



        )}



      </div>



    );



  }
  if (invoiceRunView === "printInvoices" || invoiceRunView === "printStatements") {



    const isInvoices = invoiceRunView === "printInvoices";



    return (



      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>



        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>



          <div>



            <h1 className="page-title">



              {isInvoices ? "Print Invoices" : "Print Statements"}



            </h1>



            <div style={{ fontSize: 13, color: "#64748b" }}>



              Preview batch before printing.



            </div>



          </div>



          <div style={{ display: "flex", gap: 10 }}>



            <button style={btn} onClick={() => setInvoiceRunView("manage")}>



              ← Back



            </button>



            <button style={goldBtn} onClick={() => window.print()}>



              View / Print



            </button>



          </div>



        </div>



        <div



          className="premium-card"



          style={{ padding: 20, borderRadius: 20, background: "#ffffff" }}



        >



          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 18 }}>



            {isInvoices ? "Invoices In This Run" : "Statements In This Run"}



          </div>



          {filteredRows.length === 0 ? (



            <div



              style={{



                padding: 30,



                textAlign: "center",



                color: "#991b1b",



                fontWeight: 900,



              }}



            >



              No records found to print.



            </div>



          ) : (



            <table style={{ width: "100%", borderCollapse: "collapse" }}>



              <thead>



                <tr>



                  <th style={th}>Account No</th>



                  <th style={th}>{isInvoices ? "Invoice No" : "Statement No"}</th>



                  <th style={th}>Learner</th>



                  <th style={th}>Parent</th>



                  <th style={{ ...th, textAlign: "right" }}>Amount</th>



                  <th style={th}>Status</th>



                </tr>



              </thead>



              <tbody>



                {filteredRows.map((row: any, index: number) => (



                  <tr



                    key={String(row.id || index)}



                    style={{



                      background:



                        index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.05)",



                    }}



                  >



                    <td style={td}>{row.accountNo}</td>



                    <td style={td}>{isInvoices ? row.invoiceNo : row.statementNo}</td>



                    <td style={td}>{row.learnerName}</td>



                    <td style={td}>{row.parentName}</td>



                    <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>



                      {money(row.invoiceAmount)}



                    </td>



                    <td



                      style={{



                        ...td,



                        fontWeight: 900,



                        color: row.status === "Paid" ? "#15803d" : "#b91c1c",



                      }}



                    >



                      {row.status}



                    </td>



                  </tr>



                ))}



              </tbody>



            </table>



          )}



        </div>



      </div>



    );



  }



  if (invoiceRunView === "manage") {



    const run = selectedRun || {



      description: invoiceRunSettings.description || "Invoice Run",



      invoiceMessage: invoiceRunSettings.message || "",



      month: invoiceRunSettings.month || "",



      period: invoiceRunSettings.month || "",



      invoiceDate: invoiceRunSettings.invoiceDate || "",



      dueDate: invoiceRunSettings.dueDate || "",



      rows: runRows,



    };



    return (



      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>



        <h1 className="page-title">



          Invoice Run{" "}



          <span style={{ color: "#64748b", fontSize: 18 }}>



            » Manage an invoice run



          </span>



        </h1>



        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>



          <button style={btn} onClick={() => setInvoiceRunView("list")}>



            ← Back



          </button>



          <button



            style={goldBtn}



            onClick={() => {



              const updatedMonth =



                invoiceRunSettings.month ||



                run.month ||



                run.period ||



                "this period";



              const updatedRun = {



                ...run,



                description: `Invoice Run For ${updatedMonth}`,



                month: updatedMonth,



                period: updatedMonth,



                invoiceDate: invoiceRunSettings.invoiceDate || run.invoiceDate,



                dueDate: invoiceRunSettings.dueDate || run.dueDate,



                invoiceMessage: invoiceRunSettings.message || run.invoiceMessage,



                rows: runRows,



                totalInvoices: runRows.length,



                totalAmount: runTotalAmount,



              };



              saveRun(updatedRun);



              alert("Invoice run saved.");



            }}



          >



            💾 Save



          </button>



          <select



            style={btn}



            defaultValue=""



            onChange={(e) => {



              const value = e.target.value;



              if (!value) return;



              if (value === "emailInvoices") setInvoiceRunView("emailInvoices");



              if (value === "emailStatements") setInvoiceRunView("emailStatements");



              if (value === "emailBoth") setInvoiceRunView("emailBoth");



              if (value === "printInvoices") setInvoiceRunView("printInvoices");



              if (value === "printStatements") setInvoiceRunView("printStatements");



              if (value === "delete") deleteCurrentRun();



              e.currentTarget.value = "";



            }}



          >



            <option value="">More Actions</option>



            <option value="emailInvoices">Email Invoices</option>



            <option value="emailStatements">Email Statements</option>



            <option value="emailBoth">Email Both</option>



            <option value="printInvoices">Print Invoices</option>



            <option value="printStatements">Print Statements</option>



            <option value="delete">Undo / Delete</option>



          </select>



        </div>



        <div



          className="premium-card"



          style={{



            background: "#ffffff",



            border: "1px solid #d8dee8",



            borderRadius: 16,



            overflow: "hidden",



          }}



        >



          <div



            style={{



              padding: "12px 16px",



              background: "#f8fafc",



              borderBottom: "1px solid #d8dee8",



              fontWeight: 900,



            }}



          >



            Invoice Run



          </div>



          <div



            style={{



              padding: 18,



              display: "grid",



              gridTemplateColumns: "220px 1fr",



              gap: 12,



            }}



          >



            <label style={{ fontWeight: 900 }}>* Description</label>



            <input



              style={input}



              value={`Invoice Run For ${



                invoiceRunSettings.month ||



                selectedRun?.month ||



                selectedRun?.period ||



                ""



              }`}



              readOnly



            />



            <label style={{ fontWeight: 900 }}>* Date On Invoices</label>



            <input



              type="date"



              style={input}



              defaultValue={invoiceRunSettings.invoiceDate || run.invoiceDate || ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  invoiceDate: e.target.value,



                })



              }



            />



            <label style={{ fontWeight: 900 }}>* Due Date On Invoices</label>



            <input



              type="date"



              style={input}



              defaultValue={invoiceRunSettings.dueDate || run.dueDate || ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  dueDate: e.target.value,



                })



              }



            />



            <label style={{ fontWeight: 900 }}>* For The Month Of</label>



            <input



              style={input}



              defaultValue={invoiceRunSettings.month ?? ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  month: e.target.value,



                  description: `Invoice Run For ${e.target.value}`,



                })



              }



            />



            <label style={{ fontWeight: 900 }}>Total Count</label>



            <input style={input} value={runRows.length} readOnly />



            <label style={{ fontWeight: 900 }}>Total Amount</label>



            <input style={input} value={money(runTotalAmount)} readOnly />



            <label style={{ fontWeight: 900 }}>Invoice Message</label>



            <textarea



              style={{ ...input, minHeight: 110, resize: "vertical" }}



              defaultValue={invoiceRunSettings.message || run.invoiceMessage || ""}



              onBlur={(e) =>



                setInvoiceRunSettings({



                  ...invoiceRunSettings,



                  message: e.target.value,



                })



              }



            />



          </div>



        </div>



        <div



          className="premium-card"



          style={{



            background: "#ffffff",



            border: "1px solid #d8dee8",



            borderRadius: 16,



            overflow: "hidden",



          }}



        >



          <div



            style={{



              padding: "12px 16px",



              background: "#f8fafc",



              borderBottom: "1px solid #d8dee8",



              fontWeight: 900,



            }}



          >



            Invoices



          </div>



          <div



            style={{



              padding: 12,



              display: "flex",



              justifyContent: "space-between",



              gap: 12,



            }}



          >



            <button



              style={btn}



              onClick={() =>



                alert("Invoice manage will open from selected invoice row.")



              }



            >



              ✎ Manage



            </button>



            <input



              value={invoiceRunSearch}



              onChange={(e) => {



                setInvoiceRunSearch(e.target.value);



                setInvoiceRunPage(1);



              }}



              placeholder="Search"



              style={{ ...input, width: 260 }}



            />



          </div>



          {paginatedRows.length === 0 ? (



            <div



              style={{



                padding: 30,



                textAlign: "center",



                color: "#991b1b",



                fontWeight: 900,



              }}



            >



              No invoices found for this run.



            </div>



          ) : (



            <table style={{ width: "100%", borderCollapse: "collapse" }}>



              <thead>



                <tr>



                  <th style={th}>Account No</th>



                  <th style={th}>Invoice No</th>



                  <th style={th}>Date</th>



                  <th style={th}>Children</th>



                  <th style={{ ...th, textAlign: "right" }}>Amount</th>



                  <th style={th}>Invoice Status</th>



                </tr>



              </thead>



              <tbody>



                {paginatedRows.map((row: any, index: number) => (



                  <tr



                    key={String(row.id || index)}



                    style={{



                      background:



                        index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.05)",



                    }}



                  >



                    <td style={td}>{row.accountNo}</td>



                    <td style={td}>{row.invoiceNo}</td>



                    <td style={td}>{invoiceRunSettings.invoiceDate || run.invoiceDate}</td>



                    <td style={td}>{row.learnerName}</td>



                    <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>



                      {money(row.invoiceAmount)}



                    </td>



                    <td



                      style={{



                        ...td,



                        color: row.status === "Paid" ? "#15803d" : "#b91c1c",



                        fontWeight: 900,



                      }}



                    >



                      {row.status}



                    </td>



                  </tr>



                ))}



              </tbody>



            </table>



          )}



          <div



            style={{



              padding: "12px 16px",



              display: "flex",



              justifyContent: "space-between",



              borderTop: "1px solid #e5e7eb",



            }}



          >



            <span style={{ color: "#64748b", fontSize: 13 }}>



              Page {invoiceRunPage} / {runTotalPages}



            </span>



            <div style={{ display: "flex", gap: 8 }}>



              <button



                style={btn}



                onClick={() =>



                  setInvoiceRunPage((p: number) => Math.max(1, p - 1))



                }



              >



                ‹



              </button>



              <button style={{ ...goldBtn, padding: "8px 12px" }}>



                {invoiceRunPage}



              </button>



              <button



                style={btn}



                onClick={() =>



                  setInvoiceRunPage((p: number) => Math.min(runTotalPages, p + 1))



                }



              >



                ›



              </button>



            </div>



          </div>



        </div>



      </div>



    );



  }



  const visibleRuns = toArray(storedRuns);



  return (



    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>



      <h1 className="page-title">



        Invoice Runs{" "}



        <span style={{ color: "#64748b", fontSize: 18 }}>



          » View previous invoice runs or perform a new one



        </span>



      </h1>



      <div



        style={{



          padding: "14px 18px",



          background: "#dbeafe",



          border: "1px solid #bfdbfe",



          color: "#1e3a8a",



          fontWeight: 700,



          borderRadius: 10,



        }}



      >



        <b>New!</b> We have enhanced the invoice run process to give you more



        flexibility.



      </div>



      <div



        className="premium-card"



        style={{



          background: "#ffffff",



          border: "1px solid #d8dee8",



          borderRadius: 16,



          overflow: "hidden",



        }}



      >



        <div



          style={{



            padding: "12px 16px",



            background: "#f8fafc",



            borderBottom: "1px solid #d8dee8",



            fontWeight: 900,



          }}



        >



          Invoice Runs



        </div>



        <div style={{ padding: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>



          <button style={goldBtn} onClick={() => createNewRun(false)}>



            + Add



          </button>



          <button style={goldBtn} onClick={() => createNewRun(true)}>



            + Add Original



          </button>



          <button



            style={btn}



            onClick={() => {



              if (!visibleRuns[0]) {



                alert("No invoice run selected.");



                return;



              }



              openRun(visibleRuns[0]);



            }}



          >



            ✎ Manage



          </button>



        </div>



        {visibleRuns.length === 0 ? (



          <div



            style={{



              padding: 30,



              textAlign: "center",



              color: "#64748b",



              fontWeight: 900,



            }}



          >



            No invoice runs yet. Click + Add to create one.



          </div>



        ) : (



          <table style={{ width: "100%", borderCollapse: "collapse" }}>



            <thead>



              <tr>



                <th style={th}>Date</th>



                <th style={th}>Description</th>



                <th style={th}>Period</th>



                <th style={th}>Invoices</th>



                <th style={{ ...th, textAlign: "right" }}>Amount</th>



              </tr>



            </thead>



            <tbody>



              {visibleRuns.map((run: any, index: number) => (



                <tr



                  key={run.id || index}



                  onDoubleClick={() => openRun(run)}



                  style={{



                    background:



                      index % 2 === 0 ? "#ffffff" : "rgba(212,175,55,0.06)",



                    cursor: "pointer",



                  }}



                >



                  <td style={td}>{run.date || run.invoiceDate || "-"}</td>



                  <td style={td}>



                    {`Invoice Run For ${run.period || run.month || "this period"}`}



                  </td>



                  <td style={td}>{run.period || run.month || "-"}</td>



                  <td style={td}>



                    {run.totalInvoices || run.invoices || 0} invoices



                  </td>



                  <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>



                    {money(run.totalAmount || 0)}



                  </td>



                </tr>



              ))}



            </tbody>



          </table>



        )}



        <div



          style={{



            padding: "12px 16px",



            display: "flex",



            justifyContent: "space-between",



            borderTop: "1px solid #e5e7eb",



          }}



        >



          <span style={{ color: "#64748b", fontSize: 13 }}>Page 1 / 1</span>



          <div style={{ display: "flex", gap: 8 }}>



            <button style={btn}>‹</button>



            <button style={{ ...goldBtn, padding: "8px 12px" }}>1</button>



            <button style={btn}>›</button>



          </div>



        </div>



      </div>



    </div>



  );



}