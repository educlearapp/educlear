import type { Invoice, Payment } from "./billingTypes";



export const calculateOutstandingBalance = (



  invoices: Invoice[],



  payments: Payment[],



  learnerId: string



) => {



  const invoiceTotal = invoices



    .filter((invoice) => invoice.learnerId === learnerId)



    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);



  const paymentTotal = payments



    .filter((payment) => payment.learnerId === learnerId)



    .reduce((total, payment) => total + Number(payment.amount || 0), 0);



  return invoiceTotal - paymentTotal;



};



export const calculateLastPayment = (



  payments: Payment[],



  learnerId: string



) => {



  const learnerPayments = payments



    .filter((payment) => payment.learnerId === learnerId)



    .sort(



      (a, b) =>



        new Date(b.paymentDate).getTime() -



        new Date(a.paymentDate).getTime()



    );



  return learnerPayments[0] || null;



};