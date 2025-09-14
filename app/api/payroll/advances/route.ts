import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { todayISO } from '../../../../utils/dates'

// GET /api/payroll/advances - Get employee advances with filtering
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status') || 'ALL'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    
    const offset = (page - 1) * limit
    
    // Build where clause
    const where: any = {}
    
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }
    
    if (status !== 'ALL') {
      where.status = status
    }
    
    // Get total count
    const total = await prisma.payrollAdvance.count({ where })
    
    // Get advances with employee info
    const advances = await prisma.payrollAdvance.findMany({
      where,
      include: {
        paystub: {
          select: {
            id: true,
            payrollId: true,
            weekStartDate: true,
            weekEndDate: true,
            payDate: true,
            payroll: {
              select: {
                weekStartDate: true,
                weekEndDate: true,
                payDate: true
              }
            }
          }
        }
      },
      orderBy: { advanceDate: 'desc' },
      take: limit,
      skip: offset
    })
    
    // Get employee names for advances
    const employeeIds = [...new Set(advances.map(a => a.employeeId))]
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, name: true }
    })
    
    const employeeMap = employees.reduce((acc, emp) => {
      acc[emp.id] = emp.name
      return acc
    }, {} as { [key: number]: string })
    
    // Add employee names to advances
    const advancesWithEmployees = advances.map(advance => ({
      ...advance,
      employeeName: employeeMap[advance.employeeId] || 'Unknown'
    }))
    
    return NextResponse.json({
      advances: advancesWithEmployees,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching advances:', error)
    return NextResponse.json(
      { error: 'Failed to fetch advances' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/advances - Create new advance
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      employeeId,
      advanceAmount,
      reason,
      repaymentType,
      weeklyRepayment,
      dueDate,
      approvedBy
    } = body
    
    // Validate required fields
    if (!employeeId || !advanceAmount || advanceAmount <= 0) {
      return NextResponse.json(
        { error: 'Employee ID and advance amount are required' },
        { status: 400 }
      )
    }
    
    // Check if employee exists
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) }
    })
    
    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }
    
    // Calculate weekly repayment if not provided
    let calculatedWeeklyRepayment = weeklyRepayment || 0
    if (repaymentType === 'WEEKLY' && !weeklyRepayment) {
      // Default to 25% of advance amount per week (4 week repayment)
      calculatedWeeklyRepayment = advanceAmount / 4
    }
    
    // Create advance
    const advance = await prisma.payrollAdvance.create({
      data: {
        employeeId: parseInt(employeeId),
        advanceAmount: parseFloat(advanceAmount),
        repaidAmount: 0,
        remainingBalance: parseFloat(advanceAmount),
        advanceDate: todayISO(),
        dueDate: dueDate || null,
        repaymentType: repaymentType || 'WEEKLY',
        weeklyRepayment: calculatedWeeklyRepayment,
        status: 'ACTIVE',
        reason: reason || null,
        approvedBy: approvedBy || null,
        createdDate: todayISO(),
        createdBy: 'web-api'
      }
    })
    
    return NextResponse.json(advance, { status: 201 })
  } catch (error) {
    console.error('Error creating advance:', error)
    return NextResponse.json(
      { error: 'Failed to create advance' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll/advances - Update advance
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, status, notes, weeklyRepayment, ...updateData } = body
    
    if (!id) {
      return NextResponse.json(
        { error: 'Advance ID is required' },
        { status: 400 }
      )
    }
    
    // Check if advance exists
    const existingAdvance = await prisma.payrollAdvance.findUnique({
      where: { id: parseInt(id) }
    })
    
    if (!existingAdvance) {
      return NextResponse.json(
        { error: 'Advance not found' },
        { status: 404 }
      )
    }
    
    const updates: any = {
      ...updateData,
      modifiedDate: todayISO()
    }
    
    if (status) {
      updates.status = status
    }
    
    if (notes !== undefined) {
      updates.notes = notes
    }
    
    if (weeklyRepayment !== undefined) {
      updates.weeklyRepayment = parseFloat(weeklyRepayment)
    }
    
    const updatedAdvance = await prisma.payrollAdvance.update({
      where: { id: parseInt(id) },
      data: updates
    })
    
    return NextResponse.json(updatedAdvance)
  } catch (error) {
    console.error('Error updating advance:', error)
    return NextResponse.json(
      { error: 'Failed to update advance' },
      { status: 500 }
    )
  }
}

// DELETE /api/payroll/advances - Delete advance (only if no repayments made)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json(
        { error: 'Advance ID is required' },
        { status: 400 }
      )
    }
    
    // Check if advance exists and has no repayments
    const advance = await prisma.payrollAdvance.findUnique({
      where: { id: parseInt(id) }
    })
    
    if (!advance) {
      return NextResponse.json(
        { error: 'Advance not found' },
        { status: 404 }
      )
    }
    
    if (advance.repaidAmount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete advance with repayments made' },
        { status: 400 }
      )
    }
    
    // Delete the advance
    await prisma.payrollAdvance.delete({
      where: { id: parseInt(id) }
    })
    
    return NextResponse.json({ message: 'Advance deleted successfully' })
  } catch (error) {
    console.error('Error deleting advance:', error)
    return NextResponse.json(
      { error: 'Failed to delete advance' },
      { status: 500 }
    )
  }
}
