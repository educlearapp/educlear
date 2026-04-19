import { Router } from "express";

import nodemailer from "nodemailer";

import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();

function createMailTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass: String(pass) } : undefined,
  });
}

async function generateEmployeeNumber(schoolId: string): Promise<string> {
  const prefix = "EMP-";
  const pad = 4;

  const latest = await prisma.employee.findFirst({
    where: { schoolId, employeeNumber: { startsWith: prefix } },
    select: { employeeNumber: true },
    orderBy: { employeeNumber: "desc" },
  });

  const latestRaw = String(latest?.employeeNumber ?? "").trim();
  const latestNum = latestRaw.startsWith(prefix) ? Number(latestRaw.slice(prefix.length)) : NaN;
  let next = Number.isFinite(latestNum) ? Math.max(0, Math.floor(latestNum)) + 1 : 1;

  // Best-effort uniqueness within a school (schema does not enforce a unique constraint).
  for (let i = 0; i < 50; i++) {
    const candidate = `${prefix}${String(next).padStart(pad, "0")}`;
    const exists = await prisma.employee.findFirst({
      where: { schoolId, employeeNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    next += 1;
  }

  // Fallback: still readable, extremely unlikely collision
  return `${prefix}${Date.now()}`;
}

// ===== TAX CALCULATION (SARS 2025/2026 - simplified) =====



/** PAYE + UIF using existing SARS 2025/2026 simplified brackets (monthly remuneration). When payeBase === uifBase === basicSalary and no extra earnings/deductions, behaviour matches the legacy single-argument payroll run. */
function calculatePayroll(payeBase: number, uifBase?: number) {
  const uifOnlyBase = uifBase !== undefined ? uifBase : payeBase;

  const uif = Math.min(Math.max(uifOnlyBase, 0) * 0.01, 177.12);

  const annual = Math.max(payeBase, 0) * 12;

  let annualTax = 0;

  if (annual <= 237100) {
    annualTax = annual * 0.18;
  } else if (annual <= 370500) {
    annualTax = 42678 + (annual - 237100) * 0.26;
  } else if (annual <= 512800) {
    annualTax = 77362 + (annual - 370500) * 0.31;
  } else if (annual <= 673000) {
    annualTax = 121475 + (annual - 512800) * 0.36;
  } else if (annual <= 857900) {
    annualTax = 179147 + (annual - 673000) * 0.39;
  } else if (annual <= 1817000) {
    annualTax = 251258 + (annual - 857900) * 0.41;
  } else {
    annualTax = 644489 + (annual - 1817000) * 0.45;
  }

  const monthlyTax = annualTax / 12;

  return {
    tax: Number(monthlyTax.toFixed(2)),
    uif: Number(uif.toFixed(2)),
  };
}


/**



 * CREATE EMPLOYEE



 */



router.post("/employee", async (req, res) => {



  try {

    const {
      schoolId,
      firstName,
      lastName,
      email,
      idNumber,
      basicSalary,
      dateOfBirth,
      taxNumber,
      uifApplicable,
      incomeTaxApplicable,
      physicalAddress,
      bankName,
      bankAccountHolder,
      bankAccountNumber,
      bankBranchCode,
      employeeNumber,
      jobTitle,
      employeePension,
      employeeMedicalAid,
      employerMedicalAid,
      overtimeHours,
      overtimeRate,
    } = req.body;

    const num = (v: unknown, fallback = 0) =>
      Number(v === undefined || v === null || v === "" ? fallback : v);

    const cleanEmpNo = String(employeeNumber ?? "").trim();
    const finalEmployeeNumber = cleanEmpNo ? cleanEmpNo : await generateEmployeeNumber(String(schoolId));

    const employee = await prisma.employee.create({
      data: {
        schoolId,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        email: email || null,
        idNumber: idNumber || null,
        basicSalary: num(basicSalary),
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        taxNumber: taxNumber || null,
        uifApplicable: uifApplicable ?? true,
        incomeTaxApplicable: incomeTaxApplicable ?? true,
        physicalAddress: physicalAddress || null,
        bankName: bankName || null,
        bankAccountHolder: bankAccountHolder || null,
        bankAccountNumber: bankAccountNumber || null,
        bankBranchCode: bankBranchCode || null,
        employeeNumber: finalEmployeeNumber,
        jobTitle: jobTitle || null,
        employeePension: num(employeePension),
        employeeMedicalAid: num(employeeMedicalAid),
        employerMedicalAid: num(employerMedicalAid),
        overtimeHours: num(overtimeHours),
        overtimeRate: num(overtimeRate),
      },
    });



    res.json(employee);



  } catch (error) {



    console.error(error);



    res.status(500).json({ error: "Failed to create employee" });



  }



});



/**



 * GET EMPLOYEES



 */



router.get("/employees/:schoolId", async (req, res) => {



  try {



    const { schoolId } = req.params;



    const employees = await prisma.employee.findMany({



      where: { schoolId },



      orderBy: { createdAt: "desc" },



    });



    res.json(employees);



  } catch (error) {



    console.error(error);



    res.status(500).json({ error: "Failed to fetch employees" });



  }



});

/** Summary for payslips (employer block). */
router.get("/school/:schoolId", async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        logoUrl: true,
        primaryColor: true,
      },
    });
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }
    res.json(school);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch school" });
  }
});

