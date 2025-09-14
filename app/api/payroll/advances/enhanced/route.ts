import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/advances/enhanced - Get enhanced advance data with calculations
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')
    const includeRepayments = searchParams.get('includeRepayments') === 'true'

    // Build where clause
    const where: any = {}
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }
    if (status && status !== 'all') {
      where.status = status
    }

    // Get advances
    const advances = await prisma.payrollAdvance.findMany({
      where,
      orderBy: [
        { advanceDate: 'desc' },
        { createdDate: 'desc' }
      ]
    })

    // Group advances by parent advance ID to calculate totals
    const advanceGroups = new Map<string, any>()
    
    for (const advance of advances) {
      const key = advance.parentAdvanceId || advance.advanceId
      
      if (!advanceGroups.has(key)) {
        advanceGroups.set(key, {
          advanceId: key,
          employeeId: advance.employeeId,
          employeeName: advance.employeeName || 'Unknown',
          originalAdvance: null,
          repayments: [],
          adjustments: [],
          totalAdvanced: 0,
          totalRepaid: 0,
          remainingBalance: 0,
          status: advance.status,
          weeksToRepay: advance.weeksToRepay || 0,
          weeklyRepayment: advance.weeklyRepayment || 0,
          advanceDate: advance.advanceDate,
          firstRepaymentDate: advance.firstRepaymentDate,
          lastRepaymentDate: advance.lastRepaymentDate,
          reason: advance.reason,
          approvedBy: advance.approvedBy
        })
      }

      const group = advanceGroups.get(key)!
      
      switch (advance.advanceType) {
        case 'ADVANCE':
          group.originalAdvance = advance
          group.totalAdvanced = advance.advanceAmount
          group.remainingBalance = advance.remainingBalance
          break
        case 'REPAYMENT':
          group.repayments.push(advance)
          group.totalRepaid += Math.abs(advance.amount)
          break
        case 'ADJUSTMENT':
        case 'FORGIVENESS':
          group.adjustments.push(advance)
          break
      }
    }

    // Convert to array and calculate final balances
    const enhancedAdvances = Array.from(advanceGroups.values()).map(group => {
      // Recalculate remaining balance
      group.remainingBalance = Math.max(0, group.totalAdvanced - group.totalRepaid)
      
      // Determine overall status
      if (group.remainingBalance === 0 && group.totalAdvanced > 0) {
        group.status = 'COMPLETED'
      } else if (group.remainingBalance > 0) {
        group.status = 'ACTIVE'
      }

      return group
    })

    // Calculate summary statistics
    const summary = {
      totalAdvances: enhancedAdvances.length,
      activeAdvances: enhancedAdvances.filter(adv => adv.status === 'ACTIVE').length,
      completedAdvances: enhancedAdvances.filter(adv => adv.status === 'COMPLETED').length,
      totalAdvanced: enhancedAdvances.reduce((sum, adv) => sum + adv.totalAdvanced, 0),
      totalRepaid: enhancedAdvances.reduce((sum, adv) => sum + adv.totalRepaid, 0),
      totalOutstanding: enhancedAdvances.reduce((sum, adv) => sum + adv.remainingBalance, 0),
      averageAdvanceAmount: enhancedAdvances.length > 0 ? 
        enhancedAdvances.reduce((sum, adv) => sum + adv.totalAdvanced, 0) / enhancedAdvances.length : 0
    }

    return NextResponse.json({
      advances: enhancedAdvances,
      summary,
      rawAdvances: includeRepayments ? advances : undefined
    })

  } catch (error) {
    console.error('Error fetching enhanced advances:', error)
    return NextResponse.json(
      { error: 'Failed to fetch enhanced advances' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/advances/enhanced - Create new advance with enhanced features
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      employeeId,
      employeeName,
      advanceAmount,
      weeksToRepay,
      weeklyRepayment,
      reason,
      approvedBy,
      repaymentType,
      advanceDate,
      weekStartDate
    } = body

    // Validate required fields
    if (!employeeId || !advanceAmount || !weeksToRepay) {
      return NextResponse.json(
        { error: 'Missing required fields: employeeId, advanceAmount, weeksToRepay' },
        { status: 400 }
      )
    }

    // Validate advance amount
    if (advanceAmount <= 0 || advanceAmount > 5000) {
      return NextResponse.json(
        { error: 'Advance amount must be between $1 and $5,000' },
        { status: 400 }
      )
    }

    // Validate repayment weeks
    if (weeksToRepay < 1 || weeksToRepay > 26) {
      return NextResponse.json(
        { error: 'Repayment weeks must be between 1 and 26' },
        { status: 400 }
      )
    }

    // Get employee information
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { name: true, status: true }
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    if (employee.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Cannot create advance for inactive employee' },
        { status: 400 }
      )
    }

    // Check existing advance balance
    const existingAdvances = await prisma.payrollAdvance.findMany({
      where: {
        employeeId,
        status: 'ACTIVE',
        advanceType: 'ADVANCE'
      }
    })

    const totalOutstanding = existingAdvances.reduce((sum, adv) => sum + adv.remainingBalance, 0)
    
    if (totalOutstanding + advanceAmount > 5000) {
      return NextResponse.json(
        { error: `Total outstanding advances would exceed $5,000 limit. Current: $${totalOutstanding.toFixed(2)}` },
        { status: 400 }
      )
    }

    // Calculate repayment details
    const calculatedWeeklyRepayment = weeklyRepayment || Math.ceil((advanceAmount / weeksToRepay) * 100) / 100
    const finalAdvanceDate = advanceDate || new Date().toISOString().split('T')[0]
    const finalWeekStartDate = weekStartDate || getWeekStartDate(finalAdvanceDate)
    
    // Calculate repayment dates
    const firstRepaymentDate = getNextWeekStartDate(finalWeekStartDate)
    const lastRepaymentDate = getWeekStartDatePlusWeeks(firstRepaymentDate, weeksToRepay - 1)

    // Generate unique advance ID
    const advanceId = `ADV-${Date.now()}`

    // Create advance record
    const advance = await prisma.payrollAdvance.create({
      data: {
        employeeId,
        advanceId,
        advanceType: 'ADVANCE',
        advanceAmount,
        amount: advanceAmount,
        repaidAmount: 0,
        remainingBalance: advanceAmount,
        advanceDate: finalAdvanceDate,
        weekStartDate: finalWeekStartDate,
        dueDate: lastRepaymentDate,
        firstRepaymentDate,
        lastRepaymentDate,
        repaymentType: repaymentType || 'PAYROLL_DEDUCTION',
        weeksToRepay,
        weeklyRepayment: calculatedWeeklyRepayment,
        status: 'ACTIVE',
        approvedBy: approvedBy || 'system',
        approvedDate: new Date().toISOString(),
        reason: reason || '',
        createdDate: new Date().toISOString(),
        createdBy: approvedBy || 'system'
      }
    })

    console.log(`Created advance ${advanceId} for employee ${employeeId}: $${advanceAmount} over ${weeksToRepay} weeks`)

    // Create repayment schedule entries
    await createRepaymentSchedule(advance, calculatedWeeklyRepayment, weeksToRepay, firstRepaymentDate)

    return NextResponse.json({
      success: true,
      advance,
      message: `Advance created successfully: $${advanceAmount} over ${weeksToRepay} weeks`,
      repaymentSchedule: {
        weeklyAmount: calculatedWeeklyRepayment,
        totalWeeks: weeksToRepay,
        firstPayment: firstRepaymentDate,
        lastPayment: lastRepaymentDate
      }
    })

  } catch (error) {
    console.error('Error creating advance:', error)
    return NextResponse.json(
      { error: 'Failed to create advance' },
      { status: 500 }
    )
  }
}

