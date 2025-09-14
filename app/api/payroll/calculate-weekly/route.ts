import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/calculate-weekly - Calculate payroll for a specific week
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { year, week, startDate, endDate, calculatedBy } = body

    if (!year || !week || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Year, week, startDate, and endDate are required' },
        { status: 400 }
      )
    }

    console.log(`Calculating weekly payroll for Week ${week}, ${year} (${startDate} to ${endDate})`)

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: {
        status: 'ACTIVE'
      },
      orderBy: {
        name: 'asc'
      }
    })

    if (employees.length === 0) {
      return NextResponse.json(
        { error: 'No active employees found' },
        { status: 404 }
      )
    }

    const results = []
    let processedCount = 0
    let errorCount = 0

    // Process each employee
    for (const employee of employees) {
      try {
        console.log(`Processing payroll for employee: ${employee.name} (ID: ${employee.id})`)

        // Get delivered and paid loads for this employee in the date range
        const loads = await prisma.load.findMany({
          where: {
            driverId: employee.id,
            status: {
              in: ['DELIVERED', 'PAID']
            },
            deliveryDate: {
              gte: startDate,
              lte: endDate
            }
          },
          orderBy: {
            deliveryDate: 'asc'
          }
        })

        console.log(`Found ${loads.length} loads for ${employee.name}`)

        // Skip employees with no loads for this week
        if (loads.length === 0) {
          console.log(`Skipping ${employee.name} - no loads for this week`)
          continue
        }

        // Calculate totals from loads
        const totalLoads = loads.length
        const grossRevenue = loads.reduce((sum, load) => sum + load.grossAmount, 0)
        const totalMiles = loads.reduce((sum, load) => sum + (load.finalMiles || 0), 0)

        // Calculate base pay based on payment method
        let basePay = 0
        let paymentMethod = employee.paymentMethod || 'PERCENTAGE'

        switch (paymentMethod) {
          case 'PERCENTAGE':
            // Calculate based on percentage after service fee
            const serviceFeePercent = employee.serviceFeePercent || 0
            const driverPercent = employee.driverPercent || 75
            
            const grossAfterServiceFee = grossRevenue * (1 - serviceFeePercent / 100)
            basePay = grossAfterServiceFee * (driverPercent / 100)
            break

          case 'PAY_PER_MILE':
            const payPerMileRate = employee.payPerMileRate || 0
            basePay = totalMiles * payPerMileRate
            break

          case 'FLAT_RATE':
            // For flat rate, sum up the driver rates from individual loads
            basePay = loads.reduce((sum, load) => sum + load.driverRate, 0)
            break

          default:
            console.warn(`Unknown payment method ${paymentMethod} for employee ${employee.name}`)
            basePay = loads.reduce((sum, load) => sum + load.driverRate, 0)
        }

        // Get fuel deductions for this employee and week
        const fuelDeductions = await calculateFuelDeductions(employee.id, startDate, endDate)

        // Get advance repayments for this week
        const advanceRepayments = await calculateAdvanceRepayments(employee.id, startDate)

        // Get other deductions (recurring, adjustments, etc.)
        const otherDeductions = await calculateOtherDeductions(employee.id, startDate)

        // Calculate totals
        const totalDeductions = fuelDeductions + advanceRepayments + otherDeductions
        const grossPay = basePay
        const netPay = Math.max(0, grossPay - totalDeductions)

        // Create or update individual payroll record
        const payrollData = {
          employeeId: employee.id,
          employeeName: employee.name,
          weekStartDate: startDate,
          weekEndDate: endDate,
          payDate: calculatePayDate(endDate),
          
          totalLoads,
          totalMiles,
          grossRevenue,
          
          paymentMethod,
          basePayRate: getBasePayRate(employee, paymentMethod),
          basePay: Math.round(basePay * 100) / 100,
          
          bonusAmount: 0, // Will be calculated separately
          reimbursements: 0, // Will be calculated separately  
          overtime: 0, // Will be calculated separately
          otherEarnings: 0, // Will be calculated separately
          
          totalDeductions: Math.round(totalDeductions * 100) / 100,
          fuelDeductions: Math.round(fuelDeductions * 100) / 100,
          advanceRepayments: Math.round(advanceRepayments * 100) / 100,
          otherDeductions: Math.round(otherDeductions * 100) / 100,
          
          grossPay: Math.round(grossPay * 100) / 100,
          netPay: Math.round(netPay * 100) / 100,
          
          status: 'CALCULATED',
          isLocked: false,
          
          calculatedDate: new Date().toISOString(),
          calculatedBy: calculatedBy || 'system',
          
          notes: `Auto-calculated for Week ${week}, ${year}`,
          
          createdDate: new Date().toISOString(),
          createdBy: calculatedBy || 'system'
        }

        // Upsert the payroll record
        const payrollRecord = await prisma.individualPayroll.upsert({
          where: {
            employeeId_weekStartDate: {
              employeeId: employee.id,
              weekStartDate: startDate
            }
          },
          update: payrollData,
          create: payrollData
        })

        // Create payroll load entries
        await createPayrollLoadEntries(payrollRecord.id, loads)

        results.push({
          employeeId: employee.id,
          employeeName: employee.name,
          payrollId: payrollRecord.id,
          totalLoads,
          grossPay: payrollData.grossPay,
          netPay: payrollData.netPay,
          status: 'success'
        })

        processedCount++
        console.log(`Successfully processed payroll for ${employee.name}`)

      } catch (error) {
        console.error(`Error processing payroll for employee ${employee.name}:`, error)
        errorCount++
        
        results.push({
          employeeId: employee.id,
          employeeName: employee.name,
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'error'
        })
      }
    }

    console.log(`Payroll calculation completed: ${processedCount} processed, ${errorCount} errors`)

    return NextResponse.json({
      success: true,
      message: `Payroll calculated for Week ${week}, ${year}`,
      summary: {
        totalEmployees: employees.length,
        processedCount,
        errorCount,
        skippedCount: employees.length - processedCount - errorCount
      },
      results
    })

  } catch (error) {
    console.error('Error calculating weekly payroll:', error)
    return NextResponse.json(
      { error: 'Failed to calculate weekly payroll' },
      { status: 500 }
    )
  }
}

