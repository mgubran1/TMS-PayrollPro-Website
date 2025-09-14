import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/move-load - Move a load to a different payroll week
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { loadId, targetWeek, targetYear, movedBy, reason } = body

    if (!loadId || !targetWeek || !targetYear) {
      return NextResponse.json(
        { error: 'Load ID, target week, and target year are required' },
        { status: 400 }
      )
    }

    console.log(`Moving load ${loadId} to Week ${targetWeek}, ${targetYear}`)

    // Get the load details
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: {
        id: true,
        loadNumber: true,
        driverId: true,
        driverName: true,
        deliveryDate: true,
        grossAmount: true,
        driverRate: true,
        status: true
      }
    })

    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }

    if (!load.driverId || load.driverId === 0) {
      return NextResponse.json(
        { error: 'Cannot move unassigned loads' },
        { status: 400 }
      )
    }

    // Calculate target week dates
    const { startDate: targetStartDate, endDate: targetEndDate } = getWeekDates(targetYear, targetWeek)

    // Check if target week is locked
    const targetWeekLocked = await isWeekLocked(targetYear, targetWeek)
    if (targetWeekLocked) {
      return NextResponse.json(
        { error: `Target week ${targetWeek}, ${targetYear} is locked` },
        { status: 400 }
      )
    }

    // Get current week from delivery date
    const currentWeekInfo = getWeekFromDate(load.deliveryDate || new Date().toISOString().split('T')[0])
    const currentWeekLocked = await isWeekLocked(currentWeekInfo.year, currentWeekInfo.week)
    
    if (currentWeekLocked) {
      return NextResponse.json(
        { error: `Current week ${currentWeekInfo.week}, ${currentWeekInfo.year} is locked` },
        { status: 400 }
      )
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Remove load from current payroll records
      const currentPayroll = await tx.individualPayroll.findFirst({
        where: {
          employeeId: load.driverId,
          weekStartDate: getWeekDates(currentWeekInfo.year, currentWeekInfo.week).startDate
        }
      })

      if (currentPayroll) {
        // Remove from current payroll loads
        await tx.payrollLoad.deleteMany({
          where: {
            payrollId: currentPayroll.id,
            loadId: loadId
          }
        })

        // Update current payroll totals
        await recalculatePayrollTotals(tx, currentPayroll.id)
      }

      // Find or create target week payroll
      let targetPayroll = await tx.individualPayroll.findFirst({
        where: {
          employeeId: load.driverId,
          weekStartDate: targetStartDate
        }
      })

      if (!targetPayroll) {
        // Create new payroll record for target week
        const employee = await tx.employee.findUnique({
          where: { id: load.driverId },
          select: { name: true }
        })

        targetPayroll = await tx.individualPayroll.create({
          data: {
            employeeId: load.driverId,
            employeeName: employee?.name || load.driverName || 'Unknown',
            weekStartDate: targetStartDate,
            weekEndDate: targetEndDate,
            payDate: calculatePayDate(targetEndDate),
            totalLoads: 0,
            totalMiles: 0,
            grossRevenue: 0,
            paymentMethod: null,
            basePayRate: 0,
            basePay: 0,
            bonusAmount: 0,
            reimbursements: 0,
            overtime: 0,
            otherEarnings: 0,
            totalDeductions: 0,
            fuelDeductions: 0,
            advanceRepayments: 0,
            otherDeductions: 0,
            grossPay: 0,
            netPay: 0,
            status: 'DRAFT',
            isLocked: false,
            createdDate: new Date().toISOString(),
            createdBy: movedBy || 'system'
          }
        })
      }

      // Add load to target payroll
      await tx.payrollLoad.create({
        data: {
          payrollId: targetPayroll.id,
          loadId: loadId,
          loadNumber: load.loadNumber,
          grossAmount: load.grossAmount,
          driverRate: load.driverRate,
          finalMiles: 0, // Will be updated when payroll is recalculated
          deliveryDate: load.deliveryDate,
          paymentMethod: null, // Will be updated when payroll is recalculated
          payPerMileRate: 0,
          driverPercent: 0,
          isIncluded: true,
          notes: `Moved from Week ${currentWeekInfo.week}, ${currentWeekInfo.year}`,
          createdDate: new Date().toISOString()
        }
      })

      // Update target payroll totals
      await recalculatePayrollTotals(tx, targetPayroll.id)

      // Create audit log entry
      await createLoadMoveAuditEntry(tx, {
        loadId,
        loadNumber: load.loadNumber,
        driverId: load.driverId,
        driverName: load.driverName,
        fromWeek: currentWeekInfo.week,
        fromYear: currentWeekInfo.year,
        toWeek: targetWeek,
        toYear: targetYear,
        movedBy: movedBy || 'system',
        reason: reason || 'Manual move',
        grossAmount: load.grossAmount,
        driverRate: load.driverRate
      })

      return {
        success: true,
        loadId,
        loadNumber: load.loadNumber,
        fromWeek: currentWeekInfo.week,
        fromYear: currentWeekInfo.year,
        toWeek: targetWeek,
        toYear: targetYear,
        targetPayrollId: targetPayroll.id
      }
    })

    console.log(`Successfully moved load ${load.loadNumber} to Week ${targetWeek}, ${targetYear}`)

    return NextResponse.json({
      ...result,
      message: `Load ${load.loadNumber} moved to Week ${targetWeek}, ${targetYear}`
    })

  } catch (error) {
    console.error('Error moving load:', error)
    return NextResponse.json(
      { error: 'Failed to move load to different week' },
      { status: 500 }
    )
  }
}

