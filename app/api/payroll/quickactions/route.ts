import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { getCurrentWeekRange, getCurrentBiWeeklyRange } from '../../../../lib/payroll-utils'
import { todayISO } from '../../../../utils/dates'
import { PayrollHelpers } from '../../../../lib/types'

// POST /api/payroll/quickactions - Perform quick payroll actions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, ...params } = body
    
    switch (action) {
      case 'CREATE_CURRENT_PERIOD':
        return await createCurrentPeriod(params)
      case 'AUTO_CALCULATE_PERIOD':
        return await autoCalculatePeriod(params)
      case 'BULK_APPROVE_PAYSTUBS':
        return await bulkApprovePaystubs(params)
      case 'GENERATE_PERIOD_REPORTS':
        return await generatePeriodReports(params)
      case 'SYNC_LOADS_TO_PAYROLL':
        return await syncLoadsToPayroll(params)
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('QuickActions error:', error)
    return NextResponse.json({ error: 'QuickAction failed' }, { status: 500 })
  }
}

// Create payroll period for current week/bi-weekly
async function createCurrentPeriod({ frequency = 'WEEKLY', createdBy }: any) {
  const periodRange = frequency === 'WEEKLY' 
    ? getCurrentWeekRange() 
    : getCurrentBiWeeklyRange()
  
  // Check if period already exists
  const existing = await prisma.payrollPeriod.findFirst({
    where: {
      startDate: periodRange.startDate,
      endDate: periodRange.endDate
    }
  })
  
  if (existing) {
    return NextResponse.json({ error: 'Current period already exists' }, { status: 409 })
  }
  
  const period = await prisma.payrollPeriod.create({
    data: {
      periodName: `${frequency === 'WEEKLY' ? 'Week' : 'Bi-Week'} of ${new Date(periodRange.startDate).toLocaleDateString()}`,
      periodType: frequency,
      startDate: periodRange.startDate,
      endDate: periodRange.endDate,
      payDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Next week
      status: 'DRAFT',
      totalGrossPay: 0,
      totalNetPay: 0,
      totalDeductions: 0,
      employeeCount: 0,
      createdDate: todayISO(),
      createdBy: createdBy || 'quickaction'
    }
  })
  
  return NextResponse.json({ success: true, period })
}

// Auto-calculate payroll for all employees in a period
async function autoCalculatePeriod({ payrollPeriodId, calculatedBy }: any) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: payrollPeriodId }
  })
  
  if (!period) {
    return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
  }
  
  // Get all active employees
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' }
  })
  
  const results = {
    processed: 0,
    created: 0,
    errors: 0,
    errorDetails: [] as string[]
  }
  
  for (const employee of employees) {
    try {
      // Check if individual payroll already exists for this employee/period
      const existing = await prisma.individualPayroll.findFirst({
        where: {
          employeeId: employee.id,
          weekStartDate: period.startDate,
          weekEndDate: period.endDate
        }
      })
      
      if (!existing) {
        // Create individual payroll with auto-load inclusion
        await prisma.individualPayroll.create({
          data: {
            employeeId: employee.id,
            employeeName: employee.name,
            weekStartDate: period.startDate,
            weekEndDate: period.endDate,
            payDate: period.payDate,
            paymentMethod: employee.paymentMethod || 'PERCENTAGE',
            status: 'DRAFT',
            isLocked: false,
            includeCurrentLoads: true,
            createdDate: todayISO(),
            createdBy: calculatedBy || 'auto-quickaction',
            // Initialize with zeros - will be calculated later
            basePay: 0,
            grossPay: 0,
            netPay: 0,
            totalDeductions: 0,
            totalLoads: 0,
            totalMiles: 0,
            grossRevenue: 0
          }
        })
        results.created++
      }
      
      results.processed++
    } catch (error) {
      results.errors++
      results.errorDetails.push(`Employee ${employee.name}: ${error}`)
    }
  }
  
  return NextResponse.json({ success: true, results })
}

// Bulk approve all paystubs in a period
async function bulkApprovePaystubs({ payrollPeriodId, approvedBy }: any) {
  const paystubs = await prisma.paystub.updateMany({
    where: {
      payroll: {
        weekStartDate: {
          gte: (await prisma.payrollPeriod.findUnique({ 
            where: { id: payrollPeriodId },
            select: { startDate: true }
          }))?.startDate
        }
      },
      status: 'CALCULATED'
    },
    data: {
      status: 'APPROVED',
      approvedDate: todayISO(),
      approvedBy: approvedBy || 'bulk-quickaction'
    }
  })
  
  return NextResponse.json({ 
    success: true, 
    approved: paystubs.count 
  })
}

