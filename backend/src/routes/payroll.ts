import { Router } from "express";



import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();
// ===== TAX CALCULATION (SARS 2025/2026 - simplified) =====



function calculatePayroll(basicSalary: number) {



    // UIF (1% capped)
  
  
  
    const uif = Math.min(basicSalary * 0.01, 177.12);
  
  
  
    // Annual salary for tax brackets
  
  
  
    const annual = basicSalary * 12;
  
  
  
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
  
  
  
    // Convert to monthly tax
  
  
  
    const monthlyTax = annualTax / 12;
  
  
  
    // Net salary
  
  
  
    const netSalary = basicSalary - monthlyTax - uif;
  
  
  
    return {
  
  
  
      tax: Number(monthlyTax.toFixed(2)),
  
  
  
      uif: Number(uif.toFixed(2)),
  
  
  
      netSalary: Number(netSalary.toFixed(2)),
  
  
  
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
      
      
      
      } = req.body;

    



    const employee = await prisma.employee.create({



        data: {



            schoolId,
          
          
          
            firstName,
          
          
          
            lastName,
          
          
          
            fullName: `${firstName} ${lastName}`.trim(),
          
          
          
            email,
          
          
          
            idNumber: idNumber || null,
          
          
          
            basicSalary: Number(basicSalary || 0),
          
          
          
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          
          
          
            taxNumber: taxNumber || null,
          
          
          
            uifApplicable: uifApplicable ?? true,
          
          
          
            incomeTaxApplicable: incomeTaxApplicable ?? true,
          
          
          
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



/**



 * RUN PAYROLL (basic version)



 */



router.post("/run", async (req, res) => {



  try {



    const { schoolId, month, year } = req.body;



    const employees = await prisma.employee.findMany({



      where: { schoolId, isActive: true },



    });



    let grossTotal = 0;



    let deductionsTotal = 0;



    let netTotal = 0;

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



      const gross = Number(emp.basicSalary);
      const payrollCalc = calculatePayroll(gross);

      const paye = emp.incomeTaxApplicable ? payrollCalc.tax : 0;



      const uifEmployee = emp.uifApplicable ? payrollCalc.uif : 0;
      
      
      
      const employerUif = emp.uifApplicable ? payrollCalc.uif : 0;
      
      
      
      const totalDeductions = paye + uifEmployee;
      
      
      
      const net = gross - totalDeductions;
      


      grossTotal += gross;



      deductionsTotal += totalDeductions;



      netTotal += net;

      payrollResults.push({



        employeeId: emp.id,
      
      
      
        employeeName: emp.fullName || `${emp.firstName} ${emp.lastName}`,
      
      
      
        basicSalary: Number(gross.toFixed(2)),
      
      
      
        paye: Number(paye.toFixed(2)),
      
      
      
        uif: Number(uifEmployee.toFixed(2)),
      
      
      
        deductions: Number(totalDeductions.toFixed(2)),
      
      
      
        net: Number(net.toFixed(2)),
      
      
      
      });

      await prisma.payrollRunEmployee.create({



        data: {



          payrollRunId: payrollRun.id,



          employeeId: emp.id,



          basicSalary: gross,



          grossPay: gross,



          payeAmount: paye,



          uifEmployeeAmount: uifEmployee,



          totalDeductions,



          netPay: net,



          uifEmployerAmount: employerUif,



          employerCost: gross + employerUif,



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



          grossPay: gross,



          totalDeductions,



          netPay: net,



          employerCost: gross + employerUif,



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



        employerCostTotal: grossTotal + deductionsTotal,



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