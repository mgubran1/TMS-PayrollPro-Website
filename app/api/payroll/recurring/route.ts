import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/recurring - Get recurring deductions
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const driverId = searchParams.get('driverId')
    const weekStart = searchParams.get('weekStart')
    const isActive = searchParams.get('isActive')
    const recurringType = searchParams.get('recurringType')

    // Build where clause
    const where: any = {}
    if (driverId) {
      where.driverId = parseInt(driverId)
    }
    if (weekStart) {
      where.weekStart = weekStart
    }
    if (isActive !== null && isActive !== undefined) {
      where.isActive = isActive === 'true'
    }
    if (recurringType && recurringType !== 'all') {
      where.recurringType = recurringType
    }

    // Get recurring deductions
    const deductions = await prisma.payrollRecurring.findMany({
      where,
      orderBy: [
        { driverId: 'asc' },
        { recurringType: 'asc' },
        { weekStart: 'desc' }
      ]
    })

    // Get employee names for the deductions
    const driverIds = [...new Set(deductions.map(d => d.driverId))]
    const employees = await prisma.employee.findMany({
      where: {
        id: { in: driverIds }
      },
      select: { id: true, name: true }
    })

    const employeeMap = new Map(employees.map(emp => [emp.id, emp.name]))

    // Enhance deductions with employee names
    const enhancedDeductions = deductions.map(deduction => ({
      ...deduction,
      driverName: employeeMap.get(deduction.driverId) || 'Unknown'
    }))

    // Calculate summary statistics
    const summary = {
      totalDeductions: deductions.length,
      activeDeductions: deductions.filter(d => d.isActive).length,
      totalAmount: deductions.filter(d => d.isActive).reduce((sum, d) => sum + d.amount, 0),
      byType: {} as { [key: string]: { count: number, amount: number } }
    }

    // Group by recurring type
    const recurringTypes = ['ELD', 'IFTA', 'TVC', 'PARKING', 'PRE-PASS', 'OTHER']
    for (const type of recurringTypes) {
      const typeDeductions = deductions.filter(d => d.recurringType === type && d.isActive)
      summary.byType[type] = {
        count: typeDeductions.length,
        amount: typeDeductions.reduce((sum, d) => sum + d.amount, 0)
      }
    }

    return NextResponse.json({
      deductions: enhancedDeductions,
      summary
    })

  } catch (error) {
    console.error('Error fetching recurring deductions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recurring deductions' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/recurring - Create recurring deduction
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      driverId,
      weekStart,
      recurringType,
      amount,
      description,
      frequency,
      isActive,
      isRecurring,
      endDate,
      createdBy
    } = body

    // Validate required fields
    if (!driverId || !weekStart || !recurringType || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: driverId, weekStart, recurringType, amount' },
        { status: 400 }
      )
    }

    // Validate recurring type
    const validTypes = ['ELD', 'IFTA', 'TVC', 'PARKING', 'PRE-PASS', 'OTHER']
    if (!validTypes.includes(recurringType)) {
      return NextResponse.json(
        { error: 'Invalid recurring type. Must be one of: ' + validTypes.join(', ') },
        { status: 400 }
      )
    }

    // Validate amount
    if (amount <= 0 || amount > 1000) {
      return NextResponse.json(
        { error: 'Amount must be between $0.01 and $1,000' },
        { status: 400 }
      )
    }

    // Check if employee exists
    const employee = await prisma.employee.findUnique({
      where: { id: driverId },
      select: { name: true, status: true }
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check for duplicate recurring deduction
    const existingDeduction = await prisma.payrollRecurring.findFirst({
      where: {
        driverId,
        weekStart,
        recurringType,
        isActive: true
      }
    })

    if (existingDeduction) {
      return NextResponse.json(
        { error: `Active ${recurringType} deduction already exists for this driver and week` },
        { status: 409 }
      )
    }

    // Calculate next deduction date based on frequency
    const nextDeductionDate = calculateNextDeductionDate(weekStart, frequency || 'WEEKLY')

    // Create recurring deduction
    const recurringDeduction = await prisma.payrollRecurring.create({
      data: {
        driverId,
        weekStart,
        recurringType,
        amount,
        description: description || `${recurringType} fee`,
        isActive: isActive !== undefined ? isActive : true,
        isRecurring: isRecurring !== undefined ? isRecurring : true,
        frequency: frequency || 'WEEKLY',
        nextDeductionDate,
        endDate: endDate || null,
        createdDate: new Date().toISOString(),
        createdBy: createdBy || 'system'
      }
    })

    console.log(`Created recurring deduction: ${recurringType} for driver ${driverId} - $${amount} ${frequency}`)

    // If this is for the current week and there's an existing payroll, update it
    try {
      await updatePayrollWithRecurringDeduction(driverId, weekStart, amount)
    } catch (payrollError) {
      console.warn('Failed to update payroll with recurring deduction:', payrollError)
      // Don't fail the creation if payroll update fails
    }

    return NextResponse.json({
      success: true,
      deduction: recurringDeduction,
      message: `${recurringType} recurring deduction created successfully`
    })

  } catch (error) {
    console.error('Error creating recurring deduction:', error)
    return NextResponse.json(
      { error: 'Failed to create recurring deduction' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll/recurring - Update recurring deduction
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      id,
      amount,
      description,
      frequency,
      isActive,
      isRecurring,
      endDate,
      nextDeductionDate
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Deduction ID is required' },
        { status: 400 }
      )
    }

    // Get existing deduction
    const existingDeduction = await prisma.payrollRecurring.findUnique({
      where: { id }
    })

    if (!existingDeduction) {
      return NextResponse.json(
        { error: 'Recurring deduction not found' },
        { status: 404 }
      )
    }

    // Update the deduction
    const updatedDeduction = await prisma.payrollRecurring.update({
      where: { id },
      data: {
        amount: amount !== undefined ? amount : existingDeduction.amount,
        description: description !== undefined ? description : existingDeduction.description,
        frequency: frequency || existingDeduction.frequency,
        isActive: isActive !== undefined ? isActive : existingDeduction.isActive,
        isRecurring: isRecurring !== undefined ? isRecurring : existingDeduction.isRecurring,
        endDate: endDate !== undefined ? endDate : existingDeduction.endDate,
        nextDeductionDate: nextDeductionDate !== undefined ? nextDeductionDate : existingDeduction.nextDeductionDate,
        modifiedDate: new Date().toISOString()
      }
    })

    console.log(`Updated recurring deduction ${id}`)

    // Update payroll if amount changed
    if (amount !== undefined && amount !== existingDeduction.amount) {
      try {
        const amountDifference = amount - existingDeduction.amount
        await updatePayrollWithRecurringDeduction(
          existingDeduction.driverId,
          existingDeduction.weekStart,
          amountDifference
        )
      } catch (payrollError) {
        console.warn('Failed to update payroll with recurring deduction change:', payrollError)
      }
    }

    return NextResponse.json({
      success: true,
      deduction: updatedDeduction,
      message: 'Recurring deduction updated successfully'
    })

  } catch (error) {
    console.error('Error updating recurring deduction:', error)
    return NextResponse.json(
      { error: 'Failed to update recurring deduction' },
      { status: 500 }
    )
  }
}

