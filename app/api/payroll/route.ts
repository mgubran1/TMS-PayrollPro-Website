import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { todayISO } from '../../../utils/dates'
import { PayrollHelpers, PayrollPeriodType } from '../../../lib/types'
import { generatePeriodName } from '../../../lib/payroll-utils'

// GET /api/payroll - Get payroll periods with pagination and filtering
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status') || 'ALL'
    const periodType = searchParams.get('periodType') || 'ALL'
    const year = searchParams.get('year')
    
    const offset = (page - 1) * limit
    
    // Build where clause
    const where: any = {}
    
    if (status !== 'ALL') {
      where.status = status
    }
    
    if (periodType !== 'ALL') {
      where.periodType = periodType
    }
    
    if (year) {
      where.startDate = {
        gte: `${year}-01-01`,
        lt: `${parseInt(year) + 1}-01-01`
      }
    }
    
    // Get total count
    const total = await prisma.payrollPeriod.count({ where })
    
    // Get payroll periods (Note: PayrollPeriod no longer has direct paystubs relation)
    const periods = await prisma.payrollPeriod.findMany({
      where,
      orderBy: { startDate: 'desc' },
      take: limit,
      skip: offset
    })
    
    // For each period, get individual payrolls that fall within the period dates
    const periodsWithStats = await Promise.all(
      periods.map(async (period) => {
        const individualPayrolls = await prisma.individualPayroll.findMany({
          where: {
            weekStartDate: {
              gte: period.startDate,
              lte: period.endDate
            }
          },
          select: {
            id: true,
            status: true,
            grossPay: true,
            netPay: true
          }
        })
        
        return {
          ...period,
          paystubs: individualPayrolls // Maintain compatibility with frontend
        }
      })
    )
    
    return NextResponse.json({
      periods: periodsWithStats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching payroll periods:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payroll periods' },
      { status: 500 }
    )
  }
}

// POST /api/payroll - Create new payroll period
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { periodType, startDate, endDate, payDate } = body
    
    // Validate required fields
    if (!periodType || !startDate || !endDate || !payDate) {
      return NextResponse.json(
        { error: 'Period type, start date, end date, and pay date are required' },
        { status: 400 }
      )
    }
    
    // Only allow WEEKLY and BI_WEEKLY periods
    if (periodType !== 'WEEKLY' && periodType !== 'BI_WEEKLY') {
      return NextResponse.json(
        { error: 'Only WEEKLY and BI_WEEKLY payroll periods are supported' },
        { status: 400 }
      )
    }
    
    // Check for overlapping periods
    const existingPeriod = await prisma.payrollPeriod.findFirst({
      where: {
        OR: [
          {
            AND: [
              { startDate: { lte: startDate } },
              { endDate: { gte: startDate } }
            ]
          },
          {
            AND: [
              { startDate: { lte: endDate } },
              { endDate: { gte: endDate } }
            ]
          }
        ]
      }
    })
    
    if (existingPeriod) {
      return NextResponse.json(
        { error: 'A payroll period already exists for this date range' },
        { status: 409 }
      )
    }
    
    // Generate period name
    const periodName = generatePeriodName(startDate, periodType as 'WEEKLY' | 'BI_WEEKLY')
    
    // Create new payroll period
    const period = await prisma.payrollPeriod.create({
      data: {
        periodName,
        periodType,
        startDate,
        endDate,
        payDate,
        status: 'DRAFT',
        totalGrossPay: 0,
        totalNetPay: 0,
        totalDeductions: 0,
        employeeCount: 0,
        createdDate: todayISO(),
        createdBy: 'web-api'
      }
    })
    
    return NextResponse.json(period, { status: 201 })
  } catch (error) {
    console.error('Error creating payroll period:', error)
    return NextResponse.json(
      { error: 'Failed to create payroll period' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll - Update payroll period
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, status, approvedBy, ...updateData } = body
    
    if (!id) {
      return NextResponse.json(
        { error: 'Payroll period ID is required' },
        { status: 400 }
      )
    }
    
    // Check if period exists
    const existingPeriod = await prisma.payrollPeriod.findUnique({
      where: { id: parseInt(id) }
    })
    
    if (!existingPeriod) {
      return NextResponse.json(
        { error: 'Payroll period not found' },
        { status: 404 }
      )
    }
    
    const updates: any = {
      ...updateData,
      modifiedDate: todayISO()
    }
    
    // Handle status changes
    if (status && status !== existingPeriod.status) {
      updates.status = status
      
      if (status === 'APPROVED') {
        updates.approvedDate = todayISO()
        updates.approvedBy = approvedBy
      } else if (status === 'PAID') {
        updates.paidDate = todayISO()
      } else if (status === 'PROCESSING') {
        updates.processedDate = todayISO()
      }
    }
    
    const updatedPeriod = await prisma.payrollPeriod.update({
      where: { id: parseInt(id) },
      data: updates,
      include: {
        paystubs: {
          select: {
            id: true,
            status: true,
            grossPay: true,
            netPay: true
          }
        }
      }
    })
    
    return NextResponse.json(updatedPeriod)
  } catch (error) {
    console.error('Error updating payroll period:', error)
    return NextResponse.json(
      { error: 'Failed to update payroll period' },
      { status: 500 }
    )
  }
}

// DELETE /api/payroll - Delete payroll period (only if DRAFT status)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json(
        { error: 'Payroll period ID is required' },
        { status: 400 }
      )
    }
    
    // Check if period exists and is deletable
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: parseInt(id) },
      include: { paystubs: true }
    })
    
    if (!period) {
      return NextResponse.json(
        { error: 'Payroll period not found' },
        { status: 404 }
      )
    }
    
    if (period.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Can only delete draft payroll periods' },
        { status: 400 }
      )
    }
    
    // Delete the period (cascades to paystubs and deductions)
    await prisma.payrollPeriod.delete({
      where: { id: parseInt(id) }
    })
    
    return NextResponse.json({ message: 'Payroll period deleted successfully' })
  } catch (error) {
    console.error('Error deleting payroll period:', error)
    return NextResponse.json(
      { error: 'Failed to delete payroll period' },
      { status: 500 }
    )
  }
}
