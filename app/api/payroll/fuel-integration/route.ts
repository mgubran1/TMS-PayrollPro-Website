import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/fuel-integration - Import fuel transactions into payroll
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { year, week, startDate, endDate, processedBy } = body

    if (!year || !week || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Year, week, startDate, and endDate are required' },
        { status: 400 }
      )
    }

    console.log(`Importing fuel transactions for Week ${week}, ${year} (${startDate} to ${endDate})`)

    // Get all fuel transactions for the date range
    const fuelTransactions = await prisma.fuelTransaction.findMany({
      where: {
        tranDate: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: [
        { driverName: 'asc' },
        { tranDate: 'asc' }
      ]
    })

    if (fuelTransactions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No fuel transactions found for the specified date range',
        imported: 0,
        skipped: 0,
        errors: 0
      })
    }

    console.log(`Found ${fuelTransactions.length} fuel transactions to process`)

    // Group by driver name
    const transactionsByDriver = new Map<string, any[]>()
    for (const transaction of fuelTransactions) {
      const driverName = transaction.driverName
      if (!transactionsByDriver.has(driverName)) {
        transactionsByDriver.set(driverName, [])
      }
      transactionsByDriver.get(driverName)!.push(transaction)
    }

    const results = []
    let importedCount = 0
    let skippedCount = 0
    let errorCount = 0

    // Process each driver's fuel transactions
    for (const [driverName, transactions] of transactionsByDriver.entries()) {
      try {
        console.log(`Processing ${transactions.length} fuel transactions for driver: ${driverName}`)

        // Find employee by name
        const employee = await prisma.employee.findFirst({
          where: {
            name: {
              equals: driverName,
              mode: 'insensitive'
            },
            status: 'ACTIVE'
          }
        })

        if (!employee) {
          console.warn(`Employee not found for driver name: ${driverName}`)
          skippedCount += transactions.length
          
          results.push({
            driverName,
            status: 'skipped',
            reason: 'Employee not found',
            transactionCount: transactions.length
          })
          continue
        }

        // Find or create individual payroll record
        let payroll = await prisma.individualPayroll.findFirst({
          where: {
            employeeId: employee.id,
            weekStartDate: startDate
          }
        })

        if (!payroll) {
          // Create new payroll record if it doesn't exist
          payroll = await prisma.individualPayroll.create({
            data: {
              employeeId: employee.id,
              employeeName: employee.name,
              weekStartDate: startDate,
              weekEndDate: endDate,
              payDate: calculatePayDate(endDate),
              totalLoads: 0,
              totalMiles: 0,
              grossRevenue: 0,
              paymentMethod: employee.paymentMethod,
              basePayRate: getBasePayRate(employee),
              basePay: 0,
              bonusAmount: 0,
              reimbursements: 0,
              overtime: 0,
              otherEarnings: 0,
              totalDeductions: 0,
              fuelDeductions: 0,
              advanceRepayments: 0,
              otherDeductions: 0,
              grossPay: 0,
              netPay: 0,
              status: 'DRAFT',
              isLocked: false,
              createdDate: new Date().toISOString(),
              createdBy: processedBy || 'fuel-import'
            }
          })
        }

        // Check if payroll is locked
        if (payroll.isLocked) {
          console.warn(`Payroll is locked for ${driverName}, Week ${week}, ${year}`)
          skippedCount += transactions.length
          
          results.push({
            driverName,
            employeeId: employee.id,
            status: 'skipped',
            reason: 'Payroll week is locked',
            transactionCount: transactions.length
          })
          continue
        }

        // Process fuel transactions for this driver
        let driverImportedCount = 0
        
        for (const transaction of transactions) {
          try {
            // Check if this fuel transaction is already imported
            const existingIntegration = await prisma.payrollFuelIntegration.findFirst({
              where: {
                fuelTransactionId: transaction.id,
                weekStartDate: startDate
              }
            })

            if (existingIntegration) {
              console.log(`Fuel transaction ${transaction.invoice} already imported for ${driverName}`)
              continue
            }

            // Create fuel integration record
            await prisma.payrollFuelIntegration.create({
              data: {
                payrollId: payroll.id,
                fuelTransactionId: transaction.id,
                employeeId: employee.id,
                fuelInvoice: transaction.invoice,
                fuelAmount: transaction.amt + transaction.fees,
                fuelDate: transaction.tranDate,
                location: transaction.locationName || 'Unknown',
                weekStartDate: startDate,
                isIncluded: true,
                deductionAmount: transaction.amt + transaction.fees,
                processedDate: new Date().toISOString(),
                processedBy: processedBy || 'fuel-import',
                createdDate: new Date().toISOString()
              }
            })

            driverImportedCount++
            importedCount++

          } catch (transactionError) {
            console.error(`Error processing fuel transaction ${transaction.invoice}:`, transactionError)
            errorCount++
          }
        }

        // Update payroll fuel deductions total
        const totalFuelDeductions = await calculateTotalFuelDeductions(payroll.id)
        
        await prisma.individualPayroll.update({
          where: { id: payroll.id },
          data: {
            fuelDeductions: totalFuelDeductions,
            totalDeductions: payroll.totalDeductions - payroll.fuelDeductions + totalFuelDeductions,
            netPay: payroll.grossPay - (payroll.totalDeductions - payroll.fuelDeductions + totalFuelDeductions),
            modifiedDate: new Date().toISOString(),
            status: payroll.status === 'DRAFT' ? 'DRAFT' : 'CALCULATED'
          }
        })

        results.push({
          driverName,
          employeeId: employee.id,
          payrollId: payroll.id,
          status: 'success',
          transactionCount: transactions.length,
          importedCount: driverImportedCount,
          totalFuelAmount: transactions.reduce((sum, t) => sum + t.amt + t.fees, 0)
        })

        console.log(`Successfully imported ${driverImportedCount}/${transactions.length} fuel transactions for ${driverName}`)

      } catch (error) {
        console.error(`Error processing fuel transactions for ${driverName}:`, error)
        errorCount += transactions.length
        
        results.push({
          driverName,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          transactionCount: transactions.length
        })
      }
    }

    console.log(`Fuel import completed: ${importedCount} imported, ${skippedCount} skipped, ${errorCount} errors`)

    return NextResponse.json({
      success: true,
      message: `Fuel import completed for Week ${week}, ${year}`,
      summary: {
        totalTransactions: fuelTransactions.length,
        driversProcessed: transactionsByDriver.size,
        imported: importedCount,
        skipped: skippedCount,
        errors: errorCount
      },
      results
    })

  } catch (error) {
    console.error('Error importing fuel transactions:', error)
    return NextResponse.json(
      { error: 'Failed to import fuel transactions' },
      { status: 500 }
    )
  }
}

