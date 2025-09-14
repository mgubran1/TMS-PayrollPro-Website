import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { PayrollHelpers } from '../../../../lib/types'

// GET /api/payroll/history - Get comprehensive payroll history with filtering and analytics
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    const year = searchParams.get('year')
    const quarter = searchParams.get('quarter')
    const paymentMethod = searchParams.get('paymentMethod')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const includeAnalytics = searchParams.get('analytics') === 'true'
    
    const offset = (page - 1) * limit
    
    // Build where clause
    const where: any = {}
    
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }
    
    if (paymentMethod && paymentMethod !== 'ALL') {
      where.paymentMethod = paymentMethod
    }
    
    // Date filtering
    if (year) {
      const yearNum = parseInt(year)
      where.weekStartDate = {
        gte: `${yearNum}-01-01`,
        lt: `${yearNum + 1}-01-01`
      }
      
      if (quarter) {
        const quarterNum = parseInt(quarter)
        const quarterStart = new Date(yearNum, (quarterNum - 1) * 3, 1)
        const quarterEnd = new Date(yearNum, quarterNum * 3, 0)
        
        where.weekStartDate = {
          gte: quarterStart.toISOString().split('T')[0],
          lte: quarterEnd.toISOString().split('T')[0]
        }
      }
    }
    
    // Get total count
    const total = await prisma.individualPayroll.count({ where })
    
    // Get payroll history records
    const payrolls = await prisma.individualPayroll.findMany({
      where,
      include: {
        loads: {
          select: {
            id: true,
            loadNumber: true,
            deliveryDate: true,
            grossAmount: true,
            driverRate: true,
            finalMiles: true,
            isIncluded: true
          }
        },
        adjustments: {
          select: {
            id: true,
            category: true,
            adjustmentName: true,
            amount: true,
            loadNumber: true
          }
        },
        paystub: true,
        fuelIntegrations: true
      },
      orderBy: [
        { weekStartDate: 'desc' },
        { employeeName: 'asc' }
      ],
      take: limit,
      skip: offset
    })
    
    // Format the history records
    const historyRecords = payrolls.map(payroll => ({
      id: payroll.id,
      employee: {
        id: payroll.employeeId,
        name: payroll.employeeName,
        truckUnit: null, // Not stored in payroll snapshot
        driverType: null, // Not stored in payroll snapshot
        status: null // Not stored in payroll snapshot
      },
      payPeriod: {
        weekStartDate: payroll.weekStartDate,
        weekEndDate: payroll.weekEndDate,
        payDate: payroll.payDate,
        weekNumber: getWeekNumber(new Date(payroll.weekStartDate))
      },
      payment: {
        method: payroll.paymentMethod,
        basePay: payroll.basePay,
        grossPay: payroll.grossPay,
        totalDeductions: payroll.totalDeductions,
        netPay: payroll.netPay,
        formatted: {
          basePay: PayrollHelpers.formatCurrency(payroll.basePay),
          grossPay: PayrollHelpers.formatCurrency(payroll.grossPay),
          totalDeductions: PayrollHelpers.formatCurrency(payroll.totalDeductions),
          netPay: PayrollHelpers.formatCurrency(payroll.netPay)
        }
      },
      loads: {
        count: payroll.totalLoads,
        totalMiles: payroll.totalMiles,
        grossRevenue: payroll.grossRevenue,
        averagePayPerMile: payroll.totalMiles > 0 ? payroll.netPay / payroll.totalMiles : 0,
        details: payroll.loads?.map(load => ({
          id: load.id,
          loadNumber: load.loadNumber,
          deliveryDate: load.deliveryDate,
          grossAmount: load.grossAmount,
          driverRate: load.driverRate,
          miles: load.finalMiles,
          included: load.isIncluded
        })) || []
      },
      adjustments: {
        count: payroll.adjustments?.length || 0,
        totalAmount: payroll.adjustments?.reduce((sum, adj) => sum + adj.amount, 0) || 0,
        details: payroll.adjustments?.map(adj => ({
          id: adj.id,
          category: adj.category,
          name: adj.adjustmentName,
          amount: adj.amount,
          loadNumber: adj.loadNumber
        })) || []
      },
      status: {
        current: payroll.status,
        isLocked: payroll.isLocked,
        calculatedDate: payroll.calculatedDate,
        processedDate: payroll.processedDate
      },
      metadata: {
        createdDate: payroll.createdDate,
        createdBy: payroll.createdBy,
        modifiedDate: payroll.modifiedDate,
        modifiedBy: payroll.modifiedBy
      }
    }))
    
    // Calculate analytics if requested
    let analytics = null
    if (includeAnalytics) {
      analytics = await calculatePayrollAnalytics(where, payrolls)
    }
    
    return NextResponse.json({
      success: true,
      history: historyRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      ...(analytics && { analytics })
    })
  } catch (error) {
    console.error('Error fetching payroll history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payroll history' },
      { status: 500 }
    )
  }
}