/** RUN PAYROLL */

router.post("/run", async (req, res) => {



  try {



    const { schoolId, month, year } = req.body;



    const employees = await prisma.employee.findMany({



      where: { schoolId, isActive: true },



    });



    let grossTotal = 0;

    let deductionsTotal = 0;

    let netTotal = 0;

    let employerCostTotal = 0;

    const payrollResults: any[] = [];

    const payrollRun = await prisma.payrollRun.create({



      data: {



        schoolId,



        taxYear: year,



        payrollMonth: month,



        payrollYear: year,



        payDate: new Date(),



      },



    });



    for (const emp of employees) {
      const basicSalaryNum = Number(emp.basicSalary || 0);
      const overtimeHoursNum = Number(emp.overtimeHours ?? 0);
      const overtimeRateNum = Number(emp.overtimeRate ?? 0);
      const overtimePay = Number((overtimeHoursNum * overtimeRateNum).toFixed(2));
      const employerMedicalNum = Number(emp.employerMedicalAid ?? 0);
      const employeeMedicalNum = Number(emp.employeeMedicalAid ?? 0);
      const employeePensionNum = Number(emp.employeePension ?? 0);

      const grossEarnings = Number(
        (basicSalaryNum + overtimePay + employerMedicalNum).toFixed(2)
      );

      const payeBase = grossEarnings;
      const uifBase = basicSalaryNum + overtimePay;
      const payrollCalc = calculatePayroll(payeBase, uifBase);

      const paye = emp.incomeTaxApplicable ? payrollCalc.tax : 0;
      const uifEmployee = emp.uifApplicable ? payrollCalc.uif : 0;
      const employerUif = emp.uifApplicable ? payrollCalc.uif : 0;

      const otherDeductions = Number(
        (employeePensionNum + employeeMedicalNum).toFixed(2)
      );
      const totalDeductions = Number(
        (paye + uifEmployee + otherDeductions).toFixed(2)
      );
      const net = Number((grossEarnings - totalDeductions).toFixed(2));

      grossTotal += grossEarnings;
      deductionsTotal += totalDeductions;
      netTotal += net;
      employerCostTotal += grossEarnings + employerUif;

      payrollResults.push({
        employeeId: emp.id,
        employeeName: emp.fullName || `${emp.firstName} ${emp.lastName}`,
        employeeNumber: emp.employeeNumber,
        idNumber: emp.idNumber,
        jobTitle: emp.jobTitle,
        basicSalary: Number(basicSalaryNum.toFixed(2)),
        overtimeHours: Number(overtimeHoursNum.toFixed(2)),
        overtimeRate: Number(overtimeRateNum.toFixed(2)),
        overtimePay,
        medicalAidEmployee: Number(employeeMedicalNum.toFixed(2)),
        medicalAidEmployer: Number(employerMedicalNum.toFixed(2)),
        pension: Number(employeePensionNum.toFixed(2)),
        grossEarnings,
        paye: Number(paye.toFixed(2)),
        uif: Number(uifEmployee.toFixed(2)),
        deductions: totalDeductions,
        net,
      });

      await prisma.payrollRunEmployee.create({
        data: {
          payrollRunId: payrollRun.id,
          employeeId: emp.id,
          basicSalary: basicSalaryNum,
          overtimeAmount: overtimePay,
          grossPay: grossEarnings,
          payeAmount: paye,
          uifEmployeeAmount: uifEmployee,
          otherDeductionsAmount: otherDeductions,
          totalDeductions,
          netPay: net,
          uifEmployerAmount: employerUif,
          employerCost: grossEarnings + employerUif,
        },
      });

      await prisma.payslip.create({
        data: {
          schoolId,
          payrollRunId: payrollRun.id,
          payrollRunEmployeeId: (
            await prisma.payrollRunEmployee.findFirst({
              where: {
                payrollRunId: payrollRun.id,
                employeeId: emp.id,
              },
            })
          )!.id,
          employeeId: emp.id,
          taxYear: year,
          payrollMonth: month,
          payrollYear: year,
          payDate: new Date(),
          grossPay: grossEarnings,
          totalDeductions,
          netPay: net,
          employerCost: grossEarnings + employerUif,
        },
      });
    }



    await prisma.payrollRun.update({



      where: { id: payrollRun.id },



      data: {



        employeeCount: employees.length,



        grossTotal,



        deductionsTotal,



        netTotal,

        employerCostTotal: Number(employerCostTotal.toFixed(2)),



      },



    });



    res.json({



      success: true,
    
    
    
      grossTotal: Number(grossTotal.toFixed(2)),
    
    
    
      deductionsTotal: Number(deductionsTotal.toFixed(2)),
    
    
    
      netTotal: Number(netTotal.toFixed(2)),
    
    
    
      employees: payrollResults,
    
    
    
    });



  } catch (error) {



    console.error(error);



    res.status(500).json({ error: "Payroll failed" });



  }



});