// Helper function to get week dates
function getWeekDates(year: number, week: number): { startDate: string, endDate: string } {
  const startOfYear = new Date(year, 0, 1)
  const daysToAdd = (week - 1) * 7
  const weekStart = new Date(startOfYear.getTime() + daysToAdd * 24 * 60 * 60 * 1000)
  
  const dayOfWeek = weekStart.getDay()
  const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
  const monday = new Date(weekStart.setDate(diff))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  
  return {
    startDate: monday.toISOString().split('T')[0],
    endDate: sunday.toISOString().split('T')[0]
  }
}

// Helper function to get week number from date
function getWeekFromDate(dateString: string): { year: number, week: number } {
  const date = new Date(dateString)
  const year = date.getFullYear()
  const start = new Date(year, 0, 1)
  const diff = date.getTime() - start.getTime()
  const oneWeek = 1000 * 60 * 60 * 24 * 7
  const week = Math.ceil(diff / oneWeek)
  
  return { year, week }
}

// Helper function to check if week is locked
async function isWeekLocked(year: number, week: number): Promise<boolean> {
  const { startDate } = getWeekDates(year, week)
  
  const lockedCount = await prisma.individualPayroll.count({
    where: {
      weekStartDate: startDate,
      isLocked: true
    }
  })
  
  return lockedCount > 0
}

// Helper function to calculate pay date
function calculatePayDate(weekEndDate: string): string {
  const endDate = new Date(weekEndDate)
  const payDate = new Date(endDate)
  payDate.setDate(endDate.getDate() + 5) // Friday of following week
  return payDate.toISOString().split('T')[0]
}

// Helper function to recalculate payroll totals
async function recalculatePayrollTotals(tx: any, payrollId: number): Promise<void> {
  // Get all loads for this payroll
  const payrollLoads = await tx.payrollLoad.findMany({
    where: { 
      payrollId,
      isIncluded: true
    }
  })

  // Calculate totals
  const totalLoads = payrollLoads.length
  const grossRevenue = payrollLoads.reduce((sum: number, load: any) => sum + load.grossAmount, 0)
  const basePay = payrollLoads.reduce((sum: number, load: any) => sum + load.driverRate, 0)

  // Update payroll record
  await tx.individualPayroll.update({
    where: { id: payrollId },
    data: {
      totalLoads,
      grossRevenue,
      basePay,
      grossPay: basePay, // Will need proper calculation later
      modifiedDate: new Date().toISOString(),
      status: totalLoads > 0 ? 'DRAFT' : 'EMPTY'
    }
  })
}

// Helper function to create audit entry
async function createLoadMoveAuditEntry(tx: any, data: any): Promise<void> {
  // For now, just log to console
  // In production, you'd store this in an audit table
  
  const auditEntry = {
    action: 'LOAD_MOVED',
    loadId: data.loadId,
    loadNumber: data.loadNumber,
    driverId: data.driverId,
    driverName: data.driverName,
    fromWeek: data.fromWeek,
    fromYear: data.fromYear,
    toWeek: data.toWeek,
    toYear: data.toYear,
    movedBy: data.movedBy,
    reason: data.reason,
    grossAmount: data.grossAmount,
    driverRate: data.driverRate,
    timestamp: new Date().toISOString()
  }
  
  console.log('LOAD MOVE AUDIT:', JSON.stringify(auditEntry, null, 2))
  
  // TODO: Store in audit table
  // await tx.auditLog.create({ data: auditEntry })
}
