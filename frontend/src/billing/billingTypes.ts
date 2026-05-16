export interface Invoice {



    id: string;
  
  
  
    learnerId: string;
  
  
  
    learnerName?: string;
  
  
  
    invoiceNumber: string;
  
  
  
    description: string;
  
  
  
    amount: number;
  
  
  
    paidAmount?: number;
  
  
  
    balance?: number;
  
  
  
    status?: string;
  
  
  
    createdAt: string;
  
  
  
    dueDate?: string;
  
  
  
  }
  
  
  
  export interface Payment {
  
  
  
    id: string;
  
  
  
    learnerId: string;
  
  
  
    learnerName?: string;
  
  
  
    amount: number;
  
  
  
    paymentDate: string;
  
  
  
    method?: string;
  
  
  
    reference?: string;
  
  
  
  }