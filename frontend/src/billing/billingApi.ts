import { API_URL } from "../api";



const getJsonOrEmptyArray = async (url: string) => {



  try {



    const response = await fetch(url);



    if (!response.ok) {



      console.warn(`Billing API returned ${response.status}: ${url}`);



      return [];



    }



    const data = await response.json();



    if (Array.isArray(data)) return data;



    if (Array.isArray(data?.items)) return data.items;



    if (Array.isArray(data?.data)) return data.data;



    if (Array.isArray(data?.invoices)) return data.invoices;



    if (Array.isArray(data?.payments)) return data.payments;



    if (Array.isArray(data?.statements)) return data.statements;



    return [];



  } catch (error) {



    console.warn(`Billing API failed: ${url}`, error);



    return [];



  }



};



const postJson = async (url: string, data: any) => {



  const response = await fetch(url, {



    method: "POST",



    headers: {



      "Content-Type": "application/json",



    },



    body: JSON.stringify(data),



  });



  if (!response.ok) {



    throw new Error(`Billing API POST failed: ${url}`);



  }



  return response.json();



};



export const fetchInvoices = async (schoolId: string) => {



  return getJsonOrEmptyArray(



    `${API_URL}/api/invoices?schoolId=${encodeURIComponent(schoolId)}`



  );



};



export const fetchPayments = async (schoolId: string) => {



  return getJsonOrEmptyArray(



    `${API_URL}/api/payments?schoolId=${encodeURIComponent(schoolId)}`



  );



};



export const fetchStatements = async (schoolId: string) => {



  return getJsonOrEmptyArray(



    `${API_URL}/api/statements?schoolId=${encodeURIComponent(schoolId)}`



  );



};



export const createInvoice = async (data: any) => {



  return postJson(`${API_URL}/api/invoices`, data);



};



export const createPayment = async (data: any) => {



  return postJson(`${API_URL}/api/payments`, data);



};