// Generate comprehensive reports for a payroll period
async function generatePeriodReports({ payrollPeriodId }: any) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: payrollPeriodId }
  })
  
  if (!period) {
    return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
  }
  
  // Get all individual payrolls for this period
  const payrolls = await prisma.individualPayroll.findMany({
    where: {
      weekStartDate: period.startDate,
      weekEndDate: period.endDate
    },
    include: {
      employee: true,
      loads: true,
      adjustments: true
    }
  })
  
  const report = {
    period: {
      name: period.periodName,
      dateRange: `${period.startDate} to ${period.endDate}`,
      payDate: period.payDate
    },
    summary: {
      totalEmployees: payrolls.length,
      totalGrossPay: payrolls.reduce((sum, p) => sum + p.grossPay, 0),
      totalNetPay: payrolls.reduce((sum, p) => sum + p.netPay, 0),
      totalDeductions: payrolls.reduce((sum, p) => sum + p.totalDeductions, 0),
      totalLoads: payrolls.reduce((sum, p) => sum + p.totalLoads, 0),
      totalMiles: payrolls.reduce((sum, p) => sum + p.totalMiles, 0)
    },
    employees: payrolls.map(payroll => ({
      id: payroll.id,
      employeeName: payroll.employeeName,
      paymentMethod: payroll.paymentMethod,
      status: payroll.status,
      grossPay: PayrollHelpers.formatCurrency(payroll.grossPay),
      netPay: PayrollHelpers.formatCurrency(payroll.netPay),
      totalLoads: payroll.totalLoads,
      totalMiles: Math.round(payroll.totalMiles),
      adjustments: payroll.adjustments?.length || 0
    })),
    paymentMethods: {
      PERCENTAGE: payrolls.filter(p => p.paymentMethod === 'PERCENTAGE').length,
      PAY_PER_MILE: payrolls.filter(p => p.paymentMethod === 'PAY_PER_MILE').length,
      FLAT_RATE: payrolls.filter(p => p.paymentMethod === 'FLAT_RATE').length
    }
  }
  
  return NextResponse.json({ success: true, report })
}

// Sync delivered loads to individual payrolls
async function syncLoadsToPayroll({ weekStartDate, weekEndDate, syncedBy }: any) {
  if (!weekStartDate || !weekEndDate) {
    return NextResponse.json({ error: 'Week dates required' }, { status: 400 })
  }
  
  // Get all delivered loads in the date range
  const loads = await prisma.load.findMany({
    where: {
      status: 'DELIVERED',
      deliveryDate: {
        gte: weekStartDate,
        lte: weekEndDate
      },
      driverId: { not: null }
    },
    include: {
      driver: {
        select: { id: true, name: true, paymentMethod: true }
      }
    }
  })
  
  const syncResults = {
    loadsProcessed: 0,
    payrollsUpdated: 0,
    errors: 0,
    errorDetails: [] as string[]
  }
  
  for (const load of loads) {
    try {
      if (!load.driverId) continue
      
      // Find or create individual payroll for this driver/week
      let payroll = await prisma.individualPayroll.findFirst({
        where: {
          employeeId: load.driverId,
          weekStartDate,
          weekEndDate
        }
      })
      
      if (!payroll) {
        // Create new individual payroll
        payroll = await prisma.individualPayroll.create({
          data: {
            employeeId: load.driverId,
            employeeName: load.driver?.name || 'Unknown Driver',
            weekStartDate,
            weekEndDate,
            paymentMethod: load.driver?.paymentMethod || 'PERCENTAGE',
            status: 'DRAFT',
            isLocked: false,
            includeCurrentLoads: true,
            createdDate: todayISO(),
            createdBy: syncedBy || 'load-sync',
            basePay: 0,
            grossPay: 0,
            netPay: 0,
            totalDeductions: 0,
            totalLoads: 0,
            totalMiles: 0,
            grossRevenue: 0
          }
        })
      }
      
      // Check if load is already linked
      const existingPayrollLoad = await prisma.payrollLoad.findFirst({
        where: {
          payrollId: payroll.id,
          loadId: load.id
        }
      })
      
      if (!existingPayrollLoad) {
        // Create PayrollLoad link
        await prisma.payrollLoad.create({
          data: {
            payrollId: payroll.id,
            loadId: load.id,
            employeeId: load.driverId,
            loadNumber: load.loadNumber || '',
            deliveryDate: load.deliveryDate,
            grossAmount: load.grossAmount || 0,
            driverRate: 0, // Will be calculated based on payment method
            finalMiles: load.finalMiles || 0,
            isIncluded: true,
            weekStartDate
          }
        })
        
        syncResults.payrollsUpdated++
      }
      
      syncResults.loadsProcessed++
    } catch (error) {
      syncResults.errors++
      syncResults.errorDetails.push(`Load ${load.loadNumber}: ${error}`)
    }
  }
  
  return NextResponse.json({ success: true, results: syncResults })
}
