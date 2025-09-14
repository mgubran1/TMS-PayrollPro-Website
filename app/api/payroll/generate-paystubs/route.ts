import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/generate-paystubs - Generate paystubs for a week or specific employees
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { 
      year, 
      week, 
      startDate, 
      endDate, 
      employeeIds, 
      payrollIds,
      generatedBy,
      autoApprove = false
    } = body

    console.log(`Generating paystubs for Week ${week}, ${year}`)

    let payrollRecords = []

    if (payrollIds && payrollIds.length > 0) {
      // Generate for specific payroll records
      payrollRecords = await prisma.individualPayroll.findMany({
        where: {
          id: { in: payrollIds }
        },
        include: {
          loads: true,
          adjustments: true,
          fuelIntegrations: true
        }
      })
    } else if (employeeIds && employeeIds.length > 0) {
      // Generate for specific employees in the week
      payrollRecords = await prisma.individualPayroll.findMany({
        where: {
          employeeId: { in: employeeIds },
          weekStartDate: startDate,
          weekEndDate: endDate
        },
        include: {
          loads: true,
          adjustments: true,
          fuelIntegrations: true
        }
      })
    } else if (startDate && endDate) {
      // Generate for all employees in the week
      payrollRecords = await prisma.individualPayroll.findMany({
        where: {
          weekStartDate: startDate,
          weekEndDate: endDate,
          status: { in: ['CALCULATED', 'REVIEWED'] } // Only generate for calculated payrolls
        },
        include: {
          loads: true,
          adjustments: true,
          fuelIntegrations: true
        }
      })
    } else {
      return NextResponse.json(
        { error: 'Must provide either payrollIds, employeeIds with dates, or startDate/endDate' },
        { status: 400 }
      )
    }

    if (payrollRecords.length === 0) {
      return NextResponse.json(
        { error: 'No payroll records found for paystub generation' },
        { status: 404 }
      )
    }

    const results = []
    let generatedCount = 0
    let errorCount = 0
    let skippedCount = 0

    for (const payroll of payrollRecords) {
      try {
        // Check if paystub already exists
        const existingPaystub = await prisma.paystub.findFirst({
          where: { payrollId: payroll.id }
        })

        if (existingPaystub) {
          console.log(`Paystub already exists for payroll ${payroll.id}, updating...`)
          
          // Update existing paystub
          const updatedPaystub = await updatePaystub(existingPaystub.id, payroll, generatedBy)
          
          results.push({
            employeeId: payroll.employeeId,
            employeeName: payroll.employeeName,
            payrollId: payroll.id,
            paystubId: updatedPaystub.id,
            status: 'updated',
            netPay: updatedPaystub.netPay
          })
          
          generatedCount++
        } else {
          // Create new paystub
          const newPaystub = await createPaystub(payroll, generatedBy, autoApprove)
          
          results.push({
            employeeId: payroll.employeeId,
            employeeName: payroll.employeeName,
            payrollId: payroll.id,
            paystubId: newPaystub.id,
            status: 'created',
            netPay: newPaystub.netPay
          })
          
          generatedCount++
        }

        console.log(`Generated paystub for ${payroll.employeeName}: $${payroll.netPay}`)

      } catch (error) {
        console.error(`Error generating paystub for ${payroll.employeeName}:`, error)
        errorCount++
        
        results.push({
          employeeId: payroll.employeeId,
          employeeName: payroll.employeeName,
          payrollId: payroll.id,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    console.log(`Paystub generation completed: ${generatedCount} generated, ${errorCount} errors, ${skippedCount} skipped`)

    return NextResponse.json({
      success: true,
      message: `Generated ${generatedCount} paystubs for Week ${week}, ${year}`,
      summary: {
        totalPayrolls: payrollRecords.length,
        generated: generatedCount,
        errors: errorCount,
        skipped: skippedCount,
        totalNetPay: results.reduce((sum, r) => sum + (r.netPay || 0), 0)
      },
      results
    })

  } catch (error) {
    console.error('Error generating paystubs:', error)
    return NextResponse.json(
      { error: 'Failed to generate paystubs' },
      { status: 500 }
    )
  }
}

// Create new paystub
async function createPaystub(payroll: any, generatedBy: string, autoApprove: boolean) {
  const paystub = await prisma.paystub.create({
    data: {
      payrollId: payroll.id,
      employeeId: payroll.employeeId,
      employeeName: payroll.employeeName,
      weekStartDate: payroll.weekStartDate,
      weekEndDate: payroll.weekEndDate,
      payDate: payroll.payDate,
      
      // Payment method snapshot
      paymentMethod: payroll.paymentMethod,
      basePayRate: payroll.basePayRate,
      
      // Load information
      totalMiles: payroll.totalMiles,
      totalLoads: payroll.totalLoads,
      grossRevenue: payroll.grossRevenue,
      
      // Earnings
      basePay: payroll.basePay,
      bonusAmount: payroll.bonusAmount,
      overtime: payroll.overtime,
      reimbursements: payroll.reimbursements,
      otherEarnings: payroll.otherEarnings,
      
      // Deductions
      totalDeductions: payroll.totalDeductions,
      fuelDeductions: payroll.fuelDeductions,
      advanceRepayments: payroll.advanceRepayments,
      otherDeductions: payroll.otherDeductions,
      
      // Final calculations
      grossPay: payroll.grossPay,
      netPay: payroll.netPay,
      
      // Status
      status: autoApprove ? 'APPROVED' : 'DRAFT',
      generatedDate: new Date().toISOString(),
      approvedDate: autoApprove ? new Date().toISOString() : null,
      
      // System info
      createdDate: new Date().toISOString(),
      createdBy: generatedBy || 'system'
    }
  })

  return paystub
}

// Update existing paystub
async function updatePaystub(paystubId: number, payroll: any, generatedBy: string) {
  const updatedPaystub = await prisma.paystub.update({
    where: { id: paystubId },
    data: {
      // Payment method snapshot
      paymentMethod: payroll.paymentMethod,
      basePayRate: payroll.basePayRate,
      
      // Load information
      totalMiles: payroll.totalMiles,
      totalLoads: payroll.totalLoads,
      grossRevenue: payroll.grossRevenue,
      
      // Earnings
      basePay: payroll.basePay,
      bonusAmount: payroll.bonusAmount,
      overtime: payroll.overtime,
      reimbursements: payroll.reimbursements,
      otherEarnings: payroll.otherEarnings,
      
      // Deductions
      totalDeductions: payroll.totalDeductions,
      fuelDeductions: payroll.fuelDeductions,
      advanceRepayments: payroll.advanceRepayments,
      otherDeductions: payroll.otherDeductions,
      
      // Final calculations
      grossPay: payroll.grossPay,
      netPay: payroll.netPay,
      
      // Update timestamps
      modifiedDate: new Date().toISOString()
    }
  })

  return updatedPaystub
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  })
}

function getCurrentWeekNumber(dateString: string): number {
  const date = new Date(dateString)
  const start = new Date(date.getFullYear(), 0, 1)
  const diff = date.getTime() - start.getTime()
  const oneWeek = 1000 * 60 * 60 * 24 * 7
  return Math.ceil(diff / oneWeek)
}
