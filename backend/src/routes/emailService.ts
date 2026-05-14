import nodemailer from "nodemailer";



type SendEmailWithAttachmentInput = {



  to: string;



  subject: string;



  html: string;



  attachments?: {



    filename: string;



    content: Buffer | string;



    contentType?: string;



  }[];



};



export async function sendEmailWithAttachment(input: SendEmailWithAttachmentInput) {



  const host = process.env.SMTP_HOST;



  const port = Number(process.env.SMTP_PORT || 587);



  const user = process.env.SMTP_USER;



  const pass = process.env.SMTP_PASS;



  const from = process.env.SMTP_FROM || user;



  if (!host || !user || !pass || !from) {



    throw new Error("SMTP settings missing. Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.");



  }



  const transporter = nodemailer.createTransport({



    host,



    port,



    secure: port === 465,



    auth: {



      user,



      pass,



    },



  });



  return transporter.sendMail({



    from,



    to: input.to,



    subject: input.subject,



    html: input.html,



    attachments: input.attachments || [],



  });



}