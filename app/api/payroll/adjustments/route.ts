import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/adjustments - Get all payroll adjustments
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    const weekStartDate = searchParams.get('weekStartDate')
    const category = searchParams.get('category')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause
    const where: any = {}
    
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }
    
    if (weekStartDate) {
      where.weekStartDate = weekStartDate
    }
    
    if (category && category !== 'all') {
      where.category = category
    }
    
    if (status && status !== 'all') {
      where.status = status
    }

    // Get adjustments with pagination
    const [adjustments, total] = await Promise.all([
      prisma.payrollAdjustment.findMany({
        where,
        orderBy: [
          { effectiveDate: 'desc' },
          { createdDate: 'desc' }
        ],
        take: limit,
        skip: offset
      }),
      prisma.payrollAdjustment.count({ where })
    ])

    // Get summary statistics
    const summary = await prisma.payrollAdjustment.aggregate({
      where,
      _sum: {
        amount: true
      },
      _count: {
        id: true
      }
    })

    // Group by category for breakdown
    const categoryBreakdown = await prisma.payrollAdjustment.groupBy({
      by: ['category'],
      where,
      _sum: {
        amount: true
      },
      _count: {
        id: true
      }
    })

    return NextResponse.json({
      adjustments,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      },
      summary: {
        totalAmount: summary._sum.amount || 0,
        totalCount: summary._count.id || 0,
        categoryBreakdown: categoryBreakdown.map(item => ({
          category: item.category,
          amount: item._sum.amount || 0,
          count: item._count.id || 0
        }))
      }
    })

  } catch (error) {
    console.error('Error fetching payroll adjustments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payroll adjustments' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/adjustments - Create new payroll adjustment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      employeeId,
      employeeName,
      category,
      adjustmentType,
      adjustmentName,
      description,
      amount,
      effectiveDate,
      weekStartDate,
      loadNumber,
      referenceNumber,
      isRecurring,
      createdBy
    } = body

    // Validate required fields
    if (!employeeId || !category || !adjustmentName || !amount || !effectiveDate) {
      return NextResponse.json(
        { error: 'Missing required fields: employeeId, category, adjustmentName, amount, effectiveDate' },
        { status: 400 }
      )
    }

    // Validate category
    const validCategories = ['DEDUCTION', 'REIMBURSEMENT', 'BONUS', 'CORRECTION']
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category. Must be one of: ' + validCategories.join(', ') },
        { status: 400 }
      )
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be a positive number' },
        { status: 400 }
      )
    }

    // Get employee name if not provided
    let finalEmployeeName = employeeName
    if (!finalEmployeeName && employeeId) {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true }
      })
      finalEmployeeName = employee?.name || 'Unknown'
    }

    // Calculate week start date if not provided
    let finalWeekStartDate = weekStartDate
    if (!finalWeekStartDate) {
      const effectiveDateObj = new Date(effectiveDate)
      const dayOfWeek = effectiveDateObj.getDay()
      const diff = effectiveDateObj.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
      const monday = new Date(effectiveDateObj.setDate(diff))
      finalWeekStartDate = monday.toISOString().split('T')[0]
    }

    // Create the adjustment
    const adjustment = await prisma.payrollAdjustment.create({
      data: {
        employeeId,
        category,
        adjustmentType: adjustmentType || 'OTHER',
        adjustmentName,
        description: description || '',
        amount,
        effectiveDate,
        weekStartDate: finalWeekStartDate,
        loadNumber: loadNumber || null,
        referenceNumber: referenceNumber || null,
        isRecurring: isRecurring || false,
        status: 'ACTIVE',
        createdDate: new Date().toISOString(),
        createdBy: createdBy || 'system'
      }
    })

    console.log(`Created payroll adjustment: ${adjustmentName} for employee ${employeeId} - $${amount}`)

    // If this affects an existing payroll, update the totals
    try {
      await updatePayrollTotals(employeeId, finalWeekStartDate, category, amount)
    } catch (payrollError) {
      console.warn('Failed to update payroll totals:', payrollError)
      // Don't fail the adjustment creation if payroll update fails
    }

    return NextResponse.json({
      success: true,
      adjustment,
      message: `${category.toLowerCase()} created successfully`
    })

  } catch (error) {
    console.error('Error creating payroll adjustment:', error)
    return NextResponse.json(
      { error: 'Failed to create payroll adjustment' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll/adjustments - Update existing payroll adjustment
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      id,
      category,
      adjustmentType,
      adjustmentName,
      description,
      amount,
      effectiveDate,
      weekStartDate,
      loadNumber,
      referenceNumber,
      status,
      isRecurring
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Adjustment ID is required' },
        { status: 400 }
      )
    }

    // Get existing adjustment
    const existingAdjustment = await prisma.payrollAdjustment.findUnique({
      where: { id }
    })

    if (!existingAdjustment) {
      return NextResponse.json(
        { error: 'Adjustment not found' },
        { status: 404 }
      )
    }

    // Update the adjustment
    const updatedAdjustment = await prisma.payrollAdjustment.update({
      where: { id },
      data: {
        category: category || existingAdjustment.category,
        adjustmentType: adjustmentType || existingAdjustment.adjustmentType,
        adjustmentName: adjustmentName || existingAdjustment.adjustmentName,
        description: description !== undefined ? description : existingAdjustment.description,
        amount: amount !== undefined ? amount : existingAdjustment.amount,
        effectiveDate: effectiveDate || existingAdjustment.effectiveDate,
        weekStartDate: weekStartDate || existingAdjustment.weekStartDate,
        loadNumber: loadNumber !== undefined ? loadNumber : existingAdjustment.loadNumber,
        referenceNumber: referenceNumber !== undefined ? referenceNumber : existingAdjustment.referenceNumber,
        status: status || existingAdjustment.status,
        isRecurring: isRecurring !== undefined ? isRecurring : existingAdjustment.isRecurring,
        modifiedDate: new Date().toISOString()
      }
    })

    console.log(`Updated payroll adjustment ${id}: ${updatedAdjustment.adjustmentName}`)

    // Update payroll totals if amount or category changed
    if (amount !== existingAdjustment.amount || category !== existingAdjustment.category) {
      try {
        await updatePayrollTotals(
          existingAdjustment.employeeId,
          existingAdjustment.weekStartDate || '',
          updatedAdjustment.category,
          updatedAdjustment.amount - existingAdjustment.amount
        )
      } catch (payrollError) {
        console.warn('Failed to update payroll totals:', payrollError)
      }
    }

    return NextResponse.json({
      success: true,
      adjustment: updatedAdjustment,
      message: 'Adjustment updated successfully'
    })

  } catch (error) {
    console.error('Error updating payroll adjustment:', error)
    return NextResponse.json(
      { error: 'Failed to update payroll adjustment' },
      { status: 500 }
    )
  }
}

