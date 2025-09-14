import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/individual/[id] - Get individual employee payroll data
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = parseInt(params.id)
    const { searchParams } = new URL(req.url)
    const weekStartDate = searchParams.get('weekStartDate')
    const includePaystub = searchParams.get('includePaystub') !== 'false'

    if (isNaN(employeeId)) {
      return NextResponse.json(
        { error: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    // Build where clause
    const where: any = { employeeId }
    if (weekStartDate) {
      where.weekStartDate = weekStartDate
    }

    // Get payroll record(s)
    const payrollRecords = await prisma.individualPayroll.findMany({
      where,
      include: {
        loads: {
          orderBy: { deliveryDate: 'asc' }
        },
        adjustments: {
          where: { status: 'ACTIVE' },
          orderBy: { effectiveDate: 'desc' }
        },
        fuelIntegrations: {
          where: { isIncluded: true },
          orderBy: { fuelDate: 'desc' }
        },
        paystub: includePaystub
      },
      orderBy: { weekStartDate: 'desc' }
    })

    if (payrollRecords.length === 0) {
      return NextResponse.json(
        { error: 'No payroll records found for this employee' },
        { status: 404 }
      )
    }

    // Get employee details
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        truckUnit: true,
        paymentMethod: true,
        driverPercent: true,
        payPerMileRate: true,
        status: true,
        totalEarningsYTD: true,
        totalDeductionsYTD: true,
        advanceBalance: true,
        escrowBalance: true
      }
    })

    // If requesting specific week, return single record
    if (weekStartDate && payrollRecords.length === 1) {
      const payroll = payrollRecords[0]
      
      // Calculate additional statistics
      const stats = {
        averagePayPerLoad: payroll.totalLoads > 0 ? payroll.grossPay / payroll.totalLoads : 0,
        averagePayPerMile: payroll.totalMiles > 0 ? payroll.grossPay / payroll.totalMiles : 0,
        deductionPercentage: payroll.grossPay > 0 ? (payroll.totalDeductions / payroll.grossPay) * 100 : 0,
        fuelCostPerMile: payroll.totalMiles > 0 ? payroll.fuelDeductions / payroll.totalMiles : 0
      }

      return NextResponse.json({
        employee,
        payroll,
        paystub: payroll.paystub,
        stats,
        summary: {
          totalLoads: payroll.totalLoads,
          totalMiles: payroll.totalMiles,
          grossRevenue: payroll.grossRevenue,
          grossPay: payroll.grossPay,
          totalDeductions: payroll.totalDeductions,
          netPay: payroll.netPay,
          paymentMethod: payroll.paymentMethod,
          weekStartDate: payroll.weekStartDate,
          weekEndDate: payroll.weekEndDate,
          status: payroll.status,
          isLocked: payroll.isLocked
        }
      })
    }

    // Return multiple records for historical view
    const summary = {
      totalRecords: payrollRecords.length,
      totalGrossPay: payrollRecords.reduce((sum, p) => sum + p.grossPay, 0),
      totalDeductions: payrollRecords.reduce((sum, p) => sum + p.totalDeductions, 0),
      totalNetPay: payrollRecords.reduce((sum, p) => sum + p.netPay, 0),
      totalLoads: payrollRecords.reduce((sum, p) => sum + p.totalLoads, 0),
      totalMiles: payrollRecords.reduce((sum, p) => sum + p.totalMiles, 0),
      averageWeeklyPay: payrollRecords.length > 0 ? payrollRecords.reduce((sum, p) => sum + p.netPay, 0) / payrollRecords.length : 0
    }

    return NextResponse.json({
      employee,
      payrollRecords,
      summary
    })

  } catch (error) {
    console.error('Error fetching individual payroll:', error)
    return NextResponse.json(
      { error: 'Failed to fetch individual payroll data' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll/individual/[id] - Update individual payroll record
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = parseInt(params.id)
    const body = await req.json()
    const {
      payrollId,
      weekStartDate,
      bonusAmount,
      reimbursements,
      overtime,
      otherEarnings,
      notes,
      status,
      updatedBy
    } = body

    if (isNaN(employeeId)) {
      return NextResponse.json(
        { error: 'Invalid employee ID' },
        { status: 400 }
      )
    }

    // Find the payroll record to update
    let payroll
    if (payrollId) {
      payroll = await prisma.individualPayroll.findFirst({
        where: {
          id: payrollId,
          employeeId
        }
      })
    } else if (weekStartDate) {
      payroll = await prisma.individualPayroll.findFirst({
        where: {
          employeeId,
          weekStartDate
        }
      })
    } else {
      return NextResponse.json(
        { error: 'Must provide either payrollId or weekStartDate' },
        { status: 400 }
      )
    }

    if (!payroll) {
      return NextResponse.json(
        { error: 'Payroll record not found' },
        { status: 404 }
      )
    }

    // Check if payroll is locked
    if (payroll.isLocked) {
      return NextResponse.json(
        { error: 'Cannot update locked payroll record' },
        { status: 400 }
      )
    }

    // Update the payroll record
    const updateData: any = {
      modifiedDate: new Date().toISOString()
    }

    if (bonusAmount !== undefined) updateData.bonusAmount = bonusAmount
    if (reimbursements !== undefined) updateData.reimbursements = reimbursements
    if (overtime !== undefined) updateData.overtime = overtime
    if (otherEarnings !== undefined) updateData.otherEarnings = otherEarnings
    if (notes !== undefined) updateData.notes = notes
    if (status !== undefined) updateData.status = status

    // Recalculate totals if earnings changed
    if (bonusAmount !== undefined || reimbursements !== undefined || 
        overtime !== undefined || otherEarnings !== undefined) {
      
      const newGrossPay = payroll.basePay + 
        (bonusAmount !== undefined ? bonusAmount : payroll.bonusAmount) +
        (reimbursements !== undefined ? reimbursements : payroll.reimbursements) +
        (overtime !== undefined ? overtime : payroll.overtime) +
        (otherEarnings !== undefined ? otherEarnings : payroll.otherEarnings)
      
      const newNetPay = Math.max(0, newGrossPay - payroll.totalDeductions)
      
      updateData.grossPay = newGrossPay
      updateData.netPay = newNetPay
    }

    const updatedPayroll = await prisma.individualPayroll.update({
      where: { id: payroll.id },
      data: updateData,
      include: {
        loads: true,
        adjustments: true,
        fuelIntegrations: true,
        paystub: true
      }
    })

    // Update associated paystub if it exists
    if (updatedPayroll.paystub) {
      await prisma.paystub.update({
        where: { id: updatedPayroll.paystub.id },
        data: {
          bonusAmount: updatedPayroll.bonusAmount,
          reimbursements: updatedPayroll.reimbursements,
          overtime: updatedPayroll.overtime,
          otherEarnings: updatedPayroll.otherEarnings,
          grossPay: updatedPayroll.grossPay,
          netPay: updatedPayroll.netPay,
          modifiedDate: new Date().toISOString()
        }
      })
    }

    console.log(`Updated individual payroll for employee ${employeeId}, week ${payroll.weekStartDate}`)

    return NextResponse.json({
      success: true,
      payroll: updatedPayroll,
      message: 'Payroll updated successfully'
    })

  } catch (error) {
    console.error('Error updating individual payroll:', error)
    return NextResponse.json(
      { error: 'Failed to update individual payroll' },
      { status: 500 }
    )
  }
}