import { Router } from "express";



import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();
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
        employeeNumber: employeeNumber || null,
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
        logoUrl: true,
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



export default router;