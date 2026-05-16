import React from "react";
import { getLearnerAccountNo } from "../learner/learnerIdentity";



type PaymentsProps = {



  statementRows: any[];



  setActivePage: React.Dispatch<React.SetStateAction<any>>;



};



export default function Payments({ statementRows, setActivePage }: PaymentsProps) {



  const payBtn: React.CSSProperties = {



    border: "1px solid #d4af37",



    background: "#ffffff",



    color: "#111827",



    borderRadius: "12px",



    padding: "10px 16px",



    fontWeight: 800,



    cursor: "pointer",



  };



  const payGoldBtn: React.CSSProperties = {



    ...payBtn,



    background: "#d4af37",



    boxShadow: "0 10px 24px rgba(212,175,55,0.25)",



  };



  const payCell: React.CSSProperties = {



    padding: "14px 16px",



    borderTop: "1px solid #e5e7eb",



    fontWeight: 700,



    color: "#111827",



  };



  const getLastPayment = (row: any) => {



    try {



      const saved = JSON.parse(



        localStorage.getItem(`savedPayments:${row.accountNo}`) || "[]"



      );



      return saved?.[0]?.amount



        ? `R ${Number(saved[0].amount).toFixed(2)} on ${saved[0].date}`



        : row.lastPayment || "No payments";



    } catch {



      return row.lastPayment || "No payments";



    }



  };



  const paymentAccounts = statementRows.map((row: any, index: number) => ({



    id: row.id || row.learnerId || row.accountNo || `account-${index}`,



    learnerId: row.learnerId || row.id || row.accountNo || `account-${index}`,



    accountNo: getLearnerAccountNo(row),



    name: row.name || "",



    surname: row.surname || "",



    balance: Number(row.balance || 0),



    lastInvoice: row.lastInvoice || "No invoices",



    lastPayment: getLastPayment(row),



    status: row.status || "Up To Date",



  }));



  const openPaymentCreate = (account: any) => {



    localStorage.setItem(



      "selectedPaymentAccount",



      JSON.stringify({



        ...account,



        learnerId: account.learnerId || account.id || account.accountNo,



        id: account.id || account.learnerId || account.accountNo,



      })



    );



    setActivePage("paymentCreate");



  };



  const totalOutstanding = paymentAccounts.reduce(



    (sum: number, row: any) => sum + Math.max(Number(row.balance || 0), 0),



    0



  );



  const overPaid = paymentAccounts.reduce(



    (sum: number, row: any) => sum + Math.min(Number(row.balance || 0), 0),



    0



  );



  return (



    <div style={{ padding: "32px", background: "#f6f4ef", minHeight: "100vh" }}>



      <h1 style={{ margin: 0, fontSize: 38, fontWeight: 900, color: "#111827" }}>



        New Payment



        <span style={{ color: "#64748b", fontSize: 22, fontWeight: 600 }}>



          {" "}» Create a new payment



        </span>



      </h1>



      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, margin: "24px 0" }}>



        {[



          ["Accounts", paymentAccounts.length, "#166534"],



          ["Total Outstanding", `R ${totalOutstanding.toFixed(2)}`, "#1d4ed8"],



          ["Recently Owing", "R 0.00", "#b45309"],



          ["Bad Debt", "R 0.00", "#b91c1c"],



          ["Over Paid", `R ${Math.abs(overPaid).toFixed(2)}`, "#166534"],



        ].map(([label, value, color]) => (



          <div key={String(label)} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18 }}>



            <div style={{ color: String(color), fontSize: 24, fontWeight: 900 }}>{String(value)}</div>



            <div style={{ color: "#64748b", fontWeight: 800, textTransform: "uppercase", fontSize: 12 }}>{String(label)}</div>



          </div>



        ))}



      </div>



      <div style={{ marginBottom: 16 }}>



        <button style={payBtn} onClick={() => setActivePage("payments")}>



          ☰ Switch To Manage Payments



        </button>



      </div>



      <div style={{ background: "#fff", border: "1px solid #d6c17a", borderRadius: 18, overflow: "hidden" }}>



        <div style={{ background: "#111827", color: "#d4af37", padding: "16px 20px", fontSize: 22, fontWeight: 900 }}>



          Children



        </div>



        <div style={{ display: "flex", justifyContent: "space-between", padding: 14, borderBottom: "1px solid #e5e7eb" }}>



          <div style={{ display: "flex", gap: 10 }}>



            <button



              style={payGoldBtn}



              onClick={() => {



                if (!paymentAccounts.length) return alert("No account available.");



                openPaymentCreate(paymentAccounts[0]);



              }}



            >



              + Add



            </button>



            <button



              style={payBtn}



              onClick={() => alert("Add Multiple will be connected to batch payment allocation.")}



            >



              + Add Multiple



            </button>



          </div>



          <input



            placeholder="Search"



            style={{ width: 260, border: "1px solid #d4af37", borderRadius: 12, padding: "10px 14px", fontWeight: 700 }}



          />



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse" }}>



          <thead>



            <tr style={{ background: "#f8fafc" }}>



              {["Account No", "Name", "Surname", "Balance", "Last Invoice", "Last Payment", "Account Status"].map((h) => (



                <th key={h} style={{ padding: 14, textAlign: "left", fontWeight: 900 }}>{h}</th>



              ))}



            </tr>



          </thead>



          <tbody>



            {paymentAccounts.map((account: any, index: number) => (



              <tr



                key={account.accountNo || index}



                style={{ background: index % 2 === 0 ? "#fffdf7" : "#fff", cursor: "pointer" }}



                onClick={() => openPaymentCreate(account)}



              >



                <td style={payCell}>{account.accountNo}</td>



                <td style={payCell}>{account.name}</td>



                <td style={payCell}>{account.surname}</td>



                <td style={payCell}>R {Number(account.balance || 0).toFixed(2)}</td>



                <td style={payCell}>{account.lastInvoice}</td>



                <td style={payCell}>{account.lastPayment}</td>



                <td style={{ ...payCell, color: account.status === "Bad Debt" ? "#b91c1c" : account.status === "Recently Owing" ? "#b45309" : "#166534" }}>



                  {account.status}



                </td>



              </tr>



            ))}



          </tbody>



        </table>



      </div>



    </div>



  );



}