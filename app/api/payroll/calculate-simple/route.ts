import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'

// Simplified payroll calculation that works with the current schema
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { payrollPeriodId } = body
    
    if (!payrollPeriodId) {
      return NextResponse.json(
        { error: 'Payroll period ID is required' },
        { status: 400 }
      )
    }

    // Get payroll period
    const payrollPeriod = await prisma.payrollPeriod.findUnique({
      where: { id: parseInt(payrollPeriodId) }
    })
    
    if (!payrollPeriod) {
      return NextResponse.json(
        { error: 'Payroll period not found' },
        { status: 404 }
      )
    }

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' }
    })

    const calculationResults = []

    for (const employee of employees) {
      console.log(`💼 Processing employee: ${employee.name} (ID: ${employee.id}) - Status: ${employee.status}`)

      // Find delivered loads in the payroll period
      const loads = await prisma.load.findMany({
        where: {
          driverId: employee.id,
          status: 'DELIVERED',
          deliveryDate: {
            gte: payrollPeriod.startDate,
            lte: payrollPeriod.endDate
          }
        }
      })

      console.log(`📦 Found ${loads.length} delivered loads in payroll period (${payrollPeriod.startDate} to ${payrollPeriod.endDate})`)

      if (loads.length === 0) {
        console.log(`⏭️  Skipping ${employee.name} - no delivered loads in period`)
        continue
      }

      // Calculate basic payroll data
      const totalMiles = loads.reduce((sum, load) => sum + (load.finalMiles || 0), 0)
      const grossRevenue = loads.reduce((sum, load) => sum + load.grossAmount, 0)
      const totalDriverPay = loads.reduce((sum, load) => sum + load.driverRate, 0)

      console.log(`💰 Payment calculations for ${employee.name}:`)
      console.log(`   Total Miles: ${totalMiles}`)
      console.log(`   Gross Revenue: $${grossRevenue.toFixed(2)}`)
      console.log(`   Total Driver Pay: $${totalDriverPay.toFixed(2)}`)

      // Create or update individual payroll
      const existingPayroll = await prisma.individualPayroll.findFirst({
        where: {
          employeeId: employee.id,
          weekStartDate: payrollPeriod.startDate,
          weekEndDate: payrollPeriod.endDate
        }
      })

      let individualPayroll
      if (existingPayroll) {
        // Update existing payroll
        individualPayroll = await prisma.individualPayroll.update({
          where: { id: existingPayroll.id },
          data: {
            totalLoads: loads.length,
            totalMiles: totalMiles,
            grossRevenue: grossRevenue,
            basePay: totalDriverPay,
            grossPay: totalDriverPay,
            netPay: totalDriverPay, // Simplified - no deductions for now
            paymentMethod: employee.paymentMethod,
            basePayRate: employee.driverPercent || 0,
            calculatedDate: new Date().toISOString(),
            calculatedBy: 'simple-calculator',
            status: 'CALCULATED'
          }
        })
      } else {
        // Create new payroll
        individualPayroll = await prisma.individualPayroll.create({
          data: {
            employeeId: employee.id,
            employeeName: employee.name,
            weekStartDate: payrollPeriod.startDate,
            weekEndDate: payrollPeriod.endDate,
            totalLoads: loads.length,
            totalMiles: totalMiles,
            grossRevenue: grossRevenue,
            basePay: totalDriverPay,
            grossPay: totalDriverPay,
            netPay: totalDriverPay, // Simplified - no deductions for now
            paymentMethod: employee.paymentMethod,
            basePayRate: employee.driverPercent || 0,
            calculatedDate: new Date().toISOString(),
            calculatedBy: 'simple-calculator',
            status: 'CALCULATED'
          }
        })
      }

      console.log(`✅ ${existingPayroll ? 'Updated' : 'Created'} individual payroll for ${employee.name}`)

      calculationResults.push({
        employeeId: employee.id,
        employeeName: employee.name,
        totalLoads: loads.length,
        totalMiles: totalMiles,
        grossRevenue: grossRevenue,
        grossPay: totalDriverPay,
        netPay: totalDriverPay,
        payrollId: individualPayroll.id
      })
    }

    console.log(`🎉 Payroll calculation complete for ${calculationResults.length} employees`)

    return NextResponse.json({
      success: true,
      payrollPeriodId: parseInt(payrollPeriodId),
      employeeCount: calculationResults.length,
      calculations: calculationResults,
      message: `Successfully calculated payroll for ${calculationResults.length} employees`
    })

  } catch (error) {
    console.error('Error calculating payroll:', error)
    return NextResponse.json(
      { error: 'Failed to calculate payroll', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