// Helper function to calculate fuel deductions
async function calculateFuelDeductions(employeeId: number, startDate: string, endDate: string): Promise<number> {
  try {
    // Get employee name for fuel transaction lookup
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { name: true }
    })

    if (!employee) return 0

    // Get fuel transactions for this employee and date range
    const fuelTransactions = await prisma.fuelTransaction.findMany({
      where: {
        driverName: employee.name,
        tranDate: {
          gte: startDate,
          lte: endDate
        }
      }
    })

    const totalFuel = fuelTransactions.reduce((sum, transaction) => {
      return sum + transaction.amt + transaction.fees
    }, 0)

    return totalFuel

  } catch (error) {
    console.error('Error calculating fuel deductions:', error)
    return 0
  }
}

// Helper function to calculate advance repayments
async function calculateAdvanceRepayments(employeeId: number, weekStartDate: string): Promise<number> {
  try {
    // Get active advances that need repayment this week
    const advances = await prisma.payrollAdvance.findMany({
      where: {
        employeeId,
        status: 'ACTIVE',
        weekStartDate: weekStartDate,
        advanceType: 'REPAYMENT'
      }
    })

    const totalRepayments = advances.reduce((sum, advance) => {
      return sum + Math.abs(advance.amount) // Repayments are stored as negative amounts
    }, 0)

    return totalRepayments

  } catch (error) {
    console.error('Error calculating advance repayments:', error)
    return 0
  }
}

// Helper function to calculate other deductions
async function calculateOtherDeductions(employeeId: number, weekStartDate: string): Promise<number> {
  try {
    // Get recurring deductions for this week
    const recurringDeductions = await prisma.payrollRecurring.findMany({
      where: {
        driverId: employeeId,
        weekStart: weekStartDate,
        isActive: true
      }
    })

    const totalRecurring = recurringDeductions.reduce((sum, deduction) => {
      return sum + deduction.amount
    }, 0)

    // Get other adjustments (deductions) for this week
    const adjustments = await prisma.payrollAdjustment.findMany({
      where: {
        employeeId,
        weekStartDate: weekStartDate,
        category: 'DEDUCTION',
        status: 'ACTIVE'
      }
    })

    const totalAdjustments = adjustments.reduce((sum, adjustment) => {
      return sum + adjustment.amount
    }, 0)

    return totalRecurring + totalAdjustments

  } catch (error) {
    console.error('Error calculating other deductions:', error)
    return 0
  }
}

// Helper function to calculate pay date (typically Friday of the following week)
function calculatePayDate(weekEndDate: string): string {
  const endDate = new Date(weekEndDate)
  const payDate = new Date(endDate)
  
  // Add 5 days to get to Friday of the following week
  payDate.setDate(endDate.getDate() + 5)
  
  return payDate.toISOString().split('T')[0]
}

// Helper function to get base pay rate for display
function getBasePayRate(employee: any, paymentMethod: string): number {
  switch (paymentMethod) {
    case 'PERCENTAGE':
      return employee.driverPercent || 0
    case 'PAY_PER_MILE':
      return employee.payPerMileRate || 0
    case 'FLAT_RATE':
      return 0 // Flat rate varies per load
    default:
      return 0
  }
}

// Helper function to create payroll load entries
async function createPayrollLoadEntries(payrollId: number, loads: any[]): Promise<void> {
  try {
    // Delete existing entries
    await prisma.payrollLoad.deleteMany({
      where: { payrollId }
    })

    // Create new entries
    const loadEntries = loads.map(load => ({
      payrollId,
      loadId: load.id,
      loadNumber: load.loadNumber,
      grossAmount: load.grossAmount,
      driverRate: load.driverRate,
      finalMiles: load.finalMiles || 0,
      deliveryDate: load.deliveryDate,
      paymentMethod: load.paymentMethod,
      payPerMileRate: load.payPerMileRate || 0,
      driverPercent: 0, // Will be filled from employee data if needed
      isIncluded: true,
      createdDate: new Date().toISOString()
    }))

    if (loadEntries.length > 0) {
      await prisma.payrollLoad.createMany({
        data: loadEntries
      })
    }

  } catch (error) {
    console.error('Error creating payroll load entries:', error)
    // Don't throw - this is not critical for payroll calculation
  }
}
