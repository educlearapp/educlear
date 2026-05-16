import React, { useEffect, useMemo, useState } from "react";
import {



  fetchInvoices,



  fetchPayments,



} from "./billingApi";



import {



  calculateOutstandingBalance,



  calculateLastPayment,



} from "./billingCalculations";



import type {



  Invoice,



  Payment,



} from "./billingTypes";


type Props = {



  title?: string;



  subtitle?: string;



  rows: any[];



  selected: any;



  setSelected: (row: any) => void;



  onManage: (row: any) => void;



};



export default function Statements({



  title = "Statements",



  subtitle = "Manage your statement of accounts.",



  rows,



  selected,



  setSelected,



  onManage,



}: Props) {
  
  const [invoices, setInvoices] = useState<Invoice[]>([]);



  const [payments, setPayments] = useState<Payment[]>([]);
  
  
  
  const [billingLoading, setBillingLoading] = useState(false);
  
  
  
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
  
  
  
      console.error("Failed to load statement billing data", error);
  
  
  
    } finally {
  
  
  
      setBillingLoading(false);
  
  
  
    }
  
  
  
  };
  
  
  
  const getLearnerOutstandingBalance = (learnerId: string) => {
  
  
  
    return calculateOutstandingBalance(invoices, payments, learnerId);
  
  
  
  };
  
  
  
  const getLearnerLastPayment = (learnerId: string) => {
  
  
  
    return calculateLastPayment(payments, learnerId);
  
  
  
  };


  const [statementSearch, setStatementSearch] = useState("");



  const [statementPage, setStatementPage] = useState(1);



  const GOLD = "#d4af37";



  const formatMoney = (value: any) =>



    `R ${Number(value || 0).toLocaleString("en-ZA", {



      minimumFractionDigits: 2,



      maximumFractionDigits: 2,



    })}`;



  const goldBtn: React.CSSProperties = {



    padding: "10px 16px",



    borderRadius: 10,



    border: "1px solid #b89329",



    background: "linear-gradient(135deg, #f7d56a, #d4af37)",



    color: "#111827",



    fontWeight: 900,



    cursor: "pointer",



  };



  const selectStyle: React.CSSProperties = {



    padding: "10px 12px",



    borderRadius: 10,



    border: "1px solid #cbd5e1",



    background: "#fff",



    color: "#111827",



    fontWeight: 700,



  };



  const th: React.CSSProperties = {



    padding: "12px",



    borderBottom: "1px solid #e5e7eb",



    textAlign: "left",



    fontSize: 13,



    color: "#334155",



    background: "rgba(212,175,55,0.16)",



  };



  const td: React.CSSProperties = {



    padding: "12px",



    borderBottom: "1px solid #e5e7eb",



    fontSize: 13,



    color: "#0f172a",



  };



  const filteredRows = useMemo(() => {



    const q = statementSearch.toLowerCase().trim();



    if (!q) return rows;



    return rows.filter((row) =>



      [



        row.accountNo,



        row.name,



        row.surname,



        row.balance,



        row.lastInvoice,



        row.lastInvoiceDate,



        row.lastPayment,



        row.lastPaymentDate,



        row.status,



      ]



        .join(" ")



        .toLowerCase()



        .includes(q)



    );



  }, [rows, statementSearch]);



  const pageSize = 10;



  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));



  const safePage = Math.min(statementPage, pageCount);



  const currentRows = filteredRows.slice(



    (safePage - 1) * pageSize,



    safePage * pageSize



  );



  const accountsCount = rows.length;



  const totalOutstanding = rows.reduce(



    (sum, row) =>
  
  
  
      sum +
  
  
  
      getLearnerOutstandingBalance(row.id || row.learnerId),
  
  
  
         0
  
  
  
       );



  const recentlyOwing = rows



    .filter((row) => row.status === "Recently Owing")



    .reduce(



      (sum, row) =>
    
    
    
        sum +
    
    
    
        getLearnerOutstandingBalance(row.id || row.learnerId),
    
    
    
      0
    
    
    
    );



  const badDebt = rows



    .filter((row) => row.status === "Bad Debt")



    .reduce(



      (sum, row) =>
    
    
    
        sum +
    
    
    
        getLearnerOutstandingBalance(row.id || row.learnerId),
    
    
    
      0
    
    
    
    );



  const overPaidAbs = Math.abs(



    rows



      .filter((row) => row.status === "Over Paid")



      .reduce((sum, row) => sum + Number(row.balance || 0), 0)



  );



  const summaryCard: React.CSSProperties = {



    background: "#fff",



    borderRadius: 18,



    padding: "22px 20px",



    border: "1px solid rgba(212,175,55,0.35)",



    boxShadow: "0 10px 25px rgba(15,23,42,0.05)",



  };



  return (



    <div



      style={{



        padding: 26,



        background: "#f8fafc",



        minHeight: "100%",



        borderRadius: 20,



        border: "1px solid rgba(15,23,42,0.08)",



      }}



    >



      <div style={{ marginBottom: 18 }}>



        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>



          {title}



        </h1>



        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>



          {subtitle}



        </p>



      </div>



      <div



        style={{



          display: "grid",



          gridTemplateColumns: "repeat(5, minmax(140px, 1fr))",



          gap: 16,



          marginBottom: 22,



        }}



      >



        <div style={summaryCard}>



          <div style={{ fontSize: 24, fontWeight: 950 }}>{accountsCount}</div>



          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>ACCOUNTS</div>



        </div>



        <div style={summaryCard}>



          <div style={{ fontSize: 24, fontWeight: 950 }}>{formatMoney(totalOutstanding)}</div>



          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>TOTAL OUTSTANDING</div>



        </div>



        <div style={summaryCard}>



          <div style={{ fontSize: 24, fontWeight: 950 }}>{formatMoney(recentlyOwing)}</div>



          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>RECENTLY OWING</div>



        </div>



        <div style={summaryCard}>



          <div style={{ fontSize: 24, fontWeight: 950, color: "#b91c1c" }}>



            {formatMoney(badDebt)}



          </div>



          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>BAD DEBT</div>



        </div>



        <div style={summaryCard}>



          <div style={{ fontSize: 24, fontWeight: 950, color: "#15803d" }}>



            {formatMoney(overPaidAbs)}



          </div>



          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>OVER PAID</div>



        </div>



      </div>



      <div



        style={{



          background: "#fff",



          borderRadius: 20,



          padding: 18,



          border: "1px solid #e5e7eb",



          boxShadow: "0 10px 25px rgba(15,23,42,0.05)",



        }}



      >



        <div



          style={{



            display: "flex",



            justifyContent: "space-between",



            gap: 12,



            alignItems: "center",



            marginBottom: 14,



            flexWrap: "wrap",



          }}



        >



          <button



            style={{



              ...goldBtn,



              opacity: selected ? 1 : 0.55,



              cursor: selected ? "pointer" : "not-allowed",



            }}



            disabled={!selected}



            onClick={() => {



              if (!selected) return alert("Please select an account first.");



              onManage(selected);



            }}



          >



            Manage



          </button>



          <input



            placeholder="Search"



            value={statementSearch}



            onChange={(e) => {



              setStatementSearch(e.target.value);



              setStatementPage(1);



            }}



            style={{ ...selectStyle, width: 260 }}



          />



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse" }}>



          <thead>



            <tr>



              <th style={th}>Account No</th>



              <th style={th}>Name</th>



              <th style={th}>Surname</th>



              <th style={th}>Balance</th>



              <th style={th}>Last Invoice</th>



              <th style={th}>Last Payment</th>



              <th style={th}>Account Status</th>



            </tr>



          </thead>



          <tbody>



            {currentRows.length === 0 ? (



              <tr>



                <td colSpan={7} style={{ ...td, textAlign: "center", padding: 24 }}>



                  No accounts found.



                </td>



              </tr>



            ) : (



              currentRows.map((row, index) => {



                const isSelected =



                  String(selected?.accountNo || "") === String(row.accountNo || "");



                return (



                  <tr



                    key={`${row.accountNo}-${index}`}



                    onClick={() => setSelected(row)}



                    style={{



                      cursor: "pointer",



                      background: isSelected



                        ? "linear-gradient(90deg, rgba(212,175,55,0.24), #ffffff)"



                        : index % 2 === 0



                          ? "#ffffff"



                          : "rgba(212,175,55,0.06)",



                      outline: isSelected ? `2px solid ${GOLD}` : "none",



                    }}



                  >



                    <td style={td}>{row.accountNo}</td>



                    <td style={td}>{row.name}</td>



                    <td style={td}>{row.surname}</td>



                    <td style={td}>



            {formatMoney(



        getLearnerOutstandingBalance(row.id || row.learnerId)



         )}



       </td>



                    <td style={td}>



                      {formatMoney(row.lastInvoice)} on {row.lastInvoiceDate || "-"}



                    </td>



                    <td style={td}>



                      {formatMoney(row.lastPayment)} on {row.lastPaymentDate || "-"}



                    </td>



                    <td style={td}>



                      <span



                        style={{



                          fontWeight: 900,



                          color:



                            row.status === "Bad Debt"



                              ? "#b91c1c"



                              : row.status === "Recently Owing"



                                ? "#b45309"



                                : row.status === "Over Paid"



                                  ? "#15803d"



                                  : "#475569",



                        }}



                      >



                        {row.status || "Up To Date"}



                      </span>



                    </td>



                  </tr>



                );



              })



            )}



          </tbody>



        </table>



        <div



          style={{



            display: "flex",



            justifyContent: "space-between",



            alignItems: "center",



            marginTop: 16,



          }}



        >



          <div style={{ color: "#64748b", fontWeight: 800 }}>



            Page {safePage} / {pageCount}



          </div>



          <div style={{ display: "flex", gap: 8 }}>



            <button



              style={goldBtn}



              disabled={safePage <= 1}



              onClick={() => setStatementPage((prev) => Math.max(1, prev - 1))}



            >



              ‹



            </button>



            <button style={{ ...goldBtn, cursor: "default" }}>{safePage}</button>



            <button



              style={goldBtn}



              disabled={safePage >= pageCount}



              onClick={() =>



                setStatementPage((prev) => Math.min(pageCount, prev + 1))



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