// Helper function to create repayment schedule
async function createRepaymentSchedule(
  advance: any,
  weeklyAmount: number,
  totalWeeks: number,
  startDate: string
): Promise<void> {
  const repaymentEntries = []
  let currentDate = new Date(startDate)
  
  for (let week = 0; week < totalWeeks; week++) {
    const weekStartDate = currentDate.toISOString().split('T')[0]
    
    // Calculate amount for this week (last week might be different due to rounding)
    const isLastWeek = week === totalWeeks - 1
    const repaymentAmount = isLastWeek 
      ? advance.remainingBalance - (weeklyAmount * (totalWeeks - 1))
      : weeklyAmount

    repaymentEntries.push({
      employeeId: advance.employeeId,
      advanceId: `${advance.advanceId}-R${week + 1}`,
      advanceType: 'REPAYMENT',
      parentAdvanceId: advance.advanceId,
      amount: -repaymentAmount, // Negative for repayments
      advanceAmount: 0,
      repaidAmount: 0,
      remainingBalance: 0,
      advanceDate: weekStartDate,
      weekStartDate: weekStartDate,
      repaymentType: 'PAYROLL_DEDUCTION',
      weeksToRepay: 0,
      weeklyRepayment: 0,
      status: 'ACTIVE',
      reason: `Scheduled repayment ${week + 1}/${totalWeeks}`,
      createdDate: new Date().toISOString(),
      createdBy: 'system'
    })

    // Move to next week
    currentDate.setDate(currentDate.getDate() + 7)
  }

  if (repaymentEntries.length > 0) {
    await prisma.payrollAdvance.createMany({
      data: repaymentEntries
    })
  }
}

// Helper functions for date calculations
function getWeekStartDate(dateString: string): string {
  const date = new Date(dateString)
  const dayOfWeek = date.getDay()
  const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
  const monday = new Date(date.setDate(diff))
  return monday.toISOString().split('T')[0]
}

function getNextWeekStartDate(weekStartDate: string): string {
  const date = new Date(weekStartDate)
  date.setDate(date.getDate() + 7)
  return date.toISOString().split('T')[0]
}

function getWeekStartDatePlusWeeks(weekStartDate: string, weeks: number): string {
  const date = new Date(weekStartDate)
  date.setDate(date.getDate() + (weeks * 7))
  return date.toISOString().split('T')[0]
}