// GET /api/payroll/fuel-integration - Get fuel integration status for a week
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = parseInt(searchParams.get('year') || '0')
    const week = parseInt(searchParams.get('week') || '0')
    const startDate = searchParams.get('startDate')

    if (!year || !week || !startDate) {
      return NextResponse.json(
        { error: 'Year, week, and startDate are required' },
        { status: 400 }
      )
    }

    // Get fuel integrations for the week
    const fuelIntegrations = await prisma.payrollFuelIntegration.findMany({
      where: {
        weekStartDate: startDate
      },
      include: {
        payroll: {
          select: {
            employeeName: true,
            isLocked: true
          }
        }
      },
      orderBy: [
        { employeeId: 'asc' },
        { fuelDate: 'asc' }
      ]
    })

    // Group by employee
    const integrationsByEmployee = new Map<number, any[]>()
    for (const integration of fuelIntegrations) {
      const employeeId = integration.employeeId
      if (!integrationsByEmployee.has(employeeId)) {
        integrationsByEmployee.set(employeeId, [])
      }
      integrationsByEmployee.get(employeeId)!.push(integration)
    }

    const summary = Array.from(integrationsByEmployee.entries()).map(([employeeId, integrations]) => ({
      employeeId,
      employeeName: integrations[0]?.payroll?.employeeName || 'Unknown',
      transactionCount: integrations.length,
      totalAmount: integrations.reduce((sum, i) => sum + i.fuelAmount, 0),
      includedCount: integrations.filter(i => i.isIncluded).length,
      excludedCount: integrations.filter(i => !i.isIncluded).length,
      isLocked: integrations[0]?.payroll?.isLocked || false
    }))

    return NextResponse.json({
      week,
      year,
      startDate,
      totalIntegrations: fuelIntegrations.length,
      employeeCount: integrationsByEmployee.size,
      totalAmount: fuelIntegrations.reduce((sum, i) => sum + i.fuelAmount, 0),
      summary,
      integrations: fuelIntegrations
    })

  } catch (error) {
    console.error('Error fetching fuel integration status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch fuel integration status' },
      { status: 500 }
    )
  }
}

// Helper function to calculate pay date
function calculatePayDate(weekEndDate: string): string {
  const endDate = new Date(weekEndDate)
  const payDate = new Date(endDate)
  payDate.setDate(endDate.getDate() + 5)
  return payDate.toISOString().split('T')[0]
}

// Helper function to get base pay rate
function getBasePayRate(employee: any): number {
  switch (employee.paymentMethod) {
    case 'PERCENTAGE':
      return employee.driverPercent || 0
    case 'PAY_PER_MILE':
      return employee.payPerMileRate || 0
    case 'FLAT_RATE':
      return 0
    default:
      return 0
  }
}

// Helper function to calculate total fuel deductions for a payroll
async function calculateTotalFuelDeductions(payrollId: number): Promise<number> {
  const fuelIntegrations = await prisma.payrollFuelIntegration.findMany({
    where: {
      payrollId,
      isIncluded: true
    }
  })

  return fuelIntegrations.reduce((sum, integration) => sum + integration.deductionAmount, 0)
}
