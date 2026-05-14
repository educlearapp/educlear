import { Router } from "express";



import { sendEmailWithAttachment } from "./emailService";



const router = Router();



router.post("/send-statement", async (req, res) => {



  try {



    const { to, subject, html, pdfBase64, filename } = req.body;



    if (!to || !subject || !html || !pdfBase64) {



      return res.status(400).json({



        error: "Missing required fields: to, subject, html, pdfBase64",



      });



    }



    const pdfBuffer = Buffer.from(pdfBase64, "base64");



    const result = await sendEmailWithAttachment({



      to,



      subject,



      html,



      attachments: [



        {



          filename: filename || "statement.pdf",



          content: pdfBuffer,



          contentType: "application/pdf",



        },



      ],



    });



    return res.json({



      success: true,



      messageId: result.messageId,



    });



  } catch (error: any) {



    console.error("Send statement email error:", error);



    return res.status(500).json({



      error: error.message || "Failed to send statement email",



    });



  }



});



export default router;