// Helper function to update payroll totals when adjustments change
async function updatePayrollTotals(
  employeeId: number,
  weekStartDate: string,
  category: string,
  amountChange: number
): Promise<void> {
  if (!weekStartDate) return

  // Find the individual payroll record
  const payroll = await prisma.individualPayroll.findFirst({
    where: {
      employeeId,
      weekStartDate
    }
  })

  if (!payroll) {
    console.log(`No payroll record found for employee ${employeeId}, week ${weekStartDate}`)
    return
  }

  // Calculate the impact based on category
  let deductionChange = 0
  let earningsChange = 0

  switch (category) {
    case 'DEDUCTION':
      deductionChange = amountChange
      break
    case 'REIMBURSEMENT':
    case 'BONUS':
    case 'CORRECTION':
      earningsChange = amountChange
      break
  }

  // Update the payroll record
  const newTotalDeductions = Math.max(0, payroll.totalDeductions + deductionChange)
  const newOtherEarnings = Math.max(0, payroll.otherEarnings + earningsChange)
  const newGrossPay = payroll.basePay + payroll.bonusAmount + payroll.reimbursements + payroll.overtime + newOtherEarnings
  const newNetPay = Math.max(0, newGrossPay - newTotalDeductions)

  await prisma.individualPayroll.update({
    where: { id: payroll.id },
    data: {
      totalDeductions: newTotalDeductions,
      otherDeductions: Math.max(0, payroll.otherDeductions + (category === 'DEDUCTION' ? amountChange : 0)),
      otherEarnings: newOtherEarnings,
      grossPay: newGrossPay,
      netPay: newNetPay,
      modifiedDate: new Date().toISOString()
    }
  })

  console.log(`Updated payroll totals for employee ${employeeId}, week ${weekStartDate}: Net Pay $${newNetPay}`)
}