// DELETE /api/payroll/recurring - Delete recurring deduction
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = parseInt(searchParams.get('id') || '0')

    if (!id) {
      return NextResponse.json(
        { error: 'Deduction ID is required' },
        { status: 400 }
      )
    }

    // Get existing deduction
    const existingDeduction = await prisma.payrollRecurring.findUnique({
      where: { id }
    })

    if (!existingDeduction) {
      return NextResponse.json(
        { error: 'Recurring deduction not found' },
        { status: 404 }
      )
    }

    // Delete the deduction
    await prisma.payrollRecurring.delete({
      where: { id }
    })

    console.log(`Deleted recurring deduction ${id}`)

    // Update payroll to remove this deduction
    try {
      await updatePayrollWithRecurringDeduction(
        existingDeduction.driverId,
        existingDeduction.weekStart,
        -existingDeduction.amount
      )
    } catch (payrollError) {
      console.warn('Failed to update payroll after deleting recurring deduction:', payrollError)
    }

    return NextResponse.json({
      success: true,
      message: 'Recurring deduction deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting recurring deduction:', error)
    return NextResponse.json(
      { error: 'Failed to delete recurring deduction' },
      { status: 500 }
    )
  }
}

// Helper function to calculate next deduction date
function calculateNextDeductionDate(currentWeekStart: string, frequency: string): string {
  const date = new Date(currentWeekStart)
  
  switch (frequency) {
    case 'WEEKLY':
      date.setDate(date.getDate() + 7)
      break
    case 'BI_WEEKLY':
      date.setDate(date.getDate() + 14)
      break
    case 'MONTHLY':
      date.setMonth(date.getMonth() + 1)
      break
    default:
      date.setDate(date.getDate() + 7)
  }
  
  return date.toISOString().split('T')[0]
}

// Helper function to update payroll with recurring deduction changes
async function updatePayrollWithRecurringDeduction(
  driverId: number,
  weekStart: string,
  amountChange: number
): Promise<void> {
  // Find the payroll record for this driver and week
  const payroll = await prisma.individualPayroll.findFirst({
    where: {
      employeeId: driverId,
      weekStartDate: weekStart
    }
  })

  if (!payroll) {
    console.log(`No payroll record found for driver ${driverId}, week ${weekStart}`)
    return
  }

  // Update the payroll totals
  const newOtherDeductions = Math.max(0, payroll.otherDeductions + amountChange)
  const newTotalDeductions = payroll.totalDeductions - payroll.otherDeductions + newOtherDeductions
  const newNetPay = Math.max(0, payroll.grossPay - newTotalDeductions)

  await prisma.individualPayroll.update({
    where: { id: payroll.id },
    data: {
      otherDeductions: newOtherDeductions,
      totalDeductions: newTotalDeductions,
      netPay: newNetPay,
      modifiedDate: new Date().toISOString()
    }
  })

  console.log(`Updated payroll ${payroll.id} with recurring deduction change: $${amountChange}`)
}