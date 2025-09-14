import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/weekly - Get weekly payroll data
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = parseInt(searchParams.get('year') || '0')
    const week = parseInt(searchParams.get('week') || '0')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!year || !week || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Year, week, startDate, and endDate are required' },
        { status: 400 }
      )
    }

    // Get all individual payrolls for the specified week
    const payrolls = await prisma.individualPayroll.findMany({
      where: {
        weekStartDate: startDate,
        weekEndDate: endDate
      },
      include: {
        loads: {
          include: {
            // Get load details for display
          }
        },
        adjustments: true,
        paystub: true,
        fuelIntegrations: true
      },
      orderBy: {
        employeeName: 'asc'
      }
    })

    // Get week lock status
    const weekLocks = await getWeekLockStatus(year, week)

    // Transform data for frontend consumption
    const transformedPayrolls = payrolls.map(payroll => ({
      id: payroll.id,
      employeeId: payroll.employeeId,
      employeeName: payroll.employeeName,
      weekStartDate: payroll.weekStartDate,
      weekEndDate: payroll.weekEndDate,
      payDate: payroll.payDate,
      
      // Load information
      totalLoads: payroll.totalLoads,
      totalMiles: payroll.totalMiles,
      grossRevenue: payroll.grossRevenue,
      
      // Payment calculation
      paymentMethod: payroll.paymentMethod,
      basePayRate: payroll.basePayRate,
      basePay: payroll.basePay,
      
      // Additional earnings
      bonusAmount: payroll.bonusAmount,
      reimbursements: payroll.reimbursements,
      overtime: payroll.overtime,
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
      status: payroll.status,
      isLocked: payroll.isLocked,
      
      // Metadata
      calculatedDate: payroll.calculatedDate,
      calculatedBy: payroll.calculatedBy,
      reviewedDate: payroll.reviewedDate,
      reviewedBy: payroll.reviewedBy,
      
      // Related data counts
      loadsCount: payroll.loads.length,
      adjustmentsCount: payroll.adjustments.length,
      hasPaystub: !!payroll.paystub,
      fuelTransactionsCount: payroll.fuelIntegrations.length
    }))

    return NextResponse.json({
      payrolls: transformedPayrolls,
      weekLocks: Array.from(weekLocks.entries()),
      summary: {
        totalEmployees: transformedPayrolls.length,
        totalGrossPay: transformedPayrolls.reduce((sum, p) => sum + p.grossPay, 0),
        totalDeductions: transformedPayrolls.reduce((sum, p) => sum + p.totalDeductions, 0),
        totalNetPay: transformedPayrolls.reduce((sum, p) => sum + p.netPay, 0),
        totalLoads: transformedPayrolls.reduce((sum, p) => sum + p.totalLoads, 0),
        calculatedCount: transformedPayrolls.filter(p => p.status === 'CALCULATED').length,
        lockedCount: transformedPayrolls.filter(p => p.isLocked).length
      }
    })

  } catch (error) {
    console.error('Error fetching weekly payroll:', error)
    return NextResponse.json(
      { error: 'Failed to fetch weekly payroll data' },
      { status: 500 }
    )
  }
}

// Helper function to get week lock status
async function getWeekLockStatus(year: number, week: number): Promise<Map<string, boolean>> {
  const weekLocks = new Map<string, boolean>()
  
  try {
    // Check if there's a payroll settings or week lock table
    // For now, we'll use a simple approach and check if any payroll for that week is locked
    const weekKey = `${year}-W${week.toString().padStart(2, '0')}`
    
    // Get the Monday of the specified week
    const startOfYear = new Date(year, 0, 1)
    const daysToAdd = (week - 1) * 7
    const weekStart = new Date(startOfYear.getTime() + daysToAdd * 24 * 60 * 60 * 1000)
    
    // Adjust to Monday
    const dayOfWeek = weekStart.getDay()
    const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
    const monday = new Date(weekStart.setDate(diff))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    
    const startDate = monday.toISOString().split('T')[0]
    const endDate = sunday.toISOString().split('T')[0]
    
    // Check if any payroll records for this week are locked
    const lockedPayrolls = await prisma.individualPayroll.findMany({
      where: {
        weekStartDate: startDate,
        isLocked: true
      },
      select: { id: true }
    })
    
    weekLocks.set(weekKey, lockedPayrolls.length > 0)
    
  } catch (error) {
    console.error('Error getting week lock status:', error)
    // Default to unlocked if there's an error
    weekLocks.set(`${year}-W${week.toString().padStart(2, '0')}`, false)
  }
  
  return weekLocks
}
