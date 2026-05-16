import type { Invoice, Payment } from "./billingTypes";
import { getLearnerAccountNo } from "../learner/learnerIdentity";



const getLearnerKey = (value: any) =>



  String(value?.learnerId || value?.learnerID || value?.learner?.id || value?.id || value?.accountNo || "").trim();



export const calculateOutstandingBalance = (



  invoices: Invoice[],



  payments: Payment[],



  learnerId: string



) => {



  const key = String(learnerId || "").trim();



  const invoiceTotal = invoices



    .filter((invoice: any) => getLearnerKey(invoice) === key)



    .reduce((total, invoice: any) => total + Number(invoice.amount || invoice.total || invoice.balance || 0), 0);



  const paymentTotal = payments



    .filter((payment: any) => getLearnerKey(payment) === key)



    .reduce((total, payment: any) => total + Number(payment.amount || 0), 0);



  return invoiceTotal - paymentTotal;



};



export const calculateLastPayment = (



  payments: Payment[],



  learnerId: string



) => {



  const key = String(learnerId || "").trim();



  const learnerPayments = payments



    .filter((payment: any) => getLearnerKey(payment) === key)



    .sort(



      (a: any, b: any) =>



        new Date(b.paymentDate || b.date || b.createdAt || 0).getTime() -



        new Date(a.paymentDate || a.date || a.createdAt || 0).getTime()



    );



  return learnerPayments[0] || null;



};



export const buildBillingAccountRows = (



  learners: any[],



  invoices: any[],



  payments: any[]



) => {



  return learners.map((learner: any, index: number) => {



    const learnerId = String(learner?.id || learner?.learnerId || learner?.accountNo || "").trim();



    const accountNo = getLearnerAccountNo(learner);



    const learnerInvoices = invoices.filter((invoice: any) => {



      const key = String(invoice?.learnerId || invoice?.learner?.id || invoice?.accountNo || "").trim();



      return key === learnerId || key === accountNo;



    });



    const learnerPayments = payments.filter((payment: any) => {



      const key = String(payment?.learnerId || payment?.learner?.id || payment?.accountNo || "").trim();



      return key === learnerId || key === accountNo;



    });



    const invoiceTotal = learnerInvoices.reduce(



      (sum: number, invoice: any) =>



        sum + Number(invoice?.amount || invoice?.total || invoice?.balance || 0),



      0



    );



    const paymentTotal = learnerPayments.reduce(



      (sum: number, payment: any) => sum + Number(payment?.amount || 0),



      0



    );



    const balance = invoiceTotal - paymentTotal;



    const lastInvoice = learnerInvoices



      .slice()



      .sort(



        (a: any, b: any) =>



          new Date(b.invoiceDate || b.date || b.createdAt || 0).getTime() -



          new Date(a.invoiceDate || a.date || a.createdAt || 0).getTime()



      )[0];



    const lastPayment = learnerPayments



      .slice()



      .sort(



        (a: any, b: any) =>



          new Date(b.paymentDate || b.date || b.createdAt || 0).getTime() -



          new Date(a.paymentDate || a.date || a.createdAt || 0).getTime()



      )[0];



    return {



      id: learnerId,



      learnerId,



      accountNo,



      name: learner?.firstName || learner?.name || "",



      surname: learner?.surname || learner?.lastName || "",



      balance,



      invoiceTotal,



      paymentTotal,



      lastInvoice: lastInvoice



        ? `R ${Number(lastInvoice.amount || lastInvoice.total || 0).toFixed(2)}`



        : "No invoices",



      lastInvoiceDate: lastInvoice?.invoiceDate || lastInvoice?.date || "",



      lastPayment: lastPayment



        ? `R ${Number(lastPayment.amount || 0).toFixed(2)} on ${



            lastPayment.paymentDate || lastPayment.date || ""



          }`



        : "No payments",



      status:



        balance > 10000



          ? "Bad Debt"



          : balance > 0



          ? "Recently Owing"



          : balance < 0



          ? "Over Paid"



          : "Up To Date",



    };



  });



};