/**
 * POST /email-payslip
 * Body: { schoolId, employeeId, pdfBase64, fileName?, periodLabel?, employeeName? }
 * Sends the payslip PDF to the employee email on file (never a client-supplied address).
 */
router.post("/email-payslip", async (req, res) => {
  try {
    const body = req.body || {};
    const schoolId = typeof body.schoolId === "string" ? body.schoolId : "";
    const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
    const pdfBase64 =
      typeof body.pdfBase64 === "string" ? body.pdfBase64.replace(/\s/g, "") : "";
    const fileName =
      typeof body.fileName === "string" && body.fileName.trim()
        ? body.fileName.trim().replace(/[/\\?%*:|"<>]/g, "-")
        : "payslip.pdf";
    const periodLabel =
      typeof body.periodLabel === "string" ? body.periodLabel.trim() : "";
    const employeeName =
      typeof body.employeeName === "string" ? body.employeeName.trim() : "";

    if (!schoolId || !employeeId || !pdfBase64) {
      return res.status(400).json({ error: "schoolId, employeeId, and pdfBase64 are required" });
    }

    const transport = createMailTransport();
    if (!transport) {
      return res.status(503).json({
        error: "Email is not configured. Set SMTP_HOST (and SMTP_USER / SMTP_PASS if required) on the server.",
      });
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, schoolId },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found for this school" });
    }

    const to = String(employee.email || "").trim();
    if (!to) {
      return res.status(400).json({ error: "This employee has no email address on file." });
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid PDF data" });
    }
    if (pdfBuffer.length < 64 || pdfBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "PDF attachment is missing or too large" });
    }
    const magic = pdfBuffer.subarray(0, 5).toString("utf8");
    if (!magic.startsWith("%PDF")) {
      return res.status(400).json({ error: "Attachment is not a valid PDF" });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true },
    });
    const schoolName = school?.name?.trim() || "School";

    const from =
      process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "noreply@educlear";

    const subjectParts = [`Payslip`, schoolName];
    if (periodLabel) subjectParts.push(periodLabel);
    const subject = subjectParts.join(" — ");

    const greetingName = employeeName || employee.fullName || `${employee.firstName} ${employee.lastName}`.trim();

    await transport.sendMail({
      from,
      to,
      subject,
      text: `Hello${greetingName ? ` ${greetingName}` : ""},\n\nPlease find your payslip attached${periodLabel ? ` for ${periodLabel}` : ""}.\n\n— ${schoolName}`,
      attachments: [
        {
          filename: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    res.json({ success: true, message: `Payslip sent to ${to}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send payslip email" });
  }
});

/**
 * POST /email-bookkeeper-report
 * Body: { schoolId, bookkeeperEmail, pdfBase64, fileName?, periodLabel? }
 * Attaches the client-generated bookkeeper PDF (same content as download).
 */
router.post("/email-bookkeeper-report", async (req, res) => {
  try {
    const body = req.body || {};
    const schoolId = typeof body.schoolId === "string" ? body.schoolId : "";
    const bookkeeperEmail = typeof body.bookkeeperEmail === "string" ? body.bookkeeperEmail.trim() : "";
    const pdfBase64 =
      typeof body.pdfBase64 === "string" ? body.pdfBase64.replace(/\s/g, "") : "";
    const fileName =
      typeof body.fileName === "string" && body.fileName.trim()
        ? body.fileName.trim().replace(/[/\\?%*:|"<>]/g, "-")
        : "payroll-bookkeeper-report.pdf";
    const periodLabel =
      typeof body.periodLabel === "string" ? body.periodLabel.trim() : "";

    if (!schoolId || !bookkeeperEmail || !pdfBase64) {
      return res.status(400).json({ error: "schoolId, bookkeeperEmail, and pdfBase64 are required" });
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookkeeperEmail);
    if (!emailOk) {
      return res.status(400).json({ error: "Invalid bookkeeper email address" });
    }

    const transport = createMailTransport();
    if (!transport) {
      return res.status(503).json({
        error: "Email is not configured. Set SMTP_HOST (and SMTP_USER / SMTP_PASS if required) on the server.",
      });
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid PDF data" });
    }
    if (pdfBuffer.length < 64 || pdfBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "PDF attachment is missing or too large" });
    }
    const magic = pdfBuffer.subarray(0, 5).toString("utf8");
    if (!magic.startsWith("%PDF")) {
      return res.status(400).json({ error: "Attachment is not a valid PDF" });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true },
    });
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }
    const schoolName = school.name?.trim() || "School";

    const from =
      process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "noreply@educlear";

    const monthYearPart = periodLabel || "Report";
    const subject = `Payroll Report – ${schoolName} – ${monthYearPart}`;

    await transport.sendMail({
      from,
      to: bookkeeperEmail,
      subject,
      text: "Please find attached the payroll report.",
      attachments: [
        {
          filename: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    res.json({ success: true, message: `Bookkeeper report sent to ${bookkeeperEmail}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send bookkeeper report email" });
  }
});

export default router;