// Calculate comprehensive analytics
async function calculatePayrollAnalytics(where: any, payrolls: any[]) {
  try {
    // Get all matching records for analytics (not just the paginated subset)
    const allPayrolls = await prisma.individualPayroll.findMany({
      where,
      select: {
        paymentMethod: true,
        basePay: true,
        grossPay: true,
        netPay: true,
        totalDeductions: true,
        totalLoads: true,
        totalMiles: true,
        grossRevenue: true,
        weekStartDate: true,
        status: true
      }
    })
    
    if (allPayrolls.length === 0) {
      return {
        summary: { totalRecords: 0, totalGrossPay: 0, totalNetPay: 0, totalDeductions: 0 },
        trends: { monthly: [], quarterly: [] },
        paymentMethods: {},
        performance: { averageGrossPay: 0, averageNetPay: 0, averageLoadsPerWeek: 0 }
      }
    }
    
    const summary = {
      totalRecords: allPayrolls.length,
      totalGrossPay: allPayrolls.reduce((sum, p) => sum + p.grossPay, 0),
      totalNetPay: allPayrolls.reduce((sum, p) => sum + p.netPay, 0),
      totalDeductions: allPayrolls.reduce((sum, p) => sum + p.totalDeductions, 0),
      totalLoads: allPayrolls.reduce((sum, p) => sum + p.totalLoads, 0),
      totalMiles: allPayrolls.reduce((sum, p) => sum + p.totalMiles, 0),
      averageGrossPay: allPayrolls.reduce((sum, p) => sum + p.grossPay, 0) / allPayrolls.length,
      averageNetPay: allPayrolls.reduce((sum, p) => sum + p.netPay, 0) / allPayrolls.length,
      averageLoadsPerWeek: allPayrolls.reduce((sum, p) => sum + p.totalLoads, 0) / allPayrolls.length
    }
    
    // Payment method breakdown
    const paymentMethods = {
      PERCENTAGE: allPayrolls.filter(p => p.paymentMethod === 'PERCENTAGE').length,
      PAY_PER_MILE: allPayrolls.filter(p => p.paymentMethod === 'PAY_PER_MILE').length,
      FLAT_RATE: allPayrolls.filter(p => p.paymentMethod === 'FLAT_RATE').length
    }
    
    // Monthly trends (last 12 months)
    const monthlyTrends = calculateMonthlyTrends(allPayrolls)
    
    // Status breakdown
    const statusBreakdown = {
      DRAFT: allPayrolls.filter(p => p.status === 'DRAFT').length,
      CALCULATED: allPayrolls.filter(p => p.status === 'CALCULATED').length,
      REVIEWED: allPayrolls.filter(p => p.status === 'REVIEWED').length,
      PROCESSED: allPayrolls.filter(p => p.status === 'PROCESSED').length,
      PAID: allPayrolls.filter(p => p.status === 'PAID').length
    }
    
    return {
      summary: {
        ...summary,
        formatted: {
          totalGrossPay: PayrollHelpers.formatCurrency(summary.totalGrossPay),
          totalNetPay: PayrollHelpers.formatCurrency(summary.totalNetPay),
          totalDeductions: PayrollHelpers.formatCurrency(summary.totalDeductions),
          averageGrossPay: PayrollHelpers.formatCurrency(summary.averageGrossPay),
          averageNetPay: PayrollHelpers.formatCurrency(summary.averageNetPay)
        }
      },
      paymentMethods,
      statusBreakdown,
      trends: {
        monthly: monthlyTrends
      },
      performance: {
        averagePayPerMile: summary.totalMiles > 0 ? summary.totalNetPay / summary.totalMiles : 0,
        averageRevenuePerLoad: summary.totalLoads > 0 ? allPayrolls.reduce((sum, p) => sum + p.grossRevenue, 0) / summary.totalLoads : 0,
        deductionRate: summary.totalGrossPay > 0 ? (summary.totalDeductions / summary.totalGrossPay) * 100 : 0
      }
    }
  } catch (error) {
    console.error('Error calculating analytics:', error)
    return null
  }
}

// Calculate monthly trends for the last 12 months
function calculateMonthlyTrends(payrolls: any[]) {
  const monthlyData: { [key: string]: any } = {}
  
  payrolls.forEach(payroll => {
    const date = new Date(payroll.weekStartDate)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        count: 0,
        totalGrossPay: 0,
        totalNetPay: 0,
        totalDeductions: 0,
        totalLoads: 0,
        totalMiles: 0
      }
    }
    
    monthlyData[monthKey].count++
    monthlyData[monthKey].totalGrossPay += payroll.grossPay
    monthlyData[monthKey].totalNetPay += payroll.netPay
    monthlyData[monthKey].totalDeductions += payroll.totalDeductions
    monthlyData[monthKey].totalLoads += payroll.totalLoads
    monthlyData[monthKey].totalMiles += payroll.totalMiles
  })
  
  return Object.values(monthlyData)
    .sort((a: any, b: any) => a.month.localeCompare(b.month))
    .slice(-12) // Last 12 months
}

// Get ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
